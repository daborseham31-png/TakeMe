// ---------------------------------------------------------------------------
// TakeMe Cloud Functions — school trip return-ride matching (AGENTS.md #8)
// and stale waiting-request expiry (AGENTS.md #12).
//
// This is the ONLY server-side (trusted) code in the project today — the
// mobile app has no functions/firebase-admin dependency and never runs
// this file; it only reads the `notifications` / `rideRequests` documents
// this code writes. See the deployment steps in the final project summary
// for how to install, configure, and deploy this.
//
// Note: this project has no real push notification delivery yet (no
// expo-notifications, no push tokens — see app/admin/adminNotificationsLib.ts's
// comment). "Notify the parent" here means writing an in-app `notifications`
// document, exactly like every other notification in this app — the parent
// sees it next time they open the Notifications screen or app.
// ---------------------------------------------------------------------------

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const MAX_ALTERNATIVE_MINUTES = 60;
const NEARBY_ROUTE_RADIUS_KM = 6;

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
