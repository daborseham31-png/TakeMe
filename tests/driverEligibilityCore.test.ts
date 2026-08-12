// ---------------------------------------------------------------------------
// Regression tests for app/driver/driverEligibilityCore.ts — covers two
// related fixes:
//
//   1. evaluateDriverEligibility() must require driverVerificationStatus ===
//      "approved" (OCR/document verification succeeding is NOT admin
//      approval — see verify-license.tsx). Before this fix the function
//      never checked driverVerificationStatus at all, so a driver could
//      create/publish trips immediately after OCR verification, without any
//      admin ever approving them.
//
//   2. computeClearedCancellationSuspension() — the cancellation-policy
//      suspension (cancellationStanding.suspensionActive), a mechanism
//      completely INDEPENDENT from driverVerificationStatus (see
//      app/booking/driverViolationsLib.ts's getDriverSuspensionBlockedReason,
//      checked by every trip-creation screen in ADDITION to
//      evaluateDriverEligibility). This is the ONE decision Lift Suspension
//      (liftDriverCancellationSuspension) uses — an admin may lift a
//      suspension at ANY time, including before suspensionMinEndAt/
//      "Earliest Lift Date"; that date is informational only, never a block.
//      Approve/Reactivate (setDriverVerification) deliberately does NOT use
//      this function — see that function's own comment for why the two are
//      kept as separate, single-purpose admin actions.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import {
  computeClearedCancellationSuspension,
  evaluateDriverEligibility,
} from "../app/driver/driverEligibilityCore";

const FAR_FUTURE_EXPIRY = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 5);
  return d.toISOString().slice(0, 10);
})();

const PAST_EXPIRY = "2000-01-01";

const baseEligibleDriver = () => ({
  isDriver: true,
  licenseIsValid: true,
  licenseExpiryDate: FAR_FUTURE_EXPIRY,
  spokenLanguages: ["English"],
  driverVerificationStatus: "approved",
});

describe("evaluateDriverEligibility", () => {
  it("is ineligible (not_registered) for null/undefined data", () => {
    expect(evaluateDriverEligibility(null)).toEqual({ eligible: false, status: "not_registered" });
    expect(evaluateDriverEligibility(undefined)).toEqual({ eligible: false, status: "not_registered" });
  });

  it("is ineligible (not_registered) when isDriver is not true", () => {
    expect(evaluateDriverEligibility({ isDriver: false })).toEqual({
      eligible: false,
      status: "not_registered",
    });
  });

  it("is ineligible (license_missing) when licenseExpiryDate is absent", () => {
    expect(evaluateDriverEligibility({ isDriver: true })).toEqual({
      eligible: false,
      status: "license_missing",
    });
  });

  it("is ineligible (license_expired) when the license date has passed", () => {
    const data = { ...baseEligibleDriver(), licenseExpiryDate: PAST_EXPIRY };
    expect(evaluateDriverEligibility(data)).toEqual({ eligible: false, status: "license_expired" });
  });

  it("is ineligible (license_expired) when licenseIsValid is not true, even with a future date", () => {
    const data = { ...baseEligibleDriver(), licenseIsValid: false };
    expect(evaluateDriverEligibility(data)).toEqual({ eligible: false, status: "license_expired" });
  });

  it("is ineligible (languages_missing) when spokenLanguages is empty or not an array", () => {
    expect(evaluateDriverEligibility({ ...baseEligibleDriver(), spokenLanguages: [] })).toEqual({
      eligible: false,
      status: "languages_missing",
    });
    expect(evaluateDriverEligibility({ ...baseEligibleDriver(), spokenLanguages: undefined })).toEqual({
      eligible: false,
      status: "languages_missing",
    });
  });

  it("is ineligible (pending_admin_approval) right after OCR verification, even with every other field valid", () => {
    // verify-license.tsx sets exactly this shape (driverVerificationStatus:
    // 'pending_admin_review') after OCR succeeds. Must NOT be eligible until
    // an admin approves.
    const data = { ...baseEligibleDriver(), driverVerificationStatus: "pending_admin_review" };
    expect(evaluateDriverEligibility(data)).toEqual({ eligible: false, status: "pending_admin_approval" });
  });

  it("is ineligible (pending_admin_approval) when driverVerificationStatus is missing entirely", () => {
    const data: Record<string, any> = { ...baseEligibleDriver() };
    delete data.driverVerificationStatus;
    expect(evaluateDriverEligibility(data)).toEqual({ eligible: false, status: "pending_admin_approval" });
  });

  it("is ineligible (rejected) when the admin rejected the application", () => {
    const data = { ...baseEligibleDriver(), driverVerificationStatus: "rejected" };
    expect(evaluateDriverEligibility(data)).toEqual({ eligible: false, status: "rejected" });
  });

  it("is ineligible (suspended) when the admin suspended the driver via driverVerificationStatus", () => {
    const data = { ...baseEligibleDriver(), driverVerificationStatus: "suspended" };
    expect(evaluateDriverEligibility(data)).toEqual({ eligible: false, status: "suspended" });
  });

  it("is eligible only once every check passes AND driverVerificationStatus is exactly 'approved'", () => {
    expect(evaluateDriverEligibility(baseEligibleDriver())).toEqual({ eligible: true, status: "eligible" });
  });

  it("does NOT look at cancellationStanding at all — that gate is checked independently by the app", () => {
    // Even an obviously-active cancellation suspension must not change this
    // function's answer — evaluateDriverEligibility only ever reports on
    // driverVerificationStatus/license/languages. Proven here so nobody
    // "fixes" a suspension bug by teaching this function about
    // cancellationStanding instead of using Lift Suspension.
    const data = {
      ...baseEligibleDriver(),
      cancellationStanding: { suspensionActive: true, suspensionTier: 1 },
    };
    expect(evaluateDriverEligibility(data)).toEqual({ eligible: true, status: "eligible" });
  });
});

