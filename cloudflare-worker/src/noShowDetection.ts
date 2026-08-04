// ---------------------------------------------------------------------------
// Driver NO-SHOW violation detection — the PRIMARY, server-side detection
// path (see driverNoShowLib.ts's header in the Expo app for the full trust
// model / why this exists here instead of a Firebase Cloud Function). Run on
// a schedule (see wrangler.jsonc's `triggers.crons` + index.ts's `scheduled`
// export) — genuinely independent of any user having the app open.
//
// This intentionally RE-IMPLEMENTS the eligibility/idempotency/refund-status
// logic from app/booking/driverNoShowCore.ts rather than importing it: the
// Workers runtime bundles this file standalone (no access to the Expo app's
// module tree, and no shared package exists between them — see this
// project's existing app/admin/** vs takeme-admin-desktop/src/admin/**
// precedent for the same "manually kept in sync, not shared" tradeoff). Any
// change to the eligibility rule must be made in BOTH places.
//
// Scope (matches the product spec exactly): School, Personal, and Weekly
// trips only — Work/Errand/Roadside are out of scope for this system.
// Personal + Weekly bookings both live in the `bookings` collection
// (weeklyBookingLib.ts writes there too), keyed to a `driverRoutes` document
// via `routeId`; School bookings live in `schoolBookings`, keyed to a
// `schoolTrips` document via `schoolTripId`. Both directions of a school run
// (outbound/return) are ordinary schoolTrips documents distinguished only by
// their own `direction` field, which this file never branches on — it's
// already carried straight through from Firestore, same as before.
//
// SUBREQUEST-BUDGET FIX (see the delivery report's root-cause writeup): the
// original version of this file called queryFirestoreDocuments ONCE PER
// CANDIDATE TRIP inside processCandidate, so a run with ~90 candidates made
// ~90+ outbound fetch() calls in a single Worker invocation — comfortably
// over Cloudflare's default (Bundled usage model) 50-subrequest-per-
// invocation ceiling, so roughly half of every run failed with a "Too many
// subrequests" error that never even reached a loggable HTTP response.
//
// Fixed by bulk-fetching: gather every candidate first, then issue a SMALL,
// BOUNDED number of "tripId IN [...]" queries (Firestore's IN operator caps
// at 30 values, so trip ids are chunked to <=30 per call — see
// fetchBookingRecordsForTripIds / firestoreRest.ts's queryFirestoreDocumentsByIn)
// against `bookings` and `schoolBookings`, restricted to exactly the
// candidate trip ids that are actually due right now (grace period already
// elapsed) — never an unbounded scan of the whole collection's history.
// processCandidate is now a pure, no-I/O-for-reads function that only
// receives its own trip's already-fetched bookings from an in-memory
// Map<tripId, BookingRecord[]>; its only remaining network call is the
// occasional commitFirestoreWrites for a genuinely eligible trip (bounded by
// how many trips are actually eligible this run, not by how many were
// merely checked).
// ---------------------------------------------------------------------------

import type { Env } from "./env";
import {
  buildCreateWrite,
  buildUpdateWrite,
  commitFirestoreWrites,
  FirestoreQueryDocument,
  queryFirestoreDocuments,
  queryFirestoreDocumentsByIn,
} from "./firestoreRest";

const GRACE_PERIOD_MINUTES = 15;
const RECONCILE_LOOKBACK_DAYS = 30;
const DRIVER_NO_SHOW_TRIP_STATUS = "driver_no_show";

// Firestore's own hard cap on the number of disjunction values in a single
// `IN` query — callers must chunk to this size (see
// queryFirestoreDocumentsByIn's own guard, which throws rather than
// silently truncating if this is ever violated).
const IN_QUERY_CHUNK_SIZE = 30;

// ---------------------------------------------------------------------------
// Ported pure logic (mirrors driverNoShowCore.ts — see this file's header)
// ---------------------------------------------------------------------------

function parseYMD(date: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(year, month - 1, day);
  const isReal = probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day;
  return isReal ? { year, month, day } : null;
}

