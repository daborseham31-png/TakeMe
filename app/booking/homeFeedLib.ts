// ---------------------------------------------------------------------------
// Home screen "Trips near you" feed — the ONE place that loads and combines
// available Personal Ride / School Ride / Work / Errand listings for
// discovery on Home. This is a read-only recommendation layer: it never
// creates a booking itself, it only prepares navigation params for the
// existing category screens (ride-payment, work apply, errand book) —
// see buildFeedItemNavigation below.
//
// Deliberately excluded: Roadside Help (passenger-initiated requests, not
// driver-created listings — doesn't fit "available trips/services to
// discover").
//
// Firestore reads: this mirrors the exact same "read the whole collection,
// filter client-side" pattern already used by driverresults.tsx (driverRoutes),
// app/booking/work-errand/work/index.tsx (workJobs), and
// app/booking/work-errand/errand/errand.tsx (errandJobs) — so this needs
// NO new Firestore indexes: driverRoutes uses a single `where("active","==",true)`
// equality filter (index-free by default), and workJobs/errandJobs are read
// with no `where` at all, exactly like their existing browse screens.
// ---------------------------------------------------------------------------

import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { db } from "../../firebase";
import { isCancelledTripStatus } from "./driverViolationCore";
import { LocationNames } from "./locationSearch";
import type { PickupLocation } from "./PickupLocationPicker";
import {
  DriverRouteInput,
  getRouteMatchesForCandidates,
  LatLng,
  PassengerRouteQuery,
  RouteMatchResult,
} from "./routeMatchLib";
import { normalizeSchoolTripDirection } from "./schoolTripsLib";
import { getDriverDayTrips, WeeklyDriverDay } from "./weeklyBookingLib";

// Same param names/shape every internal category screen already uses
// (personal-ride/index.tsx -> driverresults.tsx -> ride-payment.tsx, and
// DirectionSearchForm.tsx -> trip-results.tsx -> trip-confirm.tsx) — see
// PickupLocationPicker.tsx. Spread into a nav target's params so Home's
// "quick" nav builders below carry a real pickup point instead of silently
// omitting it.
const pickupNavParams = (pickupLocation: PickupLocation): Record<string, string> => ({
  pickupLat: String(pickupLocation.latitude),
  pickupLng: String(pickupLocation.longitude),
  pickupAddress: pickupLocation.address,
  pickupSource: pickupLocation.source,
});

// "school" = the legacy driverRoutes-based school category (still shown for
// backward compatibility with existing listings). "schoolTrip" = the NEW
// dedicated schoolTrips collection (AGENTS.md's school-ride system) — kept
// as its own category rather than merged into "school" since the two live
// in different collections with different booking flows (trip-confirm.tsx
// + ride-payment.tsx, not ride-payment.tsx directly).
export type FeedCategory = "personal" | "school" | "work" | "errand" | "schoolTrip";

export type FeedItem = {
  id: string;
  category: FeedCategory;

  providerId: string;
  providerName: string;
  providerPhone: string;
  ratingAverage: number;
  ratingCount: number;
  languages: string[];
  gender: string;

  from: string;
  to: string;
  schoolName: string;
  title: string; // work job title / errand title
  location: string; // single-location text (work/errand)

  date: string;
  day: string;
  time: string;
  startTime: string;
  endTime: string;

  price: number | null;
  isHourly: boolean;
  seats: number | null; // seats available / workers needed / errand places

  car: string;
  carColor: string;
  carPlateLast3: string;

  // schoolTrip category only — which leg this specific card represents.
  // Never used to imply "outbound and return" on one card; each leg is its
  // own independent schoolTrips document/FeedItem (see
  // normalizeSchoolTripItem below and TripFeedCard.tsx's badge).
  direction: "to_school" | "from_school" | "";

  // schoolTrip category only — set when this leg was created together with
  // its outbound/return counterpart (see createSchoolRoundTrip in
  // schoolTripsLib.ts), used by Home's "Round trip" direction filter to
  // distinguish an actual linked pair from a single unlinked leg. Always
  // null for every other category.
  linkedTripId: string | null;

  fromLocationId: string;
  toLocationId: string;
  locationId: string;
  fromLocationNames?: LocationNames;
  toLocationNames?: LocationNames;
  locationNames?: LocationNames;

  // Starting-point coordinates — reused from whatever the ride/job/errand
  // already saved at creation time (driverRoutes.fromLat/fromLng,
  // workJobs/errandJobs.locationLat/locationLng). Null when the listing
  // predates coordinate-saving; such items simply never qualify as
  // "nearby" and only ever show up in "All rides".
  originLatitude: number | null;
  originLongitude: number | null;

  // Destination coordinates — "personal"/"school" only (driverRoutes.toLat/
  // toLng, already written at creation by RideForm.tsx). Used by
  // routeMatchLib.ts's fully local/free geometric matching (straight-line
  // corridor A->C, no paid routing service) — see toDriverRouteInput below.
  // Null for every other category and for any driverRoutes doc that
  // predates coordinate-saving.
  destinationLatitude: number | null;
  destinationLongitude: number | null;

  isWeekly: boolean;
  // Only the days that still have room — used for the weekly day-picker.
  availableWeeklyDays: WeeklyDriverDay[];

  // Real passenger booking count (errandApplications, excluding rejected/
  // cancelled) — errand category only, used by isRideExpired's grace-period
  // check below. Always 0 for every other category (irrelevant to them).
  bookingCount: number;

  createdAtSeconds: number;

  // The exact raw listing object the existing screens already expect via
  // router params (JobListing shape for work, Driver shape for errand, the
  // driverRoutes doc + id for personal/school) — never rebuilt by hand, so
  // navigation is a byte-for-byte match of what driverresults.tsx / work
  // index / errand index already send.
  raw: any;
};

