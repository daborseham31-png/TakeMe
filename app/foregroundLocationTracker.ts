// ---------------------------------------------------------------------------
// Shared foreground-only GPS watcher factory — the ONE place a
// Location.watchPositionAsync subscription is ever created/torn down in
// this app. Both driverLocationTask.ts (the driver's own live location, for
// the passenger's Live Tracking map) and passengerLocationTask.ts (the
// passenger's own live location, for the driver's navigation-to-pickup
// button) are thin wrappers around createForegroundLocationTracker below —
// neither re-implements the watch/write logic itself, so there is exactly
// one foreground-tracking implementation in the whole project.
//
// Foreground-only, by design: this app is tested exclusively in Expo Go,
// which cannot run a headless background location task under any
// configuration (Location.startLocationUpdatesAsync always throws there).
// There is deliberately no background/TaskManager code path, no
// AsyncStorage-based restoration-on-relaunch logic, and no foreground-service
// configuration anywhere in this file — tracking exists only for as long as
// this JS process is alive and the device's own user keeps the app open,
// via a single Location.watchPositionAsync subscription per tracker
// instance. If a real background mode is ever needed later (a custom
// dev-client/EAS build), that is a deliberate future addition, not
// something to silently reintroduce here.
// ---------------------------------------------------------------------------

import * as Location from "expo-location";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";

import { db } from "../firebase";

// targetId identifies the Firestore document within `collectionName`; every
// other field is merged into that document verbatim alongside the coords
// (e.g. {driverId, passengerId} for tripLocations, {passengerId, driverId}
// for passengerLocations) — see each wrapper module's own target type.
export type ForegroundTrackTarget = {
  targetId: string;
  [field: string]: string | undefined;
};

export type StartTrackingResult = {
  started: boolean;
  reason?: "foreground_denied";
};

export function createForegroundLocationTracker(collectionName: string) {
  // In-memory only, on purpose — no persistence/restoration across app
  // relaunches (see file header). Exactly one subscription can exist at a
  // time, for exactly one target, per tracker instance.
  let activeTargetId: string | null = null;
  let subscription: Location.LocationSubscription | null = null;
  let startPromise: Promise<StartTrackingResult> | null = null;

  // Firestore rules require the FIRST write to targetId (a `create`, i.e.
  // the doc doesn't exist yet) to carry no latitude/longitude — only once
  // the doc exists does the rules' `update` branch allow coordinate fields.
  // School Trips satisfies this itself (its own verify-and-start transaction
  // pre-creates the doc with just {driverId, authorizedPassengerIds}) but no
  // caller did this for a 1:1 target (Personal Ride, Work, Errand), so their
  // very first coordinate write would otherwise be evaluated as a `create`
  // carrying latitude/longitude and get rejected. Calling this once before
  // the first write — safe to call repeatedly, since re-merging the same
  // driverId/passengerId onto an existing doc is a no-op diff — closes that
  // gap for every caller without changing firestore.rules.
  const ensureTargetDoc = async (
    target: ForegroundTrackTarget,
  ): Promise<void> => {
    const { targetId, ...fields } = target;
    await setDoc(doc(db, collectionName, targetId), fields, { merge: true });
  };

  // Shared by the watchPositionAsync callback and captureOnce — exactly one
  // place writes a location fix to Firestore for this collection.
  const writeLocationFix = async (
    target: ForegroundTrackTarget,
    coords: {
      latitude: number;
      longitude: number;
      heading?: number | null;
      speed?: number | null;
      accuracy?: number | null;
    },
  ): Promise<void> => {
    const { targetId, ...fields } = target;

    await setDoc(
      doc(db, collectionName, targetId),
      {
        ...fields,
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

  const doStart = async (
    target: ForegroundTrackTarget,
  ): Promise<StartTrackingResult> => {
    if (subscription && activeTargetId === target.targetId) {
      // Already tracking exactly this target — nothing to do.
      return { started: true };
    }

    // Switching to a different target (or re-subscribing) always fully
    // stops the previous subscription first, so a location update for one
    // target can never land on another target's document.
    if (subscription) {
      subscription.remove();
      subscription = null;
    }
    activeTargetId = null;

    const foreground = await Location.requestForegroundPermissionsAsync(); //طلب صلاحية الموقع
    if (foreground.status !== "granted") {
      return { started: false, reason: "foreground_denied" };
    }

    try {
      await ensureTargetDoc(target);
      activeTargetId = target.targetId;
      subscription = await Location.watchPositionAsync(
        //التتبع المستمر
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 4000,
          distanceInterval: 8,
        },
        (location) => {
          writeLocationFix(target, location.coords).catch((error) => {
            console.log(
              `foregroundLocationTracker(${collectionName}): could not write location`,
              error,
            );
          });
        },
      );

      return { started: true };
    } catch (error) {
      console.log(
        `foregroundLocationTracker(${collectionName}): start failed`,
        error,
      );
      activeTargetId = null;
      subscription = null;
      return { started: false, reason: "foreground_denied" };
    }
  };

  // De-dupes concurrent callers: a caller's own effect can legitimately
  // re-run twice within milliseconds of each other (e.g. two listeners
  // firing right after the same status change), which would otherwise race
  // two independent watchPositionAsync subscriptions against each other.
  const start = (
    target: ForegroundTrackTarget,
  ): Promise<StartTrackingResult> => {
    if (startPromise) return startPromise;

    startPromise = doStart(target).finally(() => {
      startPromise = null;
    });

    return startPromise;
  };

  const stop = async (): Promise<void> => {
    if (subscription) {
      subscription.remove();
      subscription = null;
    }
    activeTargetId = null;
  };

  // A one-off immediate fix, written the moment tracking starts, so the
  // reader's map/UI has a value right away instead of waiting for the
  // first timeInterval/distanceInterval tick.
  const captureOnce = async (target: ForegroundTrackTarget): Promise<void> => {
    try {
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      await ensureTargetDoc(target);
      await writeLocationFix(target, current.coords);
    } catch (error) {
      console.log(
        `foregroundLocationTracker(${collectionName}): captureOnce failed`,
        error,
      );
    }
  };

  return { start, stop, captureOnce };
}
