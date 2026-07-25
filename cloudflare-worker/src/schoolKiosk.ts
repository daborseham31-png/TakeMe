// ---------------------------------------------------------------------------
// School Kiosk return-ride lookup — Phase 2 of the School Return Kiosk
// project (Phase 1 was the School Child profile system — see
// schoolChildren.ts). This is the backend ONLY: a public, read-only endpoint
// a school kiosk device calls after a child types their own PERMANENT 6-digit
// return identification code. The final kiosk HTML page (Phase 3) is not
// built in this pass — see index.ts for the route wiring.
//
// TWO DIFFERENT CODES — never mixed, never substituted for one another:
//   - The PERMANENT return identification code (schoolChildren/{id}.
//     returnCode, hashed into schoolChildCodes/{hash} — see schoolChildren.ts)
//     belongs to the CHILD forever and is ONLY ever used to open this kiosk
//     lookup. This file never returns it in the response.
//   - The TEMPORARY trip verification code (schoolBookings/{id}.
//     verificationCode) belongs to ONE specific return booking and is what
//     the child recites to the driver when getting in the car (checked by
//     the driver in verifyPassengerCodeAndStartTrip — see schoolTripsLib.ts
//     on the client and the schoolBookings update rule in firestore.rules).
//     This file only ever READS that existing code; it never generates,
//     rotates, or consumes one.
//
// READ-ONLY: this file never writes to Firestore. It never creates a
// booking, changes status/tripStatus, marks a verification code consumed, or
// touches the child profile. Starting/verifying a trip remains exclusively
// the driver app's job.
//
// Firestore access reuses firestoreRest.ts's existing service-account REST
// client (Admin-equivalent trust, bypasses firestore.rules the same way the
// Admin SDK would) — no new access pattern introduced.
// ---------------------------------------------------------------------------

import type { Env } from "./env";
import {
  getFirestoreDocument,
  queryFirestoreDocuments,
} from "./firestoreRest";
import {
  hashReturnCode,
  MAX_SCHOOL_ID_LENGTH,
  RETURN_CODE_LENGTH,
  SCHOOL_CHILD_CODES_COLLECTION,
  SCHOOL_CHILDREN_COLLECTION,
} from "./schoolChildren";

const SCHOOL_BOOKINGS_COLLECTION = "schoolBookings";
const RIDE_REQUESTS_COLLECTION = "rideRequests";
// Read only as resolveReturnRoute's own secondary-evidence fallback (the
// linked trip's schoolAddress) — never queried directly, never the primary
// source for anything else in this file (see this file's header: a real
// schoolBookings document already mirrors everything else the kiosk needs).
const SCHOOL_TRIPS_COLLECTION = "schoolTrips";

// The one and only return-direction value schoolBookings/rideRequests ever
// use for a return leg (see schoolTripsLib.ts's SchoolTripDirection on the
// client) — never invented here, never the outbound "to_school" value.
const RETURN_DIRECTION = "from_school";

const RETURN_CODE_PATTERN = new RegExp(`^\\d{${RETURN_CODE_LENGTH}}$`);

export type SchoolKioskState =
  | "no_return_today"
  | "searching_driver"
  | "awaiting_confirmation"
  | "confirmed"
  | "driver_on_way"
  | "arrived_pickup"
  | "in_progress"
  | "completed"
  | "cancelled";

export type SchoolKioskReturnRide = {
  finishingTime: string;
  routeFrom: string;
  routeTo: string;
  driver: { displayName: string } | null;
  vehicle: { make: string | null; color: string | null; plateNumber: string | null } | null;
  // No such field exists anywhere in this project's schema yet
  // (schoolBookings/schoolTrips only ever store fromAddress/toAddress) —
  // never invented here; always null until a real field exists to read.
  meetingPoint: string | null;
  verificationCode: string | null;
};

