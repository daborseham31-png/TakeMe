// ---------------------------------------------------------------------------
// School Trips — outbound/return school ride system.
//
// This is a NEW, dedicated data model living in its own collections
// (schoolTrips / schoolBookings / rideRequests), separate from the generic
// driverRoutes/bookings collections used by Personal Ride / Work / Errand /
// legacy weekly School rides (see app/driver/create/RideForm.tsx and
// app/booking/weeklyBookingLib.ts, both untouched by this file).
//
// Why a separate collection instead of extending driverRoutes: driverRoutes
// is shared by four very different categories and books a route "all or
// nothing" (isBooked/available flip once, no per-seat transaction — see
// weeklyBookingLib.ts's comments). A school outbound/return trip needs its
// own independent per-seat `availableSeats` transaction, a `direction`, and
// a `linkedTripId` between two independently-bookable documents — bolting
// that onto driverRoutes would risk regressing Personal/Work/Errand booking.
// See AGENTS.md for the full spec this file implements.
// ---------------------------------------------------------------------------

import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import * as Crypto from "expo-crypto";

import { auth, db } from "../../firebase";
import i18n from "../i18n";
import { normalizeToWesternDigits } from "../i18n/digits";
import {
  DRIVER_CANCEL_LOCK_HOURS,
  DriverLiveLocation,
  PASSENGER_CANCEL_LOCK_HOURS,
  TripTrackingStatus,
} from "./bookingsLib";
import { normalizeTime, timeToMinutes } from "../driver/create/driverHelpers";
import { calculateDistanceKm } from "./homeFeedLib";
import { notify } from "./work-errand/workErrandLib";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SchoolTripDirection = "to_school" | "from_school";

// The ONE place a raw, possibly-non-canonical direction value (an older or
// differently-named field on a school trip/booking record) gets resolved to
// the two real values — reused everywhere a direction badge/label is
// derived (normalizeSchoolTrip/normalizeSchoolBooking below,
// homeFeedLib.ts's Home card, TripFeedCard.tsx's badge) so there is only
// ever one mapping, never a second copy that could drift.
//
// Deliberately does NOT fall back to "whichever leg has the earlier time"
// — a trip's own stored direction (however it's spelled) is always a
// stronger, more direct signal than inferring from departure time, which
// this never does.
const OUTBOUND_DIRECTION_VALUES = new Set(["to_school", "outbound", "going", "departure"]);
const RETURN_DIRECTION_VALUES = new Set(["from_school", "return", "returning", "coming_back", "arrival"]);

export const normalizeSchoolTripDirection = (value: any): SchoolTripDirection => {
  const key = String(value ?? "").trim().toLowerCase();

  if (RETURN_DIRECTION_VALUES.has(key)) return "from_school";
  if (OUTBOUND_DIRECTION_VALUES.has(key)) return "to_school";

  // No recognizable value at all (very old/malformed record) — "to_school"
  // is the same default this collection has always used elsewhere (see the
  // pre-existing inline `data.direction === "from_school" ? ... : "to_school"`
  // this helper replaces), not a new assumption introduced here.
  return "to_school";
};

// The ONE place a direction badge's display text is derived — reused by
// useMySchoolRows.tsx (booking/trip cards) and TripFeedCard.tsx (Home
// feed cards) instead of each screen keeping its own copy. Never shows a
// combined "outbound and return" label — every card this labels represents
// exactly one leg (see AGENTS.md's school-trip direction-badge spec).
export const schoolTripDirectionLabel = (
  t: (key: string) => string,
  direction: SchoolTripDirection,
): string => (direction === "to_school" ? t("schoolTrip.outboundBadge") : t("schoolTrip.returnBadge"));

export type SchoolTripStatus = "active" | "full" | "cancelled" | "completed";

export type LatLng = { latitude: number; longitude: number };

export const SCHOOL_TRIPS_COLLECTION = "schoolTrips";
export const SCHOOL_BOOKINGS_COLLECTION = "schoolBookings";
// Real-time driver GPS during an active trip — see driverLocationTask.ts and
// firestore.rules. Its own collection (never a field on schoolTrips/
// bookings), keyed by tripId for School Trips (one shared car) or bookingId
// for Personal Ride (see live-tracking.tsx / ride-navigation.tsx).
export const TRIP_LOCATIONS_COLLECTION = "tripLocations";
export const RIDE_REQUESTS_COLLECTION = "rideRequests";

// Driver-side creation mode — a return leg is now creatable completely on
// its own, never forced to be attached to an outbound trip. "linkedTripId"
// (set on both docs in the outbound_and_return case) is purely informational
// everywhere it's read — see AGENTS.md's #2 "every return trip must be
// independent": it must never gate search visibility, booking eligibility,
// price, seats, cancellation, status, payment, matching, or waiting
// requests. A return_only trip is created with linkedTripId: null and is
// otherwise indistinguishable from a linked one to every consumer.
export type DriverSchoolTripMode =
  | "outbound_only"
  | "return_only"
  | "outbound_and_return";

// One passenger "seat" = one child, since each child may finish school (and
// therefore need a return ride) at a different time — see AGENTS.md's
// per-child return system. localId is a client-generated, stable-within-one
// booking-session id (not a Firestore id); childId, when present, is the
// durable schoolChildren/{childId} profile this entry was picked from (see
// app/booking/school/schoolChildrenLib.ts) — optional and absent for a
// still-supported plain temporary "Child 1"/"Child 2"-style entry the parent
// typed a name for instead of picking a saved profile.
export type SchoolPassengerEntry = {
  localId: string;
  childId?: string;
  childName?: string;

  outboundRequired: boolean;
  returnRequired: boolean;

  outboundRequestedTime?: string;
  returnRequestedTime?: string;

  selectedOutboundTripId?: string;
  selectedReturnTripId?: string;
};

export interface SchoolTrip {
  id: string;
  driverId: string;
  driverName: string;
  driverPhone: string;
  tripType: "school";
  direction: SchoolTripDirection;

  // Vehicle details — the SAME field names the legacy driverRoutes-based
  // weekly school/personal flow already uses (car/carColor/carPlate; see
  // RideForm.tsx), reused here rather than inventing a second vehicle
  // schema. Always present as a string (never undefined) on a trip created
  // through this file's own create functions; an older trip predating this
  // field simply normalizes to "" — see normalizeSchoolTrip's
  // backwards-compatible field fallbacks below.
  car: string;
  carColor: string;
  carPlate: string;

  // The general trip areas (e.g. "Nazareth" / "Mashhad") — NEVER the school
  // itself. Kept fully separate from schoolName/schoolAddress/schoolLocation
  // below: a driver picks From, To, AND School as three independent fields
  // (see AGENTS.md correction — the school is one specific building inside
  // the "To" area for an outbound trip, not the same thing as the area).
  // fromArea/toArea are the plain locality display name; fromAddress/
  // toAddress mirror them today (this app has no separate street-address
  // geocoding step beyond the locality dataset — see
  // IsraelLocationAutocomplete.tsx) but are kept as distinct fields for a
  // future finer-grained address.
  fromArea: string;
  fromAddress: string;
  fromLocation: LatLng | null;

  toArea: string;
  toAddress: string;
  toLocation: LatLng | null;

  // The specific school — always present regardless of direction, always
  // independent of fromArea/toArea above.
  schoolId: string;
  schoolName: string;
  schoolAddress: string;
  schoolLocation: LatLng | null;

  date: string;
  departureTime: string;

  pricePerSeat: number;
  totalSeats: number;
  availableSeats: number;

  linkedTripId: string | null;

  status: SchoolTripStatus;

  // Trip-lifecycle tracking — one car, one set of GPS updates, shared by
  // every passenger booked on this trip (unlike a personal ride's 1
  // driver:1 passenger `bookings` doc, a school trip can carry several
  // independent SchoolBooking docs, so live location/tripStatus live HERE
  // on the trip itself rather than being duplicated — and re-written on
  // every 3-second GPS tick — once per passenger). Reuses the exact same
  // TripTrackingStatus spelling ("driver_on_way"/"arrived_pickup"/...) as
  // Personal Ride's `bookings` collection so this trip doc can flow
  // through the SAME app/driver/ride-navigation.tsx and
  // app/booking/live-tracking.tsx screens unmodified (see their new
  // `source=schoolTrips` branch) — never a second navigation/tracking
  // screen. SchoolBooking.tripStatus (below) is a synced READ-ONLY mirror
  // of this field, updated in the same write, so each passenger's own
  // booking doc still reflects trip progress without a second live
  // subscription.
  tripStatus: TripTrackingStatus;
  trackingEnabled: boolean;
  driverLocation: DriverLiveLocation | null;
  driverLocationUpdatedAtSeconds: number;
  finishedByDriver: boolean;

  // Set only when a driver cancels this trip (see cancelSchoolTrip) — the
  // reason the driver gave, read server-side by the onSchoolTripCancelled
  // Cloud Function to stamp onto every affected booking and to search for
  // replacement trips. Never shown to passengers directly on the trip
  // itself (only surfaced through the booking's own cancellation fields).
  cancellationReason?: string;

  // Hides a finished trip from the driver's own My Bookings list only (see
  // hideSchoolTrip) — same "soft delete, own side only" convention as
  // SchoolBooking's deletedForPassenger/deletedForDriver below. A trip has
  // no passenger-side equivalent since it's driver-owned.
  deletedForDriver: boolean;

  createdAtSeconds: number;
  updatedAtSeconds: number;
}

export type RideRequestStatus =
  | "waiting"
  | "matched"
  | "booked"
  | "cancelled"
  | "expired";

export interface RideRequest {
  id: string;
  parentId: string;
  // Same value as parentId — kept as its own field because every other
  // notification-adjacent document in this app (see `notifications`'s own
  // `userId`) is keyed that way; some matching/read code paths key off
  // `userId` specifically for consistency with that pattern.
  userId: string;

  // Which child this waiting request is for — one request always represents
  // exactly one child and one requested time (AGENTS.md's per-child waiting
  // requests: never reuse Child 1's time for Child 2). localId matches the
  // SchoolPassengerEntry.localId this request was created from, so the
  // passenger-side UI can re-associate a matched/notified request with the
  // right child card.
  childEntryId: string;
  childId?: string;
  childName?: string;

  tripType: "school";
  direction: "from_school";

  schoolId: string;
  schoolName: string;
  schoolAddress: string;
  schoolLocation: LatLng | null;

  // The return trip's own "From" (the school's area — e.g. "Mashhad") and
  // "To" (the parent's home/destination — e.g. "Nazareth"), matching the
  // same fromArea/toArea vocabulary as SchoolTrip. fromLocation is
  // informational (the school's own area, not a distinct GPS point from
  // schoolLocation above); destinationLocation is what matching actually
  // runs against (see isDestinationNearRoute call sites below).
  fromArea: string;
  fromLocation: LatLng | null;

  toArea: string;
  destinationLocation: LatLng | null;

  requestedDate: string;
  requestedTime: string;
  // Always 1 — one request is always exactly one child, one seat.
  seats: number;

  maxTimeDifferenceMinutes: number;

  status: RideRequestStatus;

  matchedTripId: string | null;
  matchedTripIds: string[];
  notifiedTripIds: string[];
  lastNotifiedAtSeconds: number;

  // Set once the parent actually confirms+pays for a real return booking
  // for this request (see bookReturnForChild's post-booking write-back) —
  // the request's own back-reference to SchoolBooking.sourceRideRequestId,
  // used as My Bookings' fallback linkage direction (see
  // useMySchoolRows.tsx's findLinkedBooking) if the forward one is ever
  // missing. `status` moves to "booked" in the SAME write.
  matchedBookingId: string | null;

  // Per-user My Bookings view-hide flag (see hideRideRequest below) — the
  // "Clear All"/individual-hide equivalent of schoolBookings/schoolTrips'
  // own deletedForPassenger/deletedForDriver. Never changes `status`, so the
  // matching system (matchRideRequestsForNewTrip) keeps treating this
  // request exactly as before; it only stops rendering as a card in this
  // parent's own My Bookings.
  hiddenForParent: boolean;

  createdAtSeconds: number;
  updatedAtSeconds: number;
}

export type SchoolBookingStatus = "booked" | "cancelled" | "completed";

export type VerificationStatus = "pending" | "verified" | "failed" | "expired";

// Additive, parallel to SchoolBookingStatus — see SchoolBooking.bookingStatus.
export type SchoolBookingLifecycleStatus =
  | "confirmed"
  | "driver_cancelled"
  | "replacement_pending"
  | "replacement_offered"
  | "replacement_confirmed"
  | "cancelled"
  | "completed";

// After this many wrong attempts, verification locks out for
// VERIFICATION_LOCKOUT_MINUTES (AGENTS.md's "temporarily lock verification
// for a few minutes" — never a permanent lock).
export const MAX_VERIFICATION_ATTEMPTS = 5;
export const VERIFICATION_LOCKOUT_MINUTES = 5;

