// ---------------------------------------------------------------------------
// Regression tests for extending the shared local route-matching algorithm
// (app/booking/routeMatchLib.ts) to School Ride. Exercises the pure School
// adapter (app/booking/schoolRouteMatchLib.ts) plus routeMatchLib.ts's own
// functions directly with School-shaped scenarios (outbound/return),
// mirroring exactly how app/booking/schoolTripsLib.ts's passesCapacityAndRoute
// calls them — never a second, divergent implementation.
//
// schoolTripsLib.ts itself is NOT imported here: it pulls in
// firebase/firestore + expo-crypto + (transitively) react-native, which
// vitest's Node-only parser can't load (Flow syntax) — see
// schoolRouteMatchLib.ts's own header. That module boundary is also why the
// "wrong school" / "no seats" / "weekly mismatch" scenarios below are
// verified structurally (confirming routeMatchLib.ts's types carry no
// school-identity/seats/day-time concept at all, so those checks MUST run
// as separate, untouched gates before/after route-matching) rather than by
// invoking the real Firestore-backed search path, which has no pure-function
// entry point to call from Node.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import {
  DriverRouteInput,
  getRouteMatchesForCandidates,
  LatLng,
  MAX_APPROXIMATE_DETOUR_KM,
  MAX_APPROXIMATE_DETOUR_RATIO,
  MAX_ROUTE_CORRIDOR_DISTANCE_KM,
} from "../app/booking/routeMatchLib";
import { getSchoolTripRouteEndpoints } from "../app/booking/schoolRouteMatchLib";

describe("getSchoolTripRouteEndpoints — outbound/return adapter", () => {
  const fromLocation: LatLng = { latitude: 32.75, longitude: 35.34 };
  const toLocation: LatLng = { latitude: 32.5, longitude: 35.5 };
  const schoolLocation: LatLng = { latitude: 32.6, longitude: 35.29 };

  it("maps outbound (to_school) as A=fromLocation, C=schoolLocation", () => {
    const result = getSchoolTripRouteEndpoints({
      direction: "to_school",
      fromLocation,
      toLocation,
      schoolLocation,
    });

    expect(result.origin).toEqual(fromLocation);
    expect(result.destination).toEqual(schoolLocation);
  });

  it("maps return (from_school) as A=schoolLocation, C=toLocation — never the outbound mapping", () => {
    const result = getSchoolTripRouteEndpoints({
      direction: "from_school",
      fromLocation,
      toLocation,
      schoolLocation,
    });

    expect(result.origin).toEqual(schoolLocation);
    expect(result.destination).toEqual(toLocation);
  });

  it("passes through missing coordinates as null (safe legacy fallback trigger) instead of throwing", () => {
    const result = getSchoolTripRouteEndpoints({
      direction: "to_school",
      fromLocation: null,
      toLocation,
      schoolLocation: null,
    });

    expect(result.origin).toBeNull();
    expect(result.destination).toBeNull();
  });
});