// ---------------------------------------------------------------------------
// Expiry — a listing is expired once its real departure Date/Time (date +
// time combined, not date alone) is in the past. Used both here (at
// normalize time, against the raw Firestore date/time strings) and by
// isRideExpired below (against an already-built FeedItem, so Home can
// re-filter on a periodic tick without waiting for a new Firestore snapshot).
// ---------------------------------------------------------------------------

const combineDateTimeMs = (date: string, time: string): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
  if (!match) return null;

  const [, y, m, d] = match;
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(String(time || "").trim());
  const hours = timeMatch ? Number(timeMatch[1]) : 0;
  const minutes = timeMatch ? Number(timeMatch[2]) : 0;

  const dt = new Date(Number(y), Number(m) - 1, Number(d), hours, minutes, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt.getTime();
};

// Raw-field version — used inside the normalizers below, directly on
// Firestore data, before a FeedItem even exists.
export const isDateTimeExpired = (
  date: string,
  time: string,
  now: number = Date.now(),
): boolean => {
  const ms = combineDateTimeMs(date, time);
  if (ms === null) return false;
  return ms <= now;
};

// ---------------------------------------------------------------------------
// Errand-only rule: an errand ride with ZERO real bookings stays visible in
// every passenger search surface (this Errands browse screen, the Home
// feed) for a 5-minute grace window PAST its scheduled start time — instead
// of vanishing the instant the clock reaches it, like every other category
// still does via isDateTimeExpired above. A ride with at least one real
// booking is NEVER hidden by this rule; once it has a passenger, the
// existing plain isDateTimeExpired cutoff still applies to it, unchanged.
//
// This is the ONE shared helper every Errands search surface calls — see
// normalizeErrandJobItem below (Home feed) and errand/errand.tsx (the
// dedicated browse screen) — so both always agree on exactly which rides
// are visible.
// ---------------------------------------------------------------------------

export const ERRAND_NO_BOOKING_GRACE_MS = 5 * 60 * 1000;

export const isErrandHiddenFromSearch = (
  date: string,
  startTime: string,
  bookingCount: number,
  now: number = Date.now(),
): boolean => {
  if (bookingCount > 0) {
    return isDateTimeExpired(date, startTime, now);
  }

  const startMs = combineDateTimeMs(date, startTime);
  if (startMs === null) return false;

  return now >= startMs + ERRAND_NO_BOOKING_GRACE_MS;
};

// Real booking/passenger count for an errand listing — read straight off a
// plain running counter on the errandJobs doc itself (see workErrandLib.ts's
// createApplication/rejectRequest/cancelApplication, which increment/
// decrement it as requests come in, get declined, or get cancelled).
// Deliberately NOT a query against errandApplications: firestore.rules
// restricts that collection to each document's own passenger/driver, so a
// browsing passenger could never read another passenger's booking there —
// errandJobs is already broadly readable, so that's where this signal
// lives instead. Negative/missing values clamp to 0 (a legacy listing that
// predates this counter, or a bookkeeping error, is never worse than
// "looks unbooked" — it simply becomes eligible for the grace-period rule
// like a genuinely unbooked one would).
export const getErrandBookingCount = (data: any): number =>
  Math.max(0, Number(data?.bookingCount) || 0);

// FeedItem version — used by Home to re-filter already-loaded items on a
// periodic tick (pull-to-refresh / focus / once a minute) without needing a
// new Firestore snapshot. Weekly items expire only once every one of their
// still-available days has passed.
export const isRideExpired = (
  item: FeedItem,
  now: number = Date.now(),
): boolean => {
  if (item.isWeekly) {
    return (
      item.availableWeeklyDays.length > 0 &&
      item.availableWeeklyDays.every((day) =>
        isDateTimeExpired(day.date, day.time, now),
      )
    );
  }

  // Errand: the 5-minute no-booking grace period (see
  // isErrandHiddenFromSearch above) — item.bookingCount was captured at the
  // last Firestore snapshot, so this stays correct between snapshots too
  // (only real new/cancelled bookings change it, which always re-fires the
  // snapshot listener anyway).
  if (item.category === "errand") {
    return isErrandHiddenFromSearch(item.date, item.startTime, item.bookingCount, now);
  }

  return isDateTimeExpired(item.date, item.time || item.startTime, now);
};

const getLast3Digits = (value: string) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 3 ? digits.slice(-3) : digits;
};

