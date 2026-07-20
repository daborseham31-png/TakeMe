// ---------------------------------------------------------------------------
// TakeMe Cloud Functions — school trip return-ride matching (AGENTS.md #8),
// stale waiting-request expiry (AGENTS.md #12), driver-cancellation
// replacement search, and (see sendPushForNotification at the bottom of
// this file) push notification delivery.
//
// This is the ONLY server-side (trusted) code in the project today — the
// mobile app has no other firebase-admin dependency and never runs this
// file; it only reads the `notifications` / `rideRequests` documents this
// code writes, and (for push) the `expoPushTokens` array
// app/pushNotifications.ts stores on each user's own `users/{uid}` doc. See
// the deployment steps in the final project summary for how to install,
// configure, and deploy this.
// ---------------------------------------------------------------------------

const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const MAX_ALTERNATIVE_MINUTES = 60;
const NEARBY_ROUTE_RADIUS_KM = 6;
const MAX_REPLACEMENT_TIME_DIFFERENCE_MINUTES = 60;
const REPLACEMENT_OFFER_TTL_HOURS = 48;

// ---------------------------------------------------------------------------
// Plain-JS mirror of app/booking/schoolTripsLib.ts's time/distance helpers.
// Cloud Functions run as a separate Node project (CommonJS, no Expo/RN/TS
// toolchain) and cannot import the mobile app's TypeScript directly, so the
// small pure-math helpers are duplicated here intentionally. Keep both in
// sync if the matching radius/logic ever changes.
// ---------------------------------------------------------------------------

function timeToMinutes(time) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time || "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function getTimeDifferenceInMinutes(timeA, timeB) {
  const a = timeToMinutes(timeA);
  const b = timeToMinutes(timeB);
  if (a === null || b === null) return null;
  return Math.abs(a - b);
}

function calculateDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function isDestinationNearRoute(destination, routeStart, routeEnd, radiusKm) {
  const radius = radiusKm || NEARBY_ROUTE_RADIUS_KM;
  if (!destination) return false;

  if (
    routeEnd &&
    calculateDistanceKm(
      destination.latitude,
      destination.longitude,
      routeEnd.latitude,
      routeEnd.longitude,
    ) <= radius
  ) {
    return true;
  }

  if (!routeStart || !routeEnd) return false;

  const kmPerDegLat = 110.574;
  const kmPerDegLng = 111.32 * Math.cos((routeStart.latitude * Math.PI) / 180);

  const toXY = (point) => ({
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
  const dist = Math.sqrt((point.x - closest.x) ** 2 + (point.y - closest.y) ** 2);

  return dist <= radius;
}

// Firestore batched writes cap at 500 operations — chunk defensively, same
// pattern already used client-side in app/notifications.tsx's clearAll.
async function commitInChunks(operations) {
  for (let i = 0; i < operations.length; i += 450) {
    const batch = db.batch();
    operations.slice(i, i + 450).forEach((apply) => apply(batch));
    await batch.commit();
  }
}

// ---------------------------------------------------------------------------
// AGENTS.md #8 — when a driver publishes a new `from_school` trip, check
// every waiting rideRequest for that school/date and notify matches.
// ---------------------------------------------------------------------------

exports.onSchoolTripCreated = onDocumentCreated("schoolTrips/{tripId}", async (event) => {
  const snap = event.data;
  if (!snap) return;

  const trip = snap.data();
  const tripId = event.params.tripId;

  if (trip.tripType !== "school" || trip.direction !== "from_school" || trip.status !== "active") {
    return;
  }

  const requestsSnap = await db
    .collection("rideRequests")
    .where("status", "==", "waiting")
    .where("schoolId", "==", trip.schoolId)
    .where("requestedDate", "==", trip.date)
    .get();

  if (requestsSnap.empty) return;

  const routeStart = trip.schoolLocation || null;
  const routeEnd = trip.toLocation || null;

  const operations = [];

  requestsSnap.forEach((requestDoc) => {
    const request = requestDoc.data();

    const notifiedTripIds = Array.isArray(request.notifiedTripIds) ? request.notifiedTripIds : [];
    if (notifiedTripIds.includes(tripId)) return;

    if (typeof trip.availableSeats !== "number" || trip.availableSeats < (request.seats || 1)) {
      return;
    }

    const diff = getTimeDifferenceInMinutes(trip.departureTime, request.requestedTime);
    const maxDiff =
      typeof request.maxTimeDifferenceMinutes === "number"
        ? request.maxTimeDifferenceMinutes
        : MAX_ALTERNATIVE_MINUTES;

    if (diff === null || diff > maxDiff) return;

    if (
      request.destinationLocation &&
      !isDestinationNearRoute(request.destinationLocation, routeStart, routeEnd)
    ) {
      return;
    }

    operations.push((batch) => {
      batch.update(requestDoc.ref, {
        status: "matched",
        matchedTripId: tripId,
        matchedTripIds: admin.firestore.FieldValue.arrayUnion(tripId),
        notifiedTripIds: admin.firestore.FieldValue.arrayUnion(tripId),
        lastNotifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const notificationRef = db.collection("notifications").doc();
      batch.set(notificationRef, {
        userId: request.parentId,
        receiverId: request.parentId,
        senderId: null,
        type: "school_trip_match",
        title: "Suitable ride found",
        message: `A ride from ${trip.schoolName} is now available at ${trip.departureTime} toward ${trip.toAddress}. Tap to view the trip.`,
        bookingId: tripId,
        applicationId: tripId,
        requestId: requestDoc.id,
        category: "school",
        status: "matched",
        targetTab: "passenger",
        read: false,
        readAt: null,
        deleted: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
  });

  if (operations.length > 0) {
    await commitInChunks(operations);
  }
});

// ---------------------------------------------------------------------------
// AGENTS.md #12 — a waiting request whose date/time has passed must stop
// matching/notifying. The client also does this lazily whenever a parent
// views their own requests (see subscribeMyRideRequests in
// schoolTripsLib.ts) — this scheduled sweep is the belt-and-suspenders
// server-side pass for requests nobody re-opens the app to see.
// ---------------------------------------------------------------------------

exports.expireStaleRideRequests = onSchedule("every 60 minutes", async () => {
  const now = Date.now();

  const snap = await db.collection("rideRequests").where("status", "==", "waiting").get();
  if (snap.empty) return;

  const operations = [];

  snap.forEach((requestDoc) => {
    const data = requestDoc.data();

    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(data.requestedDate || ""));
    if (!dateMatch) return;

    const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(String(data.requestedTime || "").trim());
    const hours = timeMatch ? Number(timeMatch[1]) : 23;
    const minutes = timeMatch ? Number(timeMatch[2]) : 59;

    const requestedAtMs = new Date(
      Number(dateMatch[1]),
      Number(dateMatch[2]) - 1,
      Number(dateMatch[3]),
      hours,
      minutes,
    ).getTime();

    if (requestedAtMs < now) {
      operations.push((batch) => {
        batch.update(requestDoc.ref, {
          status: "expired",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
    }
  });

  if (operations.length > 0) {
    await commitInChunks(operations);
  }
});

// ---------------------------------------------------------------------------
// Verification-code expiry — a code becomes unusable once its trip's
// date/time has passed a reasonable grace period, even if nobody ever
// verified it (e.g. the driver forgot, or the passenger never showed up).
// Same "every 60 minutes" schedule as the ride-request sweep above — no new
// moving parts. A booking that's cancelled/replaced already has its code
// expired immediately by the client (see cancelSchoolBooking/
// acceptReplacementOffer in schoolTripsLib.ts) — this is only the
// time-based case those two paths can't cover.
// ---------------------------------------------------------------------------

const VERIFICATION_GRACE_HOURS = 6;

exports.expireStaleVerificationCodes = onSchedule("every 60 minutes", async () => {
  const now = Date.now();
  const graceMs = VERIFICATION_GRACE_HOURS * 60 * 60 * 1000;

  const snap = await db
    .collection("schoolBookings")
    .where("status", "==", "booked")
    .where("verificationStatus", "==", "pending")
    .get();

  if (snap.empty) return;

  const operations = [];

  snap.forEach((bookingDoc) => {
    const data = bookingDoc.data();

    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(data.date || ""));
    if (!dateMatch) return;

    const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(String(data.departureTime || "").trim());
    const hours = timeMatch ? Number(timeMatch[1]) : 23;
    const minutes = timeMatch ? Number(timeMatch[2]) : 59;

    const tripAtMs = new Date(
      Number(dateMatch[1]),
      Number(dateMatch[2]) - 1,
      Number(dateMatch[3]),
      hours,
      minutes,
    ).getTime();

    if (tripAtMs + graceMs < now) {
      operations.push((batch) => {
        batch.update(bookingDoc.ref, {
          verificationStatus: "expired",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
    }
  });

  if (operations.length > 0) {
    await commitInChunks(operations);
  }
});

// ---------------------------------------------------------------------------
// Driver-cancellation replacement search — when a driver cancels a
// schoolTrips doc that already has bookings, this:
//   1. Marks every affected (still "booked") schoolBookings doc cancelled +
//      "replacement_pending", stamping cancelledBy/cancellationReason/
//      cancelledAt/originalTripId, and expires its verification code.
//   2. Searches for alternative trips using the EXACT SAME matching rule as
//      every other school-trip search in this app (schoolId, direction,
//      date, seats, coordinates/distance via isDestinationNearRoute — never
//      translated school/city name text) — see passesCapacityAndRoute's
//      mirror below.
//   3. Creates ONE schoolReplacementOffers doc per affected booking (a
//      multi-child outbound booking's childEntries travel together, so it
//      gets ONE offer needing enough seats for all of them; each child's
//      own separate return booking gets its own offer, so different
//      children can accept different replacement trips).
//   4. Notifies the parent — never books anything automatically.
// This is the ONLY implementation of this matching/offer logic (not
// duplicated client-side) — see AGENTS.md's "must run server-side" —
// which means this function MUST be deployed for driver-cancellation
// replacement search to actually run; the client cancel action itself
// (cancelSchoolTrip) still always works, it just won't trigger a
// replacement search until this is deployed.
// ---------------------------------------------------------------------------

exports.onSchoolTripCancelled = onDocumentUpdated("schoolTrips/{tripId}", async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  const tripId = event.params.tripId;

  if (before.status === "cancelled" || after.status !== "cancelled") return;
  if (after.tripType !== "school") return;

  const bookingsSnap = await db
    .collection("schoolBookings")
    .where("tripId", "==", tripId)
    .where("status", "==", "booked")
    .get();

  if (bookingsSnap.empty) return;

  const cancellationReason = after.cancellationReason || "";
  const now = admin.firestore.FieldValue.serverTimestamp();

  // Step 1 — mark every affected booking, in chunks (a batch caps at 500
  // operations; commitInChunks already handles that, but this must finish
  // and be VISIBLE before the search below reads candidate trips, so it's
  // awaited on its own rather than folded into the same batch pass as the
  // offer-creation writes further down).
  await commitInChunks(
    bookingsSnap.docs.map((bookingDoc) => (batch) => {
      batch.update(bookingDoc.ref, {
        status: "cancelled",
        bookingStatus: "replacement_pending",
        verificationStatus: "expired",
        cancelledBy: "driver",
        cancellationReason,
        cancelledAt: now,
        originalTripId: tripId,
        updatedAt: now,
      });
    }),
  );

  // Step 2 — search + create one offer per affected booking, and notify.
  const operations = [];

  for (const bookingDoc of bookingsSnap.docs) {
    const booking = bookingDoc.data();

    const candidatesSnap = await db
      .collection("schoolTrips")
      .where("tripType", "==", "school")
      .where("direction", "==", booking.bookingDirection)
      .where("schoolId", "==", booking.schoolId)
      .where("date", "==", booking.date)
      .where("status", "==", "active")
      .get();

    const seatsNeeded = Number(booking.seats) || 1;
    const requestedTime = booking.departureTime || "";

    // Passenger's own fixed point — home for outbound, drop-off for return
    // (mirrors passesCapacityAndRoute's `criteria.destination` in
    // schoolTripsLib.ts). Never the school itself.
    const destination =
      booking.bookingDirection === "to_school" ? booking.fromLocation : booking.toLocation;

    const candidates = candidatesSnap.docs
      .filter((tripDoc) => tripDoc.id !== tripId)
      .map((tripDoc) => {
        const candidate = tripDoc.data();
        return { id: tripDoc.id, data: candidate };
      })
      .filter(({ data: candidate }) => {
        if (typeof candidate.availableSeats !== "number" || candidate.availableSeats < seatsNeeded) {
          return false;
        }

        if (destination) {
          const routeStart =
            candidate.direction === "to_school" ? candidate.fromLocation : candidate.schoolLocation;
          const routeEnd =
            candidate.direction === "to_school" ? candidate.schoolLocation : candidate.toLocation;

          if (!isDestinationNearRoute(destination, routeStart, routeEnd)) return false;
        }

        const diff = getTimeDifferenceInMinutes(candidate.departureTime, requestedTime);
        return diff !== null && diff <= MAX_REPLACEMENT_TIME_DIFFERENCE_MINUTES;
      })
      .map(({ id, data: candidate }) => {
        const diff = getTimeDifferenceInMinutes(candidate.departureTime, requestedTime) || 0;
        const isAfter = timeToMinutes(candidate.departureTime) >= timeToMinutes(requestedTime);
        return { id, diff, isAfter };
      })
      // Return rides prefer a trip AFTER the original time (a student can
      // usually wait, but not leave early) — same bias as
      // findAlternativeTrips in schoolTripsLib.ts.
      .sort((a, b) => {
        if (booking.bookingDirection === "from_school" && a.isAfter !== b.isAfter) {
          return a.isAfter ? -1 : 1;
        }
        return a.diff - b.diff;
      })
      .slice(0, 10)
      .map((c) => c.id);

    const offerRef = db.collection("schoolReplacementOffers").doc();

    operations.push((batch) => {
      batch.set(offerRef, {
        originalBookingId: bookingDoc.id,
        originalTripId: tripId,
        parentId: booking.passengerId,
        childEntryIds: booking.childEntries
          ? booking.childEntries.map((c) => c.localId)
          : booking.childEntryId
            ? [booking.childEntryId]
            : [],
        direction: booking.bookingDirection,
        seatsNeeded,
        candidateTripIds: candidates,
        status: candidates.length > 0 ? "offered" : "pending",
        acceptedTripId: null,
        acceptedBookingId: null,
        createdAt: now,
        expiresAt: admin.firestore.Timestamp.fromMillis(
          Date.now() + REPLACEMENT_OFFER_TTL_HOURS * 60 * 60 * 1000,
        ),
      });

      const notificationRef = db.collection("notifications").doc();
      batch.set(notificationRef, {
        userId: booking.passengerId,
        receiverId: booking.passengerId,
        senderId: null,
        type: "school_trip_replacement",
        title: "Your driver cancelled the ride",
        message:
          candidates.length > 0
            ? "We found alternative rides for the school trip. Tap to review them."
            : "Your driver cancelled the ride. We're still looking for an alternative and will notify you.",
        originalBookingId: bookingDoc.id,
        replacementOfferId: offerRef.id,
        applicationId: offerRef.id,
        bookingId: bookingDoc.id,
        category: "school",
        status: "replacement_pending",
        targetTab: "passenger",
        read: false,
        readAt: null,
        deleted: false,
        createdAt: now,
      });
    });
  }

  if (operations.length > 0) {
    await commitInChunks(operations);
  }
});

// ---------------------------------------------------------------------------
// Push notification delivery — fires once for every `notifications` doc
// created anywhere in the app (client notify() calls in workErrandLib.ts,
// this file's own onSchoolTripCancelled above, ride-navigation.tsx's
// trip-started notify() call, ...). This is the ONLY place a push is ever
// sent — the client never calls the Expo push API directly, per AGENTS.md's
// "prefer a trusted backend implementation for sending the push
// notification". The in-app notification (what the Notifications screen
// shows) is unaffected either way; this only ever ADDS a push on top of it.
//
// Idempotent by construction: this trigger fires exactly once per document
// (a Firestore onCreate trigger never re-fires for the same doc), and the
// notification doc itself is only ever created once per real event by its
// caller (e.g. verifyPassengerCodeAndStartTrip's transaction is the actual
// duplicate-prevention boundary for "trip started" — see schoolTripsLib.ts).
// ---------------------------------------------------------------------------

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

// Where tapping the push (from a backgrounded/killed app) should open —
// mirrors the exact routes notifications.tsx's onPressNotification already
// uses for the same `type` when the notification is tapped inside the app.
function routeForNotificationType(type) {
  if (type === "trip_started") return "/booking/live-tracking";
  if (type === "school_trip_match") return "/booking/school/trip-confirm";
  if (type === "school_trip_replacement") return "/booking/school/replacement-offer";
  return "/(tabs)/bookings";
}

exports.sendPushForNotification = onDocumentCreated("notifications/{notificationId}", async (event) => {
  const notification = event.data.data();
  const notificationRef = event.data.ref;

  const receiverId = notification.receiverId || notification.userId;
  if (!receiverId || !notification.title) return;

  const userSnap = await db.collection("users").doc(receiverId).get();
  const tokens = userSnap.exists ? userSnap.data().expoPushTokens : null;

  if (!Array.isArray(tokens) || tokens.length === 0) return;

  const messages = tokens
    .filter((token) => typeof token === "string" && token.startsWith("ExponentPushToken"))
    .map((token) => ({
      to: token,
      title: notification.title,
      body: notification.message || "",
      data: {
        type: notification.type || null,
        bookingId: notification.bookingId || notification.applicationId || null,
        route: routeForNotificationType(notification.type),
      },
    }));

  if (messages.length === 0) return;

  try {
    await fetch(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });

    await notificationRef.update({
      pushSent: true,
      pushSentAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error("sendPushForNotification: Expo push request failed", error);
  }
});
