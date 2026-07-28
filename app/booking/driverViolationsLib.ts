// ---------------------------------------------------------------------------
// Driver cancellation violations + suspension.
//
// A violation is recorded whenever a driver (never a passenger, never an
// admin) cancels a trip that already has at least one real, confirmed
// passenger booking on it. The driver sees a warning BEFORE every single
// valid cancellation (1st through 6th+), fetched fresh from Firestore right
// before the confirmation is shown — see getDriverCancellationWarningPreview
// below, used by the pre-cancellation confirm/warning modal in
// app/(tabs)/bookings.tsx and app/booking/school/useMySchoolRows.tsx. The
// 6th violation in a rolling 30-day window suspends the driver from
// posting/accepting/starting trips (never a full account lockout — see
// getDriverSuspensionBlockedReason) — NOT the 5th (an earlier version of
// this system suspended on the 5th; that threshold is gone, see
// evaluateDriverCancellationStanding below). A suspension is never auto-lifted; only
// an admin can lift one, via liftDriverCancellationSuspension. Repeat
// offenders escalate: 1st suspension = 7 days, 2nd (within 60 days of the
// previous lift) = 30 days, 3rd = indefinite. More than 60 clean days after a
// lift resets the ladder back to a 7-day suspension.
//
// TRUST MODEL — read this before touching a call site: this project's
// Firebase plan (Spark) cannot deploy ANY Cloud Function (confirmed live:
// `firebase deploy --only functions --dry-run` fails with "must be on the
// Blaze plan" — see functions/index.js's own header for the same limitation
// on an earlier feature). So this still runs as the driver's own
// authenticated client, secured by firestore.rules (a driver can never
// create/edit their OWN violation docs directly — see isValidDriverReview's
// sibling rules below — and isValidSelfViolationStandingUpdate is what keeps
// a driver from ever un-suspending themselves). What CAN be closed
// client-side: the violation doc is now written inside the exact SAME
// Firestore transaction as the cancellation itself (see
// readExistingCancellationViolation/writeCancellationViolationIfNew below),
// so a client can no longer complete a cancellation while skipping the
// violation — either both happen atomically, or neither does. What can NOT
// be fully closed without Blaze: a modified client could still skip the
// separate, best-effort evaluateDriverCancellationStanding() call that
// counts/warns/suspends after the transaction commits. That call is safe to
// re-run from anywhere (it only ever reads fresh + recomputes), so it's
// invoked after every single cancellation site AND opportunistically by the
// admin screen's own live listener — never a single point of failure.
//
// Call sites that bundle the violation write into their own cancellation
// transaction (only when the cancelled trip had a real booking,
// cancelledBy === "driver"):
//   - rideBookingLib.ts             cancelRideBooking
//   - bookingsLib.ts                cancelGeneralBooking
//   - schoolTripsLib.ts             cancelSchoolTrip
//   - work-errand/workErrandLib.ts  cancelApplication
//   - (tabs)/bookings.tsx           cancelDriverTrip (driverRoutes/workJobs/errandJobs)
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
import { DRIVER_CANCEL_LOCK_HOURS } from "./cancellationEligibility";
import {
  cancellationViolationId,
  cancellationViolationRef,
  CancellationSourceCollection,
  LATE_CANCELLATION_HOURS,
  readExistingCancellationViolation,
  RecordDriverCancellationViolationInput,
  writeCancellationViolationIfNew,
} from "./driverViolationCore";
import { notify } from "./work-errand/workErrandLib";
import { writeAuditLog } from "../admin/adminAuditLib";

// Re-exported so every existing call site's import path keeps working
// unchanged — the actual definitions moved to driverViolationCore.ts (see
// that file's own header for why: workErrandLib.ts's cancelApplication also
// needs these two transaction-phase functions, and importing them from THIS
// file would be a circular import, since this file already imports notify()
// FROM workErrandLib.ts).
export {
  cancellationViolationId,
  cancellationViolationRef,
  DRIVER_CANCEL_LOCK_HOURS,
  LATE_CANCELLATION_HOURS,
  readExistingCancellationViolation,
  writeCancellationViolationIfNew,
};
export type { CancellationSourceCollection, RecordDriverCancellationViolationInput };

export const ROLLING_WINDOW_DAYS = 30;
export const REPEAT_OFFENSE_WINDOW_DAYS = 60;
const SUSPENSION_MIN_DURATION_DAYS: Record<number, number | null> = {
  1: 7,
  2: 30,
  3: null,
};

// Admin exception reasons — a fixed, translated preset list (plus a free-text
// "other") so an excuse always records a real, auditable category instead of
// arbitrary text. Values are stable keys (never translated strings) so
// existing violation docs stay valid if a label's wording ever changes.
export const ADMIN_EXCUSE_REASONS = [
  "vehicle_breakdown",
  "accident_or_medical",
  "weather_or_road_closure",
  "app_technical_problem",
  "other",
] as const;

