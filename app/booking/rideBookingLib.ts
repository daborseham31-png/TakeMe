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
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { auth, db } from "../../firebase";
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
  | { method: "card"; cardLast4: string };

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
      openBookingTab: "driver",
    } as any);
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

export const hideRideBookingForDriver = async (bookingId: string) => {
  await updateDoc(doc(db, "bookings", bookingId), {
    deletedForDriver: true,
    updatedAt: serverTimestamp(),
  });
};

// ---------------------------------------------------------------------------
// Driver: start → arrive. Passenger: finish + rate.
// ---------------------------------------------------------------------------

export const startRide = async (bookingId: string, booking: RideBooking) => {
  await updateDoc(doc(db, "bookings", bookingId), {
    status: "on_the_way",
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await notify({
    receiverId: booking.passengerId,
    type: "ride_on_the_way",
    title: "Driver on the way",
    message: "Your driver is on the way.",
    applicationId: bookingId,
    bookingId,
    category: RIDE_CATEGORY,
    status: "on_the_way",
    openBookingTab: "passenger",
  } as any);
};

export const arriveRide = async (bookingId: string, booking: RideBooking) => {
  await updateDoc(doc(db, "bookings", bookingId), {
    status: "arrived",
    arrivedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await notify({
    receiverId: booking.passengerId,
    type: "ride_arrived",
    title: "Driver arrived",
    message: "Your driver has arrived.",
    applicationId: bookingId,
    bookingId,
    category: RIDE_CATEGORY,
    status: "arrived",
    openBookingTab: "passenger",
  } as any);
};

export const completeRideWithReview = async (
  bookingId: string,
  booking: RideBooking,
  rating: number,
  comment: string,
) => {
  const cleanComment = comment.trim();

  await updateDoc(doc(db, "bookings", bookingId), {
    status: "completed",
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    rating,
    reviewComment: cleanComment || null,
  });

  try {
    await addDoc(collection(db, "driverReviews"), {
      bookingId,
      driverId: booking.driverId || null,
      passengerId: booking.passengerId || null,
      passengerName: booking.passengerName || "Passenger",
      rating,
      comment: cleanComment,
      category: RIDE_CATEGORY,
      createdAt: serverTimestamp(),
    });
  } catch {
    // لا توقف إغلاق الرحلة لو التقييم فشل
  }

  if (booking.driverId) {
    try {
      const driverRef = doc(db, "users", booking.driverId);
      const snap = await getDoc(driverRef);
      const data = snap.exists() ? snap.data() : {};

      const prevAvg = Number(data.ratingAverage) || 0;
      const prevCount = Number(data.ratingCount) || 0;
      const newCount = prevCount + 1;
      const newAvg = (prevAvg * prevCount + rating) / newCount;

      await updateDoc(driverRef, {
        ratingAverage: Math.round(newAvg * 10) / 10,
        ratingCount: newCount,
      });
    } catch {
      // best effort
    }

    await notify({
      receiverId: booking.driverId,
      type: "ride_completed",
      title: "Ride completed",
      message: `${booking.passengerName} completed the ride and rated you ${rating}★.`,
      applicationId: bookingId,
      bookingId,
      category: RIDE_CATEGORY,
      status: "completed",
      openBookingTab: "driver",
    } as any);
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