describe("computeClearedCancellationSuspension", () => {
  it("returns null when there is no active suspension (nothing to clear)", () => {
    expect(computeClearedCancellationSuspension({ suspensionActive: false })).toBeNull();
  });

  it("returns null for null/undefined standing", () => {
    expect(computeClearedCancellationSuspension(null)).toBeNull();
    expect(computeClearedCancellationSuspension(undefined)).toBeNull();
  });

  it("clears suspensionActive and manualReviewRequired when a suspension is active", () => {
    const standing = {
      suspensionActive: true,
      manualReviewRequired: true,
      suspensionCount: 2,
      suspensionReason: "6 cancellations within 30 days",
      suspensionTier: 2,
    };

    const cleared = computeClearedCancellationSuspension(standing);

    expect(cleared).not.toBeNull();
    expect(cleared?.suspensionActive).toBe(false);
    expect(cleared?.manualReviewRequired).toBe(false);
  });

  it("preserves every other field (violation/suspension HISTORY is never deleted, only the active flag)", () => {
    const standing = {
      suspensionActive: true,
      manualReviewRequired: true,
      suspensionCount: 3,
      suspensionReason: "6 cancellations within 30 days",
      suspensionTier: 3,
      suspensionMinDurationDays: null,
      indefinite: true,
    };

    const cleared = computeClearedCancellationSuspension(standing);

    expect(cleared?.suspensionCount).toBe(3);
    expect(cleared?.suspensionReason).toBe("6 cancellations within 30 days");
    expect(cleared?.suspensionTier).toBe(3);
    expect(cleared?.indefinite).toBe(true);
  });

  it("clears the suspension regardless of suspensionMinEndAt — no time gating exists in this decision at all", () => {
    // The function doesn't even accept a "now" parameter — proving
    // structurally that it can never re-implement the old early-lift
    // restriction, on purpose. suspensionMinEndAt itself is preserved
    // untouched (informational history of what the automatic system
    // decided), never read or checked here.
    const farFutureMinEndAt = { toMillis: () => Date.now() + 1000 * 60 * 60 * 24 * 6 }; // 6 days from now
    const standing = {
      suspensionActive: true,
      manualReviewRequired: true,
      suspensionMinEndAt: farFutureMinEndAt,
      suspensionTier: 1,
    };

    const cleared = computeClearedCancellationSuspension(standing);

    expect(cleared?.suspensionActive).toBe(false);
    expect(cleared?.suspensionMinEndAt).toBe(farFutureMinEndAt);
  });
});