export type AdminExcuseReasonKey = (typeof ADMIN_EXCUSE_REASONS)[number];

export const ADMIN_EXCUSE_REASON_LABEL_KEY: Record<AdminExcuseReasonKey, string> = {
  vehicle_breakdown: "admin.excuseReasonVehicleBreakdown",
  accident_or_medical: "admin.excuseReasonAccidentOrMedical",
  weather_or_road_closure: "admin.excuseReasonWeatherOrRoadClosure",
  app_technical_problem: "admin.excuseReasonAppTechnicalProblem",
  other: "admin.excuseReasonOther",
};

const daysToMs = (days: number) => days * 24 * 60 * 60 * 1000;

export type CancellationStanding = {
  suspensionActive: boolean;
  suspensionTier: 0 | 1 | 2 | 3;
  suspensionMinDurationDays: 7 | 30 | null;
  suspensionStartAt: Timestamp | null;
  suspensionMinEndAt: Timestamp | null;
  suspensionReason: string;
  suspensionCount: number;
  // Explicit, admin-screen-friendly flags — all three are technically
  // derivable from the fields above (indefinite === !suspensionMinDurationDays,
  // manualReviewRequired === suspensionActive, suspendedBy is always "system"
  // for this ladder, since only liftDriverCancellationSuspension — always
  // admin-initiated — ever sets suspensionActive back to false), but stored
  // directly so the admin screen (and any future consumer) never has to
  // re-derive them.
  manualReviewRequired: boolean;
  indefinite: boolean;
  suspendedBy: "system" | null;
  lastSuspensionLiftedAt: Timestamp | null;
  // Set by liftDriverCancellationSuspension — the start of the CURRENT
  // "clean" window used for the 60-day repeat-offense rule (item 6).
  reinstatedAt: Timestamp | null;
  updatedAt: unknown;
};

const EMPTY_STANDING: CancellationStanding = {
  suspensionActive: false,
  suspensionTier: 0,
  suspensionMinDurationDays: null,
  suspensionStartAt: null,
  suspensionMinEndAt: null,
  suspensionReason: "",
  suspensionCount: 0,
  manualReviewRequired: false,
  indefinite: false,
  suspendedBy: null,
  lastSuspensionLiftedAt: null,
  reinstatedAt: null,
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

export type CancellationStandingResult = {
  // 1-based position of the violation that was just created within the
  // rolling 30-day window (never counting excused ones) — null if this
  // evaluation ran without a new violation actually having been created.
  violationLevel: number | null;
  // The pre-cancellation warning modal (see getDriverCancellationWarningPreview
  // below) is now the ONE place 1st-through-6th+ messaging is shown, BEFORE
  // the driver confirms — so this post-cancellation result only ever needs
  // to report whether the account just became suspended (the one state
  // change that happens AFTER confirmation, on the 6th violation). "none"
  // covers every non-suspending outcome (1st-5th, or a duplicate/no-op).
  warning: "none" | "suspended";
};

// Best-effort — always safe to call again from anywhere (admin screen,
// another cancellation, ...), since it only ever reads fresh state and
// recomputes; never assumes it's the only place that could have run this.
// Call AFTER the cancellation transaction (which already wrote the
// violation) commits — never inside it, since this performs a query
// (Firestore transactions only support get-by-reference, not queries).
export const evaluateDriverCancellationStanding = async (
  driverId: string,
): Promise<CancellationStandingResult> => {
  const now = Date.now();
  const violationsRef = collection(db, "users", driverId, "cancellationViolations");
  const windowStart = Timestamp.fromMillis(now - daysToMs(ROLLING_WINDOW_DAYS));
  const recentSnap = await getDocs(
    query(violationsRef, where("adminExcused", "==", false), where("createdAt", ">=", windowStart)),
  );
  const violationLevel = recentSnap.size;

  const driverSnap = await getDoc(doc(db, "users", driverId));
  const standing: CancellationStanding = {
    ...EMPTY_STANDING,
    ...(driverSnap.exists() ? driverSnap.data()?.cancellationStanding : null),
  };

  // A driver already suspended can still have older, not-yet-processed
  // cancellations trickle in — never re-notify or re-escalate for those.
  if (standing.suspensionActive) {
    return { violationLevel, warning: "suspended" };
  }

  // Suspension now triggers on the 6th valid violation within the rolling
  // 30-day window — NOT the 5th (see this file's own header). 1st-5th are
  // fully handled by the pre-cancellation warning modal the driver already
  // saw and explicitly confirmed through (getDriverCancellationWarningPreview
  // below); there is nothing further to notify here for those.
  if (violationLevel >= 6) {
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
        manualReviewRequired: true,
        indefinite: !minDurationDays,
        suspendedBy: "system",
        lastSuspensionLiftedAt: standing.lastSuspensionLiftedAt,
        reinstatedAt: standing.reinstatedAt,
        updatedAt: serverTimestamp(),
      },
      updatedAt: serverTimestamp(),
    });

    await notify({
      receiverId: driverId,
      type: "driver_cancellation_suspended",
      title: i18n.t("driver.accountSuspendedTitle"),
      message: minDurationDays
        ? i18n.t("driver.cancellationSuspensionBlockedMessage")
        : i18n.t("driver.cancellationSuspensionIndefiniteMessage"),
      targetTab: "driver",
    });

    return { violationLevel, warning: "suspended" };
  }

  return { violationLevel, warning: "none" };
};

