// ---------------------------------------------------------------------------
// Reports & Support data layer. No report storage existed in this project
// before — this is the new `adminReports` collection, plus createReport()
// which is the ONE function both the admin side and the passenger-facing
// "Report a problem" entry point (app/(tabs)/profile.tsx) call, so there's
// a single source of truth for the document shape.
// ---------------------------------------------------------------------------

import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { auth, db } from "../../firebase";
import i18n from "../i18n";
import { notify } from "../booking/work-errand/workErrandLib";
import { writeAuditLog } from "./adminAuditLib";
import { AdminReportRow, ReportCategory, ReportStatus } from "./adminTypes";

const toSeconds = (value: unknown): number => {
  const timestamp = value as { seconds?: number } | undefined;
  return timestamp?.seconds || 0;
};

const normalizeReport = (id: string, data: Record<string, any>): AdminReportRow => ({
  id,
  reporterId: data.reporterId || "",
  reporterName: data.reporterName || i18n.t("common.user"),
  targetType: data.targetType || "",
  targetId: data.targetId || "",
  category: data.category || "other",
  description: data.description || "",
  imageUrl: data.imageUrl || "",
  status: data.status || "open",
  adminResponse: data.adminResponse || "",
  internalNote: data.internalNote || "",
  createdAtSeconds: toSeconds(data.createdAt),
});

export type CreateReportInput = {
  category: ReportCategory;
  description: string;
  targetType?: "user" | "ride" | "booking";
  targetId?: string;
  imageUrl?: string;
};

// Desktop note: compressReportImage is only ever called from the mobile
// app's own passenger-facing "Report a problem" flow (app/(tabs)/profile.tsx)
// when a passenger ATTACHES a photo to a new report — the admin app never
// creates a report, only reads/updates existing ones (createReport below is
// kept because admin's data layer shares this file, but nothing here calls
// compressReportImage). Stubbed rather than pulling in expo-image-manipulator
// (native-only, no browser build) for a code path this app never exercises.
export const compressReportImage = async (_localUri: string): Promise<string> => {
  throw new Error("Report photo capture is not available in the TakeMe Admin desktop app.");
};

export const createReport = async (input: CreateReportInput): Promise<void> => {
  const user = auth.currentUser;
  if (!user) {
    throw new Error(i18n.t("auth.pleaseLoginFirst"));
  }

  if (!input.description.trim()) {
    throw new Error(i18n.t("admin.describeIssue"));
  }

  let reporterName = user.displayName || i18n.t("common.user");

  try {
    const profileSnap = await getDoc(doc(db, "users", user.uid));
    if (profileSnap.exists()) {
      reporterName = profileSnap.data().name || reporterName;
    }
  } catch {
    // Keep the auth fallback name.
  }

  await addDoc(collection(db, "adminReports"), {
    reporterId: user.uid,
    reporterName,
    targetType: input.targetType || "",
    targetId: input.targetId || "",
    category: input.category,
    description: input.description.trim(),
    imageUrl: input.imageUrl || "",
    status: "open" as ReportStatus,
    adminResponse: "",
    internalNote: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const subscribeAllReports = (
  onUpdate: (reports: AdminReportRow[]) => void,
  onError: (error: unknown) => void,
): (() => void) => {
  return onSnapshot(
    collection(db, "adminReports"),
    (snap) => {
      onUpdate(snap.docs.map((d) => normalizeReport(d.id, d.data())));
    },
    onError,
  );
};

export const updateReportStatus = async (
  reportId: string,
  status: ReportStatus,
  adminResponse: string,
  internalNote: string,
): Promise<void> => {
  await updateDoc(doc(db, "adminReports", reportId), {
    status,
    adminResponse,
    internalNote,
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog({
    action: status === "resolved" ? "report_resolved" : "report_status_changed",
    targetType: "report",
    targetId: reportId,
    reason: adminResponse,
  });

  if (status === "resolved" || status === "rejected") {
    const snap = await getDoc(doc(db, "adminReports", reportId));
    const data = snap.exists() ? snap.data() : null;

    if (data?.reporterId) {
      await notify({
        receiverId: data.reporterId,
        type: "report_status_updated",
        title: status === "resolved" ? "Your report was resolved" : "Your report was reviewed",
        message: adminResponse || `Your report is now ${status}.`,
        targetTab: "passenger",
      });
    }
  }
};
