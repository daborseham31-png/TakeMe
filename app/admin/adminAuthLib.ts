// ---------------------------------------------------------------------------
// Real admin role check — reads the SIGNED-IN user's own users/{uid} doc and
// trusts only its `role` field. Never trust a role picked in the UI (see
// app/index.tsx, which now uses this same helper).
// ---------------------------------------------------------------------------

import { User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { db } from "../../firebase";
import { AccountStatus } from "./adminTypes";

export const isUserAdmin = async (user: User | null): Promise<boolean> => {
  if (!user) return false;

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) return false;

    return snap.data().role === "admin";
  } catch {
    return false;
  }
};

export type AccountRestriction = {
  status: AccountStatus;
  reason: string;
};

// Checked right after every sign-in (app/index.tsx) — a blocked/suspended
// account must never reach any in-app screen, admin or otherwise, even
// though Firebase Auth itself happily accepted the password.
export const getAccountRestriction = async (
  uid: string,
): Promise<AccountRestriction | null> => {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return null;

    const data = snap.data();
    const status: AccountStatus = data.accountStatus || "active";

    if (status === "active") return null;

    return { status, reason: data.statusReason || "" };
  } catch {
    return null;
  }
};

export type AdminProfile = {
  id: string;
  name: string;
  email: string;
  photo: string | null;
};

export const getAdminProfile = async (uid: string): Promise<AdminProfile | null> => {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return null;

    const data = snap.data();

    return {
      id: uid,
      name: data.name || "Admin",
      email: data.email || "",
      photo: data.photo || null,
    };
  } catch {
    return null;
  }
};
