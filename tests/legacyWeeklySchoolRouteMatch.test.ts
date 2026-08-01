// ---------------------------------------------------------------------------
// Regression tests completing the legacy weekly School Ride route-matching
// integration: app/booking/school/LegacySchoolSearchForm.tsx now collects a
// real GPS pickup point (via the shared PickupLocationPicker — the exact
// same component Personal Ride uses) and forwards it to
// app/booking/driverresults.tsx as `pickupLat`/`pickupLng` route params —
// the SAME param names driverresults.tsx already read (see its own
// ROUTE_MATCH_CATEGORIES gate, which already covered "school", added in an
// earlier change). This file proves the underlying algorithm behaves
// correctly for that now-completed data flow, mirroring EXACTLY what
// driverresults.tsx's route-matching gate does for a legacy `driverRoutes`
// School document:
//   A = driver.fromLat/fromLng, C = driver.toLat/toLng, B = passenger
//   pickup (from PickupLocationPicker, via toFiniteCoordinate-safe params).
//
// driverresults.tsx itself is a React screen (pulls in react-native) and is
// not importable under vitest — see this project's other *.test.ts files'
// own headers for the same constraint. These tests call routeMatchLib.ts
// directly with the exact same inputs driverresults.tsx would build, never
// duplicating its Haversine/projection/corridor/detour logic.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import {
  DriverRouteInput,
  getRouteMatchesForCandidates,
  LatLng,
  MAX_APPROXIMATE_DETOUR_KM,
  MAX_ROUTE_CORRIDOR_DISTANCE_KM,
  projectOntoCorridor,
  toFiniteCoordinate,
} from "../app/booking/routeMatchLib";

// A legacy weekly School driverRoutes document — origin far from the
// student's own village, destination is the school area (see
// israelLocations.ts's real "afula" entry, reused here). Same shape
// driverresults.tsx reads: fromLat/fromLng/toLat/toLng, possibly numeric
// strings on older documents (see toFiniteCoordinate).
const legacySchoolDriverDoc = {
  id: "legacy-school-trip-1",
  fromLat: 32.7517, // Kafr Kanna-like village
  fromLng: 35.3406,
  toLat: 32.6076, // Afula-like school area
  toLng: 35.2897,
};

// Simulates driverresults.tsx's own toFiniteCoordinate-based candidate
// construction for a single legacy School driverRoutes doc — the exact
// shape it builds into `routeMatchInputs`, not a re-implementation of the
// matching algorithm itself.
function buildCandidate(doc: {
  id: string;
  fromLat: unknown;
  fromLng: unknown;
  toLat: unknown;
  toLng: unknown;
}): DriverRouteInput | null {
  const originLat = toFiniteCoordinate(doc.fromLat);
  const originLng = toFiniteCoordinate(doc.fromLng);
  const destLat = toFiniteCoordinate(doc.toLat);
  const destLng = toFiniteCoordinate(doc.toLng);

  if (originLat === null || originLng === null || destLat === null || destLng === null) {
    return null;
  }

  return {
    tripId: doc.id,
    origin: { latitude: originLat, longitude: originLng },
    destination: { latitude: destLat, longitude: destLng },
  };
}