export type SchoolKioskLookupResult =
  | { ok: false; code: "NOT_FOUND" }
  | {
      ok: true;
      date: string;
      state: SchoolKioskState;
      child: { displayName: string };
      returnRide: SchoolKioskReturnRide | null;
    };

// One generic, safe failure result for EVERY invalid/mismatched/not-found
// case — an unknown code, a code for the wrong school, a deactivated child,
// or a ledger/profile inconsistency all look identical to the caller. Never
// reveal WHICH check failed (e.g. "that code exists but for another
// school") — see this file's header and the task's own NOT_FOUND
// requirement.
const NOT_FOUND: SchoolKioskLookupResult = { ok: false, code: "NOT_FOUND" };

// Server-side "today" for the school day boundary — Asia/Jerusalem, never
// UTC midnight (a UTC day flips at 02:00/03:00 local time, which would show
// yesterday's already-finished return, or tomorrow's not-yet-existing one,
// for a large chunk of the actual school day). en-CA + these options is the
// one Intl.DateTimeFormat locale/option combination that formats straight to
// "YYYY-MM-DD" without extra parsing. Never trusts a client-supplied date in
// this phase (see this file's header).
function todayInJerusalem(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// The ONE place a real schoolBookings doc's own status/tripStatus become a
// normalized kiosk state — reads the exact existing values, never writes or
// invents a new one. `status` (booked/cancelled/completed) is checked first
// since it can override tripStatus (a completed/cancelled booking's
// tripStatus is not necessarily itself "completed"); otherwise tripStatus
// (the finer-grained live-tracking field — see schoolTripsLib.ts's
// TripTrackingStatus) decides exactly which "confirmed and moving" state
// this is.
function mapBookingState(data: Record<string, unknown>): SchoolKioskState {
  const status = asString(data.status);
  const tripStatus = asString(data.tripStatus);

  if (status === "cancelled") return "cancelled";
  if (status === "completed" || tripStatus === "completed") return "completed";
  if (tripStatus === "driver_on_way") return "driver_on_way";
  if (tripStatus === "arrived_pickup") return "arrived_pickup";
  if (tripStatus === "in_progress") return "in_progress";
  return "confirmed";
}

// The temporary verification code is only ever shown while it's still
// actually usable at pickup: the booking must be confirmed/en
// route/arrived (never while still searching/awaiting a booking, and never
// once cancelled/completed), AND the code's own lifecycle must still be
// "pending" (see schoolTripsLib.ts's VerificationStatus) — the ONLY update
// path that ever moves tripStatus past arrived_pickup into in_progress also
// moves verificationStatus to "verified" in that SAME write (see the
// schoolBookings update rule in firestore.rules), so by the time a trip is
// actually in_progress the code is already consumed and this naturally
// returns null without needing a separate "already used" check. "failed"
// (a wrong guess) and "expired" (the stale-code sweep) both correctly hide
// it too, since neither is "pending".
function resolveVerificationCode(
  state: SchoolKioskState,
  data: Record<string, unknown>,
): string | null {
  const codeEligibleState = state === "confirmed" || state === "driver_on_way" || state === "arrived_pickup";
  if (!codeEligibleState) return null;

  if (asString(data.verificationStatus) !== "pending") return null;

  const code = asString(data.verificationCode);
  return code || null;
}

function buildVehicle(data: Record<string, unknown>): SchoolKioskReturnRide["vehicle"] {
  const make = asString(data.car);
  const color = asString(data.carColor);
  const plateNumber = asString(data.carPlate);

  if (!make && !color && !plateNumber) return null;

  return {
    make: make || null,
    color: color || null,
    plateNumber: plateNumber || null,
  };
}

type LatLng = { latitude: number; longitude: number };

function asLatLng(value: unknown): LatLng | null {
  if (
    value &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>).latitude === "number" &&
    typeof (value as Record<string, unknown>).longitude === "number"
  ) {
    const point = value as { latitude: number; longitude: number };
    return { latitude: point.latitude, longitude: point.longitude };
  }
  return null;
}

