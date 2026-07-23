// ---------------------------------------------------------------------------
// My Bookings – shared Firestore helpers + normalizers
//
// Collections used:
//   - bookings     (passenger bookings, one per "Book This Driver")
//   - driverRoutes (driver: school / personal)               keyed by driverId
//   - workJobs     (driver: work helper jobs)                keyed by employerId
//   - errandJobs   (driver: errands)                         keyed by ownerId
//
// Trips never complete automatically – status only changes when the user taps
// "Mark as Completed" (markCompleted below).
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

import { auth, db } from "../../firebase";
import i18n from "../i18n";
import { notify } from "./work-errand/workErrandLib";

type IconName = keyof typeof Ionicons.glyphMap;

// Driver-created trips live in these three collections.
export type DriverCollection = "driverRoutes" | "workJobs" | "errandJobs";

// ---------------------------------------------------------------------------
// Live Tracking types
// ---------------------------------------------------------------------------

export type TripTrackingStatus =
  | "booked"
  | "driver_on_way"
  | "arrived_pickup"
  | "in_progress"
  | "completed";

export type LatLng = {
  latitude: number;
  longitude: number;
};

export type DriverLiveLocation = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
};

// Live tracking is active from the moment the driver arrives for pickup
// until Finish Trip (there is no separate "Start Trip" step anymore).
export const ACTIVE_TRACKING_STATUSES: TripTrackingStatus[] = [
  "arrived_pickup",
  "in_progress",
];

export const shouldShowLiveTracking = (
  tripStatus?: TripTrackingStatus,
  trackingEnabled?: boolean,
) => {
  return !!trackingEnabled && ACTIVE_TRACKING_STATUSES.includes(
    tripStatus || "booked",
  );
};

// ---------------------------------------------------------------------------
// Category display metadata
// ---------------------------------------------------------------------------

export const CATEGORY_META: Record<
  string,
  { label: string; icon: IconName; color: string }
> = {
  school: { label: "School", icon: "school-outline", color: "#3B82F6" },
  personal: { label: "Personal Ride", icon: "person-outline", color: "#EC4899" },
  personal_ride: {
    label: "Personal Ride",
    icon: "person-outline",
    color: "#EC4899",
  },
  errands: { label: "Errand", icon: "location-outline", color: "#F58220" },
  workErrands: {
    label: "Work Helper",
    icon: "briefcase-outline",
    color: "#22C55E",
  },
  roadside: {
    label: "Roadside",
    icon: "construct-outline",
    color: "#EF4444",
  },
};

export const getCategoryMeta = (category?: string) =>
  CATEGORY_META[category || ""] || {
    label: category || "Trip",
    icon: "car-outline" as IconName,
    color: "#7C5F46",
  };

// ---------------------------------------------------------------------------
// Start Trip date gate
//
// A trip (single-day or one weekly day) can only be started on its own trip
// date — never early, never late. Every weekly day is its own booking
// document with its own date, so these always read *that specific* booking
// object's own fields — never anything derived from a wider weekly group.
//
// Booking documents come from a few different creation paths (quick vs.
// weekly, school vs. personal_ride) that don't all use the exact same field
// names, so the date/status readers below fall back across every field
// name actually used anywhere in the app instead of assuming one.
// ---------------------------------------------------------------------------

export const getTodayYMD = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

export const getBookingDateYMD = (booking: any): string => {
  return String(
    booking?.date ||
      booking?.tripDate ||
      booking?.selectedDate ||
      booking?.dayDate ||
      booking?.rideDate ||
      "",
  );
};

export const getBookingTime = (booking: any): string => {
  return String(
    booking?.time ||
      booking?.tripTime ||
      booking?.selectedTime ||
      booking?.rideTime ||
      "00:00",
  );
};

export type TripDateState = "missing" | "today" | "future" | "past";

// Compares "YYYY-MM-DD" strings directly against a local-time "today"
// (never `new Date(dateString)`/UTC) so this can't drift a day off because
// of timezone offsets.
export const getTripDateState = (booking: any): TripDateState => {
  const today = getTodayYMD();
  const date = getBookingDateYMD(booking);

  if (!date) return "missing";
  if (date === today) return "today";
  if (date > today) return "future";
  return "past";
};

const ACTIVE_TRIP_STATUSES = [
  "on_the_way",
  "driver_on_way",
  "arrived",
  "arrived_pickup",
  "in_progress",
];

// RideBooking uses `status`, BookingItem uses `tripStatus` (plus a
// backwards-compatible `status`) — read whichever is present so every
// booking shape is handled the same way.
export const getBookingTripStatus = (booking: any): string =>
  String(booking?.tripStatus || booking?.status || "");

export const isTripStatusCompleted = (booking: any) =>
  getBookingTripStatus(booking) === "completed";

export const isTripStatusActive = (booking: any) =>
  ACTIVE_TRIP_STATUSES.includes(getBookingTripStatus(booking));

