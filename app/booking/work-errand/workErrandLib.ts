// ---------------------------------------------------------------------------
// Work Helper + Errands – shared request/booking flow
//
// Both flows are the same request → accept → pay → start → arrive → finish
// pipeline, keyed by a `WorkErrandKind` ("work" | "errand"). The one real
// difference is WHO pays:
//   - work   → the EMPLOYER / DRIVER pays (after accepting the applicant)
//   - errand → the PASSENGER / CUSTOMER pays (after the driver accepts)
//
// Collections used:
//   - workApplications    (one doc per passenger applying to a work job)
//   - errandApplications  (one doc per customer requesting an errand)
//   - notifications       (per-user in-app notifications; receiverId keyed)
//   - workJobs / errandJobs / users (read for provider + customer info)
//
// Payment is mock/demo only. The full card number and CVV are NEVER stored –
// only the last 4 digits (cardLast4). Navigation uses the customer's real GPS
// coordinates (applicantLocation / passengerLocation), not the typed city.
// ---------------------------------------------------------------------------

import * as Location from "expo-location";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  increment,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { auth, db } from "../../../firebase";
// Plain lib module (not a component) — uses the initialized global i18next
// instance directly rather than the useTranslation() hook.
import i18n from "../../i18n";
// Imported from the dependency-free leaf module (not from "../bookingsLib")
// — bookingsLib.ts itself imports `notify` from THIS file, so importing the
// eligibility helper back from bookingsLib.ts here would be a circular
// import between the two.
import {
  CancellationError,
  CancellationStatusInput,
  eligibilityReasonToErrorCode,
  getCancellationEligibility,
} from "../cancellationEligibility";
// Same reasoning as the cancellationEligibility import above — this is the
// dependency-free core (no notify()/i18n import), not driverViolationsLib.ts
// itself, which imports notify() FROM this file.
import {
  readExistingCancellationViolation,
  writeCancellationViolationIfNew,
} from "../driverViolationCore";

const NOTIFICATION_WORKER_URL =
  "https://takeme-notifications.yvcstudent4.workers.dev";

// After the in-app Firestore notification is created, ask the trusted
// Cloudflare Worker to deliver the matching OneSignal Web Push. The Worker
// verifies the current Firebase ID token, reads this exact notification doc
// through Firestore Security Rules, and only sends it when senderId matches
// the authenticated caller. No OneSignal secret is stored in the mobile app.
const sendExternalPushForNotification = async (
  notificationId: string,
): Promise<void> => {
  const user = auth.currentUser;
  if (!user || !notificationId) return;

  try {
    const idToken = await user.getIdToken(true);

    const response = await fetch(
      `${NOTIFICATION_WORKER_URL}/send-notification`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ notificationId }),
      },
    );

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      console.warn("External push delivery failed", response.status, details);
    }
  } catch (error) {
    // The in-app notification was already saved. A temporary push failure must
    // never cancel the real booking/request action.
    console.warn("External push delivery failed", error);
  }
};

export type WorkErrandKind = "work" | "errand";

// A dedicated error type for "this work job is already full" — deliberately
// NOT identified by comparing error.message (that string is now translated
// and would never match once the app isn't in English), only by type.
class WorkJobFullError extends Error {}

// The status of an application as it moves through the flow. Work and errand
// use DIFFERENT payment-pending statuses so the wording never gets confused.
export type FlowStatus =
  | "pending"
  | "payment_pending_driver" // work: employer must pay to confirm
  | "payment_pending_passenger" // errand: customer must pay to confirm
  | "accepted"
  | "on_the_way"
  | "arrived"
  | "in_progress"
  | "completed"
  | "rejected"
  | "cancelled";

const COLLECTION: Record<WorkErrandKind, string> = {
  work: "workApplications",
  errand: "errandApplications",
};

export const collectionFor = (kind: WorkErrandKind) => COLLECTION[kind];

// Category keys reuse the existing CATEGORY_META in bookingsLib.
export const categoryFor = (kind: WorkErrandKind) =>
  kind === "work" ? "workErrands" : "errands";

// The payment-pending status for a given kind.
export const paymentPendingStatus = (kind: WorkErrandKind): FlowStatus =>
  kind === "work" ? "payment_pending_driver" : "payment_pending_passenger";

// ---------------------------------------------------------------------------
// Current user info (name / phone / age) from the users doc
// ---------------------------------------------------------------------------

export type CurrentUser = {
  id: string;
  name: string;
  phone: string;
  age: number | null;
};

export const getCurrentUser = async (): Promise<CurrentUser | null> => {
  const user = auth.currentUser;
  if (!user) return null;

  let name = user.displayName || "You";
  let phone = "";
  let age: number | null = null;

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      const data = snap.data();
      name = data.name || name;
      phone = data.phone || "";
      const rawAge = data.age ?? data.driverAge ?? data.userAge;
      age = typeof rawAge === "number" ? rawAge : Number(rawAge) || null;
    }
  } catch {
    // Fall back to auth profile values.
  }

  return { id: user.uid, name, phone, age };
};

// ---------------------------------------------------------------------------
// Notifications helper (in-app, per user)
// ---------------------------------------------------------------------------

export type GeoPoint = {
  latitude: number | null;
  longitude: number | null;
  address: string;
};

// ---------------------------------------------------------------------------
// Location detection (used by the apply / book pages)
// ---------------------------------------------------------------------------

// Asks for permission, gets the current GPS position and (best effort) a
// readable address. Throws with a clear message when permission is denied.
export const detectCurrentLocation = async (): Promise<GeoPoint> => {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    throw new Error(i18n.t("workErrand.locationPermissionRequired"));
  }

  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  const latitude = pos.coords.latitude;
  const longitude = pos.coords.longitude;

  let address = "";
  try {
    const results = await Location.reverseGeocodeAsync({ latitude, longitude });
    const first = results[0];
    if (first) {
      address = [first.street, first.city || first.region, first.country]
        .filter(Boolean)
        .join(", ");
    }
  } catch {
    // Reverse geocode is optional – coordinates alone are enough.
  }

  if (!address) {
    address = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  }

  return { latitude, longitude, address };
};

export type NotificationTab = "passenger" | "driver";

