// ---------------------------------------------------------------------------
// Driver cancellation violations + suspension.
//
// A violation is recorded whenever a driver (never a passenger, never an
// admin) cancels a trip that already has a real booking on it. 1st/2nd
// violation in a rolling 30-day window is silent, 3rd/4th show an escalating
// warning, 5th suspends the driver from posting/accepting/starting trips
// (never a full account lockout — see getDriverSuspensionBlockedReason).
// A suspension is never auto-lifted; only an admin can lift one, via
// liftDriverCancellationSuspension. Repeat offenders escalate: 1st
// suspension = 7 days, 2nd (within 60 days of the previous lift) = 30 days,
// 3rd = indefinite. More than 60 clean days after a lift resets the ladder
// back to a 7-day suspension.
//
// This runs entirely client-side (the driver's own authenticated session
// writes its own violation docs and, on the 5th strike, its own
// cancellationStanding) — the same trust model every other cancellation
// flow in this codebase already uses (cancelRideBooking, cancelGeneralBooking,
// cancelApplication). firestore.rules' isValidSelfViolationStandingUpdate is
// what keeps a driver from ever un-suspending themselves.
//
// Call sites that must call recordDriverCancellationViolation (only when the
// cancelled trip had a real booking, cancelledBy === "driver"):
//   - rideBookingLib.ts        cancelRideBooking
//   - bookingsLib.ts           cancelGeneralBooking
//   - school/useMySchoolRows.tsx  confirmCancelTripWithReason (affectedCount > 0 branch)
//   - work-errand/workErrandLib.ts  cancelApplication
// ---------------------------------------------------------------------------

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { auth, db } from "../../firebase";
import i18n from "../i18n";
import { notify } from "./work-errand/workErrandLib";
import { writeAuditLog } from "../admin/adminAuditLib";
import { isValidAppealExplanation } from "./driverNoShowCore";

// Mirrors driverNoShowLib.ts's own ViolationStatus/driverViolationCore.ts's
// CancellationViolationStatus on mobile exactly — appeal state for a
// driver-cancellation violation (see approveCancellationViolationAppeal/
// rejectCancellationViolationAppeal below). Desktop has no
// driverViolationCore.ts of its own (that file is mobile-only — it also
// holds the trip-cancellation WRITE logic, which desktop's admin-only UI
// never needs), so this is defined locally instead of imported.
export type CancellationViolationStatus = "open" | "appeal_pending" | "appeal_approved" | "appeal_rejected";
const CANCELLATION_VIOLATION_TYPE = "driver_cancellation" as const;

export type CancellationSourceCollection =
  | "bookings"
  | "driverRoutes"
  | "workJobs"
  | "errandJobs"
  | "schoolTrips";

const ROLLING_WINDOW_DAYS = 30;
const REPEAT_OFFENSE_WINDOW_DAYS = 60;
const LATE_CANCELLATION_HOURS = 24;

const SUSPENSION_MIN_DURATION_DAYS: Record<number, number | null> = {
  1: 7,
  2: 30,
  3: null,
};

const daysToMs = (days: number) => days * 24 * 60 * 60 * 1000;

type CancellationStanding = {
  suspensionActive: boolean;
  suspensionTier: 0 | 1 | 2 | 3;
  suspensionMinDurationDays: 7 | 30 | null;
  suspensionStartAt: Timestamp | null;
  suspensionMinEndAt: Timestamp | null;
  suspensionReason: string;
  suspensionCount: number;
  lastSuspensionLiftedAt: Timestamp | null;
  updatedAt: unknown;
};

// Exported so adminDriversLib.ts's setDriverVerification can build the same
// safe-defaults-merged CancellationStanding shape when it needs to clear an
// active cancellation suspension as part of admin driver reactivation (see
// that function's own comment) — never redefined a second time there.
export const EMPTY_STANDING: CancellationStanding = {
  suspensionActive: false,
  suspensionTier: 0,
  suspensionMinDurationDays: null,
  suspensionStartAt: null,
  suspensionMinEndAt: null,
  suspensionReason: "",
  suspensionCount: 0,
  lastSuspensionLiftedAt: null,
  updatedAt: null,
};

// Escalation ladder: never-suspended-before -> tier 1. Within 60 clean days
// of the last lift -> next tier up (capped at 3). More than 60 clean days
// since the last lift -> back down to tier 1 (a fresh start).
const computeNextSuspensionTier = (
  previousTier: number,
  lastSuspensionLiftedAt: Timestamp | null,
  now: number,
): 1 | 2 | 3 => {
  if (!lastSuspensionLiftedAt) return 1;

  const cleanGapMs = now - lastSuspensionLiftedAt.toMillis();
  if (cleanGapMs <= daysToMs(REPEAT_OFFENSE_WINDOW_DAYS)) {
    return Math.min(previousTier + 1, 3) as 1 | 2 | 3;
  }

  return 1;
};