// ---------------------------------------------------------------------------
// Per-collection normalizers — each mirrors the filtering already used by
// that category's own browse screen, so the feed never shows something the
// dedicated screen would have hidden.
// ---------------------------------------------------------------------------

const normalizeDriverRouteItem = (id: string, data: any): FeedItem | null => {
  const category = data.category === "school" ? "school" : "personal";

  if (data.category !== "school" && data.category !== "personal" && data.category !== "personal_ride") {
    return null;
  }

  if (data.active === false) return null;
  if (data.isBooked === true || data.available === false) return null;
  if (data.status === "completed" || isCancelledTripStatus(data.status)) return null;
  if (data.deletedForDriver === true) return null;

  const isWeekly = !!data.isRecurring && Array.isArray(data.weeklyTrips);
  const dayTrips = getDriverDayTrips(data);
  const availableWeeklyDays = dayTrips.filter(
    (d) => d.remainingSeats > 0 && !isDateTimeExpired(d.date, d.time),
  );

  const date = data.tripDate || "";

  if (isWeekly) {
    if (availableWeeklyDays.length === 0) return null;
  } else {
    if (isDateTimeExpired(date, data.time)) return null;
    if (typeof data.seats === "number" && data.seats <= 0) return null;
  }

  return {
    id,
    category,
    providerId: data.driverId || "",
    providerName: data.driverName || "Driver",
    providerPhone: data.phone || "",
    ratingAverage: 0,
    ratingCount: 0,
    languages: Array.isArray(data.languages) ? data.languages : [],
    gender: data.gender || "",

    from: data.from || "",
    to: data.to || "",
    schoolName: "",
    title: "",
    location: "",

    date,
    day: data.day || "",
    time: data.time || "",
    startTime: "",
    endTime: "",

    price: typeof data.price === "number" ? data.price : null,
    isHourly: false,
    seats: isWeekly
      ? availableWeeklyDays.reduce((max, d) => Math.max(max, d.remainingSeats), 0)
      : typeof data.seats === "number"
        ? data.seats
        : null,

    car: data.car || "",
    carColor: data.carColor || "",
    carPlateLast3: getLast3Digits(data.carPlate || ""),
    direction: "",
    linkedTripId: null,

    fromLocationId: data.fromLocationId || "",
    toLocationId: data.toLocationId || "",
    locationId: "",
    fromLocationNames: data.fromLocationNames || undefined,
    toLocationNames: data.toLocationNames || undefined,

    originLatitude: typeof data.fromLat === "number" ? data.fromLat : null,
    originLongitude: typeof data.fromLng === "number" ? data.fromLng : null,

    destinationLatitude: typeof data.toLat === "number" ? data.toLat : null,
    destinationLongitude: typeof data.toLng === "number" ? data.toLng : null,

    isWeekly,
    availableWeeklyDays,

    bookingCount: 0,
    createdAtSeconds: data.createdAt?.seconds || 0,

    raw: { id, ...data },
  };
};

const normalizeWorkJobItem = (id: string, data: any): FeedItem | null => {
  if (data.available === false) return null;
  if (data.status === "full" || data.status === "completed") return null;
  if (isCancelledTripStatus(data.status)) return null;
  if (data.deletedForDriver === true) return null;

  const totalSeats = Number(
    data.totalSeats ?? data.seats ?? data.workersNeeded ?? 1,
  );
  const remainingSeats =
    typeof data.remainingSeats === "number" ? data.remainingSeats : totalSeats;

  if (remainingSeats <= 0) return null;
  if (isDateTimeExpired(data.date, data.startTime)) return null;

  return {
    id,
    category: "work",
    providerId: data.employerId || "",
    providerName: data.employerName || "Employer",
    providerPhone: data.phone || "",
    ratingAverage: 0,
    ratingCount: 0,
    languages: Array.isArray(data.languages) ? data.languages : [],
    gender: data.gender || "",

    from: "",
    to: "",
    schoolName: "",
    title: data.jobTitle || "Work Job",
    location: data.location || "",

    date: data.date || "",
    day: data.day || "",
    time: "",
    startTime: data.startTime || "",
    endTime: data.endTime || "",

    price: Number(data.hourlyPay || 0),
    isHourly: true,
    seats: remainingSeats,

    car: "",
    carColor: "",
    carPlateLast3: "",
    direction: "",
    linkedTripId: null,

    fromLocationId: "",
    toLocationId: "",
    locationId: data.locationId || "",
    locationNames: data.locationNames || undefined,

    originLatitude: typeof data.locationLat === "number" ? data.locationLat : null,
    originLongitude: typeof data.locationLng === "number" ? data.locationLng : null,

    destinationLatitude: null,
    destinationLongitude: null,

    isWeekly: false,
    availableWeeklyDays: [],

    bookingCount: 0,
    createdAtSeconds: data.createdAt?.seconds || 0,

    raw: {
      id,
      employerId: data.employerId || "",
      name: data.employerName || "Employer",
      gender: data.gender === "female" ? "female" : "male",
      jobTypeEn: data.jobTitle || "Work Job",
      descriptionEn: data.description || "No description",
      hourlyRate: Number(data.hourlyPay || 0),
      phone: data.phone || "",
      workHoursFrom: data.startTime || "",
      workHoursTo: data.endTime || "",
      dayEn: data.day || "",
      date: data.date || "",
      workersNeeded: totalSeats,
      remainingSeats,
      locationEn: data.location || "",
      rating: 0,
      ratingCount: 0,
      languages: Array.isArray(data.languages) ? data.languages : [],
    },
  };
};

