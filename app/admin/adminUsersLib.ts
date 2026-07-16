// ---------------------------------------------------------------------------
// Users management data layer. Reuses the exact `users` collection/field
// names written by app/login/signup.tsx — adds `accountStatus`/`statusReason`
// (new fields, safe additive change: absence just means "active").
// ---------------------------------------------------------------------------

import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";

import { auth, db } from "../../firebase";
import i18n from "../i18n";
import { writeAuditLog } from "./adminAuditLib";
import { AccountStatus, AdminUserRow } from "./adminTypes";

const toSeconds = (value: unknown): number => {
  const timestamp = value as { seconds?: number } | undefined;
  return timestamp?.seconds || 0;
};

export const normalizeAdminUser = (id: string, data: Record<string, any>): AdminUserRow => ({
  id,
  name: data.name || i18n.t("admin.unnamedFallback"),
  email: data.email || "",
  phone: data.phone || "",
  role: data.role === "admin" || data.role === "driver" || data.role === "passenger"
    ? data.role
    : "",
  isDriver: data.isDriver === true,
  photo: data.photo || null,
  accountStatus: (data.accountStatus as AccountStatus) || "active",
  statusReason: data.statusReason || "",
  driverVerificationStatus: data.driverVerificationStatus || "",
  ratingAverage: Number(data.ratingAverage) || 0,
  ratingCount: Number(data.ratingCount) || 0,
  carPlate: data.carPlate || "",
  licenseExpiryDate: data.licenseExpiryDate || "",
  spokenLanguages: Array.isArray(data.spokenLanguages) ? data.spokenLanguages : [],
  gender: data.gender || "",
  createdAtSeconds: toSeconds(data.createdAt),
});

export const subscribeAllUsers = (
  onUpdate: (users: AdminUserRow[]) => void,
  onError: (error: unknown) => void,
): (() => void) => {
  return onSnapshot(
    collection(db, "users"),
    (snap) => {
      const users = snap.docs.map((docSnap) => normalizeAdminUser(docSnap.id, docSnap.data()));
      onUpdate(users);
    },
    onError,
  );
};

// block / unblock / suspend / reactivate all funnel through this one
// updater — the only difference between them is which status they set.
export const setUserAccountStatus = async (
  userId: string,
  status: AccountStatus,
  reason: string,
): Promise<void> => {
  await updateDoc(doc(db, "users", userId), {
    accountStatus: status,
    statusReason: status === "active" ? "" : reason,
    updatedAt: new Date(),
  });

  await writeAuditLog({
    action:
      status === "blocked"
        ? "user_blocked"
        : status === "suspended"
          ? "user_suspended"
          : "user_unblocked",
    targetType: "user",
    targetId: userId,
    reason,
  });
};

// Only passenger <-> driver is ever allowed from this screen — "admin" is
// never a selectable option in the UI, so a user can never be promoted to
// admin through normal role-management actions (see also firestore.rules).
export const setUserRole = async (
  userId: string,
  role: "passenger" | "driver",
): Promise<void> => {
  await updateDoc(doc(db, "users", userId), {
    role,
    isDriver: role === "driver",
    updatedAt: new Date(),
  });

  await writeAuditLog({
    action: "user_role_changed",
    targetType: "user",
    targetId: userId,
    reason: `New role: ${role}`,
  });
};

export const deleteUserAccount = async (userId: string, reason: string): Promise<void> => {
  if (auth.currentUser?.uid === userId) {
    throw new Error(i18n.t("admin.cannotDeleteOwnAccount"));
  }

  // Deletes the Firestore profile only — deleting the actual Firebase Auth
  // account requires the Admin SDK, which must never run inside the mobile
  // app (see the summary's "limitations" section). Deleting the profile
  // revokes the user's ability to use the app's features immediately.
  await deleteDoc(doc(db, "users", userId));

  await writeAuditLog({
    action: "user_deleted",
    targetType: "user",
    targetId: userId,
    reason,
  });
};
