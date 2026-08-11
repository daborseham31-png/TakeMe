// ---------------------------------------------------------------------------
// Driver verification data layer — drivers are just users/{uid} docs with
// isDriver:true, so this reuses adminUsersLib's normalizer and only adds the
// verification-specific actions (approve/reject/suspend/reactivate/notes).
// ---------------------------------------------------------------------------

import { arrayUnion, collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";

import { db } from "../../firebase";
import i18n from "../i18n";
import { notify } from "../booking/work-errand/workErrandLib";
import { writeAuditLog } from "./adminAuditLib";
import { AdminUserRow, DriverVerificationStatus } from "./adminTypes";
import { normalizeAdminUser } from "./adminUsersLib";

export const subscribeDrivers = (
  onUpdate: (drivers: AdminUserRow[]) => void,
  onError: (error: unknown) => void,
): (() => void) => {
  return onSnapshot(
    query(collection(db, "users"), where("isDriver", "==", true)),
    (snap) => {
      const drivers = snap.docs.map((docSnap) => normalizeAdminUser(docSnap.id, docSnap.data()));
      onUpdate(drivers);
    },
    onError,
  );
};

// A driver can only be approved once these are present — mirrors what
// signup.tsx already requires to mark someone as a driver in the first
// place, so this just re-checks the same fields haven't been left blank.
// Vehicle plate number is deliberately NOT required here — it's no longer
// collected at sign up; drivers enter it later, per vehicle, when creating
// a trip (see RideForm.tsx), so it belongs to driverRoutes, not this profile.
export const getMissingDriverRequirements = (driver: AdminUserRow): string[] => {
  const missing: string[] = [];

  if (!driver.licenseExpiryDate) missing.push(i18n.t("admin.missingLicenseExpiry"));
  if (driver.spokenLanguages.length === 0) missing.push(i18n.t("admin.missingSpokenLanguages"));
  if (!driver.phone) missing.push(i18n.t("admin.missingPhoneNumber"));
  if (!driver.licenseExpiryDate) missing.push("Driving license expiry date");
  if (driver.spokenLanguages.length === 0) missing.push("Spoken languages");
  if (!driver.phone) missing.push("Phone number");

  return missing;
};

const NOTIFICATION_COPY: Record<
  DriverVerificationStatus,
  { title: string; message: (reason: string) => string }
> = {
  approved: {
    title: "Driver application approved",
    message: () => "Congratulations! You're now a verified driver on TakeMe.",
  },
  rejected: {
    title: "Driver application rejected",
    message: (reason) =>
      reason
        ? `Your driver application was not approved: ${reason}`
        : "Your driver application was not approved this time.",
  },
  suspended: {
    title: "Driver account suspended",
    message: (reason) =>
      reason
        ? `Your driver account has been suspended: ${reason}`
        : "Your driver account has been suspended.",
  },
  pending_admin_review: {
    title: "Driver application under review",
    message: () => "Your driver application is being reviewed again.",
  },
  not_registered: {
    title: "Driver status updated",
    message: () => "Your driver status was updated.",
  },
};

// Touches driverVerificationStatus ONLY — never cancellationStanding. These
// are two deliberately independent axes with two deliberately separate admin
// actions/buttons:
//   - driverVerificationStatus  -> Approve / Reject / Suspend / Reactivate
//                                  (this function)
//   - cancellationStanding      -> Lift Suspension
//                                  (liftDriverCancellationSuspension, in
//                                  app/booking/driverViolationsLib.ts)
// An earlier version of this function ALSO cleared an active cancellation
// suspension whenever status was set to "approved", to work around Lift
// Suspension being blocked before its minimum duration elapsed. That created
// two different, inconsistent ways to reactivate a cancellation suspension —
// explicitly not wanted. Lift Suspension is now unconditionally available at
// any time (see liftDriverCancellationSuspension's own comment), so it is
// the ONE correct tool for that job; this function no longer needs to (and
// must not) duplicate it.
export const setDriverVerification = async (
  driverId: string,
  status: DriverVerificationStatus,
  reason: string,
): Promise<void> => {
  await updateDoc(doc(db, "users", driverId), {
    driverVerificationStatus: status,
    driverVerificationReason: reason || "",
    updatedAt: new Date(),
  });

  const copy = NOTIFICATION_COPY[status];

  await notify({
    receiverId: driverId,
    type: `driver_verification_${status}`,
    title: copy.title,
    message: copy.message(reason),
    targetTab: "driver",
  });

  await writeAuditLog({
    action:
      status === "approved"
        ? "driver_approved"
        : status === "rejected"
          ? "driver_rejected"
          : status === "suspended"
            ? "driver_suspended"
            : "driver_reactivated",
    targetType: "driver",
    targetId: driverId,
    reason,
  });
};

export const addDriverAdminNote = async (driverId: string, note: string): Promise<void> => {
  await updateDoc(doc(db, "users", driverId), {
    adminNotes: arrayUnion({ note, createdAt: new Date().toISOString() }),
  });
};