const normalizeErrandJobItem = (
  id: string,
  data: any,
  bookingCount: number,
): FeedItem | null => {
  if (data.deletedForDriver === true) return null;
  if (data.status === "completed" || isCancelledTripStatus(data.status)) return null;
  if (isErrandHiddenFromSearch(data.date, data.startTime, bookingCount)) return null;

  return {
    id,
    category: "errand",
    providerId: data.ownerId || "",
    providerName: data.ownerName || "Person",
    providerPhone: data.phone || "",
    ratingAverage: 0,
    ratingCount: 0,
    languages: Array.isArray(data.languages) ? data.languages : [],
    gender: data.gender || "",

    from: "",
    to: "",
    schoolName: "",
    title: data.errandTitle || "Errand",
    location: data.location || "",

    date: data.date || "",
    day: data.day || "",
    time: data.startTime || "",
    startTime: data.startTime || "",
    endTime: data.endTime || "",

    price: typeof data.price === "number" ? data.price : null,
    isHourly: false,
    seats: typeof data.seats === "number" ? data.seats : 1,

    car: "",
    carColor: "",
    carPlateLast3: "",
    direction: "",
    linkedTripId: null,

    fromLocationId: "",
    toLocationId: "",
    locationId: data.locationId || "",
    locationNames: data.locationNames || undefined,

    originLatitude: typeof data.locationLat === "number" ? data.locationLat : null,
    originLongitude: typeof data.locationLng === "number" ? data.locationLng : null,

    destinationLatitude: null,
    destinationLongitude: null,

    isWeekly: false,
    availableWeeklyDays: [],

    bookingCount,
    createdAtSeconds: data.createdAt?.seconds || 0,

    raw: {
      id,
      ownerId: data.ownerId || "",
      name: data.ownerName || "Person",
      gender: data.gender === "female" ? "female" : "male",
      phone: data.phone || "",
      languages: Array.isArray(data.languages) ? data.languages : [],
      allowsPets: data.allowsPets === true,
      canTakeKids: data.canTakeKids === true,
      rating: 0,
      reviews: 0,
      price: Number(data.price || 0),
      destination: "errands",
      destinationLabel: data.errandTitle || "Errand",
      departureTime: data.startTime || "",
      returnTime: data.endTime || "",
      date: data.date || "",
      day: data.day || "",
      location: data.location || "",
      seats: Number(data.seats || 1),
    },
  };
};

// The NEW schoolTrips collection (AGENTS.md's school-ride system) — mirrors
// the exact same active/seats/expiry filtering findMatchingSchoolTrips
// already applies in schoolTripsLib.ts, so the feed never shows a trip the
// dedicated search screen would have hidden.
const normalizeSchoolTripItem = (id: string, data: any): FeedItem | null => {
  if (data.status !== "active") return null;
  if (typeof data.availableSeats === "number" && data.availableSeats <= 0) return null;
  if (isDateTimeExpired(data.date, data.departureTime)) return null;

  return {
    id,
    category: "schoolTrip",
    providerId: data.driverId || "",
    providerName: data.driverName || "Driver",
    providerPhone: data.driverPhone || "",
    ratingAverage: 0,
    ratingCount: 0,
    languages: [],
    gender: "",

    from: data.fromAddress || data.fromArea || "",
    to: data.toAddress || data.toArea || "",
    schoolName: data.schoolName || "",
    title: "",
    location: "",

    date: data.date || "",
    day: "",
    time: data.departureTime || "",
    startTime: "",
    endTime: "",

    price: typeof data.pricePerSeat === "number" ? data.pricePerSeat : null,
    isHourly: false,
    seats: typeof data.availableSeats === "number" ? data.availableSeats : null,

    car: data.car || "",
    carColor: data.carColor || "",
    carPlateLast3: getLast3Digits(data.carPlate || ""),

    // This card represents exactly ONE leg (outbound OR return) — never
    // both, even when the trip was originally created together with its
    // linked leg via the outbound-and-return form. See
    // normalizeSchoolTripDirection in schoolTripsLib.ts for how an
    // unrecognized/legacy raw value is resolved.
    direction: normalizeSchoolTripDirection(data.direction),
    linkedTripId: data.linkedTripId || null,

    fromLocationId: "",
    toLocationId: "",
    locationId: "",

    originLatitude:
      typeof data.fromLocation?.latitude === "number" ? data.fromLocation.latitude : null,
    originLongitude:
      typeof data.fromLocation?.longitude === "number" ? data.fromLocation.longitude : null,

    destinationLatitude: null,
    destinationLongitude: null,

    isWeekly: false,
    availableWeeklyDays: [],

    bookingCount: 0,
    createdAtSeconds: data.createdAt?.seconds || 0,

    // trip-confirm.tsx only needs the tripId — everything else it reads
    // live from subscribeSchoolTrip, so `raw` just needs to carry the id.
    raw: { id },
  };
};

