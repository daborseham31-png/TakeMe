// ---------------------------------------------------------------------------
// Dependency-free core of the DRIVER NO-SHOW VIOLATION system — completely
// separate from the driver CANCELLATION violation system (see
// driverViolationCore.ts / driverViolationsLib.ts). That system fires when a
// driver actively cancels a trip. THIS system fires when a driver does
// NOTHING at all: a trip with a real, confirmed booking passes its scheduled
// departure plus a grace period, and the driver never started, arrived,
// began, completed, or cancelled it.
//
// Mirrors the existing split used everywhere else in this codebase (e.g.
// cancellationEligibility.ts / driverViolationCore.ts): pure, synchronous,
// no Firestore/i18n/notify import, so this file is directly unit-testable
// (see tests/driverNoShowCore.test.ts) and directly reusable from the
// Cloudflare Worker's cron detector, which cannot import anything that
// touches `firebase/firestore` (the Workers runtime has no gRPC socket — see
// cloudflare-worker/src/firestoreRest.ts's own header). The Worker's
// src/noShowDetection.ts intentionally re-implements this exact logic in
// worker-local TypeScript rather than importing this file across the Expo/
// Worker boundary — the same tradeoff this codebase already accepts for the
// two admin trees (app/admin/** vs takeme-admin-desktop/src/admin/**) being
// manually kept in sync instead of shared.
// ---------------------------------------------------------------------------

// Every trip category this violation system watches. Work/Errand/Roadside
// are deliberately out of scope (see the product spec: "checks eligible
// School, Personal, and Weekly trips" only).
export type NoShowTripCategory = "personal" | "school" | "weekly";

export const NO_SHOW_GRACE_PERIOD_MINUTES = 15;

// How far back the reconciliation/backfill pass is allowed to look — "do not
// punish very old historical data blindly" (product spec, section 2).
export const NO_SHOW_RECONCILE_LOOKBACK_DAYS = 30;

export const DRIVER_NO_SHOW_TRIP_STATUS = "driver_no_show" as const;

// ---------------------------------------------------------------------------
// Date/time parsing — mirrors cancellationEligibility.ts's parseYMD/parseHM
// exactly (same validation rules: rejects anything that doesn't round-trip
// back to the same calendar date/time, never `new Date("YYYY-MM-DD")`'s
// UTC-midnight surprise). Kept as its own copy here (not imported) so this
// file stays fully dependency-free, per this file's own header above.
// ---------------------------------------------------------------------------

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

const parseHM = (time: string): { hour: number; minute: number } | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec((time || "").trim());
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return { hour, minute };
};

// Combines a stored "YYYY-MM-DD" + "HH:mm" pair into a real local Date, or
// null if either is malformed/missing — "invalid or incomplete old records
// that do not have a reliable scheduled time" (product spec, condition 8)
// must never be treated as eligible, and this is the one place that decides
// "reliable" vs not.
export const combineScheduledDateTime = (date: string | null | undefined, time: string | null | undefined): Date | null => {
  const ymd = parseYMD(date || "");
  if (!ymd) return null;

  const hm = parseHM(time || "") || { hour: 0, minute: 0 };
  const combined = new Date(ymd.year, ymd.month - 1, ymd.day, hm.hour, hm.minute, 0, 0);
  return Number.isNaN(combined.getTime()) ? null : combined;
};

export const graceDeadline = (scheduledAt: Date): Date =>
  new Date(scheduledAt.getTime() + NO_SHOW_GRACE_PERIOD_MINUTES * 60 * 1000);

// ---------------------------------------------------------------------------
// Eligibility — the 8 conditions from the product spec, as one pure
// predicate. The caller (driverNoShowLib.ts's client-side fallback, and the
// Worker's noShowDetection.ts) is responsible for gathering this input from
// Firestore; this function makes no I/O calls at all.
// ---------------------------------------------------------------------------

export type NoShowTripStatusInput =
  // The trip/route's own coarse status/tripStatus, already reduced by the
  // caller to one of these buckets — mirrors cancellationEligibility.ts's
  // CancellationStatusInput contract exactly (the caller maps its own
  // category-specific status vocabulary down to this one shared shape).
  | "booked" // driver has done nothing yet — the only bucket that can ever become eligible
  | "driver_on_way"
  | "arrived"
  | "in_progress"
  | "completed"
  | "cancelled";