export const canStartTrip = (booking: any): boolean => {
  return (
    getBookingTripStatus(booking) === "booked" &&
    getTripDateState(booking) === "today"
  );
};

// null when the trip can be started right now; otherwise the exact message
// to show under the disabled Start Trip button.
export const getStartTripBlockedReason = (booking: any): string | null => {
  if (canStartTrip(booking)) return null;

  switch (getTripDateState(booking)) {
    case "future":
      return i18n.t("booking.startTripOnlyOnTripDate");
    case "past":
      return i18n.t("booking.tripDatePassed");
    case "missing":
      return i18n.t("booking.tripDateUnavailable");
    default:
      return null;
  }
};

// ---------------------------------------------------------------------------
// Shared "can this still be cancelled?" time gate, generalized for any
// booking shape whose date/time getBookingDateYMD/getBookingTime can read.
// Callers still layer their own status check on top of this (this function
// only ever looks at date/time, never status).
//
// Two standard windows, matching the passenger/driver wording split used
// everywhere a booking has both sides ("Cancel Booking" vs "Cancel Trip"):
//   - PASSENGER_CANCEL_LOCK_HOURS (2h) — the passenger cancelling their own
//     seat/booking (RideBooking, general bookings, school bookings, work/
//     errand applications).
//   - DRIVER_CANCEL_LOCK_HOURS (5h) — the driver cancelling a trip THEY
//     posted (personal/school-legacy driverRoutes listings, schoolTrips) —
//     a stricter window since cancelling here can affect passengers already
//     booked onto it, not just the driver's own plan.
// ---------------------------------------------------------------------------

export const PASSENGER_CANCEL_LOCK_HOURS = 2;
export const DRIVER_CANCEL_LOCK_HOURS = 5;

export const getTimeBasedCancelBlockedReason = (
  booking: any,
  hoursBeforeDeparture: number = PASSENGER_CANCEL_LOCK_HOURS,
  now: Date = new Date(),
): string | null => {
  const date = getBookingDateYMD(booking);
  const time = getBookingTime(booking);
  if (!date) return null;

  const start = new Date(`${date}T${time || "00:00"}:00`);
  if (Number.isNaN(start.getTime())) return null;

  const lockAt = new Date(
    start.getTime() - hoursBeforeDeparture * 60 * 60 * 1000,
  );

  if (now.getTime() < lockAt.getTime()) return null;

  return hoursBeforeDeparture >= DRIVER_CANCEL_LOCK_HOURS
    ? i18n.t("booking.cannotCancelTripWithinFiveHours")
    : i18n.t("schoolTrip.cannotCancelWithinTwoHours");
};

// ---------------------------------------------------------------------------
// My Bookings sort order
//
// ONE combined chronological order across every category (School, Personal,
// Work, Errand, Roadside, ...) — category/collection/creation time must
// never affect placement, only the real trip date+time and completion:
//   1. Every non-completed booking first, nearest date+time first.
//   2. Every completed booking below all of those, newest completed first.
// Sorting only — the underlying Firestore documents/arrays are never mutated.
// ---------------------------------------------------------------------------

export const isCompletedItem = (item: any): boolean => {
  const status = String(item?.status || "").toLowerCase();
  const tripStatus = String(item?.tripStatus || "").toLowerCase();

  return (
    status === "completed" ||
    status === "cancelled" ||
    tripStatus === "completed" ||
    item?.completed === true
  );
};

export const getTripTimestamp = (item: any): number => {
  const date = getBookingDateYMD(item);
  const time = getBookingTime(item);

  if (!date) return Number.MAX_SAFE_INTEGER;

  const timestamp = new Date(`${date}T${time || "00:00"}:00`).getTime();

  return Number.isNaN(timestamp) ? Number.MAX_SAFE_INTEGER : timestamp;
};

export const sortMyBookings = <T,>(items: T[]): T[] => {
  return [...items].sort((a, b) => {
    const aCompleted = isCompletedItem(a);
    const bCompleted = isCompletedItem(b);

    // Non-completed always first.
    if (aCompleted !== bCompleted) {
      return aCompleted ? 1 : -1;
    }

    const aTime = getTripTimestamp(a);
    const bTime = getTripTimestamp(b);

    // Upcoming/active: earliest first.
    if (!aCompleted && !bCompleted) {
      return aTime - bTime;
    }

    // Completed: newest first, but still at the bottom.
    return bTime - aTime;
  });
};

// ---------------------------------------------------------------------------
// My Bookings status bucket (Upcoming / In Progress / Completed / Unbooked
// Trips)
//
// BookingBucket is the one shared tab-name type both classifiers below
// return — but Driver and Passenger deliberately have TWO SEPARATE
// classifier functions, not one shared one, because "In Progress" means
// something different for each role:
//   - Passenger: getPassengerTripStatus/getPassengerTripBucket, just below.
//     The service already feels "active" to a passenger the moment the
//     driver is on the way — Driver on the way / Driver arrived / actually
//     in progress all read as one continuous "In Progress" phase.
//   - Driver: getDriverTripStatus/getDriverTripBucket, further down this
//     file. In Progress means the passenger trip has ACTUALLY started
//     (tripStatus literally "in_progress") — "on the way"/"arrived" stay in
//     Upcoming, and driver-published listings can additionally be
//     "unbooked" (Unbooked Trips), a bucket passenger never has at all.
// Never call the Driver classifier for a passenger row or vice versa.
// ---------------------------------------------------------------------------