describe("School outbound matching (A=driver origin, C=school)", () => {
  // A driver whose own village is far from the student, but whose route to
  // the school passes right by the student's pickup — real-world-ish
  // Galilee coordinates (same shape as the Personal Ride Kafr Kanna
  // regression, reused here for School).
  const driverOrigin: LatLng = { latitude: 32.7517, longitude: 35.3406 };
  const school: LatLng = { latitude: 32.6076, longitude: 35.2897 };

  it("MATCH: student pickup is far from driver origin but close to the A->C corridor toward school", () => {
    const studentPickup: LatLng = { latitude: 32.74, longitude: 35.32 };

    const trip = getSchoolTripRouteEndpoints({
      direction: "to_school",
      fromLocation: driverOrigin,
      toLocation: null,
      schoolLocation: school,
    });

    const candidate: DriverRouteInput = {
      tripId: "outbound-match",
      origin: trip.origin,
      destination: trip.destination,
    };

    const [result] = getRouteMatchesForCandidates([candidate], { pickup: studentPickup });

    expect(result.reason).toBe("MATCH");
    expect(result.eligible).toBe(true);
    expect(result.approximateDetourKm).not.toBeNull();
    expect(result.approximateDetourKm!).toBeLessThan(MAX_APPROXIMATE_DETOUR_KM);
  });

  it("rejects a student pickup far from the driver's route to school", () => {
    const farPickup: LatLng = { latitude: 32.7, longitude: 35.9 };

    const trip = getSchoolTripRouteEndpoints({
      direction: "to_school",
      fromLocation: driverOrigin,
      toLocation: null,
      schoolLocation: school,
    });

    const candidate: DriverRouteInput = {
      tripId: "outbound-too-far",
      origin: trip.origin,
      destination: trip.destination,
    };

    const [result] = getRouteMatchesForCandidates([candidate], { pickup: farPickup });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("TOO_FAR_FROM_ROUTE");
  });

  it("rejects a student pickup that is geometrically near but BEHIND the driver (wrong direction)", () => {
    // ~3km behind driverOrigin, on the opposite side from school — close
    // enough to pass the corridor-distance check, but requires the driver
    // to travel backwards to reach it.
    const behindPickup: LatLng = { latitude: 32.777693530327994, longitude: 35.34978161480704 };

    const trip = getSchoolTripRouteEndpoints({
      direction: "to_school",
      fromLocation: driverOrigin,
      toLocation: null,
      schoolLocation: school,
    });

    const candidate: DriverRouteInput = {
      tripId: "outbound-wrong-direction",
      origin: trip.origin,
      destination: trip.destination,
    };

    const [result] = getRouteMatchesForCandidates([candidate], { pickup: behindPickup });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("WRONG_DIRECTION");
  });
});

describe("School return matching (A=school, C=driver final destination)", () => {
  const school: LatLng = { latitude: 32.6076, longitude: 35.2897 };
  const driverFinalDestination: LatLng = { latitude: 32.4969, longitude: 35.4989 };

  it("MATCH: student drop-off is close to the route leaving the school, in the correct direction", () => {
    const dropoff: LatLng = { latitude: 32.57866527739275, longitude: 35.38467024281534 };

    const trip = getSchoolTripRouteEndpoints({
      direction: "from_school",
      fromLocation: null,
      toLocation: driverFinalDestination,
      schoolLocation: school,
    });

    const candidate: DriverRouteInput = {
      tripId: "return-match",
      origin: trip.origin,
      destination: trip.destination,
    };

    const [result] = getRouteMatchesForCandidates([candidate], { pickup: dropoff });

    expect(result.reason).toBe("MATCH");
    expect(result.eligible).toBe(true);
    expect(result.pickupDistanceFromRouteKm).not.toBeNull();
    expect(result.pickupDistanceFromRouteKm!).toBeLessThan(MAX_ROUTE_CORRIDOR_DISTANCE_KM);
    expect(result.detourRatio).not.toBeNull();
    expect(result.detourRatio!).toBeLessThan(MAX_APPROXIMATE_DETOUR_RATIO);
  });

  it("rejects a student drop-off that is behind the school-leaving route (wrong direction)", () => {
    // ~3km behind the school, on the opposite side from the driver's final
    // destination — the return-leg equivalent of "requires reversing".
    const behindDropoff: LatLng = { latitude: 32.62196227513831, longitude: 35.262558284020464 };

    const trip = getSchoolTripRouteEndpoints({
      direction: "from_school",
      fromLocation: null,
      toLocation: driverFinalDestination,
      schoolLocation: school,
    });

    const candidate: DriverRouteInput = {
      tripId: "return-wrong-direction",
      origin: trip.origin,
      destination: trip.destination,
    };

    const [result] = getRouteMatchesForCandidates([candidate], { pickup: behindDropoff });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("WRONG_DIRECTION");
  });

  it("never applies the outbound mapping to a return trip (origin/destination are swapped, not identical)", () => {
    const outboundTrip = getSchoolTripRouteEndpoints({
      direction: "to_school",
      fromLocation: driverFinalDestination, // deliberately same raw fields,
      toLocation: driverFinalDestination, //   different direction, to prove
      schoolLocation: school, //               only `direction` drives the mapping
    });
    const returnTrip = getSchoolTripRouteEndpoints({
      direction: "from_school",
      fromLocation: driverFinalDestination,
      toLocation: driverFinalDestination,
      schoolLocation: school,
    });

    expect(outboundTrip.origin).toEqual(driverFinalDestination);
    expect(outboundTrip.destination).toEqual(school);
    expect(returnTrip.origin).toEqual(school);
    expect(returnTrip.destination).toEqual(driverFinalDestination);
  });
});