// Attaches the SAME users/{providerId}.ratingAverage/ratingCount every other
// screen reads — never a value cached on the listing itself.
//
// Cached (module-level, shared across every subscribeHomeFeed call/screen
// mount) for PROVIDER_RATING_CACHE_TTL_MS — without this, every single
// snapshot re-delivery from the 4 collection listeners below (including one
// caused by a completely unrelated field changing on a completely
// unrelated document) re-ran a getDoc for EVERY listing's provider, every
// time. A rating changing mid-session by a few tenths is never visible
// instantly this way, but it was never guaranteed to be instant before
// either (ratingAverage/ratingCount are themselves updated via a separate,
// unrelated review-submission write) — this only bounds how often the SAME
// provider is re-read while their listings keep re-emitting.
const PROVIDER_RATING_CACHE_TTL_MS = 5 * 60 * 1000;
const providerRatingCache = new Map<
  string,
  { ratingAverage: number; ratingCount: number; fetchedAt: number }
>();

const withProviderRating = async (item: FeedItem): Promise<FeedItem> => {
  if (!item.providerId) return item;

  const cached = providerRatingCache.get(item.providerId);
  if (cached && Date.now() - cached.fetchedAt < PROVIDER_RATING_CACHE_TTL_MS) {
    item.ratingAverage = cached.ratingAverage;
    item.ratingCount = cached.ratingCount;
    return item;
  }

  try {
    const snap = await getDoc(doc(db, "users", item.providerId));
    if (snap.exists()) {
      const profile = snap.data();
      item.ratingAverage = Number(profile.ratingAverage) || 0;
      item.ratingCount = Number(profile.ratingCount) || 0;
    } else {
      item.ratingAverage = 0;
      item.ratingCount = 0;
    }

    providerRatingCache.set(item.providerId, {
      ratingAverage: item.ratingAverage,
      ratingCount: item.ratingCount,
      fetchedAt: Date.now(),
    });
  } catch {
    // Keep 0/0 — renders as "New" on the card. Not cached, so a transient
    // failure gets retried on the next snapshot rather than sticking.
  }

  return item;
};

// ---------------------------------------------------------------------------
// GPS-based distance — the ONE place every "how far is this ride's starting
// point from the user" calculation goes through. Coordinates are used
// locally only (never written to Firestore, never sent to other users) —
// see useCurrentLocation.ts for how the user's own position is obtained.
// ---------------------------------------------------------------------------

export const NEARBY_RIDE_RADIUS_KM = 25;

export function calculateDistanceKm(
  userLatitude: number,
  userLongitude: number,
  rideLatitude: number,
  rideLongitude: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;

  const dLat = toRad(rideLatitude - userLatitude);
  const dLng = toRad(rideLongitude - userLongitude);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(userLatitude)) *
      Math.cos(toRad(rideLatitude)) *
      Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusKm * c;
}

export type FeedItemWithDistance = FeedItem & { distanceKm: number | null };

// Attaches distanceKm to every item — null when either the user's position
// is unavailable or the item predates coordinate-saving. Never fabricates a
// distance in those cases.
export const attachDistances = (
  items: FeedItem[],
  userCoords: { latitude: number; longitude: number } | null,
): FeedItemWithDistance[] =>
  items.map((item) => ({
    ...item,
    distanceKm:
      userCoords &&
      item.originLatitude !== null &&
      item.originLongitude !== null
        ? calculateDistanceKm(
            userCoords.latitude,
            userCoords.longitude,
            item.originLatitude,
            item.originLongitude,
          )
        : null,
  }));

// A ride is "nearby" when its starting point is within NEARBY_RIDE_RADIUS_KM
// of the user's current position — items without a distance never qualify.
export const filterNearbyItems = (
  items: FeedItemWithDistance[],
): FeedItemWithDistance[] =>
  items.filter(
    (item) =>
      item.distanceKm !== null && item.distanceKm <= NEARBY_RIDE_RADIUS_KM,
  );

// ---------------------------------------------------------------------------
// Route-based / detour-aware matching (see routeMatchLib.ts) — fully local,
// free, synchronous geometric approximation (straight-line corridor A->C,
// Haversine distance — no network call, no API key, no paid routing
// service). An ADDITIVE layer on top of the plain origin-distance filtering
// above, scoped to "personal" listings only. Every other category, and any
// "personal" item missing origin/destination coordinates, keeps using the
// existing distanceKm <= NEARBY_RIDE_RADIUS_KM rule above — unchanged
// fallback behavior, not a new rule (requirement: preserve legacy behavior
// only when coordinates are missing).
// ---------------------------------------------------------------------------

export type FeedItemWithRouteMatch = FeedItemWithDistance & {
  routeMatch: RouteMatchResult | null;
};