// A single child on an outbound (usually multi-seat) booking — see
// SchoolBooking.childEntries. localId + an optional display name, plus an
// optional durable childId (see app/booking/school/schoolChildrenLib.ts) when
// this entry was picked from a saved School Child profile rather than typed
// as a temporary name — both forms remain valid indefinitely (backward
// compatible with every booking created before School Child profiles
// existed).
export type SchoolBookingChildEntry = {
  localId: string;
  childId?: string;
  childName?: string;
  // Only ever set transiently while a RETURN confirmation flows through
  // trip-confirm.tsx → ride-payment.tsx → bookReturnForChild (see that
  // function) — never actually persisted onto an outbound booking's own
  // stored childEntries[] (bookOutboundForChildren never sets it).
  sourceRideRequestId?: string;
};

export interface SchoolBooking {
  id: string;
  bookingGroupId: string;
  tripId: string;
  bookingDirection: SchoolTripDirection;

  passengerId: string;
  passengerName: string;
  passengerPhone: string;

  driverId: string;
  driverName: string;
  driverPhone: string;
  // Copied from the trip at booking time (same reasoning as
  // fromLocation/toLocation below — a booking must keep showing the right
  // vehicle even if the driver's trip doc or profile changes later). Always
  // a string, "" for a booking predating this field.
  car: string;
  carColor: string;
  carPlate: string;

  schoolId: string;
  schoolName: string;

  fromAddress: string;
  toAddress: string;
  // GPS pins for the driver's navigation + the passenger's live-tracking map
  // (AGENTS.md's trip-lifecycle feature) — copied from the trip at booking
  // time, since a booking can outlive edits to the trip itself. Null for any
  // booking predating this feature.
  fromLocation: LatLng | null;
  toLocation: LatLng | null;
  schoolLocation: LatLng | null;
  date: string;
  departureTime: string;

  seats: number;
  pricePerSeat: number;
  totalPrice: number;

  // Return bookings (AGENTS.md's per-child return system): always exactly
  // one child, seats === 1. Outbound bookings instead carry the full
  // childEntries list (one outbound booking can cover every child riding
  // the same trip, per AGENTS.md's "Outbound ride behavior"). Both are
  // optional/absent on any booking predating this feature — see the
  // backward-compatibility fallbacks in normalizeSchoolBooking below.
  childEntryId?: string;
  childName?: string;
  childEntries?: SchoolBookingChildEntry[];
  // The durable schoolChildren/{childId} profile this RETURN booking's one
  // child was picked from (see app/booking/school/schoolChildrenLib.ts) —
  // absent for a booking made with a plain temporary childName (backward
  // compatible). Outbound bookings carry their own per-child id inside
  // childEntries[].childId instead, since one outbound booking can cover
  // several children.
  childId?: string;
  // The waiting rideRequests/{id} this RETURN booking was created to fulfil
  // — absent for an outbound booking, and for any return booked without a
  // prior waiting request (a plain from-scratch search), or any booking
  // predating this field. This is the PRIMARY signal My Bookings uses to
  // recognize "this booking IS that waiting card, now confirmed" instead of
  // rendering both as separate cards — see useMySchoolRows.tsx's
  // findLinkedBooking. Never used for anything security-sensitive; it is
  // purely a display-dedup linkage.
  sourceRideRequestId?: string;

  paymentMethod: "cash" | "bit";
  paymentStatus: "cash_pending" | "mock_paid";

  status: SchoolBookingStatus;
  // Mirrors the owning SchoolTrip's own tripStatus/trackingEnabled (see
  // SchoolTrip's comment) — kept on the booking too so each passenger's own
  // card can show trip progress/rating-eligibility from ONE subscription,
  // without a second read of the trip doc. The driver's live GPS itself
  // stays on the trip only (see SchoolTrip.driverLocation).
  tripStatus: TripTrackingStatus;
  trackingEnabled: boolean;
  finishedByDriver: boolean;

  needsPassengerRating: boolean;
  ratingSubmitted: boolean;
  rating: number | null;
  // 0 until the trip is actually finished and completedAt is stamped on
  // THIS booking — the rating gate requires this to be > 0, never just
  // tripStatus === "completed" alone.
  completedAtSeconds: number;

  // ---------------------------------------------------------------------
  // Passenger verification code — a short, driver-checked code so the
  // driver and parent/child can confirm the right child is entering the
  // right car. Always a zero-padded STRING (never a number — "0427" must
  // stay valid), generated fresh per booking via generateVerificationCode()
  // (expo-crypto, never Math.random or a predictable seed like the booking
  // id/phone/date). See verifyPassengerCodeAndStartTrip for the driver-side
  // check — a CORRECT code is the ONLY thing that can move tripStatus from
  // "arrived_pickup" to "in_progress" (never "I arrived" alone).
  // ---------------------------------------------------------------------
  verificationCode: string;
  verificationStatus: VerificationStatus;
  verifiedAtSeconds: number;
  verifiedByDriverId: string | null;
  verificationAttempts: number;
  verificationLockedUntilSeconds: number;

  // Set together, atomically, only by a successful verifyPassengerCodeAndStartTrip
  // call — passengerVerified is the durable "this exact booking's code was
  // checked and matched" flag (verificationStatus can be reset to "expired"
  // later by the stale-code sweep; this one never is). tripStartedAt is this
  // booking's own start timestamp, always set in the same write as
  // tripStatus becoming "in_progress".
  passengerVerified: boolean;
  passengerVerifiedAtSeconds: number;
  tripStartedAtSeconds: number;
  // Guards the trip-started notification/push from ever being sent twice
  // for the same booking (e.g. a retried/duplicate verify call after the
  // trip already started) — see verifyPassengerCodeAndStartTrip.
  tripStartedNotificationSent: boolean;

  // ---------------------------------------------------------------------
  // Driver-cancellation replacement lifecycle — additive, parallel to the
  // existing `status` field above (status still means exactly what it
  // always meant everywhere else in the app: "booked"/"cancelled"/
  // "completed" — nothing that already reads `status` needs to change).
  // bookingStatus only carries the finer-grained replacement workflow
  // state; see schoolReplacementOffers / acceptReplacementOffer below.
  // ---------------------------------------------------------------------
  bookingStatus: SchoolBookingLifecycleStatus;
  cancelledBy?: "driver" | "passenger";
  cancellationReason?: string;
  cancelledAtSeconds?: number;
  // The trip this booking was originally made for — frozen at cancellation
  // time so it survives even though `tripId` itself never actually changes
  // (a replacement is always a NEW booking document, never a mutation of
  // this one's own tripId).
  originalTripId?: string;
  replacedByBookingId?: string;
  replacementTripId?: string;
  replacementConfirmedAtSeconds?: number;
  // Set only on a booking that WAS CREATED to replace another — points back
  // to the booking it replaced, for traceability.
  replacesBookingId?: string;

  deletedForPassenger: boolean;
  deletedForDriver: boolean;

  createdAtSeconds: number;
  updatedAtSeconds: number;
}

// ---------------------------------------------------------------------------
// Helpers — time difference, distance, "is destination near this trip's
// route" — reusable, spec-named helpers (see AGENTS.md section 5).
// calculateDistanceKm is re-exported from homeFeedLib rather than
// duplicated — that is the one haversine implementation in the app.
// ---------------------------------------------------------------------------

export { calculateDistanceKm };

// Minutes between two "HH:MM" times, always >= 0. Returns null if either
// time is invalid/empty.
export function getTimeDifferenceInMinutes(
  timeA: string,
  timeB: string,
): number | null {
  const a = timeToMinutes(timeA);
  const b = timeToMinutes(timeB);
  if (a === null || b === null) return null;
  return Math.abs(a - b);
}

// Signed minutes (positive = timeB is after timeA) — used to prioritize
// "after the requested time" alternatives over "before" ones (AGENTS.md #6).
function getSignedTimeDifferenceInMinutes(
  timeA: string,
  timeB: string,
): number | null {
  const a = timeToMinutes(timeA);
  const b = timeToMinutes(timeB);
  if (a === null || b === null) return null;
  return b - a;
}

export const NEARBY_ROUTE_RADIUS_KM = 6;

// True when `destination` is within radiusKm of the route's end point, OR
// within radiusKm of the straight line between routeStart and routeEnd (a
// simple, honest approximation of "the driver route passes close to the
// parent's destination" — good enough at city/town scale in Israel; not a
// real road-network routing distance).
export function isDestinationNearRoute(
  destination: LatLng | null,
  routeStart: LatLng | null,
  routeEnd: LatLng | null,
  radiusKm: number = NEARBY_ROUTE_RADIUS_KM,
): boolean {
  if (!destination) return false;

  if (
    routeEnd &&
    calculateDistanceKm(
      destination.latitude,
      destination.longitude,
      routeEnd.latitude,
      routeEnd.longitude,
    ) <= radiusKm
  ) {
    return true;
  }

  if (!routeStart || !routeEnd) return false;

  // Flat-earth (equirectangular) projection to km around routeStart — fine
  // at the scale of a single trip's route, never used for global distances.
  const kmPerDegLat = 110.574;
  const kmPerDegLng =
    111.32 * Math.cos((routeStart.latitude * Math.PI) / 180);

  const toXY = (point: LatLng) => ({
    x: (point.longitude - routeStart.longitude) * kmPerDegLng,
    y: (point.latitude - routeStart.latitude) * kmPerDegLat,
  });

  const end = toXY(routeEnd);
  const point = toXY(destination);

  const segLenSq = end.x ** 2 + end.y ** 2;

  if (segLenSq === 0) return false;

  let t = (point.x * end.x + point.y * end.y) / segLenSq;
  t = Math.max(0, Math.min(1, t));

  const closest = { x: end.x * t, y: end.y * t };
  const distKm = Math.sqrt((point.x - closest.x) ** 2 + (point.y - closest.y) ** 2);

  return distKm <= radiusKm;
}

// ---------------------------------------------------------------------------
// Current user info (name/phone) — same pattern as bookingsLib/workErrandLib.
// ---------------------------------------------------------------------------

const getCurrentUserInfo = async (): Promise<{
  id: string;
  name: string;
  phone: string;
}> => {
  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t("validation.mustBeLoggedInToBook"));

  let name = user.displayName || i18n.t("common.passenger");
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
// Normalizer
// ---------------------------------------------------------------------------

