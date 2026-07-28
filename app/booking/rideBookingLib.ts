// ---------------------------------------------------------------------------
// Personal Ride – booking flow (passenger books a driver → ride happens)
//
// Flow: passenger picks a driver → pays (Cash / mock Card) → a booking doc is
// created with status "booked" → driver starts ("on_the_way") → driver arrives
// ("arrived") → passenger finishes + rates ("completed").
//
// Collections used:
//   - bookings        (one doc per booked personal ride; category "personal_ride")
//   - driverReviews   (one doc per completed ride the passenger rated)
//   - users/{driverId}(ratingAverage + ratingCount summary — updated server-side
//                       by functions/index.js's onDriverReviewCreated, never by
//                       this client, which has no write access to another
//                       user's profile)
//   - notifications   (per-user in-app updates; reuses notify() from workErrandLib)
//
// Payment is mock/demo only: the full card number and CVV are NEVER stored –
// only the last 4 digits (cardLast4). Navigation uses the passenger's real GPS
// (passengerPickupLocation), never the typed city text.
// ---------------------------------------------------------------------------

import {
  addDoc,
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { auth, db } from "../../firebase";
import i18n from "../i18n";
import {
  canStartTrip,
  DriverLiveLocation,
  DRIVER_CANCEL_LOCK_HOURS,
  getStartTripBlockedReason,
  getTimeBasedCancelBlockedReason,
  PASSENGER_CANCEL_LOCK_HOURS,
  TripTrackingStatus,
} from "./bookingsLib";
import {
  CancellationError,
  CancellationStatusInput,
  eligibilityReasonToErrorCode,
  getCancellationEligibility,
} from "./cancellationEligibility";

import {
  CancellationStandingResult,
  evaluateDriverCancellationStanding,
  readExistingCancellationViolation,
  writeCancellationViolationIfNew,
} from "./driverViolationsLib";
import { GeoPoint, notify } from "./work-errand/workErrandLib";

export const RIDE_CATEGORY = "personal_ride";

export type RideStatus =
  | "booked"
  | "on_the_way"
  | "arrived"
  | "completed"
  | "cancelled";

export const RIDE_ACTIVE_STATUSES: RideStatus[] = [
  "booked",
  "on_the_way",
  "arrived",
];

export const isActiveRideStatus = (status: string) =>
  RIDE_ACTIVE_STATUSES.includes(status as RideStatus);

export const RIDE_STATUS_LABEL: Record<RideStatus, string> = {
  booked: "Ride booked",
  on_the_way: "Driver is on the way",
  arrived: "Driver arrived",
  completed: "Completed",
  cancelled: "Cancelled",
};

export type RidePayment =
  | { method: "cash" }
  | { method: "card"; cardLast4: string }
  | { method: "bit" };

const getLast3Digits = (value: string) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 3 ? digits.slice(-3) : digits;
};

// ---------------------------------------------------------------------------
// Create a booking
// ---------------------------------------------------------------------------

export type CreateRideBookingInput = {
  driverId: string;
  driverName: string;
  driverPhone: string;

  driverCar?: string;
  driverCarColor?: string;
  driverCarPlateLast3?: string;

  routeId: string;
  from: string;
  to: string;
  schoolName?: string;
  destinationDetails?: string;
  date: string;
  day: string;
  time: string;
  seats: number | null;
  price: number | null;
  pickup: GeoPoint | null;
  payment: RidePayment;
};

