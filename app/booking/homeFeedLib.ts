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
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import { db } from "../../firebase";
import { LocationNames } from "./locationSearch";
import { normalizeSchoolTripDirection } from "./schoolTripsLib";
import { getDriverDayTrips, WeeklyDriverDay } from "./weeklyBookingLib";

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
  if (data.status === "completed" || data.status === "cancelled") return null;
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

    price: null,
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
  if (data.status === "completed" || data.status === "cancelled") return null;
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
const withProviderRating = async (item: FeedItem): Promise<FeedItem> => {
  if (!item.providerId) return item;

  try {
    const snap = await getDoc(doc(db, "users", item.providerId));
    if (snap.exists()) {
      const profile = snap.data();
      item.ratingAverage = Number(profile.ratingAverage) || 0;
      item.ratingCount = Number(profile.ratingCount) || 0;
    }
  } catch {
    // Keep 0/0 — renders as "New" on the card.
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

const dateTimeKey = (item: FeedItem) => {
  const date = item.isWeekly
    ? item.availableWeeklyDays[0]?.date || item.date
    : item.date;
  const time = item.isWeekly
    ? item.availableWeeklyDays[0]?.time || item.time
    : item.time || item.startTime;

  if (!date) return Number.MAX_SAFE_INTEGER;
  const ts = new Date(`${date}T${time || "00:00"}:00`).getTime();
  return Number.isNaN(ts) ? Number.MAX_SAFE_INTEGER : ts;
};

// Nearest-first, then nearest upcoming date/time, then higher rating as a
// tie-breaker. Items with no distance (coordinates missing, or user position
// unavailable) sort after every item that does have one.
export const sortFeedItems = (
  items: FeedItemWithDistance[],
): FeedItemWithDistance[] =>
  [...items].sort((a, b) => {
    if (
      a.distanceKm !== null &&
      b.distanceKm !== null &&
      a.distanceKm !== b.distanceKm
    ) {
      return a.distanceKm - b.distanceKm;
    }
    if (a.distanceKm !== null && b.distanceKm === null) return -1;
    if (a.distanceKm === null && b.distanceKm !== null) return 1;

    const aTime = dateTimeKey(a);
    const bTime = dateTimeKey(b);
    if (aTime !== bTime) return aTime - bTime;

    return b.ratingAverage - a.ratingAverage;
  });

export const FEED_PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Live combined subscription — one onSnapshot per source collection, merged
// and re-emitted on every change so a trip that becomes full/completed/
// deleted disappears from the feed immediately (spec #8).
// ---------------------------------------------------------------------------

export const subscribeHomeFeed = (
  onUpdate: (items: FeedItem[]) => void,
  onError?: (error: any) => void,
): (() => void) => {
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
    query(collection(db, "driverRoutes"), where("active", "==", true)),
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
    collection(db, "workJobs"),
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
    collection(db, "errandJobs"),
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
    query(collection(db, "schoolTrips"), where("status", "==", "active")),
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
export const buildQuickRideNav = (item: FeedItem): FeedNavTarget => {
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
export const buildWeeklyRideNav = (
  item: FeedItem,
  chosenDays: WeeklyDriverDay[],
): FeedNavTarget => {
  const selectedWeeklyDays = chosenDays.map((day) => ({
    dayKey: day.dayKey,
    dayName: day.dayName,
    date: day.date,
    time: day.time,
    seats: 1,
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
export const buildSchoolTripNav = (item: FeedItem): FeedNavTarget => ({
  pathname: "/booking/school/trip-confirm",
  params: {
    tripId: item.id,
    seats: "1",
    roundTrip: "false",
  },
});