function parseHM(time: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec((time || "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

// This product is Israel-only — every stored date/time string (driverRoutes'
// tripDate/time, schoolTrips' date/departureTime) is the driver's LOCAL
// wall-clock entry from the Expo app on their own phone, i.e. Asia/Jerusalem.
// Cloudflare Workers always run with UTC as the runtime's "local" timezone
// (unlike a phone, where local IS Israel — see driverNoShowCore.ts's own
// plain `new Date(y,m,d,h,min)` construction, which is correct there for
// exactly that reason and is deliberately NOT changed to match this file).
// Naively using the same plain constructor here would silently treat every
// stored time as UTC instead of Israel time, skewing eligibility by the
// current Israel/UTC offset (+2 or +3h depending on DST) — enough to flip a
// borderline case's outcome even though it happened not to matter for the
// specific 14-hours-overdue trip that surfaced this bug. Uses the standard
// "double conversion" technique — no timezone library needed, since the
// Workers runtime already bundles full ICU/IANA timezone data.
const APP_TIMEZONE = "Asia/Jerusalem";

function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(naiveUtcMs));

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const shownAsUtcMs = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));

  // shownAsUtcMs - naiveUtcMs is the zone's current UTC offset (positive
  // when ahead of UTC, e.g. +3h for Israel in summer) — subtracting it from
  // the naive guess yields the real UTC instant for that Israel wall-clock
  // time.
  const offsetMs = shownAsUtcMs - naiveUtcMs;
  return new Date(naiveUtcMs - offsetMs);
}

export function combineScheduledDateTime(date: string, time: string): Date | null {
  const ymd = parseYMD(date);
  if (!ymd) return null;
  const hm = parseHM(time) || { hour: 0, minute: 0 };
  const combined = zonedTimeToUtc(ymd.year, ymd.month, ymd.day, hm.hour, hm.minute);
  return Number.isNaN(combined.getTime()) ? null : combined;
}

export function graceDeadline(scheduledAt: Date): Date {
  return new Date(scheduledAt.getTime() + GRACE_PERIOD_MINUTES * 60 * 1000);
}

type RefundStatus = "not_required" | "manual_refund_pending";

export function decideInitialRefundStatus(paymentMethods: string[]): RefundStatus {
  // Worst-case across all affected bookings — see driverNoShowCore.ts's
  // decideInitialRefundStatus for the "no real refund integration exists"
  // rationale (this file mirrors that decision exactly, never a real
  // refund call).
  const allCash = paymentMethods.length > 0 && paymentMethods.every((m) => m === "cash");
  return allCash ? "not_required" : "manual_refund_pending";
}

// ---------------------------------------------------------------------------
// Small shared utility — chunk an array into <=size pieces, preserving
// order. Used to respect Firestore's 30-value IN limit.
// ---------------------------------------------------------------------------

export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error("chunkArray: size must be positive.");
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

// ---------------------------------------------------------------------------
// Candidate gathering
// ---------------------------------------------------------------------------

type TripKind = "personal" | "weekly" | "school";

export type TripCandidate = {
  tripId: string;
  tripCollection: "driverRoutes" | "schoolTrips";
  bookingCollection: "bookings" | "schoolBookings";
  bookingTripField: "routeId" | "schoolTripId";
  category: TripKind;
  driverId: string;
  from: string;
  to: string;
  date: string;
  time: string;
};

function isStillOpenForNoShow(data: Record<string, unknown>): boolean {
  return (
    data.active !== false &&
    data.status !== "cancelled" &&
    data.status !== "completed" &&
    data.tripStatus !== DRIVER_NO_SHOW_TRIP_STATUS
  );
}

