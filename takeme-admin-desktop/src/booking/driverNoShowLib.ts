// ---------------------------------------------------------------------------
// Driver NO-SHOW violations + appeals — Firestore-dependent layer. Completely
// separate from driverViolationsLib.ts (driver-CANCELLATION violations).
//
// TRUST MODEL — read this before touching a call site (same constraint as
// driverViolationsLib.ts's own header, and driverNoShowCore.ts's): this
// project's Firebase plan (Spark) cannot deploy Cloud Functions or use
// Storage. Real, app-independent detection runs from the Cloudflare Worker's
// scheduled cron (cloudflare-worker/src/noShowDetection.ts), authenticated as
// a trusted service account that bypasses firestore.rules entirely (same
// precedent as schoolChildren.ts's existing Worker routes).
//
// SECURITY: the Worker is the ONLY writer that may ever create a
// driverViolations document, set tripStatus to driver_no_show, update
// affected booking records, or create the initial notifications.
// firestore.rules denies `create` on driverViolations to every Firebase-Auth
// client (`allow create: if false`) — including the driver themselves — so
// there is deliberately NO client-side violation-creation code in this file
// anymore. Everything below is either a read/subscription, or the driver's
// own narrow self-write (submitting exactly one appeal), or an admin
// resolution action restricted by firestore.rules's field allowlist
// (isValidAdminNoShowViolationUpdate/isValidAdminNoShowAppealUpdate).
//
// SCHEMA NOTE: driverRoutes/schoolTrips field names for "is this trip still
// live/uncancelled" are inferred from this codebase's existing conventions
// (an `active: boolean` flag, a `status` string) — verify against the live
// schema; see the delivery report's "known assumptions" section.
// ---------------------------------------------------------------------------

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { auth, db } from "../../firebase";
import i18n from "../i18n";
import { writeAuditLog } from "../admin/adminAuditLib";
import {
  applyAppealApproval,
  applyAppealRejection,
  applyManualRefundConfirmation,
  canConfirmManualRefund,
  canSubmitAppeal,
  isEvidenceWithinSizeLimit,
  isSupportedEvidenceMimeType,
  isValidAppealExplanation,
  MAX_EVIDENCE_BASE64_CHARS,
  NoShowTripCategory,
  RefundStatus,
  SUPPORTED_EVIDENCE_MIME_TYPES,
} from "./driverNoShowCore";
import { notify } from "./work-errand/workErrandLib";

// Re-exported so screens (bookings.tsx) can import everything they need from
// this one file, mirroring driverViolationsLib.ts's own re-export
// convention for its core module.
export {
  canConfirmManualRefund,
  canSubmitAppeal,
  isEvidenceWithinSizeLimit,
  isSupportedEvidenceMimeType,
  MAX_EVIDENCE_BASE64_CHARS,
  SUPPORTED_EVIDENCE_MIME_TYPES,
} from "./driverNoShowCore";

const VIOLATIONS_COLLECTION = "driverViolations";
const APPEALS_COLLECTION = "violationAppeals";

// ---------------------------------------------------------------------------
// Types (mirrors the Firestore schema in the approved plan exactly)
// ---------------------------------------------------------------------------

export type ViolationStatus = "open" | "appeal_pending" | "appeal_approved" | "appeal_rejected";

export type DriverViolation = {
  id: string;
  driverId: string;
  tripId: string;
  bookingId: string | null;
  schoolTripId: string | null;
  category: NoShowTripCategory;
  violationType: "driver_no_show";
  scheduledAtSeconds: number;
  gracePeriodEndedAtSeconds: number;
  routeFrom: string;
  routeTo: string;
  passengerIds: string[];
  passengerCount: number;
  paymentMethods: string[];
  paidAmount: number;
  currency: string;
  refundStatus: RefundStatus;
  description: string;
  active: boolean;
  status: ViolationStatus;
  appealId: string | null;
  createdAtSeconds: number;
  updatedAtSeconds: number;
  resolvedAtSeconds: number | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  // Set ONLY by confirmManualRefund below — never by approveAppeal/
  // rejectAppeal, and never automatically (see decideInitialRefundStatus's
  // own header: this codebase has no real refund API integration).
  refundedAtSeconds: number | null;
  refundedBy: string | null;
  refundReference: string | null;
};

export const NO_SHOW_REASON_CATEGORIES = [
  "vehicle_breakdown",
  "medical_emergency",
  "family_emergency",
  "technical_problem",
  "accident_or_road_issue",
  "other",
] as const;

