// ---------------------------------------------------------------------------
// Shared, pure cancellation-eligibility helper — one canonical definition of
// "how close to departure can this still be cancelled," reused by every ride
// category (School, Personal, Work, Errands) for both Driver and Passenger.
//
// Deliberately its own dependency-free file (no Firestore, no i18n, no other
// app module) rather than living in bookingsLib.ts: bookingsLib.ts already
// imports `notify` from work-errand/workErrandLib.ts, so if workErrandLib.ts
// also needed to import this helper FROM bookingsLib.ts, that would be a
// circular import between the two. Living here instead lets bookingsLib.ts,
// schoolTripsLib.ts, and workErrandLib.ts all import it directly with no
// cycle.
//
// Every existing category-specific "getXCancelBlockedReason" wrapper
// (bookingsLib.ts's getTimeBasedCancelBlockedReason, schoolTripsLib.ts's
// getSchoolCancelBlockedReason, workErrandLib.ts's cancelBlockedReason) keeps
// its own status vocabulary and status-based gating exactly as before, and
// only delegates the DATE/TIME part of the decision to this helper — never a
// second, competing time-window implementation.
// ---------------------------------------------------------------------------

export type CancellationRole = "driver" | "passenger";

// Two standard windows, matching the passenger/driver wording split used
// everywhere a booking has both sides ("Cancel Booking" vs "Cancel Trip"):
//   - PASSENGER_CANCEL_LOCK_HOURS (2h) — the passenger cancelling their own
//     seat/booking/request.
//   - DRIVER_CANCEL_LOCK_HOURS (5h) — the driver cancelling a trip/job they
//     posted or accepted — a stricter window since it can affect a
//     passenger/customer already relying on it, not just the driver's own
//     plan.
export const PASSENGER_CANCEL_LOCK_HOURS = 2;
export const DRIVER_CANCEL_LOCK_HOURS = 5;

export type CancellationEligibilityReason =
  | "allowed"
  | "inside_lock_window"
  | "already_started"
  | "completed"
  | "cancelled"
  | "invalid_departure";

// The caller has already reduced its own category-specific status field(s)
// (RideBooking's booked/on_the_way/arrived/completed/cancelled, SchoolBooking's
// status + tripStatus, WorkErrand's FlowStatus, general BookingItem's status +
// tripStatus, ...) down to one of these four coarse buckets BEFORE calling
// this helper — see each getXCancelBlockedReason wrapper's own status check.
export type CancellationStatusInput = "booked" | "started" | "completed" | "cancelled";

export type CancellationEligibility = {
  canCancel: boolean;
  remainingMs: number;
  cutoffMs: number;
  reason: CancellationEligibilityReason;
};

// "YYYY-MM-DD" -> numeric parts. Never `new Date("YYYY-MM-DD")` (parsed as
// UTC midnight per the ECMAScript date-only grammar, which can silently land
// on a different local calendar day) and never `toISOString()` to recover
// the local day (same UTC round-trip problem in reverse). Returns null for
// anything that isn't exactly this shape, or that doesn't round-trip back to
// the same calendar date (catches "2026-13-40"-style out-of-range values
// that the Date constructor would otherwise silently roll over).
const parseYMD = (date: string): { year: number; month: number; day: number } | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const probe = new Date(year, month - 1, day);
  const isReal =
    probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day;

  return isReal ? { year, month, day } : null;
};

// "HH:mm" -> numeric parts. Missing/blank is treated as "00:00" by the
// caller of this helper (matches every existing category's own fallback) —
// this only rejects a genuinely malformed value.
const parseHM = (time: string): { hour: number; minute: number } | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec((time || "").trim());
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return { hour, minute };
};

export type GetCancellationEligibilityInput = {
  role: CancellationRole;
  date: string;
  time: string;
  status: CancellationStatusInput;
  // Defaults to the real current time — always pass an explicit value from
  // test code so the helper stays deterministic/testable.
  now?: Date;
};