// Non-transactional convenience wrapper — ONLY for a call site that genuinely
// cannot bundle the write into its own transaction. Every current call site
// bundles it directly (see this file's header); prefer
// readExistingCancellationViolation/writeCancellationViolationIfNew inside
// your own transaction instead of adding a new caller here.
export const recordDriverCancellationViolation = async (
  input: RecordDriverCancellationViolationInput,
): Promise<CancellationStandingResult> => {
  const violationRef = cancellationViolationRef(
    input.driverId,
    input.sourceCollection,
    input.sourceId,
  );
  const existing = await getDoc(violationRef);

  if (input.passengerBookingCount <= 0 || existing.exists()) {
    return { violationLevel: null, warning: "none" };
  }

  const now = Date.now();
  const hoursBeforeDeparture = (input.scheduledDeparture.getTime() - now) / (60 * 60 * 1000);
  const lateCancellation = hoursBeforeDeparture < LATE_CANCELLATION_HOURS;

  await setDoc(violationRef, {
    driverId: input.driverId,
    sourceCollection: input.sourceCollection,
    sourceId: input.sourceId,
    sourceCategory: input.sourceCategory,
    scheduledDeparture: Timestamp.fromDate(input.scheduledDeparture),
    hoursBeforeDeparture,
    passengerBookingCount: input.passengerBookingCount,
    lateCancellation,
    cancelledBy: "driver",
    adminExcused: false,
    excusedAt: null,
    excusedBy: null,
    excuseReason: null,
    triggeredWarningLevel: null,
    createdAt: serverTimestamp(),
  });

  return evaluateDriverCancellationStanding(input.driverId);
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

  return standing.suspensionMinDurationDays
    ? i18n.t("driver.cancellationSuspensionBlockedMessage")
    : i18n.t("driver.cancellationSuspensionIndefiniteMessage");
};

// ---------------------------------------------------------------------------
// Pre-cancellation warning modal — shown BEFORE a driver's cancellation of a
// trip that has at least one real passenger booking is ever executed (never
// after the fact). "level" maps 1:1 onto the exact 6 required wordings; see
// CANCELLATION_WARNING_MESSAGE_KEY below and the two call sites:
// app/(tabs)/bookings.tsx's confirmDriverCancellation and
// app/booking/school/useMySchoolRows.tsx's handleCancelTrip.
// ---------------------------------------------------------------------------

export type CancellationWarningLevel =
  | "first"
  | "remaining3"
  | "remaining2"
  | "remaining1"
  | "final"
  | "willSuspend";

export type CancellationWarningPreview = {
  // The driver's current valid (non-excused, last-30-days) violation count
  // BEFORE this pending cancellation — read fresh from Firestore every time,
  // never from local/cached state (item 3).
  currentCount: number;
  // What the count WOULD become if the driver confirms — currentCount + 1.
  newCount: number;
  level: CancellationWarningLevel;
};

const warningLevelForNewCount = (newCount: number): CancellationWarningLevel => {
  if (newCount <= 1) return "first";
  if (newCount === 2) return "remaining3";
  if (newCount === 3) return "remaining2";
  if (newCount === 4) return "remaining1";
  if (newCount === 5) return "final";
  return "willSuspend";
};

// The one translated message key for each level — the EXACT wordings
// required (see AGENTS.md-adjacent task spec): 1st explains the whole 5-per-
// 30-days policy; 2nd-4th just state the updated remaining count; 5th is the
// final warning; 6th+ says confirming will suspend the account.
export const CANCELLATION_WARNING_MESSAGE_KEY: Record<CancellationWarningLevel, string> = {
  first: "driver.cancellationPreWarningFirst",
  remaining3: "driver.cancellationPreWarningRemaining3",
  remaining2: "driver.cancellationPreWarningRemaining2",
  remaining1: "driver.cancellationPreWarningRemaining1",
  final: "driver.cancellationPreWarningFinal",
  willSuspend: "driver.cancellationPreWarningWillSuspend",
};

