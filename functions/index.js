// ---------------------------------------------------------------------------
// TakeMe Cloud Functions — school trip return-ride matching (AGENTS.md #8),
// stale waiting-request expiry (AGENTS.md #12), driver-cancellation
// replacement search, and push notification delivery (see
// sendPushForNotification below).
//
// This is the ONLY server-side (trusted) code that runs as Firebase Cloud
// Functions in this project. Every function in this file is a background
// trigger (Firestore onCreate/onUpdate, or a schedule) the mobile app never
// invokes directly — it only reads what these write.
//
// NOTE — School Child return-code creation/reset (createSchoolChildProfile /
// resetSchoolChildReturnCode) do NOT live here. They were originally built
// as Callable Functions in this file, but this project's Firebase plan
// (Spark) cannot deploy Cloud Functions at all (callable or otherwise
// requires Blaze), so that undeployable implementation was removed and
// reimplemented as two protected HTTP routes on the existing Cloudflare
// Worker instead — see cloudflare-worker/src/schoolChildren.ts (business
// logic), firestoreRest.ts (server-side Firestore access via the REST API +
// a service account, since the Workers runtime can't run the Admin SDK's
// gRPC transport), and firebaseAuth.ts (Firebase ID token verification
// without the Admin SDK). app/booking/school/schoolChildrenLib.ts calls
// those Worker routes directly over HTTPS, not this file.
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
        // Same fix as the client-side mirror of this exact rule
        // (matchRideRequestsForNewTrip in app/booking/schoolTripsLib.ts) —
        // without these, tapping this notification opens trip-confirm.tsx
        // with no per-child identity at all, and the resulting
        // bookReturnForChild booking ends up with childId (and even
        // childEntryId/childName) missing — invisible to anything that
        // looks a child up by childId, most importantly the School Kiosk.
        childEntryId: request.childEntryId || null,
        childName: request.childName || null,
        childId: request.childId || null,
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
// Driver NO-SHOW violation detection — DORMANT PARITY CODE, kept in sync
// with the actually-live detection path for this feature
// (cloudflare-worker/src/noShowDetection.ts, run via that Worker's own
// `scheduled()` cron trigger — see that file's header for the full trust
// model). This exports the identical "every 5 minutes" schedule and the same
// eligibility rule (mirrors app/booking/driverNoShowCore.ts's
// evaluateNoShowEligibility), so that IF this project is ever upgraded to
// the Blaze plan, this function can be deployed as a second, redundant
// detection path with no further code changes needed — exactly the same
// "present but not currently deployed" convention this file already
// documents at its own header for the School Child functions that were
// moved to the Worker instead. Completely separate from the driver
// CANCELLATION violation system elsewhere in this app.
// ---------------------------------------------------------------------------

const NO_SHOW_GRACE_PERIOD_MINUTES = 15;
const NO_SHOW_RECONCILE_LOOKBACK_DAYS = 30;

function combineNoShowScheduledDateTime(date, time) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
  if (!dateMatch) return null;

  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(String(time || "").trim());
  const hours = timeMatch ? Number(timeMatch[1]) : 0;
  const minutes = timeMatch ? Number(timeMatch[2]) : 0;

  const combined = new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    hours,
    minutes,
  );
  return Number.isNaN(combined.getTime()) ? null : combined;
}

