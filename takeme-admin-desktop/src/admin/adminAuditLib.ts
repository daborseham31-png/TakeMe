// ---------------------------------------------------------------------------
// Admin audit log — every admin action that changes data writes one entry
// here. Read-only for the app UI today (no "audit log" screen was asked
// for), but every mutating admin lib function calls writeAuditLog so the
// trail exists in Firestore from day one.
// ---------------------------------------------------------------------------

import { addDoc, collection, serverTimestamp } from "firebase/firestore";

import { auth, db } from "../../firebase";
import { AdminAuditLogEntry } from "./adminTypes";

export const writeAuditLog = async (
  entry: Omit<AdminAuditLogEntry, "adminId">,
): Promise<void> => {
  const adminId = auth.currentUser?.uid;
  if (!adminId) return;

  try {
    await addDoc(collection(db, "adminAuditLogs"), {
      adminId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      reason: entry.reason || "",
      createdAt: serverTimestamp(),
    });
  } catch {
    // Audit logging must never block the actual admin action from
    // completing — swallow failures the same way notify() does.
  }
};
