// ---------------------------------------------------------------------------
// Tests for the bulk-fetch driver no-show detector (see noShowDetection.ts's
// own header for the subrequest-budget bug this rewrite fixes). No real
// network/Firestore/emulator is used anywhere — `fetch` is fully mocked
// against a tiny in-memory fake Firestore, keyed the same way the real
// service's REST wire format is (see toWireFields/docName below), so these
// tests exercise the actual HTTP request/response shapes the Worker sends
// and parses, not a re-implementation of the logic under test.
//
// The service-account "private key" is a real, throwaway RSA keypair
// generated fresh for this test run (see makeTestPrivateKeyPem) — never a
// hardcoded secret, and never touches a real Google endpoint; the token
// exchange itself is mocked below, only the local JWT-signing step
// (crypto.subtle) needs a structurally valid PKCS8 key to succeed.
// ---------------------------------------------------------------------------

import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "./env";
import {
  chunkArray,
  combineScheduledDateTime,
  decideInitialRefundStatus,
  evaluateSchedule,
  graceDeadline,
  israelYmd,
  normalizeBookingRecord,
  runNoShowDetection,
} from "./noShowDetection";

// ---------------------------------------------------------------------------
// Fake Firestore — a tiny in-memory store keyed by collection, matching the
// real REST wire format closely enough that firestoreRest.ts's own
// encode/decode functions round-trip through it unmodified.
// ---------------------------------------------------------------------------

const PROJECT_ID = "test-project";

function makeTestPrivateKeyPem(): string {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return privateKey as unknown as string;
}

const TEST_ENV: Env = {
  GEMINI_API_KEY: "unused-in-these-tests",
  FIREBASE_PROJECT_ID: PROJECT_ID,
  FIREBASE_CLIENT_EMAIL: "test-service-account@test-project.iam.gserviceaccount.com",
  FIREBASE_PRIVATE_KEY: makeTestPrivateKeyPem(),
};

type FakeDoc = { collection: string; id: string; fields: Record<string, unknown> };

function toWireValue(value: unknown): unknown {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return { integerValue: String(Math.trunc(value)) };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (value === null || value === undefined) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toWireValue) } };
  throw new Error("unsupported test fixture value");
}

function toWireFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) out[key] = toWireValue(value);
  return out;
}

// The reverse of toWireValue/toWireFields — decodes a commit write's wire-
// format fields back into plain values, so the mock can actually persist
// what got written (mirrors firestoreRest.ts's own private
// fromFirestoreValue/fromFirestoreFields, reimplemented here since those
// aren't exported).
function fromWireValue(value: any): unknown {
  if (value == null) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue?.values || []).map(fromWireValue);
  return null;
}

function fromWireFields(fields: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields || {})) out[key] = fromWireValue(value);
  return out;
}

function docName(collection: string, id: string): string {
  return `projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${id}`;
}

function parseDocName(name: string): { collection: string; id: string } {
  const parts = name.split("/documents/")[1].split("/");
  return { collection: parts[0], id: parts[1] };
}

// ---------------------------------------------------------------------------
// Mock fetch — routes token exchange / runQuery / commit requests against
// the fake store below, and counts calls per Firestore collection so tests
// can assert the fix's actual claim: a bounded, chunked number of calls,
// never one per candidate.
// ---------------------------------------------------------------------------

let store: FakeDoc[];
let runQueryCallsByCollection: Record<string, number>;
let commitCallCount: number;
let forceChunkFailureForTripId: string | null;

function resetFakeFirestore() {
  store = [];
  runQueryCallsByCollection = {};
  commitCallCount = 0;
  forceChunkFailureForTripId = null;
}

function seed(collection: string, id: string, fields: Record<string, unknown>) {
  store.push({ collection, id, fields });
}

