// ---------------------------------------------------------------------------
// Real driver GPS tracking for an active trip — the ONE place location
// updates are collected and written, for BOTH Personal Ride (bookings) and
// School Trips.
//
// Foreground-only, by design: this app is tested exclusively in Expo Go,
// which cannot run a headless background location task under any
// configuration (Location.startLocationUpdatesAsync always throws there).
// There is deliberately no background/TaskManager code path, no
// AsyncStorage-based restoration-on-relaunch logic, and no foreground-service
// configuration anywhere in this file — tracking exists only for as long as
// this JS process is alive and the driver keeps the app open, via a single
// Location.watchPositionAsync subscription. If a real background mode is
// ever needed later (a custom dev-client/EAS build), that is a deliberate
// future addition, not something to silently reintroduce here.
//
// Location lives in its own `tripLocations` collection (never on the
// public/searchable schoolTrips or the wide-open bookings doc) so Firestore
// rules can restrict reads to exactly the assigned driver + authorized
// passenger(s) — see firestore.rules and verifyPassengerCodeAndStartTrip in
// schoolTripsLib.ts (which is what authorizes a passenger for a school
// trip's shared location doc the moment their own trip starts).
// ---------------------------------------------------------------------------

import * as Location from "expo-location";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";

import { db } from "../firebase";

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

// Shared by the watchPositionAsync callback and captureDriverLocationOnce —
// exactly one place writes a location fix to Firestore.
const writeLocationFix = async (
  target: TrackingTarget,
  coords: {
    latitude: number;
    longitude: number;
    heading?: number | null;
    speed?: number | null;
    accuracy?: number | null;
  },
): Promise<void> => {
  await setDoc(
    doc(db, "tripLocations", target.targetId),
    {
      driverId: target.driverId,
      ...(target.passengerId ? { passengerId: target.passengerId } : {}),
      latitude: coords.latitude,
      longitude: coords.longitude,
      heading: coords.heading ?? null,
      speed: coords.speed ?? null,
      accuracy: coords.accuracy ?? null,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
};

// In-memory only, on purpose — no persistence/restoration across app
// relaunches (see file header). Exactly one subscription can exist at a
// time, for exactly one target.
let activeTarget: TrackingTarget | null = null;
let subscription: Location.LocationSubscription | null = null;

// De-dupes concurrent callers: ride-navigation's effect can legitimately
// re-run twice within milliseconds of each other (its own booking listener
// AND the schoolPassengerBookings listener can each fire separately right
// after passenger verification), which would otherwise race two independent
// watchPositionAsync subscriptions against each other.
let startPromise: Promise<{ started: boolean; reason?: "foreground_denied" }> | null = null;

export const startDriverLocationTracking = (
  target: TrackingTarget,
): Promise<{ started: boolean; reason?: "foreground_denied" }> => {
  if (startPromise) {
    return startPromise;
  }

  startPromise = doStartDriverLocationTracking(target).finally(() => {
    startPromise = null;
  });

  return startPromise;
};

const doStartDriverLocationTracking = async (
  target: TrackingTarget,
): Promise<{ started: boolean; reason?: "foreground_denied" }> => {
  if (subscription && activeTarget?.targetId === target.targetId) {
    // Already tracking exactly this trip — nothing to do.
    return { started: true };
  }

  // Switching to a different target (or re-subscribing) always fully stops
  // the previous subscription first, so a location update from one trip can
  // never land on another trip's document.
  if (subscription) {
    subscription.remove();
    subscription = null;
  }
  activeTarget = null;

  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted") {
    return { started: false, reason: "foreground_denied" };
  }

  try {
    activeTarget = target;
    subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 4000,
        distanceInterval: 8,
      },
      (location) => {
        writeLocationFix(target, location.coords).catch((error) => {
          console.log("driverLocationTask: could not write location", error);
        });
      },
    );

    return { started: true };
  } catch (error) {
    console.log("startDriverLocationTracking failed", error);
    activeTarget = null;
    subscription = null;
    return { started: false, reason: "foreground_denied" };
  }
};

export const stopDriverLocationTracking = async (): Promise<void> => {
  if (subscription) {
    subscription.remove();
    subscription = null;
  }
  activeTarget = null;
};

// A one-off immediate fix, written the moment tracking starts, so the
// passenger's map has a marker right away instead of waiting for the first
// timeInterval/distanceInterval tick.
export const captureDriverLocationOnce = async (target: TrackingTarget): Promise<void> => {
  try {
    const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    await writeLocationFix(target, current.coords);
  } catch (error) {
    console.log("captureDriverLocationOnce failed", error);
  }
};
