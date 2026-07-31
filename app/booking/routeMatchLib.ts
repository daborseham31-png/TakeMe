// ---------------------------------------------------------------------------
// Route-based / detour-aware ride matching — FULLY LOCAL, FREE geometric
// approximation. No network calls, no API key, no paid routing service, no
// Google Cloud billing of any kind. Every function here is pure and
// synchronous — safe to call directly from a render-time useMemo.
//
// Terms (see the feature's own spec): A = driver origin, C = driver
// destination, B = passenger pickup, D = passenger destination. The
// driver's own "route" is approximated as the STRAIGHT LINE segment A->C
// (no real road geometry is available without a paid routing API) — B is
// matched by projecting it onto that segment (Haversine distance + 2D
// geometric projection), and the detour is approximated as
// distance(A,B)+distance(B,C)-distance(A,C) (or the A->B->D->C variant when
// D is known and different from C).
//
// app/booking/homeFeedLib.ts is the only caller that wires this into the
// actual Home feed, and never the other way around (this file does not
// import homeFeedLib.ts, to avoid a circular import — see its own
// DriverRouteInput type below, a minimal shape homeFeedLib.ts maps its
// FeedItem into).
// ---------------------------------------------------------------------------

export type LatLng = { latitude: number; longitude: number };

// ---------------------------------------------------------------------------
// Configuration — every threshold this feature uses lives here, and only
// here. Never hardcode a competing copy of any of these in a component.
// ---------------------------------------------------------------------------

// How far (perpendicular distance, in km) a pickup or destination may be
// from the straight A->C corridor and still count as "on the way".
export const MAX_ROUTE_CORRIDOR_DISTANCE_KM = 5;

// Absolute cap on the approximate detour (extra km beyond the A->C
// distance) a trip may take on to pick up/drop off the passenger.
export const MAX_APPROXIMATE_DETOUR_KM = 8;

// Relative cap — the approximate detour, as a fraction of the driver's own
// A->C distance. Guards short trips where even a small absolute detour is a
// large percentage of the ride (e.g. a 2km base ride with a 6km detour).
export const MAX_APPROXIMATE_DETOUR_RATIO = 0.25;

// How far B's normalized progress along A->C may fall outside the [0, 1]
// range (as a fraction of the segment's own length) and still be treated as
// "approximately between A and C" — absorbs GPS noise and slightly
// off-corridor pickups right near the start/end, never enough to accept a
// genuinely reversed/backward pickup.
export const ROUTE_PROGRESS_TOLERANCE = 0.05;

// "Is D effectively the same place as C" — expressed in km since this file
// otherwise works in km throughout.
export const SAME_LOCATION_KM = 0.15;

// Below this A->C length, the base route is treated as a single point (a
// driver whose origin and destination are ~the same place) rather than a
// direction — see projectOntoCorridor below.
const MIN_CORRIDOR_LENGTH_KM = 0.01; // 10 meters

// ---------------------------------------------------------------------------
// Result type (adapted to this project's existing null-over-undefined,
// explicit-reason convention — see homeFeedLib.ts's own FeedItem). No
// duration field anywhere in this file: without a real road-routing service,
// a time estimate would just be fabricated, so only approximate DISTANCE
// (clearly a straight-line approximation, never presented as a real ETA) is
// ever produced.
// ---------------------------------------------------------------------------

export type RouteMatchReason =
  | "MATCH"
  | "NO_COORDINATES"
  | "TOO_FAR_FROM_ROUTE"
  | "WRONG_DIRECTION"
  | "DETOUR_TOO_LONG"
  | "DESTINATION_MISMATCH"
  | "NO_SEATS"
  | "EXPIRED";

export type RouteMatchResult = {
  tripId: string;
  eligible: boolean;
  pickupDistanceFromRouteKm: number | null;
  destinationDistanceFromRouteKm: number | null;
  // Straight-line approximation of the extra distance the driver would
  // travel to serve this passenger — see calculateApproximateDetourKm below.
  // Never a real road-network detour; always clamped to >= 0.
  approximateDetourKm: number | null;
  detourRatio: number | null;
  reason: RouteMatchReason;
};

// The minimal, framework-agnostic shape this module needs from a driver's
// trip — homeFeedLib.ts maps its own FeedItem into this. Both origin and
// destination are null for a listing that predates coordinate-saving (or
// whose coordinates failed to resolve) — the caller (homeFeedLib.ts) falls
// back to the existing plain origin-distance behavior instead of ever
// constructing one of these with missing coordinates.
export type DriverRouteInput = {
  tripId: string;
  origin: LatLng | null;
  destination: LatLng | null;
};

