// ---------------------------------------------------------------------------
// Cross-platform drop-in replacement for Location.reverseGeocodeAsync.
//
// expo-location's Web shim has no reverse geocoder — it always throws
// (see node_modules/expo-location/src/ExpoLocation.web.ts:165-167). That's
// the reason every screen that resolves a readable address for a GPS fix or
// map tap silently falls back to raw "lat, lng" text on Web: the existing
// try/catch around Location.reverseGeocodeAsync was written for the native
// OS geocoder (which works fine), and simply has nothing to fall back to on
// Web.
//
// On Web this calls Nominatim, OpenStreetMap's own free, keyless
// reverse-geocoding API — chosen to match this app's existing OSM-only Web
// map (components/PlatformMapView.web.tsx) rather than mixing in a paid
// provider, and normalized into the same LocationGeocodedAddress shape
// native returns, so every existing call site's field access
// (place.name/street/city/region/...) and its own fallback-to-coordinates
// handling keeps working completely unchanged.
//
// Nominatim's usage policy caps public, unauthenticated use at ~1 request/
// second and prohibits it as a backend for typed-search autocomplete (bulk,
// keystroke-driven traffic) — this file only ever calls it for reverse
// geocoding of discrete, user-committed points (GPS fix / map tap / drag
// end), never for autocomplete, and the throttling below keeps it under
// that rate even if a caller taps rapidly. None of this applies to native,
// which keeps calling Location.reverseGeocodeAsync directly, unwrapped.
// ---------------------------------------------------------------------------
import * as Location from "expo-location";
import { Platform } from "react-native";

const EMPTY_PLACE: Location.LocationGeocodedAddress = {
  city: null,
  district: null,
  streetNumber: null,
  street: null,
  region: null,
  subregion: null,
  country: null,
  postalCode: null,
  name: null,
  isoCountryCode: null,
  timezone: null,
  formattedAddress: null,
};

// A "road" tag that's just digits (e.g. "4009") is a municipal
// house-numbering code, not a real street name — common in parts of Israel
// (Nazareth among them) that address buildings without named streets. Shown
// on its own it's meaningless ("4009, Nazareth"); paired with whatever
// neighbourhood/quarter Nominatim also has for the point, it's actually
// useful. Generic field-shape logic, not a per-city rule — no city name is
// ever hardcoded.
const isBareNumericRoad = (road: string | null): boolean => !!road && /^\d+$/.test(road.trim());

const buildPlaceName = (a: Record<string, string | undefined>): string | null => {
  const road: string | null = a.road || null;
  const houseNumber: string | null = a.house_number || null;
  const neighbourhood: string | null = a.neighbourhood || a.quarter || a.suburb || null;

  if (road && !isBareNumericRoad(road)) {
    // A real, named street — closest match to native's own "name" richness.
    return [houseNumber, road].filter(Boolean).join(" ");
  }
  if (road && neighbourhood) {
    // Numeric road code — pair it with the neighbourhood for context
    // instead of showing the bare number.
    return `${road}, ${neighbourhood}`;
  }
  return road || neighbourhood || a.amenity || null;
};

