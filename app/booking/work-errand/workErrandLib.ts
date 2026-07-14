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
  runTransaction,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { auth, db } from "../../../firebase";

export type WorkErrandKind = "work" | "errand";

// The status of an application as it moves through the flow. Work and errand
// use DIFFERENT payment-pending statuses so the wording never gets confused.
export type FlowStatus =
  | "pending"
  | "payment_pending_driver" // work: employer must pay to confirm
  | "payment_pending_passenger" // errand: customer must pay to confirm
  | "accepted"
  | "on_the_way"
  | "arrived"
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
    throw new Error(
      "Location permission is required so the driver can reach you.",
    );
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
};

export const notify = async (input: NotifyInput) => {
  if (!input.receiverId) return;

  const tab =
    input.targetTab || input.roleTarget || input.openBookingTab || null;

  try {
    await addDoc(collection(db, "notifications"), {
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
      read: false,
      readAt: null,
      deleted: false,
      createdAt: serverTimestamp(),
    });
  } catch {
    // Notifications are best-effort – never block the main action on them.
  }
};

// ---------------------------------------------------------------------------
// Step 1 – customer sends a request
// ---------------------------------------------------------------------------

// Details filled by the customer. Personal identity (name/age/phone) is taken
// automatically from their profile; only these are entered by hand.
export type CustomerDetails = {
  city: string;
  neighborhood: string;
  notes: string;
  location: GeoPoint;
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
  if (!me) throw new Error("You must be logged in to send a request.");

  if (source.providerId && source.providerId === me.id) {
    throw new Error("You cannot send a request to your own listing.");
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
          throw new Error("This work job is already full.");
        }
      }
    } catch (error: any) {
      if (error?.message === "This work job is already full.") {
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
    city: details.city,
    neighborhood: details.neighborhood,
    notes: details.notes || "",

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
    throw new Error("Missing job id.");
  }

  const appRef = doc(db, "workApplications", id);
  const jobRef = doc(db, "workJobs", data.sourceId);

  await runTransaction(db, async (transaction) => {
    const appSnap = await transaction.get(appRef);

    if (!appSnap.exists()) {
      throw new Error("Request not found.");
    }

    const appData: any = appSnap.data();

    // Idempotency guard — a double-tap (or an already-handled request)
    // must not decrement capacity twice.
    if (appData.status !== "pending") {
      throw new Error("This request was already handled.");
    }

    const jobSnap = await transaction.get(jobRef);

    if (!jobSnap.exists()) {
      throw new Error("This work job no longer exists.");
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
      throw new Error("This work job is already full.");
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
    // Work is paid AFTER completion, driver -> passenger. Finishing the job
    // never pays anyone by itself — it just opens the payment gate; the
    // driver still has to go through payCompletedWork below.
    payload.workCompleted = true;
    payload.driverPaymentStatus = "pending";
  }

  await updateDoc(doc(db, COLLECTION[kind], id), payload);

  await notify({
    receiverId: data.customerId,
    type: "completed",
    title: kind === "work" ? "Work completed" : "Errand completed",
    message: `"${data.title}" has been completed. Thank you!`,
    applicationId: id,
    kind,
    category: data.category,
    status: "completed",
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
    throw new Error("Please login first.");
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
      throw new Error("Booking not found.");
    }

    const data: any = snap.data();

    // Protect against duplicate payments.
    if (data.driverPaymentStatus === "paid") {
      throw new Error("This job has already been paid.");
    }

    if (data.employerId && data.employerId !== user.uid) {
      throw new Error("Only the employer who booked this job can pay.");
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
  "completed",
  "rejected",
  "cancelled",
];

// Returns a reason string when cancellation is NOT allowed, or null when it is.
export const cancelBlockedReason = (
  item: NormalizedApplication,
  now: Date = new Date(),
): string | null => {
  if (UNCANCELLABLE.includes(item.status)) {
    return "This booking can no longer be cancelled.";
  }

  const start = toDateTime(item.date, item.startTime);
  if (!start) return null; // No valid start time → allow cancel.

  const oneHourBefore = new Date(start.getTime() - 60 * 60 * 1000);

  if (now.getTime() >= oneHourBefore.getTime()) {
    return "You cannot cancel less than 1 hour before the start time.";
  }

  return null;
};

export const cancelApplication = async (
  kind: WorkErrandKind,
  id: string,
  data: NormalizedApplication,
  cancelledBy: "passenger" | "driver",
  reason?: string,
) => {
  const blocked = cancelBlockedReason(data);
  if (blocked) throw new Error(blocked);

  // Only an ACCEPTED work request ever took a place out of the job's
  // capacity — a still-pending one never touched remainingSeats, so
  // cancelling it needs no restore. Errand has no capacity concept at all.
  if (kind === "work" && data.status === "accepted" && data.sourceId) {
    await cancelAcceptedWorkRequest(id, data, cancelledBy, reason);
  } else {
    await updateDoc(doc(db, COLLECTION[kind], id), {
      status: "cancelled" as FlowStatus,
      cancelledAt: serverTimestamp(),
      cancelledBy,
      cancelReason: reason || null,
      updatedAt: serverTimestamp(),
    });
  }

  // Notify the other side.
  const otherId = cancelledBy === "passenger" ? data.providerId : data.customerId;
  await notify({
    receiverId: otherId,
    type: "cancelled",
    title: "Booking cancelled",
    message: `The ${cancelledBy} cancelled "${data.title}".`,
    applicationId: id,
    kind,
    category: data.category,
    status: "cancelled",
  });
};

// ---------------------------------------------------------------------------
// Work only — cancelling an already-accepted request must give the place
// back to the job (remainingSeats +1, capped at totalSeats so it can never
// overflow) and re-open the job if it had just become full. Wrapped in a
// transaction for the same overbooking-safety reason as acceptWorkRequest.
// ---------------------------------------------------------------------------

const cancelAcceptedWorkRequest = async (
  id: string,
  data: NormalizedApplication,
  cancelledBy: "passenger" | "driver",
  reason?: string,
) => {
  const appRef = doc(db, "workApplications", id);
  const jobRef = doc(db, "workJobs", data.sourceId);

  await runTransaction(db, async (transaction) => {
    const appSnap = await transaction.get(appRef);

    if (!appSnap.exists()) {
      throw new Error("Request not found.");
    }

    const appData: any = appSnap.data();

    if (appData.status !== "accepted") {
      // Already moved on (finished/cancelled/etc. by another action) —
      // nothing to restore, just record the cancellation.
      transaction.update(appRef, {
        status: "cancelled" as FlowStatus,
        cancelledAt: serverTimestamp(),
        cancelledBy,
        cancelReason: reason || null,
        updatedAt: serverTimestamp(),
      });
      return;
    }

    const jobSnap = await transaction.get(jobRef);

    if (jobSnap.exists()) {
      const jobData: any = jobSnap.data();

      const totalSeats = Number(
        jobData.totalSeats ?? jobData.seats ?? jobData.workersNeeded ?? 1,
      );

      const currentRemaining =
        typeof jobData.remainingSeats === "number" ? jobData.remainingSeats : 0;

      const requestedSeats = Math.max(
        1,
        Number(appData.requestedSeats || appData.seats || 1),
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
    }

    transaction.update(appRef, {
      status: "cancelled" as FlowStatus,
      cancelledAt: serverTimestamp(),
      cancelledBy,
      cancelReason: reason || null,
      updatedAt: serverTimestamp(),
    });
  });
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
  neighborhood: string;
  notes: string;
  location: GeoPoint | null;
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
    neighborhood: data.neighborhood || "",
    notes: data.notes || "",
    location: normalizeGeo(data.applicantLocation || data.passengerLocation),
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
    throw new Error("Please login first.");
  }

  // providerId must be the driver's real Firebase UID — never the job
  // listing id or this application's own id (guards against a wiring bug
  // accidentally saving the wrong id as driverId on the review).
  if (!app.providerId || app.providerId === id || app.providerId === app.sourceId) {
    throw new Error("Missing driver id.");
  }

  const cleanComment = comment.trim();

  const appRef = doc(db, COLLECTION[kind], id);
  const driverRef = doc(db, "users", app.providerId);
  const reviewRef = doc(collection(db, "driverReviews"));

  await runTransaction(db, async (transaction) => {
    const appSnap = await transaction.get(appRef);

    if (!appSnap.exists()) {
      throw new Error("Booking not found.");
    }

    const appData: any = appSnap.data();

    if (appData.ratingSubmitted === true) {
      return;
    }

    const driverSnap = await transaction.get(driverRef);
    const driverData: any = driverSnap.exists() ? driverSnap.data() : {};

    const oldCount = Number(driverData.ratingCount) || 0;
    const oldSum =
      Number(driverData.ratingSum) ||
      Number(driverData.ratingAverage || 0) * oldCount;

    const newCount = oldCount + 1;
    const newSum = oldSum + rating;
    const newAverage = Number((newSum / newCount).toFixed(2));

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

      rating,
      comment: cleanComment,
      reviewComment: cleanComment,

      from: "",
      to: "",
      date: app.date || "",
      time: app.startTime || "",

      createdAt: serverTimestamp(),
    });

    transaction.update(appRef, {
      rating,
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
  completed: "Completed",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

// Whether the booking is still awaiting its payment step.
export const isAwaitingPayment = (status: FlowStatus) =>
  status === "payment_pending_driver" ||
  status === "payment_pending_passenger";
