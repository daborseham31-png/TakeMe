// ---------------------------------------------------------------------------
// Unit tests for the pure driver no-show violation logic in
// app/booking/driverNoShowCore.ts — no React rendering, no network/Firestore
// calls (see that file's own header, and routeMatchLib.test.ts's header for
// why tests live in this sibling directory rather than under app/). Run with:
//   npm test
//
// Coverage map against the product spec's 23 requested test cases — cases
// that require a live Firestore/Cloudflare Worker cron run are NOT faked
// here; they are called out explicitly as manual-QA steps in the delivery
// report instead of claimed as automated coverage:
//   1, 3, 4, 5, 6, 7  -> evaluateNoShowEligibility (below)
//   2                 -> driverViolationId determinism (below)
//   8                 -> covered by bookingsLib.ts's getDriverTripBucket/
//                        getPassengerTripBucket branch, not here (pure-logic
//                        test would just restate the one-line branch)
//   9, 10, 11         -> canSubmitAppeal / isValidAppealExplanation (below)
//   12-16             -> applyAppealApproval / applyAppealRejection (below)
//   17                -> enforced by firestore.rules, not app logic — no unit
//                        test possible without a rules emulator (none exists
//                        in this repo)
//   18                -> app/notifications.tsx's onPressNotification switch;
//                        a manual-QA / integration concern, not pure logic
//   19, 20            -> decideInitialRefundStatus (below)
//   21, 22            -> evaluateNoShowEligibility parameterized by category
//                        (the function itself is category-agnostic by
//                        design, so this exercises it with each category)
//   23                -> manual-QA (requires a live Firestore dataset)
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ADMIN_MUTABLE_APPEAL_FIELDS,
  ADMIN_MUTABLE_VIOLATION_FIELDS,
  applyAppealApproval,
  applyAppealRejection,
  applyManualRefundConfirmation,
  canConfirmManualRefund,
  canSubmitAppeal,
  combineScheduledDateTime,
  decideInitialRefundStatus,
  driverViolationId,
  evaluateNoShowEligibility,
  graceDeadline,
  isDriverNoShowTripStatus,
  isEvidenceWithinSizeLimit,
  isSupportedEvidenceMimeType,
  isValidAppealExplanation,
  MAX_EVIDENCE_BASE64_CHARS,
  NO_SHOW_GRACE_PERIOD_MINUTES,
  NoShowEligibilityInput,
} from "../app/booking/driverNoShowCore";

const baseInput: NoShowEligibilityInput = {
  category: "personal",
  date: "2026-08-03",
  time: "23:20",
  tripStatus: "booked",
  confirmedPassengerCount: 1,
  violationAlreadyExists: false,
};

// Exactly the product spec's own worked example: trip time 23:20, grace ends
// 23:35.
const AT_SCHEDULED_TIME = new Date(2026, 7, 3, 23, 20, 0, 0);
const AT_GRACE_DEADLINE = new Date(2026, 7, 3, 23, 35, 0, 0);
const ONE_SECOND_BEFORE_DEADLINE = new Date(2026, 7, 3, 23, 34, 59, 0);
const ONE_MINUTE_AFTER_DEADLINE = new Date(2026, 7, 3, 23, 36, 0, 0);

describe("driverNoShowCore: grace period math", () => {
  it("matches the product spec's own worked example (23:20 -> grace ends 23:35)", () => {
    const scheduledAt = combineScheduledDateTime("2026-08-03", "23:20")!;
    expect(graceDeadline(scheduledAt).getHours()).toBe(23);
    expect(graceDeadline(scheduledAt).getMinutes()).toBe(35);
    expect(NO_SHOW_GRACE_PERIOD_MINUTES).toBe(15);
  });

  it("returns null for a malformed date", () => {
    expect(combineScheduledDateTime("not-a-date", "23:20")).toBeNull();
  });

  it("returns null for a missing date", () => {
    expect(combineScheduledDateTime(null, "23:20")).toBeNull();
  });

  it("falls back to 00:00 for a missing time, matching the rest of the codebase's convention", () => {
    const combined = combineScheduledDateTime("2026-08-03", "");
    expect(combined?.getHours()).toBe(0);
    expect(combined?.getMinutes()).toBe(0);
  });
});