export type BookingBucket = "upcoming" | "inProgress" | "completed" | "unbookedTrips";

// Still used by the Driver "waiting" checks further down this file, and by
// useMySchoolRows.tsx to pick a group's most-advanced leg — kept as the one
// shared vocabulary list for "the driver has done something beyond just
// booking," independent of which classifier is asking.
export const IN_PROGRESS_TRIP_STATUSES = [
  "on_the_way",
  "driver_on_way",
  "arrived",
  "arrived_pickup",
  "in_progress",
];

const ON_THE_WAY_VALUES = ["on_the_way", "driver_on_way"];
const ARRIVED_VALUES = ["arrived", "arrived_pickup"];

// ---------------------------------------------------------------------------
// PASSENGER — Upcoming / In Progress / Completed (never Unbooked Trips: a
// passenger row is always a real booking by construction — "ride",
// "application", "booking" (personal/school-legacy/roadside), and
// the school hook's "schoolGroup"/"schoolWaiting" rows, covering School
// Outbound and Return, Personal Ride, Work Helper, and
// Errands identically).
// ---------------------------------------------------------------------------

export type PassengerTripStatus =
  | "booked"
  | "driverOnWay"
  | "driverArrived"
  | "inProgress"
  | "completed"
  | "cancelled";

export const getPassengerTripStatus = (row: any): PassengerTripStatus => {
  if (row._kind === "ride") {
    // RideBooking's lifecycle lives on `.status` (booked/on_the_way/
    // arrived/completed/cancelled) — startRide/arriveRide/finishRide in
    // rideBookingLib.ts always write `.status` and `.tripStatus` together,
    // so `.status` alone is authoritative here.
    if (row.status === "completed") return "completed";
    if (row.status === "cancelled") return "cancelled";
    if (ARRIVED_VALUES.includes(String(row.status))) return "driverArrived";
    if (ON_THE_WAY_VALUES.includes(String(row.status))) return "driverOnWay";
    return "booked";
  }

  if (row._kind === "application") {
    if (row.status === "completed") return "completed";
    if (row.status === "rejected" || row.status === "cancelled") return "cancelled";
    if (String(row.status) === "in_progress") return "inProgress";
    if (ARRIVED_VALUES.includes(String(row.status))) return "driverArrived";
    if (ON_THE_WAY_VALUES.includes(String(row.status))) return "driverOnWay";
    return "booked";
  }

  // "booking" (personal/school-legacy/roadside), "schoolGroup",
  // "schoolWaiting" — status is the coarse booked/completed/cancelled field,
  // tripStatus (when present) is the finer-grained live-tracking field.
  if (row.status === "completed") return "completed";
  if (row.status === "cancelled") return "cancelled";

  const tripStatus = String(row.tripStatus ?? "");
  if (tripStatus === "completed") return "completed";
  if (tripStatus === "in_progress") return "inProgress";
  if (ARRIVED_VALUES.includes(tripStatus)) return "driverArrived";
  if (ON_THE_WAY_VALUES.includes(tripStatus)) return "driverOnWay";
  return "booked";
};

export const isCancelledPassengerStatus = (status: PassengerTripStatus) => status === "cancelled";

export const getPassengerTripBucket = (row: any): BookingBucket => {
  switch (getPassengerTripStatus(row)) {
    case "booked":
      return "upcoming";
    case "driverOnWay":
    case "driverArrived":
    case "inProgress":
      return "inProgress";
    default:
      // "completed" and "cancelled" both bucket as Completed — the UI
      // (bookings.tsx) renders cancelled rows in their own clearly
      // separated section within that tab and excludes them from the
      // Completed count, never as a new main tab (mirrors the Driver
      // Completed/Cancelled split already built for getDriverTripBucket).
      return "completed";
  }
};

// ---------------------------------------------------------------------------
// Driver My Bookings — ONE canonical trip-status model, used for BOTH the
// top-right status badge and bucket placement, so the two can never
// disagree. Deliberately separate from getPassengerTripStatus/
// getPassengerTripBucket above (never call one classifier for the other
// role's rows) — driver needs two distinctions passenger doesn't:
//   1. "Waiting for booking" (future, zero bookings) vs "Expired — No
//      bookings" (departure has passed, zero bookings) — both still land in
//      Unbooked Trips, but show a different badge.
//   2. A STRICT "In Progress" meaning the passenger trip itself has actually
//      started (tripStatus/status === "in_progress") — not merely that the
//      driver is en route to or has arrived at pickup. Per the real
//      ride-navigation flow (see app/driver/ride-navigation.tsx), Personal
//      Ride/Work Helper/Errands never even reach "in_progress" —
//      they go booked → (on the way →) (arrived →) completed directly, so
//      those categories simply never populate the In Progress tab, which is
//      correct (not a gap to paper over), never route/date-passed alone.
// Applied identically to every category — School is not a special case.
// ---------------------------------------------------------------------------