describe("Legacy weekly School Ride — pickup coordinates now activate route matching", () => {
  it("1. a valid pickup point (from the search form's PickupLocationPicker) is used for route matching, not just city text", () => {
    // Same coordinates the search form would send as pickupLat/pickupLng
    // route params (strings, per useLocalSearchParams) — close to the
    // driver's A->C corridor but in a DIFFERENT village than the driver's
    // own origin.
    const pickupLatParam = "32.74";
    const pickupLngParam = "35.32";

    const pickup: LatLng = {
      latitude: toFiniteCoordinate(pickupLatParam)!,
      longitude: toFiniteCoordinate(pickupLngParam)!,
    };

    const candidate = buildCandidate(legacySchoolDriverDoc);
    expect(candidate).not.toBeNull();

    const [result] = getRouteMatchesForCandidates([candidate!], { pickup });

    expect(result.reason).toBe("MATCH");
    expect(result.eligible).toBe(true);
  });

  it("2. a driver starting in a different village still appears when the student's home is close to the route to the same school", () => {
    const driverOrigin: LatLng = { latitude: legacySchoolDriverDoc.fromLat, longitude: legacySchoolDriverDoc.fromLng };
    const school: LatLng = { latitude: legacySchoolDriverDoc.toLat, longitude: legacySchoolDriverDoc.toLng };
    const studentHome: LatLng = { latitude: 32.74, longitude: 35.32 };

    // The driver's own village and the student's home are genuinely far
    // apart in a straight line — the whole point of this feature (the old
    // exact-city-text/origin-distance rule would have hard-rejected this).
    const directDistanceKm = haversineKmForAssertionOnly(driverOrigin, studentHome);
    expect(directDistanceKm).toBeGreaterThan(2);

    const candidate = buildCandidate(legacySchoolDriverDoc);
    const [result] = getRouteMatchesForCandidates([candidate!], { pickup: studentHome });

    expect(result.eligible).toBe(true);
    expect(result.approximateDetourKm).not.toBeNull();
    expect(result.approximateDetourKm!).toBeLessThan(MAX_APPROXIMATE_DETOUR_KM);
  });

  it("3. a student far from the driver's route is rejected", () => {
    const farPickup: LatLng = { latitude: 32.7, longitude: 35.9 };

    const candidate = buildCandidate(legacySchoolDriverDoc);
    const [result] = getRouteMatchesForCandidates([candidate!], { pickup: farPickup });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("TOO_FAR_FROM_ROUTE");
  });

  it("4. the same selected home location correctly serves as the passenger point for the driver's one route, in either travel direction", () => {
    // The legacy driverRoutes School system has no separate outbound/return
    // trip documents (unlike the new schoolTrips collection) — one weekly
    // route serves both the morning pickup and the afternoon drop-off, so
    // LegacySchoolSearchForm.tsx deliberately reuses the SAME selected
    // pickup location for both. This proves the corridor-distance check
    // (which decides eligibility) is symmetric — the same physical point is
    // equally "close to the route" whether the route is walked A->C or
    // C->A — so reusing one location for both directions is geometrically
    // sound, never a mismatch.
    const origin: LatLng = { latitude: legacySchoolDriverDoc.fromLat, longitude: legacySchoolDriverDoc.fromLng };
    const destination: LatLng = { latitude: legacySchoolDriverDoc.toLat, longitude: legacySchoolDriverDoc.toLng };
    const studentHome: LatLng = { latitude: 32.74, longitude: 35.32 };

    const forward = projectOntoCorridor(origin, destination, studentHome);
    const reversed = projectOntoCorridor(destination, origin, studentHome);

    // Perpendicular corridor distance is nearly identical regardless of
    // which end is treated as the start — only the progress fraction flips.
    // Not EXACTLY identical: projectOntoCorridor's local-plane approximation
    // is centered on whichever point is passed as `origin`, so forward
    // (centered on A) and reversed (centered on C) use very slightly
    // different degrees-to-km scaling — an expected, documented accuracy
    // characteristic of the equirectangular approximation (see
    // routeMatchLib.ts's own header), not a bug. The gap here is ~2m over a
    // ~16km route.
    expect(
      Math.abs(forward.distanceFromCorridorKm - reversed.distanceFromCorridorKm),
    ).toBeLessThan(0.01);
    expect(forward.progress).toBeCloseTo(1 - reversed.progress, 2);
  });

  it("5. missing driver coordinates fall back safely — no throw, no crash, candidate simply excluded from route matching", () => {
    const incompleteDoc = {
      id: "legacy-school-trip-missing-coords",
      fromLat: undefined,
      fromLng: undefined,
      toLat: legacySchoolDriverDoc.toLat,
      toLng: legacySchoolDriverDoc.toLng,
    };

    // Mirrors driverresults.tsx's own behavior exactly: a driver missing
    // any of the four coordinates never becomes a route-matching candidate
    // at all (returns null here) — the caller's existing from/to text
    // matching applies instead, unchanged. This never throws.
    expect(() => buildCandidate(incompleteDoc)).not.toThrow();
    expect(buildCandidate(incompleteDoc)).toBeNull();
  });

  it("5b. a numeric-string coordinate (some legacy Firestore documents) is still handled safely", () => {
    const stringCoordDoc = {
      id: "legacy-school-trip-string-coords",
      fromLat: "32.7517",
      fromLng: "35.3406",
      toLat: "32.6076",
      toLng: "35.2897",
    };

    const candidate = buildCandidate(stringCoordDoc);
    expect(candidate).not.toBeNull();
    expect(candidate!.origin).toEqual({ latitude: 32.7517, longitude: 35.3406 });

    const [result] = getRouteMatchesForCandidates([candidate!], {
      pickup: { latitude: 32.74, longitude: 35.32 },
    });
    expect(result.eligible).toBe(true);
  });
});

// Test-only helper (mirrors the same formula used throughout this project's
// other test files) — used purely to assert the two scenario points really
// are far apart, never to test routeMatchLib.ts's own private haversine.
function haversineKmForAssertionOnly(a: LatLng, b: LatLng): number {
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

describe("MAX_ROUTE_CORRIDOR_DISTANCE_KM sanity (shared threshold, not a new School-only constant)", () => {
  it("the far-pickup rejection above is genuinely outside the shared corridor threshold", () => {
    const farPickup: LatLng = { latitude: 32.7, longitude: 35.9 };
    const origin: LatLng = { latitude: legacySchoolDriverDoc.fromLat, longitude: legacySchoolDriverDoc.fromLng };
    const destination: LatLng = { latitude: legacySchoolDriverDoc.toLat, longitude: legacySchoolDriverDoc.toLng };

    const projection = projectOntoCorridor(origin, destination, farPickup);
    expect(projection.distanceFromCorridorKm).toBeGreaterThan(MAX_ROUTE_CORRIDOR_DISTANCE_KM);
  });
});