// Maps a FeedItem into routeMatchLib.ts's minimal DriverRouteInput shape.
// Only ever meaningful for "personal" (driverRoutes-backed) items with real
// origin+destination coordinates — everything else maps to null, and the
// caller below simply never computes a route match for it (falls back to
// the plain distance rule instead).
const toDriverRouteInput = (item: FeedItem): DriverRouteInput | null => {
  if (item.category !== "personal") return null;
  if (item.originLatitude === null || item.originLongitude === null) return null;
  if (item.destinationLatitude === null || item.destinationLongitude === null) return null;

  return {
    tripId: item.id,
    origin: { latitude: item.originLatitude, longitude: item.originLongitude },
    destination: { latitude: item.destinationLatitude, longitude: item.destinationLongitude },
  };
};

// Computes local route matches for every eligible "personal" item in
// `items` against the passenger's pickup point. Returns a Map from tripId ->
// RouteMatchResult; an item with no entry (every non-"personal" category, or
// a "personal" item missing coordinates) simply wasn't a candidate. Pure and
// synchronous — safe to call directly from a render-time useMemo, never
// throws.
export function computeRouteMatchesForPersonalRides(
  items: FeedItem[],
  passengerPickup: LatLng,
): Map<string, RouteMatchResult> {
  const candidates = items
    .map(toDriverRouteInput)
    .filter((input): input is DriverRouteInput => input !== null);

  if (candidates.length === 0) return new Map();

  const query: PassengerRouteQuery = { pickup: passengerPickup };
  const results = getRouteMatchesForCandidates(candidates, query);

  return new Map(results.map((result) => [result.tripId, result]));
}

// Merges a previously-computed route-match Map onto each item — never
// mutates the input array. Items with no entry get routeMatch: null.
export const attachRouteMatches = (
  items: FeedItemWithDistance[],
  routeMatches: Map<string, RouteMatchResult>,
): FeedItemWithRouteMatch[] =>
  items.map((item) => ({ ...item, routeMatch: routeMatches.get(item.id) || null }));

// Nearby-eligibility, now route-match-aware: a "personal" item with a route
// match uses that match's own `eligible` flag, which already encodes the
// corridor/direction/detour checks — crucially, NEVER origin-to-pickup
// distance, so a driver whose origin is far from the passenger can still
// show up here as long as the pickup is close to the driver's A->C corridor
// and the resulting approximate detour is small. Every other item (every
// other category, or a "personal" item with no usable coordinates) falls
// back to the plain distanceKm rule.
export const filterNearbyOrRouteMatchedItems = (
  items: FeedItemWithRouteMatch[],
): FeedItemWithRouteMatch[] =>
  items.filter((item) => {
    if (item.category === "personal" && item.routeMatch) {
      return item.routeMatch.eligible;
    }

    return item.distanceKm !== null && item.distanceKm <= NEARBY_RIDE_RADIUS_KM;
  });

// Combines a feed item's real scheduled date + START time into one numeric
// timestamp, using explicit year/month/day/hour/minute components (never
// `new Date(dateString)`) so it parses identically on iOS and Android — same
// technique as combineDateTimeMs above, extended to weekly items (first
// still-available day) and to a displayed time RANGE like "18:00–20:00"
// (every category's own stored field — time/startTime/day.time — is already
// just "HH:MM" today, but this stays correct if a range string ever reaches
// it too, by keeping only the part before the dash).
const getFeedItemStartTimestamp = (item: FeedItem): number => {
  const date = item.isWeekly
    ? item.availableWeeklyDays[0]?.date || item.date
    : item.date;
  const time = item.isWeekly
    ? item.availableWeeklyDays[0]?.time || item.time
    : item.time || item.startTime;

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
  if (!dateMatch) return Number.MAX_SAFE_INTEGER;

  const [, y, m, d] = dateMatch;

  const startTimeText = String(time || "").split(/[–—-]/)[0].trim();
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(startTimeText);
  const hours = timeMatch ? Number(timeMatch[1]) : 0;
  const minutes = timeMatch ? Number(timeMatch[2]) : 0;

  const dt = new Date(Number(y), Number(m) - 1, Number(d), hours, minutes, 0, 0);
  return Number.isNaN(dt.getTime()) ? Number.MAX_SAFE_INTEGER : dt.getTime();
};

// Chronological order is the ONE primary key — nearest upcoming date/start
// time first, always, regardless of category/distance/rating/title/
// createdAt/Firestore order. distanceKm (attachDistances above) is still
// carried on every item for DISPLAY only; it must never affect this order.
// Tie-break (same date+start time) falls back to createdAt, then id, purely
// for a stable/deterministic order — never the primary key.
export function sortFeedItems<T extends FeedItemWithDistance>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aTime = getFeedItemStartTimestamp(a);
    const bTime = getFeedItemStartTimestamp(b);
    if (aTime !== bTime) return aTime - bTime;

    if (a.createdAtSeconds !== b.createdAtSeconds) {
      return a.createdAtSeconds - b.createdAtSeconds;
    }

    return a.id.localeCompare(b.id);
  });
}

export const FEED_PAGE_SIZE = 20;

// Upper bound on how many docs each of the 4 listeners below ever watches at
// once — well above FEED_PAGE_SIZE (only the nearest/soonest 20 are ever
// actually shown, see Home's visibleFeedItems) to comfortably allow for
// client-side filtering (expiry, seats, booked/cancelled status), but no
// longer literally "the entire collection". Without this, workJobs/
// errandJobs in particular (no `where` at all) re-read and re-watch every
// job/errand ever created, platform-wide, for as long as Home stays
// mounted — see this file's own module comment.
const FEED_SOURCE_LIMIT = 200;