export const createRideBooking = async (
  input: CreateRideBookingInput,
): Promise<string> => {
  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t("validation.mustBeLoggedInToBook"));

  let passengerName = user.displayName || "Passenger";
  let passengerPhone = "";

  try {
    const snap = await getDoc(doc(db, "users", user.uid));

    if (snap.exists()) {
      const data = snap.data();
      passengerName = data.name || passengerName;
      passengerPhone = data.phone || "";
    }
  } catch {
    // fallback
  }

  const paymentFields =
    input.payment.method === "cash"
      ? {
          paymentMethod: "cash",
          paymentStatus: "cash_selected",
          cardLast4: null,
        }
      : input.payment.method === "bit"
        ? {
            paymentMethod: "bit",
            paymentStatus: "mock_paid",
            cardLast4: null,
          }
        : {
            paymentMethod: "card",
            paymentStatus: "mock_paid",
            cardLast4: input.payment.cardLast4.slice(-4),
          };

  const pickup =
    input.pickup &&
    typeof input.pickup.latitude === "number" &&
    typeof input.pickup.longitude === "number"
      ? {
          latitude: input.pickup.latitude,
          longitude: input.pickup.longitude,
          address: input.pickup.address || "",
        }
      : null;

  const cleanPlateLast3 = getLast3Digits(input.driverCarPlateLast3 || "");

  const ref = await addDoc(collection(db, "bookings"), {
    category: RIDE_CATEGORY,

    passengerId: user.uid,
    passengerName,
    passengerPhone,

    driverId: input.driverId || null,
    driverName: input.driverName || "Driver",
    driverPhone: input.driverPhone || "",

    driverCar: input.driverCar || "",
    driverCarColor: input.driverCarColor || "",
    driverCarPlateLast3: cleanPlateLast3,

    routeId: input.routeId || null,

    from: input.from || "",
    to: input.to || "",
    date: input.date || "",
    day: input.day || "",
    time: input.time || "",
    seats: input.seats ?? null,
    price: input.price ?? null,

    passengerPickupLocation: pickup,

    ...paymentFields,

    status: "booked",
    roleType: "passenger_booking",

    deletedForPassenger: false,
    deletedForDriver: false,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),

    startedAt: null,
    arrivedAt: null,
    completedAt: null,

    rating: null,
    reviewComment: null,
  });

  if (input.driverId) {
    await notify({
      receiverId: input.driverId,
      senderId: user.uid,
      type: "personal_ride_booking",
      title: "New ride booking",
      message: `${passengerName} booked a ride with you`,
      applicationId: ref.id,
      bookingId: ref.id,
      category: RIDE_CATEGORY,
      status: "booked",
      targetTab: "driver",
    });
  }

  return ref.id;
};

// ---------------------------------------------------------------------------
// Hide booking from one side only
// ---------------------------------------------------------------------------

export const hideRideBookingForPassenger = async (bookingId: string) => {
  await updateDoc(doc(db, "bookings", bookingId), {
    deletedForPassenger: true,
    updatedAt: serverTimestamp(),
  });
};