export type NoShowAppealReasonCategory = (typeof NO_SHOW_REASON_CATEGORIES)[number];

export const NO_SHOW_REASON_LABEL_KEY: Record<NoShowAppealReasonCategory, string> = {
  vehicle_breakdown: "driverNoShow.reasonVehicleBreakdown",
  medical_emergency: "driverNoShow.reasonMedicalEmergency",
  family_emergency: "driverNoShow.reasonFamilyEmergency",
  technical_problem: "driverNoShow.reasonTechnicalProblem",
  accident_or_road_issue: "driverNoShow.reasonAccidentOrRoadIssue",
  other: "driverNoShow.reasonOther",
};

export type AppealStatus = "pending" | "approved" | "rejected";

export type ViolationAppeal = {
  id: string;
  violationId: string;
  driverId: string;
  tripId: string;
  reasonCategory: NoShowAppealReasonCategory;
  explanation: string;
  evidenceUrls: string[];
  status: AppealStatus;
  submittedAtSeconds: number;
  reviewedAtSeconds: number | null;
  reviewedBy: string | null;
  adminDecisionNote: string | null;
  createdAtSeconds: number;
  updatedAtSeconds: number;
};

const toSeconds = (value: unknown): number => {
  const timestamp = value as { seconds?: number } | undefined;
  return timestamp?.seconds || 0;
};

const normalizeViolation = (id: string, data: Record<string, any>): DriverViolation => ({
  id,
  driverId: data.driverId || "",
  tripId: data.tripId || "",
  bookingId: data.bookingId || null,
  schoolTripId: data.schoolTripId || null,
  category: (data.category as NoShowTripCategory) || "personal",
  violationType: "driver_no_show",
  scheduledAtSeconds: toSeconds(data.scheduledAt),
  gracePeriodEndedAtSeconds: toSeconds(data.gracePeriodEndedAt),
  routeFrom: data.routeFrom || "",
  routeTo: data.routeTo || "",
  passengerIds: Array.isArray(data.passengerIds) ? data.passengerIds : [],
  passengerCount: typeof data.passengerCount === "number" ? data.passengerCount : 0,
  paymentMethods: Array.isArray(data.paymentMethods) ? data.paymentMethods : [],
  paidAmount: typeof data.paidAmount === "number" ? data.paidAmount : 0,
  currency: data.currency || "ILS",
  refundStatus: (data.refundStatus as RefundStatus) || "manual_refund_pending",
  description: data.description || "",
  active: data.active !== false,
  status: (data.status as ViolationStatus) || "open",
  appealId: data.appealId || null,
  createdAtSeconds: toSeconds(data.createdAt),
  updatedAtSeconds: toSeconds(data.updatedAt),
  resolvedAtSeconds: data.resolvedAt ? toSeconds(data.resolvedAt) : null,
  resolvedBy: data.resolvedBy || null,
  resolutionNote: data.resolutionNote || null,
  refundedAtSeconds: data.refundedAt ? toSeconds(data.refundedAt) : null,
  refundedBy: data.refundedBy || null,
  refundReference: data.refundReference || null,
});

const normalizeAppeal = (id: string, data: Record<string, any>): ViolationAppeal => ({
  id,
  violationId: data.violationId || "",
  driverId: data.driverId || "",
  tripId: data.tripId || "",
  reasonCategory: (data.reasonCategory as NoShowAppealReasonCategory) || "other",
  explanation: data.explanation || "",
  evidenceUrls: Array.isArray(data.evidenceUrls) ? data.evidenceUrls : [],
  status: (data.status as AppealStatus) || "pending",
  submittedAtSeconds: toSeconds(data.submittedAt),
  reviewedAtSeconds: data.reviewedAt ? toSeconds(data.reviewedAt) : null,
  reviewedBy: data.reviewedBy || null,
  adminDecisionNote: data.adminDecisionNote || null,
  createdAtSeconds: toSeconds(data.createdAt),
  updatedAtSeconds: toSeconds(data.updatedAt),
});

// ---------------------------------------------------------------------------
// Driver-facing reads
// ---------------------------------------------------------------------------