// Pure, synchronous — no Firestore/i18n access. Exact boundary semantics per
// the product spec: remainingMs >= cutoffMs is ALLOWED (exactly 5:00:00
// remaining for a driver, exactly 2:00:00 for a passenger, are both still
// cancellable — never rounded to whole hours, never a strict `<`/`>` that
// would exclude the exact cutoff instant).
export const getCancellationEligibility = ({
  role,
  date,
  time,
  status,
  now = new Date(),
}: GetCancellationEligibilityInput): CancellationEligibility => {
  const cutoffMs =
    (role === "driver" ? DRIVER_CANCEL_LOCK_HOURS : PASSENGER_CANCEL_LOCK_HOURS) * 60 * 60 * 1000;

  if (status === "cancelled") {
    return { canCancel: false, remainingMs: 0, cutoffMs, reason: "cancelled" };
  }
  if (status === "completed") {
    return { canCancel: false, remainingMs: 0, cutoffMs, reason: "completed" };
  }
  if (status === "started") {
    return { canCancel: false, remainingMs: 0, cutoffMs, reason: "already_started" };
  }

  const ymd = parseYMD(date);
  if (!ymd) {
    // No valid departure date to compare against — disable cancellation
    // rather than silently allowing it (the safe default this contract
    // requires, unlike some pre-existing per-category checks this replaces).
    return { canCancel: false, remainingMs: 0, cutoffMs, reason: "invalid_departure" };
  }

  const hm = parseHM(time) || { hour: 0, minute: 0 };
  const departure = new Date(ymd.year, ymd.month - 1, ymd.day, hm.hour, hm.minute, 0, 0);

  if (Number.isNaN(departure.getTime())) {
    return { canCancel: false, remainingMs: 0, cutoffMs, reason: "invalid_departure" };
  }

  const remainingMs = departure.getTime() - now.getTime();
  const canCancel = remainingMs >= cutoffMs;

  return { canCancel, remainingMs, cutoffMs, reason: canCancel ? "allowed" : "inside_lock_window" };
};

// ---------------------------------------------------------------------------
// Controlled, stable error codes for the DATA-LAYER re-validation every
// cancellation function performs against a freshly-read document (never the
// caller's possibly-stale in-memory card). Deliberately a closed, internal
// vocabulary — never a raw Firestore/SDK error, never an ad hoc string — so
// the UI boundary (bookingsLib.ts's translateCancellationError) can map each
// one to a translated message without ever inspecting error.message.
//
// The six codes below are the ones the product spec names explicitly.
// TRIP_ALREADY_COMPLETED and INVALID_DEPARTURE are added for the two
// remaining CancellationEligibilityReason values ("completed" and
// "invalid_departure") that aren't covered by any of the six — kept as
// clearly separate, equally-stable codes rather than overloading an existing
// one with a different meaning.
// ---------------------------------------------------------------------------

export type CancellationErrorCode =
  | "DRIVER_CANCELLATION_WINDOW_CLOSED"
  | "PASSENGER_CANCELLATION_WINDOW_CLOSED"
  | "TRIP_ALREADY_STARTED"
  | "TRIP_ALREADY_COMPLETED"
  | "ALREADY_CANCELLED"
  | "NOT_AUTHORIZED"
  | "DOCUMENT_NOT_FOUND"
  | "INVALID_DEPARTURE";

export class CancellationError extends Error {
  code: CancellationErrorCode;

  constructor(code: CancellationErrorCode) {
    super(code);
    this.name = "CancellationError";
    this.code = code;
  }
}

// Maps a getCancellationEligibility() result's `reason` (plus which role was
// attempting the cancellation) to the matching stable error code — the one
// place this mapping exists, reused by every category's re-validation.
export const eligibilityReasonToErrorCode = (
  reason: CancellationEligibilityReason,
  role: CancellationRole,
): CancellationErrorCode => {
  switch (reason) {
    case "cancelled":
      return "ALREADY_CANCELLED";
    case "completed":
      return "TRIP_ALREADY_COMPLETED";
    case "already_started":
      return "TRIP_ALREADY_STARTED";
    case "invalid_departure":
      return "INVALID_DEPARTURE";
    case "inside_lock_window":
    case "allowed":
    default:
      // "allowed" never reaches here in practice (callers only map a
      // blocked reason to an error), kept as a safe fallback rather than an
      // unreachable-code throw.
      return role === "driver" ? "DRIVER_CANCELLATION_WINDOW_CLOSED" : "PASSENGER_CANCELLATION_WINDOW_CLOSED";
  }
};