describe("driverNoShowCore: evaluateNoShowEligibility", () => {
  // Case 1 + spec's worked example: booked trip with passengers, past
  // scheduled time + 15 minutes -> eligible.
  it("case 1: is eligible exactly at the grace deadline", () => {
    const result = evaluateNoShowEligibility({ ...baseInput, now: AT_GRACE_DEADLINE });
    expect(result.eligible).toBe(true);
    expect(result.reason).toBe("eligible");
  });

  // Case 7: still inside the 15-minute grace period -> not eligible.
  it("case 7: is NOT eligible one second before the grace deadline", () => {
    const result = evaluateNoShowEligibility({ ...baseInput, now: ONE_SECOND_BEFORE_DEADLINE });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("grace_period_not_elapsed");
  });

  it("is NOT eligible exactly at the scheduled departure time (no grace yet)", () => {
    const result = evaluateNoShowEligibility({ ...baseInput, now: AT_SCHEDULED_TIME });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("grace_period_not_elapsed");
  });

  it("is eligible well after the grace deadline", () => {
    const result = evaluateNoShowEligibility({ ...baseInput, now: ONE_MINUTE_AFTER_DEADLINE });
    expect(result.eligible).toBe(true);
  });

  // Case 3: zero-passenger trip.
  it("case 3: a zero-passenger trip is never eligible, even past the grace deadline", () => {
    const result = evaluateNoShowEligibility({
      ...baseInput,
      confirmedPassengerCount: 0,
      now: ONE_MINUTE_AFTER_DEADLINE,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("zero_passengers");
  });

  // Case 4: cancelled trip (covers both passenger- and driver-cancelled —
  // this function only sees the final coarse "cancelled" status, matching
  // cancellationEligibility.ts's own contract of "caller reduces its own
  // status vocabulary down to a shared bucket before calling").
  it("case 4: a cancelled trip is never eligible", () => {
    const result = evaluateNoShowEligibility({
      ...baseInput,
      tripStatus: "cancelled",
      now: ONE_MINUTE_AFTER_DEADLINE,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("already_cancelled");
  });

  // Case 5: trip already started (driver on the way / arrived / in
  // progress) is never eligible.
  it("case 5: a trip the driver already started is never eligible", () => {
    for (const tripStatus of ["driver_on_way", "arrived", "in_progress"] as const) {
      const result = evaluateNoShowEligibility({ ...baseInput, tripStatus, now: ONE_MINUTE_AFTER_DEADLINE });
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe("already_started_or_progressed");
    }
  });

  // Case 6: completed trip.
  it("case 6: a completed trip is never eligible", () => {
    const result = evaluateNoShowEligibility({
      ...baseInput,
      tripStatus: "completed",
      now: ONE_MINUTE_AFTER_DEADLINE,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("already_completed");
  });

  // Case 8 (the "invalid/incomplete old record" half): no reliable scheduled
  // time -> never eligible, regardless of anything else.
  it("an invalid/missing scheduled date is never eligible, regardless of now", () => {
    const result = evaluateNoShowEligibility({ ...baseInput, date: "", now: ONE_MINUTE_AFTER_DEADLINE });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("invalid_scheduled_time");
  });

  // Case 8 (idempotency half): a violation already recorded for this trip is
  // never eligible again.
  it("case 8: a trip with an existing violation is never eligible again", () => {
    const result = evaluateNoShowEligibility({
      ...baseInput,
      violationAlreadyExists: true,
      now: ONE_MINUTE_AFTER_DEADLINE,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("violation_already_exists");
  });

  // Cases 21/22: School, Personal, and Weekly all use the exact same
  // category-agnostic eligibility rule — there is no special-cased category
  // branch to accidentally miss.
  it("cases 21/22: School, Personal, and Weekly trips are all supported identically", () => {
    for (const category of ["personal", "school", "weekly"] as const) {
      const result = evaluateNoShowEligibility({ ...baseInput, category, now: ONE_MINUTE_AFTER_DEADLINE });
      expect(result.eligible).toBe(true);
    }
  });
});

describe("driverNoShowCore: idempotency key", () => {
  // Case 2: running the detector twice must never create duplicate
  // violations — this asserts the two write paths (Worker cron + client
  // fallback) would derive the identical key for the same trip, which is
  // what actually prevents the duplicate (a `requireAbsent` create / a
  // transaction existence check on this exact id).
  it("case 2: the same tripId always derives the same violation id", () => {
    expect(driverViolationId("route_abc123")).toBe(driverViolationId("route_abc123"));
    expect(driverViolationId("route_abc123")).not.toBe(driverViolationId("route_xyz789"));
  });
});

describe("driverNoShowCore: refund status per payment method", () => {
  // Case 19: cash never shows a refund.
  it("case 19: cash payment resolves to not_required, never a refund state", () => {
    expect(decideInitialRefundStatus("cash")).toBe("not_required");
  });

  // Case 20: no real refund integration exists in this codebase for any
  // electronic method, so both bit and card resolve to the manual/pending
  // state — never a fake "refunded".
  it("case 20: bit and card both resolve to manual_refund_pending (no real refund integration exists)", () => {
    expect(decideInitialRefundStatus("bit")).toBe("manual_refund_pending");
    expect(decideInitialRefundStatus("card")).toBe("manual_refund_pending");
  });

  it("an unknown/missing payment method also defaults to manual_refund_pending, never not_required", () => {
    expect(decideInitialRefundStatus(null)).toBe("manual_refund_pending");
    expect(decideInitialRefundStatus(undefined)).toBe("manual_refund_pending");
    expect(decideInitialRefundStatus("something_else")).toBe("manual_refund_pending");
  });
});

describe("driverNoShowCore: appeal count/status transitions", () => {
  // Cases 12/14: approval sets active=false.
  it("case 12/14: approving an appeal sets active=false and status=appeal_approved", () => {
    const result = applyAppealApproval();
    expect(result.violationActive).toBe(false);
    expect(result.violationStatus).toBe("appeal_approved");
    expect(result.appealStatus).toBe("approved");
  });

  // Case 15: rejection keeps active=true (so the live count query still
  // counts it).
  it("case 15: rejecting an appeal keeps active=true and status=appeal_rejected", () => {
    const result = applyAppealRejection();
    expect(result.violationActive).toBe(true);
    expect(result.violationStatus).toBe("appeal_rejected");
    expect(result.appealStatus).toBe("rejected");
  });

  // Case 13/16: this project's active count is a live query
  // (where driverId==X, active==true).size, not a stored counter — so
  // "decreases exactly once" / "repeated approval does not double-decrement"
  // hold automatically once active is false: a second approval call is a
  // no-op against a query that already excludes this doc, and there is no
  // stored number to decrement twice. Asserted here structurally: applying
  // approval twice in a row yields the exact same idempotent result both
  // times.
  it("case 13/16: applying approval twice yields the identical idempotent transition both times", () => {
    expect(applyAppealApproval()).toEqual(applyAppealApproval());
  });
});

describe("driverNoShowCore: appeal submission gating", () => {
  // Case 9: driver can submit one valid appeal for their own open,
  // no-appeal-yet violation.
  it("case 9: an active violation with no appeal yet can be appealed", () => {
    expect(canSubmitAppeal({ appealId: null, active: true })).toBe(true);
  });

  // Case 11: cannot submit a second appeal once one already exists,
  // regardless of that appeal's own status.
  it("case 11: a violation that already has an appeal cannot be appealed again", () => {
    expect(canSubmitAppeal({ appealId: "appeal_1", active: true })).toBe(false);
  });

  it("an inactive (already-resolved) violation cannot be appealed", () => {
    expect(canSubmitAppeal({ appealId: null, active: false })).toBe(false);
  });

  it("explanation validation rejects empty and whitespace-only text", () => {
    expect(isValidAppealExplanation("")).toBe(false);
    expect(isValidAppealExplanation("   ")).toBe(false);
    expect(isValidAppealExplanation("The car broke down on the highway.")).toBe(true);
  });
});

describe("driverNoShowCore: isDriverNoShowTripStatus", () => {
  it("recognizes the exact no-show trip status", () => {
    expect(isDriverNoShowTripStatus("driver_no_show")).toBe(true);
  });

  it("rejects every other trip status, including missing/undefined", () => {
    expect(isDriverNoShowTripStatus("booked")).toBe(false);
    expect(isDriverNoShowTripStatus("completed")).toBe(false);
    expect(isDriverNoShowTripStatus("cancelled")).toBe(false);
    expect(isDriverNoShowTripStatus(undefined)).toBe(false);
    expect(isDriverNoShowTripStatus(null)).toBe(false);
    expect(isDriverNoShowTripStatus("")).toBe(false);
  });
});

describe("driverNoShowCore: evidence validation", () => {
  it("accepts every supported image MIME type, case-insensitively", () => {
    expect(isSupportedEvidenceMimeType("image/jpeg")).toBe(true);
    expect(isSupportedEvidenceMimeType("image/PNG")).toBe(true);
    expect(isSupportedEvidenceMimeType("image/webp")).toBe(true);
    expect(isSupportedEvidenceMimeType("image/heic")).toBe(true);
  });

  it("rejects unsupported or missing MIME types", () => {
    expect(isSupportedEvidenceMimeType("application/pdf")).toBe(false);
    expect(isSupportedEvidenceMimeType("text/plain")).toBe(false);
    expect(isSupportedEvidenceMimeType(null)).toBe(false);
    expect(isSupportedEvidenceMimeType(undefined)).toBe(false);
    expect(isSupportedEvidenceMimeType("")).toBe(false);
  });

  it("accepts evidence at or under the max encoded size, rejects over it", () => {
    expect(isEvidenceWithinSizeLimit(0)).toBe(true);
    expect(isEvidenceWithinSizeLimit(MAX_EVIDENCE_BASE64_CHARS)).toBe(true);
    expect(isEvidenceWithinSizeLimit(MAX_EVIDENCE_BASE64_CHARS + 1)).toBe(false);
    expect(isEvidenceWithinSizeLimit(2_000_000)).toBe(false);
  });

  it("caps the max encoded size safely below Firestore's 1 MiB document limit", () => {
    expect(MAX_EVIDENCE_BASE64_CHARS).toBeLessThan(1_048_576);
  });
});

describe("driverNoShowCore: manual refund confirmation is the ONLY path to refundStatus 'refunded'", () => {
  it("applyManualRefundConfirmation sets refundStatus to 'refunded' and nothing else", () => {
    const result = applyManualRefundConfirmation();
    expect(result).toEqual({ refundStatus: "refunded" });
    expect(Object.keys(result)).toEqual(["refundStatus"]);
  });

  it("canConfirmManualRefund only allows the transition from manual_refund_pending", () => {
    expect(canConfirmManualRefund("manual_refund_pending")).toBe(true);
    expect(canConfirmManualRefund("not_required")).toBe(false);
    expect(canConfirmManualRefund("refunded")).toBe(false);
    expect(canConfirmManualRefund("refund_failed")).toBe(false);
    expect(canConfirmManualRefund("refund_pending")).toBe(false);
  });

  // The actual assertion behind "approving/rejecting an appeal must not mark
  // the refund refunded": neither transition object has a refundStatus key
  // at all, so driverNoShowLib.ts's approveAppeal/rejectAppeal (which only
  // ever spread these exact fields into their updateDoc calls) structurally
  // cannot touch refundStatus.
  it("approving an appeal never includes a refundStatus field", () => {
    const result = applyAppealApproval();
    expect(result).not.toHaveProperty("refundStatus");
    expect(result).not.toHaveProperty("refundedAt");
    expect(result).not.toHaveProperty("refundedBy");
  });

  it("rejecting an appeal never includes a refundStatus field", () => {
    const result = applyAppealRejection();
    expect(result).not.toHaveProperty("refundStatus");
    expect(result).not.toHaveProperty("refundedAt");
    expect(result).not.toHaveProperty("refundedBy");
  });

  it("decideInitialRefundStatus never returns 'refunded' for any payment method", () => {
    expect(decideInitialRefundStatus("cash")).not.toBe("refunded");
    expect(decideInitialRefundStatus("card")).not.toBe("refunded");
    expect(decideInitialRefundStatus("bit")).not.toBe("refunded");
    expect(decideInitialRefundStatus(null)).not.toBe("refunded");
    expect(decideInitialRefundStatus(undefined)).not.toBe("refunded");
  });
});

// ---------------------------------------------------------------------------
// Source-text regression checks — this project has no Firestore emulator and
// no RN-aware test harness (see vitest.config.ts's header), so "a driver
// client cannot create a driverViolations document" and "an admin cannot
// modify immutable violation/appeal fields" can't be exercised against a
// real rules engine here. These tests instead assert against the ACTUAL
// firestore.rules source text, so a future edit that reopens `create` or
// widens the admin update allowlist fails the test suite immediately rather
// than only being caught by manual QA.
// ---------------------------------------------------------------------------

const firestoreRulesSource = readFileSync(join(__dirname, "../firestore.rules"), "utf8");

describe("firestore.rules: driverViolations create is denied to every client", () => {
  it("the driverViolations match block denies create outright", () => {
    const blockMatch = firestoreRulesSource.match(
      /match \/driverViolations\/\{violationId\} \{[\s\S]*?\n {4}\}/,
    );
    expect(blockMatch).not.toBeNull();
    expect(blockMatch![0]).toMatch(/allow create: if false;/);
  });

  it("no self-write create rule for driverViolations remains anywhere in the file", () => {
    // The removed client-side fallback's validator function must not exist —
    // if it does, someone re-added a create path this system no longer
    // supports.
    expect(firestoreRulesSource).not.toMatch(/isValidSelfNoShowViolationCreate/);
  });
});

describe("firestore.rules: admin update allowlists match driverNoShowCore.ts exactly", () => {
  it("driverViolations admin update allowlist matches ADMIN_MUTABLE_VIOLATION_FIELDS, with no immutable evidence field", () => {
    const fnMatch = firestoreRulesSource.match(
      /function isValidAdminNoShowViolationUpdate\(\) \{[\s\S]*?\n {4}\}/,
    );
    expect(fnMatch).not.toBeNull();
    const fnSource = fnMatch![0];

    for (const field of ADMIN_MUTABLE_VIOLATION_FIELDS) {
      expect(fnSource).toContain(`"${field}"`);
    }

    // Every field NOT in the mutable allowlist (the driver/tripId/schoolTripId/
    // scheduledAt/etc. evidence fields) must be absent from this function's
    // hasOnly([...]) list entirely.
    const immutableEvidenceFields = ["driverId", "tripId", "bookingId", "schoolTripId", "violationType", "scheduledAt", "gracePeriodEndedAt", "passengerIds", "passengerCount", "category", "createdAt"];
    for (const field of immutableEvidenceFields) {
      expect(fnSource).not.toContain(`"${field}"`);
    }
  });

  it("violationAppeals admin update allowlist matches ADMIN_MUTABLE_APPEAL_FIELDS, with no immutable evidence field", () => {
    const fnMatch = firestoreRulesSource.match(
      /function isValidAdminNoShowAppealUpdate\(\) \{[\s\S]*?\n {4}\}/,
    );
    expect(fnMatch).not.toBeNull();
    const fnSource = fnMatch![0];

    for (const field of ADMIN_MUTABLE_APPEAL_FIELDS) {
      expect(fnSource).toContain(`"${field}"`);
    }

    const immutableEvidenceFields = ["violationId", "driverId", "tripId", "reasonCategory", "explanation", "evidenceUrls", "submittedAt", "createdAt"];
    for (const field of immutableEvidenceFields) {
      expect(fnSource).not.toContain(`"${field}"`);
    }
  });

  it("driverViolations update rule actually calls the restricted admin validator, not a bare isAdmin() pass", () => {
    const blockMatch = firestoreRulesSource.match(
      /match \/driverViolations\/\{violationId\} \{[\s\S]*?\n {4}\}/,
    );
    const blockSource = blockMatch![0];
    expect(blockSource).toMatch(/allow update: if \(isAdmin\(\) && isValidAdminNoShowViolationUpdate\(\)\)/);
    // Must not regress to the old blanket "isAdmin() ||" shape.
    expect(blockSource).not.toMatch(/allow update: if isAdmin\(\) \|\|/);
  });

  it("violationAppeals update rule actually calls the restricted admin validator, not a bare isAdmin() pass", () => {
    const blockMatch = firestoreRulesSource.match(
      /match \/violationAppeals\/\{appealId\} \{[\s\S]*?\n {4}\}/,
    );
    const blockSource = blockMatch![0];
    expect(blockSource).toMatch(/allow update: if isAdmin\(\) && isValidAdminNoShowAppealUpdate\(\);/);
  });
});

// ---------------------------------------------------------------------------
// Source-text regression check on bookingsLib.ts's bucket classifiers — same
// rationale as the firestore.rules checks above (no RN-safe way to import
// bookingsLib.ts directly here; see vitest.config.ts's header). Asserts the
// driver-side no-show status never maps to "completed" and is excluded
// (null) from getDriverTripBucket's switch, rather than silently falling
// through to the shared "completed" default case.
// ---------------------------------------------------------------------------

describe("bookingsLib.ts: driver no-show never appears in Completed", () => {
  const bookingsLibSource = readFileSync(join(__dirname, "../app/booking/bookingsLib.ts"), "utf8");

  it("getDriverTripStatus maps a no-show row to its own status, never directly to 'completed'", () => {
    const fnMatch = bookingsLibSource.match(
      /export const getDriverTripStatus = \(row: any\): DriverTripStatus => \{[\s\S]*?\n\};/,
    );
    expect(fnMatch).not.toBeNull();
    const fnSource = fnMatch![0];

    expect(fnSource).toMatch(/if \(isDriverNoShowTripStatus\(row\.tripStatus\)\) return "noShowViolation";/);
    // The old (fixed) bug: must never short-circuit no-show rows to "completed".
    expect(fnSource).not.toMatch(/isDriverNoShowTripStatus\([^)]*\)\)\s*return "completed"/);
  });

  it("getDriverTripBucket excludes noShowViolation from every generic bucket (returns null, not 'completed')", () => {
    const fnMatch = bookingsLibSource.match(
      /export const getDriverTripBucket = \(row: any\): BookingBucket \| null => \{[\s\S]*?\n\};/,
    );
    expect(fnMatch).not.toBeNull();
    const fnSource = fnMatch![0];

    expect(fnSource).toMatch(/case "noShowViolation":\s*\n\s*return null;/);
  });
});