export type PassengerRouteQuery = {
  pickup: LatLng;
  // Optional — see this file's header. Omitted today by Home's nearby feed
  // (D is treated as C); a future explicit search flow can pass a real D.
  destination?: LatLng | null;
};

// ---------------------------------------------------------------------------
// Geometry — Haversine distance + local-plane projection. No decoded
// polyline, no third-party geometry package: the "route" this file works
// with is always just the two-point A->C segment, so plain vector math is
// simpler and more transparent than pulling in a line-geometry library for
// a single segment.
// ---------------------------------------------------------------------------

// Straight-line (haversine, great-circle) distance in km — the ONE place
// every point-to-point distance in this file goes through. Deliberately NOT
// imported from homeFeedLib.ts's own calculateDistanceKm (identical
// formula) — that would make this file depend on homeFeedLib.ts, which
// depends on THIS file, a circular import.
function haversineKm(a: LatLng, b: LatLng): number {
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

export const isEffectivelySameLocation = (a: LatLng, b: LatLng): boolean =>
  haversineKm(a, b) <= SAME_LOCATION_KM;

// Guards every coordinate this module touches — catches both "missing"
// (null/undefined) and "invalid" (NaN, out-of-range) values in one check, so
// callers never need two separate guards.
export function isValidLatLng(point: LatLng | null | undefined): point is LatLng {
  if (!point) return false;
  const { latitude, longitude } = point;
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

// Coordinates read from Firestore should always be numbers, but some
// documents (or route params, which arrive as strings via
// useLocalSearchParams) may carry a numeric string instead — this is the
// ONE place that safely coerces either shape into a real number, or null
// for anything else (missing, empty string, non-numeric text). Never
// throws.
export function toFiniteCoordinate(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

// Small equirectangular local-plane approximation, centered on `origin` —
// accurate enough for the short (regional, well under a few hundred km)
// distances this app deals with; see this file's own header / the final
// report's "accuracy limitations" note for why this is a deliberate
// trade-off rather than an oversight.
const toLocalPlaneKm = (origin: LatLng, point: LatLng): { x: number; y: number } => {
  const latRad = (origin.latitude * Math.PI) / 180;
  const kmPerDegLat = 110.574;
  const kmPerDegLng = 111.32 * Math.cos(latRad);
  return {
    x: (point.longitude - origin.longitude) * kmPerDegLng,
    y: (point.latitude - origin.latitude) * kmPerDegLat,
  };
};

export type CorridorProjection = {
  // Perpendicular distance from `target` to the nearest point on the A->C
  // segment (clamped to the segment itself, not the infinite line).
  distanceFromCorridorKm: number;
  // `target`'s normalized progress along A->C: 0 = at A, 1 = at C,
  // UNCLAMPED (so a value like -0.2 or 1.3 is how "significantly behind A" /
  // "well past C" is detected by the direction checks below).
  progress: number;
};

// Projects `target` onto the straight A->C segment. Never throws; a
// degenerate (near-zero-length) A->C segment — a driver whose origin and
// destination are ~the same place — falls back to plain point distance from
// A, with progress 0 (no meaningful direction to be "ahead" or "behind" on).
export function projectOntoCorridor(
  origin: LatLng,
  destination: LatLng,
  target: LatLng,
): CorridorProjection {
  const destXY = toLocalPlaneKm(origin, destination);
  const targetXY = toLocalPlaneKm(origin, target);

  const corridorLengthSq = destXY.x * destXY.x + destXY.y * destXY.y;

  if (corridorLengthSq < MIN_CORRIDOR_LENGTH_KM * MIN_CORRIDOR_LENGTH_KM) {
    return { distanceFromCorridorKm: haversineKm(origin, target), progress: 0 };
  }

  const dot = targetXY.x * destXY.x + targetXY.y * destXY.y;
  const progress = dot / corridorLengthSq;

  const clamped = Math.max(0, Math.min(1, progress));
  const nearestX = destXY.x * clamped;
  const nearestY = destXY.y * clamped;
  const dx = targetXY.x - nearestX;
  const dy = targetXY.y - nearestY;

  return { distanceFromCorridorKm: Math.sqrt(dx * dx + dy * dy), progress };
}

// ---------------------------------------------------------------------------
// Prefilter — corridor distance (Phase 3 equivalent) + direction validation
// (Phase 4 equivalent). Cheap, local, synchronous — the only kind of check
// this module ever does, now that there is no separate network-based Phase
// 5; the approximate detour check right below is just as local.
// ---------------------------------------------------------------------------

export type PrefilterResult = {
  passed: boolean;
  pickupDistanceFromRouteKm: number | null;
  destinationDistanceFromRouteKm: number | null;
  // "MATCH" here only means "prefilter passed" — final eligibility still
  // depends on the approximate detour check below.
  reason: RouteMatchReason;
};

export function prefilterCandidate(
  driverRoute: DriverRouteInput,
  query: PassengerRouteQuery,
): PrefilterResult {
  if (
    !isValidLatLng(driverRoute.origin) ||
    !isValidLatLng(driverRoute.destination) ||
    !isValidLatLng(query.pickup)
  ) {
    return {
      passed: false,
      pickupDistanceFromRouteKm: null,
      destinationDistanceFromRouteKm: null,
      reason: "NO_COORDINATES",
    };
  }

  const pickupProjection = projectOntoCorridor(
    driverRoute.origin,
    driverRoute.destination,
    query.pickup,
  );

  if (pickupProjection.distanceFromCorridorKm > MAX_ROUTE_CORRIDOR_DISTANCE_KM) {
    return {
      passed: false,
      pickupDistanceFromRouteKm: pickupProjection.distanceFromCorridorKm,
      destinationDistanceFromRouteKm: null,
      reason: "TOO_FAR_FROM_ROUTE",
    };
  }

  // B must lie approximately between A and C — reject if it's significantly
  // behind A (negative progress) or well past C (progress > 1), each beyond
  // ROUTE_PROGRESS_TOLERANCE.
  if (
    pickupProjection.progress < -ROUTE_PROGRESS_TOLERANCE ||
    pickupProjection.progress > 1 + ROUTE_PROGRESS_TOLERANCE
  ) {
    return {
      passed: false,
      pickupDistanceFromRouteKm: pickupProjection.distanceFromCorridorKm,
      destinationDistanceFromRouteKm: null,
      reason: "WRONG_DIRECTION",
    };
  }

  // D effectively equals C (explicit destination omitted, or genuinely the
  // same place) — validate against the driver's own destination C itself
  // rather than adding a redundant, always-passing check.
  const destinationTarget =
    query.destination && !isEffectivelySameLocation(query.destination, driverRoute.destination)
      ? query.destination
      : driverRoute.destination;

  if (!isValidLatLng(destinationTarget)) {
    return {
      passed: false,
      pickupDistanceFromRouteKm: pickupProjection.distanceFromCorridorKm,
      destinationDistanceFromRouteKm: null,
      reason: "NO_COORDINATES",
    };
  }

  const destinationProjection = projectOntoCorridor(
    driverRoute.origin,
    driverRoute.destination,
    destinationTarget,
  );

  if (destinationProjection.distanceFromCorridorKm > MAX_ROUTE_CORRIDOR_DISTANCE_KM) {
    return {
      passed: false,
      pickupDistanceFromRouteKm: pickupProjection.distanceFromCorridorKm,
      destinationDistanceFromRouteKm: destinationProjection.distanceFromCorridorKm,
      reason: "DESTINATION_MISMATCH",
    };
  }

  // Pickup must come before the destination along the corridor — never
  // require the driver to travel backwards to reach B after already having
  // passed D's position.
  if (pickupProjection.progress > destinationProjection.progress + ROUTE_PROGRESS_TOLERANCE) {
    return {
      passed: false,
      pickupDistanceFromRouteKm: pickupProjection.distanceFromCorridorKm,
      destinationDistanceFromRouteKm: destinationProjection.distanceFromCorridorKm,
      reason: "WRONG_DIRECTION",
    };
  }

  return {
    passed: true,
    pickupDistanceFromRouteKm: pickupProjection.distanceFromCorridorKm,
    destinationDistanceFromRouteKm: destinationProjection.distanceFromCorridorKm,
    reason: "MATCH",
  };
}

// ---------------------------------------------------------------------------
// Approximate detour — pure straight-line math, no network call. Handles
// zero/missing/invalid/NaN/negative values safely, never throws, never lets
// a bad number silently pass as eligible.
// ---------------------------------------------------------------------------

// distance(A,B) + distance(B,C) - distance(A,C), or the A->B->D->C variant
// when `passengerDestination` (D) is given and differs from C. Clamped to
// >= 0 — floating-point round-off could otherwise produce a tiny negative
// value for a pickup that is essentially exactly on the A->C line.
export function calculateApproximateDetourKm(
  origin: LatLng,
  pickup: LatLng,
  destination: LatLng,
  passengerDestination: LatLng | null,
): number {
  const baseKm = haversineKm(origin, destination);

  const withPickupKm = passengerDestination
    ? haversineKm(origin, pickup) +
      haversineKm(pickup, passengerDestination) +
      haversineKm(passengerDestination, destination)
    : haversineKm(origin, pickup) + haversineKm(pickup, destination);

  return Math.max(0, withPickupKm - baseKm);
}

export type ApproximateDetourInput = {
  baseDistanceKm: number;
  detourKm: number;
};

export type ApproximateDetourEvaluation = {
  passed: boolean;
  detourRatio: number | null;
};

export function evaluateApproximateDetour(
  input: ApproximateDetourInput,
): ApproximateDetourEvaluation {
  const detourKm = Number(input?.detourKm);
  const baseDistanceKm = Number(input?.baseDistanceKm);

  if (!Number.isFinite(detourKm) || detourKm < 0) {
    return { passed: false, detourRatio: null };
  }

  const detourRatio =
    Number.isFinite(baseDistanceKm) && baseDistanceKm > 0 ? detourKm / baseDistanceKm : null;

  if (detourKm > MAX_APPROXIMATE_DETOUR_KM) return { passed: false, detourRatio };
  if (detourRatio !== null && detourRatio > MAX_APPROXIMATE_DETOUR_RATIO) {
    return { passed: false, detourRatio };
  }

  return { passed: true, detourRatio };
}

// ---------------------------------------------------------------------------
// Sorting — lowest approximate detour, then lowest pickup-from-corridor
// distance, then nearest departure, then existing rating, then a fully
// deterministic id tie-break. A missing/null value is always sorted last
// within its own criterion (never treated as "0 = best").
// ---------------------------------------------------------------------------

export type SortableRouteMatch = {
  tripId: string;
  approximateDetourKm: number | null;
  pickupDistanceFromRouteKm: number | null;
  departureTimestampMs: number;
  ratingAverage: number;
  id: string;
};

export function sortRouteMatches<T extends SortableRouteMatch>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aDetour = a.approximateDetourKm ?? Number.POSITIVE_INFINITY;
    const bDetour = b.approximateDetourKm ?? Number.POSITIVE_INFINITY;
    if (aDetour !== bDetour) return aDetour - bDetour;

    const aPickup = a.pickupDistanceFromRouteKm ?? Number.POSITIVE_INFINITY;
    const bPickup = b.pickupDistanceFromRouteKm ?? Number.POSITIVE_INFINITY;
    if (aPickup !== bPickup) return aPickup - bPickup;

    if (a.departureTimestampMs !== b.departureTimestampMs) {
      return a.departureTimestampMs - b.departureTimestampMs;
    }

    if (a.ratingAverage !== b.ratingAverage) {
      return b.ratingAverage - a.ratingAverage; // higher rating first
    }

    return a.id.localeCompare(b.id);
  });
}