export type RecordDriverCancellationViolationInput = {
  driverId: string;
  sourceCollection: CancellationSourceCollection;
  sourceId: string;
  sourceCategory: string;
  scheduledDeparture: Date;
};

// Idempotent: the violation doc's id is deterministic
// (`${sourceCollection}__${sourceId}`), so calling this twice for the same
// cancelled trip/booking/application is a no-op the second time — same
// pattern as driverReviews/{bookingId} in rideBookingLib.ts.
export const recordDriverCancellationViolation = async (
  input: RecordDriverCancellationViolationInput,
): Promise<void> => {
  const { driverId, sourceCollection, sourceId, sourceCategory, scheduledDeparture } = input;

  const violationId = `${sourceCollection}__${sourceId}`;
  const violationRef = doc(db, "users", driverId, "cancellationViolations", violationId);

  const existing = await getDoc(violationRef);
  if (existing.exists()) return;

  const now = Date.now();
  const hoursBeforeDeparture = (scheduledDeparture.getTime() - now) / (60 * 60 * 1000);
  const lateCancellation = hoursBeforeDeparture < LATE_CANCELLATION_HOURS;

  const violationsRef = collection(db, "users", driverId, "cancellationViolations");
  const windowStart = Timestamp.fromMillis(now - daysToMs(ROLLING_WINDOW_DAYS));
  const recentSnap = await getDocs(
    query(violationsRef, where("adminExcused", "==", false), where("createdAt", ">=", windowStart)),
  );
  const violationLevel = recentSnap.size + 1;

  await setDoc(violationRef, {
    driverId,
    sourceCollection,
    sourceId,
    sourceCategory,
    scheduledDeparture: Timestamp.fromDate(scheduledDeparture),
    hoursBeforeDeparture,
    lateCancellation,
    adminExcused: false,
    excusedAt: null,
    excusedBy: null,
    excuseReason: null,
    triggeredWarningLevel: violationLevel <= 5 ? violationLevel : 5,
    createdAt: serverTimestamp(),
  });

  const driverSnap = await getDoc(doc(db, "users", driverId));
  const standing: CancellationStanding = {
    ...EMPTY_STANDING,
    ...(driverSnap.exists() ? driverSnap.data()?.cancellationStanding : null),
  };

  // A driver already suspended can still have older, not-yet-processed
  // cancellations trickle in — never re-notify or re-escalate for those.
  if (standing.suspensionActive) return;

  if (violationLevel === 3) {
    await notify({
      receiverId: driverId,
      type: "driver_cancellation_warning",
      title: i18n.t("driver.cancellationWarningTitle"),
      message: i18n.t("driver.cancellationWarningThird", { count: violationLevel }),
      targetTab: "driver",
    });
    return;
  }

  if (violationLevel === 4) {
    await notify({
      receiverId: driverId,
      type: "driver_cancellation_final_warning",
      title: i18n.t("driver.cancellationWarningTitle"),
      message: i18n.t("driver.cancellationWarningFourth", { count: violationLevel }),
      targetTab: "driver",
    });
    return;
  }

  if (violationLevel >= 5) {
    const tier = computeNextSuspensionTier(standing.suspensionTier, standing.lastSuspensionLiftedAt, now);
    const minDurationDays = SUSPENSION_MIN_DURATION_DAYS[tier];
    const suspensionMinEndAt = minDurationDays
      ? Timestamp.fromMillis(now + daysToMs(minDurationDays))
      : null;

    await updateDoc(doc(db, "users", driverId), {
      cancellationStanding: {
        suspensionActive: true,
        suspensionTier: tier,
        suspensionMinDurationDays: minDurationDays,
        suspensionStartAt: Timestamp.fromMillis(now),
        suspensionMinEndAt,
        suspensionReason: `${violationLevel} cancellations within ${ROLLING_WINDOW_DAYS} days`,
        suspensionCount: standing.suspensionCount + 1,
        lastSuspensionLiftedAt: standing.lastSuspensionLiftedAt,
        updatedAt: serverTimestamp(),
      },
      updatedAt: serverTimestamp(),
    });

    await notify({
      receiverId: driverId,
      type: "driver_cancellation_suspended",
      title: i18n.t("driver.accountSuspendedTitle"),
      message: i18n.t("driver.cancellationSuspensionBlockedMessage"),
      targetTab: "driver",
    });
  }
};