export type NoShowEligibilityInput = {
  category: NoShowTripCategory;
  date: string;
  time: string;
  tripStatus: NoShowTripStatusInput;
  // Real, confirmed passenger bookings referencing this trip — NEVER derived
  // from remaining/available/total seats (condition 1). A trip with zero
  // confirmed bookings can never become a violation regardless of anything
  // else.
  confirmedPassengerCount: number;
  // True if a driverViolations doc already exists for this trip's
  // deterministic id (condition 8 / idempotency) — the caller looks this up
  // once (a single get-by-id, or a requireAbsent create) and passes the
  // result in, since this function itself performs no I/O.
  violationAlreadyExists: boolean;
  // Defaults to the real current time — always pass an explicit value from
  // test code so this stays deterministic (same convention as
  // cancellationEligibility.ts's getCancellationEligibility).
  now?: Date;
};

export type NoShowEligibilityReason =
  | "eligible"
  | "zero_passengers"
  | "already_cancelled"
  | "already_started_or_progressed"
  | "already_completed"
  | "grace_period_not_elapsed"
  | "invalid_scheduled_time"
  | "violation_already_exists";

export type NoShowEligibilityResult = {
  eligible: boolean;
  reason: NoShowEligibilityReason;
  scheduledAt: Date | null;
  gracePeriodEndedAt: Date | null;
};

export const evaluateNoShowEligibility = (
  input: NoShowEligibilityInput,
): NoShowEligibilityResult => {
  const now = input.now ?? new Date();

  // Condition 8 (idempotency) first — cheapest check, and makes every other
  // reason moot once a violation already exists for this trip.
  if (input.violationAlreadyExists) {
    return { eligible: false, reason: "violation_already_exists", scheduledAt: null, gracePeriodEndedAt: null };
  }

  // Condition 1 — zero-passenger trips never create a violation, regardless
  // of anything else (matches the driver-cancellation system's own hard
  // backstop in writeCancellationViolationIfNew).
  if (input.confirmedPassengerCount <= 0) {
    return { eligible: false, reason: "zero_passengers", scheduledAt: null, gracePeriodEndedAt: null };
  }

  // Conditions 6/7/4/5 — passenger-cancelled, driver-cancelled, driver
  // started/progressed, or already completed all short-circuit here. Only
  // "booked" (driver has touched nothing) can ever proceed.
  if (input.tripStatus === "cancelled") {
    return { eligible: false, reason: "already_cancelled", scheduledAt: null, gracePeriodEndedAt: null };
  }
  if (input.tripStatus === "completed") {
    return { eligible: false, reason: "already_completed", scheduledAt: null, gracePeriodEndedAt: null };
  }
  if (
    input.tripStatus === "driver_on_way" ||
    input.tripStatus === "arrived" ||
    input.tripStatus === "in_progress"
  ) {
    return { eligible: false, reason: "already_started_or_progressed", scheduledAt: null, gracePeriodEndedAt: null };
  }

  // Condition 8's other half — "invalid or incomplete old records that do
  // not have a reliable scheduled time" never become eligible either.
  const scheduledAt = combineScheduledDateTime(input.date, input.time);
  if (!scheduledAt) {
    return { eligible: false, reason: "invalid_scheduled_time", scheduledAt: null, gracePeriodEndedAt: null };
  }

  // Conditions 2/3 — scheduled departure AND the 15-minute grace period must
  // both have passed. remainingMs <= 0 at the grace deadline is the eligible
  // boundary (exactly 15:00 after departure is eligible, one second before
  // is not) — mirrors cancellationEligibility.ts's own ">=" boundary
  // convention (never silently off-by-one via rounding).
  const deadline = graceDeadline(scheduledAt);
  if (now.getTime() < deadline.getTime()) {
    return { eligible: false, reason: "grace_period_not_elapsed", scheduledAt, gracePeriodEndedAt: deadline };
  }

  return { eligible: true, reason: "eligible", scheduledAt, gracePeriodEndedAt: deadline };
};

// ---------------------------------------------------------------------------
// Deterministic idempotency key — ONE violation per trip (the underlying
// driverRoute/schoolTrip/weekly-route document, which one or more individual
// `bookings`/`schoolBookings` docs reference), never per individual passenger
// booking, so a 4-passenger trip yields exactly one violation with
// passengerCount: 4, not four duplicate violations. The Cloudflare Worker's
// cron (see noShowDetection.ts) is the ONLY writer that ever creates a
// driverViolations document — firestore.rules denies `create` to every
// Firebase-Auth-authenticated client, including the driver themselves (see
// that file's driverViolations match block) — so this id only needs to be
// stable against the Worker's own re-runs (a `requireAbsent` create keeps a
// second cron pass from ever duplicating a violation for the same trip).
// ---------------------------------------------------------------------------

