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

// The trip/listing-level status written when a driver cancels a WHOLE
// published trip/job listing (driverRoutes/workJobs/errandJobs) outright —
// distinct from the generic "cancelled" value used on individual bookings/
// applications (which already means "cancelled" regardless of who initiated
// it), so a driver-initiated listing cancellation is never ambiguous with,
// say, a passenger cancelling their own single booking. See
// isCancelledTripStatus below for the one shared check every public/search/
// no-show query should use instead of re-deriving this policy per call site.
export const DRIVER_CANCELLED_TRIP_STATUS = "cancelled_by_driver" as const;

// True for any trip/listing `status` value that means "no longer bookable
// because it was cancelled" — covers both the pre-existing generic
// "cancelled" value (still used by schoolTrips and by a driver-cancelled
// whole-route booking) and the driver-specific listing status above. Every
// public/search/nearby/no-show query that excludes cancelled trips should
// use this one function rather than re-listing the literal strings, so the
// exclusion policy can never drift out of sync between categories.
export const isCancelledTripStatus = (status: unknown): boolean =>
  status === "cancelled" || status === DRIVER_CANCELLED_TRIP_STATUS;

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

// Every violation this writes is also readable from the driver's Violations
// screen (see driverNoShowLib.ts's DriverViolation shape, which the screen's
// merged list also renders this against) — "driver_cancellation" distinguishes
// it from that OTHER system's own "driver_no_show" violations, since the two
// are merged into one combined list/count there.
export const CANCELLATION_VIOLATION_TYPE = "driver_cancellation" as const;

// Mirrors the no-show system's own ViolationStatus exactly (see
// driverNoShowLib.ts) — this is what lets the driver-facing Violations tab
// and the appeal-submission/approve/reject flow (see driverNoShowLib.ts's
// submitViolationAppeal, driverViolationsLib.ts's
// approveCancellationViolationAppeal/rejectCancellationViolationAppeal) treat
// both violation systems with the exact same state machine.
export type CancellationViolationStatus = "open" | "appeal_pending" | "appeal_approved" | "appeal_rejected";

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
  const violationId = cancellationViolationId(input.sourceCollection, input.sourceId);

  // Zero real bookings -> never a violation, regardless of anything else —
  // the caller should still normally skip calling this at all in that case,
  // but this is the hard backstop.
  if (input.passengerBookingCount <= 0) {
    console.log("writeCancellationViolationIfNew: skipped (zero active bookings)", {
      violationId,
      driverId: input.driverId,
      sourceCollection: input.sourceCollection,
      sourceId: input.sourceId,
      passengerBookingCount: input.passengerBookingCount,
    });
    return false;
  }
  // Duplicate guard — a violation for this exact cancelled source already
  // exists (a retried/duplicate cancellation attempt, or the doc genuinely
  // already got created earlier) — idempotent no-op.
  if (existingSnap.exists()) {
    console.log("writeCancellationViolationIfNew: skipped (violation already exists — duplicate guard)", {
      violationId,
      driverId: input.driverId,
      sourceCollection: input.sourceCollection,
      sourceId: input.sourceId,
    });
    return false;
  }

  const now = Date.now();
  const hoursBeforeDeparture = (input.scheduledDeparture.getTime() - now) / (60 * 60 * 1000);
  // By the time this runs, the caller has already enforced the 5-hour
  // cancellation cutoff, so this only ever distinguishes "more than 24h
  // notice" from "5-24h notice" — never a second violation for the same
  // cancellation, just one boolean flag on the one violation this writes.
  const lateCancellation = hoursBeforeDeparture < LATE_CANCELLATION_HOURS;

  transaction.set(existingSnap.ref, {
    driverId: input.driverId,
    // Named the same as the no-show system's own DriverViolation.tripId (see
    // driverNoShowLib.ts) so the Violations screen's merged list can read
    // "the trip/listing this violation is about" with one shared field name
    // regardless of which of the two systems produced it — sourceId/
    // sourceCollection remain the source of truth for THIS system's own
    // reads (evaluateDriverCancellationStanding etc.), unchanged.
    tripId: input.sourceId,
    sourceCollection: input.sourceCollection,
    sourceId: input.sourceId,
    sourceCategory: input.sourceCategory,
    // Distinguishes this from a "driver_no_show" violation once merged into
    // the same on-screen list — see CANCELLATION_VIOLATION_TYPE above.
    violationType: CANCELLATION_VIOLATION_TYPE,
    // Mirrors adminExcused's inverse at creation time (always true here —
    // adminExcused is always false on create, see the rules-enforced create
    // check in firestore.rules) — kept in sync going forward by
    // excuseDriverCancellationViolation, which flips both together.
    active: true,
    // Appeal state — same shape/values as the no-show system's own `status`/
    // `appealId` on DriverViolation, so canSubmitAppeal (driverNoShowCore.ts)
    // and the shared appeal UI work identically for both.
    status: "open" as CancellationViolationStatus,
    appealId: null,
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

  console.log("writeCancellationViolationIfNew: violation created", {
    violationId,
    driverId: input.driverId,
    sourceCollection: input.sourceCollection,
    sourceId: input.sourceId,
    passengerBookingCount: input.passengerBookingCount,
    lateCancellation,
  });

  return true;
};
