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
//   - app/(tabs)/bookings.tsx    (Republish Trip's own pre-submit re-check)
//
// A user stays a passenger regardless of this check — this only gates the
// driver-only screens/actions.
//
// The actual decision logic lives in driverEligibilityCore.ts (dependency-
// free, unit-tested — see tests/driverEligibilityCore.test.ts) and is
// re-exported here unchanged so no existing import path changes. This file
// only adds the one genuinely Firestore-dependent piece: fetching the
// driver's current doc fresh before evaluating it.
// ---------------------------------------------------------------------------

import { doc, getDoc } from "firebase/firestore";

import { db } from "../../firebase";
import {
  DriverEligibilityResult,
  evaluateDriverEligibility,
} from "./driverEligibilityCore";

export type {
  ActiveSuspensionFields,
  DriverEligibilityResult,
  DriverEligibilityStatus,
} from "./driverEligibilityCore";
export {
  computeClearedCancellationSuspension,
  evaluateDriverEligibility,
  getDriverEligibilityAlertCopy,
} from "./driverEligibilityCore";

// Fetches users/{uid} fresh from Firestore and evaluates it — use this at
// decision points (button press, screen mount, right before a Firestore
// write) rather than trusting cached/local state, since the license can
// expire or be edited between screens. Always a live read (never a cached
// snapshot/local auth-state value), so an admin's reactivation is picked up
// the very next time the driver hits any of this check's call sites — no
// stale client state to worry about.
export const fetchDriverEligibility = async (
  uid: string,
): Promise<DriverEligibilityResult> => {
  const snap = await getDoc(doc(db, "users", uid));

  if (!snap.exists()) {
    return { eligible: false, status: "not_registered" };
  }

  return evaluateDriverEligibility(snap.data());
};