const toLatLng = (raw: any): LatLng | null => {
  const latitude = Number(raw?.latitude);
  const longitude = Number(raw?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
};

const toDriverLocation = (raw: any): DriverLiveLocation | null => {
  const latitude = Number(raw?.latitude);
  const longitude = Number(raw?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    accuracy: raw?.accuracy ?? null,
    heading: raw?.heading ?? null,
    speed: raw?.speed ?? null,
  };
};

// Backwards-compatible vehicle-field readers — reused by
// normalizeSchoolTrip and normalizeSchoolBooking below. New writes always
// use the canonical car/carColor/carPlate names (same names the legacy
// driverRoutes-based weekly flow already uses — see RideForm.tsx), but a
// trip/booking document could exist with one of these older/alternate
// shapes, so every plausible field name is checked before falling back to
// "".
const readVehicleModel = (data: any): string =>
  data.car || data.carModel || data.vehicleModel || data.vehicle?.model || "";

const readVehicleColor = (data: any): string =>
  data.carColor || data.vehicleColor || data.vehicle?.color || "";

const readVehiclePlate = (data: any): string =>
  data.carPlate ||
  data.carPlateNumber ||
  data.plateNumber ||
  data.vehiclePlateNumber ||
  data.vehicle?.plateNumber ||
  "";

const toTripTrackingStatus = (value: any): TripTrackingStatus => {
  if (
    value === "driver_on_way" ||
    value === "arrived_pickup" ||
    value === "in_progress" ||
    value === "completed"
  ) {
    return value;
  }
  return "booked";
};

export const normalizeSchoolTrip = (id: string, data: any): SchoolTrip => ({
  id,
  driverId: data.driverId || "",
  driverName: data.driverName || "Driver",
  driverPhone: data.driverPhone || "",
  tripType: "school",
  direction: normalizeSchoolTripDirection(data.direction),

  car: readVehicleModel(data),
  carColor: readVehicleColor(data),
  carPlate: readVehiclePlate(data),

  fromArea: data.fromArea || data.fromAddress || "",
  fromAddress: data.fromAddress || data.fromArea || "",
  fromLocation: toLatLng(data.fromLocation),

  toArea: data.toArea || data.toAddress || "",
  toAddress: data.toAddress || data.toArea || "",
  toLocation: toLatLng(data.toLocation),

  schoolId: data.schoolId || "",
  schoolName: data.schoolName || "",
  schoolAddress: data.schoolAddress || "",
  schoolLocation: toLatLng(data.schoolLocation),

  date: data.date || "",
  departureTime: data.departureTime || "",

  pricePerSeat: Number(data.pricePerSeat) || 0,
  totalSeats: Number(data.totalSeats) || 0,
  availableSeats: Number(data.availableSeats) || 0,

  linkedTripId: data.linkedTripId || null,

  status: (data.status || "active") as SchoolTripStatus,

  tripStatus: toTripTrackingStatus(data.tripStatus),
  trackingEnabled: !!data.trackingEnabled,
  driverLocation: toDriverLocation(data.driverLocation),
  driverLocationUpdatedAtSeconds: data.driverLocationUpdatedAt?.seconds || 0,
  finishedByDriver: data.finishedByDriver === true,
  deletedForDriver: data.deletedForDriver === true,

  createdAtSeconds: data.createdAt?.seconds || 0,
  updatedAtSeconds: data.updatedAt?.seconds || 0,
});

export const normalizeRideRequest = (id: string, data: any): RideRequest => ({
  id,
  parentId: data.parentId || "",
  userId: data.userId || data.parentId || "",

  // Backward compatibility: a request created before per-child requests
  // existed has no childEntryId — fall back to the request's own id so it
  // still behaves as "one distinct child slot" rather than colliding with
  // every other childless legacy request.
  childEntryId: data.childEntryId || id,
  childId: data.childId || undefined,
  childName: data.childName || undefined,

  tripType: "school",
  direction: "from_school",

  schoolId: data.schoolId || "",
  schoolName: data.schoolName || "",
  schoolAddress: data.schoolAddress || "",
  schoolLocation: toLatLng(data.schoolLocation),

  fromArea: data.fromArea || "",
  fromLocation: toLatLng(data.fromLocation),

  // toArea is the current field name; destinationAddress is read as a
  // fallback for any request document written before this field was
  // renamed, so older waiting requests keep matching/displaying correctly.
  toArea: data.toArea || data.destinationAddress || "",
  destinationLocation: toLatLng(data.destinationLocation),

  requestedDate: data.requestedDate || "",
  requestedTime: data.requestedTime || "",
  seats: Number(data.seats) || 1,

  maxTimeDifferenceMinutes:
    Number(data.maxTimeDifferenceMinutes) || MAX_ALTERNATIVE_MINUTES,

  status: (data.status || "waiting") as RideRequestStatus,

  matchedTripId: data.matchedTripId || null,
  matchedTripIds: Array.isArray(data.matchedTripIds) ? data.matchedTripIds : [],
  notifiedTripIds: Array.isArray(data.notifiedTripIds) ? data.notifiedTripIds : [],
  lastNotifiedAtSeconds: data.lastNotifiedAt?.seconds || 0,

  matchedBookingId: data.matchedBookingId || null,

  hiddenForParent: data.hiddenForParent === true,

  createdAtSeconds: data.createdAt?.seconds || 0,
  updatedAtSeconds: data.updatedAt?.seconds || 0,
});

export const normalizeSchoolBooking = (id: string, data: any): SchoolBooking => ({
  id,
  bookingGroupId: data.bookingGroupId || "",
  tripId: data.tripId || "",
  bookingDirection: normalizeSchoolTripDirection(data.bookingDirection),

  passengerId: data.passengerId || "",
  passengerName: data.passengerName || "Passenger",
  passengerPhone: data.passengerPhone || "",

  driverId: data.driverId || "",
  driverName: data.driverName || "Driver",
  driverPhone: data.driverPhone || "",
  car: readVehicleModel(data),
  carColor: readVehicleColor(data),
  carPlate: readVehiclePlate(data),

  schoolId: data.schoolId || "",
  schoolName: data.schoolName || "",

  fromAddress: data.fromAddress || "",
  toAddress: data.toAddress || "",
  fromLocation: toLatLng(data.fromLocation),
  toLocation: toLatLng(data.toLocation),
  schoolLocation: toLatLng(data.schoolLocation),
  date: data.date || "",
  departureTime: data.departureTime || "",

  seats: Number(data.seats) || 1,
  pricePerSeat: Number(data.pricePerSeat) || 0,
  totalPrice: Number(data.totalPrice) || 0,

  // Backward compatible: an old booking (or a non-school one that somehow
  // flowed through here) simply has none of these — every reader must fall
  // back to plain `seats` rather than assume childEntries exists.
  childEntryId: data.childEntryId || undefined,
  childName: data.childName || undefined,
  childEntries: Array.isArray(data.childEntries) ? data.childEntries : undefined,
  childId: data.childId || undefined,
  sourceRideRequestId: data.sourceRideRequestId || undefined,

  paymentMethod: data.paymentMethod === "bit" ? "bit" : "cash",
  paymentStatus: data.paymentStatus === "mock_paid" ? "mock_paid" : "cash_pending",

  status: (data.status || "booked") as SchoolBookingStatus,
  tripStatus: toTripTrackingStatus(data.tripStatus),
  trackingEnabled: !!data.trackingEnabled,
  finishedByDriver: data.finishedByDriver === true,

  needsPassengerRating: data.needsPassengerRating === true,
  ratingSubmitted: data.ratingSubmitted === true,
  rating: typeof data.rating === "number" ? data.rating : null,
  completedAtSeconds: data.completedAt?.seconds || 0,

  // Always a string — a legacy booking predating this feature simply has no
  // code at all, never shown/verifiable (verificationStatus defaults to
  // "expired" for those so the UI never invites a driver to check a code
  // that was never generated).
  verificationCode: typeof data.verificationCode === "string" ? data.verificationCode : "",
  verificationStatus: (["pending", "verified", "failed", "expired"].includes(data.verificationStatus)
    ? data.verificationStatus
    : data.verificationCode
      ? "pending"
      : "expired") as VerificationStatus,
  verifiedAtSeconds: data.verifiedAt?.seconds || 0,
  verifiedByDriverId: data.verifiedByDriverId || null,
  verificationAttempts: Number(data.verificationAttempts) || 0,
  verificationLockedUntilSeconds: data.verificationLockedUntil?.seconds || 0,

  passengerVerified: data.passengerVerified === true,
  passengerVerifiedAtSeconds: data.passengerVerifiedAt?.seconds || 0,
  tripStartedAtSeconds: data.tripStartedAt?.seconds || 0,
  tripStartedNotificationSent: data.tripStartedNotificationSent === true,

  bookingStatus: (data.bookingStatus || "confirmed") as SchoolBookingLifecycleStatus,
  cancelledBy: data.cancelledBy || undefined,
  cancellationReason: data.cancellationReason || undefined,
  cancelledAtSeconds: data.cancelledAt?.seconds || undefined,
  originalTripId: data.originalTripId || undefined,
  replacedByBookingId: data.replacedByBookingId || undefined,
  replacementTripId: data.replacementTripId || undefined,
  replacementConfirmedAtSeconds: data.replacementConfirmedAt?.seconds || undefined,
  replacesBookingId: data.replacesBookingId || undefined,

  deletedForPassenger: data.deletedForPassenger === true,
  deletedForDriver: data.deletedForDriver === true,

  createdAtSeconds: data.createdAt?.seconds || 0,
  updatedAtSeconds: data.updatedAt?.seconds || 0,
});

// ---------------------------------------------------------------------------
// Matching an outbound child entry to its own return booking — the ONE
// place this comparison happens, reused by My Bookings (useMySchoolRows.tsx's
// "no return ride needed" line) and anywhere else that needs to answer
// "does this specific child already have a return booking in this group?".
//
// childId (the durable schoolChildren/{childId} profile id — see
// app/booking/school/schoolChildrenLib.ts) is the PREFERRED key: it's
// stable across dates/bookings/driver replacements, unlike localId (a
// per-search, client-generated id that is never the same value twice).
// Only when EITHER side lacks a childId (an old booking made before School
// Child profiles existed, or a plain temporary/manual entry with no saved
// profile) does this fall back to localId/childEntryId — the same
// comparison this code always used, kept as-is for full backward
// compatibility. A childId is NEVER matched against a bare localId, and
// vice versa — the two id spaces are never conflated.
// ---------------------------------------------------------------------------

export function childEntryMatchesReturnBooking(
  child: { localId: string; childId?: string },
  returnBooking: { childEntryId?: string; childId?: string },
): boolean {
  if (child.childId && returnBooking.childId) {
    return child.childId === returnBooking.childId;
  }

  return !!returnBooking.childEntryId && returnBooking.childEntryId === child.localId;
}

// ---------------------------------------------------------------------------
// Creation — outbound only, or outbound + return as one atomic batch write
// (AGENTS.md #3: "the application does not save only one trip if the second
// write fails").
// ---------------------------------------------------------------------------

export type CreateSchoolTripInput = {
  fromArea: string;
  fromAddress: string;
  fromLocation: LatLng | null;
  toArea: string;
  toAddress: string;
  toLocation: LatLng | null;
  schoolId: string;
  schoolName: string;
  schoolAddress: string;
  schoolLocation: LatLng | null;
  date: string;
  departureTime: string;
  pricePerSeat: number;
  totalSeats: number;
  // Optional — a school trip created before this field existed simply has
  // none; SchoolTripForm.tsx always collects all three today.
  car?: string;
  carColor?: string;
  carPlate?: string;
};

type DriverIdentity = { driverId: string; driverName: string; driverPhone: string };

const buildTripDoc = (
  input: CreateSchoolTripInput,
  direction: SchoolTripDirection,
  linkedTripId: string | null,
  driver: DriverIdentity,
) => ({
  driverId: driver.driverId,
  driverName: driver.driverName,
  driverPhone: driver.driverPhone,
  car: input.car || "",
  carColor: input.carColor || "",
  carPlate: input.carPlate || "",
  tripType: "school",
  direction,

  fromArea: input.fromArea,
  fromAddress: input.fromAddress,
  fromLocation: input.fromLocation,

  toArea: input.toArea,
  toAddress: input.toAddress,
  toLocation: input.toLocation,

  schoolId: input.schoolId,
  schoolName: input.schoolName,
  schoolAddress: input.schoolAddress,
  schoolLocation: input.schoolLocation,

  date: input.date,
  departureTime: input.departureTime,

  pricePerSeat: input.pricePerSeat,
  totalSeats: input.totalSeats,
  availableSeats: input.totalSeats,

  linkedTripId,

  status: "active" as SchoolTripStatus,

  tripStatus: "booked" as TripTrackingStatus,
  trackingEnabled: false,
  driverLocation: null,
  finishedByDriver: false,

  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

// Fire-and-forget: notify any parent already waiting for a return trip like
// this one (AGENTS.md #8). Never awaited by a create* function's own
// return, and never allowed to throw into the caller — a matching failure
// must not make trip publishing look like it failed.
const triggerMatchingIfReturn = (
  id: string,
  input: CreateSchoolTripInput,
  direction: SchoolTripDirection,
  linkedTripId: string | null,
  driver: DriverIdentity,
) => {
  if (direction !== "from_school") return;

  matchRideRequestsForNewTrip({
    id,
    driverId: driver.driverId,
    driverName: driver.driverName,
    driverPhone: driver.driverPhone,
    car: input.car || "",
    carColor: input.carColor || "",
    carPlate: input.carPlate || "",
    tripType: "school",
    direction: "from_school",
    fromArea: input.fromArea,
    fromAddress: input.fromAddress,
    fromLocation: input.fromLocation,
    toArea: input.toArea,
    toAddress: input.toAddress,
    toLocation: input.toLocation,
    schoolId: input.schoolId,
    schoolName: input.schoolName,
    schoolAddress: input.schoolAddress,
    schoolLocation: input.schoolLocation,
    date: input.date,
    departureTime: input.departureTime,
    pricePerSeat: input.pricePerSeat,
    totalSeats: input.totalSeats,
    availableSeats: input.totalSeats,
    linkedTripId,
    status: "active",
    tripStatus: "booked",
    trackingEnabled: false,
    driverLocation: null,
    driverLocationUpdatedAtSeconds: 0,
    finishedByDriver: false,
    deletedForDriver: false,
    createdAtSeconds: 0,
    updatedAtSeconds: 0,
  }).catch((error) => {
    console.log("triggerMatchingIfReturn: matching the new trip failed", error);
  });
};

// The one general single-leg creator — used directly by all three
// DriverSchoolTripMode cases ("outbound_only" and "return_only" call this
// once; "outbound_and_return" instead uses createSchoolRoundTrip below so
// both legs share a batch write). linkedTripId defaults to null: a
// return_only trip is a fully independent document from the moment it's
// created (AGENTS.md #1's "linkedTripId must be optional").
export const createSchoolSingleTrip = async (
  input: CreateSchoolTripInput,
  direction: SchoolTripDirection,
  driver: DriverIdentity,
  linkedTripId: string | null = null,
): Promise<string> => {
  const ref = doc(collection(db, SCHOOL_TRIPS_COLLECTION));
  const batch = writeBatch(db);
  batch.set(ref, buildTripDoc(input, direction, linkedTripId, driver));
  await batch.commit();

  triggerMatchingIfReturn(ref.id, input, direction, linkedTripId, driver);

  return ref.id;
};

export const createSchoolOutboundTrip = async (
  input: CreateSchoolTripInput,
  driver: DriverIdentity,
): Promise<string> => createSchoolSingleTrip(input, "to_school", driver);

// Return-only creation (AGENTS.md #1's "Return only" mode) — a driver who
// only wants to take students home after school, never having created (or
// wanting to create) a matching outbound trip. Appears to searching parents
// exactly like any other from_school trip; see findMatchingSchoolTrips,
// which never filters on linkedTripId.
export const createSchoolReturnOnlyTrip = async (
  input: CreateSchoolTripInput,
  driver: DriverIdentity,
): Promise<string> => createSchoolSingleTrip(input, "from_school", driver);

export const createSchoolRoundTrip = async (
  outboundInput: CreateSchoolTripInput,
  returnInput: CreateSchoolTripInput,
  driver: DriverIdentity,
): Promise<{ outboundId: string; returnId: string }> => {
  const outboundRef = doc(collection(db, SCHOOL_TRIPS_COLLECTION));
  const returnRef = doc(collection(db, SCHOOL_TRIPS_COLLECTION));

  const batch = writeBatch(db);
  batch.set(outboundRef, buildTripDoc(outboundInput, "to_school", returnRef.id, driver));
  batch.set(returnRef, buildTripDoc(returnInput, "from_school", outboundRef.id, driver));
  await batch.commit();

  // linkedTripId is informational only (AGENTS.md #2) — matching, search,
  // and every other consumer treat this return leg exactly like a
  // return_only trip, so it uses the exact same trigger helper.
  triggerMatchingIfReturn(returnRef.id, returnInput, "from_school", outboundRef.id, driver);

  return { outboundId: outboundRef.id, returnId: returnRef.id };
};

// ---------------------------------------------------------------------------
// Cancellation window — once a trip is this close to departure, or the
// driver has already started it (tripStatus moved past "booked"), neither
// side can cancel anymore; the trip has to run to completion instead. Pure
// function (no Firestore access) so it can gate the Cancel button in the UI
// AND be re-checked server-side-equivalent inside cancelSchoolBooking/
// cancelSchoolTrip below before either actually writes anything.
// ---------------------------------------------------------------------------

// hoursBeforeDeparture defaults to the passenger's own booking-cancel
// window (2h) — cancelSchoolTrip (the driver cancelling their own posted
// trip) explicitly passes DRIVER_CANCEL_LOCK_HOURS (5h) instead, since that
// can affect passengers already booked onto it, not just the driver's own
// plan (matches the passenger/driver split in bookingsLib.ts's
// getTimeBasedCancelBlockedReason).
export const getSchoolCancelBlockedReason = (
  date: string,
  departureTime: string,
  tripStatus: TripTrackingStatus,
  hoursBeforeDeparture: number = PASSENGER_CANCEL_LOCK_HOURS,
): string | null => {
  if (tripStatus !== "booked") {
    return i18n.t("schoolTrip.cannotCancelDriverEnRoute");
  }

  const start = new Date(`${date}T${departureTime || "00:00"}:00`);
  if (Number.isNaN(start.getTime())) return null;

  const lockAt = new Date(
    start.getTime() - hoursBeforeDeparture * 60 * 60 * 1000,
  );

  if (Date.now() < lockAt.getTime()) return null;

  return hoursBeforeDeparture >= DRIVER_CANCEL_LOCK_HOURS
    ? i18n.t("booking.cannotCancelTripWithinFiveHours")
    : i18n.t("schoolTrip.cannotCancelWithinTwoHours");
};

// ---------------------------------------------------------------------------
// Driver: cancel a single leg (AGENTS.md #12: cancelling one direction must
// never touch the other linked trip).
// ---------------------------------------------------------------------------

// `reason` (when given) is stamped onto the trip doc itself so the
// server-side onSchoolTripCancelled Cloud Function (functions/index.js) can
// read it and propagate it onto every affected booking + use it to search
// for replacement trips for the affected passengers — the client here never
// enumerates/updates bookings itself (that matching/notification logic runs
// server-side, per the driver-cancellation-replacement feature).
export const cancelSchoolTrip = async (tripId: string, reason?: string) => {
  const tripRef = doc(db, SCHOOL_TRIPS_COLLECTION, tripId);
  const tripSnap = await getDoc(tripRef);

  if (tripSnap.exists()) {
    const trip = normalizeSchoolTrip(tripSnap.id, tripSnap.data());
    const blocked = getSchoolCancelBlockedReason(
      trip.date,
      trip.departureTime,
      trip.tripStatus,
      DRIVER_CANCEL_LOCK_HOURS,
    );
    if (blocked) throw new Error(blocked);
  }

  await updateDoc(tripRef, {
    status: "cancelled" as SchoolTripStatus,
    ...(reason ? { cancellationReason: reason } : {}),
    updatedAt: serverTimestamp(),
  });
};

// Hides a finished (cancelled/completed) trip from the driver's own list —
// see SchoolTrip.deletedForDriver above. Never touches status/availableSeats
// or anything a passenger's booking depends on.
export const hideSchoolTrip = async (tripId: string) => {
  await updateDoc(doc(db, SCHOOL_TRIPS_COLLECTION, tripId), {
    deletedForDriver: true,
    updatedAt: serverTimestamp(),
  });
};

// Cancels a trip AND its linked trip (if any) — an explicit driver choice,
// never automatic (AGENTS.md #2: "cancelling the outbound trip does not
// automatically cancel the return trip unless the driver explicitly
// chooses to cancel both"). Reads linkedTripId fresh from the document
// rather than trusting a stale value the caller might be holding.
export const cancelSchoolTripAndLinked = async (tripId: string, reason?: string) => {
  const snap = await getDoc(doc(db, SCHOOL_TRIPS_COLLECTION, tripId));
  const linkedTripId: string | null = snap.exists() ? snap.data()?.linkedTripId || null : null;

  await cancelSchoolTrip(tripId, reason);
  if (linkedTripId) {
    await cancelSchoolTrip(linkedTripId, reason);
  }
};

// ---------------------------------------------------------------------------
// Search / matching
// ---------------------------------------------------------------------------

export type SchoolTripSearchCriteria = {
  direction: SchoolTripDirection;
  schoolId: string;
  date: string;
  seats: number;
  requestedTime: string;
  // The parent's home/pickup (outbound) or drop-off destination (return) —
  // used for isDestinationNearRoute, never for the schoolId/date filter.
  destination: LatLng | null;
};

const fetchActiveSchoolTrips = async (
  direction: SchoolTripDirection,
  schoolId: string,
  date: string,
): Promise<SchoolTrip[]> => {
  const q = query(
    collection(db, SCHOOL_TRIPS_COLLECTION),
    where("tripType", "==", "school"),
    where("direction", "==", direction),
    where("schoolId", "==", schoolId),
    where("date", "==", date),
    where("status", "==", "active"),
  );

  const snap = await getDocs(q);
  return snap.docs.map((d) => normalizeSchoolTrip(d.id, d.data()));
};

const passesCapacityAndRoute = (
  trip: SchoolTrip,
  criteria: SchoolTripSearchCriteria,
): boolean => {
  if (trip.availableSeats < criteria.seats) return false;

  if (!criteria.destination) return true;

  // Outbound (to_school): the parent's home/pickup should be near where the
  // driver STARTS (fromLocation) or along the route to school. Return
  // (from_school): the parent's destination should be near where the driver
  // ENDS (toLocation) or along the route from school.
  const routeStart = trip.direction === "to_school" ? trip.fromLocation : trip.schoolLocation;
  const routeEnd = trip.direction === "to_school" ? trip.schoolLocation : trip.toLocation;

  return isDestinationNearRoute(criteria.destination, routeStart, routeEnd);
};

const EXACT_MATCH_WINDOW_MINUTES = 15;

// "Exact-ish" matches — small time tolerance, sorted closest-first. This is
// the primary result set; see findAlternativeTrips for the wider fallback.
export const findMatchingSchoolTrips = async (
  criteria: SchoolTripSearchCriteria,
): Promise<SchoolTrip[]> => {
  const trips = await fetchActiveSchoolTrips(
    criteria.direction,
    criteria.schoolId,
    criteria.date,
  );

  return trips
    .filter((trip) => passesCapacityAndRoute(trip, criteria))
    .map((trip) => ({
      trip,
      diff: getTimeDifferenceInMinutes(trip.departureTime, criteria.requestedTime),
    }))
    .filter(
      (entry): entry is { trip: SchoolTrip; diff: number } =>
        entry.diff !== null && entry.diff <= EXACT_MATCH_WINDOW_MINUTES,
    )
    .sort((a, b) => a.diff - b.diff)
    .map((entry) => entry.trip);
};

export const MAX_ALTERNATIVE_MINUTES = 60;

export type AlternativeTrip = {
  trip: SchoolTrip;
  diffMinutes: number;
  isAfterRequestedTime: boolean;
};

// Wider fallback used when findMatchingSchoolTrips returns nothing — closest
// suitable trips within MAX_ALTERNATIVE_MINUTES, prioritizing trips AFTER
// the requested time (AGENTS.md #6: "a student may be able to wait after
// school, but usually cannot leave before school finishes").
export const findAlternativeTrips = async (
  criteria: SchoolTripSearchCriteria,
  excludeTripIds: string[] = [],
): Promise<AlternativeTrip[]> => {
  const trips = await fetchActiveSchoolTrips(
    criteria.direction,
    criteria.schoolId,
    criteria.date,
  );

  const alternatives: AlternativeTrip[] = [];

  for (const trip of trips) {
    if (excludeTripIds.includes(trip.id)) continue;
    if (!passesCapacityAndRoute(trip, criteria)) continue;

    const signedDiff = getSignedTimeDifferenceInMinutes(
      criteria.requestedTime,
      trip.departureTime,
    );
    if (signedDiff === null) continue;

    const absDiff = Math.abs(signedDiff);
    if (absDiff > MAX_ALTERNATIVE_MINUTES) continue;

    alternatives.push({
      trip,
      diffMinutes: absDiff,
      isAfterRequestedTime: signedDiff >= 0,
    });
  }

  // Priority: trips after the requested time (closest first), then trips
  // before it (closest first) — never mixed by raw absolute difference
  // alone, per AGENTS.md #6's sort priority.
  return alternatives.sort((a, b) => {
    if (a.isAfterRequestedTime !== b.isAfterRequestedTime) {
      return a.isAfterRequestedTime ? -1 : 1;
    }
    return a.diffMinutes - b.diffMinutes;
  });
};

// ---------------------------------------------------------------------------
// Per-child return search — each child on the booking may finish school (and
// so need a return ride) at a different time, so every child is searched
// independently, always for exactly 1 seat. Thin wrappers around
// findMatchingSchoolTrips/findAlternativeTrips so the exact same matching
// rule (schoolId + date + time window + seat + destination proximity)
// governs both the "search once for the whole family" and "search once per
// child" cases — never a second, divergent matching implementation.
// ---------------------------------------------------------------------------

export type ChildReturnSearchCriteria = {
  schoolId: string;
  date: string;
  requestedTime: string;
  destinationLocation: LatLng | null;
};

export const findReturnTripsForChild = (
  criteria: ChildReturnSearchCriteria,
): Promise<SchoolTrip[]> =>
  findMatchingSchoolTrips({
    direction: "from_school",
    schoolId: criteria.schoolId,
    date: criteria.date,
    seats: 1,
    requestedTime: criteria.requestedTime,
    destination: criteria.destinationLocation,
  });

export const findAlternativeTripsForChild = (
  criteria: ChildReturnSearchCriteria,
  excludeTripIds: string[] = [],
): Promise<AlternativeTrip[]> =>
  findAlternativeTrips(
    {
      direction: "from_school",
      schoolId: criteria.schoolId,
      date: criteria.date,
      seats: 1,
      requestedTime: criteria.requestedTime,
      destination: criteria.destinationLocation,
    },
    excludeTripIds,
  );

// ---------------------------------------------------------------------------
// Booking (transaction-based, per-seat) — AGENTS.md #9
//
// Firestore rejects ANY undefined value passed to transaction.set()/set(),
// including ones nested inside arrays/objects (e.g. a childEntries[].
// childName that was never typed in — see DirectionSearchForm/trip-confirm's
// `childName: x || undefined` mappings). deepRemoveUndefined strips those
// before every school-booking write; a plain object walk (not JSON
// round-tripping) so Firestore sentinels like serverTimestamp() — which are
// class instances, not plain objects — pass through untouched.
// ---------------------------------------------------------------------------

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

export function deepRemoveUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => deepRemoveUndefined(item))
      .filter((item) => item !== undefined) as unknown as T;
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .map(([key, child]) => [key, deepRemoveUndefined(child)]),
    ) as unknown as T;
  }

  return value;
}

