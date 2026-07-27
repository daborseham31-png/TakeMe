// ---------------------------------------------------------------------------
// Real driver GPS tracking for an active trip — the ONE place location
// updates are collected and written, for BOTH Personal Ride (bookings) and
// School Trips. A thin wrapper around foregroundLocationTracker.ts's shared
// watch/write implementation — see that file for the actual
// watchPositionAsync setup and the foreground-only/no-background rationale.
//
// Location lives in its own `tripLocations` collection (never on the
// public/searchable schoolTrips or the wide-open bookings doc) so Firestore
// rules can restrict reads to exactly the assigned driver + authorized
// passenger(s) — see firestore.rules and verifyPassengerCodeAndStartTrip in
// schoolTripsLib.ts (which is what authorizes a passenger for a school
// trip's shared location doc the moment their own trip starts).
// ---------------------------------------------------------------------------

import { createForegroundLocationTracker } from "./foregroundLocationTracker";

// tripLocations/{targetId} — targetId is the bookingId for Personal Ride,
// or the tripId for School Trips (one shared car, one doc, several
// authorized passengers — see firestore.rules).
type TrackingTarget = {
  targetId: string;
  driverId: string;
  // Personal Ride only — School Trips authorizes passengers separately
  // inside verifyPassengerCodeAndStartTrip, never a single fixed id here.
  passengerId?: string;
};

const tracker = createForegroundLocationTracker("tripLocations");

export const startDriverLocationTracking = (target: TrackingTarget) => tracker.start(target);

export const stopDriverLocationTracking = (): Promise<void> => tracker.stop();

// A one-off immediate fix, written the moment tracking starts, so the
// passenger's map has a marker right away instead of waiting for the first
// timeInterval/distanceInterval tick.
export const captureDriverLocationOnce = (target: TrackingTarget): Promise<void> =>
  tracker.captureOnce(target);