export const subscribeDriverViolations = (
  driverId: string,
  onUpdate: (rows: DriverViolation[]) => void,
  onError: (error: unknown) => void,
): (() => void) => {
  return onSnapshot(
    query(collection(db, VIOLATIONS_COLLECTION), where("driverId", "==", driverId), orderBy("createdAt", "desc")),
    (snap) => onUpdate(snap.docs.map((d) => normalizeViolation(d.id, d.data()))),
    onError,
  );
};

// Live "active violation count" badge — a QUERY, never a stored/incremented
// counter (see the approved plan's architecture decision #3): this trivially
// satisfies "never negative / never double-decremented / never counts an
// approved violation" because there is nothing to decrement — the count IS
// the live result size.
export const subscribeActiveViolationCount = (
  driverId: string,
  onUpdate: (count: number) => void,
  onError: (error: unknown) => void,
): (() => void) => {
  return onSnapshot(
    query(
      collection(db, VIOLATIONS_COLLECTION),
      where("driverId", "==", driverId),
      where("active", "==", true),
    ),
    (snap) => onUpdate(snap.size),
    onError,
  );
};

export const subscribeAppealForViolation = (
  violationId: string,
  onUpdate: (appeal: ViolationAppeal | null) => void,
  onError: (error: unknown) => void,
): (() => void) => {
  return onSnapshot(
    query(collection(db, APPEALS_COLLECTION), where("violationId", "==", violationId)),
    (snap) => onUpdate(snap.empty ? null : normalizeAppeal(snap.docs[0].id, snap.docs[0].data())),
    onError,
  );
};

// ---------------------------------------------------------------------------
// Driver-facing write: submit an appeal
// ---------------------------------------------------------------------------

export type SubmitAppealInput = {
  violationId: string;
  tripId: string;
  reasonCategory: NoShowAppealReasonCategory;
  explanation: string;
  // Single compressed base64 data-URI (see app/login/idVerificationLib.ts's
  // compressImageToBase64) — there is no Firebase Storage on this project's
  // (Spark) plan, so evidence lives directly on the appeal document, capped
  // at one image to respect Firestore's 1MiB document size limit.
  evidenceDataUri?: string | null;
};

export class NoShowAppealError extends Error {
  code: "invalid_reason" | "invalid_explanation" | "invalid_evidence" | "already_appealed" | "not_authorized";

  constructor(code: NoShowAppealError["code"], message: string) {
    super(message);
    this.name = "NoShowAppealError";
    this.code = code;
  }
};

// Prevents an accidental double-submit from firing two `addDoc`s before the
// first one's optimistic UI update disables the button — a defense-in-depth
// guard alongside the modal's own submitting-state check (see
// ViolationAppealModal.tsx).
const submissionInFlight = new Set<string>();

