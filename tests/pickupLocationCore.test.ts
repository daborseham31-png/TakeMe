// ---------------------------------------------------------------------------
// Regression tests for app/booking/pickupLocationCore.ts — the pure logic
// backing "add the requester's pickup area/location to Personal Ride and
// Work requests":
//   - normalizePickupLocationSafe must never throw on old documents written
//     before these fields existed (must render "Pickup location not
//     provided" instead of crashing — this feature's own acceptance test).
//   - computeApproxDistanceKm must only ever report a distance when BOTH
//     the passenger's pickup point and the driver's route origin have real
//     coordinates, never a guess from partial data.
//
// pickupLocationCore.ts is deliberately dependency-free (no react-native/
// firebase/expo-location) so it can be imported under this project's plain-
// Node vitest config — see that file's own header for the same constraint
// documented on weeklyBookingCore.ts/driverNoShowCore.ts.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import {
  computeApproxDistanceKm,
  haversineKm,
  normalizePickupLocationSafe,
} from "../app/booking/pickupLocationCore";

describe("normalizePickupLocationSafe", () => {
  it("returns null for undefined/null input (old document, field never written)", () => {
    expect(normalizePickupLocationSafe(undefined)).toBeNull();
    expect(normalizePickupLocationSafe(null)).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(normalizePickupLocationSafe("some string")).toBeNull();
    expect(normalizePickupLocationSafe(42)).toBeNull();
  });

  it("returns null for an empty object (nothing to show)", () => {
    expect(normalizePickupLocationSafe({})).toBeNull();
  });

  it("normalizes a fully-populated pickup location", () => {
    const result = normalizePickupLocationSafe({
      latitude: 32.0853,
      longitude: 34.7818,
      address: "123 Dizengoff St",
      area: "Tel Aviv",
      source: "custom",
    });
    expect(result).toEqual({
      latitude: 32.0853,
      longitude: 34.7818,
      address: "123 Dizengoff St",
      area: "Tel Aviv",
      source: "custom",
    });
  });

  it("defaults a missing/invalid source to 'custom'", () => {
    const result = normalizePickupLocationSafe({ address: "Some address" });
    expect(result?.source).toBe("custom");
  });

  it("preserves 'current' and 'home' sources", () => {
    expect(normalizePickupLocationSafe({ area: "Haifa", source: "current" })?.source).toBe("current");
    expect(normalizePickupLocationSafe({ area: "Haifa", source: "home" })?.source).toBe("home");
  });

  it("treats non-finite or non-numeric latitude/longitude as absent, not a crash", () => {
    const result = normalizePickupLocationSafe({
      latitude: Number.NaN,
      longitude: "34.78",
      address: "Fallback address",
    });
    expect(result).toEqual({
      latitude: null,
      longitude: null,
      address: "Fallback address",
      area: "",
      source: "custom",
    });
  });

  it("normalizes legacy/partial documents without throwing", () => {
    expect(() => normalizePickupLocationSafe({ latitude: 32.1 })).not.toThrow();
    const result = normalizePickupLocationSafe({ latitude: 32.1 });
    expect(result).toEqual({
      latitude: 32.1,
      longitude: null,
      address: "",
      area: "",
      source: "custom",
    });
  });

  it("returns a value when only area/address text is present, even with no coordinates", () => {
    const result = normalizePickupLocationSafe({ area: "Jerusalem" });
    expect(result).toEqual({
      latitude: null,
      longitude: null,
      address: "",
      area: "Jerusalem",
      source: "custom",
    });
  });
});

describe("haversineKm", () => {
  it("returns 0 for identical points", () => {
    const point = { latitude: 32.0853, longitude: 34.7818 };
    expect(haversineKm(point, point)).toBeCloseTo(0, 5);
  });

  it("computes a known real-world distance (Tel Aviv to Jerusalem, ~54km great-circle)", () => {
    const telAviv = { latitude: 32.0853, longitude: 34.7818 };
    const jerusalem = { latitude: 31.7683, longitude: 35.2137 };
    const km = haversineKm(telAviv, jerusalem);
    expect(km).toBeGreaterThan(50);
    expect(km).toBeLessThan(58);
  });

  it("is symmetric", () => {
    const a = { latitude: 32.0853, longitude: 34.7818 };
    const b = { latitude: 31.7683, longitude: 35.2137 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10);
  });
});

describe("computeApproxDistanceKm", () => {
  it("returns null when pickup is null/undefined", () => {
    expect(computeApproxDistanceKm(null, { latitude: 32.08, longitude: 34.78 })).toBeNull();
    expect(computeApproxDistanceKm(undefined, { latitude: 32.08, longitude: 34.78 })).toBeNull();
  });

  it("returns null when driverOrigin is null/undefined", () => {
    expect(computeApproxDistanceKm({ latitude: 32.08, longitude: 34.78 }, null)).toBeNull();
    expect(computeApproxDistanceKm({ latitude: 32.08, longitude: 34.78 }, undefined)).toBeNull();
  });

  it("returns null when pickup coordinates are missing (area-only / no GPS selected)", () => {
    expect(
      computeApproxDistanceKm(
        { latitude: null, longitude: null },
        { latitude: 32.08, longitude: 34.78 },
      ),
    ).toBeNull();
  });

  it("returns null when driverOrigin coordinates are missing (route has no origin snapshot)", () => {
    expect(
      computeApproxDistanceKm(
        { latitude: 32.08, longitude: 34.78 },
        { latitude: null, longitude: null },
      ),
    ).toBeNull();
  });

  it("returns a rounded-to-one-decimal distance when both sides have coordinates", () => {
    const km = computeApproxDistanceKm(
      { latitude: 32.0853, longitude: 34.7818 },
      { latitude: 31.7683, longitude: 35.2137 },
    );
    expect(km).not.toBeNull();
    expect(km).toBeGreaterThan(50);
    expect(km).toBeLessThan(58);
    expect(km).toBe(Math.round((km as number) * 10) / 10);
  });

  it("returns 0 when pickup and driver origin are the same point", () => {
    const point = { latitude: 32.0853, longitude: 34.7818 };
    expect(computeApproxDistanceKm(point, point)).toBe(0);
  });
});