// ---------------------------------------------------------------------------
// Live combined subscription — one onSnapshot per source collection, merged
// and re-emitted on every change so a trip that becomes full/completed/
// deleted disappears from the feed immediately (spec #8).
// ---------------------------------------------------------------------------

// TEMP DEV-ONLY diagnostic counter — every subscribeHomeFeed() call gets its
// own instance number so the console logs below can be used to confirm a
// previous instance's 4 listeners always fully unsubscribe BEFORE the next
// instance's 4 listeners subscribe (never overlapping). Safe to delete once
// confirmed — has no effect outside __DEV__.
let __devHomeFeedInstanceCounter = 0;

export const subscribeHomeFeed = (
  onUpdate: (items: FeedItem[]) => void,
  onError?: (error: any) => void,
): (() => void) => {
  const __devInstanceId = __DEV__ ? ++__devHomeFeedInstanceCounter : 0;
  if (__DEV__) console.log(`[HomeFeed #${__devInstanceId}] subscribe (4 listeners: driverRoutes, workJobs, errandJobs, schoolTrips)`);

  let routesItems: FeedItem[] = [];
  let workItems: FeedItem[] = [];
  let errandItems: FeedItem[] = [];
  let schoolTripItems: FeedItem[] = [];
  let cancelled = false;

  const emit = () => {
    if (cancelled) return;
    onUpdate([...routesItems, ...workItems, ...errandItems, ...schoolTripItems]);
  };

  const attachRatings = async (items: FeedItem[]) => {
    await Promise.all(items.map(withProviderRating));
    return items;
  };

  const unsubRoutes = onSnapshot(
    query(collection(db, "driverRoutes"), where("active", "==", true), limit(FEED_SOURCE_LIMIT)),
    async (snap) => {
      const items = snap.docs
        .map((d) => normalizeDriverRouteItem(d.id, d.data()))
        .filter((item): item is FeedItem => !!item);

      routesItems = await attachRatings(items);
      emit();
    },
    (error) => onError?.(error),
  );

  const unsubWork = onSnapshot(
    query(collection(db, "workJobs"), orderBy("createdAt", "desc"), limit(FEED_SOURCE_LIMIT)),
    async (snap) => {
      const items = snap.docs
        .map((d) => normalizeWorkJobItem(d.id, d.data()))
        .filter((item): item is FeedItem => !!item);

      workItems = await attachRatings(items);
      emit();
    },
    (error) => onError?.(error),
  );

  const unsubErrands = onSnapshot(
    query(collection(db, "errandJobs"), orderBy("createdAt", "desc"), limit(FEED_SOURCE_LIMIT)),
    async (snap) => {
      const items = snap.docs
        .map((d) => {
          const data = d.data();
          return normalizeErrandJobItem(d.id, data, getErrandBookingCount(data));
        })
        .filter((item): item is FeedItem => !!item);

      errandItems = await attachRatings(items);
      emit();
    },
    (error) => onError?.(error),
  );

  const unsubSchoolTrips = onSnapshot(
    query(collection(db, "schoolTrips"), where("status", "==", "active"), limit(FEED_SOURCE_LIMIT)),
    async (snap) => {
      const items = snap.docs
        .map((d) => normalizeSchoolTripItem(d.id, d.data()))
        .filter((item): item is FeedItem => !!item);

      schoolTripItems = await attachRatings(items);
      emit();
    },
    (error) => onError?.(error),
  );

  return () => {
    cancelled = true;
    unsubRoutes();
    unsubWork();
    unsubErrands();
    unsubSchoolTrips();
    if (__DEV__) console.log(`[HomeFeed #${__devInstanceId}] unsubscribe (4 listeners stopped)`);
  };
};

// ---------------------------------------------------------------------------
// Navigation builders — one per category, each a byte-for-byte match of what
// the existing discovery screen for that category already sends (see
// driverresults.tsx's handleBookDriver/confirmWeeklyDayPicker, work/index.tsx's
// handleApply, errand/errand.tsx's handleSelectDriver). This is the entire
// point of the feed being a "discovery layer" — it never talks to Firestore
// to create a booking, it only opens the exact same next screen with the
// exact same params those screens already use.
// ---------------------------------------------------------------------------

export type FeedNavTarget = { pathname: string; params: Record<string, string> };

