// ---------------------------------------------------------------------------
// Dependency-free core of the driver cancellation-violation system — the
// deterministic violation ref/id and the two transaction-phase functions
// every cancellation transaction bundles the violation write into (see
// driverViolationsLib.ts's own header for why this must never be a separate,
// skippable step).
//
// Deliberately its own file, with NO import of notify()/i18n
// (work-errand/workErrandLib.ts), for the exact same reason
// cancellationEligibility.ts is its own dependency-free file: workErrandLib.ts
// itself needs these two transaction-phase functions for cancelApplication,
// and driverViolationsLib.ts (which DOES need notify() for the 3rd/4th/5th
// warnings) also needs them — if they lived only in driverViolationsLib.ts,
// workErrandLib.ts importing from there would be a circular import
// (driverViolationsLib.ts -> workErrandLib.ts -> driverViolationsLib.ts).
// Living here instead lets both import this file directly with no cycle.
// See driverViolationsLib.ts, which re-exports everything below for every
// OTHER existing call site so their import path never had to change.
// ---------------------------------------------------------------------------

import {
  doc,
  DocumentSnapshot,
  serverTimestamp,
  Timestamp,
  Transaction,
} from "firebase/firestore";

import { db } from "../../firebase";

export type CancellationSourceCollection =
  | "bookings"
  | "driverRoutes"
  | "workJobs"
  | "errandJobs"
  | "schoolTrips";

export const LATE_CANCELLATION_HOURS = 24;

export type RecordDriverCancellationViolationInput = {
  driverId: string;
  sourceCollection: CancellationSourceCollection;
  sourceId: string;
  sourceCategory: string;
  scheduledDeparture: Date;
  // The real, confirmed passenger-booking count for THIS specific trip —
  // never derived from remaining/available seats. A zero-booking trip never
  // creates a violation.
  passengerBookingCount: number;
};

// The one deterministic id every violation for a given cancelled
// booking/trip/application always resolves to — this is what makes a second
// cancellation attempt for the SAME source doc a guaranteed no-op rather than
// a duplicate violation.
export const cancellationViolationId = (
  sourceCollection: CancellationSourceCollection,
  sourceId: string,
) => `${sourceCollection}__${sourceId}`;

export const cancellationViolationRef = (
  driverId: string,
  sourceCollection: CancellationSourceCollection,
  sourceId: string,
) =>
  doc(
    db,
    "users",
    driverId,
    "cancellationViolations",
    cancellationViolationId(sourceCollection, sourceId),
  );

// Call during the caller's PHASE 1, alongside its other transaction.get()s.
export const readExistingCancellationViolation = (
  transaction: Transaction,
  driverId: string,
  sourceCollection: CancellationSourceCollection,
  sourceId: string,
): Promise<DocumentSnapshot> =>
  transaction.get(cancellationViolationRef(driverId, sourceCollection, sourceId));

// Call during the caller's PHASE 2, alongside its other writes. Pass the
// EXACT snapshot readExistingCancellationViolation returned above (never a
// fresh get() here — that would violate the transaction's own read-before-
// write ordering). Returns whether a NEW violation was written, so the
// caller knows whether to run evaluateDriverCancellationStanding afterward.
export const writeCancellationViolationIfNew = (
  transaction: Transaction,
  existingSnap: DocumentSnapshot,
  input: RecordDriverCancellationViolationInput,
): boolean => {
  // Zero real bookings -> never a violation, regardless of anything else —
  // the caller should still normally skip calling this at all in that case,
  // but this is the hard backstop.
  if (input.passengerBookingCount <= 0) return false;
  // Duplicate guard — a violation for this exact cancelled source already
  // exists (a retried/duplicate cancellation attempt, or the doc genuinely
  // already got created earlier) — idempotent no-op.
  if (existingSnap.exists()) return false;

  const now = Date.now();
  const hoursBeforeDeparture = (input.scheduledDeparture.getTime() - now) / (60 * 60 * 1000);
  // By the time this runs, the caller has already enforced the 5-hour
  // cancellation cutoff, so this only ever distinguishes "more than 24h
  // notice" from "5-24h notice" — never a second violation for the same
  // cancellation, just one boolean flag on the one violation this writes.
  const lateCancellation = hoursBeforeDeparture < LATE_CANCELLATION_HOURS;

  transaction.set(existingSnap.ref, {
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

  return true;
};