export type DriverTripStatus =
  | "waitingForBooking"
  | "expiredNoBookings"
  | "booked"
  | "driverOnWay"
  | "driverArrived"
  | "inProgress"
  | "completed"
  | "cancelled";

const DRIVER_ON_THE_WAY_VALUES = ["on_the_way", "driver_on_way"];
const DRIVER_ARRIVED_VALUES = ["arrived", "arrived_pickup"];

export const getDriverTripStatus = (row: any): DriverTripStatus => {
  // Only a published trip LISTING ("trip": driverRoutes/workJobs/errandJobs,
  // "schoolTrip": SchoolTrip) can ever be "waiting"/"expired" — every other
  // kind is, by construction, always a real booking. row.waitingForBooking
  // is computed once (tagTrip in bookings.tsx / useMySchoolRows.tsx) from
  // real active passenger booking/application documents — never seats,
  // labels, or the published trip document alone — and already excludes
  // completed/cancelled trips internally.
  if ((row._kind === "trip" || row._kind === "schoolTrip") && row.waitingForBooking === true) {
    return getTripTimestamp(row) < Date.now() ? "expiredNoBookings" : "waitingForBooking";
  }

  if (row.status === "cancelled") return "cancelled";
  if (row._kind === "application" && row.status === "rejected") return "cancelled";
  if (row.status === "completed") return "completed";

  // RideBooking's coarse `.status` (booked/on_the_way/arrived/completed/
  // cancelled) has no "in_progress" value of its own — updateTripStatus in
  // ride-navigation.tsx deliberately leaves `.status` at "arrived" and only
  // ever advances `.tripStatus` to "in_progress" — so that one case must be
  // checked there first. Every other kind mirrors its whole lifecycle on
  // `.tripStatus` alone.
  if (row._kind === "ride" && String(row.tripStatus) === "in_progress") {
    return "inProgress";
  }

  const liveStatus = row._kind === "ride" ? String(row.status) : String(row.tripStatus ?? "");

  if (liveStatus === "completed") return "completed";
  if (liveStatus === "in_progress") return "inProgress";
  if (DRIVER_ARRIVED_VALUES.includes(liveStatus)) return "driverArrived";
  if (DRIVER_ON_THE_WAY_VALUES.includes(liveStatus)) return "driverOnWay";
  return "booked";
};

export const isCancelledDriverStatus = (status: DriverTripStatus) => status === "cancelled";

export const getDriverTripBucket = (row: any): BookingBucket => {
  switch (getDriverTripStatus(row)) {
    case "waitingForBooking":
    case "expiredNoBookings":
      return "unbookedTrips";
    case "booked":
    case "driverOnWay":
    case "driverArrived":
      return "upcoming";
    case "inProgress":
      return "inProgress";
    default:
      // "completed" and "cancelled" both bucket as Completed — the UI
      // (bookings.tsx) renders cancelled rows in their own clearly
      // separated section within that tab and excludes them from the
      // Completed count, rather than adding a new main tab.
      return "completed";
  }
};

// ---------------------------------------------------------------------------
// Current user info
// ---------------------------------------------------------------------------

export type UserInfo = { id: string; name: string; phone: string };

export const getCurrentUserInfo = async (): Promise<UserInfo | null> => {
  const user = auth.currentUser;
  if (!user) return null;

  let name = user.displayName || "You";
  let phone = "";

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      const data = snap.data();
      name = data.name || name;
      phone = data.phone || "";
    }
  } catch {
    // Fall back to the auth profile values.
  }

  return { id: user.uid, name, phone };
};

// ---------------------------------------------------------------------------
// Passenger: create a booking (called from "Book This Driver")
// ---------------------------------------------------------------------------

export type CreateBookingInput = {
  driverId?: string;
  driverName?: string;
  routeId?: string;
  category?: string;
  from?: string;
  to?: string;
  date?: string;
  time?: string;
  days?: string[];
  seats?: number | null;
  price?: number | null;

  // جديد للـ live tracking
  pickupCoords?: LatLng | null;
  schoolCoords?: LatLng | null;

  // Rating fields
  needsPassengerRating?: boolean;
  ratingSubmitted?: boolean;
  rating?: number | null;
  reviewComment?: string;
};