const reverseGeocodeWebFetch = async (
  latitude: number,
  longitude: number,
): Promise<Location.LocationGeocodedAddress[]> => {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
    `&lat=${latitude}&lon=${longitude}&zoom=17&addressdetails=1`;

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Nominatim reverse geocode failed: ${response.status}`);

  const data = await response.json();
  const a = data?.address || {};

  const name = buildPlaceName(a);
  const street: string | null = a.road || null;
  const streetNumber: string | null = a.house_number || null;
  const city: string | null = a.city || a.town || a.village || a.municipality || null;
  const district: string | null = a.suburb || a.city_district || null;
  const region: string | null = a.state || null;
  const subregion: string | null = a.county || a.district || null;
  const country: string | null = a.country || null;
  const formattedAddress: string | null = typeof data?.display_name === "string" ? data.display_name : null;

  if (!name && !city && !region && !formattedAddress) return [];

  return [{ ...EMPTY_PLACE, name, street, streetNumber, city, district, region, subregion, country, formattedAddress }];
};

// ---------------------------------------------------------------------------
// Web-only throttling/cache/dedup layer in front of the raw fetch above.
// ---------------------------------------------------------------------------

// Comfortably under Nominatim's ~1 req/sec policy.
const MIN_REQUEST_INTERVAL_MS = 1100;
// ~11m — coarse enough that a drag/tap's natural jitter or a near-repeat of
// the same point reuses one result, fine enough that genuinely different
// taps (this app's points are typically many meters to kilometers apart)
// are never merged.
const CACHE_COORD_PRECISION = 4;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 50;

const cacheKey = (latitude: number, longitude: number) =>
  `${latitude.toFixed(CACHE_COORD_PRECISION)},${longitude.toFixed(CACHE_COORD_PRECISION)}`;

const cache = new Map<string, { result: Location.LocationGeocodedAddress[]; expiresAt: number }>();
const inFlight = new Map<string, Promise<Location.LocationGeocodedAddress[]>>();

let lastRequestAt = 0;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPoint: { latitude: number; longitude: number } | null = null;
let pendingResolve: ((result: Location.LocationGeocodedAddress[]) => void) | null = null;

const rememberResult = (key: string, result: Location.LocationGeocodedAddress[]) => {
  cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  if (cache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
};

const fetchNow = (latitude: number, longitude: number): Promise<Location.LocationGeocodedAddress[]> => {
  const key = cacheKey(latitude, longitude);
  lastRequestAt = Date.now();

  const promise = reverseGeocodeWebFetch(latitude, longitude)
    .then((result) => {
      rememberResult(key, result);
      return result;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
};

const reverseGeocodeWeb = (
  latitude: number,
  longitude: number,
): Promise<Location.LocationGeocodedAddress[]> => {
  const key = cacheKey(latitude, longitude);

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.result);
  }

  const existingRequest = inFlight.get(key);
  if (existingRequest) return existingRequest;

  const elapsed = Date.now() - lastRequestAt;
  if (elapsed >= MIN_REQUEST_INTERVAL_MS && !pendingTimer) {
    return fetchNow(latitude, longitude);
  }

  // Firing now would exceed the minimum interval. Rather than queue a
  // second delayed request behind whatever's already waiting, supersede
  // it: the caller's own race-guard (addressRequestRef in
  // PickupLocationPicker.tsx / roadside-help/index.tsx) already discards
  // any response whose request token is no longer current, so a point
  // that gets overtaken by a newer one is never shown even if fetched —
  // resolving it to "no result" immediately just avoids spending a
  // Nominatim request on it too, and keeps the eventual send anchored to
  // the first over-the-limit call rather than pushed back further by
  // every subsequent tap.
  if (pendingResolve) pendingResolve([]);
  pendingPoint = { latitude, longitude };

  return new Promise((resolve) => {
    pendingResolve = resolve;
    if (pendingTimer) return;

    const wait = Math.max(0, MIN_REQUEST_INTERVAL_MS - elapsed);
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      const resolveLatest = pendingResolve;
      const point = pendingPoint;
      pendingResolve = null;
      pendingPoint = null;
      if (!point || !resolveLatest) return;

      fetchNow(point.latitude, point.longitude)
        .then((result) => resolveLatest(result))
        .catch(() => resolveLatest([]));
    }, wait);
  });
};

export const reverseGeocode = async (
  latitude: number,
  longitude: number,
): Promise<Location.LocationGeocodedAddress[]> => {
  if (Platform.OS === "web") {
    return reverseGeocodeWeb(latitude, longitude);
  }
  // Native is never throttled/cached/queued — straight through to the OS
  // geocoder, unchanged.
  return Location.reverseGeocodeAsync({ latitude, longitude });
};
