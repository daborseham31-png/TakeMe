// ---------------------------------------------------------------------------
// Pure "is this user allowed to act as a driver right now" decision logic —
// dependency-free (no react-native/firebase/expo imports), split out of
// driverEligibility.ts for the same reason weeklyBookingCore.ts/
// pickupLocationCore.ts/notificationRoutingCore.ts are their own files (see
// those files' own headers): driverEligibility.ts itself imports
// firebase/firestore at module scope, which fails to even PARSE under this
// project's plain-Node vitest config. driverEligibility.ts re-exports
// everything here so no existing call site's import path changes.
// ---------------------------------------------------------------------------

// Duplicated from app/login/idVerificationLib.ts (isValidYMD/getLicenseValidity)
// rather than imported — that file pulls in expo-image-manipulator/
// expo-image-picker/react-native at module scope, same taint problem as
// above. Both are tiny, pure, and unlikely to change independently of this
// one; if idVerificationLib.ts's own logic ever changes, update both.
type LicenseValidity = "valid" | "expired" | "unknown";

const isValidYMD = (value: string | null | undefined): boolean => {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
};

const getLicenseValidity = (expiryDate: string | null): LicenseValidity => {
  if (!isValidYMD(expiryDate)) return "unknown";

  const [yearStr, monthStr, dayStr] = (expiryDate as string).split("-");
  const expiry = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));

  if (Number.isNaN(expiry.getTime())) return "unknown";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  expiry.setHours(0, 0, 0, 0);

  return expiry.getTime() > today.getTime() ? "valid" : "expired";
};

export type DriverEligibilityStatus =
  | "eligible"
  | "not_registered"
  | "license_missing"
  | "license_expired"
  | "languages_missing"
  | "pending_admin_approval"
  | "rejected"
  | "suspended";

export type DriverEligibilityResult = {
  eligible: boolean;
  status: DriverEligibilityStatus;
};

// Pure — operates on an already-fetched users/{uid} doc body.
//
// OCR/document verification succeeding (see verify-license.tsx, which sets
// isDriver/licenseIsValid/licenseExpiryDate/spokenLanguages and leaves
// driverVerificationStatus at "pending_admin_review") is NOT the same thing
// as admin approval — it only proves the document itself was readable and
// valid. A driver must not be able to create/publish ANY trip until an
// admin has actually set driverVerificationStatus to exactly "approved"
// (see adminDriversLib.ts's setDriverVerification, the only writer of that
// value other than this file's own default). This is the single, shared
// gate every driver-trip-creation entry point (app/(tabs)/home.tsx's
// "Become a Driver", app/driver/add-route.tsx, and each app/driver/
// create/*.tsx form's own pre-submit re-check) relies on — see
// driverEligibility.ts's own header for the full list.
//
// Note: this function deliberately does NOT look at cancellationStanding
// (the SEPARATE 6-cancellations-in-30-days suspension system — see
// app/booking/driverViolationsLib.ts's getDriverSuspensionBlockedReason,
// checked independently by every one of the same call sites, and this
// file's own computeClearedCancellationSuspension below). Folding the two
// together here would make "eligible" a lie the moment either system
// disagreed; keeping them as two independently-checked gates, each with its
// own single clearing path, is deliberate — see computeClearedCancellationSuspension's
// own header comment for why.
export const evaluateDriverEligibility = (
  data: Record<string, any> | null | undefined,
): DriverEligibilityResult => {
  if (!data || data.isDriver !== true) {
    return { eligible: false, status: "not_registered" };
  }

  if (!data.licenseExpiryDate) {
    return { eligible: false, status: "license_missing" };
  }

  const validity = getLicenseValidity(data.licenseExpiryDate);

  if (validity !== "valid" || data.licenseIsValid !== true) {
    return { eligible: false, status: "license_expired" };
  }

  if (!Array.isArray(data.spokenLanguages) || data.spokenLanguages.length === 0) {
    return { eligible: false, status: "languages_missing" };
  }

  if (data.driverVerificationStatus === "rejected") {
    return { eligible: false, status: "rejected" };
  }

  if (data.driverVerificationStatus === "suspended") {
    return { eligible: false, status: "suspended" };
  }

  if (data.driverVerificationStatus !== "approved") {
    // Covers "pending_admin_review", "not_registered", "", missing, or any
    // other not-yet-approved value — every one of these means "an admin
    // still needs to look at this," never "let them through."
    return { eligible: false, status: "pending_admin_approval" };
  }

  return { eligible: true, status: "eligible" };
};

