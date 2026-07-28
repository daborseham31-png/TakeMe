// ---------------------------------------------------------------------------
// Real passenger GPS sharing — lets the driver navigate to the passenger's
// ACTUAL current position (foreground, live) instead of a manual pickup
// point saved once at booking-creation time (that old feature has been
// removed — see app/booking/CurrentLocationButton.tsx's removal). A thin
// wrapper around foregroundLocationTracker.ts's shared watch/write
// implementation — see that file for the actual watchPositionAsync setup
// and the foreground-only/no-background rationale; this module adds no
// tracking logic of its own.
//
// Location lives in its own `passengerLocations` collection (never on the
// wide-open bookings doc) so firestore.rules can restrict reads to exactly
// the passenger themselves and the assigned driver — mirrors tripLocations'
// own reasoning (see driverLocationTask.ts) but in the opposite direction.
//
// Lifecycle (see app/(tabs)/_layout.tsx, the one place this is started/
// stopped from): sharing runs only while the passenger has the app open AND
// their ride is still waiting for the driver to arrive (status/tripStatus
// "booked" or "on_the_way"/"driver_on_way") — it stops the moment the
// driver arrives, the trip starts, the booking is cancelled, it's
// completed, or the signed-in user changes. Deliberately owned by the tab
// layout rather than the My Bookings screen: that screen unmounts on every
// tab switch (Home/Messages/Profile), which would otherwise cut sharing
// off mid-trip just for navigating away from that one tab. Still
// foreground-only — never runs with the app closed.
// ---------------------------------------------------------------------------

import { createForegroundLocationTracker } from "./foregroundLocationTracker";

export const PASSENGER_LOCATIONS_COLLECTION = "passengerLocations";

// passengerLocations/{targetId} — targetId is the bookingId (same id
// tripLocations uses for Personal Ride), so both collections key off the
// exact same document identity for a given ride.
export type PassengerTrackingTarget = {
  targetId: string;
  passengerId: string;
  driverId: string;
};

const tracker = createForegroundLocationTracker(PASSENGER_LOCATIONS_COLLECTION);

export const startPassengerLocationTracking = (target: PassengerTrackingTarget) =>
  tracker.start(target);

export const stopPassengerLocationTracking = (): Promise<void> => tracker.stop();

// A one-off immediate fix, written the moment sharing starts, so the
// driver's navigation button has a real coordinate right away instead of
// waiting for the first timeInterval/distanceInterval tick.
export const capturePassengerLocationOnce = (target: PassengerTrackingTarget): Promise<void> =>
  tracker.captureOnce(target);
