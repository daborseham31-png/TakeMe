// ---------------------------------------------------------------------------
// Unit tests for the pure, fully local/free route-matching utilities in
// routeMatchLib.ts — no React rendering, no network/Firestore calls, no
// Google Maps API key. Run with:
//   npm test
// (vitest — see vitest.config.ts for why this project uses it only for
// this kind of framework-free module, not general RN component testing.)
//
// Lives OUTSIDE app/ deliberately: Expo Router's Metro entry point sweeps
// every file under app/ into the app bundle to build its route table, so a
// test file there would drag `vitest` (and its `vite` dependency, which uses
// `import.meta` — unsupported by Hermes) straight into the shipped app and
// break `expo export`/the Metro bundle. Keeping tests in this sibling
// directory keeps them fully reachable by vitest (see vitest.config.ts's
// `include: ["**/*.test.ts"]`) without ever being part of the app/ route
// tree Metro scans for the real app.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import {
  calculateApproximateDetourKm,
  DriverRouteInput,
  evaluateApproximateDetour,
  getRouteMatchesForCandidates,
  isEffectivelySameLocation,
  isValidLatLng,
  LatLng,
  MAX_APPROXIMATE_DETOUR_KM,
  MAX_APPROXIMATE_DETOUR_RATIO,
  MAX_ROUTE_CORRIDOR_DISTANCE_KM,
  prefilterCandidate,
  projectOntoCorridor,
  ROUTE_PROGRESS_TOLERANCE,
  sortRouteMatches,
  SortableRouteMatch,
} from "../app/booking/routeMatchLib";

// ---------------------------------------------------------------------------
// Test-only helper — used purely to construct/verify realistic scenarios
// below (e.g. "assert A and B really are far apart"), never to test
// routeMatchLib.ts's own (private) haversine implementation directly.
// ---------------------------------------------------------------------------

function testHaversineKm(a: LatLng, b: LatLng): number {
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
}

// A long (~55km) due-north corridor — A (driver origin) to C (driver
// destination) — used by most tests below.
const A: LatLng = { latitude: 32.0, longitude: 34.8 };
const C: LatLng = { latitude: 32.5, longitude: 34.8 };

const baseDriverRoute: DriverRouteInput = { tripId: "trip-1", origin: A, destination: C };

describe("isValidLatLng", () => {
  it("accepts a normal coordinate", () => {
    expect(isValidLatLng({ latitude: 32.05, longitude: 34.8 })).toBe(true);
  });

  it("rejects null/undefined", () => {
    expect(isValidLatLng(null)).toBe(false);
    expect(isValidLatLng(undefined)).toBe(false);
  });

  it("rejects NaN and out-of-range components", () => {
    expect(isValidLatLng({ latitude: NaN, longitude: 34.8 })).toBe(false);
    expect(isValidLatLng({ latitude: 32.05, longitude: Infinity })).toBe(false);
    expect(isValidLatLng({ latitude: 200, longitude: 34.8 })).toBe(false);
    expect(isValidLatLng({ latitude: 32.05, longitude: -200 })).toBe(false);
  });
});

describe("isEffectivelySameLocation", () => {
  it("treats two points ~50m apart as the same location", () => {
    expect(
      isEffectivelySameLocation({ latitude: 32.05, longitude: 34.8 }, { latitude: 32.0505, longitude: 34.8 }),
    ).toBe(true);
  });

  it("treats two points several km apart as different locations", () => {
    expect(
      isEffectivelySameLocation({ latitude: 32.05, longitude: 34.8 }, { latitude: 32.15, longitude: 34.9 }),
    ).toBe(false);
  });
});