async function processNoShowTripCandidate(tripDoc, tripCollection, bookingCollection, bookingTripField, category, now) {
  const data = tripDoc.data();
  if (!data.driverId) return null;
  if (data.active === false || data.status === "cancelled" || data.status === "completed") return null;
  if (data.tripStatus === "driver_no_show") return null;

  const scheduledAt = combineNoShowScheduledDateTime(data.date, data.time || data.departureTime);
  if (!scheduledAt) return null;

  const gracePeriodEndedAt = new Date(scheduledAt.getTime() + NO_SHOW_GRACE_PERIOD_MINUTES * 60 * 1000);
  if (now < gracePeriodEndedAt.getTime()) return null;

  const violationRef = db.collection("driverViolations").doc(tripDoc.id);
  const existing = await violationRef.get();
  if (existing.exists) return null;

  const bookingsSnap = await db
    .collection(bookingCollection)
    .where(bookingTripField, "==", tripDoc.id)
    .where("status", "!=", "cancelled")
    .get();
  if (bookingsSnap.empty) return null;

  const passengerIds = [];
  const paymentMethods = new Set();
  let paidAmount = 0;
  bookingsSnap.forEach((b) => {
    const bd = b.data();
    if (bd.passengerId) passengerIds.push(bd.passengerId);
    if (bd.paymentMethod) paymentMethods.add(bd.paymentMethod);
    paidAmount += Number(bd.price) || 0;
  });

  const paymentMethodsArr = Array.from(paymentMethods);
  const refundStatus =
    paymentMethodsArr.length > 0 && paymentMethodsArr.every((m) => m === "cash")
      ? "not_required"
      : "manual_refund_pending";

  const batch = db.batch();
  batch.set(violationRef, {
    driverId: data.driverId,
    tripId: tripDoc.id,
    bookingId: bookingsSnap.docs[0]?.id || null,
    schoolTripId: tripCollection === "schoolTrips" ? tripDoc.id : null,
    category,
    violationType: "driver_no_show",
    scheduledAt: admin.firestore.Timestamp.fromDate(scheduledAt),
    gracePeriodEndedAt: admin.firestore.Timestamp.fromDate(gracePeriodEndedAt),
    routeFrom: data.from || data.fromAddress || "",
    routeTo: data.to || data.toAddress || "",
    passengerIds,
    passengerCount: passengerIds.length,
    paymentMethods: paymentMethodsArr,
    paidAmount,
    currency: "ILS",
    refundStatus,
    description: "",
    active: true,
    status: "open",
    appealId: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
  });
  batch.update(tripDoc.ref, {
    tripStatus: "driver_no_show",
    active: false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  bookingsSnap.forEach((b) => {
    batch.update(b.ref, { tripStatus: "driver_no_show", updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  });
  batch.create(db.collection("notifications").doc(), {
    userId: data.driverId,
    receiverId: data.driverId,
    senderId: null,
    type: "driver_noshow_violation_created",
    title: "Missed booked trip",
    message: "A violation was recorded because a booked trip was not started or cancelled.",
    bookingId: tripDoc.id,
    targetTab: "driver",
    roleTarget: "driver",
    read: false,
    readAt: null,
    deleted: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await batch.commit();
  return tripDoc.id;
}

exports.detectDriverNoShowViolations = onSchedule("every 5 minutes", async () => {
  const now = Date.now();
  const lookbackYmd = new Date(now - NO_SHOW_RECONCILE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [routesSnap, schoolTripsSnap] = await Promise.all([
    db.collection("driverRoutes").where("date", ">=", lookbackYmd).get(),
    db.collection("schoolTrips").where("date", ">=", lookbackYmd).get(),
  ]);

  for (const routeDoc of routesSnap.docs) {
    await processNoShowTripCandidate(
      routeDoc,
      "driverRoutes",
      "bookings",
      "routeId",
      routeDoc.data().bookingType === "weekly" ? "weekly" : "personal",
      now,
    ).catch((error) => console.error("detectDriverNoShowViolations: route failed", routeDoc.id, error));
  }

  for (const tripDoc of schoolTripsSnap.docs) {
    await processNoShowTripCandidate(tripDoc, "schoolTrips", "schoolBookings", "schoolTripId", "school", now).catch(
      (error) => console.error("detectDriverNoShowViolations: school trip failed", tripDoc.id, error),
    );
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
// Personal Ride rating aggregation — app/booking/rideBookingLib.ts's
// submitRideRating() creates the driverReviews/{bookingId} doc and updates
// the booking itself client-side, but has NO write access to another user's
// users/{driverId} doc (firestore.rules' users update rule only allows the
// owner or an admin) — so crediting ratingCount/ratingSum/ratingAverage onto
// the driver's profile happens here instead, server-side via the Admin SDK,
// which is never subject to security rules.
//
// Scoped to category === "personal_ride" only: driverReviews docs from the
// other rating flows (school/roadside/work/errand — see schoolTripsLib.ts,
// roadside-help/roadsideLib.ts, work-errand/workErrandLib.ts, and
// app/(tabs)/bookings.tsx's submitSchoolRating) still credit users/{driverId}
// themselves as one step of their own client-side transaction, under
// firestore.rules' isValidDriverRatingCredit carve-out — aggregating those
// here too would double-count. If those flows are ever migrated off that
// carve-out, widen this trigger (and drop the carve-out) to cover them too.
//
// Idempotent against Cloud Functions' at-least-once trigger delivery: the
// `aggregated` flag is checked and set in the SAME transaction as the
// users/{driverId} credit, so a rare duplicate delivery of this trigger for
// the same review doc is a no-op on its second run.
// ---------------------------------------------------------------------------

exports.onDriverReviewCreated = onDocumentCreated("driverReviews/{reviewId}", async (event) => {
  const snap = event.data;
  if (!snap) return;

  const review = snap.data();
  if (review.category !== "personal_ride") return;

  const driverId = review.driverId;
  const rating = Number(review.rating);

  if (typeof driverId !== "string" || !driverId) return;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return;

  const reviewRef = snap.ref;
  const driverRef = db.collection("users").doc(driverId);

  await db.runTransaction(async (transaction) => {
    const freshReviewSnap = await transaction.get(reviewRef);
    if (!freshReviewSnap.exists) return;
    if (freshReviewSnap.data().aggregated === true) return;

    const driverSnap = await transaction.get(driverRef);
    const driverData = driverSnap.exists ? driverSnap.data() : {};

    const oldCount = Number(driverData.ratingCount) || 0;
    const oldSum = Number(driverData.ratingSum) || 0;

    const newCount = oldCount + 1;
    const newSum = oldSum + rating;
    const newAverage = newSum / newCount;

    transaction.set(
      driverRef,
      {
        ratingCount: newCount,
        ratingSum: newSum,
        ratingAverage: newAverage,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    transaction.update(reviewRef, { aggregated: true });
  });
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
  if (type === "driver_noshow_violation_created") return "/(tabs)/bookings";
  if (type === "driver_noshow_passenger_notice") return "/(tabs)/bookings";
  if (type === "noshow_appeal_approved") return "/(tabs)/bookings";
  if (type === "noshow_appeal_rejected") return "/(tabs)/bookings";
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