// ---------------------------------------------------------------------------
// End-to-end scenario, matching the exact reported bug and the exact
// requested regression case: a driver has an active 7-day suspension, well
// before its Earliest Lift Date, and an admin presses Lift Suspension. The
// suspension must clear immediately (no time gate), history must survive,
// and the driver must become eligible to create trips again.
// ---------------------------------------------------------------------------

describe("active 7-day suspension -> admin lifts it early -> driver becomes eligible", () => {
  it("clears suspensionActive, preserves history, and makes the driver eligible, even before suspensionMinEndAt", () => {
    const now = Date.now();
    const suspensionMinEndAt = { toMillis: () => now + 1000 * 60 * 60 * 24 * 6 }; // 6 days still remaining

    const beforeLift = {
      ...baseEligibleDriver(), // driverVerificationStatus is "approved" — untouched by this whole flow
      cancellationStanding: {
        suspensionActive: true,
        manualReviewRequired: true,
        suspensionTier: 1,
        suspensionMinDurationDays: 7,
        suspensionStartAt: { toMillis: () => now - 1000 * 60 * 60 * 24 }, // started 1 day ago
        suspensionMinEndAt,
        suspensionReason: "6 cancellations within 30 days",
        suspensionCount: 1,
        indefinite: false,
      },
    };

    // Sanity check on the fixture itself: this suspension is NOT yet past
    // its minimum duration — this is exactly the "before Earliest Lift
    // Date" case the admin must still be able to override.
    expect(beforeLift.cancellationStanding.suspensionMinEndAt.toMillis()).toBeGreaterThan(now);

    // What liftDriverCancellationSuspension actually does (see
    // driverViolationsLib.ts): compute the cleared standing, no time check.
    const clearedStanding = computeClearedCancellationSuspension(beforeLift.cancellationStanding);
    expect(clearedStanding).not.toBeNull();

    const afterLift = { ...beforeLift, cancellationStanding: clearedStanding };

    // suspensionActive becomes false.
    expect(afterLift.cancellationStanding?.suspensionActive).toBe(false);
    expect(afterLift.cancellationStanding?.manualReviewRequired).toBe(false);

    // History remains intact — nothing about WHAT happened is deleted.
    expect(afterLift.cancellationStanding?.suspensionTier).toBe(1);
    expect(afterLift.cancellationStanding?.suspensionCount).toBe(1);
    expect(afterLift.cancellationStanding?.suspensionReason).toBe("6 cancellations within 30 days");
    expect(afterLift.cancellationStanding?.suspensionMinEndAt).toBe(suspensionMinEndAt);

    // The driver becomes eligible to create trips again — driverVerification
    // Status was "approved" the whole time (Lift Suspension never touches
    // it), so this gate was never the blocker; it's included here to prove
    // the full, real-world post-lift state is fully eligible end to end.
    expect(evaluateDriverEligibility(afterLift)).toEqual({ eligible: true, status: "eligible" });
  });

  it("a driver suspended via driverVerificationStatus (a separate axis) still needs Reactivate, not Lift Suspension", () => {
    // Documents the clean separation the product owner asked for: Lift
    // Suspension only ever touches cancellationStanding. A driver whose
    // driverVerificationStatus is "suspended" stays ineligible even with no
    // active cancellation suspension at all — only Approve/Reactivate fixes
    // that axis.
    const data = {
      ...baseEligibleDriver(),
      driverVerificationStatus: "suspended",
      cancellationStanding: { suspensionActive: false },
    };
    expect(evaluateDriverEligibility(data)).toEqual({ eligible: false, status: "suspended" });

    const reactivated = { ...data, driverVerificationStatus: "approved" };
    expect(evaluateDriverEligibility(reactivated)).toEqual({ eligible: true, status: "eligible" });
  });

  it("lifting is a no-op when there is no active suspension to begin with", () => {
    const noSuspension = { suspensionActive: false, suspensionCount: 0 };
    expect(computeClearedCancellationSuspension(noSuspension)).toBeNull();
  });
});