export const createPassengerBooking = async (input: CreateBookingInput) => {
  const me = await getCurrentUserInfo();
  if (!me) throw new Error(i18n.t("validation.mustBeLoggedInToBook"));

  await addDoc(collection(db, "bookings"), {
    passengerId: me.id,
    passengerName: me.name,
    passengerPhone: me.phone,

    driverId: input.driverId || null,
    driverName: input.driverName || "Driver",

    routeId: input.routeId || null,
    category: input.category || "",

    from: input.from || "",
    to: input.to || "",
    date: input.date || "",
    time: input.time || "",
    days: input.days || [],
    seats: input.seats ?? null,
    price: input.price ?? null,

    // القديم عشان ما نخرب My Bookings
    status: "ongoing",
    roleType: "passenger_booking",

    // الجديد للـ live tracking
    tripStatus: "booked",
    trackingEnabled: false,
    driverLocation: null,
    driverLocationUpdatedAt: null,

    pickupCoords: input.pickupCoords || null,
    schoolCoords: input.schoolCoords || null,

    driverOnWayAt: null,
    arrivedPickupAt: null,
    tripStartedAt: null,

    // التقييم ما يطلع بعد الحجز. يطلع فقط بعد End Trip من السائق.
    needsPassengerRating: false,
    ratingSubmitted: false,
    rating: null,
    reviewComment: "",
    ratedAt: null,
    finishedByDriver: false,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    completedAt: null,
  });
};

// ---------------------------------------------------------------------------
// Live Tracking: update booking status
// يستعملها السائق من صفحة Driver Bookings
// ---------------------------------------------------------------------------

export const updatePassengerBookingTripStatus = async (
  bookingId: string,
  tripStatus: TripTrackingStatus,
) => {
  const bookingRef = doc(db, "bookings", bookingId);

  // Guard the Start Trip transition here too, so this can't be used to
  // bypass the trip-date check even if called directly instead of through
  // the UI.
  if (tripStatus === "driver_on_way") {
    const snap = await getDoc(bookingRef);
    const data: any = snap.exists() ? snap.data() : {};

    if (!canStartTrip(data)) {
      throw new Error(
        getStartTripBlockedReason(data) ||
          i18n.t("booking.startTripOnlyOnTripDate"),
      );
    }
  }

  const payload: any = {
    tripStatus,
    updatedAt: serverTimestamp(),
  };

  if (tripStatus === "booked") {
    payload.status = "ongoing";
    payload.trackingEnabled = false;
    payload.needsPassengerRating = false;
  }

  if (tripStatus === "driver_on_way") {
    payload.status = "ongoing";
    payload.trackingEnabled = false;
    payload.needsPassengerRating = false;
    payload.driverOnWayAt = serverTimestamp();
  }

  if (tripStatus === "arrived_pickup") {
    payload.status = "arrived";
    payload.trackingEnabled = true;
    payload.needsPassengerRating = false;
    payload.arrivedPickupAt = serverTimestamp();
  }

  if (tripStatus === "in_progress") {
    payload.status = "ongoing";
    payload.trackingEnabled = true;
    payload.needsPassengerRating = false;
    payload.tripStartedAt = serverTimestamp();
  }

  if (tripStatus === "completed") {
    payload.status = "completed";
    payload.tripStatus = "completed";
    payload.trackingEnabled = false;
    payload.completedAt = serverTimestamp();
    payload.finishedByDriver = true;

    // بس بعد انتهاء الرحلة يظهر التقييم عند المسافر
    payload.needsPassengerRating = true;
    payload.ratingSubmitted = false;
    payload.rating = null;
    payload.reviewComment = "";
  }

  await updateDoc(bookingRef, payload);
};

// ---------------------------------------------------------------------------
// Live Tracking: update driver's live location
// يستعملها السائق كل كم ثانية وهو بالرحلة
// ---------------------------------------------------------------------------