export const driverViolationId = (tripId: string): string => tripId;

// ---------------------------------------------------------------------------
// Whether a trip-like row's tripStatus represents a driver no-show — the ONE
// shared check bookingsLib.ts's getDriverTripStatus/getPassengerTripStatus
// both use, so "is this row a no-show" can never drift between the driver
// and passenger classifiers. Kept here (not duplicated inline in
// bookingsLib.ts) so it stays unit-testable without importing anything
// Firestore/React-Native-dependent — see vitest.config.ts's header.
// ---------------------------------------------------------------------------

export const isDriverNoShowTripStatus = (tripStatus: unknown): boolean =>
  String(tripStatus ?? "") === DRIVER_NO_SHOW_TRIP_STATUS;

// ---------------------------------------------------------------------------
// Refund status — the one place that decides refundStatus per payment
// method. This project has NO real refund API integration anywhere (grepped
// the whole repo — confirmed zero matches for "refund" outside this new
// feature). So this function can only ever return "not_required" (cash — no
// advance payment was ever collected, per ride-payment.tsx) or
// "manual_refund_pending" (bit/card — both are simulated/"mock_paid" in this
// codebase today, so there is nothing real to call). It must NEVER return
// "refunded" — that value exists in the type only so a real refund
// integration has somewhere to report success if one is ever added; nothing
// in this codebase is allowed to set it automatically.
// ---------------------------------------------------------------------------

export type RefundStatus =
  | "not_required"
  | "refund_pending"
  | "manual_refund_pending"
  | "refunded"
  | "refund_failed";

export const decideInitialRefundStatus = (paymentMethod: string | null | undefined): RefundStatus => {
  if (paymentMethod === "cash") return "not_required";
  // "bit" | "card" | anything else — no real refund integration exists, so
  // this always needs a human to action it, never a fake automatic success.
  return "manual_refund_pending";
};

// ---------------------------------------------------------------------------
// Violation/appeal status + active-count transitions — pure functions so the
// "approve" / "reject" admin actions (driverNoShowLib.ts) and the active-
// violation-count badge logic have one, independently-testable definition of
// what each transition does. The REAL count itself (see the architecture
// decision in the approved plan) is a live Firestore query
// (`where(driverId==X, active==true).size`), never a stored/incremented
// counter — these helpers exist so the *decision* of what active/status
// becomes after an approve/reject is tested without needing a live listener.
// ---------------------------------------------------------------------------

export type ViolationStatus = "open" | "appeal_pending" | "appeal_approved" | "appeal_rejected";
export type AppealStatus = "pending" | "approved" | "rejected";

export type ApprovalTransition = {
  violationStatus: ViolationStatus;
  violationActive: false;
  appealStatus: AppealStatus;
};

// Approving an appeal ALWAYS sets active: false — this is what the live
// active-count query relies on to exclude it going forward. There is no
// "partial approve."
export const applyAppealApproval = (): ApprovalTransition => ({
  violationStatus: "appeal_approved",
  violationActive: false,
  appealStatus: "approved",
});

export type RejectionTransition = {
  violationStatus: ViolationStatus;
  violationActive: true;
  appealStatus: AppealStatus;
};

// Rejecting an appeal explicitly keeps active: true — the violation
// continues to count toward the driver's active total.
export const applyAppealRejection = (): RejectionTransition => ({
  violationStatus: "appeal_rejected",
  violationActive: true,
  appealStatus: "rejected",
});

// Whether a driver may submit an appeal for a violation right now — "only
// one appeal is allowed per violation unless the admin workflow explicitly
// reopens it" (product spec, section 5). A violation with NO appealId yet is
// the only appeal-able state; once an appeal exists (any status — pending,
// approved, or rejected), the driver cannot submit a second one through the
// normal flow.
export const canSubmitAppeal = (violation: { appealId: string | null; active: boolean }): boolean =>
  violation.active === true && !violation.appealId;