export const hideRideBookingForDriver = async (
  bookingId: string,
  routeId?: string | null,
) => {
  await updateDoc(doc(db, "bookings", bookingId), {
    deletedForDriver: true,
    updatedAt: serverTimestamp(),
  });

  // Also hide the original driverRoutes card so it doesn't reappear once the
  // driver removes the matching booking card.
  if (routeId) {
    await updateDoc(doc(db, "driverRoutes", routeId), {
      deletedForDriver: true,
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  }
};

// ---------------------------------------------------------------------------
// Cancellation — a real status change (never confused with hide above, which
// only affects one side's own list). No shared capacity to restore here: a
// personal_ride booking is a direct 1:1 driver/passenger match created by
// createRideBooking above, not a seat taken from a shared driverRoutes pool.
// ---------------------------------------------------------------------------

export const getRideCancelBlockedReason = (
  ride: RideBooking,
  cancelledBy: "passenger" | "driver" = "passenger",
  now: Date = new Date(),
): string | null => {
  if (ride.status !== "booked") {
    return i18n.t("workErrand.cannotCancelAnymore");
  }

  const hours =
    cancelledBy === "driver" ? DRIVER_CANCEL_LOCK_HOURS : PASSENGER_CANCEL_LOCK_HOURS;

  return getTimeBasedCancelBlockedReason(ride, hours, now);
};

// `ride` is used ONLY to locate the doc's category/shape at the call site —
// every field actually validated (ownership, status, date/time) is re-read
// fresh from Firestore inside the transaction below, never trusted from this
// possibly-stale caller-held card. Throws a CancellationError with a stable
// code (never a raw Firestore/SDK error) — see bookingsLib.ts's
// translateCancellationError for the UI-facing message mapping.
export const cancelRideBooking = async (
  bookingId: string,
  ride: RideBooking,
  cancelledBy: "passenger" | "driver",
): Promise<CancellationStandingResult | null> => {
  const user = auth.currentUser;
  if (!user) throw new CancellationError("NOT_AUTHORIZED");

  const bookingRef = doc(db, "bookings", bookingId);

  let notifyReceiverId = "";
  let notifyPassengerName = "";
  let notifyDriverName = "";
  let didCancel = false;
  let driverIdForViolation = "";
  let violationCreated = false;

  // PHASE 1 (the transaction's only read) then PHASE 2 (its only write) —
  // never a read after a write in the same transaction.
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(bookingRef);
    if (!snap.exists()) throw new CancellationError("DOCUMENT_NOT_FOUND");

    const current = normalizeRideBooking(snap.id, snap.data());

    const expectedUid = cancelledBy === "driver" ? current.driverId : current.passengerId;
    if (!expectedUid || expectedUid !== user.uid) {
      throw new CancellationError("NOT_AUTHORIZED");
    }

    // Already cancelled — safe no-op (never a second cancellation
    // notification, never re-evaluated against the time window).
    if (current.status === "cancelled") return;

    const statusInput: CancellationStatusInput =
      current.status === "completed"
        ? "completed"
        : current.status === "booked"
          ? "booked"
          : "started";

    const eligibility = getCancellationEligibility({
      role: cancelledBy,
      date: current.date,
      time: current.time,
      status: statusInput,
    });

    if (!eligibility.canCancel) {
      throw new CancellationError(eligibilityReasonToErrorCode(eligibility.reason, cancelledBy));
    }

    // A driver cancellation of an ALREADY-booked personal ride is exactly
    // one real passenger booking (this very doc) — read the violation doc
    // NOW (PHASE 1, before any write below) so it can be written atomically
    // alongside the cancellation itself (see driverViolationsLib.ts's own
    // header for why this must never be a separate, skippable step).
    const violationSnap =
      cancelledBy === "driver" && current.driverId
        ? await readExistingCancellationViolation(transaction, current.driverId, "bookings", bookingId)
        : null;

    transaction.update(bookingRef, {
      status: "cancelled" as RideStatus,
      updatedAt: serverTimestamp(),
    });

    if (violationSnap && current.driverId) {
      driverIdForViolation = current.driverId;
      violationCreated = writeCancellationViolationIfNew(transaction, violationSnap, {
        driverId: current.driverId,
        sourceCollection: "bookings",
        sourceId: bookingId,
        sourceCategory: RIDE_CATEGORY,
        scheduledDeparture: new Date(`${current.date}T${current.time || "00:00"}:00`),
        passengerBookingCount: 1,
      });
    }

    notifyReceiverId = cancelledBy === "passenger" ? current.driverId : current.passengerId;
    notifyPassengerName = current.passengerName;
    notifyDriverName = current.driverName;
    didCancel = true;
  });

  // The booking is ALREADY cancelled at this point (the transaction above
  // already committed) — re-cancelling an already-cancelled booking is a
  // safe no-op (didCancel stays false), making this function idempotent.
  if (!didCancel) return null;

  // Best-effort — safe to re-run from anywhere, never a single point of
  // failure (see driverViolationsLib.ts's own header).
  let standingResult: CancellationStandingResult | null = null;
  if (violationCreated && driverIdForViolation) {
    try {
      standingResult = await evaluateDriverCancellationStanding(driverIdForViolation);
    } catch (error) {
      console.log("cancelRideBooking: evaluateDriverCancellationStanding failed (violation already recorded, non-fatal)", {
        bookingId,
        driverId: driverIdForViolation,
        error,
      });
    }
  }

  if (!notifyReceiverId) return standingResult;

  // Best-effort — the cancellation itself already succeeded, so a
  // notify() failure must never be reported back to the caller as a
  // failed cancellation. Logged, never re-thrown (see cancelGeneralBooking
  // in bookingsLib.ts for the same pattern).
  try {
    await notify({
      receiverId: notifyReceiverId,
      type: "cancelled",
      title: i18n.t("schoolTrip.bookingCancelledNotificationTitle"),
      message:
        cancelledBy === "passenger"
          ? `${notifyPassengerName} cancelled their ride booking`
          : `${notifyDriverName} cancelled your ride booking`,
      applicationId: bookingId,
      bookingId,
      category: RIDE_CATEGORY,
      status: "cancelled",
      targetTab: cancelledBy === "passenger" ? "driver" : "passenger",
    });
  } catch (error) {
    console.log("cancelRideBooking: notify failed (booking already cancelled, non-fatal)", {
      bookingId,
      category: RIDE_CATEGORY,
      path: "notifications",
      error,
    });
  }

  return standingResult;
};