// Fetches users/{driverId} fresh (never trusts cached state — same
// convention as fetchDriverEligibility in app/driver/driverEligibility.ts).
// Returns null if the driver is free to publish/accept/start trips.
export const getDriverSuspensionBlockedReason = async (
  driverId: string,
): Promise<string | null> => {
  const snap = await getDoc(doc(db, "users", driverId));
  if (!snap.exists()) return null;

  const standing = snap.data()?.cancellationStanding as CancellationStanding | undefined;
  if (!standing?.suspensionActive) return null;

  return i18n.t("driver.cancellationSuspensionBlockedMessage");
};

// ---------------------------------------------------------------------------
// Admin-only
// ---------------------------------------------------------------------------

export const excuseDriverCancellationViolation = async (
  driverId: string,
  violationId: string,
  reason: string,
): Promise<void> => {
  await updateDoc(doc(db, "users", driverId, "cancellationViolations", violationId), {
    adminExcused: true,
    // Kept in sync with adminExcused — this is the field a violation's
    // active-count/appeal-eligibility (canSubmitAppeal) actually reads. This
    // was missing here previously (desktop's own excuse path had drifted
    // from mobile's — see driverViolationCore.ts's writeCancellationViolationIfNew
    // on mobile for the field this is meant to mirror).
    active: false,
    excusedAt: serverTimestamp(),
    excusedBy: auth.currentUser?.uid || null,
    excuseReason: reason || "",
  });

  await notify({
    receiverId: driverId,
    type: "driver_cancellation_violation_excused",
    title: i18n.t("driver.violationExcusedTitle"),
    message: i18n.t("driver.violationExcusedMessage"),
    targetTab: "driver",
  });

  await writeAuditLog({
    action: "driver_cancellation_violation_excused",
    targetType: "driver",
    targetId: driverId,
    reason,
  });
};

// ---------------------------------------------------------------------------
// Admin-only — appeal review for driver-cancellation violations. Mirrors
// driverNoShowLib.ts's approveAppeal/rejectAppeal field-for-field (same
// ViolationAppeal doc, same appeal status values) — the only real difference
// is WHICH violation document gets updated: users/{driverId}/
// cancellationViolations/{violationId} here, instead of the top-level
// driverViolations/{violationId} the no-show system uses. Needs driverId as
// its own argument (unlike approveAppeal/rejectAppeal) because that
// subcollection path can't be derived from violationId alone.
// ---------------------------------------------------------------------------

export const approveCancellationViolationAppeal = async (
  driverId: string,
  violationId: string,
  appealId: string,
  adminNote: string,
): Promise<void> => {
  const adminUid = auth.currentUser?.uid || null;

  await updateDoc(doc(db, "users", driverId, "cancellationViolations", violationId), {
    status: "appeal_approved" as CancellationViolationStatus,
    active: false,
    adminExcused: true,
    excusedAt: serverTimestamp(),
    excusedBy: adminUid,
    excuseReason: "appeal_approved",
    excuseNote: adminNote || "",
    updatedAt: serverTimestamp(),
  });

  await updateDoc(doc(db, "violationAppeals", appealId), {
    status: "approved",
    reviewedAt: serverTimestamp(),
    reviewedBy: adminUid,
    adminDecisionNote: adminNote || "",
    updatedAt: serverTimestamp(),
  });

  await notify({
    receiverId: driverId,
    type: "cancellation_appeal_approved",
    title: i18n.t("driverNoShow.appealApprovedTitle"),
    message: i18n.t("driver.violationExcusedMessage"),
    targetTab: "driver",
  });

  await writeAuditLog({
    action: "appeal_approved",
    targetType: "appeal",
    targetId: appealId,
    reason: adminNote || "",
  });
};