// Rough planar distance in kilometers — good enough, at Israel's scale, to
// tell "same city/area" from "a different one". Never used for real
// routing/navigation, only this one same-area check below.
function approxDistanceKm(a: LatLng, b: LatLng): number {
  const latKm = (a.latitude - b.latitude) * 111;
  const lngKm = (a.longitude - b.longitude) * 111 * Math.cos((a.latitude * Math.PI) / 180);
  return Math.sqrt(latKm * latKm + lngKm * lngKm);
}

// A flat "is this within N km of the school" threshold (an EARLIER version
// of this function used exactly that, at 15km) turned out to be unsafe:
// verified against this project's own real data (schoolId "278010", ORT
// Israel Nazareth, at 32.697563,35.304786 — a real registered school in
// app/booking/schools.ts), the real reported booking's two endpoints
// (Mashhad, ~4.65km from the school, and Nazareth, ~0.82km from the school)
// are BOTH within 15km of the school, since Mashhad is itself only a few km
// from Nazareth. A flat threshold therefore judged BOTH endpoints "close
// enough to be the school" and never swapped — it would have kept showing
// the real booking backwards. Relative closeness (which one is CLEARLY
// nearer, not merely "which ones fall under one shared radius") correctly
// distinguishes them: 0.82km is decisively closer to the school than
// 4.65km is, even though neither is far away in absolute terms.
const CONFIDENCE_MARGIN_KM = 2;
const CONFIDENCE_RATIO = 0.6;

// Whether the closer of two distances is confidently, not just nominally,
// nearer than the farther one — BOTH a minimum absolute gap (so two
// distances a few hundred meters apart, e.g. 3.0km vs 3.2km, are never
// treated as decisive) AND a minimum relative gap (so two distances that
// are both merely "large", e.g. 40km vs 42km, are never treated as
// decisive either) must hold. Chosen after checking the real numbers above
// (closer=0.82, farther=4.65 → gap=3.83km ≥ 2km, ratio=0.82/4.65≈0.18 ≤
// 0.6 — clearly confident) against a deliberately-ambiguous case (closer=3,
// farther=4 → gap=1km < 2km — correctly NOT confident, since two points
// only 1km apart in distance-from-school are genuinely too close to call).
function isConfidentlyCloser(closerKm: number, fartherKm: number): boolean {
  return fartherKm - closerKm >= CONFIDENCE_MARGIN_KM && closerKm <= CONFIDENCE_RATIO * fartherKm;
}

// Strips Unicode combining diacritical marks (U+0300-U+036F) left over
// after NFKD decomposition — built from numeric code points via
// String.fromCharCode, never a literal combining character (or an escape
// sequence that could itself be silently re-interpreted) sitting in this
// file's own source text.
const COMBINING_MARKS_RANGE_START = 0x0300;
const COMBINING_MARKS_RANGE_END = 0x036f;
const COMBINING_MARKS_PATTERN = new RegExp(
  "[" + String.fromCharCode(COMBINING_MARKS_RANGE_START) + "-" + String.fromCharCode(COMBINING_MARKS_RANGE_END) + "]",
  "g",
);