export type NotifyInput = {
  receiverId: string;
  senderId?: string;
  type: string;
  title: string;
  message: string;
  applicationId?: string;
  bookingId?: string;
  kind?: WorkErrandKind;
  category?: string;
  status?: string;
  // Which side of "My Bookings" tapping this notification should open.
  targetTab?: NotificationTab;
  roleTarget?: NotificationTab;
  openBookingTab?: NotificationTab;

  // Roadside Help only — a screen route (e.g. "finding-help",
  // "roadside-payment") that tapping this notification should open instead
  // of My Bookings, plus the request/offer ids and payment amount that
  // screen needs. Left null/omitted for every other notification type.
  requestId?: string;
  offerId?: string;
  targetPage?: string;
  amount?: number;
  // Explicit driver/passenger identity on the notification doc itself
  // (Roadside Help spec) — in addition to receiverId/senderId above.
  driverId?: string;
  passengerId?: string;

  // School rides only — which child a "school_trip_match" notification is
  // for (a family can have several children each waiting on a different
  // return trip; the notification and the screen it opens must identify
  // the right one). Left null/omitted for every other notification type.
  childEntryId?: string;
  childName?: string;
  // The durable schoolChildren/{childId} profile id (see
  // app/booking/school/schoolChildrenLib.ts) — absent whenever the waiting
  // rideRequest itself had none (a plain temporary/manual entry with no
  // saved profile). Carrying this through is what lets trip-confirm.tsx →
  // bookReturnForChild write it onto the resulting schoolBookings document;
  // without it, a return booked from tapping this notification would have
  // no stable childId at all — invisible to anything that looks a child up
  // by childId (e.g. the School Kiosk — see schoolKiosk.ts).
  childId?: string;
};

export const notify = async (input: NotifyInput) => {
  if (!input.receiverId) return;

  const tab =
    input.targetTab || input.roleTarget || input.openBookingTab || null;

  try {
    const notificationRef = await addDoc(collection(db, "notifications"), {
      // userId is kept for backwards-compatible querying; receiverId is the
      // canonical field per the notification schema.
      userId: input.receiverId,
      receiverId: input.receiverId,
      senderId: input.senderId || auth.currentUser?.uid || null,
      type: input.type,
      title: input.title,
      message: input.message,
      applicationId: input.applicationId || null,
      relatedId: input.applicationId || null,
      bookingId: input.bookingId || input.applicationId || null,
      kind: input.kind || null,
      category: input.category || null,
      status: input.status || null,
      targetTab: tab,
      roleTarget: tab,
      openBookingTab: tab,
      requestId: input.requestId || null,
      offerId: input.offerId || null,
      targetPage: input.targetPage || null,
      amount: typeof input.amount === "number" ? input.amount : null,
      driverId: input.driverId || null,
      passengerId: input.passengerId || null,
      childEntryId: input.childEntryId || null,
      childName: input.childName || null,
      childId: input.childId || null,
      read: false,
      readAt: null,
      deleted: false,
      createdAt: serverTimestamp(),
    });

    // Wait until the Worker accepted the request so the sender cannot close
    // the app before the outgoing push request was even started.
    await sendExternalPushForNotification(notificationRef.id);
  } catch (error) {
    // Notifications are best-effort – never block the main action on them.
    console.warn("Notification creation/delivery failed", error);
  }
};

// ---------------------------------------------------------------------------
// Step 1 – customer sends a request
// ---------------------------------------------------------------------------

// Details filled by the customer. Personal identity (name/age/phone) is taken
// automatically from their profile; only these are entered by hand.
export type CustomerDetails = {
  // Legacy free-text city/neighborhood — no longer collected by the current
  // UI (replaced by PickupLocationPicker.tsx), optional so new callers can
  // omit them entirely; still written (as empty strings) for any code that
  // still reads them off an application doc.
  city?: string;
  neighborhood?: string;
  notes: string;
  location: GeoPoint;
  // How `location` was obtained — see PickupLocationPicker.tsx's own
  // PickupLocationSource. Duplicated as a plain union here (not imported)
  // to avoid a circular import (PickupLocationPicker.tsx itself imports
  // detectCurrentLocation from this file).
  pickupSource: "current" | "home" | "custom";
  // Stable Israeli-locality id for `city` (see israelLocations.ts) — optional
  // only because this type predates that dataset; new callers always set it.
  cityLocationId?: string;
  cityLocationNames?: { english: string; arabic: string; hebrew: string };
};

// The job / errand the customer is applying to (read from the listing).
export type SourceListing = {
  sourceId: string; // workJobs / errandJobs doc id
  providerId: string; // employerId / driverId
  providerName: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  hourlyPay?: number | null;
  price?: number | null;
  seats?: number | null;
};