describe("Missing coordinates — safe legacy fallback, never a crash", () => {
  it("returns NO_COORDINATES (not a throw) when the school trip has no saved location at all", () => {
    const trip = getSchoolTripRouteEndpoints({
      direction: "to_school",
      fromLocation: null,
      toLocation: null,
      schoolLocation: null,
    });

    const candidate: DriverRouteInput = {
      tripId: "missing-coords",
      origin: trip.origin,
      destination: trip.destination,
    };

    expect(() =>
      getRouteMatchesForCandidates([candidate], { pickup: { latitude: 32.6, longitude: 35.3 } }),
    ).not.toThrow();

    const [result] = getRouteMatchesForCandidates([candidate], {
      pickup: { latitude: 32.6, longitude: 35.3 },
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("NO_COORDINATES");
    // The real caller (schoolTripsLib.ts's passesCapacityAndRoute) checks
    // isValidLatLng BEFORE ever calling getRouteMatchesForCandidates, and
    // falls back to the original isDestinationNearRoute check in exactly
    // this situation — this result only proves the algorithm itself never
    // throws or produces a nonsensical result when handed missing data.
  });
});

describe("Route-matching is eligibility-only — school/seats/weekly-day stay separate gates", () => {
  it("DriverRouteInput/PassengerRouteQuery carry no school-identity field — a 'wrong school' candidate can only be excluded upstream (Firestore's own schoolId query filter), never inside this algorithm", () => {
    const candidate: DriverRouteInput = {
      tripId: "any-trip",
      origin: { latitude: 32.6, longitude: 35.3 },
      destination: { latitude: 32.5, longitude: 35.4 },
    };

    // No school/seats/weekday field exists anywhere on this input or on
    // RouteMatchResult below — confirms schoolId equality, seat count, and
    // weekday/time compatibility can never be decided by this function and
    // must (and, per schoolTripsLib.ts/driverresults.tsx's unchanged code,
    // do) run as separate checks before or after it.
    expect(Object.keys(candidate).sort()).toEqual(["destination", "origin", "tripId"]);

    const [result] = getRouteMatchesForCandidates([candidate], {
      pickup: { latitude: 32.55, longitude: 35.35 },
    });

    const resultKeys = Object.keys(result as unknown as Record<string, unknown>).sort();
    expect(resultKeys).not.toContain("schoolId");
    expect(resultKeys).not.toContain("availableSeats");
    expect(resultKeys).not.toContain("dayKey");
  });

  it("a geometrically MATCHing route stays MATCH regardless of weekday — weekly-day/time compatibility is not, and must not become, part of this eligibility check", () => {
    // Same geometry as the outbound MATCH scenario above — the algorithm
    // has no `date`/`day`/`time` input at all, so it cannot possibly know
    // (or care) which weekday this request is for. The real legacy weekly
    // School path (driverresults.tsx -> weeklyBookingLib.ts's
    // matchDriverWeeklyDays, unchanged by this feature) is what actually
    // rejects a driver who doesn't operate on the requested day/time — it
    // runs as a separate step AFTER this route-matching result is used, so
    // a route-eligible-but-wrong-weekday driver is still correctly
    // excluded overall, just not by this function.
    const candidate: DriverRouteInput = {
      tripId: "weekly-mismatch-example",
      origin: { latitude: 32.7517, longitude: 35.3406 },
      destination: { latitude: 32.6076, longitude: 35.2897 },
    };

    const [result] = getRouteMatchesForCandidates([candidate], {
      pickup: { latitude: 32.74, longitude: 35.32 },
    });

    expect(result.eligible).toBe(true);
    expect((result as unknown as Record<string, unknown>).day).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).weekday).toBeUndefined();
  });
});
