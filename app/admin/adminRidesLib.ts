// ---------------------------------------------------------------------------
// Rides management data layer — unifies the three "listing" collections
// (driverRoutes, workJobs, errandJobs) into one list, the same idea as
// app/booking/homeFeedLib.ts, except admin needs EVERY ride regardless of
// status (homeFeedLib deliberately hides full/expired/cancelled ones).
// ---------------------------------------------------------------------------

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  updateDoc,
  where,
} from "firebase/firestore";

import { db } from "../../firebase";
import i18n from "../i18n";
import { collectionFor, notify } from "../booking/work-errand/workErrandLib";
import { writeAuditLog } from "./adminAuditLib";
import { AdminRideRow, RideStatus } from "./adminTypes";

const toSeconds = (value: unknown): number => {
  const timestamp = value as { seconds?: number } | undefined;
  return timestamp?.seconds || 0;
};

const todayYMD = () => new Date().toISOString().slice(0, 10);

const statusForDate = (date: string, removed: boolean, explicitCancelled: boolean): RideStatus => {
  if (removed || explicitCancelled) return "cancelled";
  if (!date) return "upcoming";

  const today = todayYMD();
  if (date < today) return "completed";
  if (date === today) return "active";
  return "upcoming";
};

const normalizeDriverRoute = (id: string, data: Record<string, any>): AdminRideRow => {
  const date = data.tripDate || "";
  const category = data.category === "school" ? "school" : "personal";

  return {
    id,
    source: "driverRoutes",
    category,
    driverId: data.driverId || "",
    driverName: data.driverName || i18n.t("common.driver"),
    from: data.from || "",
    to: data.to || "",
    title: data.schoolName || "",
    date,
    time: data.time || "",
    price: typeof data.price === "number" ? data.price : null,
    seats: typeof data.seats === "number" ? data.seats : null,
    totalSeats: typeof data.seats === "number" ? data.seats : null,
    status: statusForDate(date, data.removed === true, data.status === "cancelled"),
    removed: data.removed === true,
    createdAtSeconds: toSeconds(data.createdAt),
    raw: data,
  };
};

const normalizeWorkJob = (id: string, data: Record<string, any>): AdminRideRow => {
  const date = data.date || "";
  const totalSeats = Number(data.totalSeats ?? data.workersNeeded ?? 1);
  const remainingSeats = typeof data.remainingSeats === "number" ? data.remainingSeats : totalSeats;

  return {
    id,
    source: "workJobs",
    category: "work",
    driverId: data.employerId || "",
    driverName: data.employerName || i18n.t("common.employer"),
    from: data.location || "",
    to: "",
    title: data.jobTitle || i18n.t("admin.workJobFallbackTitle"),
    date,
    time: data.startTime || "",
    price: typeof data.hourlyPay === "number" ? data.hourlyPay : null,
    seats: remainingSeats,
    totalSeats,
    status: statusForDate(date, data.removed === true, data.status === "cancelled"),
    removed: data.removed === true,
    createdAtSeconds: toSeconds(data.createdAt),
    raw: data,
  };
};

const normalizeErrandJob = (id: string, data: Record<string, any>): AdminRideRow => {
  const date = data.date || "";

  return {
    id,
    source: "errandJobs",
    category: "errand",
    driverId: data.ownerId || "",
    driverName: data.ownerName || i18n.t("common.person"),
    from: data.location || "",
    to: "",
    title: data.errandTitle || i18n.t("admin.errandFallbackTitle"),
    date,
    time: data.startTime || "",
    price: typeof data.price === "number" ? data.price : null,
    seats: typeof data.seats === "number" ? data.seats : null,
    totalSeats: typeof data.seats === "number" ? data.seats : null,
    status: statusForDate(date, data.removed === true, data.status === "cancelled"),
    removed: data.removed === true,
    createdAtSeconds: toSeconds(data.createdAt),
    raw: data,
  };
};

const NORMALIZERS: Record<
  AdminRideRow["source"],
  (id: string, data: Record<string, any>) => AdminRideRow
> = {
  driverRoutes: normalizeDriverRoute,
  workJobs: normalizeWorkJob,
  errandJobs: normalizeErrandJob,
};

export const subscribeAllRides = (
  onUpdate: (rides: AdminRideRow[]) => void,
  onError: (error: unknown) => void,
): (() => void) => {
  let routes: AdminRideRow[] = [];
  let work: AdminRideRow[] = [];
  let errands: AdminRideRow[] = [];

  const emit = () => onUpdate([...routes, ...work, ...errands]);

  const unsubRoutes = onSnapshot(
    collection(db, "driverRoutes"),
    (snap) => {
      routes = snap.docs.map((d) => normalizeDriverRoute(d.id, d.data()));
      emit();
    },
    onError,
  );

  const unsubWork = onSnapshot(
    collection(db, "workJobs"),
    (snap) => {
      work = snap.docs.map((d) => normalizeWorkJob(d.id, d.data()));
      emit();
    },
    onError,
  );

  const unsubErrands = onSnapshot(
    collection(db, "errandJobs"),
    (snap) => {
      errands = snap.docs.map((d) => normalizeErrandJob(d.id, d.data()));
      emit();
    },
    onError,
  );

  return () => {
    unsubRoutes();
    unsubWork();
    unsubErrands();
  };
};