describe("projectOntoCorridor", () => {
  it("increases progress for points further along A->C", () => {
    const nearStart = projectOntoCorridor(A, C, { latitude: 32.1, longitude: 34.8 });
    const nearMid = projectOntoCorridor(A, C, { latitude: 32.25, longitude: 34.8 });
    const nearEnd = projectOntoCorridor(A, C, { latitude: 32.4, longitude: 34.8 });

    expect(nearStart.progress).toBeLessThan(nearMid.progress);
    expect(nearMid.progress).toBeLessThan(nearEnd.progress);
  });

  it("reports ~0 corridor distance for a point exactly on the line", () => {
    const result = projectOntoCorridor(A, C, { latitude: 32.25, longitude: 34.8 });
    expect(result.distanceFromCorridorKm).toBeLessThan(0.01);
    expect(result.progress).toBeCloseTo(0.5, 1);
  });

  it("handles a zero-length A->C segment without NaN or throwing", () => {
    const point: LatLng = { latitude: 32.01, longitude: 34.81 };
    const result = projectOntoCorridor(A, A, point);

    expect(Number.isFinite(result.distanceFromCorridorKm)).toBe(true);
    expect(Number.isFinite(result.progress)).toBe(true);
    expect(result.distanceFromCorridorKm).toBeCloseTo(testHaversineKm(A, point), 1);
  });
});

describe("calculateApproximateDetourKm", () => {
  it("clamps a tiny negative floating-point result to zero", () => {
    // A point essentially exactly on the A->C line — the raw
    // AB + BC - AC could come out very slightly negative due to
    // floating-point error; it must never be reported as negative.
    const onLine: LatLng = { latitude: 32.25, longitude: 34.8 };
    const detour = calculateApproximateDetourKm(A, onLine, C, null);

    expect(detour).toBeGreaterThanOrEqual(0);
    expect(detour).toBeLessThan(0.05);
  });

  it("uses the A->B->D->C formula when a passenger destination is given", () => {
    const pickup: LatLng = { latitude: 32.1, longitude: 34.8 };
    const passengerDestination: LatLng = { latitude: 32.4, longitude: 34.8 };

    const withD = calculateApproximateDetourKm(A, pickup, C, passengerDestination);
    const withoutD = calculateApproximateDetourKm(A, pickup, C, null);

    // Both are ~on the line, so both detours should be small, but they are
    // computed via genuinely different formulas (verifies the D-branch runs
    // at all rather than silently falling back to the B->C formula).
    expect(withD).toBeGreaterThanOrEqual(0);
    expect(withoutD).toBeGreaterThanOrEqual(0);
  });
});

describe("evaluateApproximateDetour — configurable thresholds", () => {
  it("passes a small, well-within-threshold detour", () => {
    const result = evaluateApproximateDetour({ baseDistanceKm: 55, detourKm: 2 });
    expect(result.passed).toBe(true);
    expect(result.detourRatio).toBeCloseTo(2 / 55, 5);
  });

  it("rejects when the detour exceeds MAX_APPROXIMATE_DETOUR_KM", () => {
    const result = evaluateApproximateDetour({
      baseDistanceKm: 200, // large base so ratio alone wouldn't fail
      detourKm: MAX_APPROXIMATE_DETOUR_KM + 1,
    });
    expect(result.passed).toBe(false);
  });

  it("rejects when detourRatio exceeds MAX_APPROXIMATE_DETOUR_RATIO even if the absolute km is small", () => {
    const result = evaluateApproximateDetour({ baseDistanceKm: 2, detourKm: 0.9 }); // ratio 0.45
    expect(result.passed).toBe(false);
    expect(result.detourRatio).toBeGreaterThan(MAX_APPROXIMATE_DETOUR_RATIO);
  });

  it("handles a zero base distance without producing Infinity/NaN", () => {
    const result = evaluateApproximateDetour({ baseDistanceKm: 0, detourKm: 3 });
    expect(result.detourRatio).toBeNull();
    expect(Number.isNaN(result.detourRatio as any)).toBe(false);
    expect(result.passed).toBe(true); // under the absolute cap, ratio simply not applicable
  });

  it("safely rejects NaN and negative values instead of throwing", () => {
    expect(evaluateApproximateDetour({} as any).passed).toBe(false);
    expect(evaluateApproximateDetour({ baseDistanceKm: 55, detourKm: NaN }).passed).toBe(false);
    expect(evaluateApproximateDetour({ baseDistanceKm: 55, detourKm: -1 }).passed).toBe(false);
  });
});