function mockFetchImplementation(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);

  if (url === "https://oauth2.googleapis.com/token") {
    return Promise.resolve(
      new Response(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }), { status: 200 }),
    );
  }

  if (url.endsWith(":runQuery")) {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const structuredQuery = body.structuredQuery;
    const collection = structuredQuery.from[0].collectionId;
    runQueryCallsByCollection[collection] = (runQueryCallsByCollection[collection] || 0) + 1;

    const where = structuredQuery.where;
    let matches = store.filter((d) => d.collection === collection);

    if (where?.fieldFilter?.op === "EQUAL") {
      const { fieldPath } = where.fieldFilter.field;
      const expected = where.fieldFilter.value.stringValue;
      matches = matches.filter((d) => d.fields[fieldPath] === expected);
    } else if (where?.fieldFilter?.op === "GREATER_THAN_OR_EQUAL") {
      // Mirrors queryFirestoreDocumentsWhereGte — a real Firestore range
      // query on a field EXCLUDES any document that doesn't have that field
      // at all (never coerces "missing" to "less than everything").
      const { fieldPath } = where.fieldFilter.field;
      const minValue = where.fieldFilter.value.stringValue;
      matches = matches.filter((d) => typeof d.fields[fieldPath] === "string" && (d.fields[fieldPath] as string) >= minValue);
    } else if (where?.fieldFilter?.op === "IN") {
      const { fieldPath } = where.fieldFilter.field;
      const values: string[] = where.fieldFilter.value.arrayValue.values.map((v: any) => v.stringValue);

      if (values.some((v) => v === forceChunkFailureForTripId)) {
        return Promise.resolve(new Response(JSON.stringify({ error: { message: "simulated failure" } }), { status: 500 }));
      }

      matches = matches.filter((d) => values.includes(d.fields[fieldPath] as string));
    } else if (where?.compositeFilter) {
      // Handles both shapes real callers send through a compositeFilter:
      // multiple EQUAL filters (queryFirestoreDocuments with >1 filter), and
      // — added for the bounded-window fix — a GTE+LTE pair on the SAME
      // field (queryFirestoreDocumentsWhereGte's optional maxValue). Mirrors
      // the real Firestore range-filter semantics used above: missing the
      // field entirely excludes the document, never coerced to "in range."
      for (const filter of where.compositeFilter.filters) {
        const { fieldPath } = filter.fieldFilter.field;
        const op = filter.fieldFilter.op;
        const value = filter.fieldFilter.value.stringValue;

        if (op === "GREATER_THAN_OR_EQUAL") {
          matches = matches.filter((d) => typeof d.fields[fieldPath] === "string" && (d.fields[fieldPath] as string) >= value);
        } else if (op === "LESS_THAN_OR_EQUAL") {
          matches = matches.filter((d) => typeof d.fields[fieldPath] === "string" && (d.fields[fieldPath] as string) <= value);
        } else {
          matches = matches.filter((d) => d.fields[fieldPath] === value);
        }
      }
    }

    // Cursor-based pagination support, mirroring queryFirestoreDocumentsByIn's
    // own startAt/orderBy(__name__) continuation protocol.
    matches.sort((a, b) => docName(a.collection, a.id).localeCompare(docName(b.collection, b.id)));
    if (structuredQuery.startAt) {
      const cursorName = structuredQuery.startAt.values[0].referenceValue;
      const cursorIndex = matches.findIndex((d) => docName(d.collection, d.id) === cursorName);
      matches = cursorIndex >= 0 ? matches.slice(cursorIndex + 1) : matches;
    }
    const limit: number | undefined = structuredQuery.limit;
    const page = typeof limit === "number" ? matches.slice(0, limit) : matches;

    const responseBody = page.map((d) => ({
      document: { name: docName(d.collection, d.id), fields: toWireFields(d.fields) },
    }));
    return Promise.resolve(new Response(JSON.stringify(responseBody), { status: 200 }));
  }

  if (url.endsWith(":commit")) {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const writes: any[] = body.writes;

    // Simulate Firestore's atomic all-or-nothing requireAbsent precondition:
    // if ANY write in this commit targets a doc that already "exists" and
    // requires absence, the WHOLE commit fails, exactly like real Firestore.
    // Checked against the actual store state (not a separately-tracked
    // set), so this correctly rejects both a doc created by an earlier
    // commit in this test AND one planted directly via seed() up front —
    // both represent "this document already exists" from Firestore's POV.
    for (const write of writes) {
      if (write.currentDocument?.exists === false) {
        const { collection, id } = parseDocName(write.update.name);
        if (store.some((d) => d.collection === collection && d.id === id)) {
          return Promise.resolve(new Response(JSON.stringify({ error: { message: "already exists" } }), { status: 409 }));
        }
      }
    }

    commitCallCount += 1;
    for (const write of writes) {
      const { collection, id } = parseDocName(write.update.name);

      const decodedFields = fromWireFields(write.update.fields);
      const existingDoc = store.find((d) => d.collection === collection && d.id === id);

      if (write.updateMask) {
        // Partial update — Firestore's updateMask semantics: only the
        // listed field paths are touched, everything else on the existing
        // document is left alone (mirrors buildUpdateWrite's contract).
        if (existingDoc) {
          for (const path of write.updateMask.fieldPaths) existingDoc.fields[path] = decodedFields[path];
        } else {
          const maskedFields: Record<string, unknown> = {};
          for (const path of write.updateMask.fieldPaths) maskedFields[path] = decodedFields[path];
          store.push({ collection, id, fields: maskedFields });
        }
      } else if (existingDoc) {
        // Full create/replace (buildCreateWrite's contract).
        existingDoc.fields = decodedFields;
      } else {
        store.push({ collection, id, fields: decodedFields });
      }
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
  }

  throw new Error(`Unmocked fetch call in test: ${url}`);
}

