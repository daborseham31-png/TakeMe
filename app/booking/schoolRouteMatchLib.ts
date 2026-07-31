// ---------------------------------------------------------------------------
// Pure School Ride adapter for routeMatchLib.ts's shared local matching
// algorithm — maps a school trip's own stored `direction` onto the generic
// A->C corridor model (see routeMatchLib.ts's header: A = driver origin,
// C = driver destination). No Firestore, Expo, or React Native import here
// — kept fully framework-free (like routeMatchLib.ts itself) so it stays
// safe to import under vitest. schoolTripsLib.ts itself is NOT safe to
// import under vitest — it pulls in firebase/firestore + expo-crypto +
// (transitively) react-native, which vitest's Node-only parser can't load
// (Flow syntax) — so this file exists precisely so schoolTripsLib.ts and its
// tests both call through the exact same function rather than either one
// duplicating this mapping.
//
// Outbound (to_school): A = driver's own starting area (fromLocation),
// C = the school itself (schoolLocation) — the student's pickup (B) is
// checked against this A->C corridor.
// Return (from_school): A = the school (schoolLocation), C = the driver's
// own final area (toLocation) — the student's drop-off (B) is checked
// against THIS A->C corridor instead. Never applies the outbound mapping to
// a return trip or vice versa — driven entirely by the trip's own stored
// `direction` (see schoolTripsLib.ts's SchoolTripDirection /
// normalizeSchoolTripDirection, the ONE canonical direction model — this
// file never invents a second one, it only consumes the same two literal
// string values).
// ---------------------------------------------------------------------------

import type { LatLng } from "./routeMatchLib";

export type SchoolTripRouteEndpointsInput = {
  // Deliberately the plain literal union (matching schoolTripsLib.ts's own
  // SchoolTripDirection) rather than importing that type by name — avoids
  // pulling schoolTripsLib.ts's Firestore/Expo dependency chain in here just
  // for a type import, while staying structurally identical (TypeScript
  // treats the two as fully interchangeable).
  direction: "to_school" | "from_school";
  fromLocation: LatLng | null;
  toLocation: LatLng | null;
  schoolLocation: LatLng | null;
};

export function getSchoolTripRouteEndpoints(
  trip: SchoolTripRouteEndpointsInput,
): { origin: LatLng | null; destination: LatLng | null } {
  return trip.direction === "to_school"
    ? { origin: trip.fromLocation, destination: trip.schoolLocation }
    : { origin: trip.schoolLocation, destination: trip.toLocation };
}