// Explanation-text validation — "must not be empty or only spaces" (product
// spec, section 5). Kept here (not inline in the modal component) so the
// exact rule is unit-testable and shared if a second entry point ever needs
// it (e.g. an admin-side "reopen appeal" flow).
export const isValidAppealExplanation = (explanation: string): boolean => explanation.trim().length > 0;

// ---------------------------------------------------------------------------
// Evidence validation — appeal evidence is a base64 data URI stored directly
// on the Firestore document (no Storage on this project's Spark plan), so
// this is the only real safety net against an oversized or unsupported
// upload ever reaching Firestore. compressImageToBase64
// (app/login/idVerificationLib.ts) always re-encodes to JPEG regardless of
// input, so the MIME allowlist below guards the picked SOURCE asset, not the
// (always-JPEG) output.
// ---------------------------------------------------------------------------

export const SUPPORTED_EVIDENCE_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export const isSupportedEvidenceMimeType = (mimeType: string | null | undefined): boolean =>
  !!mimeType && (SUPPORTED_EVIDENCE_MIME_TYPES as readonly string[]).includes(mimeType.toLowerCase());

// Firestore's hard per-document limit is 1 MiB (1,048,576 bytes), shared
// with every other field on the same appeal document (explanation, reason,
// etc.). Base64 encoding adds ~33% over the raw compressed JPEG, so this
// caps the ENCODED string well below that ceiling with generous headroom —
// deliberately a hard reject (translated error), never a silent truncation.
export const MAX_EVIDENCE_BASE64_CHARS = 700_000;

export const isEvidenceWithinSizeLimit = (base64Length: number): boolean =>
  base64Length <= MAX_EVIDENCE_BASE64_CHARS;

// ---------------------------------------------------------------------------
// Admin field allowlists — the single source of truth for which
// driverViolations/violationAppeals fields an admin may ever change, mirrored
// exactly by firestore.rules's isValidAdminNoShowViolationUpdate() /
// isValidAdminNoShowAppealUpdate() (see tests/driverNoShowCore.test.ts's
// rules cross-check, which parses firestore.rules and asserts the two stay
// in sync). Every other field is evidence of WHAT HAPPENED, written once by
// the trusted Worker (or, for appeals, by the driver), and must stay
// immutable to an admin forever.
// ---------------------------------------------------------------------------

export const ADMIN_MUTABLE_VIOLATION_FIELDS = [
  "status",
  "active",
  "appealId",
  "resolvedAt",
  "resolvedBy",
  "resolutionNote",
  "refundStatus",
  "refundedAt",
  "refundedBy",
  "refundReference",
  "updatedAt",
] as const;

export const IMMUTABLE_VIOLATION_EVIDENCE_FIELDS = [
  "driverId",
  "tripId",
  "bookingId",
  "schoolTripId",
  "violationType",
  "scheduledAt",
  "gracePeriodEndedAt",
  "passengerIds",
  "passengerCount",
  "category",
  "createdAt",
] as const;

export const ADMIN_MUTABLE_APPEAL_FIELDS = [
  "status",
  "reviewedAt",
  "reviewedBy",
  "adminDecisionNote",
  "updatedAt",
] as const;

export const IMMUTABLE_APPEAL_EVIDENCE_FIELDS = [
  "violationId",
  "driverId",
  "tripId",
  "reasonCategory",
  "explanation",
  "evidenceUrls",
  "submittedAt",
  "createdAt",
] as const;

// ---------------------------------------------------------------------------
// Manual refund confirmation — a SEPARATE admin action from approving/
// rejecting an appeal (applyAppealApproval/applyAppealRejection above never
// touch refundStatus — see their return types, which have no refund* keys at
// all). This is the only transition anywhere in the codebase that may ever
// set refundStatus to "refunded", and it only fires when an admin has
// confirmed a real manual refund actually happened outside this app (there
// is no live refund API integration here — see decideInitialRefundStatus).
// ---------------------------------------------------------------------------

export type ManualRefundConfirmation = {
  refundStatus: "refunded";
};

export const applyManualRefundConfirmation = (): ManualRefundConfirmation => ({
  refundStatus: "refunded",
});

// A manual refund can only ever be confirmed from the one state that means
// "a human still owes this passenger money and hasn't said otherwise yet" —
// never from "not_required" (cash, nothing was ever collected) and never a
// second time once already "refunded".
export const canConfirmManualRefund = (refundStatus: string): boolean =>
  refundStatus === "manual_refund_pending";