export const createApplication = async (
  kind: WorkErrandKind,
  source: SourceListing,
  details: CustomerDetails,
): Promise<string> => {
  const me = await getCurrentUser();
  if (!me) throw new Error(i18n.t("workErrand.mustBeLoggedIn"));

  if (source.providerId && source.providerId === me.id) {
    throw new Error(i18n.t("workErrand.cannotRequestOwnListing"));
  }

  // Sending a request never reserves a place by itself — only an accepted
  // request does (see acceptWorkRequest below). This is just an informational
  // check so a passenger can't apply to a job that's visibly already full;
  // the actual overbooking protection lives in the accept transaction.
  if (kind === "work" && source.sourceId) {
    try {
      const jobSnap = await getDoc(doc(db, "workJobs", source.sourceId));

      if (jobSnap.exists()) {
        const jobData = jobSnap.data();
        const remaining =
          typeof jobData.remainingSeats === "number"
            ? jobData.remainingSeats
            : Number(jobData.totalSeats ?? jobData.workersNeeded ?? 1);

        if (remaining <= 0 || jobData.available === false) {
          throw new WorkJobFullError(i18n.t("workErrand.jobAlreadyFull"));
        }
      }
    } catch (error: any) {
      if (error instanceof WorkJobFullError) {
        throw error;
      }
      // Any other read failure shouldn't block sending the request — the
      // accept-time transaction is the authoritative guard either way.
    }
  }

  const location = {
    latitude: details.location.latitude,
    longitude: details.location.longitude,
    address: details.location.address || "",
  };

  // Shared fields written to both collections.
  const base = {
    city: details.city || "",
    cityLocationId: details.cityLocationId || null,
    cityLocationNames: details.cityLocationNames || null,
    neighborhood: details.neighborhood || "",
    notes: details.notes || "",
    // Unified shape (see PickupLocationPicker.tsx) — written alongside the
    // legacy applicantLocation/passengerLocation fields below, never
    // replacing them (NormalizedApplication.location still reads those for
    // backward compatibility).
    pickupLocation: { ...location, source: details.pickupSource },

    startTime: source.startTime,
    endTime: source.endTime,

    paymentMethod: null,
    paymentStatus: "unpaid",
    cardLast4: null,

    status: "pending" as FlowStatus,
    category: categoryFor(kind),

    // Rating gate — mirrors the School/Personal Ride booking shape so the
    // same "needs rating" check works across every trip type. Only ever
    // flips to needsPassengerRating:true once finishJob marks this
    // completed.
    tripStatus: "pending",
    needsPassengerRating: false,
    ratingSubmitted: false,
    rating: null,
    reviewComment: "",
    ratedAt: null,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  let payload: any;

  if (kind === "work") {
    payload = {
      ...base,
      jobId: source.sourceId,
      employerId: source.providerId,
      employerName: source.providerName,

      applicantId: me.id,
      applicantName: me.name,
      applicantAge: me.age,
      applicantPhone: me.phone,
      applicantLocation: location,

      jobTitle: source.title,
      jobDate: source.date,
      hourlyPay: source.hourlyPay ?? null,
      price: source.price ?? null,

      // Work is paid in reverse (employer -> worker, after completion) —
      // see finishJob/payCompletedWork. Not applicable to errand.
      workCompleted: false,
      driverPaymentStatus: "unpaid",
      paidBy: null,
      paidTo: null,
      paidAmount: null,
      paidAt: null,
    };
  } else {
    payload = {
      ...base,
      errandId: source.sourceId,
      driverId: source.providerId,
      driverName: source.providerName,

      passengerId: me.id,
      passengerName: me.name,
      passengerAge: me.age,
      passengerPhone: me.phone,
      passengerLocation: location,

      errandTitle: source.title,
      errandDate: source.date,
      price: source.price ?? null,
      seats: source.seats ?? null,
    };
  }

  const ref = await addDoc(collection(db, COLLECTION[kind]), payload);

  // Errand only: a plain running counter of real (non-rejected/cancelled)
  // requests on the errandJobs listing itself — see rejectRequest's and
  // cancelApplication's matching decrements below. This exists purely so
  // the passenger-facing search screens (errand/errand.tsx, the Home feed —
  // see isErrandHiddenFromSearch in homeFeedLib.ts) can tell "genuinely
  // unbooked" apart from "has at least one request" WITHOUT reading the
  // errandApplications collection cross-user (firestore.rules restricts
  // that collection to each doc's own passenger/driver) — errandJobs is
  // already broadly readable/writable by any signed-in user, so this
  // counter is the safe place for that signal to live. Best-effort: a
  // failure here must never block the actual request from being sent.
  if (kind === "errand" && source.sourceId) {
    try {
      await updateDoc(doc(db, "errandJobs", source.sourceId), {
        bookingCount: increment(1),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.log("createApplication: could not increment errand bookingCount", error);
    }
  }

  // Notify the provider that a new request arrived. Tapping this must land
  // the provider straight on the matching pending Accept/Reject card in My
  // Bookings → Driver tab (see getBookingTabFromNotification/onPressNotification
  // in notifications.tsx and the scroll-to-highlight wiring in bookings.tsx).
  if (source.providerId) {
    await notify({
      receiverId: source.providerId,
      senderId: me.id,
      type: "new_booking_request",
      title: "New service request",
      message: `${me.name} sent you a request`,
      applicationId: ref.id,
      kind,
      category: kind === "work" ? "work" : "errands",
      status: "pending",
      targetTab: "driver",
    });
  }

  return ref.id;
};

// ---------------------------------------------------------------------------
// Step 2 – provider accepts / rejects
// ---------------------------------------------------------------------------

export const acceptRequest = async (
  kind: WorkErrandKind,
  id: string,
  data: NormalizedApplication,
) => {
  // Work jobs have finite worker capacity (workersNeeded/remainingSeats) —
  // accepting must be a transaction that decrements it safely. Errand has
  // no such capacity concept and keeps its existing pre-service
  // payment-pending step, unchanged.
  if (kind === "work") {
    await acceptWorkRequest(id, data);
    return;
  }

  const nextStatus: FlowStatus = paymentPendingStatus(kind);

  await updateDoc(doc(db, COLLECTION[kind], id), {
    status: nextStatus,
    driverAcceptedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await notify({
    receiverId: data.customerId,
    type: "request_accepted",
    title: "Request accepted",
    message: "Driver accepted your errand request. Please continue to payment.",
    applicationId: id,
    kind,
    category: data.category,
    status: nextStatus,
  });
};

// ---------------------------------------------------------------------------
// Work only — accept a request against the job's remaining capacity.
//
// "seats" on a Work job means "workers the employer still needs", not "this
// job is booked/unbooked" like every other listing type. Accepting one
// applicant must never close the job to everyone else — it only takes one
// place out of totalSeats. The job stays available/visible until
// remainingSeats reaches 0, at which point (and only then) it flips to
// full/unavailable. Two employers/taps racing to accept different
// applicants at the same time must not be able to overbook the job, hence
// the transaction (read-check-decrement, all in one atomic step).
// ---------------------------------------------------------------------------

const acceptWorkRequest = async (id: string, data: NormalizedApplication) => {
  if (!data.sourceId) {
    throw new Error(i18n.t("workErrand.missingJobId"));
  }

  const appRef = doc(db, "workApplications", id);
  const jobRef = doc(db, "workJobs", data.sourceId);

  await runTransaction(db, async (transaction) => {
    const appSnap = await transaction.get(appRef);

    if (!appSnap.exists()) {
      throw new Error(i18n.t("workErrand.requestNotFound"));
    }

    const appData: any = appSnap.data();

    // Idempotency guard — a double-tap (or an already-handled request)
    // must not decrement capacity twice.
    if (appData.status !== "pending") {
      throw new Error(i18n.t("workErrand.requestAlreadyHandled"));
    }

    const jobSnap = await transaction.get(jobRef);

    if (!jobSnap.exists()) {
      throw new Error(i18n.t("workErrand.jobNoLongerExists"));
    }

    const jobData: any = jobSnap.data();

    const totalSeats = Number(
      jobData.totalSeats ?? jobData.seats ?? jobData.workersNeeded ?? 1,
    );

    const currentRemaining =
      typeof jobData.remainingSeats === "number"
        ? jobData.remainingSeats
        : totalSeats;

    if (currentRemaining <= 0) {
      throw new Error(i18n.t("workErrand.jobAlreadyFull"));
    }

    // Work doesn't currently collect a "places requested" count from the
    // applicant (each request is for one place) — read it defensively in
    // case that's ever added, but never take more than what's left.
    const requestedSeats = Math.max(
      1,
      Number(appData.requestedSeats || appData.seats || 1),
    );
    const takenSeats = Math.min(requestedSeats, currentRemaining);

    const nextRemaining = Math.max(currentRemaining - takenSeats, 0);
    const nextAcceptedCount = Number(jobData.acceptedWorkersCount || 0) + 1;
    const isNowFull = nextRemaining <= 0;

    // Keep showing the job to other passengers for as long as places are
    // left — only flip to full/unavailable once remainingSeats hits 0.
    transaction.update(jobRef, {
      remainingSeats: nextRemaining,
      acceptedWorkersCount: nextAcceptedCount,
      status: isNowFull ? "full" : "available",
      available: !isNowFull,
      isFull: isNowFull,
      updatedAt: serverTimestamp(),
    });

    transaction.update(appRef, {
      status: "accepted" as FlowStatus,
      driverAcceptedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  await notify({
    receiverId: data.customerId,
    type: "request_accepted",
    title: "Request accepted",
    message:
      "The employer accepted your work request. Work will begin as scheduled — you'll be paid after it's completed.",
    applicationId: id,
    kind: "work",
    category: data.category,
    status: "accepted",
  });
};

export const rejectRequest = async (
  kind: WorkErrandKind,
  id: string,
  data: NormalizedApplication,
) => {
  await updateDoc(doc(db, COLLECTION[kind], id), {
    status: "rejected" as FlowStatus,
    rejectedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Errand only: a rejected request no longer counts as "booked" — see the
  // matching increment in createApplication above.
  if (kind === "errand" && data.sourceId) {
    try {
      await updateDoc(doc(db, "errandJobs", data.sourceId), {
        bookingCount: increment(-1),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.log("rejectRequest: could not decrement errand bookingCount", error);
    }
  }

  await notify({
    receiverId: data.customerId,
    type: "request_rejected",
    title: "Request rejected",
    message: `Your request for "${data.title}" was not accepted this time.`,
    applicationId: id,
    kind,
    category: data.category,
    status: "rejected",
  });
};

// ---------------------------------------------------------------------------
// Step 3 – payment. WORK: the employer/driver pays. ERRAND: the passenger pays.
// ---------------------------------------------------------------------------

export type PaymentInput =
  | { method: "cash" }
  | { method: "card"; cardLast4: string }
  | { method: "bit" };

export const confirmPayment = async (
  kind: WorkErrandKind,
  id: string,
  data: NormalizedApplication,
  payment: PaymentInput,
) => {
  const fields =
    payment.method === "cash"
      ? {
          paymentMethod: "cash",
          paymentStatus: "cash_selected",
          cardLast4: null,
        }
      : payment.method === "bit"
        ? {
            paymentMethod: "bit",
            paymentStatus: "mock_paid",
            cardLast4: null,
          }
        : {
            paymentMethod: "card",
            paymentStatus: "mock_paid",
            // Only the last 4 digits are ever stored.
            cardLast4: payment.cardLast4.slice(-4),
          };

  await updateDoc(doc(db, COLLECTION[kind], id), {
    ...fields,
    status: "accepted" as FlowStatus,
    bookingConfirmedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Notify the OTHER side (the one who did not pay).
  if (kind === "work") {
    // Employer paid → tell the applicant the booking is confirmed.
    await notify({
      receiverId: data.customerId,
      type: "payment_confirmed",
      title: "Work booking confirmed",
      message: `The employer confirmed your work booking for "${data.title}".`,
      applicationId: id,
      kind,
      category: data.category,
      status: "accepted",
    });
  } else {
    // Passenger paid → tell the driver.
    await notify({
      receiverId: data.providerId,
      type: "payment_confirmed",
      title: "Payment confirmed",
      message: `${data.customerName} confirmed payment for "${data.title}".`,
      applicationId: id,
      kind,
      category: data.category,
      status: "accepted",
    });
  }
};

// ---------------------------------------------------------------------------
// Step 4 – provider starts / arrives / finishes
// ---------------------------------------------------------------------------

export const startJob = async (
  kind: WorkErrandKind,
  id: string,
  data: NormalizedApplication,
) => {
  await updateDoc(doc(db, COLLECTION[kind], id), {
    status: "on_the_way" as FlowStatus,
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await notify({
    receiverId: data.customerId,
    type: "on_the_way",
    title: "Driver on the way",
    message:
      kind === "work"
        ? "The driver is on the way to you."
        : "The driver is on the way.",
    applicationId: id,
    kind,
    category: data.category,
    status: "on_the_way",
  });
};

export const arriveJob = async (
  kind: WorkErrandKind,
  id: string,
  data: NormalizedApplication,
) => {
  await updateDoc(doc(db, COLLECTION[kind], id), {
    status: "arrived" as FlowStatus,
    arrivedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await notify({
    receiverId: data.customerId,
    type: "arrived",
    title: "Driver arrived",
    message: "The driver has arrived.",
    applicationId: id,
    kind,
    category: data.category,
    status: "arrived",
  });
};

// The real "Start Trip" action, distinct from startJob (which only means
// "began driving toward the customer") — this is what actually moves the
// job into Driver My Bookings' In Progress tab (see getDriverTripStatus in
// bookingsLib.ts, which reads this same tripStatus). Only available once
// the driver has arrived; Finish now requires this to have run first (see
// bookings.tsx's renderApplicationCard).
export const beginJobTrip = async (
  kind: WorkErrandKind,
  id: string,
  data: NormalizedApplication,
) => {
  await updateDoc(doc(db, COLLECTION[kind], id), {
    status: "in_progress" as FlowStatus,
    tripStatus: "in_progress",
    tripStartedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await notify({
    receiverId: data.customerId,
    type: "trip_in_progress",
    title: kind === "work" ? "Work started" : "Errand started",
    message:
      kind === "work" ? "Your work has started." : "Your errand has started.",
    applicationId: id,
    kind,
    category: data.category,
    status: "in_progress",
  });
};

export const finishJob = async (
  kind: WorkErrandKind,
  id: string,
  data: NormalizedApplication,
) => {
  const payload: any = {
    status: "completed" as FlowStatus,
    tripStatus: "completed",
    needsPassengerRating: true,
    ratingSubmitted: false,
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (kind === "work") {
    payload.workCompleted = true;

    // The provider now pays the worker right after accepting (see
    // bookings.tsx's handleAppAccept), not after the job finishes — finishing
    // must never overwrite an already-"paid" status back to "pending", or a
    // job paid for upfront would incorrectly show as still owing on the
    // Completed card (see bookings.tsx's payRow — Work Helper deliberately
    // shows plain status text there, the same as Errand, never an action
    // button once the job is done).
    if (data.driverPaymentStatus !== "paid") {
      payload.driverPaymentStatus = "pending";
    }
  }

  await updateDoc(doc(db, COLLECTION[kind], id), payload);

  await notify({
    receiverId: data.customerId,
    type: "completed",
    title: kind === "work" ? "Work completed" : "Errand completed",
    message: `"${data.title}" has been completed. Please rate your driver.`,
    applicationId: id,
    bookingId: id,
    kind,
    category: data.category,
    status: "completed",
    targetTab: "passenger",
  });
};

// ---------------------------------------------------------------------------
// Work only – the employer/driver pays the passenger/worker AFTER the job
// is marked completed (see finishJob above). This is the reverse of every
// other flow in the app (ride/school/errand all pay the driver up front);
// School, Personal Ride, and Errand are untouched by this function.
// ---------------------------------------------------------------------------

export type WorkPaymentInput =
  | { method: "cash" }
  | { method: "card"; cardLast4: string }
  | { method: "bit" };

export const payCompletedWork = async (
  bookingId: string,
  amount: number,
  payment: WorkPaymentInput,
) => {
  const user = auth.currentUser;

  if (!user) {
    throw new Error(i18n.t("auth.pleaseLoginFirst"));
  }

  const ref = doc(db, COLLECTION.work, bookingId);

  const paymentFields =
    payment.method === "cash"
      ? { paymentMethod: "cash", cardLast4: null }
      : payment.method === "bit"
        ? { paymentMethod: "bit", cardLast4: null }
        : {
            paymentMethod: "card",
            // Only the last 4 digits are ever stored.
            cardLast4: payment.cardLast4.slice(-4),
          };

  let applicantId = "";
  let jobTitle = "the job";

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);

    if (!snap.exists()) {
      throw new Error(i18n.t("rides.bookingNotFound"));
    }

    const data: any = snap.data();

    // Protect against duplicate payments.
    if (data.driverPaymentStatus === "paid") {
      throw new Error(i18n.t("workErrand.jobAlreadyPaid"));
    }

    if (data.employerId && data.employerId !== user.uid) {
      throw new Error(i18n.t("workErrand.onlyEmployerCanPay"));
    }

    applicantId = data.applicantId || "";
    jobTitle = data.jobTitle || jobTitle;

    transaction.update(ref, {
      ...paymentFields,
      driverPaymentStatus: "paid",
      paymentStatus: "paid",
      paidBy: user.uid,
      paidTo: applicantId,
      paidAmount: amount,
      paidAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  if (applicantId) {
    await notify({
      receiverId: applicantId,
      senderId: user.uid,
      type: "work_payment_received",
      title: "Payment received",
      message: `You were paid ₪${amount} for "${jobTitle}".`,
      applicationId: bookingId,
      kind: "work",
      category: categoryFor("work"),
      status: "paid",
      targetTab: "passenger",
    });
  }
};

// ---------------------------------------------------------------------------
// Cancellation (both sides, blocked within 1 hour of start)
// ---------------------------------------------------------------------------

// Build a Date from "YYYY-MM-DD" + "HH:MM" (local time). Returns null if the
// pieces are missing/invalid.
export const toDateTime = (dateYMD: string, timeHM: string): Date | null => {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYMD || "");
  if (!dateMatch) return null;

  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(timeHM || "");
  const hours = timeMatch ? Number(timeMatch[1]) : 0;
  const minutes = timeMatch ? Number(timeMatch[2]) : 0;

  return new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    hours,
    minutes,
    0,
    0,
  );
};

// Once the driver is on the way (or later) cancellation is never allowed.
const UNCANCELLABLE: FlowStatus[] = [
  "on_the_way",
  "arrived",
  "in_progress",
  "completed",
  "rejected",
  "cancelled",
];

// Returns a reason string when cancellation is NOT allowed, or null when it
// is. `cancelledBy` picks the window: the driver/provider gets the stricter
// 5-hour lock (cancelling can leave a customer/employer without a match),
// the passenger/customer keeps the 2-hour lock — same driver/passenger split
// every other category uses (see cancellationEligibility.ts). Previously this
// applied a flat 2-hour window to BOTH roles.
export const cancelBlockedReason = (
  item: NormalizedApplication,
  cancelledBy: "passenger" | "driver" = "passenger",
  now: Date = new Date(),
): string | null => {
  if (UNCANCELLABLE.includes(item.status)) {
    return i18n.t("workErrand.cannotCancelAnymore");
  }

  const eligibility = getCancellationEligibility({
    role: cancelledBy === "driver" ? "driver" : "passenger",
    date: item.date,
    time: item.startTime,
    status: "booked",
    now,
  });

  if (eligibility.canCancel) return null;

  if (eligibility.reason === "invalid_departure") {
    // No valid start time to compare against — previously silently allowed
    // ("No valid start time → allow cancel"); now disabled rather than
    // trusting an unverifiable departure (see getCancellationEligibility's
    // own contract).
    return i18n.t("booking.cannotCancelInvalidDeparture");
  }

  return cancelledBy === "driver"
    ? i18n.t("booking.cannotCancelTripWithinFiveHours")
    : i18n.t("workErrand.cannotCancelWithinTwoHours");
};

// `data` is used ONLY to locate the doc (via COLLECTION[kind]/id, which
// don't need it at all — kept for call-site compatibility). Ownership,
// status, date/startTime, and the accepted-work seat-restore math are ALL
// re-derived from a freshly-read transaction.get() below, never trusted from
// this possibly-stale caller-held card. Throws a CancellationError with a
// stable code (never a raw Firestore/SDK error) — see bookingsLib.ts's
// translateCancellationError for the UI-facing message mapping.
//
// Folds in what used to be the separate cancelAcceptedWorkRequest helper —
// both branches (plain cancel vs. accepted-work-with-seat-restore) now share
// ONE transaction/one fresh read of the application doc, rather than two
// separate re-implementations that could disagree on what "fresh" means.
export const cancelApplication = async (
  kind: WorkErrandKind,
  id: string,
  data: NormalizedApplication,
  cancelledBy: "passenger" | "driver",
  reason?: string,
): Promise<{ violationCreated: boolean; driverId: string } | null> => {
  const user = auth.currentUser;
  if (!user) throw new CancellationError("NOT_AUTHORIZED");

  const appRef = doc(db, COLLECTION[kind], id);

  let notifyOtherId = "";
  let notifyTitle = "";
  let notifyCategory = "";
  let didCancel = false;
  let driverIdForViolation = "";
  let violationCreated = false;

  await runTransaction(db, async (transaction) => {
    // -----------------------------------------------------------------
    // PHASE 1 — every read, including the conditional workJobs read below
    // (still a plain transaction.get(), just sequenced after the first).
    // -----------------------------------------------------------------
    const appSnap = await transaction.get(appRef);
    if (!appSnap.exists()) throw new CancellationError("DOCUMENT_NOT_FOUND");

    const rawAppData: any = appSnap.data();
    const current = normalizeApplication(appSnap.id, rawAppData, kind);

    const expectedUid =
      cancelledBy === "driver" ? current.providerId : current.customerId;
    if (!expectedUid || expectedUid !== user.uid) {
      throw new CancellationError("NOT_AUTHORIZED");
    }

    const statusInput: CancellationStatusInput =
      current.status === "cancelled"
        ? "cancelled"
        : current.status === "completed"
          ? "completed"
          : UNCANCELLABLE.includes(current.status)
            ? // on_the_way / arrived / in_progress / rejected — already too
              // far along (or a declined request) to ever be cancelled.
              "started"
            : "booked";

    // Already cancelled — safe no-op, never a second seat restore/notify.
    if (statusInput === "cancelled") return;

    if (statusInput !== "booked") {
      throw new CancellationError(
        eligibilityReasonToErrorCode(
          statusInput === "completed" ? "completed" : "already_started",
          cancelledBy === "driver" ? "driver" : "passenger",
        ),
      );
    }

    const eligibility = getCancellationEligibility({
      role: cancelledBy === "driver" ? "driver" : "passenger",
      date: current.date,
      time: current.startTime,
      status: "booked",
    });

    if (!eligibility.canCancel) {
      throw new CancellationError(
        eligibilityReasonToErrorCode(
          eligibility.reason,
          cancelledBy === "driver" ? "driver" : "passenger",
        ),
      );
    }

    // Only an ACCEPTED work request ever took a place out of the job's
    // capacity — a still-pending one never touched remainingSeats, so
    // cancelling it needs no restore. Errand has no capacity concept at all.
    const isAcceptedWork =
      kind === "work" && current.status === "accepted" && !!current.sourceId;
    const jobRef = isAcceptedWork
      ? doc(db, "workJobs", current.sourceId)
      : null;
    const jobSnap = jobRef ? await transaction.get(jobRef) : null;

    // An accepted application (work or errand) IS exactly one real,
    // confirmed customer/employer booking — read the violation doc now
    // (still PHASE 1) so it can be written atomically alongside the
    // cancellation below (see driverViolationCore.ts's own header).
    const violationSnap =
      cancelledBy === "driver" && current.providerId
        ? await readExistingCancellationViolation(
            transaction,
            current.providerId,
            kind === "work" ? "workJobs" : "errandJobs",
            id,
          )
        : null;

    // -----------------------------------------------------------------
    // PHASE 2 — every write. No transaction.get() below this point.
    // -----------------------------------------------------------------
    transaction.update(appRef, {
      status: "cancelled" as FlowStatus,
      cancelledAt: serverTimestamp(),
      cancelledBy,
      cancelReason: reason || null,
      updatedAt: serverTimestamp(),
    });

if (violationSnap && current.providerId) {
  driverIdForViolation = current.providerId;

  violationCreated = writeCancellationViolationIfNew(
    transaction,
    violationSnap,
    {
      driverId: current.providerId,
      sourceCollection: kind === "work" ? "workJobs" : "errandJobs",
      sourceId: id,
      sourceCategory: current.category,
      scheduledDeparture: new Date(
        `${current.date}T${current.startTime || "00:00"}:00`
      ),
      passengerBookingCount: 1,
    }
  );
}

notifyOtherId =
  cancelledBy === "passenger"
    ? current.providerId
    : current.customerId;
    notifyTitle = current.title;
    notifyCategory = current.category;
    didCancel = true;

    if (kind === "errand" && current.sourceId) {
      if (cancelledBy === "driver") {
        // The driver (the one who posted this errand offer) no longer
        // wants to run it at all — cancel the whole listing and hide it
        // from the driver's own Upcoming/Unbooked Trips (the just-cancelled
        // application above is the retained history record), instead of
        // merely decrementing the booking counter, which would leave it
        // silently reappearing/re-searchable for a different customer (an
        // errand job is always exactly one customer, never a shared-seat
        // resource like a weekly route or a multi-worker job — see the
        // "effectively taken by exactly one customer" comment elsewhere in
        // this file).
        transaction.update(doc(db, "errandJobs", current.sourceId), {
          status: "cancelled",
          deletedForDriver: true,
          updatedAt: serverTimestamp(),
        });
      } else {
        // Passenger (customer) cancellation — the driver still offers this
        // errand; just record that one fewer real request exists (see the
        // matching increment in createApplication above). increment(-1)
        // needs no prior read, so this can run alongside the appRef write
        // above without an extra transaction.get().
        transaction.update(doc(db, "errandJobs", current.sourceId), {
          bookingCount: increment(-1),
          updatedAt: serverTimestamp(),
        });
      }
    }

    if (!jobRef || !jobSnap || !jobSnap.exists()) return;

    const jobData: any = jobSnap.data();

    const totalSeats = Number(
      jobData.totalSeats ?? jobData.seats ?? jobData.workersNeeded ?? 1,
    );
    const currentRemaining =
      typeof jobData.remainingSeats === "number" ? jobData.remainingSeats : 0;
    // requestedSeats has no dedicated field in NormalizedApplication — read
    // straight off this SAME fresh snapshot's raw data, matching the exact
    // field precedence the previous implementation used.
    const requestedSeats = Math.max(
      1,
      Number(rawAppData.requestedSeats || current.seats || 1),
    );

    // Never let remainingSeats climb above totalSeats.
    const nextRemaining = Math.min(
      currentRemaining + requestedSeats,
      totalSeats,
    );
    const nextAcceptedCount = Math.max(
      Number(jobData.acceptedWorkersCount || 0) - 1,
      0,
    );

    transaction.update(jobRef, {
      remainingSeats: nextRemaining,
      acceptedWorkersCount: nextAcceptedCount,
      status: "available",
      available: true,
      isFull: false,
      updatedAt: serverTimestamp(),
    });
  });

  // Only notify for a REAL transition — a no-op re-cancel (already-cancelled
  // early return above) must never send a second cancellation notification.
  if (!didCancel) return null;

  const violationResult = driverIdForViolation
    ? { violationCreated, driverId: driverIdForViolation }
    : null;

  if (!notifyOtherId) return violationResult;

  // Best-effort — the cancellation itself already succeeded, so a notify()
  // failure must never be reported back to the caller as a failed
  // cancellation (same pattern as every other cancel function in this
  // codebase — see cancelGeneralBooking in bookingsLib.ts).
  try {
    await notify({
      receiverId: notifyOtherId,
      type: "cancelled",
      title: "Booking cancelled",
      message: `The ${cancelledBy} cancelled "${notifyTitle}".`,
      applicationId: id,
      kind,
      category: notifyCategory,
      status: "cancelled",
    });
  } catch (error) {
    console.log("cancelApplication: notify failed (booking already cancelled, non-fatal)", {
      id,
      kind,
      category: notifyCategory,
      path: "notifications",
      error,
    });
  }

  return violationResult;
};

// ---------------------------------------------------------------------------
// Start button availability (enabled on the job/errand date, hour-independent)
// ---------------------------------------------------------------------------

const todayYMD = (now: Date = new Date()) => {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

// "ready" once we reach the job date (any time that day), otherwise "future".
export const startState = (
  dateYMD: string,
  now: Date = new Date(),
): "ready" | "future" => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYMD || "")) return "ready";
  return dateYMD <= todayYMD(now) ? "ready" : "future";
};

// ---------------------------------------------------------------------------
// Normalizer → common display shape for both collections
// ---------------------------------------------------------------------------

export type NormalizedApplication = {
  id: string;
  kind: WorkErrandKind;
  category: string;
  sourceId: string;
  providerId: string;
  providerName: string;
  customerId: string;
  customerName: string;
  customerAge: number | null;
  customerPhone: string;
  city: string;
  cityLocationId: string;
  neighborhood: string;
  notes: string;
  location: GeoPoint | null;
  // Unified shape (see PickupLocationPicker.tsx) — synthesized from
  // location/applicantLocation/passengerLocation for any application
  // created before this field existed, so every reader can rely on it
  // being present whenever `location` itself resolves to something.
  pickupLocation: (GeoPoint & { source: "current" | "home" | "custom" }) | null;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  hourlyPay: number | null;
  price: number | null;
  seats: number | null;
  paymentMethod: string | null;
  paymentStatus: string;
  cardLast4: string | null;
  status: FlowStatus;

  // Rating gate — same shape/semantics as BookingItem/RideBooking so the
  // shared "needs rating" check and modal work without special-casing.
  tripStatus: string;
  needsPassengerRating: boolean;
  ratingSubmitted: boolean;
  rating: number | null;
  reviewComment: string;
  ratedAtSeconds: number;
  // 0 until finishJob actually stamps completedAt — the rating gate
  // requires this to be > 0, never just tripStatus === "completed" alone.
  completedAtSeconds: number;

  // Work only — the reverse payment gate (driver pays passenger after
  // completion). Always false/"unpaid" for errand.
  workCompleted: boolean;
  driverPaymentStatus: string;
  paidAmount: number | null;
  paidAtSeconds: number;

  createdAtSeconds: number;
  searchText: string;
};

const asNumber = (value: any): number | null =>
  typeof value === "number" ? value : null;

const normalizeGeo = (raw: any): GeoPoint | null => {
  if (!raw || typeof raw !== "object") return null;
  const latitude = typeof raw.latitude === "number" ? raw.latitude : null;
  const longitude = typeof raw.longitude === "number" ? raw.longitude : null;
  return { latitude, longitude, address: raw.address || "" };
};

export const normalizeApplication = (
  id: string,
  data: any,
  kind: WorkErrandKind,
): NormalizedApplication => {
  const title = data.jobTitle || data.errandTitle || "";
  const date = data.jobDate || data.errandDate || "";
  const providerName = data.employerName || data.driverName || "Provider";
  const customerName = data.applicantName || data.passengerName || "Customer";

  const legacyLocation = normalizeGeo(data.applicantLocation || data.passengerLocation);
  const pickupLocation: NormalizedApplication["pickupLocation"] = data.pickupLocation
    ? {
        latitude: typeof data.pickupLocation.latitude === "number" ? data.pickupLocation.latitude : null,
        longitude: typeof data.pickupLocation.longitude === "number" ? data.pickupLocation.longitude : null,
        address: data.pickupLocation.address || "",
        source: data.pickupLocation.source || "custom",
      }
    : legacyLocation
      ? { ...legacyLocation, source: "custom" }
      : null;

  const searchParts = [
    kind === "work" ? "work helper" : "errand",
    title,
    date,
    providerName,
    customerName,
    data.city,
    data.neighborhood,
    data.status,
  ];

  return {
    id,
    kind,
    category: data.category || categoryFor(kind),
    sourceId: data.jobId || data.errandId || "",
    providerId: data.employerId || data.driverId || "",
    providerName,
    customerId: data.applicantId || data.passengerId || "",
    customerName,
    customerAge: asNumber(data.applicantAge ?? data.passengerAge),
    customerPhone: data.applicantPhone || data.passengerPhone || "",
    city: data.city || "",
    cityLocationId: data.cityLocationId || "",
    neighborhood: data.neighborhood || "",
    notes: data.notes || "",
    location: legacyLocation,
    pickupLocation,
    title,
    date,
    startTime: data.startTime || "",
    endTime: data.endTime || "",
    hourlyPay: asNumber(data.hourlyPay),
    price: asNumber(data.price),
    seats: asNumber(data.seats),
    paymentMethod: data.paymentMethod || null,
    paymentStatus: data.paymentStatus || "unpaid",
    cardLast4: data.cardLast4 || null,
    status: (data.status || "pending") as FlowStatus,

    tripStatus: data.tripStatus || data.status || "pending",
    needsPassengerRating: data.needsPassengerRating === true,
    ratingSubmitted: data.ratingSubmitted === true,
    rating: asNumber(data.rating),
    reviewComment: data.reviewComment || "",
    ratedAtSeconds: data.ratedAt?.seconds || 0,
    completedAtSeconds: data.completedAt?.seconds || 0,

    workCompleted: data.workCompleted === true,
    driverPaymentStatus: data.driverPaymentStatus || "unpaid",
    paidAmount: asNumber(data.paidAmount),
    paidAtSeconds: data.paidAt?.seconds || 0,

    createdAtSeconds: data.createdAt?.seconds || 0,
    searchText: searchParts.filter(Boolean).join(" ").toLowerCase(),
  };
};

// ---------------------------------------------------------------------------
// Passenger age enrichment
//
// Pending Work/Errand requests show the requesting passenger's age instead
// of the price/wage, so the driver has what they need to decide before
// accepting — the price/wage fields themselves are left untouched in
// Firestore for the payment step later.
//
// Prefer the age already saved on the application (applicantAge/
// passengerAge, written at request time in createApplication above); fall
// back to a live users/{id} read only when it's missing — e.g. an older
// application created before this field existed, or the passenger's profile
// didn't have an age set yet at request time. Only ever reads/returns a
// plain calculated age number — never a birth date.
// ---------------------------------------------------------------------------

export const fetchUserAge = async (userId: string): Promise<number | null> => {
  if (!userId) return null;

  try {
    const snap = await getDoc(doc(db, "users", userId));
    if (!snap.exists()) return null;

    const data = snap.data();
    const rawAge = data.age ?? data.driverAge ?? data.userAge;
    const age = typeof rawAge === "number" ? rawAge : Number(rawAge);

    return Number.isFinite(age) ? age : null;
  } catch {
    return null;
  }
};

export const enrichApplicationWithCustomerAge = async (
  app: NormalizedApplication,
): Promise<NormalizedApplication> => {
  if (app.customerAge !== null || !app.customerId) return app;

  const age = await fetchUserAge(app.customerId);
  return age !== null ? { ...app, customerAge: age } : app;
};

// ---------------------------------------------------------------------------
// Step 5 – passenger rates the driver/service owner after Finish
//
// Same rating system as School / Personal Ride: a driverReviews doc plus a
// running ratingCount/ratingSum/ratingAverage on the driver's users doc,
// written in one transaction, and a ratingSubmitted guard so a rating can
// only ever be saved once even if this gets called twice.
// ---------------------------------------------------------------------------

export const submitApplicationRating = async (
  kind: WorkErrandKind,
  id: string,
  app: NormalizedApplication,
  rating: number,
  comment: string,
) => {
  const user = auth.currentUser;

  if (!user) {
    throw new Error(i18n.t("auth.pleaseLoginFirst"));
  }

  // providerId must be the driver's real Firebase UID — never the job
  // listing id or this application's own id (guards against a wiring bug
  // accidentally saving the wrong id as driverId on the review).
  if (
    !app.providerId ||
    app.providerId === id ||
    app.providerId === app.sourceId ||
    app.providerId === user.uid
  ) {
    throw new Error(i18n.t("workErrand.missingDriverId"));
  }

  const cleanRating = Math.round(rating);
  if (!Number.isInteger(cleanRating) || cleanRating < 1 || cleanRating > 5) {
    throw new Error(i18n.t("validation.invalidRating"));
  }

  const cleanComment = comment.trim();

  const appRef = doc(db, COLLECTION[kind], id);
  const driverRef = doc(db, "users", app.providerId);
  // bookingId AS the review doc id — see firestore.rules' driverReviews
  // `allow create`, which requires this to match and rejects a second
  // rating attempt for the same application outright.
  const reviewRef = doc(db, "driverReviews", id);

  const ratingWritePaths = {
    review: `driverReviews/${id}`,
    booking: `${COLLECTION[kind]}/${id}`,
    driver: `users/${app.providerId}`,
  };
  console.log("[rating] transaction started", ratingWritePaths);

  try {
    await runTransaction(db, async (transaction) => {
      const appSnap = await transaction.get(appRef);

      if (!appSnap.exists()) {
        throw new Error(i18n.t("rides.bookingNotFound"));
      }

      const appData: any = appSnap.data();

      // Never trust the already-loaded `app` object — re-verify ownership +
      // real completion against the current server state. "work" applications
      // use applicantId (never passengerId); "errand" applications use
      // passengerId — see the two payload shapes in requestWorkOrErrand above.
      const callerOwnsThis =
        appData.applicantId === user.uid || appData.passengerId === user.uid;

      if (!callerOwnsThis) {
        throw new Error(i18n.t("workErrand.mustBeLoggedIn"));
      }
      if (
        appData.tripStatus !== "completed" ||
        appData.status !== "completed"
      ) {
        throw new Error(i18n.t("booking.tripNotCompletedYet"));
      }
      if (appData.ratingSubmitted === true) {
        return;
      }

      const reviewSnap = await transaction.get(reviewRef);
      if (reviewSnap.exists()) {
        return;
      }

      const driverSnap = await transaction.get(driverRef);
      const driverData: any = driverSnap.exists() ? driverSnap.data() : {};

      const oldCount = Number(driverData.ratingCount) || 0;
      const oldSum = Number(driverData.ratingSum) || 0;

      const newCount = oldCount + 1;
      const newSum = oldSum + cleanRating;
      // Stored RAW (never toFixed()'d) — firestore.rules checks
      // ratingAverage == ratingSum / ratingCount for exact equality.
      const newAverage = newSum / newCount;

      transaction.set(reviewRef, {
        bookingId: id,
        routeId: app.sourceId || "",
        // Literal "work"/"errands" per the shared driverReviews schema — not
        // app.category, which stores the job-listing category ("workErrands").
        category: kind === "work" ? "work" : "errands",

        driverId: app.providerId,
        driverName: app.providerName || "Provider",

        passengerId: user.uid,
        passengerName: app.customerName || user.displayName || "Passenger",

        rating: cleanRating,
        comment: cleanComment,
        reviewComment: cleanComment,

        from: "",
        to: "",
        date: app.date || "",
        time: app.startTime || "",

        createdAt: serverTimestamp(),
      });

      transaction.update(appRef, {
        rating: cleanRating,
        reviewComment: cleanComment,
        ratingSubmitted: true,
        needsPassengerRating: false,
        ratedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      transaction.set(
        driverRef,
        {
          ratingCount: newCount,
          ratingSum: newSum,
          ratingAverage: newAverage,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    });

    console.log("[rating] transaction succeeded", { bookingId: id });
  } catch (error) {
    console.log("[rating] transaction failed", { ...ratingWritePaths, error });
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Status display metadata (labels) for cards
// ---------------------------------------------------------------------------

export const STATUS_LABEL: Record<FlowStatus, string> = {
  pending: "Pending",
  payment_pending_driver: "Waiting for employer payment",
  payment_pending_passenger: "Waiting for customer payment",
  accepted: "Accepted / Upcoming",
  on_the_way: "On the way",
  arrived: "Arrived",
  in_progress: "In progress",
  completed: "Completed",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

// Whether the booking is still awaiting its payment step.
export const isAwaitingPayment = (status: FlowStatus) =>
  status === "payment_pending_driver" || status === "payment_pending_passenger";