// ---------------------------------------------------------------------------
// Driver: start → arrive → finish. Passenger: rate after Finish Trip.
// ---------------------------------------------------------------------------

export const startRide = async (bookingId: string, booking: RideBooking) => {
  if (!canStartTrip(booking)) {
    throw new Error(
      getStartTripBlockedReason(booking) ||
        i18n.t("booking.startTripOnlyOnTripDate"),
    );
  }

  await updateDoc(doc(db, "bookings", bookingId), {
    status: "on_the_way",
    tripStatus: "driver_on_way" as TripTrackingStatus,
    trackingEnabled: false,
    needsPassengerRating: false,
    driverOnWayAt: serverTimestamp(),
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await notify({
    receiverId: booking.passengerId,
    type: "ride_on_the_way",
    title: "Driver on the way",
    message: "Your driver is on the way",
    applicationId: bookingId,
    bookingId,
    category: RIDE_CATEGORY,
    status: "on_the_way",
    targetTab: "passenger",
  });
};

// The Driver My Bookings card's own "Start Ride" button (bookings.tsx —
// handleRideStart) calls THIS, not startRide above — pressing it is the one
// real "the ride has actually started" action for Personal Ride, so it must
// persist tripStatus "in_progress" directly in one write, not just the
// "driver is on the way" sub-step. `.status` is set to "arrived" (the last
// non-terminal RideStatus value — RideStatus itself has no "in_progress")
// so getRideCancelBlockedReason's existing `status !== "booked"` check still
// correctly blocks cancellation once started, and trackingEnabled is set
// true immediately so live GPS sharing begins right away instead of waiting
// on an intermediate "arrived at pickup" step that this simplified flow
// skips entirely.
export const startRideInProgress = async (bookingId: string, booking: RideBooking) => {
  if (!canStartTrip(booking)) {
    throw new Error(
      getStartTripBlockedReason(booking) ||
        i18n.t("booking.startTripOnlyOnTripDate"),
    );
  }

  await updateDoc(doc(db, "bookings", bookingId), {
    status: "arrived" as RideStatus,
    tripStatus: "in_progress" as TripTrackingStatus,
    trackingEnabled: true,
    needsPassengerRating: false,
    driverOnWayAt: serverTimestamp(),
    arrivedPickupAt: serverTimestamp(),
    tripStartedAt: serverTimestamp(),
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await notify({
    receiverId: booking.passengerId,
    type: "ride_trip_in_progress",
    title: "Trip started",
    message: "Your trip has started",
    applicationId: bookingId,
    bookingId,
    category: RIDE_CATEGORY,
    status: "in_progress",
    targetTab: "passenger",
  });
};

export const arriveRide = async (bookingId: string, booking: RideBooking) => {
  await updateDoc(doc(db, "bookings", bookingId), {
    status: "arrived",
    tripStatus: "arrived_pickup" as TripTrackingStatus,
    trackingEnabled: true,
    needsPassengerRating: false,
    arrivedPickupAt: serverTimestamp(),
    arrivedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await notify({
    receiverId: booking.passengerId,
    type: "ride_arrived",
    title: "Driver arrived",
    message: "Your driver has arrived",
    applicationId: bookingId,
    bookingId,
    category: RIDE_CATEGORY,
    status: "arrived",
    targetTab: "passenger",
  });
};

// Driver: Finish Trip. Marks the ride completed and asks the passenger to
// rate — the rating popup must never appear before this runs.
export const finishRide = async (bookingId: string, booking: RideBooking) => {
  await updateDoc(doc(db, "bookings", bookingId), {
    status: "completed",
    tripStatus: "completed" as TripTrackingStatus,
    trackingEnabled: false,
    finishedByDriver: true,
    needsPassengerRating: true,
    ratingSubmitted: false,
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await notify({
    receiverId: booking.passengerId,
    type: "ride_trip_completed",
    title: "Trip completed",
    message: "Your trip is completed. Please rate your driver.",
    applicationId: bookingId,
    bookingId,
    category: RIDE_CATEGORY,
    status: "completed",
    targetTab: "passenger",
  });
};

// Passenger: submit the post-trip rating. Closes out needsPassengerRating so
// the popup never reopens for this booking.
//
// driverReviews/{bookingId} — the review doc's ID IS the bookingId (never an
// auto-id) so a second rating attempt for the same booking is a `create` on
// an already-existing document, which every client rejects outright before
// even reaching Firestore — see firestore.rules' driverReviews `allow
// create`, which additionally requires request.resource.data.bookingId to
// equal this same id. That, plus this transaction's own self-verification
// below (never trust the caller's already-loaded `booking` object alone —
// re-read it fresh inside the transaction), is what the driverReviews rule
// relies on for the booking-ownership/completed/not-already-rated checks.
//
// This transaction deliberately does NOT touch users/{driverId} — a
// passenger has no write access to another user's profile (firestore.rules'
// users update rule only allows the owner or an admin), so crediting
// ratingCount/ratingSum/ratingAverage there is done server-side instead, by
// functions/index.js's onDriverReviewCreated trigger reacting to the
// driverReviews doc this transaction creates.
export const submitRideRating = async (
  bookingId: string,
  booking: RideBooking,
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

  // driverId must be the driver's real Firebase UID — never this booking's
  // own id or its routeId. Treat a suspicious value the same as "no
  // driver": still save the passenger's rating on the booking, just skip
  // creating a driverReviews doc / crediting the wrong profile.
  const hasValidDriverId =
    !!booking.driverId &&
    booking.driverId !== bookingId &&
    booking.driverId !== booking.routeId &&
    booking.driverId !== user.uid;

  if (!hasValidDriverId) {
    await updateDoc(doc(db, "bookings", bookingId), {
      rating: cleanRating,
      reviewComment: cleanComment || null,
      ratingSubmitted: true,
      needsPassengerRating: false,
      ratedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return;
  }

  const bookingRef = doc(db, "bookings", bookingId);
  const reviewRef = doc(db, "driverReviews", bookingId);

  const ratingWritePaths = {
    review: `driverReviews/${bookingId}`,
    booking: `bookings/${bookingId}`,
  };
  console.log("[rating] transaction started", ratingWritePaths);

  try {
    await runTransaction(db, async (transaction) => {
      const bookingSnap = await transaction.get(bookingRef);

      if (!bookingSnap.exists()) {
        throw new Error(i18n.t("rides.bookingNotFound"));
      }

      const bookingData: any = bookingSnap.data();

      // Never trust the `booking` object the caller already had in memory —
      // re-verify ownership + real completion against the current server
      // state, the same three conditions firestore.rules' driverReviews
      // create rule independently re-checks from its own side.
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
        // Already rated (a retried/duplicate call) — idempotent no-op.
        return;
      }

      transaction.set(reviewRef, {
        bookingId,
        driverId: booking.driverId,
        driverName: booking.driverName || "Driver",
        passengerId: user.uid,
        passengerName: booking.passengerName || "Passenger",
        rating: cleanRating,
        comment: cleanComment,
        category: RIDE_CATEGORY,
        from: booking.from || "",
        to: booking.to || "",
        date: booking.date || "",
        time: booking.time || "",
        createdAt: serverTimestamp(),
      });

      transaction.update(bookingRef, {
        rating: cleanRating,
        reviewComment: cleanComment || null,
        ratingSubmitted: true,
        needsPassengerRating: false,
        ratedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    console.log("[rating] transaction succeeded", { bookingId });
  } catch (error) {
    console.log("[rating] transaction failed", { ...ratingWritePaths, error });
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Normalizer
// ---------------------------------------------------------------------------

export type RideBooking = {
  id: string;
  status: RideStatus;

  passengerId: string;
  passengerName: string;
  passengerPhone: string;

  driverId: string;
  driverName: string;
  driverPhone: string;

  driverCar: string;
  driverCarColor: string;
  driverCarPlateLast3: string;

  routeId: string;

  from: string;
  to: string;
  schoolName: string;
  destinationDetails: string;
  date: string;
  day: string;
  time: string;
  seats: number | null;
  price: number | null;

  paymentMethod: string | null;
  paymentStatus: string | null;
  cardLast4: string | null;

  pickup: GeoPoint | null;

  rating: number | null;
  reviewComment: string | null;

  // Live tracking + rating-gate fields (shared shape with school bookings).
  tripStatus: TripTrackingStatus;
  trackingEnabled: boolean;
  driverLocation: DriverLiveLocation | null;
  needsPassengerRating: boolean;
  ratingSubmitted: boolean;
  finishedByDriver: boolean;

  deletedForPassenger: boolean;
  deletedForDriver: boolean;

  createdAtSeconds: number;
  // 0 until Finish Trip actually stamps completedAt — the rating gate
  // requires this to be > 0, never just tripStatus === "completed" alone.
  completedAtSeconds: number;
  searchText: string;
};

const asNumber = (value: any): number | null =>
  typeof value === "number" ? value : null;

const normalizeGeo = (raw: any): GeoPoint | null => {
  if (!raw || typeof raw !== "object") return null;

  const latitude = typeof raw.latitude === "number" ? raw.latitude : null;
  const longitude = typeof raw.longitude === "number" ? raw.longitude : null;

  return {
    latitude,
    longitude,
    address: raw.address || "",
  };
};

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

  return "booked";
};

const normalizeDriverLocation = (value: any): DriverLiveLocation | null => {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    latitude,
    longitude,
    accuracy: value?.accuracy ?? null,
    heading: value?.heading ?? null,
    speed: value?.speed ?? null,
  };
};

export const isRideBooking = (data: any) => data?.category === RIDE_CATEGORY;

export const normalizeRideBooking = (id: string, data: any): RideBooking => {
  const status = (
    ["booked", "on_the_way", "arrived", "completed", "cancelled"].includes(
      data.status,
    )
      ? data.status
      : "booked"
  ) as RideStatus;

  const passengerName = data.passengerName || "Passenger";
  const driverName = data.driverName || "Driver";

  return {
    id,
    status,

    passengerId: data.passengerId || "",
    passengerName,
    passengerPhone: data.passengerPhone || "",

    driverId: data.driverId || "",
    driverName,
    driverPhone: data.driverPhone || "",

    driverCar: data.driverCar || "",
    driverCarColor: data.driverCarColor || "",
    driverCarPlateLast3: data.driverCarPlateLast3 || "",

    routeId: data.routeId || "",

    from: data.from || "",
    to: data.to || "",
    schoolName: data.schoolName || "",
    destinationDetails: data.destinationDetails || "",
    date: data.date || "",
    day: data.day || "",
    time: data.time || "",
    seats: asNumber(data.seats),
    price: asNumber(data.price),

    paymentMethod: data.paymentMethod || null,
    paymentStatus: data.paymentStatus || null,
    cardLast4: data.cardLast4 || null,

    pickup: normalizeGeo(data.passengerPickupLocation),

    rating: asNumber(data.rating),
    reviewComment: data.reviewComment || null,

    tripStatus: normalizeTripStatus(data.tripStatus || data.status),
    trackingEnabled: !!data.trackingEnabled,
    driverLocation: normalizeDriverLocation(data.driverLocation),
    needsPassengerRating: data.needsPassengerRating === true,
    ratingSubmitted: data.ratingSubmitted === true,
    finishedByDriver: data.finishedByDriver === true,

    deletedForPassenger: data.deletedForPassenger === true,
    deletedForDriver: data.deletedForDriver === true,

    createdAtSeconds: data.createdAt?.seconds || 0,
    completedAtSeconds: data.completedAt?.seconds || 0,
    searchText: [
      "personal ride",
      passengerName,
      driverName,
      data.driverCar,
      data.driverCarColor,
      data.driverCarPlateLast3,
      data.from,
      data.to,
      data.date,
      data.time,
      RIDE_STATUS_LABEL[status],
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
  };
};