export const submitViolationAppeal = async (input: SubmitAppealInput): Promise<string> => {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new NoShowAppealError("not_authorized", "You must be signed in.");

  if (!NO_SHOW_REASON_CATEGORIES.includes(input.reasonCategory)) {
    throw new NoShowAppealError("invalid_reason", i18n.t("driverNoShow.errorSelectReason"));
  }
  if (!isValidAppealExplanation(input.explanation)) {
    throw new NoShowAppealError("invalid_explanation", i18n.t("driverNoShow.errorExplanationRequired"));
  }
  // Defense-in-depth — ViolationAppealModal.tsx already validates size before
  // calling this, but a modified client must not be able to bypass that by
  // calling submitViolationAppeal directly with an oversized data URI.
  if (input.evidenceDataUri && !isEvidenceWithinSizeLimit(input.evidenceDataUri.length)) {
    throw new NoShowAppealError("invalid_evidence", i18n.t("driverNoShow.errorEvidenceTooLarge"));
  }

  if (submissionInFlight.has(input.violationId)) {
    throw new NoShowAppealError("already_appealed", i18n.t("driverNoShow.errorAlreadySubmitting"));
  }
  submissionInFlight.add(input.violationId);

  try {
    const violationRef = doc(db, VIOLATIONS_COLLECTION, input.violationId);

    return await runTransaction(db, async (transaction) => {
      const violationSnap = await transaction.get(violationRef);
      if (!violationSnap.exists()) {
        throw new NoShowAppealError("not_authorized", i18n.t("driverNoShow.errorViolationNotFound"));
      }

      const violation = violationSnap.data();
      if (violation.driverId !== uid) {
        throw new NoShowAppealError("not_authorized", i18n.t("driverNoShow.errorNotYourViolation"));
      }
      if (!canSubmitAppeal({ appealId: violation.appealId || null, active: violation.active !== false })) {
        throw new NoShowAppealError("already_appealed", i18n.t("driverNoShow.errorAlreadyAppealed"));
      }

      // Deterministic appeal id (one appeal doc per violation, ever, through
      // this flow) — same idempotency shape as the violation id itself, so a
      // retried submission can never create two appeal docs for one
      // violation even if the transaction is retried by the SDK.
      const appealId = `appeal_${input.violationId}`;
      const appealRef = doc(db, APPEALS_COLLECTION, appealId);

      transaction.set(appealRef, {
        violationId: input.violationId,
        driverId: uid,
        tripId: input.tripId,
        reasonCategory: input.reasonCategory,
        explanation: input.explanation.trim(),
        evidenceUrls: input.evidenceDataUri ? [input.evidenceDataUri] : [],
        status: "pending",
        submittedAt: serverTimestamp(),
        reviewedAt: null,
        reviewedBy: null,
        adminDecisionNote: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      transaction.update(violationRef, {
        status: "appeal_pending",
        appealId,
        updatedAt: serverTimestamp(),
      });

      return appealId;
    });
  } finally {
    submissionInFlight.delete(input.violationId);
  }
};

// Notifies every admin — no "notify all admins" helper exists elsewhere in
// this codebase (adminReportsLib.ts's createReport never proactively notifies
// admins either; see the approved plan's architecture decision #6). Kept
// here rather than in adminNotificationsLib.ts since this is the one call
// site that needs it for now; a second caller should promote this to a
// shared admin-notification helper instead of duplicating it.
export const notifyAllAdminsOfNewAppeal = async (appealId: string, violationId: string): Promise<void> => {
  try {
    const adminsSnap = await getDocs(query(collection(db, "users"), where("role", "==", "admin")));
    await Promise.all(
      adminsSnap.docs.map((adminDoc) =>
        notify({
          receiverId: adminDoc.id,
          type: "noshow_appeal_submitted",
          title: i18n.t("driverNoShow.adminNotifyAppealSubmittedTitle"),
          message: i18n.t("driverNoShow.adminNotifyAppealSubmittedMessage"),
          targetPage: `admin/violations/${violationId}`,
        }),
      ),
    );
  } catch (error) {
    // Best-effort — never block the driver's own successful appeal
    // submission if the admin-notification fan-out fails.
    console.warn("notifyAllAdminsOfNewAppeal failed", error);
  }
};

// ---------------------------------------------------------------------------
// Admin-only actions — mirrors excuseDriverCancellationViolation's/
// liftDriverCancellationSuspension's exact shape (driverViolationsLib.ts):
// read-check -> updateDoc -> notify() -> writeAuditLog(). Firestore rules
// (not this code) are the real enforcement boundary that only an admin can
// call these successfully — see firestore.rules.
// ---------------------------------------------------------------------------

export const approveAppeal = async (
  violationId: string,
  appealId: string,
  adminNote: string,
): Promise<void> => {
  const adminUid = auth.currentUser?.uid || null;
  const violationSnap = await getDoc(doc(db, VIOLATIONS_COLLECTION, violationId));
  if (!violationSnap.exists()) throw new Error(i18n.t("driverNoShow.errorViolationNotFound"));
  const driverId = violationSnap.data().driverId as string;

  const transition = applyAppealApproval();

  await updateDoc(doc(db, VIOLATIONS_COLLECTION, violationId), {
    status: transition.violationStatus,
    active: transition.violationActive,
    resolvedAt: serverTimestamp(),
    resolvedBy: adminUid,
    resolutionNote: adminNote || "",
    updatedAt: serverTimestamp(),
  });

  await updateDoc(doc(db, APPEALS_COLLECTION, appealId), {
    status: transition.appealStatus,
    reviewedAt: serverTimestamp(),
    reviewedBy: adminUid,
    adminDecisionNote: adminNote || "",
    updatedAt: serverTimestamp(),
  });

  // "You now have {count} active violations" — computed dynamically, read
  // fresh AFTER the update above commits, never assumed.
  const remainingSnap = await getDocs(
    query(
      collection(db, VIOLATIONS_COLLECTION),
      where("driverId", "==", driverId),
      where("active", "==", true),
    ),
  );

  await notify({
    receiverId: driverId,
    type: "noshow_appeal_approved",
    title: i18n.t("driverNoShow.appealApprovedTitle"),
    message: i18n.t("driverNoShow.appealApprovedMessage", { count: remainingSnap.size }),
    targetTab: "driver",
  });

  await writeAuditLog({
    action: "appeal_approved",
    targetType: "appeal",
    targetId: appealId,
    reason: adminNote || "",
  });
};

export const rejectAppeal = async (
  violationId: string,
  appealId: string,
  adminNote: string,
): Promise<void> => {
  if (!isValidAppealExplanation(adminNote)) {
    throw new Error(i18n.t("driverNoShow.errorRejectionNoteRequired"));
  }

  const adminUid = auth.currentUser?.uid || null;
  const violationSnap = await getDoc(doc(db, VIOLATIONS_COLLECTION, violationId));
  if (!violationSnap.exists()) throw new Error(i18n.t("driverNoShow.errorViolationNotFound"));
  const driverId = violationSnap.data().driverId as string;

  const transition = applyAppealRejection();

  await updateDoc(doc(db, VIOLATIONS_COLLECTION, violationId), {
    status: transition.violationStatus,
    active: transition.violationActive,
    resolvedAt: serverTimestamp(),
    resolvedBy: adminUid,
    resolutionNote: adminNote,
    updatedAt: serverTimestamp(),
  });

  await updateDoc(doc(db, APPEALS_COLLECTION, appealId), {
    status: transition.appealStatus,
    reviewedAt: serverTimestamp(),
    reviewedBy: adminUid,
    adminDecisionNote: adminNote,
    updatedAt: serverTimestamp(),
  });

  await notify({
    receiverId: driverId,
    type: "noshow_appeal_rejected",
    title: i18n.t("driverNoShow.appealRejectedTitle"),
    message: i18n.t("driverNoShow.appealRejectedMessage"),
    targetTab: "driver",
  });

  await writeAuditLog({
    action: "appeal_rejected",
    targetType: "appeal",
    targetId: appealId,
    reason: adminNote,
  });
};

// ---------------------------------------------------------------------------
// Manual refund confirmation — a SEPARATE admin action from approveAppeal/
// rejectAppeal above (neither of those ever touches refundStatus; see
// applyAppealApproval/applyAppealRejection's return types in
// driverNoShowCore.ts). This is the ONLY function anywhere in the codebase
// that may ever set refundStatus to "refunded", and it only fires when an
// admin explicitly confirms a real manual refund happened outside this app
// (there is no live refund API integration here). firestore.rules'
// isValidAdminNoShowViolationUpdate() is what actually enforces that this
// stays admin-only and touches only the resolution/refund fields.
// ---------------------------------------------------------------------------

export const confirmManualRefund = async (
  violationId: string,
  refundReference: string,
): Promise<void> => {
  if (!isValidAppealExplanation(refundReference)) {
    throw new Error(i18n.t("driverNoShow.errorRefundReferenceRequired"));
  }

  const adminUid = auth.currentUser?.uid || null;
  const violationSnap = await getDoc(doc(db, VIOLATIONS_COLLECTION, violationId));
  if (!violationSnap.exists()) throw new Error(i18n.t("driverNoShow.errorViolationNotFound"));

  const currentRefundStatus = (violationSnap.data().refundStatus as RefundStatus) || "manual_refund_pending";
  if (!canConfirmManualRefund(currentRefundStatus)) {
    throw new Error(i18n.t("driverNoShow.errorRefundNotPending"));
  }

  const driverId = violationSnap.data().driverId as string;
  const transition = applyManualRefundConfirmation();

  await updateDoc(doc(db, VIOLATIONS_COLLECTION, violationId), {
    refundStatus: transition.refundStatus,
    refundedAt: serverTimestamp(),
    refundedBy: adminUid,
    refundReference: refundReference.trim(),
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog({
    action: "refund_confirmed",
    targetType: "violation",
    targetId: violationId,
    reason: refundReference.trim(),
  });

  // Best-effort — the driver isn't the one owed the refund, but they're kept
  // in the loop since it's their violation's record; never blocks the admin
  // action itself if notification delivery fails.
  await notify({
    receiverId: driverId,
    type: "noshow_refund_confirmed",
    title: i18n.t("driverNoShow.refundConfirmedTitle"),
    message: i18n.t("driverNoShow.refundConfirmedMessage"),
    targetTab: "driver",
  }).catch((error) => console.warn("confirmManualRefund: driver notification failed", error));
};
