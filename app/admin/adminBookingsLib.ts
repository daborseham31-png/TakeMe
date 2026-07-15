// ---------------------------------------------------------------------------
// Bookings management data layer — the `bookings` collection is the actual
// ride record for Personal/School/Roadside (created by ride-payment.tsx,
// weeklyBookingLib.ts, roadsideLib.ts). Work/Errand applications live in
// separate workApplications/errandApplications collections and are viewable
// via the Rides screen's "connected bookings" list instead of duplicating a
// second Bookings UI for them.
// ---------------------------------------------------------------------------

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { db } from "../../firebase";
import { notify } from "../booking/work-errand/workErrandLib";
import { writeAuditLog } from "./adminAuditLib";
import { AdminBookingRow } from "./adminTypes";

const toSeconds = (value: unknown): number => {
  const timestamp = value as { seconds?: number } | undefined;
  return timestamp?.seconds || 0;
};

const normalizeBooking = (id: string, data: Record<string, any>): AdminBookingRow => ({
  id,
  category: data.category || "",
  passengerId: data.passengerId || "",
  passengerName: data.passengerName || "Passenger",
  driverId: data.driverId || "",
  driverName: data.driverName || "Driver",
  from: data.from || "",
  to: data.to || "",
  date: data.date || "",
  time: data.time || "",
  seats: typeof data.seats === "number" ? data.seats : null,
  price: typeof data.price === "number" ? data.price : null,
  status: data.status || "",
  paymentStatus: data.paymentStatus || "",
  paymentMethod: data.paymentMethod || "",
  routeId: data.routeId || "",
  createdAtSeconds: toSeconds(data.createdAt),
});

export const subscribeAllBookings = (
  onUpdate: (bookings: AdminBookingRow[]) => void,
  onError: (error: unknown) => void,
): (() => void) => {
  return onSnapshot(
    collection(db, "bookings"),
    (snap) => {
      onUpdate(snap.docs.map((d) => normalizeBooking(d.id, d.data())));
    },
    onError,
  );
};

const NON_CANCELLABLE_STATUSES = ["cancelled", "completed", "completed_paid"];

export const cancelBooking = async (bookingId: string, reason: string): Promise<void> => {
  const bookingRef = doc(db, "bookings", bookingId);
  const bookingSnap = await getDoc(bookingRef);

  if (!bookingSnap.exists()) {
    throw new Error("This booking no longer exists.");
  }

  const data = bookingSnap.data();

  if (NON_CANCELLABLE_STATUSES.includes(data.status)) {
    throw new Error(`A ${data.status} booking cannot be cancelled.`);
  }

  await updateDoc(bookingRef, {
    status: "cancelled",
    cancelledByAdmin: true,
    cancellationReason: reason,
    updatedAt: serverTimestamp(),
  });

  // Restore seat availability on the connected driverRoutes doc — weekly
  // bookings decrement one day's remainingSeats; quick bookings mark the
  // whole route unavailable, so each needs a different restore path.
  if (data.routeId) {
    const routeRef = doc(db, "driverRoutes", data.routeId);

    if (data.bookingType === "weekly" && data.date) {
      await runTransaction(db, async (transaction) => {
        const routeSnap = await transaction.get(routeRef);
        if (!routeSnap.exists()) return;

        const routeData = routeSnap.data();
        if (!Array.isArray(routeData.weeklyTrips)) return;

        const weeklyTrips = [...routeData.weeklyTrips];
        const index = weeklyTrips.findIndex((trip: any) => trip.date === data.date);
        if (index === -1) return;

        const currentRemaining =
          typeof weeklyTrips[index].remainingSeats === "number"
            ? weeklyTrips[index].remainingSeats
            : 0;

        weeklyTrips[index] = {
          ...weeklyTrips[index],
          remainingSeats: currentRemaining + (data.seats || 1),
        };

        transaction.update(routeRef, { weeklyTrips, updatedAt: serverTimestamp() });
      });
    } else {
      const routeSnap = await getDoc(routeRef);

      // Only restore if this booking is still the one holding the route —
      // never clobber a newer booking that may have replaced it.
      if (routeSnap.exists() && routeSnap.data().bookingId === bookingId) {
        await updateDoc(routeRef, {
          status: "available",
          isBooked: false,
          available: true,
          bookingId: null,
          bookedBy: null,
          updatedAt: serverTimestamp(),
        });
      }
    }
  }

  if (data.passengerId) {
    await notify({
      receiverId: data.passengerId,
      type: "booking_cancelled_by_admin",
      title: "Booking cancelled",
      message: reason
        ? `Your booking was cancelled by an admin: ${reason}`
        : "Your booking was cancelled by an admin.",
      targetTab: "passenger",
      bookingId,
    });
  }

  if (data.driverId) {
    await notify({
      receiverId: data.driverId,
      type: "booking_cancelled_by_admin",
      title: "Booking cancelled",
      message: "A booking for your trip was cancelled by an admin.",
      targetTab: "driver",
      bookingId,
    });
  }

  await writeAuditLog({
    action: "booking_cancelled",
    targetType: "booking",
    targetId: bookingId,
    reason,
  });
};