function normalizeForCompare(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(COMBINING_MARKS_PATTERN, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Secondary, best-effort evidence only — whether `a` and `b` plausibly name
// the SAME place, after normalizing case/diacritics/punctuation. Exact
// match or substring containment either direction (a school's own
// "schoolAddress" city name and a driver-picked area string are rarely
// byte-identical, but one is often a clean substring of the other).
// Deliberately conservative: an empty/non-match on either side just means
// "no evidence", never "definitely different".
function looksLikeSamePlace(a: string, b: string): boolean {
  const normA = normalizeForCompare(a);
  const normB = normalizeForCompare(b);
  if (!normA || !normB) return false;
  return normA === normB || normA.includes(normB) || normB.includes(normA);
}

// Direction-aware route selection for a from_school (return) booking.
//
// The documented storage convention throughout this project (see
// schoolTripsLib.ts's RideRequest.fromArea comment — "the return trip's
// From (school area)" — and SchoolTripForm.tsx's outbound-derived return
// leg, which explicitly sets the return's fromArea from the outbound's own
// toArea BECAUSE that is the school) is: for a from_school booking,
// fromAddress is the school/departure side and toAddress is the child's
// destination. bookSingleSchoolTrip copies both straight from the trip with
// no transformation, so a booking's fromAddress/toAddress are only ever as
// correct as whatever created the underlying schoolTrips document.
//
// One creation path — a driver posting a "return only" trip (see
// SchoolTripForm.tsx) — types fromArea/toArea into two genuinely
// interchangeable, generically-labeled ("From"/"To") fields with no
// enforced/derived direction, unlike every other creation path (which
// derives fromArea programmatically from a known school-side value). A
// driver who read that as "my own route" rather than "the school side" can
// end up with the two swapped for that one document.
//
// Rather than EITHER blindly trusting the convention (which would keep
// showing an affected booking backwards) OR blindly swapping every
// from_school booking (which would break the ones that are already correct,
// and would hide the real data problem instead of working around it for
// just the affected case), this is decided in three tiers, each only
// consulted if the previous one was inconclusive:
//   1. GPS confidence — compare fromLocation/toLocation against
//      schoolLocation (the school's own real GPS point, copied onto the
//      booking independent of whichever of fromAddress/toAddress a driver
//      typed) using isConfidentlyCloser, never a flat radius (see that
//      function's own comment for why a flat radius is unsafe).
//   2. Secondary evidence — only reached when GPS is missing or too close
//      to call: fetch the linked schoolTrips/{tripId} document (already
//      known via this booking's own tripId) for ITS schoolAddress (a field
//      schoolBookings itself doesn't carry) and check whether it plausibly
//      names one of fromAddress/toAddress and not the other.
//   3. Otherwise, keep the stored order exactly as-is — never guess.
// The stored Firestore fields themselves are never modified in any tier.
// The exact set of tiers a lookup can resolve through — logged (never with
// any address/coordinate/id/name alongside it) so a real discrepancy report
// can be diagnosed without guessing which tier actually ran. GPS_KEEP/
// GPS_SWAP mean tier 1 (coordinate confidence) decided it; SCHOOL_TEXT_KEEP/
// SCHOOL_TEXT_SWAP mean tier 2 (the linked trip's schoolAddress) decided it;
// FALLBACK_STORED means neither tier could decide anything and the stored
// order was kept as-is.
type RouteResolutionTier =
  | "GPS_KEEP"
  | "GPS_SWAP"
  | "SCHOOL_TEXT_KEEP"
  | "SCHOOL_TEXT_SWAP"
  | "FALLBACK_STORED";

async function resolveReturnRoute(
  env: Env,
  data: Record<string, unknown>,
): Promise<{ routeFrom: string; routeTo: string }> {
  const fromAddress = asString(data.fromAddress);
  const toAddress = asString(data.toAddress);
  const original = { routeFrom: fromAddress, routeTo: toAddress };
  const swapped = { routeFrom: toAddress, routeTo: fromAddress };

  const schoolLocation = asLatLng(data.schoolLocation);
  const fromLocation = asLatLng(data.fromLocation);
  const toLocation = asLatLng(data.toLocation);
  const tripId = asString(data.tripId);

  // Dev-safe diagnostic — presence/shape booleans only, logged BEFORE the
  // decision below regardless of which tier ends up deciding it. Never the
  // addresses, coordinates, tripId itself, or any other document field.
  const logTierAndReturn = (
    tier: RouteResolutionTier,
    route: { routeFrom: string; routeTo: string },
  ) => {
    console.log("SCHOOL_KIOSK_ROUTE_RESOLUTION", {
      feature: "resolveReturnRoute",
      hasSchoolLocation: !!schoolLocation,
      hasFromLocation: !!fromLocation,
      hasToLocation: !!toLocation,
      hasTripId: !!tripId,
      tier,
    });
    return route;
  };

  if (schoolLocation && fromLocation && toLocation) {
    const fromDistance = approxDistanceKm(schoolLocation, fromLocation);
    const toDistance = approxDistanceKm(schoolLocation, toLocation);
    const closer = Math.min(fromDistance, toDistance);
    const farther = Math.max(fromDistance, toDistance);

    if (isConfidentlyCloser(closer, farther)) {
      return fromDistance < toDistance
        ? logTierAndReturn("GPS_KEEP", original)
        : logTierAndReturn("GPS_SWAP", swapped);
    }
  }

  if (tripId) {
    try {
      const trip = await getFirestoreDocument(env, SCHOOL_TRIPS_COLLECTION, tripId);
      const schoolAddress = trip ? asString(trip.data.schoolAddress) : "";

      if (schoolAddress) {
        const fromMatches = looksLikeSamePlace(fromAddress, schoolAddress);
        const toMatches = looksLikeSamePlace(toAddress, schoolAddress);

        if (toMatches && !fromMatches) return logTierAndReturn("SCHOOL_TEXT_SWAP", swapped);
        if (fromMatches && !toMatches) return logTierAndReturn("SCHOOL_TEXT_KEEP", original);
      }
    } catch (error) {
      // A failed secondary lookup must never fail the whole kiosk response —
      // fall through to the safe default below, exactly as if it had simply
      // been inconclusive. Never logs the address/route values themselves.
      console.error("resolveReturnRoute: secondary trip lookup failed", error instanceof Error ? error.name : "unknown");
    }
  }

  // Still ambiguous, or no coordinates/secondary evidence at all — never
  // guess; keep the stored order exactly as the documented convention
  // already assumes.
  return logTierAndReturn("FALLBACK_STORED", original);
}

// A real schoolBookings document already mirrors everything the kiosk needs
// (driverName/car/carColor/carPlate/fromAddress/toAddress/departureTime —
// copied from the trip at booking time, same as every other reader of this
// collection — see schoolTripsLib.ts's SchoolBooking comments). It only
// reads schoolTrips/{tripId} separately as resolveReturnRoute's OWN
// best-effort secondary evidence, when GPS alone can't confidently decide
// the route direction — see that function. Never returns driverPhone,
// passengerName/passengerPhone (the PARENT's own contact info — see this
// file's excluded-fields list in the final report), or any document id.
async function buildBookingResult(
  env: Env,
  date: string,
  displayName: string,
  data: Record<string, unknown>,
): Promise<SchoolKioskLookupResult> {
  const state = mapBookingState(data);
  const driverName = asString(data.driverName);
  const route = await resolveReturnRoute(env, data);

  return {
    ok: true,
    date,
    state,
    child: { displayName },
    returnRide: {
      finishingTime: asString(data.departureTime),
      routeFrom: route.routeFrom,
      routeTo: route.routeTo,
      driver: driverName ? { displayName: driverName } : null,
      vehicle: buildVehicle(data),
      meetingPoint: null,
      verificationCode: resolveVerificationCode(state, data),
    },
  };
}

// A rideRequest never has a driver/vehicle/verification code at all yet (no
// real booking exists) — "matched" means the matching system found a
// candidate trip and is waiting on the parent to actually confirm+pay
// (bookReturnForChild — see schoolTripsLib.ts and useMySchoolRows.tsx's
// findLinkedBooking on the client, which this endpoint mirrors the same
// priority for); plain "waiting" means still searching.
function buildRequestResult(
  date: string,
  displayName: string,
  data: Record<string, unknown>,
): SchoolKioskLookupResult {
  const state: SchoolKioskState = asString(data.status) === "matched" ? "awaiting_confirmation" : "searching_driver";

  return {
    ok: true,
    date,
    state,
    child: { displayName },
    returnRide: {
      finishingTime: asString(data.requestedTime),
      routeFrom: asString(data.fromArea),
      routeTo: asString(data.toArea),
      driver: null,
      vehicle: null,
      meetingPoint: null,
      verificationCode: null,
    },
  };
}

// Whether a candidate rideRequest genuinely belongs to the validated kiosk
// school — never assumed true just because it matches on childId/date (that
// only proves it's the same CHILD on the same DAY, not the same school; a
// child can plausibly have requests tied to a different school, e.g. a
// sibling's profile mixed up, a school transfer mid-year, or test data).
//
// Modern requests carry their own schoolId directly (set at creation — see
// schoolTripsLib.ts) and are checked exactly. A LEGACY request predating
// that field has none — this never blindly accepts those; it only accepts
// one if a linked matchedBookingId or matchedTripId can be fetched and its
// OWN schoolId confirmed to match. If neither linkage exists, or neither
// resolves, the request is rejected — silently accepting an unverifiable
// legacy request would reintroduce exactly the cross-school bug this
// function exists to close.
async function requestBelongsToSchool(
  env: Env,
  request: { data: Record<string, unknown> },
  schoolId: string,
): Promise<boolean> {
  const requestSchoolId = asString(request.data.schoolId);
  if (requestSchoolId) {
    return requestSchoolId === schoolId;
  }

  const matchedBookingId = asString(request.data.matchedBookingId);
  if (matchedBookingId) {
    try {
      const booking = await getFirestoreDocument(env, SCHOOL_BOOKINGS_COLLECTION, matchedBookingId);
      if (booking && asString(booking.data.schoolId) === schoolId) return true;
    } catch (error) {
      console.error(
        "requestBelongsToSchool: matchedBookingId lookup failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
  }

  const matchedTripId = asString(request.data.matchedTripId);
  if (matchedTripId) {
    try {
      const trip = await getFirestoreDocument(env, SCHOOL_TRIPS_COLLECTION, matchedTripId);
      if (trip && asString(trip.data.schoolId) === schoolId) return true;
    } catch (error) {
      console.error(
        "requestBelongsToSchool: matchedTripId lookup failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
  }

  return false;
}

export async function lookupSchoolKiosk(
  env: Env,
  input: { returnCode?: unknown; schoolId?: unknown },
): Promise<SchoolKioskLookupResult> {
  // Exactly 6 numeric characters, kept as a STRING throughout (never
  // Number()'d) so a code like "004821" never loses its leading zeroes.
  const returnCode = typeof input?.returnCode === "string" ? input.returnCode.trim() : "";
  const schoolId = typeof input?.schoolId === "string" ? input.schoolId.trim() : "";

  if (!RETURN_CODE_PATTERN.test(returnCode) || !schoolId || schoolId.length > MAX_SCHOOL_ID_LENGTH) {
    return NOT_FOUND;
  }

  // Hash first, look up the ledger by hash — NEVER a query scanning
  // schoolChildren for a plaintext returnCode match (see this collection's
  // own header comment in firestore.rules: a client-readable/queryable
  // ledger by plaintext would let an attacker enumerate valid codes).
  const hash = await hashReturnCode(returnCode);

  const codeDoc = await getFirestoreDocument(env, SCHOOL_CHILD_CODES_COLLECTION, hash);
  const childId = codeDoc ? asString(codeDoc.data.childId) : "";
  if (!childId) return NOT_FOUND;

  const child = await getFirestoreDocument(env, SCHOOL_CHILDREN_COLLECTION, childId);
  if (
    !child ||
    child.data.active !== true ||
    asString(child.data.schoolId) !== schoolId ||
    // Cross-checks the ledger entry against the child's OWN current hash —
    // catches a stale/orphaned schoolChildCodes doc left over from a race
    // during resetSchoolChildReturnCode (see that function's own comment on
    // releasing the old reservation in the same atomic commit as the new
    // one) ever pointing at a code the child profile no longer actually
    // uses.
    asString(child.data.returnCodeHash) !== hash
  ) {
    // Deliberately the exact same generic result as "no such code at all" —
    // never reveals that the code IS valid but for a different school, or
    // that the child was deactivated, or any other specific reason.
    return NOT_FOUND;
  }

  const displayName = asString(child.data.childName);
  const date = todayInJerusalem();

  // Only ever the return direction — outbound (to_school) bookings are
  // never relevant to this endpoint (see this file's header).
  const [bookingCandidates, requestCandidates] = await Promise.all([
    queryFirestoreDocuments(env, SCHOOL_BOOKINGS_COLLECTION, {
      childId,
      date,
      bookingDirection: RETURN_DIRECTION,
    }),
    queryFirestoreDocuments(env, RIDE_REQUESTS_COLLECTION, {
      childId,
      requestedDate: date,
    }),
  ]);

  // Enforce the SAME schoolId already validated against the child profile
  // above — childId + date + direction alone only prove "same child, same
  // day, same direction"; without this check a booking/request that happens
  // to belong to a DIFFERENT school could still be selected and shown on
  // this kiosk. schoolBookings always carries schoolId (set at creation
  // from the trip), so this is a plain equality filter, no missing-field
  // case to handle. Done here in the Worker rather than as an extra
  // Firestore query-level filter so the pre-filter candidate count stays
  // observable for diagnostics below, and so no new composite index is
  // required.
  const bookings = bookingCandidates.filter((b) => asString(b.data.schoolId) === schoolId);
  const bookingsRejectedForSchoolMismatch = bookingCandidates.length - bookings.length;

  // rideRequests are checked one by one (some legacy docs have no schoolId
  // of their own — see requestBelongsToSchool's own comment on why those are
  // only accepted with independent proof, never assumed).
  const requestSchoolMatches = await Promise.all(
    requestCandidates.map((r) => requestBelongsToSchool(env, r, schoolId)),
  );
  const requests = requestCandidates.filter((_, index) => requestSchoolMatches[index]);
  const requestsRejectedForSchoolMismatch = requestCandidates.length - requests.length;

  // Deduplication priority (never by child name, array position, or
  // displayed time alone — see this file's header + the client's own
  // useMySchoolRows.tsx's findLinkedBooking, which this mirrors). This now
  // runs strictly on the already school-filtered candidate sets above, so
  // an older or different-school booking can never win here.
  //   1. A real, non-cancelled (active or completed) booking — if one
  //      exists, it IS today's ride, full stop; any request for the same
  //      child/date is now moot and never separately surfaced.
  //   2. A still-active (waiting/matched) request — no real booking yet.
  //   3. A cancelled booking, when there is no active request either — the
  //      ride WAS arranged and then cancelled, which is itself one of the
  //      normalized states, never silently dropped to "no_return_today".
  //   4. Nothing at all.
  const activeOrCompletedBooking = bookings.find((b) => asString(b.data.status) !== "cancelled");
  const activeRequest = activeOrCompletedBooking
    ? undefined
    : requests.find((r) => {
        const status = asString(r.data.status);
        return status === "waiting" || status === "matched";
      });
  const cancelledBooking =
    activeOrCompletedBooking || activeRequest
      ? undefined
      : bookings.find((b) => asString(b.data.status) === "cancelled");

  const selectedBooking = activeOrCompletedBooking || cancelledBooking;
  const selectedSource = selectedBooking ? "booking" : activeRequest ? "request" : "none";

  // Whether the selected candidate is actually linked to a real driver
  // schoolTrip — a booking/request proven for this exact child but with no
  // trip link at all would be unable to ever move past "confirmed" (no
  // driver lifecycle to follow), which is itself a useful signal to see in
  // the logs without exposing the tripId value itself.
  const linkedTripFound = selectedBooking
    ? !!asString(selectedBooking.data.tripId)
    : activeRequest
      ? !!(asString(activeRequest.data.matchedTripId) || asString(activeRequest.data.matchedBookingId))
      : false;

  let result: SchoolKioskLookupResult;
  if (activeOrCompletedBooking) {
    result = await buildBookingResult(env, date, displayName, activeOrCompletedBooking.data);
  } else if (activeRequest) {
    result = buildRequestResult(date, displayName, activeRequest.data);
  } else if (cancelledBooking) {
    result = await buildBookingResult(env, date, displayName, cancelledBooking.data);
  } else {
    result = {
      ok: true,
      date,
      state: "no_return_today",
      child: { displayName },
      returnRide: null,
    };
  }

  // Nothing matched via the precise, safe (childId + date + direction)
  // query above — before giving up, run ONE extra bounded, diagnostic-ONLY
  // query scoped to (schoolId + date + bookingDirection): every return
  // booking for THIS school on THIS day, regardless of which child it
  // belongs to. This is never used to select or build a response (a
  // same-school-same-day booking for a DIFFERENT child is still never
  // exposed here — see requestBelongsToSchool's own comment on failing
  // closed) — it exists solely so a real booking that exists but is
  // missing/wrong on its childId field (exactly the class of bug that
  // caused a driver-visible "driver_on_way" booking to show
  // "no_return_today" here) is visible as a count in the logs, instead of
  // being silently indistinguishable from "truly nothing booked today".
  // Only ever runs on the "nothing found" path, so the common case (a
  // booking or request already found via the cheap per-child query above)
  // never pays this extra read.
  let schoolScopedCandidateCount = 0;
  let candidateHasChildId = false;
  let childIdMatchedDiagnostic = false;

  if (!selectedBooking && !activeRequest) {
    try {
      const schoolScopedCandidates = await queryFirestoreDocuments(env, SCHOOL_BOOKINGS_COLLECTION, {
        schoolId,
        date,
        bookingDirection: RETURN_DIRECTION,
      });
      schoolScopedCandidateCount = schoolScopedCandidates.length;
      candidateHasChildId = schoolScopedCandidates.some((c) => !!asString(c.data.childId));
      childIdMatchedDiagnostic = schoolScopedCandidates.some(
        (c) => asString(c.data.childId) === childId,
      );
    } catch (error) {
      console.error(
        "lookupSchoolKiosk: diagnostic school-scoped query failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
  }

  const foundViaPreciseMatch = !!(selectedBooking || activeRequest);

  // Development-safe diagnostics ONLY: counts, booleans, and enum labels.
  // Never schoolId values, childId, booking/request IDs, names, addresses,
  // coordinates, permanent codes, verification codes, or phone numbers.
  console.log("SCHOOL_KIOSK_LOOKUP_DIAGNOSTICS", {
    bookingCandidateCount: bookingCandidates.length,
    requestCandidateCount: requestCandidates.length,
    bookingsRejectedForSchoolMismatch,
    requestsRejectedForSchoolMismatch,
    candidateHasChildId: foundViaPreciseMatch ? true : candidateHasChildId,
    childIdMatched: foundViaPreciseMatch ? true : childIdMatchedDiagnostic,
    schoolIdMatched: foundViaPreciseMatch ? true : schoolScopedCandidateCount > 0,
    dateMatched: foundViaPreciseMatch ? true : schoolScopedCandidateCount > 0,
    directionMatched: foundViaPreciseMatch ? true : schoolScopedCandidateCount > 0,
    linkedTripFound,
    selectedSource,
    selectedState: result.ok ? result.state : null,
  });

  return result;
}