// Every call site that blocks a driver action on an ineligible status shows
// the SAME copy for the SAME reason — a single source of truth so "pending"
// vs "rejected" vs "suspended" never say something different depending on
// which screen happened to catch it. Callers still decide their own
// navigation (e.g. add-route.tsx goes back, the create/*.tsx forms just stay
// put) — this only owns the alert text. `t` is typed structurally (not
// i18next's own TFunction) so this file never needs an i18next import either.
export const getDriverEligibilityAlertCopy = (
  status: DriverEligibilityStatus,
  t: (key: string) => string,
): { title: string; message: string } => {
  switch (status) {
    case "pending_admin_approval":
      return {
        title: t("driver.pendingApprovalTitle"),
        message: t("driver.pendingApprovalMessage"),
      };
    case "rejected":
      return {
        title: t("driver.applicationRejectedTitle"),
        message: t("driver.applicationRejectedMessage"),
      };
    case "suspended":
      return {
        title: t("driver.accountSuspendedTitle"),
        message: t("driver.verificationSuspendedMessage"),
      };
    case "license_expired":
      return {
        title: t("driver.licenseExpired"),
        message: t("driver.licenseExpiredMessage"),
      };
    default:
      return {
        title: t("driver.verificationRequired"),
        message: t("driver.mustVerifyLicense"),
      };
  }
};

// ---------------------------------------------------------------------------
// Lift Suspension — the cancellation-policy suspension's own, SOLE clearing
// path (see app/booking/driverViolationsLib.ts's liftDriverCancellationSuspension,
// the only caller). Deliberately NOT called from setDriverVerification: an
// earlier version of the "reactivate a suspended driver" fix also cleared an
// active cancellation suspension as a side effect of approving/reactivating
// driverVerificationStatus, which created exactly the "two confusing ways to
// reactivate cancellation suspension" the product owner explicitly didn't
// want. The two systems are independent axes (driverVerificationStatus is
// never set to "suspended" by the automatic 6-cancellations-in-30-days
// system — see evaluateDriverCancellationStanding — so there is no scenario
// where lifting a cancellation suspension needs to touch it), so they now
// have exactly one clearing path each:
//   - driverVerificationStatus  -> Approve/Reactivate (setDriverVerification)
//   - cancellationStanding      -> Lift Suspension (liftDriverCancellationSuspension)
//
// This function owns ONLY the decision of what the cleared standing object
// should look like; it never touches Firestore, never generates a timestamp
// (serverTimestamp() is a Firestore SDK sentinel this dependency-free file
// can't produce), and — per explicit product requirement — never considers
// suspensionMinEndAt/"Earliest Lift Date": an admin pressing Lift Suspension
// IS the manual override, at any time, always. The automatic minimum-
// duration system itself is untouched by this — it still governs how long a
// suspension lasts if the admin does nothing.
// ---------------------------------------------------------------------------

// Deliberately a minimal STRUCTURAL shape, not imported from
// app/booking/driverViolationsLib.ts's own CancellationStanding type — that
// file imports firebase/firestore (for the Timestamp type) at module scope,
// which would taint this file the same way idVerificationLib.ts would.
// Every real CancellationStanding object already satisfies this shape.
export type ActiveSuspensionFields = {
  suspensionActive: boolean;
  manualReviewRequired?: boolean;
};

// Returns null when there is nothing to clear (no active suspension) — the
// caller should skip writing cancellationStanding at all in that case,
// rather than writing a no-op update. When there IS an active suspension,
// returns every existing field UNCHANGED (so suspensionCount/
// suspensionReason/suspensionTier/suspensionStartAt/suspensionMinEndAt — the
// driver's history and the automatic system's own record of what it decided
// — survive exactly as before) except suspensionActive and
// manualReviewRequired, which are the only two fields that represent "is a
// suspension currently in effect."
export const computeClearedCancellationSuspension = <T extends ActiveSuspensionFields>(
  standing: T | null | undefined,
): (T & { suspensionActive: false; manualReviewRequired: false }) | null => {
  if (!standing || !standing.suspensionActive) return null;

  return { ...standing, suspensionActive: false, manualReviewRequired: false };
};
