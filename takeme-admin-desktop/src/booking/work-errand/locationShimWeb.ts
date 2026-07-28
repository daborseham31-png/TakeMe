// ---------------------------------------------------------------------------
// Desktop stub for the one function in workErrandLib.ts that uses
// expo-location (detectCurrentLocation, a passenger/driver "use my current
// location" helper for posting a job/errand). The admin app never posts a
// job/errand, so this is never actually called here — this stub exists only
// so the module's top-level `import * as Location from "expo-location"`
// resolves without pulling in expo-location's native-module dependency
// chain. If it's ever called by mistake, it throws a clear error instead of
// silently doing nothing.
// ---------------------------------------------------------------------------

const notSupported = (): never => {
  throw new Error("Location detection is not available in the TakeMe Admin desktop app.");
};

export const requestForegroundPermissionsAsync = async () => notSupported();
export const getCurrentPositionAsync = async (_options?: unknown): Promise<any> => notSupported();
export const reverseGeocodeAsync = async (_coords: unknown): Promise<any[]> => notSupported();
export const Accuracy = { Balanced: 3 };