// Dotted/indexed paths (e.g. "childEntries[1].childName") of every undefined
// value in `value` — dev-only diagnostics, never the values themselves (no
// private user data logged).
function collectUndefinedPaths(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectUndefinedPaths(item, `${path}[${index}]`));
  }

  if (isPlainObject(value)) {
    return Object.entries(value).flatMap(([key, child]) => {
      const childPath = path ? `${path}.${key}` : key;
      return child === undefined ? [childPath] : collectUndefinedPaths(child, childPath);
    });
  }

  return [];
}

type RequiredSchoolBookingFields = {
  tripId: string;
  passengerId: string;
  driverId: string;
  direction: string;
  date: string;
  departureTime: string;
  seats: number;
  pricePerSeat: number;
  totalPrice: number;
  status: string;
  fromArea: string;
  toArea: string;
  schoolId: string;
  schoolName: string;
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

// Required-field guard, run BEFORE transaction.set() (AGENTS.md's booking
// payload must never silently save a missing required value as "") — throws
// a single clear, translated error naming every missing field so the
// passenger/driver sees an actionable message instead of a raw Firestore
// error.
const validateRequiredBookingFields = (fields: RequiredSchoolBookingFields) => {
  const missing: string[] = [];

  (
    [
      "tripId",
      "passengerId",
      "driverId",
      "direction",
      "date",
      "departureTime",
      "status",
      "fromArea",
      "toArea",
      "schoolId",
      "schoolName",
    ] as const
  ).forEach((key) => {
    if (!isNonEmptyString(fields[key])) missing.push(key);
  });

  if (!isFiniteNumber(fields.seats) || fields.seats <= 0) missing.push("seats");
  if (!isFiniteNumber(fields.pricePerSeat) || fields.pricePerSeat < 0) missing.push("pricePerSeat");
  if (!isFiniteNumber(fields.totalPrice) || fields.totalPrice < 0) missing.push("totalPrice");

  if (missing.length > 0) {
    throw new Error(i18n.t("schoolTrip.missingRequiredBookingFields", { fields: missing.join(", ") }));
  }
};

export const generateBookingGroupId = () =>
  `school_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

// A short passenger-verification code (AGENTS.md's driver/parent-child
// safety check) — cryptographically random via expo-crypto, NEVER derived
// from the booking id, phone number, date, or current time. Rejection
// sampling over 2 secure random bytes keeps the 0-9999 result uniform (no
// modulo bias). Always returned as a zero-padded STRING — "0427" must stay
// valid, so this is never stored/compared as a number.
export const generateVerificationCode = async (): Promise<string> => {
  const RANGE = 10000;
  const MAX_UNBIASED = 65536 - (65536 % RANGE);

  let value = MAX_UNBIASED;
  while (value >= MAX_UNBIASED) {
    // eslint-disable-next-line no-await-in-loop
    const bytes = await Crypto.getRandomBytesAsync(2);
    value = (bytes[0] << 8) | bytes[1];
  }

  return String(value % RANGE).padStart(4, "0");
};

export type SchoolBookingPaymentMethod = "cash" | "bit";

// A single child on this booking (return legs), or the whole family riding
// the same outbound trip together — see SchoolBooking.childEntryId/
// childEntries. Omitted entirely for a plain, pre-existing seats-only
// booking (backward compatible with every booking created before this
// feature).
export type SchoolBookingChildInfo = {
  childEntryId?: string;
  childName?: string;
  childEntries?: SchoolBookingChildEntry[];
  // The durable schoolChildren/{childId} profile for a single-child RETURN
  // booking (see SchoolBooking.childId above). Never set alongside
  // childEntries — an outbound multi-child booking carries each child's own
  // id inside childEntries[].childId instead.
  childId?: string;
  // The waiting rideRequests/{id} this RETURN booking was created to fulfil
  // (see SchoolBooking.sourceRideRequestId below) — never set for an
  // outbound booking or a return booked without ever having a waiting
  // request (a plain from-scratch search). Only bookReturnForChild ever
  // threads this through.
  sourceRideRequestId?: string;
};

const bookSingleSchoolTrip = async (
  tripId: string,
  seats: number,
  bookingGroupId: string,
  paymentMethod: SchoolBookingPaymentMethod = "cash",
  childInfo?: SchoolBookingChildInfo,
): Promise<string> => {
  const me = await getCurrentUserInfo();
  const tripRef = doc(db, SCHOOL_TRIPS_COLLECTION, tripId);
  const bookingRef = doc(collection(db, SCHOOL_BOOKINGS_COLLECTION));

  // Prevent duplicate booking for the same child and trip (AGENTS.md's
  // return-booking requirement) — a Firestore transaction can only read
  // specific document refs, not run a `where` query, so this check runs
  // just before it as a best-effort guard (the same trust boundary already
  // accepted throughout this booking system — see AGENTS.md #13's note on
  // client-run transactions).
  //
  // Also filtered by passengerId == me.id: the schoolBookings read rule
  // only allows resource.data.passengerId/driverId == request.auth.uid, and
  // a query can only be granted if its OWN where() filters prove every
  // possible result satisfies that — this childEntryId belongs to the
  // current parent's own family regardless, so this is both the correct
  // scope for the check and what makes the query valid under the rule.
  if (childInfo?.childEntryId) {
    const existing = await getDocs(
      query(
        collection(db, SCHOOL_BOOKINGS_COLLECTION),
        where("tripId", "==", tripId),
        where("passengerId", "==", me.id),
        where("childEntryId", "==", childInfo.childEntryId),
        where("status", "==", "booked"),
      ),
    );
    if (!existing.empty) {
      throw new Error(i18n.t("schoolTrip.duplicateChildBooking"));
    }
  }

  let notifyDriverId = "";
  let notifyMessage = "";

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(tripRef);

    if (!snap.exists()) {
      throw new Error(i18n.t("rides.tripNoLongerAvailable"));
    }

    const trip = normalizeSchoolTrip(snap.id, snap.data());

    if (trip.status !== "active") {
      throw new Error(i18n.t("rides.seatAvailabilityChanged"));
    }

    if (trip.availableSeats < seats) {
      throw new Error(i18n.t("rides.notEnoughSeats"));
    }

    const remainingSeats = trip.availableSeats - seats;

    transaction.update(tripRef, {
      availableSeats: remainingSeats,
      status: remainingSeats <= 0 ? "full" : "active",
      updatedAt: serverTimestamp(),
    });

    const totalPrice = trip.pricePerSeat * seats;

    // Required fields — checked BEFORE the write, not patched with silent
    // empty-string fallbacks, so a bad trip doc/caller fails loudly here
    // instead of as a raw Firestore SDK error.
    validateRequiredBookingFields({
      tripId,
      passengerId: me.id,
      driverId: trip.driverId,
      direction: trip.direction,
      date: trip.date,
      departureTime: trip.departureTime,
      seats,
      pricePerSeat: trip.pricePerSeat,
      totalPrice,
      status: "booked",
      fromArea: trip.fromAddress,
      toArea: trip.toAddress,
      schoolId: trip.schoolId,
      schoolName: trip.schoolName,
    });

    // Generated fresh for THIS booking only, after every check above has
    // passed and right before the write that actually creates it — a
    // failed/retried transaction attempt never leaves a leaked, unused code
    // lying around anywhere (AGENTS.md: "generate only after... the booking
    // transaction succeeds").
    const verificationCode = await generateVerificationCode();

    // Optional fields (bookingGroupId/childEntryId/childId/childName/
    // rideRequestId/linkedTripId/paymentReference/returnRequestedTime/
    // childEntries) are included only when they actually have a value —
    // childInfo?.childEntries especially, since each entry's own childName
    // is optional and left as literal `undefined` by the search/confirm
    // screens when the parent never typed a name (see DirectionSearchForm's
    // `childName: child.name.trim() || undefined`). deepRemoveUndefined
    // below strips those (and any other undefined, top-level or nested)
    // right before the write — Firestore's transaction.set() throws
    // "Unsupported field value: undefined" on any of them, including
    // nested ones, which is exactly what raised this bug.
    const rawBooking = {
      bookingGroupId,
      tripId,
      bookingDirection: trip.direction,

      passengerId: me.id,
      passengerName: me.name,
      passengerPhone: me.phone,

      driverId: trip.driverId,
      driverName: trip.driverName,
      driverPhone: trip.driverPhone,
      car: trip.car,
      carColor: trip.carColor,
      carPlate: trip.carPlate,

      schoolId: trip.schoolId,
      schoolName: trip.schoolName,

      fromAddress: trip.fromAddress,
      toAddress: trip.toAddress,
      // GPS pins for driver navigation + passenger live-tracking — copied
      // from the trip now so a later edit to the trip never moves a
      // passenger's already-booked pickup point.
      fromLocation: trip.fromLocation,
      toLocation: trip.toLocation,
      schoolLocation: trip.schoolLocation,
      date: trip.date,
      departureTime: trip.departureTime,

      seats,
      pricePerSeat: trip.pricePerSeat,
      totalPrice,

      childEntryId: childInfo?.childEntryId,
      childName: childInfo?.childName,
      childEntries: childInfo?.childEntries,
      childId: childInfo?.childId,
      sourceRideRequestId: childInfo?.sourceRideRequestId,

      paymentMethod,
      paymentStatus: paymentMethod === "bit" ? "mock_paid" : "cash_pending",

      status: "booked" as SchoolBookingStatus,
      tripStatus: "booked" as TripTrackingStatus,
      trackingEnabled: false,
      finishedByDriver: false,

      needsPassengerRating: false,
      ratingSubmitted: false,
      rating: null,

      verificationCode,
      verificationStatus: "pending" as VerificationStatus,
      verifiedAt: null,
      verifiedByDriverId: null,
      verificationAttempts: 0,
      verificationLockedUntil: null,

      passengerVerified: false,
      passengerVerifiedAt: null,
      tripStartedAt: null,
      tripStartedNotificationSent: false,

      bookingStatus: "confirmed" as SchoolBookingLifecycleStatus,

      deletedForPassenger: false,
      deletedForDriver: false,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (__DEV__) {
      const undefinedPaths = collectUndefinedPaths(rawBooking);
      if (undefinedPaths.length > 0) {
        console.log("[School Booking] undefined fields:", undefinedPaths);
      }
    }

    transaction.set(bookingRef, deepRemoveUndefined(rawBooking));

    notifyDriverId = trip.driverId;
    const childSuffix = childInfo?.childName ? ` (${childInfo.childName})` : "";
    notifyMessage =
      trip.direction === "to_school"
        ? `${me.name} booked your outbound school trip to ${trip.schoolName}`
        : `${me.name} booked your return school trip from ${trip.schoolName}${childSuffix}`;
  });

  if (notifyDriverId) {
    await notify({
      receiverId: notifyDriverId,
      senderId: me.id,
      type: "school_ride_booking",
      title: i18n.t("schoolTrip.newBookingNotificationTitle"),
      message: notifyMessage,
      applicationId: bookingRef.id,
      bookingId: bookingRef.id,
      category: "school",
      status: "booked",
      targetTab: "driver",
    });
  }

  return bookingRef.id;
};

// existingBookingGroupId is passed when this booking is the RETURN leg of a
// round trip whose outbound leg was already booked — the two bookings then
// share one bookingGroupId (AGENTS.md #9/#10) even though they're booked as
// two separate user actions (search outbound → book → "book a return too?"
// → search return → book), never as one combined selection screen.
export const bookSchoolTripSingle = async (
  tripId: string,
  seats: number,
  paymentMethod: SchoolBookingPaymentMethod = "cash",
  existingBookingGroupId?: string,
  childInfo?: SchoolBookingChildInfo,
): Promise<{ bookingGroupId: string; bookingId: string }> => {
  const bookingGroupId = existingBookingGroupId || generateBookingGroupId();
  const bookingId = await bookSingleSchoolTrip(
    tripId,
    seats,
    bookingGroupId,
    paymentMethod,
    childInfo,
  );
  return { bookingGroupId, bookingId };
};

// ---------------------------------------------------------------------------
// Family booking convenience wrappers — AGENTS.md's "Outbound ride
// behavior" (one multi-seat booking, tagged with every child riding it) and
// "Return booking documents" (one 1-seat booking per child, sharing a
// bookingGroupId). Both are thin, typed call sites over bookSchoolTripSingle
// — never a second booking/transaction implementation.
// ---------------------------------------------------------------------------

export const bookOutboundForChildren = async (
  tripId: string,
  childEntries: SchoolBookingChildEntry[],
  paymentMethod: SchoolBookingPaymentMethod,
  bookingGroupId: string,
): Promise<string> => {
  const { bookingId } = await bookSchoolTripSingle(
    tripId,
    childEntries.length,
    paymentMethod,
    bookingGroupId,
    { childEntries },
  );
  return bookingId;
};

export const bookReturnForChild = async (
  tripId: string,
  child: { localId: string; childName?: string; childId?: string; sourceRideRequestId?: string },
  paymentMethod: SchoolBookingPaymentMethod,
  bookingGroupId: string,
): Promise<string> => {
  const { bookingId } = await bookSchoolTripSingle(tripId, 1, paymentMethod, bookingGroupId, {
    childEntryId: child.localId,
    childName: child.childName,
    childId: child.childId,
    sourceRideRequestId: child.sourceRideRequestId,
  });

  // Best-effort linkage write-back — this is what lets My Bookings
  // recognize this new booking as the SAME logical card as the waiting
  // request it came from (see useMySchoolRows.tsx's findLinkedBooking),
  // instead of showing both a "searching" card and a new "booked" card. A
  // failure here never fails the booking itself (the booking is already
  // committed above) — the display-level fallback (childId + exact date)
  // still recognizes the pair even if this write is lost.
  if (child.sourceRideRequestId) {
    try {
      await updateDoc(doc(db, RIDE_REQUESTS_COLLECTION, child.sourceRideRequestId), {
        status: "booked" as RideRequestStatus,
        matchedBookingId: bookingId,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.log("bookReturnForChild: could not link rideRequest to booking", {
        feature: "bookReturnForChild",
        code: (error as any)?.code,
      });
    }
  }

  return bookingId;
};

// ---------------------------------------------------------------------------
// Passenger verification + trip start — the ONLY way a booking's tripStatus
// can move from "arrived_pickup" to "in_progress" (pressing "I arrived"
// only ever gets a booking to "arrived_pickup"; see ride-navigation.tsx).
// The driver checks the code shown to the booking owner (My Bookings)
// against what's stored on the booking, and a match atomically verifies +
// starts the trip in the same write. A Firestore transaction (the same
// client-trust boundary already accepted throughout this booking system,
// see AGENTS.md #13 and the schoolTrips rules' own seat-booking comment)
// rather than a Cloud Function, since this needs to run instantly at pickup
// time and this app has no other interactive-callable-function precedent;
// the driver already has Firestore read access to this exact booking doc
// regardless (see firestore.rules), so a wrong-guess lockout is this
// check's real protection, not secrecy from the driver's own client.
//
// Idempotent: calling this again after the trip has already started (e.g. a
// retried request, or the driver double-tapping the button before it
// disables) is a silent no-op — `started` comes back false so the caller
// never re-sends the trip-started notification/push or resets tripStartedAt.
// ---------------------------------------------------------------------------

export const verifyPassengerCodeAndStartTrip = async (
  bookingId: string,
  enteredCode: string,
): Promise<{ started: boolean; booking: SchoolBooking }> => {
  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t("auth.pleaseLoginFirst"));

  const bookingRef = doc(db, SCHOOL_BOOKINGS_COLLECTION, bookingId);

  // Never trust the entered code (or, defensively, the stored one) to
  // already be Western digits — an RTL/Arabic keyboard can hand back
  // Arabic-Indic digits regardless of keyboardType.
  const cleanEnteredCode = normalizeToWesternDigits(enteredCode).trim();

  let started = false;
  let resultBooking: SchoolBooking | null = null;

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(bookingRef);
    if (!snap.exists()) {
      throw new Error(i18n.t("rides.bookingNotFound"));
    }

    const booking = normalizeSchoolBooking(snap.id, snap.data());

    // The driver may only verify bookings on their own trip.
    if (booking.driverId !== user.uid) {
      throw new Error(i18n.t("workErrand.mustBeLoggedIn"));
    }

    // Idempotent success path — already started by this exact call (or a
    // prior one). Never re-compare the code, re-stamp timestamps, or signal
    // the caller to send a second notification.
    if (booking.tripStatus === "in_progress" && booking.passengerVerified && booking.tripStartedAtSeconds) {
      resultBooking = booking;
      started = false;
      return;
    }

    if (booking.tripStatus !== "arrived_pickup") {
      throw new Error(i18n.t("booking.verificationRequiredBeforeStart"));
    }

    if (!booking.verificationCode) {
      throw new Error(i18n.t("booking.codeExpired"));
    }

    const now = Date.now();
    if (
      booking.verificationLockedUntilSeconds &&
      booking.verificationLockedUntilSeconds * 1000 > now
    ) {
      throw new Error(i18n.t("booking.verificationLocked"));
    }

    // Exact string comparison of normalized values — the code is stored
    // zero-padded, and a leading-zero code ("0427") must only ever match
    // the same string; never compared as a number.
    const cleanStoredCode = normalizeToWesternDigits(booking.verificationCode).trim();

    if (cleanEnteredCode !== cleanStoredCode) {
      const attempts = booking.verificationAttempts + 1;
      const payload: any = {
        verificationAttempts: attempts,
        updatedAt: serverTimestamp(),
      };

      if (attempts >= MAX_VERIFICATION_ATTEMPTS) {
        payload.verificationLockedUntil = Timestamp.fromMillis(
          now + VERIFICATION_LOCKOUT_MINUTES * 60 * 1000,
        );
      }

      transaction.update(bookingRef, payload);

      // Never reveal the correct code, and never reveal whether the wrong
      // guess was "close" — the same generic error either way.
      throw new Error(
        attempts >= MAX_VERIFICATION_ATTEMPTS
          ? i18n.t("booking.verificationLocked")
          : i18n.t("booking.invalidVerificationCode"),
      );
    }

    // The driver's own published trip listing (Driver My Bookings' card is
    // built from THIS document, never from an individual passenger's
    // booking — see useMySchoolRows.tsx's driverRows) must be read here,
    // before any writes in this transaction, so it can be synced in the
    // same atomic commit as the booking below.
    const tripRef = doc(db, SCHOOL_TRIPS_COLLECTION, booking.tripId);
    const tripSnap = await transaction.get(tripRef);

    const nowTs = serverTimestamp();

    transaction.update(bookingRef, {
      verificationStatus: "verified" as VerificationStatus,
      verifiedAt: nowTs,
      verifiedByDriverId: user.uid,
      verificationAttempts: 0,
      passengerVerified: true,
      passengerVerifiedAt: nowTs,
      tripStatus: "in_progress" as TripTrackingStatus,
      tripStartedAt: nowTs,
      tripStartedNotificationSent: true,
      updatedAt: nowTs,
    });

    // Sync the trip the moment its FIRST passenger actually starts — this
    // is the one place Driver My Bookings reads to classify Upcoming vs
    // In Progress (getDriverTripStatus in bookingsLib.ts), so without this
    // write the driver's own card stayed stuck on "arrived_pickup" forever
    // even after the real trip had started. Guarded to only fire once (the
    // trip's own tripStatus must still be "arrived_pickup") so a second or
    // third passenger verifying on the same shared trip never re-stamps or
    // issues a redundant write.
    //
    // IMPORTANT: only tripStatus/updatedAt — never tripStartedAt here. The
    // schoolTrips security rule's driver-lifecycle update shape (this is a
    // driver-initiated write, driverId == request.auth.uid) only allows
    // ["tripStatus", "trackingEnabled", "driverLocation",
    // "driverLocationUpdatedAt", "driverOnWayAt", "arrivedPickupAt",
    // "completedAt", "finishedByDriver", "status", "updatedAt"] — adding
    // tripStartedAt here would fail that rule and abort this ENTIRE
    // transaction (including the booking update above), since every write
    // in a transaction must independently satisfy its own document's rule.
    // tripStartedAt is already correctly stamped on the booking above,
    // which is the only place any part of this app ever reads it from.
    if (tripSnap.exists() && tripSnap.data()?.tripStatus === "arrived_pickup") {
      transaction.update(tripRef, {
        tripStatus: "in_progress" as TripTrackingStatus,
        updatedAt: nowTs,
      });
    }

    // Authorizes this exact passenger to read the trip's shared live
    // location (tripLocations/{tripId} — one doc per car, several
    // authorized passengers) the moment their own trip actually starts —
    // see driverLocationTask.ts and firestore.rules. merge:true both
    // creates the doc (first passenger on this trip to verify) and grows
    // the list (later ones), matching the rules' create/update shapes.
    const tripLocationRef = doc(db, TRIP_LOCATIONS_COLLECTION, booking.tripId);
    transaction.set(
      tripLocationRef,
      {
        driverId: user.uid,
        authorizedPassengerIds: arrayUnion(booking.passengerId),
        updatedAt: nowTs,
      },
      { merge: true },
    );

    started = true;
    resultBooking = {
      ...booking,
      verificationStatus: "verified",
      verifiedByDriverId: user.uid,
      verificationAttempts: 0,
      passengerVerified: true,
      tripStatus: "in_progress",
    };
  });

  if (!resultBooking) {
    throw new Error(i18n.t("rides.bookingNotFound"));
  }

  return { started, booking: resultBooking };
};

export type RoundTripBookingResult = {
  bookingGroupId: string;
  outboundBookingId: string;
  returnBookingId: string | null;
  returnFailed: boolean;
  returnErrorMessage: string | null;
};

// Books outbound then return under the SAME bookingGroupId. If the outbound
// booking succeeds but the return trip is no longer available, this does NOT
// throw — it returns returnFailed:true so the screen can show AGENTS.md #9's
// exact message ("outbound booked, return no longer available") instead of
// silently losing the outbound booking or hiding the failure.
export const bookSchoolRoundTrip = async (
  outboundTripId: string,
  returnTripId: string,
  seats: number,
): Promise<RoundTripBookingResult> => {
  const bookingGroupId = generateBookingGroupId();

  const outboundBookingId = await bookSingleSchoolTrip(
    outboundTripId,
    seats,
    bookingGroupId,
  );

  try {
    const returnBookingId = await bookSingleSchoolTrip(
      returnTripId,
      seats,
      bookingGroupId,
    );

    return {
      bookingGroupId,
      outboundBookingId,
      returnBookingId,
      returnFailed: false,
      returnErrorMessage: null,
    };
  } catch (error: any) {
    return {
      bookingGroupId,
      outboundBookingId,
      returnBookingId: null,
      returnFailed: true,
      returnErrorMessage: error?.message || i18n.t("rides.tripNoLongerAvailable"),
    };
  }
};

// ---------------------------------------------------------------------------
// Cancellation — restores availableSeats and reopens a "full" trip
// (AGENTS.md #10/#12).
// ---------------------------------------------------------------------------

export const cancelSchoolBooking = async (bookingId: string) => {
  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t("auth.pleaseLoginFirst"));

  const bookingRef = doc(db, SCHOOL_BOOKINGS_COLLECTION, bookingId);

  let tripId = "";
  let driverId = "";
  let passengerName = "";
  let direction: SchoolTripDirection = "to_school";

  await runTransaction(db, async (transaction) => {
    const bookingSnap = await transaction.get(bookingRef);

    if (!bookingSnap.exists()) {
      throw new Error(i18n.t("rides.bookingNotFound"));
    }

    const booking = normalizeSchoolBooking(bookingSnap.id, bookingSnap.data());

    if (booking.passengerId !== user.uid) {
      throw new Error(i18n.t("workErrand.mustBeLoggedIn"));
    }

    if (booking.status === "cancelled") {
      return;
    }

    const blocked = getSchoolCancelBlockedReason(
      booking.date,
      booking.departureTime,
      booking.tripStatus,
    );
    if (blocked) throw new Error(blocked);

    tripId = booking.tripId;
    driverId = booking.driverId;
    passengerName = booking.passengerName;
    direction = booking.bookingDirection;

    transaction.update(bookingRef, {
      status: "cancelled" as SchoolBookingStatus,
      // A cancelled booking's code can never be used again (AGENTS.md).
      verificationStatus: "expired" as VerificationStatus,
      updatedAt: serverTimestamp(),
    });

    const tripRef = doc(db, SCHOOL_TRIPS_COLLECTION, booking.tripId);
    const tripSnap = await transaction.get(tripRef);

    if (tripSnap.exists()) {
      const trip = normalizeSchoolTrip(tripSnap.id, tripSnap.data());
      const restoredSeats = Math.min(
        trip.availableSeats + booking.seats,
        trip.totalSeats,
      );

      transaction.update(tripRef, {
        availableSeats: restoredSeats,
        status: trip.status === "cancelled" ? "cancelled" : "active",
        updatedAt: serverTimestamp(),
      });
    }
  });

  if (driverId) {
    await notify({
      receiverId: driverId,
      type: "cancelled",
      title: i18n.t("schoolTrip.bookingCancelledNotificationTitle"),
      message: `${passengerName} cancelled their ${
        direction === "to_school" ? "outbound" : "return"
      } school trip booking`,
      applicationId: tripId,
      bookingId,
      category: "school",
      status: "cancelled",
      targetTab: "driver",
    });
  }
};

// Hides a finished (completed/cancelled) booking from one side's own My
// Bookings list only — same soft-delete convention as hideGeneralBooking in
// bookingsLib.ts. Never touches status/seats or the other participant's view.
export const hideSchoolBooking = async (
  bookingId: string,
  viewer: "passenger" | "driver",
) => {
  await updateDoc(doc(db, SCHOOL_BOOKINGS_COLLECTION, bookingId), {
    [viewer === "passenger" ? "deletedForPassenger" : "deletedForDriver"]: true,
    updatedAt: serverTimestamp(),
  });
};

// ---------------------------------------------------------------------------
// Rating — same algorithm as rideBookingLib.ts's submitRideRating (running
// average on the driver's users/{driverId} doc + one driverReviews doc),
// just targeting schoolBookings/driverId instead of bookings/driverId —
// never a second rating system.
// ---------------------------------------------------------------------------

export const submitSchoolBookingRating = async (
  bookingId: string,
  booking: SchoolBooking,
  rating: number,
  comment: string,
) => {
  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t("auth.pleaseLoginFirst"));

  const cleanRating = Math.round(rating);
  if (!Number.isInteger(cleanRating) || cleanRating < 1 || cleanRating > 5) {
    throw new Error(i18n.t("validation.invalidRating"));
  }

  const cleanComment = comment.trim();

  if (!booking.driverId || booking.driverId === user.uid) {
    await updateDoc(doc(db, SCHOOL_BOOKINGS_COLLECTION, bookingId), {
      rating: cleanRating,
      reviewComment: cleanComment,
      ratingSubmitted: true,
      needsPassengerRating: false,
      ratedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return;
  }

  const bookingRef = doc(db, SCHOOL_BOOKINGS_COLLECTION, bookingId);
  const driverRef = doc(db, "users", booking.driverId);
  // bookingId AS the review doc id — see firestore.rules' driverReviews
  // `allow create`, which requires this to match and rejects a second
  // rating attempt for the same booking outright.
  const reviewRef = doc(db, "driverReviews", bookingId);

  const ratingWritePaths = {
    review: `driverReviews/${bookingId}`,
    booking: `${SCHOOL_BOOKINGS_COLLECTION}/${bookingId}`,
    driver: `users/${booking.driverId}`,
  };
  console.log("[rating] transaction started", ratingWritePaths);

  try {
  await runTransaction(db, async (transaction) => {
    const bookingSnap = await transaction.get(bookingRef);

    if (!bookingSnap.exists()) {
      throw new Error(i18n.t("rides.bookingNotFound"));
    }

    const bookingData: any = bookingSnap.data();

    // Never trust the already-loaded `booking` object — re-verify ownership
    // + real completion against the current server state.
    if (bookingData.passengerId !== user.uid) {
      throw new Error(i18n.t("workErrand.mustBeLoggedIn"));
    }
    if (bookingData.tripStatus !== "completed" || bookingData.status !== "completed") {
      throw new Error(i18n.t("booking.tripNotCompletedYet"));
    }
    if (bookingData.ratingSubmitted === true) {
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
      bookingId,
      driverId: booking.driverId,
      driverName: booking.driverName || "Driver",
      passengerId: user.uid,
      passengerName: booking.passengerName || "Passenger",
      rating: cleanRating,
      comment: cleanComment,
      category: "school",
      from: booking.fromAddress || "",
      to: booking.toAddress || "",
      date: booking.date || "",
      time: booking.departureTime || "",
      createdAt: serverTimestamp(),
    });

    transaction.update(bookingRef, {
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

    console.log("[rating] transaction succeeded", { bookingId });
  } catch (error) {
    console.log("[rating] transaction failed", { ...ratingWritePaths, error });
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Driver-cancellation replacement offers — when a driver cancels a trip
// that already has bookings, the onSchoolTripCancelled Cloud Function
// (functions/index.js) marks each affected booking `bookingStatus:
// "replacement_pending"`, searches for alternative trips using the exact
// same matching rule as every other school-trip search (schoolId,
// direction, date, seats, coordinates/distance — never translated
// name/city text), and creates ONE of these per affected booking (or
// per-child group, for a multi-child outbound booking). The parent reviews
// and explicitly accepts one candidate here — nothing is ever auto-booked.
// ---------------------------------------------------------------------------

export const SCHOOL_REPLACEMENT_OFFERS_COLLECTION = "schoolReplacementOffers";

export type ReplacementOfferStatus = "pending" | "offered" | "accepted" | "declined" | "expired";

export interface ReplacementOffer {
  id: string;
  originalBookingId: string;
  originalTripId: string;
  parentId: string;
  childEntryIds?: string[];
  direction: SchoolTripDirection;
  seatsNeeded: number;
  candidateTripIds: string[];
  status: ReplacementOfferStatus;
  acceptedTripId: string | null;
  acceptedBookingId: string | null;
  createdAtSeconds: number;
  expiresAtSeconds: number;
}

export const normalizeReplacementOffer = (id: string, data: any): ReplacementOffer => ({
  id,
  originalBookingId: data.originalBookingId || "",
  originalTripId: data.originalTripId || "",
  parentId: data.parentId || "",
  childEntryIds: Array.isArray(data.childEntryIds) ? data.childEntryIds : undefined,
  direction: normalizeSchoolTripDirection(data.direction),
  seatsNeeded: Number(data.seatsNeeded) || 1,
  candidateTripIds: Array.isArray(data.candidateTripIds) ? data.candidateTripIds : [],
  status: (["pending", "offered", "accepted", "declined", "expired"].includes(data.status)
    ? data.status
    : "pending") as ReplacementOfferStatus,
  acceptedTripId: data.acceptedTripId || null,
  acceptedBookingId: data.acceptedBookingId || null,
  createdAtSeconds: data.createdAt?.seconds || 0,
  expiresAtSeconds: data.expiresAt?.seconds || 0,
});

// Every non-declined/non-expired offer for the signed-in parent — surfaced
// in My Bookings and reachable from the "school_trip_replacement"
// notification (see notifications.tsx).
export const subscribeMyReplacementOffers = (
  onUpdate: (offers: ReplacementOffer[]) => void,
): (() => void) => {
  const user = auth.currentUser;
  if (!user) {
    onUpdate([]);
    return () => {};
  }

  return onSnapshot(
    query(collection(db, SCHOOL_REPLACEMENT_OFFERS_COLLECTION), where("parentId", "==", user.uid)),
    (snap) => {
      onUpdate(snap.docs.map((d) => normalizeReplacementOffer(d.id, d.data())));
    },
    () => onUpdate([]),
  );
};

export const fetchReplacementOffer = async (offerId: string): Promise<ReplacementOffer | null> => {
  const snap = await getDoc(doc(db, SCHOOL_REPLACEMENT_OFFERS_COLLECTION, offerId));
  return snap.exists() ? normalizeReplacementOffer(snap.id, snap.data()) : null;
};

// Resolves the offer from the ORIGINAL booking it was created for — used by
// the "Review offers" link on that booking's own My Bookings card, which
// only knows its own bookingId (not the offer's id).
export const fetchReplacementOfferByBookingId = async (
  originalBookingId: string,
): Promise<ReplacementOffer | null> => {
  const snap = await getDocs(
    query(
      collection(db, SCHOOL_REPLACEMENT_OFFERS_COLLECTION),
      where("originalBookingId", "==", originalBookingId),
    ),
  );

  if (snap.empty) return null;
  return normalizeReplacementOffer(snap.docs[0].id, snap.docs[0].data());
};

// Live data for every still-existing candidate trip (a candidate found at
// cancellation time may since have filled up, been cancelled, or expired —
// the review screen always re-reads before showing/accepting anything,
// never trusts the offer's own stored snapshot as booking-eligible truth).
export const fetchReplacementCandidateTrips = async (
  offer: ReplacementOffer,
): Promise<SchoolTrip[]> => {
  const snaps = await Promise.all(
    offer.candidateTripIds.map((tripId) => getDoc(doc(db, SCHOOL_TRIPS_COLLECTION, tripId))),
  );

  return snaps
    .filter((snap) => snap.exists())
    .map((snap) => normalizeSchoolTrip(snap.id, snap.data()))
    .filter((trip) => trip.status === "active" && trip.availableSeats >= offer.seatsNeeded);
};

// The parent explicitly accepts ONE candidate trip. Atomic: reads the
// replacement trip fresh, confirms seats, creates the replacement booking
// (with a BRAND NEW verification code — never the old booking's code),
// decrements the replacement trip's seats, marks the old booking replaced
// (its own code already expired when the driver's cancellation ran), and
// marks the offer accepted — all in one transaction, so a failure partway
// through never leaves partial replacement data (no seats decremented
// without a booking, no booking without the old one being marked replaced).
export const acceptReplacementOffer = async (
  offerId: string,
  chosenTripId: string,
  paymentMethod: SchoolBookingPaymentMethod,
): Promise<{ bookingId: string }> => {
  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t("auth.pleaseLoginFirst"));

  const offerRef = doc(db, SCHOOL_REPLACEMENT_OFFERS_COLLECTION, offerId);
  const tripRef = doc(db, SCHOOL_TRIPS_COLLECTION, chosenTripId);
  const bookingRef = doc(collection(db, SCHOOL_BOOKINGS_COLLECTION));

  const bookingId = await runTransaction(db, async (transaction) => {
    const offerSnap = await transaction.get(offerRef);
    if (!offerSnap.exists()) {
      throw new Error(i18n.t("rides.bookingNotFound"));
    }

    const offer = normalizeReplacementOffer(offerSnap.id, offerSnap.data());

    if (offer.parentId !== user.uid) {
      throw new Error(i18n.t("workErrand.mustBeLoggedIn"));
    }

    // Prevent accepting twice, or two different alternatives.
    if (offer.status === "accepted") {
      throw new Error(i18n.t("booking.replacementAlreadyAccepted"));
    }
    if (offer.status === "declined" || offer.status === "expired") {
      throw new Error(i18n.t("booking.replacementNoLongerAvailable"));
    }
    if (!offer.candidateTripIds.includes(chosenTripId)) {
      throw new Error(i18n.t("rides.tripNoLongerAvailable"));
    }

    const oldBookingRef = doc(db, SCHOOL_BOOKINGS_COLLECTION, offer.originalBookingId);
    const oldBookingSnap = await transaction.get(oldBookingRef);
    if (!oldBookingSnap.exists()) {
      throw new Error(i18n.t("rides.bookingNotFound"));
    }
    const oldBooking = normalizeSchoolBooking(oldBookingSnap.id, oldBookingSnap.data());

    if (oldBooking.replacedByBookingId) {
      throw new Error(i18n.t("booking.replacementAlreadyAccepted"));
    }

    const tripSnap = await transaction.get(tripRef);
    if (!tripSnap.exists()) {
      throw new Error(i18n.t("rides.tripNoLongerAvailable"));
    }
    const trip = normalizeSchoolTrip(tripSnap.id, tripSnap.data());

    if (trip.status !== "active") {
      throw new Error(i18n.t("rides.seatAvailabilityChanged"));
    }
    if (trip.availableSeats < offer.seatsNeeded) {
      throw new Error(i18n.t("rides.notEnoughSeats"));
    }

    const remainingSeats = trip.availableSeats - offer.seatsNeeded;

    transaction.update(tripRef, {
      availableSeats: remainingSeats,
      status: remainingSeats <= 0 ? "full" : "active",
      updatedAt: serverTimestamp(),
    });

    const totalPrice = trip.pricePerSeat * offer.seatsNeeded;

    validateRequiredBookingFields({
      tripId: chosenTripId,
      passengerId: user.uid,
      driverId: trip.driverId,
      direction: trip.direction,
      date: trip.date,
      departureTime: trip.departureTime,
      seats: offer.seatsNeeded,
      pricePerSeat: trip.pricePerSeat,
      totalPrice,
      status: "booked",
      fromArea: trip.fromAddress,
      toArea: trip.toAddress,
      schoolId: trip.schoolId,
      schoolName: trip.schoolName,
    });

    // Brand new code — never copied from the booking being replaced.
    const verificationCode = await generateVerificationCode();

    const rawBooking = {
      bookingGroupId: oldBooking.bookingGroupId || generateBookingGroupId(),
      tripId: chosenTripId,
      bookingDirection: trip.direction,

      passengerId: user.uid,
      passengerName: oldBooking.passengerName,
      passengerPhone: oldBooking.passengerPhone,

      driverId: trip.driverId,
      driverName: trip.driverName,
      driverPhone: trip.driverPhone,
      car: trip.car,
      carColor: trip.carColor,
      carPlate: trip.carPlate,

      schoolId: trip.schoolId,
      schoolName: trip.schoolName,

      fromAddress: trip.fromAddress,
      toAddress: trip.toAddress,
      fromLocation: trip.fromLocation,
      toLocation: trip.toLocation,
      schoolLocation: trip.schoolLocation,
      date: trip.date,
      departureTime: trip.departureTime,

      seats: offer.seatsNeeded,
      pricePerSeat: trip.pricePerSeat,
      totalPrice,

      childEntryId: oldBooking.childEntryId,
      childName: oldBooking.childName,
      childEntries: oldBooking.childEntries,
      childId: oldBooking.childId,

      paymentMethod,
      paymentStatus: paymentMethod === "bit" ? "mock_paid" : "cash_pending",

      status: "booked" as SchoolBookingStatus,
      tripStatus: "booked" as TripTrackingStatus,
      trackingEnabled: false,
      finishedByDriver: false,

      needsPassengerRating: false,
      ratingSubmitted: false,
      rating: null,

      verificationCode,
      verificationStatus: "pending" as VerificationStatus,
      verifiedAt: null,
      verifiedByDriverId: null,
      verificationAttempts: 0,
      verificationLockedUntil: null,

      passengerVerified: false,
      passengerVerifiedAt: null,
      tripStartedAt: null,
      tripStartedNotificationSent: false,

      bookingStatus: "replacement_confirmed" as SchoolBookingLifecycleStatus,
      replacesBookingId: oldBooking.id,

      deletedForPassenger: false,
      deletedForDriver: false,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    transaction.set(bookingRef, deepRemoveUndefined(rawBooking));

    transaction.update(oldBookingRef, {
      bookingStatus: "replacement_confirmed" as SchoolBookingLifecycleStatus,
      replacedByBookingId: bookingRef.id,
      replacementTripId: chosenTripId,
      replacementConfirmedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    transaction.update(offerRef, {
      status: "accepted" as ReplacementOfferStatus,
      acceptedTripId: chosenTripId,
      acceptedBookingId: bookingRef.id,
      updatedAt: serverTimestamp(),
    });

    return bookingRef.id;
  });

  const tripSnapForNotify = await getDoc(tripRef);
  if (tripSnapForNotify.exists()) {
    const trip = normalizeSchoolTrip(tripSnapForNotify.id, tripSnapForNotify.data());
    if (trip.driverId) {
      await notify({
        receiverId: trip.driverId,
        senderId: user.uid,
        type: "school_ride_booking",
        title: i18n.t("schoolTrip.newBookingNotificationTitle"),
        message: `A parent accepted a replacement booking for your ${
          trip.direction === "to_school" ? "outbound" : "return"
        } school trip to ${trip.schoolName}`,
        applicationId: bookingId,
        bookingId,
        category: "school",
        status: "booked",
        targetTab: "driver",
      });
    }
  }

  return { bookingId };
};

export const declineReplacementOffer = async (offerId: string): Promise<void> => {
  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t("auth.pleaseLoginFirst"));

  const offerRef = doc(db, SCHOOL_REPLACEMENT_OFFERS_COLLECTION, offerId);

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(offerRef);
    if (!snap.exists()) return;

    const offer = normalizeReplacementOffer(snap.id, snap.data());
    if (offer.parentId !== user.uid) {
      throw new Error(i18n.t("workErrand.mustBeLoggedIn"));
    }
    if (offer.status === "accepted") {
      throw new Error(i18n.t("booking.replacementAlreadyAccepted"));
    }

    transaction.update(offerRef, {
      status: "declined" as ReplacementOfferStatus,
      updatedAt: serverTimestamp(),
    });
  });
};