beforeEach(() => {
  resetFakeFirestore();
  vi.stubGlobal("fetch", vi.fn(mockFetchImplementation));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

// combineScheduledDateTime now interprets every stored date/time string as
// Asia/Jerusalem wall-clock time (see noShowDetection.ts's zonedTimeToUtc —
// this is the actual production-bug fix), so every `now`/comparison Date
// fixture below is built as an EXPLICIT UTC instant (Date.UTC), not the
// test runner machine's own ambient local timezone (which may not be
// Israel) — Israel is UTC+3 (IDT) for all the August dates used here.
// "2026-08-03 23:40 Asia/Jerusalem" = "2026-08-03 20:40 UTC".
const NOW = new Date(Date.UTC(2026, 7, 3, 20, 40, 0, 0)); // Well past any 23:00 scheduled time + 15-min grace, Israel time.
const DUE_DATE = "2026-08-03";
const DUE_TIME = "23:00"; // 23:00 + 15 min grace = 23:15 Israel time, well before NOW (23:40 Israel).

// A second pinned instant landing on the once-per-hour slot that also runs
// the legacy driverRoutes/date query (see runNoShowDetection's
// includeLegacyDateQuery, gated on now.getUTCMinutes() < 5) — NOW itself
// (minute 40) deliberately does NOT land on that slot, so tests that need
// the legacy query to actually run use this instant instead. Still well
// past DUE_TIME's 23:15 Israel grace deadline: 21:02 UTC = 00:02 Israel
// (IDT, Aug 4) — the trip's calendar date has rolled over relative to NOW's,
// but its scheduled instant is unaffected, so it's still "well overdue."
const NOW_HOURLY_TICK = new Date(Date.UTC(2026, 7, 3, 21, 2, 0, 0));

function seedDueDriverRoute(tripId: string, driverId: string, opts: { bookingType?: string } = {}) {
  seed("driverRoutes", tripId, {
    driverId,
    // The REAL field name production writes (see app/driver/create/
    // RideForm.tsx) — never `date`. A dedicated test below proves the
    // `date`-only legacy fallback separately; every other fixture uses the
    // real field so the default test setup matches production truth.
    tripDate: DUE_DATE,
    time: DUE_TIME,
    from: "A",
    to: "B",
    active: true,
    status: "booked",
    bookingType: opts.bookingType || "personal",
  });
}

function seedDueSchoolTrip(tripId: string, driverId: string) {
  seed("schoolTrips", tripId, {
    driverId,
    date: DUE_DATE,
    departureTime: DUE_TIME,
    fromAddress: "School",
    toAddress: "Home",
    active: true,
    status: "booked",
  });
}

function seedBooking(id: string, routeId: string, opts: { status?: string; passengerId?: string; paymentMethod?: string; price?: number } = {}) {
  seed("bookings", id, {
    routeId,
    status: opts.status ?? "booked",
    passengerId: opts.passengerId ?? `passenger-${id}`,
    paymentMethod: opts.paymentMethod ?? "cash",
    price: opts.price ?? 20,
  });
}

function seedSchoolBooking(id: string, schoolTripId: string, opts: { status?: string; passengerId?: string; paymentMethod?: string; price?: number } = {}) {
  seed("schoolBookings", id, {
    schoolTripId,
    status: opts.status ?? "booked",
    passengerId: opts.passengerId ?? `passenger-${id}`,
    paymentMethod: opts.paymentMethod ?? "cash",
    price: opts.price ?? 20,
  });
}

// ---------------------------------------------------------------------------
// Pure-function unit tests (no fetch involved)
// ---------------------------------------------------------------------------

describe("noShowDetection: pure helpers", () => {
  it("chunkArray splits into groups of at most `size`, preserving order", () => {
    const chunks = chunkArray([1, 2, 3, 4, 5, 6, 7], 3);
    expect(chunks).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });

  it("chunkArray of exactly a multiple of size produces no trailing empty chunk", () => {
    expect(chunkArray([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it("evaluateSchedule returns null before the grace period elapses, non-null after", () => {
    // 23:10 / 23:20 Asia/Jerusalem -> 20:10 / 20:20 UTC (see NOW's own comment above).
    const before = new Date(Date.UTC(2026, 7, 3, 20, 10, 0, 0));
    const after = new Date(Date.UTC(2026, 7, 3, 20, 20, 0, 0));
    expect(evaluateSchedule({ date: DUE_DATE, time: DUE_TIME }, before)).toBeNull();
    expect(evaluateSchedule({ date: DUE_DATE, time: DUE_TIME }, after)).not.toBeNull();
  });

  it("evaluateSchedule returns null for an invalid/missing date", () => {
    expect(evaluateSchedule({ date: "", time: DUE_TIME }, NOW)).toBeNull();
  });

  it("graceDeadline is exactly 15 minutes after scheduledAt", () => {
    const scheduledAt = new Date(2026, 7, 3, 23, 20, 0, 0);
    expect(graceDeadline(scheduledAt).getTime() - scheduledAt.getTime()).toBe(15 * 60 * 1000);
  });

  it("decideInitialRefundStatus is not_required only when every payment method is cash", () => {
    expect(decideInitialRefundStatus(["cash"])).toBe("not_required");
    expect(decideInitialRefundStatus(["cash", "cash"])).toBe("not_required");
    expect(decideInitialRefundStatus(["cash", "card"])).toBe("manual_refund_pending");
    expect(decideInitialRefundStatus(["bit"])).toBe("manual_refund_pending");
    expect(decideInitialRefundStatus([])).toBe("manual_refund_pending");
  });

  it("normalizeBookingRecord tolerates missing/malformed fields without throwing", () => {
    const record = normalizeBookingRecord("trip-1", { id: "b1", data: {} });
    expect(record).toEqual({ id: "b1", tripId: "trip-1", status: "", passengerId: "", paymentMethod: "", price: 0 });
  });
});

// ---------------------------------------------------------------------------
// Bulk-fetch behavior — the actual fix under test
// ---------------------------------------------------------------------------

describe("noShowDetection: bulk fetch stays bounded regardless of candidate count", () => {
  it("processing 120 candidate trips does not perform one booking fetch per candidate", async () => {
    for (let i = 0; i < 120; i += 1) {
      const tripId = `route-${i}`;
      seedDueDriverRoute(tripId, `driver-${i}`);
      seedBooking(`booking-${i}`, tripId);
    }

    const summary = await runNoShowDetection(TEST_ENV, NOW);

    expect(summary.candidatesGathered).toBe(120);
    expect(summary.candidateTripIds).toBe(120);
    expect(summary.violationsCreated).toBe(120);
    expect(summary.bookingDocumentsFetched).toBe(120);

    // 120 trip ids / 30-per-IN-query chunk size = exactly 4 runQuery calls
    // against `bookings` — never 120.
    expect(runQueryCallsByCollection["bookings"]).toBe(4);
  });

  it("the number of booking-read operations stays constant (chunked), not proportional to candidates for a small run", async () => {
    for (let i = 0; i < 5; i += 1) {
      const tripId = `route-${i}`;
      seedDueDriverRoute(tripId, `driver-${i}`);
      seedBooking(`booking-${i}`, tripId);
    }

    await runNoShowDetection(TEST_ENV, NOW);

    // 5 ids fit in a single 30-id chunk — exactly 1 runQuery call, not 5.
    expect(runQueryCallsByCollection["bookings"]).toBe(1);
  });
});

describe("noShowDetection: bookings are matched to the correct trip via the in-memory map", () => {
  it("each trip's violation only ever includes ITS OWN passengers, never another trip's", async () => {
    seedDueDriverRoute("route-A", "driver-A");
    seedDueDriverRoute("route-B", "driver-B");
    seedBooking("bk-A1", "route-A", { passengerId: "passenger-A1" });
    seedBooking("bk-A2", "route-A", { passengerId: "passenger-A2" });
    seedBooking("bk-B1", "route-B", { passengerId: "passenger-B1" });

    await runNoShowDetection(TEST_ENV, NOW);

    const violationA = store.find((d) => d.collection === "driverViolations" && d.id === "route-A");
    const violationB = store.find((d) => d.collection === "driverViolations" && d.id === "route-B");

    expect((violationA!.fields.passengerIds as string[]).sort()).toEqual(["passenger-A1", "passenger-A2"]);
    expect(violationA!.fields.passengerCount).toBe(2);
    expect((violationB!.fields.passengerIds as string[])).toEqual(["passenger-B1"]);
    expect(violationB!.fields.passengerCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Behavior preservation
// ---------------------------------------------------------------------------

describe("noShowDetection: behavior preservation", () => {
  it("a trip with at least one confirmed passenger creates exactly one violation", async () => {
    seedDueDriverRoute("route-1", "driver-1");
    seedBooking("bk-1", "route-1");

    const summary = await runNoShowDetection(TEST_ENV, NOW);

    expect(summary.violationsCreated).toBe(1);
    expect(store.some((d) => d.collection === "driverViolations" && d.id === "route-1")).toBe(true);
  });

  it("a trip with zero confirmed passengers creates no violation", async () => {
    seedDueDriverRoute("route-1", "driver-1");
    // No booking seeded at all.

    const summary = await runNoShowDetection(TEST_ENV, NOW);

    expect(summary.violationsCreated).toBe(0);
    expect(summary.ineligibleSkipped).toBe(1);
    expect(store.some((d) => d.collection === "driverViolations")).toBe(false);
  });

  it("a trip whose only booking is cancelled creates no violation (cancelled bookings never count)", async () => {
    seedDueDriverRoute("route-1", "driver-1");
    seedBooking("bk-1", "route-1", { status: "cancelled" });

    const summary = await runNoShowDetection(TEST_ENV, NOW);

    expect(summary.violationsCreated).toBe(0);
    expect(summary.ineligibleSkipped).toBe(1);
  });

  it("a trip the driver manually cancelled (status cancelled_by_driver) is never treated as a no-show, even with a real booking still attached", async () => {
    // Mirrors the mobile app's DRIVER_CANCELLED_TRIP_STATUS (see
    // app/booking/driverViolationCore.ts) — cancelDriverTrip/
    // cancelGeneralBooking's driver branch writes this exact status on the
    // driverRoutes doc. A driver who explicitly cancelled a trip must never
    // ALSO get a no-show violation for the same trip once its scheduled time
    // passes — the booking doc is included here specifically to prove
    // isStillOpenForNoShow excludes it before any booking-count check ever
    // runs, not merely because no booking exists.
    seed("driverRoutes", "route-1", {
      driverId: "driver-1",
      tripDate: DUE_DATE,
      time: DUE_TIME,
      from: "A",
      to: "B",
      active: true,
      status: "cancelled_by_driver",
      bookingType: "personal",
    });
    seedBooking("bk-1", "route-1");

    const summary = await runNoShowDetection(TEST_ENV, NOW);

    expect(summary.violationsCreated).toBe(0);
    expect(summary.candidateTripIds).toBe(0);
    expect(store.some((d) => d.collection === "driverViolations")).toBe(false);
  });

  it("a pre-existing violation for a trip is never duplicated (requireAbsent race-guard)", async () => {
    // Simulates a violation another run/process already created for this
    // trip while the trip/booking docs themselves still look like an
    // eligible candidate — isolates the requireAbsent precondition itself,
    // independent of gatherCandidates' own exclusion filtering below.
    seedDueDriverRoute("route-1", "driver-1");
    seedBooking("bk-1", "route-1");
    seed("driverViolations", "route-1", { driverId: "driver-1", tripId: "route-1", status: "open" });

    const summary = await runNoShowDetection(TEST_ENV, NOW);

    expect(summary.violationsCreated).toBe(0);
    expect(summary.duplicatesSkipped).toBe(1);
    const violationDocs = store.filter((d) => d.collection === "driverViolations" && d.id === "route-1");
    expect(violationDocs).toHaveLength(1); // Still exactly one — never duplicated.
  });

  it("running the detector twice in sequence only ever creates the violation once", async () => {
    seedDueDriverRoute("route-1", "driver-1");
    seedBooking("bk-1", "route-1");

    const first = await runNoShowDetection(TEST_ENV, NOW);
    expect(first.violationsCreated).toBe(1);

    // The first run's own write marks the trip driver_no_show + inactive,
    // which correctly excludes it from gatherCandidates on the next pass —
    // the real end-to-end idempotency mechanism, not just the guard above.
    const second = await runNoShowDetection(TEST_ENV, NOW);
    expect(second.violationsCreated).toBe(0);
    expect(second.candidatesGathered).toBe(0);

    const violationDocs = store.filter((d) => d.collection === "driverViolations" && d.id === "route-1");
    expect(violationDocs).toHaveLength(1);
  });

  it("supports schoolBookings the same way as bookings", async () => {
    seedDueSchoolTrip("school-1", "driver-1");
    seedSchoolBooking("sbk-1", "school-1");

    const summary = await runNoShowDetection(TEST_ENV, NOW);

    expect(summary.violationsCreated).toBe(1);
    expect(summary.schoolBookingDocumentsFetched).toBe(1);
    const violation = store.find((d) => d.collection === "driverViolations" && d.id === "school-1");
    expect(violation?.fields.category).toBe("school");
    expect(violation?.fields.schoolTripId).toBe("school-1");
  });

  it("supports personal and weekly trips (both live in bookings/driverRoutes)", async () => {
    seedDueDriverRoute("route-personal", "driver-1", { bookingType: "personal" });
    seedDueDriverRoute("route-weekly", "driver-2", { bookingType: "weekly" });
    seedBooking("bk-p", "route-personal");
    seedBooking("bk-w", "route-weekly");

    await runNoShowDetection(TEST_ENV, NOW);

    const personal = store.find((d) => d.collection === "driverViolations" && d.id === "route-personal");
    const weekly = store.find((d) => d.collection === "driverViolations" && d.id === "route-weekly");
    expect(personal?.fields.category).toBe("personal");
    expect(weekly?.fields.category).toBe("weekly");
  });

  it("a trip that is not yet due (grace period hasn't elapsed) creates no violation and is never queried for bookings", async () => {
    seed("driverRoutes", "route-not-due", {
      driverId: "driver-1",
      tripDate: "2026-08-03",
      time: "23:35", // NOW is 23:40 — grace ends 23:50, still in the future.
      from: "A",
      to: "B",
      active: true,
      status: "booked",
      bookingType: "personal",
    });
    seedBooking("bk-1", "route-not-due");

    const summary = await runNoShowDetection(TEST_ENV, NOW);

    expect(summary.candidatesGathered).toBe(1);
    expect(summary.candidateTripIds).toBe(0); // Never sent into the bulk fetch.
    expect(summary.violationsCreated).toBe(0);
    expect(runQueryCallsByCollection["bookings"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

describe("noShowDetection: pagination", () => {
  it("reads every page of a chunk's results, not just the first", async () => {
    // A single trip with far more bookings than one page would normally
    // hold — force a tiny effective page by seeding enough bookings that a
    // hard-coded pageSize of e.g. 300 is never reached in normal use, so
    // this test instead verifies the SAME trip's bookings all come back
    // correctly when the fake store returns them across what the mock
    // treats as a single large page (the pagination LOOP itself is
    // exercised directly below via queryFirestoreDocumentsByIn semantics:
    // this test's real assertion is that passengerCount matches the full
    // seeded booking count, not just a partial slice).
    seedDueDriverRoute("route-many", "driver-1");
    for (let i = 0; i < 50; i += 1) {
      seedBooking(`bk-${i}`, "route-many", { passengerId: `passenger-${i}` });
    }

    const summary = await runNoShowDetection(TEST_ENV, NOW);

    expect(summary.bookingDocumentsFetched).toBe(50);
    const violation = store.find((d) => d.collection === "driverViolations" && d.id === "route-many");
    expect(violation?.fields.passengerCount).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Server-side date-window query — the fix for the "Quota exceeded."
// (resource-exhausted) incident traced via Firestore Query Insights to
// gatherCandidates reading driverRoutes/schoolTrips with NO filter at all.
// ---------------------------------------------------------------------------

describe("noShowDetection: server-side date-window query (Quota exceeded fix)", () => {
  it("a driverRoutes trip dated well outside the 7-day lookback window is never gathered as a candidate", async () => {
    seed("driverRoutes", "route-ancient", {
      driverId: "driver-old",
      tripDate: "2026-01-01", // Far outside the 7-day lookback from NOW (2026-08-03).
      time: DUE_TIME,
      from: "A",
      to: "B",
      active: true,
      status: "booked",
      bookingType: "personal",
    });
    seedBooking("bk-ancient", "route-ancient");
    seedDueDriverRoute("route-recent", "driver-recent");
    seedBooking("bk-recent", "route-recent");

    const summary = await runNoShowDetection(TEST_ENV, NOW);

    // Only the in-window trip is gathered — the ancient one is excluded by
    // the server-side tripDate >= lookbackYmd filter, not merely skipped
    // client-side after being read.
    expect(summary.candidatesGathered).toBe(1);
    expect(summary.violationsCreated).toBe(1);
    expect(store.some((d) => d.collection === "driverViolations" && d.id === "route-ancient")).toBe(false);
    expect(store.some((d) => d.collection === "driverViolations" && d.id === "route-recent")).toBe(true);
  });

  it("a schoolTrips trip dated well outside the 7-day lookback window is never gathered as a candidate", async () => {
    seed("schoolTrips", "school-ancient", {
      driverId: "driver-old",
      date: "2026-01-01",
      departureTime: DUE_TIME,
      fromAddress: "School",
      toAddress: "Home",
      active: true,
      status: "booked",
    });
    seedSchoolBooking("sbk-ancient", "school-ancient");
    seedDueSchoolTrip("school-recent", "driver-recent");
    seedSchoolBooking("sbk-recent", "school-recent");

    const summary = await runNoShowDetection(TEST_ENV, NOW);

    expect(summary.candidatesGathered).toBe(1);
    expect(store.some((d) => d.collection === "driverViolations" && d.id === "school-ancient")).toBe(false);
    expect(store.some((d) => d.collection === "driverViolations" && d.id === "school-recent")).toBe(true);
  });

  it("on a non-hourly tick, only the tripDate query runs against driverRoutes (the legacy date fallback is skipped)", async () => {
    seedDueDriverRoute("route-1", "driver-1");
    seedBooking("bk-1", "route-1");
    seedDueSchoolTrip("school-1", "driver-2");
    seedSchoolBooking("sbk-1", "school-1");

    const summary = await runNoShowDetection(TEST_ENV, NOW); // NOW: minute 40, not an hourly tick.

    expect(summary.legacyDateQueryIncluded).toBe(false);
    expect(runQueryCallsByCollection["driverRoutes"]).toBe(1);
    expect(runQueryCallsByCollection["schoolTrips"]).toBe(1);
    // Both due trips (driverRoutes + schoolTrips) are still found and
    // flagged via the tripDate/date queries alone — the skipped legacy
    // driverRoutes/date query was never needed for either of them.
    expect(summary.violationsCreated).toBe(2);
  });

  it("on the once-per-hour tick, both the tripDate and legacy date queries run against driverRoutes", async () => {
    seedDueDriverRoute("route-1", "driver-1");
    seedBooking("bk-1", "route-1");
    seedDueSchoolTrip("school-1", "driver-2");
    seedSchoolBooking("sbk-1", "school-1");

    const summary = await runNoShowDetection(TEST_ENV, NOW_HOURLY_TICK); // minute 2 — the hourly slot.

    expect(summary.legacyDateQueryIncluded).toBe(true);
    expect(runQueryCallsByCollection["driverRoutes"]).toBe(2);
    expect(runQueryCallsByCollection["schoolTrips"]).toBe(1);
  });

  it("a driverRoutes trip dated 6 days before NOW's Israel-local date is still within the 7-day lookback", async () => {
    seed("driverRoutes", "route-within-7day", {
      driverId: "driver-within",
      tripDate: "2026-07-28", // 6 days before NOW's Israel-local date (2026-08-03).
      time: DUE_TIME,
      from: "A",
      to: "B",
      active: true,
      status: "booked",
      bookingType: "personal",
    });
    seed("driverRoutes", "route-outside-7day", {
      driverId: "driver-outside",
      // 10 days before — outside the new 7-day lookback, even though it
      // would still have been inside the old 30-day one.
      tripDate: "2026-07-24",
      time: DUE_TIME,
      from: "A",
      to: "B",
      active: true,
      status: "booked",
      bookingType: "personal",
    });

    const summary = await runNoShowDetection(TEST_ENV, NOW);

    expect(summary.candidatesGathered).toBe(1);
    expect(store.some((d) => d.collection === "driverRoutes" && d.id === "route-within-7day")).toBe(true);
  });

  it("a driverRoutes trip dated more than 1 day past NOW's Israel-local date is excluded by the new horizon bound", async () => {
    seed("driverRoutes", "route-too-far-future", {
      driverId: "driver-future",
      tripDate: "2026-08-05", // 2 days after NOW's Israel-local date — beyond the +1 day horizon.
      time: DUE_TIME,
      from: "A",
      to: "B",
      active: true,
      status: "booked",
      bookingType: "personal",
    });
    seed("driverRoutes", "route-tomorrow-within-horizon", {
      driverId: "driver-tomorrow",
      tripDate: "2026-08-04", // 1 day after — inside the horizon buffer, even though not due yet.
      time: DUE_TIME,
      from: "A",
      to: "B",
      active: true,
      status: "booked",
      bookingType: "personal",
    });
    seedDueDriverRoute("route-actually-due", "driver-due");
    seedBooking("bk-due", "route-actually-due");

    const summary = await runNoShowDetection(TEST_ENV, NOW);

    // route-too-far-future is excluded server-side, never even read;
    // route-tomorrow-within-horizon IS read (it's inside the buffer) but
    // correctly recognized as not due yet — grace-period gating, not the
    // date window, is what actually decides eligibility.
    expect(summary.candidatesGathered).toBe(2);
    expect(summary.violationsCreated).toBe(1);
    expect(store.some((d) => d.collection === "driverViolations" && d.id === "route-too-far-future")).toBe(false);
    expect(store.some((d) => d.collection === "driverViolations" && d.id === "route-tomorrow-within-horizon")).toBe(false);
    expect(store.some((d) => d.collection === "driverViolations" && d.id === "route-actually-due")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// israelYmd — the Israel-local calendar-date helper the bounded window is
// built on. Tested directly (not just through runNoShowDetection) because
// the bug it guards against is specifically about calendar-date computation,
// not eligibility logic — see the function's own header in noShowDetection.ts.
// ---------------------------------------------------------------------------

describe("noShowDetection: israelYmd (Israel-local date boundary correctness)", () => {
  it("returns Israel's calendar date, not UTC's, during the daily UTC/Israel day-boundary mismatch window", () => {
    // 2026-08-03 22:30 UTC = 2026-08-04 01:30 Asia/Jerusalem (IDT, UTC+3).
    // A naive `toISOString().slice(0,10)` on this instant would return
    // "2026-08-03" — one full calendar day behind the real Israel-local date.
    const instant = new Date(Date.UTC(2026, 7, 3, 22, 30, 0, 0));
    expect(israelYmd(instant)).toBe("2026-08-04");
  });

  it("agrees with a naive UTC slice outside the mismatch window", () => {
    // Midday UTC has no zone-boundary ambiguity — both calculations land on
    // the same calendar date, which is what makes ~21:00-23:59 UTC the only
    // dangerous window, not an all-day risk.
    const instant = new Date(Date.UTC(2026, 7, 3, 12, 0, 0, 0));
    expect(israelYmd(instant)).toBe("2026-08-03");
    expect(instant.toISOString().slice(0, 10)).toBe("2026-08-03");
  });

  it("end-to-end: a trip dated on Israel's already-rolled-over calendar day is still correctly gathered and flagged as due, at an instant where UTC's date has not yet rolled over", async () => {
    // 2026-08-03 22:00 UTC = 2026-08-04 01:00 Asia/Jerusalem — Israel is
    // already on Aug 4 while UTC still reads Aug 3. A trip scheduled for
    // 2026-08-04 00:15 Israel time has a grace deadline of 00:30 Israel
    // (2026-08-03 21:30 UTC), which has already passed relative to `now`.
    // If the window bounds were ever computed from the runtime's own UTC
    // date instead of israelYmd, this is the exact class of trip a
    // regression would risk silently excluding.
    const now = new Date(Date.UTC(2026, 7, 3, 22, 0, 0, 0));

    seed("driverRoutes", "route-day-boundary", {
      driverId: "driver-boundary",
      tripDate: "2026-08-04",
      time: "00:15",
      from: "Home",
      to: "Work",
      active: true,
      status: "booked",
      bookingType: "personal",
    });
    seedBooking("bk-boundary", "route-day-boundary", { passengerId: "passenger-boundary" });

    const summary = await runNoShowDetection(TEST_ENV, now);

    expect(summary.candidatesGathered).toBe(1);
    expect(summary.violationsCreated).toBe(1);
    expect(store.some((d) => d.collection === "driverViolations" && d.id === "route-day-boundary")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Resilience — one malformed/failed candidate must not block the rest
// ---------------------------------------------------------------------------

describe("noShowDetection: one malformed or failed candidate does not stop the run", () => {
  it("a booking chunk that fails to fetch does not prevent OTHER chunks' candidates from being processed", async () => {
    // 35 trips -> 2 IN-query chunks (30 + 5). Force the first chunk to fail.
    for (let i = 0; i < 35; i += 1) {
      const tripId = `route-${i}`;
      seedDueDriverRoute(tripId, `driver-${i}`);
      seedBooking(`booking-${i}`, tripId);
    }
    forceChunkFailureForTripId = "route-0"; // Lands in the first chunk.

    const summary = await runNoShowDetection(TEST_ENV, NOW);

    // The second chunk (5 trips) must still have been processed successfully.
    expect(summary.violationsCreated).toBe(5);
    expect(summary.ineligibleSkipped).toBe(30); // The failed chunk's trips have no bookings this cycle.
  });

  it("a booking document missing its own trip-reference field is skipped without throwing", async () => {
    seedDueDriverRoute("route-1", "driver-1");
    // A booking that references route-1 normally, plus a malformed one with
    // no routeId at all planted directly in the fake store.
    seedBooking("bk-1", "route-1");
    seed("bookings", "bk-malformed", { status: "booked", passengerId: "ghost", paymentMethod: "cash", price: 10 });

    const summary = await runNoShowDetection(TEST_ENV, NOW);

    expect(summary.violationsCreated).toBe(1);
    const violation = store.find((d) => d.collection === "driverViolations" && d.id === "route-1");
    expect(violation?.fields.passengerCount).toBe(1); // The malformed doc never attaches to any trip.
  });

  it("a malformed driverRoutes document does not stop gathering the rest", async () => {
    // A document whose bookingType is a non-string won't throw during
    // gathering (all field access already tolerates this via `||`
    // defaults) — the real malformed-input protection here is the
    // try/catch itself; this asserts a batch with one odd-shaped doc still
    // yields every other valid candidate. Deliberately uses the legacy
    // `date` field (not `tripDate`) here too, so this also doubles as
    // coverage for the tripDate-missing fallback alongside the malformed-
    // bookingType case. Uses NOW_HOURLY_TICK, not NOW, since the legacy
    // `date` query this doc depends on only runs once per hour.
    seed("driverRoutes", "route-odd", {
      driverId: "driver-1",
      date: DUE_DATE,
      time: DUE_TIME,
      active: true,
      status: "booked",
      bookingType: 12345, // Not a string — still must not crash gathering.
    });
    seedDueDriverRoute("route-normal", "driver-2");
    seedBooking("bk-1", "route-normal");
    seedBooking("bk-odd", "route-odd");

    const summary = await runNoShowDetection(TEST_ENV, NOW_HOURLY_TICK);

    expect(summary.candidatesGathered).toBe(2);
    expect(summary.violationsCreated).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Regression: the "route-lion" production case — a Personal trip scheduled
// 2026-08-04 00:15, still showing in Upcoming with Start Driving enabled and
// no violation recorded when checked at 2026-08-04 14:18 Asia/Jerusalem
// (~14 hours overdue). Root cause was TWO bugs, both covered below:
//   1. gatherCandidates read `data.date` on driverRoutes documents, but
//      production only ever writes `tripDate` (see RideForm.tsx) — every
//      real Personal/Weekly candidate was silently dropped before any
//      eligibility check ever ran.
//   2. combineScheduledDateTime built the scheduled Date using the Workers
//      runtime's own "local" timezone (always UTC), not Asia/Jerusalem —
//      the actual meaning of every stored date/time string in this
//      Israel-only product.
// ---------------------------------------------------------------------------

describe("noShowDetection: production regression — route-lion (2026-08-04 00:15 Personal trip)", () => {
  it("field discovery: driverRoutes' real production field is tripDate, not date", async () => {
    seed("driverRoutes", "route-tripdate-field", {
      driverId: "driver-1",
      tripDate: DUE_DATE, // the real field — no `date` key at all on this doc.
      time: DUE_TIME,
      from: "A",
      to: "B",
      active: true,
      status: "booked",
      bookingType: "personal",
    });
    seedBooking("bk-1", "route-tripdate-field");

    const summary = await runNoShowDetection(TEST_ENV, NOW);

    expect(summary.candidatesGathered).toBe(1);
    expect(summary.violationsCreated).toBe(1);
  });

  it("legacy fallback: a driverRoutes doc with ONLY `date` (no tripDate) is still supported, on the hourly tick that queries it", async () => {
    seed("driverRoutes", "route-legacy-date-field", {
      driverId: "driver-1",
      date: DUE_DATE, // no `tripDate` at all — must still be picked up.
      time: DUE_TIME,
      from: "A",
      to: "B",
      active: true,
      status: "booked",
      bookingType: "personal",
    });
    seedBooking("bk-1", "route-legacy-date-field");

    // NOW_HOURLY_TICK, not NOW — the legacy `date` query now only runs once
    // per hour (see gatherCandidates' own header), so this fixture must land
    // on that slot to actually exercise the fallback path.
    const summary = await runNoShowDetection(TEST_ENV, NOW_HOURLY_TICK);

    expect(summary.legacyDateQueryIncluded).toBe(true);
    expect(summary.candidatesGathered).toBe(1);
    expect(summary.violationsCreated).toBe(1);
  });

  it("combineScheduledDateTime interprets stored times as Asia/Jerusalem, not the runtime's own UTC", () => {
    // 2026-08-04 00:15 Asia/Jerusalem (IDT, UTC+3) = 2026-08-03 21:15 UTC.
    // If this were misinterpreted as a plain UTC time instead (the bug),
    // it would come back as 2026-08-04T00:15:00.000Z — 3 hours later.
    const scheduledAt = combineScheduledDateTime("2026-08-04", "00:15");
    expect(scheduledAt?.toISOString()).toBe("2026-08-03T21:15:00.000Z");
  });

  it("the exact production scenario: a Personal trip at 2026-08-04 00:15, checked at 2026-08-04 14:18 Asia/Jerusalem, is an eligible no-show with one confirmed passenger", async () => {
    // 2026-08-04 14:18 Asia/Jerusalem (IDT, UTC+3) = 2026-08-04 11:18 UTC.
    const PRODUCTION_CHECK_TIME = new Date(Date.UTC(2026, 7, 4, 11, 18, 0, 0));

    seed("driverRoutes", "route-lion", {
      driverId: "driver-lion",
      tripDate: "2026-08-04",
      time: "00:15",
      from: "Home",
      to: "Work",
      active: true,
      status: "booked",
      bookingType: "personal",
    });
    seedBooking("bk-lion", "route-lion", { passengerId: "passenger-lion", status: "booked" });

    const summary = await runNoShowDetection(TEST_ENV, PRODUCTION_CHECK_TIME);

    expect(summary.candidatesGathered).toBe(1);
    expect(summary.candidateTripIds).toBe(1); // Correctly recognized as due.
    expect(summary.bookingDocumentsFetched).toBe(1); // The booking WAS found this time.
    expect(summary.eligibleNoShows).toBe(1);
    expect(summary.violationsCreated).toBe(1);

    const violation = store.find((d) => d.collection === "driverViolations" && d.id === "route-lion");
    expect(violation).toBeDefined();
    expect(violation?.fields.driverId).toBe("driver-lion");
    expect(violation?.fields.passengerIds).toEqual(["passenger-lion"]);
    expect(violation?.fields.passengerCount).toBe(1);
    expect(violation?.fields.category).toBe("personal");

    // The trip itself is what drives the mobile UI's Upcoming/Violations
    // split (see bookingsLib.ts's getDriverTripBucket, tested separately in
    // tests/driverNoShowCore.test.ts) — confirms the Worker actually wrote
    // the flag that removes it from Upcoming.
    const updatedRoute = store.find((d) => d.collection === "driverRoutes" && d.id === "route-lion");
    expect(updatedRoute?.fields.tripStatus).toBe("driver_no_show");
    expect(updatedRoute?.fields.active).toBe(false);

    const updatedBooking = store.find((d) => d.collection === "bookings" && d.id === "bk-lion");
    expect(updatedBooking?.fields.tripStatus).toBe("driver_no_show");
  });
});
