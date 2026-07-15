// ---------------------------------------------------------------------------
// Foreground-only current position for the Home "nearby rides" feature.
// Never requests background/always permission, never tracks continuously —
// a single one-shot fix is taken each time check()/refresh() runs, and the
// coordinates are held only in memory (never written to Firestore, never
// sent to other users).
// ---------------------------------------------------------------------------

import * as Location from "expo-location";
import { useCallback, useRef, useState } from "react";

export type LocationState =
  | "checking"
  | "granted"
  | "denied"
  | "services-disabled"
  | "unavailable";

export type Coords = { latitude: number; longitude: number };

const LOCATION_TIMEOUT_MS = 10000;

export function useCurrentLocation() {
  const [state, setState] = useState<LocationState>("checking");
  const [coords, setCoords] = useState<Coords | null>(null);
  const [canAskAgain, setCanAskAgain] = useState(true);
  const inFlight = useRef(false);
  const everChecked = useRef(false);

  const check = useCallback(async (forcePrompt: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState("checking");

    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        setState("services-disabled");
        return;
      }

      let permission = await Location.getForegroundPermissionsAsync();

      // Only ever prompt on an explicit user action or the very first check
      // this screen makes — never on a silent focus/pull-to-refresh, so the
      // system dialog can't loop.
      if (
        permission.status !== "granted" &&
        (forcePrompt || !everChecked.current) &&
        permission.canAskAgain
      ) {
        permission = await Location.requestForegroundPermissionsAsync();
      }

      everChecked.current = true;
      setCanAskAgain(permission.canAskAgain);

      if (permission.status !== "granted") {
        setState("denied");
        setCoords(null);
        return;
      }

      const position = await Promise.race([
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }),
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), LOCATION_TIMEOUT_MS),
        ),
      ]);

      if (!position) {
        setState("unavailable");
        return;
      }

      setCoords({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      setState("granted");
    } catch {
      setState("unavailable");
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Silent refresh — used on focus / pull-to-refresh. Never re-prompts.
  const refresh = useCallback(() => check(false), [check]);
  // Explicit user action ("Enable location" / "Try again" / Nearby tab) —
  // prompts if not yet asked.
  const requestPermission = useCallback(() => check(true), [check]);

  return { state, coords, canAskAgain, refresh, requestPermission };
}
