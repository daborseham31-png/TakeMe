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
// discover"), and Delivery (not one of the four categories asked for).
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
import { getDriverDayTrips, WeeklyDriverDay } from "./weeklyBookingLib";

export type FeedCategory = "personal" | "school" | "work" | "errand";

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

  fromLocationId: string;
  toLocationId: string;
  locationId: string;

  isWeekly: boolean;
  // Only the days that still have room — used for the weekly day-picker.
  availableWeeklyDays: WeeklyDriverDay[];

  createdAtSeconds: number;

  // The exact raw listing object the existing screens already expect via
  // router params (JobListing shape for work, Driver shape for errand, the
  // driverRoutes doc + id for personal/school) — never rebuilt by hand, so
  // navigation is a byte-for-byte match of what driverresults.tsx / work
  // index / errand index already send.
  raw: any;
};

const todayYMD = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const isTodayOrFuture = (dateText: string) => {
  const match = String(dateText || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return true;
  return dateText >= todayYMD();
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
  const availableWeeklyDays = dayTrips.filter((d) => d.remainingSeats > 0);

  const date = data.tripDate || data.deliveryDate || "";

  if (isWeekly) {
    if (availableWeeklyDays.length === 0) return null;
  } else {
    if (!isTodayOrFuture(date)) return null;
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

    fromLocationId: data.fromLocationId || "",
    toLocationId: data.toLocationId || "",
    locationId: "",

    isWeekly,
    availableWeeklyDays,

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
  if (!isTodayOrFuture(data.date)) return null;

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

    fromLocationId: "",
    toLocationId: "",
    locationId: data.locationId || "",

    isWeekly: false,
    availableWeeklyDays: [],

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

const normalizeErrandJobItem = (id: string, data: any): FeedItem | null => {
  if (data.deletedForDriver === true) return null;
  if (data.status === "completed" || data.status === "cancelled") return null;
  if (!isTodayOrFuture(data.date)) return null;

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

    fromLocationId: "",
    toLocationId: "",
    locationId: data.locationId || "",

    isWeekly: false,
    availableWeeklyDays: [],

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
// Relevance ranking — matched location first, then nearest upcoming
// date/time, then higher rating as a tie-breaker.
// ---------------------------------------------------------------------------

const itemMatchesUser = (item: FeedItem, userLocationId: string) =>
  item.fromLocationId === userLocationId ||
  item.toLocationId === userLocationId ||
  item.locationId === userLocationId;

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

export const sortFeedItems = (
  items: FeedItem[],
  userLocationId: string | null,
): FeedItem[] => {
  return [...items].sort((a, b) => {
    if (userLocationId) {
      const aMatch = itemMatchesUser(a, userLocationId);
      const bMatch = itemMatchesUser(b, userLocationId);
      if (aMatch !== bMatch) return aMatch ? -1 : 1;
    }

    const aTime = dateTimeKey(a);
    const bTime = dateTimeKey(b);
    if (aTime !== bTime) return aTime - bTime;

    return b.ratingAverage - a.ratingAverage;
  });
};

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
  let cancelled = false;

  const emit = () => {
    if (cancelled) return;
    onUpdate([...routesItems, ...workItems, ...errandItems]);
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
        .map((d) => normalizeErrandJobItem(d.id, d.data()))
        .filter((item): item is FeedItem => !!item);

      errandItems = await attachRatings(items);
      emit();
    },
    (error) => onError?.(error),
  );

  return () => {
    cancelled = true;
    unsubRoutes();
    unsubWork();
    unsubErrands();
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
// non-weekly branch exactly; defaults to 1 seat since the feed card has no
// seat-count picker (matching ride-payment's own screen, which doesn't let
// the passenger change seats after arriving either).
export const buildQuickRideNav = (item: FeedItem): FeedNavTarget => {
  const seats = 1;
  const unitPrice = item.price || 0;

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

// Reads the current user's saved area, per the field-name fallback chain the
// spec lists. None of these fields exist on the user doc yet (Profile has no
// "home city" picker) — this simply returns null until that's added, and the
// feed falls back to showing recent available trips, exactly as required.
export const getUserHomeLocationId = async (
  uid: string,
): Promise<string | null> => {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return null;

    const data = snap.data();

    return (
      data.homeLocationId ||
      data.cityLocationId ||
      data.fromLocationId ||
      null
    );
  } catch {
    return null;
  }
};