// ---------------------------------------------------------------------------
// Ride requests — waiting list for a return ride when no exact/alternative
// trip exists yet (AGENTS.md #7).
// ---------------------------------------------------------------------------

export type CreateRideRequestInput = {
  // One request is always exactly one child (AGENTS.md #3's per-child
  // waiting requests) — childEntryId matches the SchoolPassengerEntry this
  // request was created for.
  childEntryId: string;
  childId?: string;
  childName?: string;

  schoolId: string;
  schoolName: string;
  schoolAddress: string;
  schoolLocation: LatLng | null;
  // The return trip's "From" (school area) — see RideRequest.fromArea.
  fromArea: string;
  fromLocation: LatLng | null;
  // The return trip's "To" (the parent's home/destination) — what matching
  // actually runs against.
  toArea: string;
  destinationLocation: LatLng | null;
  requestedDate: string;
  requestedTime: string;
  // Always 1 in practice (one child = one seat) — kept as an explicit input
  // rather than hardcoded so a future multi-seat-per-child case isn't a
  // breaking type change.
  seats: number;
};

export const findDuplicateRideRequest = async (
  input: CreateRideRequestInput,
): Promise<RideRequest | null> => {
  const user = auth.currentUser;
  if (!user) return null;

  const q = query(
    collection(db, RIDE_REQUESTS_COLLECTION),
    where("parentId", "==", user.uid),
    where("schoolId", "==", input.schoolId),
    where("requestedDate", "==", input.requestedDate),
    where("status", "==", "waiting"),
  );

  const snap = await getDocs(q);

  const match = snap.docs
    .map((d) => normalizeRideRequest(d.id, d.data()))
    .find(
      (existing) =>
        existing.childEntryId === input.childEntryId &&
        existing.requestedTime === input.requestedTime &&
        existing.toArea === input.toArea &&
        existing.seats === input.seats,
    );

  return match || null;
};