export const updatePassengerBookingDriverLocation = async (
  bookingId: string,
  location: DriverLiveLocation,
) => {
  await updateDoc(doc(db, "bookings", bookingId), {
    driverLocation: {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy ?? null,
      heading: location.heading ?? null,
      speed: location.speed ?? null,
    },
    driverLocationUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

// ---------------------------------------------------------------------------
// Mark a trip / booking as completed (manual only)
// ---------------------------------------------------------------------------

// collectionName is either "bookings" (a specific passenger's booking doc —
// same rating gate as finishRide/updateTripStatus/finishJob/
// finishRoadsideHelp) or one of the driver-owned listing collections
// (driverRoutes/workJobs/errandJobs — no single passenger to rate, so those
// keep the old needsPassengerRating:false/no-notification behavior).
export const markCompleted = async (
  collectionName: string,
  id: string,
) => {
  let passengerId: string | null = null;
  let category = "";

  if (collectionName === "bookings") {
    const snap = await getDoc(doc(db, collectionName, id));
    const data: any = snap.exists() ? snap.data() : {};
    passengerId = data.passengerId || null;
    category = data.category || "";
  }

  const payload: any = {
    status: "completed",
    tripStatus: "completed",
    trackingEnabled: false,
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    needsPassengerRating: !!passengerId,
    ratingSubmitted: false,
  };

  await updateDoc(doc(db, collectionName, id), payload);

  if (passengerId) {
    await notify({
      receiverId: passengerId,
      type: "ride_trip_completed",
      title: "Trip completed",
      message: "Your trip is completed. Please rate your driver.",
      bookingId: id,
      category,
      status: "completed",
      targetTab: "passenger",
    });
  }
};

// ---------------------------------------------------------------------------
// After a rating is successfully submitted, silence the notification that
// prompted it so tapping it again can never reopen the modal (spec item 5) —
// query by bookingId + receiver (never all of a user's notifications), then
// only touch the ones whose type is actually a rating request so an
// unrelated on_the_way/arrived notification for the same booking is left
// alone. Soft-deleted (`deleted: true`) — same convention as
// notifications.tsx's own deleteOne/clearAll, never a hard delete.
// ---------------------------------------------------------------------------

export const RATING_NOTIFICATION_TYPES = new Set([
  "ride_trip_completed",
  "completed",
  "roadside_rating_required",
]);

export const dismissRatingNotifications = async (bookingId: string) => {
  const uid = auth.currentUser?.uid;
  if (!uid || !bookingId) return;

  try {
    const snap = await getDocs(
      query(
        collection(db, "notifications"),
        where("bookingId", "==", bookingId),
        where("receiverId", "==", uid),
      ),
    );

    const toDismiss = snap.docs.filter((d) =>
      RATING_NOTIFICATION_TYPES.has(d.data().type),
    );

    if (toDismiss.length === 0) return;

    const batch = writeBatch(db);
    toDismiss.forEach((d) => batch.update(d.ref, { deleted: true }));
    await batch.commit();
  } catch {
    // Best-effort — the rating itself already succeeded; a stray
    // still-tappable notification is not worth failing the flow over.
  }
};

// ---------------------------------------------------------------------------
// Normalizers -> display-ready items with a searchText for filtering
// ---------------------------------------------------------------------------

const asNumber = (value: any): number | null =>
  typeof value === "number" ? value : null;

export const buildSearchText = (parts: (string | undefined | null)[]) =>
  parts.filter(Boolean).join(" ").toLowerCase();

const normalizeTripStatus = (value: any): TripTrackingStatus => {
  if (
    value === "booked" ||
    value === "driver_on_way" ||
    value === "arrived_pickup" ||
    value === "in_progress" ||
    value === "completed"
  ) {
    return value;
  }

  if (value === "completed") return "completed";

  return "booked";
};

const normalizeLatLng = (value: any): LatLng | null => {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
};

export type BookingItem = {
  id: string;
  category: string;
  from: string;
  to: string;
  date: string;
  time: string;
  days: string[];
  driverName: string;
  driverId: string;
  routeId: string;
  price: number | null;
  seats: number | null;

  // Weekly booking grouping (present only on bookings created via the
  // weekly flow; see weeklyBookingLib.ts).
  bookingGroupId: string;
  bookingType: string;
  dayKey: string;
  dayName: string;

  // القديم يبقى عشان الشاشات الحالية
  status: "ongoing" | "completed" | "cancelled";

  // الجديد للـ live tracking
  tripStatus: TripTrackingStatus;
  trackingEnabled: boolean;
  driverLocation: DriverLiveLocation | null;
  pickupCoords: LatLng | null;
  schoolCoords: LatLng | null;
  driverLocationUpdatedAtSeconds: number;

  // Rating fields for school/general bookings
  needsPassengerRating: boolean;
  ratingSubmitted: boolean;
  rating: number | null;
  reviewComment: string;
  ratedAtSeconds: number;
  finishedByDriver: boolean;

  createdAtSeconds: number;
  // 0 until the trip/job is actually finished and completedAt is stamped —
  // the rating gate requires this to be > 0, never just a status string.
  completedAtSeconds: number;
  searchText: string;

  // Roadside-only extras (category === "roadside").
  problemTypes: string[];
  description: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  etaMinutes: number | null;
  passengerId: string;
  passengerName: string;
  passengerPhone: string;
  driverPhone: string;
  requestId: string;
  offerId: string;
  // "not_due" | "pending" | "paid" — see roadsideLib.ts.
  paymentStatus: string;
  helpCompleted: boolean;
};

export const normalizeBooking = (id: string, data: any): BookingItem => {
  const tripStatus = normalizeTripStatus(data.tripStatus || data.status);

  const status =
    data.status === "cancelled"
      ? "cancelled"
      : data.status === "completed" || tripStatus === "completed"
        ? "completed"
        : "ongoing";

  const days: string[] = Array.isArray(data.days) ? data.days : [];
  const problemTypes: string[] = Array.isArray(data.problemTypes)
    ? data.problemTypes
    : [];
  const address = data.address || data.location?.address || "";
  const meta = getCategoryMeta(data.category);

  const rawDriverLocation = normalizeLatLng(data.driverLocation);

  const driverLocation: DriverLiveLocation | null = rawDriverLocation
    ? {
        latitude: rawDriverLocation.latitude,
        longitude: rawDriverLocation.longitude,
        accuracy: data.driverLocation?.accuracy ?? null,
        heading: data.driverLocation?.heading ?? null,
        speed: data.driverLocation?.speed ?? null,
      }
    : null;

  return {
    id,
    category: data.category || "",
    from: data.from || "",
    to: data.to || "",
    date: data.date || "",
    time: data.time || "",
    days,
    driverName: data.driverName || "Driver",
    driverId: data.driverId || "",
    routeId: data.routeId || "",
    price: asNumber(data.price),
    seats: asNumber(data.seats),
    status,

    bookingGroupId: data.bookingGroupId || "",
    bookingType: data.bookingType || "",
    dayKey: data.dayKey || "",
    dayName: data.dayName || "",

    tripStatus,
    trackingEnabled: !!data.trackingEnabled,
    driverLocation,
    pickupCoords: normalizeLatLng(data.pickupCoords),
    schoolCoords: normalizeLatLng(data.schoolCoords),
    driverLocationUpdatedAtSeconds:
      data.driverLocationUpdatedAt?.seconds || 0,

    needsPassengerRating: data.needsPassengerRating === true,
    ratingSubmitted: data.ratingSubmitted === true,
    rating: typeof data.rating === "number" ? data.rating : null,
    reviewComment: data.reviewComment || "",
    ratedAtSeconds: data.ratedAt?.seconds || 0,
    finishedByDriver: data.finishedByDriver === true,

    createdAtSeconds: data.createdAt?.seconds || 0,
    completedAtSeconds: data.completedAt?.seconds || 0,
    problemTypes,
    description: data.description || "",
    address,
    latitude:
      typeof data.latitude === "number"
        ? data.latitude
        : typeof data.location?.latitude === "number"
          ? data.location.latitude
          : null,
    longitude:
      typeof data.longitude === "number"
        ? data.longitude
        : typeof data.location?.longitude === "number"
          ? data.location.longitude
          : null,
    etaMinutes: asNumber(data.etaMinutes),
    passengerId: data.passengerId || "",
    passengerName: data.passengerName || "Passenger",
    passengerPhone: data.passengerPhone || "",
    driverPhone: data.driverPhone || "",
    requestId: data.requestId || "",
    offerId: data.offerId || "",
    paymentStatus: data.paymentStatus || "",
    helpCompleted: data.helpCompleted === true,
    searchText: buildSearchText([
      meta.label,
      data.category,
      data.from,
      data.to,
      data.date,
      data.time,
      data.driverName,
      data.passengerName,
      data.description,
      address,
      tripStatus,
      data.dayName,
      ...problemTypes,
      ...days,
    ]),
  };
};

// ---------------------------------------------------------------------------
// Cancellation — a real status change (never confused with the "hide from my
// list" helpers in (tabs)/bookings.tsx, which never touch status/tripStatus
// or notify anyone). Covers every category that goes through the generic
// `bookings` collection via normalizeBooking above (personal/school
// quick+weekly bookings, roadside) — personal_ride has its
// own equivalent, cancelRideBooking, in rideBookingLib.ts.
//
// Capacity restore: only bookings created through the weekly/quick
// driverRoutes flow (weeklyBookingLib.ts's createWeeklyBookings) hold a
// route seat that needs restoring — mirrors that function's own decrement
// exactly, in reverse. Roadside bookings carry no routeId at all
// (roadsideLib.ts creates them directly, no shared capacity to give back),
// so they fall through untouched.
// ---------------------------------------------------------------------------

export const getGeneralBookingCancelBlockedReason = (
  booking: BookingItem,
  cancelledBy: "passenger" | "driver" = "passenger",
  now: Date = new Date(),
): string | null => {
  if (booking.status !== "ongoing") {
    return i18n.t("workErrand.cannotCancelAnymore");
  }

  if (booking.tripStatus && booking.tripStatus !== "booked") {
    return i18n.t("workErrand.cannotCancelAnymore");
  }

  const hours =
    cancelledBy === "driver" ? DRIVER_CANCEL_LOCK_HOURS : PASSENGER_CANCEL_LOCK_HOURS;

  return getTimeBasedCancelBlockedReason(booking, hours, now);
};

export const cancelGeneralBooking = async (
  bookingId: string,
  booking: BookingItem,
  cancelledBy: "passenger" | "driver",
) => {
  const blocked = getGeneralBookingCancelBlockedReason(booking, cancelledBy);
  if (blocked) throw new Error(blocked);

  const bookingRef = doc(db, "bookings", bookingId);

  await runTransaction(db, async (transaction) => {
    const bookingSnap = await transaction.get(bookingRef);
    if (!bookingSnap.exists()) return;

    const data = bookingSnap.data();
    if (data.status === "completed" || data.status === "cancelled") return;

    transaction.update(bookingRef, {
      status: "cancelled",
      updatedAt: serverTimestamp(),
    });

    if (!booking.routeId) return;

    const routeRef = doc(db, "driverRoutes", booking.routeId);
    const routeSnap = await transaction.get(routeRef);
    if (!routeSnap.exists()) return;

    const routeData: any = routeSnap.data();
    const hasWeeklyTrips =
      Array.isArray(routeData.weeklyTrips) && routeData.weeklyTrips.length > 0;

    if (hasWeeklyTrips && booking.date) {
      const weeklyTrips = [...routeData.weeklyTrips];
      const index = weeklyTrips.findIndex((trip: any) => trip.date === booking.date);
      if (index === -1) return;

      const currentRemaining =
        typeof weeklyTrips[index].remainingSeats === "number"
          ? weeklyTrips[index].remainingSeats
          : 0;
      const totalSeats = Number(weeklyTrips[index].seats) || currentRemaining;

      weeklyTrips[index] = {
        ...weeklyTrips[index],
        remainingSeats: Math.min(currentRemaining + (booking.seats || 1), totalSeats),
      };

      transaction.update(routeRef, { weeklyTrips, updatedAt: serverTimestamp() });
    } else if (routeData.bookingId === bookingId) {
      // Whole-route booking (no per-day capacity) — reopen it, mirroring
      // the exact fields createWeeklyBookings' else-branch sets when it
      // books this route in the first place.
      transaction.update(routeRef, {
        status: "active",
        tripStatus: "booked",
        isBooked: false,
        available: true,
        bookingId: null,
        updatedAt: serverTimestamp(),
      });
    }
  });

  const receiverId = cancelledBy === "passenger" ? booking.driverId : booking.passengerId;

  if (receiverId) {
    await notify({
      receiverId,
      type: "cancelled",
      title: i18n.t("schoolTrip.bookingCancelledNotificationTitle"),
      message:
        cancelledBy === "passenger"
          ? `${booking.passengerName || "The passenger"} cancelled their booking`
          : `${booking.driverName || "The driver"} cancelled your booking`,
      applicationId: bookingId,
      bookingId,
      category: booking.category,
      status: "cancelled",
      targetTab: cancelledBy === "passenger" ? "driver" : "passenger",
    });
  }
};

export type DriverTripItem = {
  id: string;
  collectionName: DriverCollection;
  category: string;
  title: string; // job/errand/store title when there is no from/to
  from: string;
  to: string;
  location: string;
  date: string;
  days: string[];
  time: string;
  price: number | null;
  seats: number | null;

  // Work jobs only — capacity tracking (see workErrandLib.ts). Null for
  // every other collection.
  totalSeats: number | null;
  remainingSeats: number | null;
  acceptedWorkersCount: number | null;
  isFull: boolean;

  status: "ongoing" | "completed";
  createdAtSeconds: number;
  searchText: string;
};

export const normalizeDriverTrip = (
  id: string,
  data: any,
  collectionName: DriverCollection,
): DriverTripItem => {
  const category =
    data.category ||
    (collectionName === "workJobs"
      ? "workErrands"
      : collectionName === "errandJobs"
        ? "errands"
        : "");

  const from = data.from || "";
  const to = data.to || "";
  const location = data.location || "";
  const title = data.jobTitle || data.errandTitle || "";

  const date = data.tripDate || data.date || "";
  const days: string[] = Array.isArray(data.availableDays)
    ? data.availableDays
    : data.day
      ? [data.day]
      : [];

  const time = data.time || data.startTime || "";

  const price =
    asNumber(data.price) ?? asNumber(data.hourlyPay) ?? null;
  const seats =
    asNumber(data.seats) ?? asNumber(data.workersNeeded) ?? null;

  // Work jobs only — everything else keeps these null.
  const totalSeats =
    collectionName === "workJobs"
      ? (asNumber(data.totalSeats) ??
        asNumber(data.seats) ??
        asNumber(data.workersNeeded) ??
        null)
      : null;
  const remainingSeats =
    collectionName === "workJobs"
      ? typeof data.remainingSeats === "number"
        ? data.remainingSeats
        : totalSeats
      : null;
  const acceptedWorkersCount =
    collectionName === "workJobs" ? asNumber(data.acceptedWorkersCount) : null;
  const isFull =
    collectionName === "workJobs" &&
    (data.isFull === true || data.status === "full");

  // "completed" here means the job LISTING was manually marked done — it's
  // a different concept from the job being full (isFull), which only
  // affects whether it still shows up in passenger search results.
  const status = data.status === "completed" ? "completed" : "ongoing";
  const meta = getCategoryMeta(category);

  return {
    id,
    collectionName,
    category,
    title,
    from,
    to,
    location,
    date,
    days,
    time,
    price,
    seats,
    totalSeats,
    remainingSeats,
    acceptedWorkersCount,
    isFull,
    status,
    createdAtSeconds: data.createdAt?.seconds || 0,
    searchText: buildSearchText([
      meta.label,
      category,
      from,
      to,
      location,
      title,
      date,
      time,
      ...days,
    ]),
  };
};