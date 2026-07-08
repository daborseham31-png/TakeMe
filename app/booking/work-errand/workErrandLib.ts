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
      read: false,
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

  // Notify the provider that a new request arrived.
  if (source.providerId) {
    await notify({
      receiverId: source.providerId,
      senderId: me.id,
      type: "request_received",
      title: kind === "work" ? "New work request" : "New errand request",
      message: `${me.name} sent you a request for "${source.title}".`,
      applicationId: ref.id,
      kind,
      category: categoryFor(kind),
      status: "pending",
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
  const nextStatus = paymentPendingStatus(kind);

  await updateDoc(doc(db, COLLECTION[kind], id), {
    status: nextStatus,
    driverAcceptedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await notify({
    receiverId: data.customerId,
    type: "request_accepted",
    title: "Request accepted",
    message:
      kind === "work"
        ? "The employer accepted your work request. It will be confirmed after they complete payment."
        : "Driver accepted your errand request. Please continue to payment.",
    applicationId: id,
    kind,
    category: data.category,
    status: nextStatus,
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
  | { method: "card"; cardLast4: string };

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
  await updateDoc(doc(db, COLLECTION[kind], id), {
    status: "completed" as FlowStatus,
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

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

  await updateDoc(doc(db, COLLECTION[kind], id), {
    status: "cancelled" as FlowStatus,
    cancelledAt: serverTimestamp(),
    cancelledBy,
    cancelReason: reason || null,
    updatedAt: serverTimestamp(),
  });

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
    createdAtSeconds: data.createdAt?.seconds || 0,
    searchText: searchParts.filter(Boolean).join(" ").toLowerCase(),
  };
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
