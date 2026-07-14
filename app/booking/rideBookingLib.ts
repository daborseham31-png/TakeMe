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
//   - users/{driverId}(ratingAverage + ratingCount summary, updated on complete)
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
import {
  canStartTrip,
  DriverLiveLocation,
  getStartTripBlockedReason,
  TripTrackingStatus,
} from "./bookingsLib";
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
  if (!user) throw new Error("You must be logged in to book.");

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
// Driver: start → arrive → finish. Passenger: rate after Finish Trip.
// ---------------------------------------------------------------------------

export const startRide = async (bookingId: string, booking: RideBooking) => {
  if (!canStartTrip(booking)) {
    throw new Error(
      getStartTripBlockedReason(booking) ||
        "You can start this trip only on the trip date.",
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
export const submitRideRating = async (
  bookingId: string,
  booking: RideBooking,
  rating: number,
  comment: string,
) => {
  const cleanComment = comment.trim();

  // driverId must be the driver's real Firebase UID — never this booking's
  // own id or its routeId. Treat a suspicious value the same as "no
  // driver": still save the passenger's rating on the booking, just skip
  // creating a driverReviews doc / crediting the wrong profile.
  const hasValidDriverId =
    !!booking.driverId &&
    booking.driverId !== bookingId &&
    booking.driverId !== booking.routeId;

  if (!hasValidDriverId) {
    await updateDoc(doc(db, "bookings", bookingId), {
      rating,
      reviewComment: cleanComment || null,
      ratingSubmitted: true,
      needsPassengerRating: false,
      ratedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return;
  }

  const bookingRef = doc(db, "bookings", bookingId);
  const driverRef = doc(db, "users", booking.driverId);
  const reviewRef = doc(collection(db, "driverReviews"));

  await runTransaction(db, async (transaction) => {
    const bookingSnap = await transaction.get(bookingRef);

    if (!bookingSnap.exists()) {
      throw new Error("Booking not found.");
    }

    const bookingData: any = bookingSnap.data();

    if (bookingData.ratingSubmitted === true) {
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
      bookingId,
      driverId: booking.driverId,
      driverName: booking.driverName || "Driver",
      passengerId: booking.passengerId || null,
      passengerName: booking.passengerName || "Passenger",
      rating,
      comment: cleanComment,
      category: RIDE_CATEGORY,
      from: booking.from || "",
      to: booking.to || "",
      date: booking.date || "",
      time: booking.time || "",
      createdAt: serverTimestamp(),
    });

    transaction.update(bookingRef, {
      rating,
      reviewComment: cleanComment || null,
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