export const createRideRequest = async (
  input: CreateRideRequestInput,
): Promise<string> => {
  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t("validation.mustBeLoggedInToBook"));

  const duplicate = await findDuplicateRideRequest(input);
  if (duplicate) return duplicate.id;

  const ref = await addDoc(collection(db, RIDE_REQUESTS_COLLECTION), {
    parentId: user.uid,
    userId: user.uid,

    childEntryId: input.childEntryId,
    childId: input.childId || null,
    childName: input.childName || null,

    tripType: "school",
    direction: "from_school",

    schoolId: input.schoolId,
    schoolName: input.schoolName,
    schoolAddress: input.schoolAddress,
    schoolLocation: input.schoolLocation,

    fromArea: input.fromArea,
    fromLocation: input.fromLocation,

    toArea: input.toArea,
    destinationLocation: input.destinationLocation,

    requestedDate: input.requestedDate,
    requestedTime: input.requestedTime,
    seats: input.seats,

    maxTimeDifferenceMinutes: MAX_ALTERNATIVE_MINUTES,

    status: "waiting" as RideRequestStatus,

    matchedTripId: null,
    matchedTripIds: [],
    notifiedTripIds: [],
    lastNotifiedAt: null,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return ref.id;
};

// ---------------------------------------------------------------------------
// Client-side match-and-notify — AGENTS.md #8, run immediately after a
// driver publishes a `from_school` trip (see createSchoolRoundTrip below).
//
// The Cloud Function in functions/index.js implements the exact same rule
// server-side, but that function only runs once actually deployed
// (`firebase deploy --only functions`, requiring the Blaze plan) — until
// then, or as a redundant safety net afterward, this is what makes "Notify
// me when a suitable ride becomes available" actually notify someone. Both
// paths write to the SAME `rideRequests`/`notifications` collections
// through the SAME `notify()` helper used everywhere else in the app —
// never a second, parallel notification system.
// ---------------------------------------------------------------------------

export const matchRideRequestsForNewTrip = async (trip: SchoolTrip): Promise<void> => {
  if (trip.direction !== "from_school" || trip.status !== "active") return;

  let snap;
  try {
    snap = await getDocs(
      query(
        collection(db, RIDE_REQUESTS_COLLECTION),
        where("status", "==", "waiting"),
        where("schoolId", "==", trip.schoolId),
        where("requestedDate", "==", trip.date),
      ),
    );
  } catch (error) {
    // Best-effort — a matching failure (e.g. a missing index) must never
    // block the trip publish flow that just succeeded.
    console.log("matchRideRequestsForNewTrip: could not query rideRequests", error);
    return;
  }

  if (snap.empty) return;

  const routeStart = trip.schoolLocation;
  const routeEnd = trip.toLocation;

  await Promise.all(
    snap.docs.map(async (requestDoc) => {
      const request = normalizeRideRequest(requestDoc.id, requestDoc.data());

      if (request.notifiedTripIds.includes(trip.id)) return;
      if (trip.availableSeats < request.seats) return;

      const diff = getTimeDifferenceInMinutes(trip.departureTime, request.requestedTime);
      if (diff === null || diff > request.maxTimeDifferenceMinutes) return;

      if (
        request.destinationLocation &&
        !isDestinationNearRoute(request.destinationLocation, routeStart, routeEnd)
      ) {
        return;
      }

      try {
        await updateDoc(doc(db, RIDE_REQUESTS_COLLECTION, request.id), {
          status: "matched" as RideRequestStatus,
          matchedTripId: trip.id,
          matchedTripIds: arrayUnion(trip.id),
          notifiedTripIds: arrayUnion(trip.id),
          lastNotifiedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        // Identify the correct child in the notification text whenever this
        // request has one (AGENTS.md #3: "the notification must identify
        // the correct child") — falls back to the generic message for the
        // rare legacy request created before per-child requests existed.
        const message = request.childName
          ? i18n.t("schoolTrip.tripMatchFoundForChildMessage", {
              childName: request.childName,
              school: trip.schoolName,
              time: trip.departureTime,
              destination: trip.toArea,
            })
          : i18n.t("schoolTrip.tripMatchFoundMessage", {
              school: trip.schoolName,
              time: trip.departureTime,
              destination: trip.toArea,
            });

        await notify({
          receiverId: request.parentId,
          type: "school_trip_match",
          title: i18n.t("schoolTrip.tripMatchFound"),
          message,
          applicationId: trip.id,
          bookingId: trip.id,
          requestId: request.id,
          childEntryId: request.childEntryId,
          childName: request.childName,
          // THE ROOT CAUSE this line fixes: request.childId was never
          // carried onto this notification, so tapping it (see
          // notifications.tsx's "school_trip_match" handler →
          // trip-confirm.tsx → ride-payment.tsx → bookReturnForChild)
          // produced a schoolBookings document with childEntryId/schoolId/
          // date/bookingDirection all correct but childId entirely MISSING
          // (bookSingleSchoolTrip's deepRemoveUndefined strips an undefined
          // childId before the write). A booking missing childId is
          // invisible to anything that looks a child up by childId — most
          // importantly the School Kiosk (schoolKiosk.ts queries
          // schoolBookings by childId), which is why a real, driver-visible
          // "driver_on_way" booking could still show "no_return_today" on
          // the kiosk for the exact same child/date.
          childId: request.childId,
          category: "school",
          status: "matched",
          targetTab: "passenger",
        });
      } catch (error) {
        // One failing match (e.g. a rules/permission hiccup) must not stop
        // the rest of the batch from being checked.
        console.log("matchRideRequestsForNewTrip: match failed for request", request.id, error);
      }
    }),
  );
};

export const cancelRideRequest = async (requestId: string) => {
  await updateDoc(doc(db, RIDE_REQUESTS_COLLECTION, requestId), {
    status: "cancelled" as RideRequestStatus,
    updatedAt: serverTimestamp(),
  });
};

// Pure per-user My Bookings view-hide — see RideRequest.hiddenForParent
// above. Never touches `status`, so a waiting/matched request keeps being
// matched/notified normally; only "Clear All" (useMySchoolRows.tsx's
// clearAllSchoolRows) ever calls this, since a waiting request has no other
// individual hide affordance today (only Cancel, which this deliberately
// never calls).
export const hideRideRequest = async (requestId: string) => {
  await updateDoc(doc(db, RIDE_REQUESTS_COLLECTION, requestId), {
    hiddenForParent: true,
    updatedAt: serverTimestamp(),
  });
};

// A waiting request whose date/time has already passed is stale — flip it to
// "expired" so it never gets matched/notified again (AGENTS.md #12). Called
// lazily wherever a parent's own requests are read (no Cloud Scheduler
// required for this; the scheduled Cloud Function in functions/index.js is a
// belt-and-suspenders server-side sweep for requests nobody ever re-opens
// the app to see).
const isRequestExpired = (requestData: RideRequest, now: Date = new Date()): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(requestData.requestedDate || "");
  if (!match) return false;

  const cleanTime = normalizeTime(requestData.requestedTime) || "23:59";
  const [hours, minutes] = cleanTime.split(":").map(Number);

  const requestedAt = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    hours,
    minutes,
  );

  return requestedAt.getTime() < now.getTime();
};

export const subscribeMyRideRequests = (
  onUpdate: (requests: RideRequest[]) => void,
): (() => void) => {
  const user = auth.currentUser;
  if (!user) {
    onUpdate([]);
    return () => {};
  }

  return onSnapshot(
    query(
      collection(db, RIDE_REQUESTS_COLLECTION),
      where("parentId", "==", user.uid),
    ),
    (snap) => {
      const requests = snap.docs.map((d) => normalizeRideRequest(d.id, d.data()));

      requests
        .filter((r) => r.status === "waiting" && isRequestExpired(r))
        .forEach((r) => {
          updateDoc(doc(db, RIDE_REQUESTS_COLLECTION, r.id), {
            status: "expired",
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        });

      onUpdate(requests);
    },
    () => onUpdate([]),
  );
};

// ---------------------------------------------------------------------------
// Live single-trip subscription — used by the trip details/confirm screen,
// including when opened from a "suitable ride found" notification tap.
// ---------------------------------------------------------------------------

export const subscribeSchoolTrip = (
  tripId: string,
  onUpdate: (trip: SchoolTrip | null) => void,
): (() => void) =>
  onSnapshot(
    doc(db, SCHOOL_TRIPS_COLLECTION, tripId),
    (snap) => {
      onUpdate(snap.exists() ? normalizeSchoolTrip(snap.id, snap.data()) : null);
    },
    (error) => {
      console.log("Listener failed:", {
        feature: "subscribeSchoolTrip",
        collection: SCHOOL_TRIPS_COLLECTION,
        docId: tripId,
        code: error.code,
        message: error.message,
      });
      onUpdate(null);
    },
  );

export const fetchDriverRating = async (
  driverId: string,
): Promise<{ ratingAverage: number; ratingCount: number; photoUrl: string | null }> => {
  if (!driverId) return { ratingAverage: 0, ratingCount: 0, photoUrl: null };

  try {
    const snap = await getDoc(doc(db, "users", driverId));
    if (snap.exists()) {
      const data = snap.data();
      return {
        ratingAverage: Number(data.ratingAverage) || 0,
        ratingCount: Number(data.ratingCount) || 0,
        photoUrl: data.photoUrl || data.photoURL || null,
      };
    }
  } catch {
    // Keep 0/0/null.
  }

  return { ratingAverage: 0, ratingCount: 0, photoUrl: null };
};