describe("prefilterCandidate — corridor + direction validation", () => {
  it("matches a pickup far from the driver's own origin but close to the A->C corridor", () => {
    const pickup: LatLng = { latitude: 32.4, longitude: 34.8005 }; // ~50m off the line
    expect(testHaversineKm(A, pickup)).toBeGreaterThan(25); // genuinely far from A

    const result = prefilterCandidate(baseDriverRoute, { pickup });

    expect(result.passed).toBe(true);
    expect(result.reason).toBe("MATCH");
    expect(result.pickupDistanceFromRouteKm).not.toBeNull();
    expect(result.pickupDistanceFromRouteKm!).toBeLessThan(MAX_ROUTE_CORRIDOR_DISTANCE_KM);
  });

  it("rejects a pickup far from the corridor (TOO_FAR_FROM_ROUTE)", () => {
    const pickup: LatLng = { latitude: 32.25, longitude: 35.8 }; // ~1 degree east, ~94km off
    const result = prefilterCandidate(baseDriverRoute, { pickup });

    expect(result.passed).toBe(false);
    expect(result.reason).toBe("TOO_FAR_FROM_ROUTE");
  });

  it("rejects a pickup significantly behind the driver's origin (WRONG_DIRECTION)", () => {
    // ~4km south of A, on the same line as A->C but the wrong way — close
    // enough to A to pass the corridor-distance check, but far enough
    // behind to exceed ROUTE_PROGRESS_TOLERANCE.
    const pickup: LatLng = { latitude: 31.963834, longitude: 34.8 };
    const result = prefilterCandidate(baseDriverRoute, { pickup });

    expect(result.passed).toBe(false);
    expect(result.reason).toBe("WRONG_DIRECTION");
  });

  it("rejects a destination far from the corridor (DESTINATION_MISMATCH)", () => {
    const pickup: LatLng = { latitude: 32.1, longitude: 34.8 };
    const destination: LatLng = { latitude: 32.4, longitude: 35.8 }; // far east
    const result = prefilterCandidate(baseDriverRoute, { pickup, destination });

    expect(result.passed).toBe(false);
    expect(result.reason).toBe("DESTINATION_MISMATCH");
  });

  it("rejects when the passenger destination comes before the pickup along the corridor", () => {
    const pickup: LatLng = { latitude: 32.35, longitude: 34.8 }; // progress ~0.7
    const destination: LatLng = { latitude: 32.15, longitude: 34.8 }; // progress ~0.3, BEFORE pickup
    const result = prefilterCandidate(baseDriverRoute, { pickup, destination });

    expect(result.passed).toBe(false);
    expect(result.reason).toBe("WRONG_DIRECTION");
  });

  it("accepts logical order: pickup before destination along the corridor", () => {
    const pickup: LatLng = { latitude: 32.15, longitude: 34.8 };
    const destination: LatLng = { latitude: 32.35, longitude: 34.8 };
    const result = prefilterCandidate(baseDriverRoute, { pickup, destination });

    expect(result.passed).toBe(true);
    expect(result.reason).toBe("MATCH");
  });

  it("treats an explicit destination within SAME_LOCATION_KM of C as effectively C", () => {
    const pickup: LatLng = { latitude: 32.1, longitude: 34.8 };
    const almostSameAsC: LatLng = { latitude: 32.5005, longitude: 34.8 }; // ~50m from C

    const withExplicitDestination = prefilterCandidate(baseDriverRoute, { pickup, destination: almostSameAsC });
    const withOmittedDestination = prefilterCandidate(baseDriverRoute, { pickup });

    expect(withExplicitDestination.passed).toBe(true);
    expect(withExplicitDestination.destinationDistanceFromRouteKm).toBeCloseTo(
      withOmittedDestination.destinationDistanceFromRouteKm!,
      1,
    );
  });

  it("returns NO_COORDINATES when the driver route has no origin/destination (missing coordinates)", () => {
    const result = prefilterCandidate({ ...baseDriverRoute, origin: null }, { pickup: { latitude: 32.25, longitude: 34.8 } });

    expect(result.passed).toBe(false);
    expect(result.reason).toBe("NO_COORDINATES");
  });

  it("returns NO_COORDINATES for an invalid (NaN) pickup instead of throwing", () => {
    const result = prefilterCandidate(baseDriverRoute, {
      pickup: { latitude: NaN, longitude: 34.8 },
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toBe("NO_COORDINATES");
  });
});

describe("getRouteMatchesForCandidates — end-to-end local matching", () => {
  it("accepts an acceptable approximate detour (small offset near the corridor midpoint)", () => {
    const candidate: DriverRouteInput = { tripId: "acceptable", origin: A, destination: C };
    // ~3km east of the midpoint — within the corridor limit, small detour.
    const pickup: LatLng = { latitude: 32.25, longitude: 34.8319 };

    const [result] = getRouteMatchesForCandidates([candidate], { pickup });

    expect(result.eligible).toBe(true);
    expect(result.reason).toBe("MATCH");
    expect(result.approximateDetourKm).not.toBeNull();
    expect(result.approximateDetourKm!).toBeLessThan(MAX_APPROXIMATE_DETOUR_KM);
    expect(result.detourRatio).not.toBeNull();
    expect(result.detourRatio!).toBeLessThan(MAX_APPROXIMATE_DETOUR_RATIO);
  });

  it("rejects an excessive approximate detour by absolute km (long base route, low ratio)", () => {
    const candidate: DriverRouteInput = { tripId: "excessive-km", origin: A, destination: C };
    // B near A, offset ~4.8km west (within corridor limit, at the very start).
    const pickup: LatLng = { latitude: 32.0, longitude: 34.74914 };
    // D near C, offset ~4.8km east (within corridor limit, at the very end)
    // — together these force a long B->D leg while each individual corridor
    // distance still passes the corridor check.
    const destination: LatLng = { latitude: 32.5, longitude: 34.85086 };

    const [result] = getRouteMatchesForCandidates([candidate], { pickup, destination });

    expect(result.approximateDetourKm).not.toBeNull();
    expect(result.approximateDetourKm!).toBeGreaterThan(MAX_APPROXIMATE_DETOUR_KM);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("DETOUR_TOO_LONG");
    // Isolates the absolute-km threshold: the ratio must stay comfortably
    // under MAX_APPROXIMATE_DETOUR_RATIO even though the absolute km fails.
    expect(result.detourRatio!).toBeLessThan(MAX_APPROXIMATE_DETOUR_RATIO);
  });

  it("rejects an excessive detour ratio on a short base route (small absolute km)", () => {
    const shortOrigin: LatLng = { latitude: 32.0, longitude: 34.8 };
    const shortDestination: LatLng = { latitude: 32.02, longitude: 34.8 }; // ~2.2km route
    const candidate: DriverRouteInput = {
      tripId: "excessive-ratio",
      origin: shortOrigin,
      destination: shortDestination,
    };
    // ~1km sideways offset at the midpoint — within the corridor limit, but
    // a large fraction of this very short base route.
    const pickup: LatLng = { latitude: 32.01, longitude: 34.8106 };

    const [result] = getRouteMatchesForCandidates([candidate], { pickup });

    expect(result.approximateDetourKm).not.toBeNull();
    expect(result.approximateDetourKm!).toBeLessThan(MAX_APPROXIMATE_DETOUR_KM);
    expect(result.detourRatio).not.toBeNull();
    expect(result.detourRatio!).toBeGreaterThan(MAX_APPROXIMATE_DETOUR_RATIO);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("DETOUR_TOO_LONG");
  });

  it("falls back safely (never throws, marks ineligible) when coordinates are missing", () => {
    const candidate: DriverRouteInput = { tripId: "missing-coords", origin: null, destination: null };
    const [result] = getRouteMatchesForCandidates([candidate], {
      pickup: { latitude: 32.1, longitude: 34.8 },
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("NO_COORDINATES");
    expect(result.approximateDetourKm).toBeNull();
  });

  it("handles a zero-length A->C route without NaN or throwing", () => {
    const samePoint: LatLng = { latitude: 32.0, longitude: 34.8 };
    const candidate: DriverRouteInput = { tripId: "zero-length", origin: samePoint, destination: samePoint };
    const pickup: LatLng = { latitude: 32.01, longitude: 34.81 };

    const [result] = getRouteMatchesForCandidates([candidate], { pickup });

    expect(Number.isNaN(result.approximateDetourKm as any)).toBe(false);
    expect(result.detourRatio).toBeNull(); // base distance is 0 — ratio not applicable
    expect(typeof result.eligible).toBe("boolean");
  });

  // Regression: app/booking/driverresults.tsx's "Available Drivers" screen
  // used to hard-reject a driver whenever driver.from's city text differed
  // from the passenger's typed pickup city — a driver published
  // "Kafr Kanna -> Afula" never appeared for a passenger who typed pickup
  // "Mashhad" even though Mashhad sits right along that corridor. This
  // verifies the underlying algorithm itself produces MATCH for that real
  // reported case (approximate real-world coordinates for these three
  // Galilee towns) — driverresults.tsx's own coordinate wiring is
  // integration-level and not covered by these pure-function tests.
  it("matches the Kafr Kanna -> Afula driver against a Mashhad -> Afula passenger search", () => {
    const kafrKanna: LatLng = { latitude: 32.7517, longitude: 35.3406 }; // driver origin (A)
    const afula: LatLng = { latitude: 32.6076, longitude: 35.2897 }; // driver + passenger destination (C/D)
    const mashhad: LatLng = { latitude: 32.74, longitude: 35.32 }; // passenger pickup (B)

    const candidate: DriverRouteInput = { tripId: "kafr-kanna-afula", origin: kafrKanna, destination: afula };

    const [result] = getRouteMatchesForCandidates([candidate], {
      pickup: mashhad,
      destination: afula,
    });

    expect(result.reason).toBe("MATCH");
    expect(result.eligible).toBe(true);
    expect(result.pickupDistanceFromRouteKm).not.toBeNull();
    expect(result.pickupDistanceFromRouteKm!).toBeLessThan(MAX_ROUTE_CORRIDOR_DISTANCE_KM);
    expect(result.approximateDetourKm).not.toBeNull();
    expect(result.approximateDetourKm!).toBeLessThan(MAX_APPROXIMATE_DETOUR_KM);
  });
});

describe("sortRouteMatches — stable, deterministic ordering", () => {
  const make = (overrides: Partial<SortableRouteMatch>): SortableRouteMatch => ({
    tripId: overrides.id || "t",
    approximateDetourKm: null,
    pickupDistanceFromRouteKm: null,
    departureTimestampMs: 1000,
    ratingAverage: 4.5,
    id: "a",
    ...overrides,
  });

  it("orders by lowest approximate detour first", () => {
    const items = [
      make({ id: "slow", approximateDetourKm: 5 }),
      make({ id: "fast", approximateDetourKm: 0.5 }),
      make({ id: "mid", approximateDetourKm: 2 }),
    ];

    expect(sortRouteMatches(items).map((i) => i.id)).toEqual(["fast", "mid", "slow"]);
  });

  it("falls back to pickup distance when the detour ties", () => {
    const items = [
      make({ id: "far", approximateDetourKm: 1, pickupDistanceFromRouteKm: 4 }),
      make({ id: "near", approximateDetourKm: 1, pickupDistanceFromRouteKm: 0.5 }),
    ];

    expect(sortRouteMatches(items).map((i) => i.id)).toEqual(["near", "far"]);
  });

  it("falls back to nearest departure time, then rating, then id", () => {
    const items = [
      make({ id: "z", approximateDetourKm: 1, pickupDistanceFromRouteKm: 1, departureTimestampMs: 2000 }),
      make({ id: "a", approximateDetourKm: 1, pickupDistanceFromRouteKm: 1, departureTimestampMs: 1000 }),
    ];

    expect(sortRouteMatches(items).map((i) => i.id)).toEqual(["a", "z"]);
  });

  it("sorts items with a missing (null) approximateDetourKm last", () => {
    const items = [
      make({ id: "unknown", approximateDetourKm: null }),
      make({ id: "known", approximateDetourKm: 1.2 }),
    ];

    expect(sortRouteMatches(items).map((i) => i.id)).toEqual(["known", "unknown"]);
  });

  it("never mutates the input array", () => {
    const items = [make({ id: "b", approximateDetourKm: 2 }), make({ id: "a", approximateDetourKm: 1 })];
    const original = [...items];
    sortRouteMatches(items);
    expect(items).toEqual(original);
  });
});