async function gatherCandidates(env: Env, lookbackYmd: string): Promise<TripCandidate[]> {
  const [routes, schoolTrips] = await Promise.all([
    queryFirestoreDocuments(env, "driverRoutes", {}),
    queryFirestoreDocuments(env, "schoolTrips", {}),
  ]);

  const candidates: TripCandidate[] = [];

  for (const route of routes) {
    try {
      const data = route.data as Record<string, any>;
      if (!isStillOpenForNoShow(data)) continue;
      // driverRoutes documents are written as `tripDate` (see
      // app/driver/create/RideForm.tsx's baseRouteFields and the "Republish
      // Trip" path in app/(tabs)/bookings.tsx) — NEVER a plain `date` field.
      // The original version of this file read `data.date`, which is always
      // undefined for every real Personal/Weekly trip, so every candidate
      // was silently dropped right here before any eligibility check ever
      // ran (this is the actual root cause of a real overdue production
      // trip never being detected — see the delivery report). `data.date` is
      // kept as a fallback only in case a legacy/alternate writer ever used
      // that name instead — never the other way around, since it's not what
      // production actually writes.
      const routeDate = data.tripDate || data.date;
      if (!routeDate || routeDate < lookbackYmd) continue;
      candidates.push({
        tripId: route.id,
        tripCollection: "driverRoutes",
        bookingCollection: "bookings",
        bookingTripField: "routeId",
        category: data.bookingType === "weekly" ? "weekly" : "personal",
        driverId: data.driverId || "",
        from: data.from || "",
        to: data.to || "",
        date: routeDate,
        time: data.time || "",
      });
    } catch (error) {
      // A single malformed driverRoutes document must never abort the whole
      // run — skip it, log its id only (never the raw doc contents), and
      // keep gathering the rest.
      console.error("noShowDetection: malformed driverRoutes candidate", route.id, error instanceof Error ? error.name : "unknown");
    }
  }

  for (const trip of schoolTrips) {
    try {
      const data = trip.data as Record<string, any>;
      if (!isStillOpenForNoShow(data)) continue;
      if (!data.date || data.date < lookbackYmd) continue;
      candidates.push({
        tripId: trip.id,
        tripCollection: "schoolTrips",
        bookingCollection: "schoolBookings",
        bookingTripField: "schoolTripId",
        category: "school",
        driverId: data.driverId || "",
        from: data.fromAddress || "",
        to: data.toAddress || "",
        date: data.date || "",
        time: data.departureTime || "",
      });
    } catch (error) {
      console.error("noShowDetection: malformed schoolTrips candidate", trip.id, error instanceof Error ? error.name : "unknown");
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Schedule evaluation — computed ONCE per candidate (used both to decide
// which trip ids are actually due for a bulk booking fetch, and inside
// processCandidate below), so the date/grace-period math never runs twice
// or drifts between the two call sites.
// ---------------------------------------------------------------------------

export type Schedule = { scheduledAt: Date; deadline: Date } | null;

export function evaluateSchedule(candidate: Pick<TripCandidate, "date" | "time">, now: Date): Schedule {
  const scheduledAt = combineScheduledDateTime(candidate.date, candidate.time);
  if (!scheduledAt) return null; // Condition 8's "no reliable scheduled time" half.
  const deadline = graceDeadline(scheduledAt);
  if (now.getTime() < deadline.getTime()) return null; // Conditions 2/3.
  return { scheduledAt, deadline };
}

// ---------------------------------------------------------------------------
// Bulk booking fetch — the actual fix. ONE bounded set of "tripId IN [...]"
// queries per collection (never one query per candidate), restricted to
// exactly the candidate trip ids that are due right now, chunked to respect
// Firestore's 30-value IN limit, with each chunk's pages read to completion
// (see queryFirestoreDocumentsByIn) rather than only the first page.
// ---------------------------------------------------------------------------

export type BookingRecord = {
  id: string;
  tripId: string;
  status: string;
  passengerId: string;
  paymentMethod: string;
  price: number;
};

export function normalizeBookingRecord(tripId: string, doc: FirestoreQueryDocument): BookingRecord {
  const data = doc.data as Record<string, any>;
  return {
    id: doc.id,
    tripId,
    status: typeof data.status === "string" ? data.status : "",
    passengerId: typeof data.passengerId === "string" ? data.passengerId : "",
    paymentMethod: typeof data.paymentMethod === "string" ? data.paymentMethod : "",
    price: typeof data.price === "number" ? data.price : Number(data.price) || 0,
  };
}

type BookingFetchResult = {
  recordsByTripId: Map<string, BookingRecord[]>;
  documentsFetched: number;
  subrequestsUsed: number;
};

async function fetchBookingRecordsForTripIds(
  env: Env,
  collection: "bookings" | "schoolBookings",
  tripField: "routeId" | "schoolTripId",
  tripIds: string[],
): Promise<BookingFetchResult> {
  const recordsByTripId = new Map<string, BookingRecord[]>();
  let documentsFetched = 0;
  let subrequestsUsed = 0;

  if (tripIds.length === 0) return { recordsByTripId, documentsFetched, subrequestsUsed };

  // Dedupe — gatherCandidates already guarantees one TripCandidate per
  // document id, but de-duplicating here too keeps this function correct
  // even if a future caller passes a list with repeats.
  const uniqueTripIds = Array.from(new Set(tripIds));

  for (const chunk of chunkArray(uniqueTripIds, IN_QUERY_CHUNK_SIZE)) {
    try {
      const { documents, pagesFetched } = await queryFirestoreDocumentsByIn(env, collection, tripField, chunk);
      subrequestsUsed += pagesFetched;
      documentsFetched += documents.length;

      for (const doc of documents) {
        const rawTripId = (doc.data as Record<string, any>)[tripField];
        if (typeof rawTripId !== "string" || !rawTripId) {
          // A booking doc missing its own trip-reference field is malformed
          // — skip it (it can never be matched back to a candidate) rather
          // than let it corrupt the map or throw.
          console.error("noShowDetection: booking missing trip reference field", collection, doc.id);
          continue;
        }
        const record = normalizeBookingRecord(rawTripId, doc);
        const existing = recordsByTripId.get(rawTripId);
        if (existing) existing.push(record);
        else recordsByTripId.set(rawTripId, [record]);
      }
    } catch (error) {
      // One bad chunk (network hiccup, or Firestore rejecting the request)
      // must never abort the whole run. The trip ids in this specific chunk
      // simply get an empty booking list this cycle (processCandidate then
      // correctly reports them "not_eligible" — never a false violation),
      // and the next cron tick 5 minutes later retries them from scratch,
      // since nothing was written for them.
      console.error(
        "noShowDetection: booking chunk fetch failed",
        collection,
        chunk,
        error instanceof Error ? error.name : "unknown",
      );
      subrequestsUsed += 1; // The attempt itself still consumed a subrequest.
    }
  }

  return { recordsByTripId, documentsFetched, subrequestsUsed };
}

// ---------------------------------------------------------------------------
// Per-candidate processing — PURE with respect to reads: every input
// (schedule, this trip's already-fetched bookings) is passed in, computed
// once, up front, for every candidate in the run. The only network call
// left here is commitFirestoreWrites, and only for a trip this function has
// already determined is a genuine, newly-eligible no-show — never a read.
// ---------------------------------------------------------------------------

type ProcessResult = "created" | "skipped" | "not_eligible" | "already_exists";

async function processCandidate(
  env: Env,
  candidate: TripCandidate,
  now: Date,
  schedule: Schedule,
  bookingRecords: BookingRecord[],
): Promise<ProcessResult> {
  if (!candidate.driverId) return "skipped";
  if (!schedule) return "not_eligible"; // Invalid/missing scheduled time, or grace period not yet elapsed.

  const activeBookings = bookingRecords.filter((b) => b.status !== "cancelled");
  if (activeBookings.length === 0) return "not_eligible"; // Condition 1 — zero confirmed passengers.

  const passengerIds = activeBookings.map((b) => b.passengerId).filter((id) => id.length > 0);
  const paymentMethods = Array.from(new Set(activeBookings.map((b) => b.paymentMethod).filter((m) => m.length > 0)));
  const paidAmount = activeBookings.reduce((sum, b) => sum + b.price, 0);

  const violationId = candidate.tripId; // Deterministic — see driverNoShowCore.ts's driverViolationId.

  const writes = [
    buildCreateWrite(
      env.FIREBASE_PROJECT_ID,
      "driverViolations",
      violationId,
      {
        driverId: candidate.driverId,
        tripId: candidate.tripId,
        bookingId: activeBookings[0]?.id || null,
        schoolTripId: candidate.tripCollection === "schoolTrips" ? candidate.tripId : null,
        category: candidate.category,
        violationType: "driver_no_show",
        scheduledAt: schedule.scheduledAt,
        gracePeriodEndedAt: schedule.deadline,
        routeFrom: candidate.from,
        routeTo: candidate.to,
        passengerIds,
        passengerCount: passengerIds.length,
        paymentMethods,
        paidAmount,
        currency: "ILS",
        refundStatus: decideInitialRefundStatus(paymentMethods),
        description: "",
        active: true,
        status: "open",
        appealId: null,
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
        resolvedBy: null,
        resolutionNote: null,
      },
      { requireAbsent: true }, // The actual idempotency guarantee — see this file's header.
    ),
    buildUpdateWrite(
      env.FIREBASE_PROJECT_ID,
      candidate.tripCollection,
      candidate.tripId,
      { tripStatus: DRIVER_NO_SHOW_TRIP_STATUS, active: false, updatedAt: now },
      ["tripStatus", "active", "updatedAt"],
    ),
    ...activeBookings.map((b) =>
      buildUpdateWrite(
        env.FIREBASE_PROJECT_ID,
        candidate.bookingCollection,
        b.id,
        { tripStatus: DRIVER_NO_SHOW_TRIP_STATUS, updatedAt: now },
        ["tripStatus", "updatedAt"],
      ),
    ),
    buildCreateWrite(env.FIREBASE_PROJECT_ID, "notifications", crypto.randomUUID(), {
      userId: candidate.driverId,
      receiverId: candidate.driverId,
      senderId: null,
      type: "driver_noshow_violation_created",
      title: "Missed booked trip",
      message: "A violation was recorded because a booked trip was not started or cancelled.",
      bookingId: candidate.tripId,
      targetTab: "driver",
      roleTarget: "driver",
      openBookingTab: "driver",
      read: false,
      readAt: null,
      deleted: false,
      createdAt: now,
    }),
    ...passengerIds.map((passengerId) =>
      buildCreateWrite(env.FIREBASE_PROJECT_ID, "notifications", crypto.randomUUID(), {
        userId: passengerId,
        receiverId: passengerId,
        senderId: null,
        type: "driver_noshow_passenger_notice",
        title: "Driver did not start your trip",
        message: "The driver did not start your trip. Refund handling has started when relevant.",
        bookingId: candidate.tripId,
        targetTab: "passenger",
        roleTarget: "passenger",
        openBookingTab: "passenger",
        read: false,
        readAt: null,
        deleted: false,
        createdAt: now,
      }),
    ),
  ];

  const result = await commitFirestoreWrites(env, writes);
  if (!result.ok) {
    // A 409-style failure here almost always means the `requireAbsent`
    // precondition lost a race (a previous cron tick already created this
    // exact violation) — a correct, expected no-op, not a real error.
    return "already_exists";
  }

  return "created";
}

// ---------------------------------------------------------------------------
// Admin fan-out notification helper — used for appeal-submitted notices too
// if ever needed from this side; kept here since this is the Worker's own
// notification-writing surface (separate from driverNoShowLib.ts's client
// SDK version).
// ---------------------------------------------------------------------------

async function notifyAllAdmins(
  env: Env,
  now: Date,
  title: string,
  message: string,
): Promise<{ subrequestsUsed: number }> {
  const admins = await queryFirestoreDocuments(env, "users", { role: "admin" });
  if (admins.length === 0) return { subrequestsUsed: 1 };

  const writes = admins.map((admin) =>
    buildCreateWrite(env.FIREBASE_PROJECT_ID, "notifications", crypto.randomUUID(), {
      userId: admin.id,
      receiverId: admin.id,
      senderId: null,
      type: "admin_noshow_batch_notice",
      title,
      message,
      targetTab: null,
      read: false,
      readAt: null,
      deleted: false,
      createdAt: now,
    }),
  );

  await commitFirestoreWrites(env, writes);
  return { subrequestsUsed: 2 };
}

// ---------------------------------------------------------------------------
// Entry point — called from index.ts's `scheduled()` export.
// ---------------------------------------------------------------------------

export type NoShowDetectionSummary = {
  // Every still-open, within-lookback trip gatherCandidates returned —
  // includes trips that aren't actually due yet this cycle.
  candidatesGathered: number;
  // How many DISTINCT trip ids were actually sent into the bulk booking
  // fetch (i.e. already past their grace period this run) — the number
  // that matters for "did this stay bounded," since it's what drives
  // firestoreSubrequestsUsed, not candidatesGathered.
  candidateTripIds: number;
  bookingDocumentsFetched: number;
  schoolBookingDocumentsFetched: number;
  candidatesProcessed: number;
  // Genuine no-shows this run recognized, whether newly recorded or already
  // on record from an earlier run (violationsCreated + duplicatesSkipped).
  eligibleNoShows: number;
  violationsCreated: number;
  duplicatesSkipped: number;
  ineligibleSkipped: number;
  failures: number;
  // Best-effort count of outbound Firestore REST calls this run made
  // (gatherCandidates's 2 + bulk-fetch chunks/pages + one commit per
  // created/duplicate + the admin-notify query/commit). Does not count the
  // one-time OAuth2 token exchange, which only happens on a cold isolate.
  firestoreSubrequestsUsed: number;
  durationMs: number;
};

// `now` defaults to the real current time in production (index.ts's
// scheduled() export calls this with no second argument) — the optional
// override exists purely so tests can pin a deterministic clock without
// mocking global Date/timers, which interferes with the real WebCrypto
// signing call in firestoreRest.ts's getAccessToken.
export async function runNoShowDetection(env: Env, now: Date = new Date()): Promise<NoShowDetectionSummary> {
  const startedAt = Date.now();
  const lookbackDate = new Date(now.getTime() - RECONCILE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const lookbackYmd = lookbackDate.toISOString().slice(0, 10);

  let firestoreSubrequestsUsed = 0;

  const candidates = await gatherCandidates(env, lookbackYmd);
  firestoreSubrequestsUsed += 2; // driverRoutes + schoolTrips.

  // Computed once per candidate, reused both to decide which trip ids are
  // actually due for a bulk booking fetch AND inside processCandidate below
  // — never recomputed, never allowed to drift between the two call sites.
  const schedules = new Map<string, Schedule>();
  for (const candidate of candidates) {
    schedules.set(candidate.tripId, candidate.driverId ? evaluateSchedule(candidate, now) : null);
  }

  const dueBookingTripIds = candidates
    .filter((c) => c.bookingCollection === "bookings" && schedules.get(c.tripId))
    .map((c) => c.tripId);
  const dueSchoolBookingTripIds = candidates
    .filter((c) => c.bookingCollection === "schoolBookings" && schedules.get(c.tripId))
    .map((c) => c.tripId);

  const bookingsResult = await fetchBookingRecordsForTripIds(env, "bookings", "routeId", dueBookingTripIds);
  const schoolBookingsResult = await fetchBookingRecordsForTripIds(
    env,
    "schoolBookings",
    "schoolTripId",
    dueSchoolBookingTripIds,
  );
  firestoreSubrequestsUsed += bookingsResult.subrequestsUsed + schoolBookingsResult.subrequestsUsed;

  let violationsCreated = 0;
  let duplicatesSkipped = 0;
  let ineligibleSkipped = 0;
  let failures = 0;

  for (const candidate of candidates) {
    try {
      const schedule = schedules.get(candidate.tripId) ?? null;
      const bookingsByTripId =
        candidate.bookingCollection === "bookings" ? bookingsResult.recordsByTripId : schoolBookingsResult.recordsByTripId;
      const records = bookingsByTripId.get(candidate.tripId) || [];

      const result = await processCandidate(env, candidate, now, schedule, records);
      if (result === "created") {
        violationsCreated += 1;
        firestoreSubrequestsUsed += 1;
      } else if (result === "already_exists") {
        duplicatesSkipped += 1;
        firestoreSubrequestsUsed += 1;
      } else {
        ineligibleSkipped += 1;
      }
    } catch (error) {
      // One candidate's failure must never stop the rest of the run — log
      // generically (never leak passenger/driver personal data to logs) and
      // continue.
      failures += 1;
      console.error("noShowDetection: candidate failed", candidate.tripId, error instanceof Error ? error.name : "unknown");
    }
  }

  if (violationsCreated > 0) {
    try {
      const notifyResult = await notifyAllAdmins(
        env,
        now,
        "No-show violations recorded",
        `${violationsCreated} driver no-show violation(s) were recorded in this run.`,
      );
      firestoreSubrequestsUsed += notifyResult.subrequestsUsed;
    } catch (error) {
      console.error("noShowDetection: admin notification fan-out failed", error instanceof Error ? error.name : "unknown");
    }
  }

  return {
    candidatesGathered: candidates.length,
    candidateTripIds: dueBookingTripIds.length + dueSchoolBookingTripIds.length,
    bookingDocumentsFetched: bookingsResult.documentsFetched,
    schoolBookingDocumentsFetched: schoolBookingsResult.documentsFetched,
    candidatesProcessed: candidates.length,
    eligibleNoShows: violationsCreated + duplicatesSkipped,
    violationsCreated,
    duplicatesSkipped,
    ineligibleSkipped,
    failures,
    firestoreSubrequestsUsed,
    durationMs: Date.now() - startedAt,
  };
}
