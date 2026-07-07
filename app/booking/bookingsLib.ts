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

    status: "ongoing",
    roleType: "passenger_booking",

    createdAt: serverTimestamp(),
    completedAt: null,
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
    completedAt: serverTimestamp(),
  });
};

// ---------------------------------------------------------------------------
// Normalizers -> display-ready items with a searchText for filtering
// ---------------------------------------------------------------------------

const asNumber = (value: any): number | null =>
  typeof value === "number" ? value : null;

const buildSearchText = (parts: (string | undefined | null)[]) =>
  parts.filter(Boolean).join(" ").toLowerCase();

export type BookingItem = {
  id: string;
  category: string;
  from: string;
  to: string;
  date: string;
  time: string;
  days: string[];
  driverName: string;
  price: number | null;
  seats: number | null;
  status: "ongoing" | "completed";
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
  const status = data.status === "completed" ? "completed" : "ongoing";
  const days: string[] = Array.isArray(data.days) ? data.days : [];
  const problemTypes: string[] = Array.isArray(data.problemTypes)
    ? data.problemTypes
    : [];
  const address = data.address || data.location?.address || "";
  const meta = getCategoryMeta(data.category);

  return {
    id,
    category: data.category || "",
    from: data.from || "",
    to: data.to || "",
    date: data.date || "",
    time: data.time || "",
    days,
    driverName: data.driverName || "Driver",
    price: asNumber(data.price),
    seats: asNumber(data.seats),
    status,
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
