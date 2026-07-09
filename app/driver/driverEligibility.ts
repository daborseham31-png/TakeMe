// ---------------------------------------------------------------------------
// Shared "is this user allowed to act as a driver right now" check.
//
// Used by:
//   - app/(tabs)/home.tsx        ("Become a Driver" button)
//   - app/driver/add-route.tsx   (driver category picker, in case it's
//                                 opened directly via a deep link)
//   - app/driver/create/*.tsx    (re-checked again right before saving a
//                                 trip/job, in case the license expired or
//                                 was revoked between screens)
//
// A user stays a passenger regardless of this check — this only gates the
// driver-only screens/actions.
// ---------------------------------------------------------------------------

import { doc, getDoc } from "firebase/firestore";

import { db } from "../../firebase";
import { getLicenseValidity } from "../login/idVerificationLib";

export type DriverEligibilityStatus =
  | "eligible"
  | "not_registered"
  | "license_missing"
  | "license_expired"
  | "languages_missing";

export type DriverEligibilityResult = {
  eligible: boolean;
  status: DriverEligibilityStatus;
};

// Pure — operates on an already-fetched users/{uid} doc body.
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

  return { eligible: true, status: "eligible" };
};

// Fetches users/{uid} fresh from Firestore and evaluates it — use this at
// decision points (button press, screen mount, right before a Firestore
// write) rather than trusting cached/local state, since the license can
// expire or be edited between screens.
export const fetchDriverEligibility = async (
  uid: string,
): Promise<DriverEligibilityResult> => {
  const snap = await getDoc(doc(db, "users", uid));

  if (!snap.exists()) {
    return { eligible: false, status: "not_registered" };
  }

  return evaluateDriverEligibility(snap.data());
};
