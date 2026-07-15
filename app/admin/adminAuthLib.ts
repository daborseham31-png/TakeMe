// ---------------------------------------------------------------------------
// Real admin role check — reads the SIGNED-IN user's own users/{uid} doc and
// trusts only its `role` field. Never trust a role picked in the UI (see
// app/index.tsx, which now uses this same helper).
// ---------------------------------------------------------------------------

import { User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { db } from "../../firebase";

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