// ---------------------------------------------------------------------------
// Orchestration — prefilter, then (only for candidates that pass) the
// approximate detour check. Fully synchronous: no network, no cache, no
// concurrency limiter, no AbortController — there is nothing asynchronous
// left to cache, limit, or cancel. This is the one function homeFeedLib.ts
// calls; it never touches Firestore or React state itself.
// ---------------------------------------------------------------------------

export function getRouteMatchesForCandidates(
  candidates: DriverRouteInput[],
  query: PassengerRouteQuery,
): RouteMatchResult[] {
  return candidates.map((driverRoute): RouteMatchResult => {
    const prefilter = prefilterCandidate(driverRoute, query);

    if (!prefilter.passed) {
      return {
        tripId: driverRoute.tripId,
        eligible: false,
        pickupDistanceFromRouteKm: prefilter.pickupDistanceFromRouteKm,
        destinationDistanceFromRouteKm: prefilter.destinationDistanceFromRouteKm,
        approximateDetourKm: null,
        detourRatio: null,
        reason: prefilter.reason,
      };
    }

    // prefilterCandidate only returns passed: true when origin/destination/
    // pickup (and, if present, destinationTarget) are all valid LatLng
    // values — safe to assert non-null here.
    const origin = driverRoute.origin!;
    const destination = driverRoute.destination!;

    const passengerDestination =
      query.destination && !isEffectivelySameLocation(query.destination, destination)
        ? query.destination
        : null;

    const baseDistanceKm = haversineKm(origin, destination);
    const detourKm = calculateApproximateDetourKm(
      origin,
      query.pickup,
      destination,
      passengerDestination,
    );
    const detour = evaluateApproximateDetour({ baseDistanceKm, detourKm });

    return {
      tripId: driverRoute.tripId,
      eligible: detour.passed,
      pickupDistanceFromRouteKm: prefilter.pickupDistanceFromRouteKm,
      destinationDistanceFromRouteKm: prefilter.destinationDistanceFromRouteKm,
      approximateDetourKm: detourKm,
      detourRatio: detour.detourRatio,
      reason: detour.passed ? "MATCH" : "DETOUR_TOO_LONG",
    };
  });
}