// Reads the driver's current valid 30-day violation count FRESH from
// Firestore (the same query evaluateDriverCancellationStanding/
// getCurrentValidViolationCount run) and computes what the pre-cancellation
// warning modal should say — calculated BEFORE the new violation is ever
// created, so the "remaining" number the driver sees always reflects the
// world as it is right now, never a stale local count (item 3).
export const getDriverCancellationWarningPreview = async (
  driverId: string,
): Promise<CancellationWarningPreview> => {
  const currentCount = await getCurrentValidViolationCount(driverId);
  const newCount = currentCount + 1;
  return { currentCount, newCount, level: warningLevelForNewCount(newCount) };
};

// ---------------------------------------------------------------------------
// Admin-only
// ---------------------------------------------------------------------------

export const excuseDriverCancellationViolation = async (
  driverId: string,
  violationId: string,
  reasonKey: AdminExcuseReasonKey,
  note: string,
): Promise<void> => {
  const adminUid = auth.currentUser?.uid || null;

  await updateDoc(doc(db, "users", driverId, "cancellationViolations", violationId), {
    adminExcused: true,
    excusedAt: serverTimestamp(),
    excusedBy: adminUid,
    excuseReason: reasonKey,
    excuseNote: note || "",
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
    reason: `${reasonKey}${note ? `: ${note}` : ""}`,
  });
};

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

  if (standing.suspensionMinEndAt && standing.suspensionMinEndAt.toMillis() > Date.now()) {
    throw new Error(i18n.t("admin.liftSuspensionTooEarlyMessage"));
  }

  await updateDoc(doc(db, "users", driverId), {
    cancellationStanding: {
      ...standing,
      suspensionActive: false,
      manualReviewRequired: false,
      lastSuspensionLiftedAt: serverTimestamp(),
      // The start of a fresh "clean" window for item 6's 60-day repeat-
      // offense rule — a new 5-violation run within 60 days of THIS date
      // escalates to the next suspension tier.
      reinstatedAt: serverTimestamp(),
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
  sourceCollection: CancellationSourceCollection;
  sourceId: string;
  sourceCategory: string;
  scheduledDepartureSeconds: number;
  hoursBeforeDeparture: number;
  passengerBookingCount: number;
  lateCancellation: boolean;
  adminExcused: boolean;
  excusedAtSeconds: number | null;
  excusedBy: string | null;
  excuseReason: string | null;
  excuseNote: string | null;
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
  sourceCollection: data.sourceCollection || "bookings",
  sourceId: data.sourceId || "",
  sourceCategory: data.sourceCategory || "",
  scheduledDepartureSeconds: toSeconds(data.scheduledDeparture),
  hoursBeforeDeparture: typeof data.hoursBeforeDeparture === "number" ? data.hoursBeforeDeparture : 0,
  passengerBookingCount:
    typeof data.passengerBookingCount === "number" ? data.passengerBookingCount : 0,
  lateCancellation: data.lateCancellation === true,
  adminExcused: data.adminExcused === true,
  excusedAtSeconds: data.excusedAt ? toSeconds(data.excusedAt) : null,
  excusedBy: data.excusedBy || null,
  excuseReason: data.excuseReason || null,
  excuseNote: data.excuseNote || null,
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

// Current valid (non-excused) violation count within the rolling 30-day
// window — the SAME query evaluateDriverCancellationStanding runs, exposed
// standalone so the admin screen can display "current valid 30-day count"
// (item 9) without waiting for another cancellation to happen.
export const getCurrentValidViolationCount = async (driverId: string): Promise<number> => {
  const windowStart = Timestamp.fromMillis(Date.now() - daysToMs(ROLLING_WINDOW_DAYS));
  const snap = await getDocs(
    query(
      collection(db, "users", driverId, "cancellationViolations"),
      where("adminExcused", "==", false),
      where("createdAt", ">=", windowStart),
    ),
  );
  return snap.size;
};

// Valid (non-excused) violation count since the driver's most recent
// reinstatement (item 9's "count since the most recent reinstatement") —
// null reinstatedAt (never suspended before) means "since account creation",
// i.e. every valid violation on file.
export const getValidViolationCountSinceReinstatement = async (
  driverId: string,
  reinstatedAt: Timestamp | null,
): Promise<number> => {
  const constraints = [where("adminExcused", "==", false)];
  if (reinstatedAt) {
    constraints.push(where("createdAt", ">=", reinstatedAt));
  }

  const snap = await getDocs(
    query(collection(db, "users", driverId, "cancellationViolations"), ...constraints),
  );
  return snap.size;
};
