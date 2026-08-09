// ---------------------------------------------------------------------------
// Dependency-free core for displaying a requester's pickup location on a
// driver/employer's incoming-request card (Personal Ride bookings, Work
// applications) — safe normalization of whatever shape the Firestore
// document actually has (including old documents written before these
// fields existed, which must render as "Pickup location not provided"
// rather than crash) and approximate distance-to-driver calculation.
//
// Deliberately its own file, with NO import of react-native/firebase/expo-
// location, for the same reason weeklyBookingCore.ts/driverNoShowCore.ts
// are their own files: the real screens that use this (app/booking/
// ride-payment.tsx, app/(tabs)/bookings.tsx, app/booking/work-errand/
// workErrandLib.ts) all transitively pull in react-native/firebase at
// module scope and fail to even PARSE under this project's vitest config
// (plain Node — see vitest.config.ts's own header).
// ---------------------------------------------------------------------------

export type NormalizedPickupLocation = {
  latitude: number | null;
  longitude: number | null;
  address: string;
  area: string;
  source: "current" | "home" | "custom";
};

// Never throws — a malformed, partial, or entirely absent `pickupLocation`
// (every real shape an old pre-this-feature document can have) normalizes
// to a safe, fully-typed value instead of crashing the render. Returns null
// only when there is truly nothing to show at all (see
// getPickupDisplayLabel below, which is what actually decides "Pickup
// location not provided").
export const normalizePickupLocationSafe = (
  raw: unknown,
): NormalizedPickupLocation | null => {
  if (!raw || typeof raw !== "object") return null;

  const data = raw as Record<string, unknown>;
  const latitude = typeof data.latitude === "number" && Number.isFinite(data.latitude) ? data.latitude : null;
  const longitude = typeof data.longitude === "number" && Number.isFinite(data.longitude) ? data.longitude : null;
  const address = typeof data.address === "string" ? data.address : "";
  const area = typeof data.area === "string" ? data.area : "";
  const source: NormalizedPickupLocation["source"] =
    data.source === "current" || data.source === "home" ? data.source : "custom";

  if (latitude === null && longitude === null && !address && !area) return null;

  return { latitude, longitude, address, area, source };
};

// Straight-line (haversine, great-circle) distance in km — duplicated from
// app/booking/routeMatchLib.ts's own private haversineKm (identical
// formula, same reasoning as that file's own comment on why it doesn't
// import homeFeedLib.ts's calculateDistanceKm: avoiding a dependency on a
// module this one can't safely pull in under vitest).
export const haversineKm = (
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * sinLng * sinLng;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(Math.min(1, h)));
};

// Approximate distance between the passenger's pickup point and the
// driver's trip starting point — only when BOTH sides have real
// coordinates (never a guess, never partial data treated as a real
// distance). Rounded to one decimal place, matching this app's other
// distance displays (see homeFeedLib.ts's own NEARBY_RIDE_RADIUS_KM usage).
export const computeApproxDistanceKm = (
  pickup: { latitude: number | null; longitude: number | null } | null | undefined,
  driverOrigin: { latitude: number | null; longitude: number | null } | null | undefined,
): number | null => {
  if (
    !pickup ||
    !driverOrigin ||
    typeof pickup.latitude !== "number" ||
    typeof pickup.longitude !== "number" ||
    typeof driverOrigin.latitude !== "number" ||
    typeof driverOrigin.longitude !== "number"
  ) {
    return null;
  }

  const km = haversineKm(
    { latitude: pickup.latitude, longitude: pickup.longitude },
    { latitude: driverOrigin.latitude, longitude: driverOrigin.longitude },
  );

  return Math.round(km * 10) / 10;
};
