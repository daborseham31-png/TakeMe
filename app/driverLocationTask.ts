// ---------------------------------------------------------------------------
// Real driver GPS tracking for an active trip — the ONE place location
// updates are collected and written, for BOTH Personal Ride (bookings) and
// School Trips. Built on expo-location's background task API (not a plain
// watchPositionAsync) so tracking survives the app being backgrounded or the
// Android phone being locked during an active trip — see
// https://docs.expo.dev/versions/v54.0.0/sdk/location/. The SAME
// registration also delivers updates while the app is foregrounded, so
// there is no separate foreground-only subscription anywhere else in the
// app — never start a second watchPositionAsync/startLocationUpdatesAsync
// alongside this one.
//
// The task callback (TaskManager.defineTask) runs independently of any
// React component's lifecycle, including after the app was backgrounded —
// so it cannot read live component state. Instead, the single active
// tracking target (which Firestore doc to write to) is persisted to
// AsyncStorage by startDriverLocationTracking/stopDriverLocationTracking,
// and the task reads it fresh on every batch of updates. This also means an
// unmounted/backgrounded ride-navigation screen does NOT stop tracking on
// its own — only an explicit stop call (Finish Trip, Cancel Trip, sign out)
// does, exactly matching "the active-trip tracking service is controlled by
// booking status, not component lifecycle".
//
// Location now lives in its own `tripLocations` collection (never on the
// public/searchable schoolTrips or the wide-open bookings doc) so Firestore
// rules can restrict reads to exactly the assigned driver + authorized
// passenger(s) — see firestore.rules and verifyPassengerCodeAndStartTrip in
// schoolTripsLib.ts (which is what authorizes a passenger for a school
// trip's shared location doc the moment their own trip starts).
// ---------------------------------------------------------------------------

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";

import { db } from "../firebase";

export const DRIVER_LOCATION_TASK_NAME = "takeme-driver-location-task";

const ACTIVE_TARGET_STORAGE_KEY = "takeme.activeLocationTrackingTarget";

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

const readActiveTarget = async (): Promise<TrackingTarget | null> => {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_TARGET_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TrackingTarget) : null;
  } catch {
    return null;
  }
};

const writeActiveTarget = async (target: TrackingTarget | null): Promise<void> => {
  if (target) {
    await AsyncStorage.setItem(ACTIVE_TARGET_STORAGE_KEY, JSON.stringify(target));
  } else {
    await AsyncStorage.removeItem(ACTIVE_TARGET_STORAGE_KEY);
  }
};

// Defined at module (top-level) scope, as required — this file is imported
// once from app/_layout.tsx so the task is always registered, regardless of
// which screen is currently mounted.
TaskManager.defineTask(DRIVER_LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.log("driverLocationTask error", error.message);
    return;
  }

  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
  const latest = locations?.[locations.length - 1];
  if (!latest) return;

  // Re-read on every batch rather than trusting a closed-over value — the
  // active trip can change (or tracking can be stopped) between batches,
  // and this task may be resumed headlessly after the app process itself
  // was restarted, so any in-memory value here would be stale.
  const target = await readActiveTarget();
  if (!target) return;

  try {
    await setDoc(
      doc(db, "tripLocations", target.targetId),
      {
        driverId: target.driverId,
        ...(target.passengerId ? { passengerId: target.passengerId } : {}),
        latitude: latest.coords.latitude,
        longitude: latest.coords.longitude,
        heading: latest.coords.heading ?? null,
        speed: latest.coords.speed ?? null,
        accuracy: latest.coords.accuracy ?? null,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (writeError) {
    console.log("driverLocationTask: could not write location", writeError);
  }
});

// Starts (or re-targets) continuous GPS tracking for exactly one active
// trip. Safe to call again for the same target (no-op beyond re-confirming
// permissions); switching to a DIFFERENT target always fully stops the
// previous one first, so a location update from one trip can never land on
// another trip's document.
export const startDriverLocationTracking = async (
  target: TrackingTarget,
): Promise<{ started: boolean; reason?: "foreground_denied" | "background_denied" }> => {
  const currentTarget = await readActiveTarget();
  const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK_NAME).catch(
    () => false,
  );

  if (alreadyRunning && currentTarget?.targetId === target.targetId) {
    // Already tracking exactly this trip — nothing to do.
    return { started: true };
  }

  if (alreadyRunning) {
    await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK_NAME).catch(() => {});
  }

  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted") {
    return { started: false, reason: "foreground_denied" };
  }

  // Foreground permission must be granted before background is requested —
  // see the SDK docs. A denial here still leaves foreground-only updates
  // working (Android/iOS both keep delivering updates while the app is
  // actually open), so tracking still starts rather than failing outright.
  const background = await Location.requestBackgroundPermissionsAsync().catch(() => null);

  await writeActiveTarget(target);

  await Location.startLocationUpdatesAsync(DRIVER_LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.High,
    timeInterval: 4000,
    distanceInterval: 8,
    foregroundService: {
      notificationTitle: "TakeMe — trip in progress",
      notificationBody: "Sharing your location with your passenger while this trip is active.",
      notificationColor: "#F58220",
    },
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
  });

  return {
    started: true,
    reason: background?.status !== "granted" ? "background_denied" : undefined,
  };
};

export const stopDriverLocationTracking = async (): Promise<void> => {
  await writeActiveTarget(null);

  const running = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK_NAME).catch(
    () => false,
  );
  if (running) {
    await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK_NAME).catch(() => {});
  }
};

// A one-off immediate fix, written the moment tracking starts, so the
// passenger's map has a marker right away instead of waiting for the first
// timeInterval/distanceInterval tick.
export const captureDriverLocationOnce = async (target: TrackingTarget): Promise<void> => {
  try {
    const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });

    await setDoc(
      doc(db, "tripLocations", target.targetId),
      {
        driverId: target.driverId,
        ...(target.passengerId ? { passengerId: target.passengerId } : {}),
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
        heading: current.coords.heading ?? null,
        speed: current.coords.speed ?? null,
        accuracy: current.coords.accuracy ?? null,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (error) {
    console.log("captureDriverLocationOnce failed", error);
  }
};
