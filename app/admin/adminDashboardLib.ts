// ---------------------------------------------------------------------------
// Dashboard stat aggregation — every number here comes from a real Firestore
// read (getCountFromServer where a single-field filter keeps it index-free;
// getDocs + client-side filtering only for the handful of stats that would
// otherwise need a brand-new composite index). Nothing here is hardcoded.
//
// Mapping notes (the app's data model splits "a ride" across two different
// concepts, so the dashboard has to pick one meaning for each metric):
//   - "Rides" stats (active/upcoming/completed/cancelled/created today) are
//     computed from driverRoutes — the listings drivers create — since
//     that's exactly what the Rides Management screen manages.
//   - "Bookings" stats (pending/confirmed/cancelled) are computed from the
//     `bookings` collection's own status field (booked/on_the_way/arrived/
//     completed/cancelled), which is what Bookings Management manages.
// ---------------------------------------------------------------------------

import {
  collection,
  getCountFromServer,
  getDocs,
  query,
  Timestamp,
  where,
  WhereFilterOp,
} from "firebase/firestore";

import { db } from "../../firebase";
import i18n from "../i18n";

export type DashboardStats = {
  totalUsers: number;
  totalPassengers: number;
  totalDrivers: number;
  pendingDriverVerifications: number;

  activeRides: number;
  upcomingRides: number;
  completedRides: number;
  cancelledRides: number;

  totalBookings: number;
  pendingBookings: number;
  confirmedBookings: number;
  cancelledBookings: number;

  openReports: number;

  ridesCreatedToday: number;
  newUsersThisWeek: number;
};

const startOfTodayTimestamp = () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Timestamp.fromDate(now);
};

const startOfWeekTimestamp = () => {
  const now = new Date();
  now.setDate(now.getDate() - 7);
  return Timestamp.fromDate(now);
};

const countOf = async (
  colName: string,
  field?: string,
  op?: WhereFilterOp,
  value?: unknown,
) => {
  const q =
    field && op !== undefined
      ? query(collection(db, colName), where(field, op, value))
      : query(collection(db, colName));

  const snap = await getCountFromServer(q);
  return snap.data().count;
};

export const getDashboardStats = async (): Promise<DashboardStats> => {
  const [
    totalUsers,
    totalPassengers,
    totalDrivers,
    pendingDriverVerifications,
    totalBookings,
    pendingBookings,
    confirmedOnTheWay,
    confirmedArrived,
    confirmedCompleted,
    cancelledBookings,
    openReports,
    newUsersThisWeek,
  ] = await Promise.all([
    countOf("users"),
    countOf("users", "role", "==", "passenger"),
    countOf("users", "isDriver", "==", true),
    countOf("users", "driverVerificationStatus", "==", "pending_admin_review"),
    countOf("bookings"),
    countOf("bookings", "status", "==", "booked"),
    countOf("bookings", "status", "==", "on_the_way"),
    countOf("bookings", "status", "==", "arrived"),
    countOf("bookings", "status", "==", "completed"),
    countOf("bookings", "status", "==", "cancelled"),
    countOf("adminReports", "status", "==", "open"),
    countOf("users", "createdAt", ">=", startOfWeekTimestamp()),
  ]);

  // driverRoutes has no single "status" field consistent enough to count
  // server-side (active/upcoming/completed all derive from comparing
  // tripDate to today) — read once and classify client-side.
  const routesSnap = await getDocs(
    query(collection(db, "driverRoutes"), where("active", "==", true)),
  );

  const todayYMD = new Date().toISOString().slice(0, 10);
  const startOfToday = startOfTodayTimestamp();

  let activeRides = 0;
  let upcomingRides = 0;
  let completedRides = 0;
  let cancelledRides = 0;
  let ridesCreatedToday = 0;

  routesSnap.docs.forEach((docSnap) => {
    const data = docSnap.data();
    const tripDate: string = data.tripDate || data.date || "";

    if (data.removed === true || data.status === "cancelled") {
      cancelledRides += 1;
    } else if (tripDate && tripDate < todayYMD) {
      completedRides += 1;
    } else if (tripDate === todayYMD) {
      activeRides += 1;
    } else {
      upcomingRides += 1;
    }

    const createdAt = data.createdAt;
    if (createdAt && createdAt.seconds >= startOfToday.seconds) {
      ridesCreatedToday += 1;
    }
  });

  return {
    totalUsers,
    totalPassengers,
    totalDrivers,
    pendingDriverVerifications,

    activeRides,
    upcomingRides,
    completedRides,
    cancelledRides,

    totalBookings,
    pendingBookings,
    confirmedBookings: confirmedOnTheWay + confirmedArrived + confirmedCompleted,
    cancelledBookings,

    openReports,

    ridesCreatedToday,
    newUsersThisWeek,
  };
};

export type RecentRide = {
  id: string;
  from: string;
  to: string;
  driverName: string;
  createdAtSeconds: number;
};

export type RecentUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAtSeconds: number;
};

export type RecentReport = {
  id: string;
  category: string;
  description: string;
  status: string;
  createdAtSeconds: number;
};

const toSeconds = (value: unknown): number => {
  const timestamp = value as { seconds?: number } | undefined;
  return timestamp?.seconds || 0;
};

export const getRecentRides = async (limitCount = 5): Promise<RecentRide[]> => {
  const snap = await getDocs(collection(db, "driverRoutes"));

  return snap.docs
    .map((docSnap) => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        from: data.from || "",
        to: data.to || "",
        driverName: data.driverName || i18n.t("common.driver"),
        createdAtSeconds: toSeconds(data.createdAt),
      };
    })
    .sort((a, b) => b.createdAtSeconds - a.createdAtSeconds)
    .slice(0, limitCount);
};

export const getRecentUsers = async (limitCount = 5): Promise<RecentUser[]> => {
  const snap = await getDocs(collection(db, "users"));

  return snap.docs
    .map((docSnap) => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        name: data.name || i18n.t("common.user"),
        email: data.email || "",
        role: data.role || "",
        createdAtSeconds: toSeconds(data.createdAt),
      };
    })
    .sort((a, b) => b.createdAtSeconds - a.createdAtSeconds)
    .slice(0, limitCount);
};

export const getRecentReports = async (limitCount = 5): Promise<RecentReport[]> => {
  const snap = await getDocs(collection(db, "adminReports"));

  return snap.docs
    .map((docSnap) => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        category: data.category || "other",
        description: data.description || "",
        status: data.status || "open",
        createdAtSeconds: toSeconds(data.createdAt),
      };
    })
    .sort((a, b) => b.createdAtSeconds - a.createdAtSeconds)
    .slice(0, limitCount);
};