// Personal/School — single-day ("quick") booking. Mirrors handleBookDriver's
// non-weekly branch; defaults to 1 seat, but now also passes maxSeats (the
// ride's real remaining capacity) so ride-payment's own seat stepper can let
// the passenger book more than 1 seat, up to that capacity.
export const buildQuickRideNav = (
  item: FeedItem,
  pickupLocation: PickupLocation,
): FeedNavTarget => {
  const seats = 1;
  const unitPrice = item.price || 0;
  const maxSeats = typeof item.seats === "number" && item.seats > 0 ? item.seats : 1;

  return {
    pathname: "/booking/ride-payment",
    params: {
      category: item.category === "school" ? "school" : "personal",
      bookingType: "quick",

      driverId: item.providerId,
      driverName: item.providerName,
      driverPhone: item.providerPhone,

      routeId: item.id,

      from: item.from,
      to: item.to,

      date: item.date,
      day: item.day,
      time: item.time,

      seats: String(seats),
      maxSeats: String(maxSeats),
      price: String(unitPrice * seats),
      unitPrice: String(unitPrice),

      driverCar: item.car,
      driverCarColor: item.carColor,
      driverCarPlateLast3: item.carPlateLast3,

      ...pickupNavParams(pickupLocation),

      source: "home_feed",
    },
  };
};

// Personal/School — weekly booking. The passenger picks from the driver's
// own available weekly days (no prior "requested days" exist yet, since
// they're discovering this trip fresh from the feed) — see
// getDriverDayTrips/WeeklyDriverDay in weeklyBookingLib.ts, which already
// carry dayKey/dayName/date/time/price; only `seats` is overridden here to
// the passenger's own request (defaulting to 1, same reasoning as above).
// childEntries — School only (see home.tsx's dayPickerChildEntries/
// handleChildSelectionContinue's weekly branch) — one seat per selected
// child on EVERY chosen day, in the same { localId, childId, childName }
// shape buildSchoolTripNav already forwards; ride-payment.tsx's existing
// isSchool-gated createWeeklyBookings call already writes childId/
// childName/childEntries onto every generated day's booking doc, so nothing
// downstream of this needs to change. Always undefined/empty for weekly
// Personal Ride.
export const buildWeeklyRideNav = (
  item: FeedItem,
  chosenDays: WeeklyDriverDay[],
  pickupLocation: PickupLocation,
  childEntries?: { localId: string; childId?: string; childName?: string }[] | null,
): FeedNavTarget => {
  const seatsPerDay = childEntries && childEntries.length > 0 ? childEntries.length : 1;

  const selectedWeeklyDays = chosenDays.map((day) => ({
    dayKey: day.dayKey,
    dayName: day.dayName,
    date: day.date,
    time: day.time,
    seats: seatsPerDay,
    price: day.price,
  }));

  return {
    pathname: "/booking/ride-payment",
    params: {
      category: item.category === "school" ? "school" : "personal",
      bookingType: "weekly",

      driverId: item.providerId,
      driverName: item.providerName,
      driverPhone: item.providerPhone,

      routeId: item.id,

      from: item.from,
      to: item.to,

      driverCar: item.car,
      driverCarColor: item.carColor,
      driverCarPlateLast3: item.carPlateLast3,

      selectedWeeklyDays: JSON.stringify(selectedWeeklyDays),
      // Nothing "remains" to find another driver for — the passenger picked
      // this one driver's own available days directly from the feed.
      remainingWeeklyDays: JSON.stringify([]),

      ...pickupNavParams(pickupLocation),

      ...(childEntries && childEntries.length > 0
        ? { childEntries: JSON.stringify(childEntries) }
        : {}),

      source: "home_feed",
    },
  };
};

// Work — identical params to work/index.tsx's handleApply.
export const buildWorkApplyNav = (item: FeedItem): FeedNavTarget => ({
  pathname: "/booking/work-errand/work/apply",
  params: {
    job: JSON.stringify(item.raw),
    source: "home_feed",
  },
});

// Errand — identical params to errand/errand.tsx's handleSelectDriver.
export const buildErrandBookNav = (item: FeedItem): FeedNavTarget => ({
  pathname: "/booking/work-errand/errand/book",
  params: {
    driver: JSON.stringify(item.raw),
    source: "home_feed",
  },
});

// New schoolTrips system — the passenger already sees this exact trip's
// driver/route/price/seats on the card, so this jumps straight to
// trip-confirm.tsx (the same review screen the dedicated search results
// list uses) rather than re-running a search.
// pickupLocation is omitted for a standalone return-leg card (item.direction
// === "from_school") — same as DirectionSearchForm.tsx, which never shows
// the pickup field for a return search either: the real pickup point is the
// school itself, not something the passenger picks (see trip-confirm.tsx's
// own comment on this).
// childEntries — the child(ren) picked on Home's own child-select step (see
// home.tsx's childSelectItem/handleChildSelectionContinue) — forwarded in
// the exact { localId, childId, childName } shape trip-confirm.tsx already
// parses from DirectionSearchForm's flow (SchoolBookingChildEntry,
// schoolTripsLib.ts), so seat count/child-linking downstream (ride-payment,
// the booking write) work identically regardless of entry point.
export const buildSchoolTripNav = (
  item: FeedItem,
  pickupLocation: PickupLocation | null,
  childEntries?: { localId: string; childId?: string; childName?: string }[] | null,
): FeedNavTarget => ({
  pathname: "/booking/school/trip-confirm",
  params: {
    tripId: item.id,
    seats: "1",
    roundTrip: "false",
    ...(pickupLocation ? pickupNavParams(pickupLocation) : {}),
    ...(childEntries && childEntries.length > 0
      ? { childEntries: JSON.stringify(childEntries) }
      : {}),
  },
});