export const getRideById = async (
  source: AdminRideRow["source"],
  id: string,
): Promise<AdminRideRow | null> => {
  const snap = await getDoc(doc(db, source, id));
  if (!snap.exists()) return null;

  return NORMALIZERS[source](snap.id, snap.data());
};

// Cancels the listing itself, plus every still-active booking/application
// attached to it, notifying the driver/employer and every affected
// passenger/applicant so nobody is left waiting on a ride that's gone.
export const cancelRide = async (ride: AdminRideRow, reason: string): Promise<void> => {
  await updateDoc(doc(db, ride.source, ride.id), {
    status: "cancelled",
    active: false,
    available: false,
    cancelledByAdmin: true,
    cancellationReason: reason,
    updatedAt: new Date(),
  });

  if (ride.driverId) {
    await notify({
      receiverId: ride.driverId,
      type: "ride_cancelled_by_admin",
      title: "Your listing was cancelled",
      message: reason
        ? `An admin cancelled your listing: ${reason}`
        : "An admin cancelled your listing.",
      targetTab: "driver",
    });
  }

  if (ride.source === "driverRoutes") {
    const bookingsSnap = await getDocs(
      query(collection(db, "bookings"), where("routeId", "==", ride.id)),
    );

    await Promise.all(
      bookingsSnap.docs
        .filter((d) => !["completed", "cancelled"].includes(d.data().status))
        .map(async (bookingDoc) => {
          const bookingData = bookingDoc.data();

          await updateDoc(bookingDoc.ref, {
            status: "cancelled",
            cancelledByAdmin: true,
            cancellationReason: reason,
            updatedAt: new Date(),
          });

          if (bookingData.passengerId) {
            await notify({
              receiverId: bookingData.passengerId,
              type: "booking_cancelled_by_admin",
              title: "Your ride was cancelled",
              message: reason
                ? `Your ride was cancelled by an admin: ${reason}`
                : "Your ride was cancelled by an admin.",
              targetTab: "passenger",
              bookingId: bookingDoc.id,
            });
          }
        }),
    );
  } else {
    const kind = ride.source === "workJobs" ? "work" : "errand";
    const linkField = kind === "work" ? "jobId" : "errandId";

    const appsSnap = await getDocs(
      query(collection(db, collectionFor(kind)), where(linkField, "==", ride.id)),
    );

    await Promise.all(
      appsSnap.docs
        .filter((d) => !["completed", "cancelled", "rejected"].includes(d.data().status))
        .map(async (appDoc) => {
          const appData = appDoc.data();
          const applicantId = appData.applicantId || appData.passengerId;

          await updateDoc(appDoc.ref, {
            status: "cancelled",
            cancelledByAdmin: true,
            cancellationReason: reason,
            updatedAt: new Date(),
          });

          if (applicantId) {
            await notify({
              receiverId: applicantId,
              type: "application_cancelled_by_admin",
              title: kind === "work" ? "Job cancelled" : "Errand cancelled",
              message: reason
                ? `This was cancelled by an admin: ${reason}`
                : "This was cancelled by an admin.",
              targetTab: "passenger",
              kind,
              applicationId: appDoc.id,
            });
          }
        }),
    );
  }

  await writeAuditLog({
    action: "ride_cancelled",
    targetType: "ride",
    targetId: ride.id,
    reason,
  });
};

export const removeRide = async (ride: AdminRideRow, reason: string): Promise<void> => {
  await updateDoc(doc(db, ride.source, ride.id), {
    removed: true,
    active: false,
    available: false,
    removalReason: reason,
    updatedAt: new Date(),
  });

  await writeAuditLog({
    action: "ride_removed",
    targetType: "ride",
    targetId: ride.id,
    reason,
  });
};

export type ConnectedBookingRow = {
  id: string;
  personName: string;
  status: string;
  createdAtSeconds: number;
};

// Whoever booked/applied to this ride — a passenger for driverRoutes, an
// applicant/customer for work/errand jobs.
export const getConnectedBookings = async (
  ride: AdminRideRow,
): Promise<ConnectedBookingRow[]> => {
  if (ride.source === "driverRoutes") {
    const snap = await getDocs(query(collection(db, "bookings"), where("routeId", "==", ride.id)));

    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        personName: data.passengerName || i18n.t("common.passenger"),
        status: data.status || "",
        createdAtSeconds: toSeconds(data.createdAt),
      };
    });
  }

  const kind = ride.source === "workJobs" ? "work" : "errand";
  const linkField = kind === "work" ? "jobId" : "errandId";

  const snap = await getDocs(
    query(collection(db, collectionFor(kind)), where(linkField, "==", ride.id)),
  );

  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      personName: data.applicantName || data.passengerName || i18n.t("common.applicant"),
      status: data.status || "",
      createdAtSeconds: toSeconds(data.createdAt),
    };
  });
};

export const restoreRide = async (ride: AdminRideRow): Promise<void> => {
  await updateDoc(doc(db, ride.source, ride.id), {
    removed: false,
    removalReason: "",
    active: true,
    available: true,
    updatedAt: new Date(),
  });

  await writeAuditLog({
    action: "ride_restored",
    targetType: "ride",
    targetId: ride.id,
  });
};
