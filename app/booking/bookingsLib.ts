// ---------------------------------------------------------------------------
// My Bookings – shared Firestore helpers + normalizers
//
// Collections used:
//   - bookings     (passenger bookings, one per "Book This Driver")
//   - driverRoutes (driver: school / personal / delivery)   keyed by driverId
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
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { auth, db } from "../../firebase";

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

export const ACTIVE_TRACKING_STATUSES: TripTrackingStatus[] = [
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
  delivery: { label: "Delivery", icon: "cube-outline", color: "#A855F7" },
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
  if (!me) throw new Error("You must be logged in to book.");

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
    payload.trackingEnabled = false;
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

  await updateDoc(doc(db, "bookings", bookingId), payload);
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

export const markCompleted = async (
  collectionName: string,
  id: string,
) => {
  await updateDoc(doc(db, collectionName, id), {
    status: "completed",
    tripStatus: "completed",
    trackingEnabled: false,
    needsPassengerRating: false,
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

// ---------------------------------------------------------------------------
// Normalizers -> display-ready items with a searchText for filtering
// ---------------------------------------------------------------------------

const asNumber = (value: any): number | null =>
  typeof value === "number" ? value : null;

const buildSearchText = (parts: (string | undefined | null)[]) =>
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

  // القديم يبقى عشان الشاشات الحالية
  status: "ongoing" | "completed";

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
  searchText: string;

  // Roadside-only extras (category === "roadside").
  problemTypes: string[];
  description: string;
  address: string;
  etaMinutes: number | null;
  passengerName: string;
};

export const normalizeBooking = (id: string, data: any): BookingItem => {
  const tripStatus = normalizeTripStatus(data.tripStatus || data.status);

  const status =
    data.status === "completed" || tripStatus === "completed"
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
    problemTypes,
    description: data.description || "",
    address,
    etaMinutes: asNumber(data.etaMinutes),
    passengerName: data.passengerName || "Passenger",
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
      ...problemTypes,
      ...days,
    ]),
  };
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
  const title = data.jobTitle || data.errandTitle || data.storeName || "";

  const date = data.tripDate || data.deliveryDate || data.date || "";
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