export const rejectCancellationViolationAppeal = async (
  driverId: string,
  violationId: string,
  appealId: string,
  adminNote: string,
): Promise<void> => {
  if (!isValidAppealExplanation(adminNote)) {
    throw new Error(i18n.t("driverNoShow.errorRejectionNoteRequired"));
  }

  const adminUid = auth.currentUser?.uid || null;

  await updateDoc(doc(db, "users", driverId, "cancellationViolations", violationId), {
    status: "appeal_rejected" as CancellationViolationStatus,
    active: true,
    updatedAt: serverTimestamp(),
  });

  await updateDoc(doc(db, "violationAppeals", appealId), {
    status: "rejected",
    reviewedAt: serverTimestamp(),
    reviewedBy: adminUid,
    adminDecisionNote: adminNote,
    updatedAt: serverTimestamp(),
  });

  await notify({
    receiverId: driverId,
    type: "cancellation_appeal_rejected",
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

// The ONE way a cancellation suspension (cancellationStanding.suspensionActive)
// is ever cleared — see setDriverVerification's own comment (adminDriversLib.ts)
// for why that function deliberately does NOT also do this. An admin may
// lift a suspension at ANY time, including before suspensionMinEndAt/
// "Earliest Lift Date" — this is an explicit product decision: the automatic
// 7/30/indefinite-day duration still governs how long a suspension lasts if
// the admin does nothing, but pressing this button IS the admin's manual
// override of that timer, always available, never gated behind it.
// suspensionMinEndAt itself is never modified — it stays on the (now-
// inactive) standing as a historical record of what the automatic system
// originally decided.
export const liftDriverCancellationSuspension = async (
  driverId: string,
  reason: string,
): Promise<void> => {
  const snap = await getDoc(doc(db, "users", driverId));
  const standing = snap.exists()
    ? (snap.data()?.cancellationStanding as CancellationStanding | undefined)
    : undefined;

  if (!standing?.suspensionActive) {
    throw new Error(i18n.t("admin.driverNotCurrentlySuspended"));
  }

  await updateDoc(doc(db, "users", driverId), {
    cancellationStanding: {
      ...standing,
      suspensionActive: false,
      lastSuspensionLiftedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  });

  await notify({
    receiverId: driverId,
    type: "driver_cancellation_suspension_lifted",
    title: i18n.t("driver.suspensionLiftedTitle"),
    message: i18n.t("driver.suspensionLiftedMessage"),
    targetTab: "driver",
  });

  await writeAuditLog({
    action: "driver_cancellation_suspension_lifted",
    targetType: "driver",
    targetId: driverId,
    reason,
  });
};

export type DriverCancellationViolation = {
  id: string;
  driverId: string;
  // = sourceId — see mobile's driverViolationCore.ts's own comment; kept
  // here too so this screen's appeal-review code can read one shared field
  // name regardless of which app wrote the doc.
  tripId: string;
  violationType: typeof CANCELLATION_VIOLATION_TYPE;
  active: boolean;
  // Appeal state — see approveCancellationViolationAppeal/
  // rejectCancellationViolationAppeal below.
  status: CancellationViolationStatus;
  appealId: string | null;
  sourceCollection: CancellationSourceCollection;
  sourceId: string;
  sourceCategory: string;
  scheduledDepartureSeconds: number;
  hoursBeforeDeparture: number;
  lateCancellation: boolean;
  adminExcused: boolean;
  excusedAtSeconds: number | null;
  excusedBy: string | null;
  excuseReason: string | null;
  triggeredWarningLevel: number | null;
  createdAtSeconds: number;
};

const toSeconds = (value: unknown): number => {
  const timestamp = value as { seconds?: number } | undefined;
  return timestamp?.seconds || 0;
};

const normalizeViolation = (id: string, data: Record<string, any>): DriverCancellationViolation => ({
  id,
  driverId: data.driverId || "",
  tripId: data.tripId || data.sourceId || "",
  violationType: CANCELLATION_VIOLATION_TYPE,
  active: data.active !== false,
  status: (data.status as CancellationViolationStatus) || "open",
  appealId: data.appealId || null,
  sourceCollection: data.sourceCollection || "bookings",
  sourceId: data.sourceId || "",
  sourceCategory: data.sourceCategory || "",
  scheduledDepartureSeconds: toSeconds(data.scheduledDeparture),
  hoursBeforeDeparture: typeof data.hoursBeforeDeparture === "number" ? data.hoursBeforeDeparture : 0,
  lateCancellation: data.lateCancellation === true,
  adminExcused: data.adminExcused === true,
  excusedAtSeconds: data.excusedAt ? toSeconds(data.excusedAt) : null,
  excusedBy: data.excusedBy || null,
  excuseReason: data.excuseReason || null,
  triggeredWarningLevel: typeof data.triggeredWarningLevel === "number" ? data.triggeredWarningLevel : null,
  createdAtSeconds: toSeconds(data.createdAt),
});

export const subscribeDriverCancellationViolations = (
  driverId: string,
  onUpdate: (rows: DriverCancellationViolation[]) => void,
  onError: (error: unknown) => void,
): (() => void) => {
  return onSnapshot(
    query(collection(db, "users", driverId, "cancellationViolations"), orderBy("createdAt", "desc")),
    (snap) => {
      onUpdate(snap.docs.map((d) => normalizeViolation(d.id, d.data())));
    },
    onError,
  );
};

export type DriverCancellationStanding = CancellationStanding;

// Shared by getDriverCancellationStanding below and adminUsersLib.ts's
// normalizeAdminUser, so the admin driver list/detail screens read the same
// shape without a second Firestore fetch.
export const normalizeCancellationStanding = (
  data: Record<string, any> | null | undefined,
): CancellationStanding => ({
  ...EMPTY_STANDING,
  ...(data?.cancellationStanding || null),
});

export const getDriverCancellationStanding = async (
  driverId: string,
): Promise<CancellationStanding> => {
  const snap = await getDoc(doc(db, "users", driverId));
  return normalizeCancellationStanding(snap.exists() ? snap.data() : null);
};
