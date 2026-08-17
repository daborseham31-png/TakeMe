// ---------------------------------------------------------------------------
// Dependency-free core of weekly/multi-date booking matching — the day-key,
// Israel-timezone, driver-day-trip, and weekly-match logic every real
// implementation in weeklyBookingLib.ts (and driverresults.tsx's own
// grouping-by-date logic) is built on.
//
// Deliberately its own file, with NO import of react-native/firebase/expo-
// router, for the same reason driverNoShowCore.ts/driverViolationCore.ts/
// cancellationEligibility.ts are their own files: weeklyBookingLib.ts pulls
// in react-native's Alert + firebase/firestore at module scope, and even
// app/driver/create/driverHelpers.ts (which otherwise has plenty of pure
// date/time functions) pulls in expo-router + firebase/firestore + react-
// native's Alert too — importing EITHER file transitively fails to even
// PARSE under this project's vitest config (plain Node, no RN/Firebase
// mocking — see vitest.config.ts's own header; react-native's own source
// uses Flow syntax Node's/Vite's parser rejects outright). So every helper
// below is self-contained, never importing from either file, even though
// some of this necessarily duplicates a same-shaped helper that already
// exists there (documented at each duplication point below).
//
// weeklyBookingLib.ts imports its own copies of getLocalNowInIsrael/
// getDriverDayTrips/matchDriverWeeklyDays FROM this file and re-exports
// them, so no existing call site's import path had to change — same
// pattern driverViolationsLib.ts already uses for driverViolationCore.ts.
// ---------------------------------------------------------------------------

const ISRAEL_TIME_ZONE = "Asia/Jerusalem";

// "Now", as a Date object whose getFullYear/getMonth/getDate/getDay/
// getHours/getMinutes already read back the Israel-local wall-clock values.
// Every helper below can then just use plain Date getters — never UTC math
// — and can't drift a day off no matter what timezone the device (or test
// runner) is in.
export const getLocalNowInIsrael = (): Date => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ISRAEL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value || 0);

  // A few ICU implementations report midnight as hour "24" with hour12:false.
  const hour = get("hour") % 24;

  return new Date(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
};

// Same shape as driverHelpers.ts's own formatDateToYMD — duplicated here
// (rather than imported) since that file can't be imported under vitest —
// see this file's own header.
export const formatYMD = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// ---------------------------------------------------------------------------
// "anyDate" calendar rule (WeeklyDaysCard.tsx's calendarVariant="anyDate" —
// School driver weekly/recurring trip creation, and the passenger-side
// Weekly School search). Today-or-future, Israel-local, with NO week or
// month restriction — never clamped to the current/next Sunday-Saturday
// week the way "singleWeek" is. See this fix's own bug report: School
// weekly/recurring creation was previously left on "singleWeek" by mistake,
// which wrongly disabled every date past the current week's Saturday.
// ---------------------------------------------------------------------------

// Today-or-future check, Israel-local — the exact rule the native date
// picker's minimumDate/maximumDate (see WeeklyDaysCard.tsx) enforces
// visually; extracted here so it's independently testable without pulling
// in react-native (see this file's own header).
export const isDateSelectableForAnyDate = (
  dateYMD: string,
  now: Date = getLocalNowInIsrael(),
): boolean => !!dateYMD && dateYMD >= formatYMD(now);

// The actual Date objects WeeklyDaysCard.tsx passes as the native picker's
// minimumDate/maximumDate for calendarVariant="anyDate" — minimumDate is
// Israel-local midnight today, maximumDate is intentionally undefined (no
// upper bound at all, so every future month stays navigable/selectable).
export const getAnyDateCalendarBounds = (
  now: Date = getLocalNowInIsrael(),
): { minimumDate: Date; maximumDate: undefined } => {
  const todayYMD = formatYMD(now);
  const [year, month, day] = todayYMD.split("-").map(Number);
  return {
    minimumDate: new Date(year, month - 1, day, 0, 0, 0),
    maximumDate: undefined,
  };
};

// ---------------------------------------------------------------------------
// Day keys
// ---------------------------------------------------------------------------

export type DayKey =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

export const DAY_KEY_LABEL: Record<DayKey, string> = {
  sunday: "Sunday",
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
};

const SHORT_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const SHORT_TO_DAYKEY: Record<string, DayKey> = {
  Sun: "sunday",
  Mon: "monday",
  Tue: "tuesday",
  Wed: "wednesday",
  Thu: "thursday",
  Fri: "friday",
  Sat: "saturday",
};

// Reads the weekday straight off a YYYY-MM-DD string via the LOCAL Date
// constructor (new Date(y, m-1, d) — never new Date(ymdString), which
// parses as UTC midnight and can read back the PREVIOUS day in timezones
// west of UTC) — this is what keeps a stored trip date's weekday label
// correct regardless of device/runtime timezone. Never rejects past dates
// (unlike a "today-or-future" validator) — used for display/matching on
// dates that may already be in the past (an existing driver trip someone is
// matching against).
export const dayKeyFromAnyYMD = (dateYMD: string): DayKey | "" => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateYMD || ""));
  if (!match) return "";

  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));

  if (Number.isNaN(date.getTime())) return "";

  const short = SHORT_DAY_NAMES[date.getDay()];
  return SHORT_TO_DAYKEY[short] || "";
};

// ---------------------------------------------------------------------------
// Day entry types (shared with weeklyBookingLib.ts's WeekDayRow — see that
// file for the UI-row shape used by WeeklyDaysCard, kept there since it's
// never used by anything in this pure module besides the single-date <->
// multi-date transition below).
// ---------------------------------------------------------------------------

export type WeeklyRequestDay = {
  dayKey: DayKey;
  dayName: string;
  date: string;
  time: string;
  seats: number;
};

export type WeeklyDriverDay = WeeklyRequestDay & {
  price: number;
  remainingSeats: number;
  // Which driverRoutes document this specific day actually lives in. A
  // driver's Weekly Personal Ride is stored as one SEPARATE document PER
  // selected date (see RideForm.tsx's own comment: "Every selected date
  // becomes its own independent driverRoutes document... instead of one
  // document holding every day in a weeklyTrips array"), so a day's own
  // source document id is NOT always the same as whichever card the
  // passenger happened to click — see getDriverDayTrips below, which is the
  // only place this gets stamped on. Absent only for day-trip objects built
  // without a source driver document at all (there are none today, but the
  // field stays optional so nothing is forced to fabricate one).
  routeId?: string;
};

export type WeekDayRow = {
  id: string;
  date: string;
  time: string;
  seats: number;
  price: string;
};

// ---------------------------------------------------------------------------
// Single-date <-> multi-date transition (Personal Ride search — see
// app/personal-ride/index.tsx's toggleWeeklyBooking). The single-date field
// and the weekly rows list are two different UI shapes for the same
// underlying selection, never two independently-drifting sources of truth —
// these two pure functions are the ONLY place that hand-off happens, so the
// date a passenger already picked can never be silently lost switching
// between the two modes.
// ---------------------------------------------------------------------------

const makeRow = (date: string, time: string): WeekDayRow => ({
  id: `row_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  date,
  time,
  seats: 1,
  price: "",
});

// Turning multi-date mode ON. Returns `currentRows` UNCHANGED — never
// reset, never duplicated — when it already has rows (re-enabling after the
// passenger already built a list must never lose that work), or when the
// single date is missing/in the past. `todayYMD` must already be
// Israel-local (see getLocalNowInIsrael above), never the device's own
// timezone.
export const seedWeeklyRowsFromSingleDate = (
  currentRows: WeekDayRow[],
  singleDate: string,
  singleTime: string,
  todayYMD: string,
): WeekDayRow[] => {
  if (currentRows.length > 0) return currentRows;
  if (!singleDate || singleDate < todayYMD) return currentRows;
  return [makeRow(singleDate, singleTime)];
};

// Turning multi-date mode OFF. Returns the {date, time} the single-date
// field should adopt, or null when there is nothing to restore (the caller
// should leave whatever single date was already there untouched).
export const restoreSingleDateFromWeeklyRows = (
  rows: WeekDayRow[],
): { date: string; time: string } | null => {
  if (rows.length === 0 || !rows[0].date) return null;
  return { date: rows[0].date, time: rows[0].time || "" };
};

// ---------------------------------------------------------------------------
// Normalize any driverRoutes doc — weekly ("has weeklyTrips") or a normal
// single-day trip ("date"/"tripDate"/"selectedDate" + time/seats/price at
// the top level) — into the same list of bookable day-trips. This is what
// lets a plain one-day driver match a passenger's weekly request for that
// one day, without ever needing to be a "weekly driver".
// ---------------------------------------------------------------------------

const normalizeDriverDayTrip = (
  trip: any,
  driver: any,
): WeeklyDriverDay | null => {
  const date = trip?.date || "";
  if (!date) return null;

  const dayKey = dayKeyFromAnyYMD(date) || "";
  const seats = Number(trip?.seats ?? driver?.seats ?? 0) || 0;
  const remainingSeats =
    typeof trip?.remainingSeats === "number" ? trip.remainingSeats : seats;

  return {
    dayKey: (dayKey || "sunday") as DayKey,
    dayName: dayKey ? DAY_KEY_LABEL[dayKey] : "",
    date,
    time: trip?.time || driver?.time || "",
    seats,
    price: Number(trip?.price ?? driver?.price ?? 0) || 0,
    remainingSeats,
    routeId: typeof driver?.id === "string" && driver.id ? driver.id : undefined,
  };
};

export const getDriverDayTrips = (driver: any): WeeklyDriverDay[] => {
  if (Array.isArray(driver?.weeklyTrips) && driver.weeklyTrips.length > 0) {
    return driver.weeklyTrips
      .map((trip: any) => normalizeDriverDayTrip(trip, driver))
      .filter((trip: WeeklyDriverDay | null): trip is WeeklyDriverDay => !!trip);
  }

  // Normal one-day driver route — a single implicit "day trip" built from
  // its own top-level fields. bookingType/isRecurring are irrelevant here:
  // any route with a real date can match a weekly request for that date.
  const date =
    driver?.date || driver?.tripDate || driver?.selectedDate || "";

  if (!date) return [];

  const single = normalizeDriverDayTrip({ date }, driver);
  return single ? [single] : [];
};

// ---------------------------------------------------------------------------
// Matching: which requested days can a given driver cover — from either a
// weekly trips array or a normal one-day route (see getDriverDayTrips).
// ---------------------------------------------------------------------------

// Same shape as driverHelpers.ts's own normalizeTime, minus the Arabic-Indic
// digit normalization (not needed for the plain "HH:MM" strings this
// matcher already receives from Firestore/validated form state) — see this
// file's own header for why it can't just import normalizeTime.
const timeToMinutes = (time: string): number | null => {
  const match = String(time || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return hours * 60 + minutes;
};

export const isTimeCloseEnough = (
  driverTime: string | undefined,
  requestedTime: string,
  maxDiffMinutes = 30,
) => {
  if (!requestedTime) return true;
  if (!driverTime) return false;

  const driverMinutes = timeToMinutes(driverTime);
  const requestedMinutes = timeToMinutes(requestedTime);

  if (driverMinutes === null || requestedMinutes === null) return false;

  return Math.abs(driverMinutes - requestedMinutes) <= maxDiffMinutes;
};

export type WeeklyDayMatch = {
  requested: WeeklyRequestDay;
  driverDay: WeeklyDriverDay;
};

// Shared per-date matching core — given a flat list of bookable day-trips
// (from ONE driver document via getDriverDayTrips, or MERGED across an
// entire weekly series via matchWeeklyGroupDays below), match each
// requested date INDEPENDENTLY (OR logic, never AND): whichever requested
// dates are actually covered are returned, never requiring every one of
// them to match. See driverresults.tsx's own use of this (a driver/group is
// kept in results as long as matches.length > 0).
const matchDayTripsAgainstRequest = (
  dayTrips: WeeklyDriverDay[],
  requestedDays: WeeklyRequestDay[],
  maxDiffMinutes: number,
): WeeklyDayMatch[] => {
  const matches: WeeklyDayMatch[] = [];

  for (const requested of requestedDays) {
    const driverDay = dayTrips.find((trip) => trip.date === requested.date);

    if (!driverDay) continue;

    const remaining =
      typeof driverDay.remainingSeats === "number"
        ? driverDay.remainingSeats
        : driverDay.seats;

    if (remaining < requested.seats) continue;
    if (!isTimeCloseEnough(driverDay.time, requested.time, maxDiffMinutes)) continue;

    matches.push({ requested, driverDay });
  }

  return matches;
};

export const matchDriverWeeklyDays = (
  driver: any,
  requestedDays: WeeklyRequestDay[],
  options: { maxTimeDiffMinutes?: number } = {},
): WeeklyDayMatch[] => {
  const driverDayTrips = getDriverDayTrips(driver);
  if (driverDayTrips.length === 0) return [];

  return matchDayTripsAgainstRequest(driverDayTrips, requestedDays, options.maxTimeDiffMinutes ?? 30);
};

// ---------------------------------------------------------------------------
// Weekly-series grouping — a driver's Weekly Personal Ride is stored as one
// SEPARATE driverRoutes document PER selected date (see RideForm.tsx),
// sharing a `weeklyGroupId` field that links them for traceability. Matching
// a single such document on its own (matchDriverWeeklyDays above) can only
// ever surface ONE day, since that's all any one document's own
// weeklyTrips array ever holds — this is why the "Book this driver" bottom
// sheet used to only show the one day whose card was clicked. Grouping by
// weeklyGroupId (falling back to the document's own id when absent — a
// legacy/standalone document is simply its own group of one) and matching
// against the UNION of every member's day-trips is what lets the sheet show
// every day of the SAME weekly series, regardless of which member's card
// was clicked.
// ---------------------------------------------------------------------------

export const weeklySeriesKey = (driver: any): string =>
  (typeof driver?.weeklyGroupId === "string" && driver.weeklyGroupId) ||
  (typeof driver?.id === "string" && driver.id) ||
  "";

export const groupDriversByWeeklySeries = <T extends { id: string; weeklyGroupId?: string }>(
  drivers: T[],
): Map<string, T[]> => {
  const groups = new Map<string, T[]>();

  for (const driver of drivers) {
    const key = weeklySeriesKey(driver);
    if (!key) continue;

    const existing = groups.get(key);
    if (existing) {
      existing.push(driver);
    } else {
      groups.set(key, [driver]);
    }
  }

  return groups;
};

// Matches requested dates against the MERGED day-trips of every member of a
// weekly series (see groupDriversByWeeklySeries) instead of a single
// document's own trips — this is what the day-picker bottom sheet uses so
// it always shows every day of the same driver's weekly series, no matter
// which member document's card was clicked. Never mutates/reorders the
// input members; a date covered by more than one member (should not happen
// in practice — each date lives in exactly one document — but is handled
// safely) keeps whichever member's trip is found first, same `find`
// semantics as matchDayTripsAgainstRequest itself.
export const matchWeeklyGroupDays = (
  members: any[],
  requestedDays: WeeklyRequestDay[],
  options: { maxTimeDiffMinutes?: number } = {},
): WeeklyDayMatch[] => {
  const mergedDayTrips = members.flatMap((member) => getDriverDayTrips(member));
  if (mergedDayTrips.length === 0) return [];

  return matchDayTripsAgainstRequest(mergedDayTrips, requestedDays, options.maxTimeDiffMinutes ?? 30);
};

// Turns a match into the day object that actually gets booked: driver's
// scheduled time + price, passenger's requested seat count. Carries the
// source document's routeId through unchanged — the booking transaction
// needs it to know exactly which driverRoutes document each selected day
// belongs to (see weeklyBookingLib.ts's createWeeklyBookings).
export const buildBookingDayFromMatch = (
  match: WeeklyDayMatch,
): WeeklyDriverDay => ({
  dayKey: match.driverDay.dayKey,
  dayName: match.driverDay.dayName,
  date: match.driverDay.date,
  time: match.driverDay.time,
  seats: match.requested.seats,
  price: match.driverDay.price,
  remainingSeats: match.driverDay.remainingSeats,
  routeId: match.driverDay.routeId,
});

// ---------------------------------------------------------------------------
// Already-booked filtering — a day the passenger already has an active
// booking for must never be shown as selectable again (item 7 of this
// fix's own bug report: "Select All should select only valid, available,
// unbooked dates"). `alreadyBookedKeys` is a Set of weeklyMatchKey(routeId,
// date) strings — see weeklyBookingLib.ts's fetchPassengerBookedRouteDateKeys
// for how that set is actually built from Firestore. Pure/testable: the
// live Firestore read stays in weeklyBookingLib.ts.
// ---------------------------------------------------------------------------

export const weeklyMatchKey = (routeId: string | undefined, date: string): string =>
  `${routeId || ""}|${date}`;

export const filterOutAlreadyBookedMatches = (
  matches: WeeklyDayMatch[],
  alreadyBookedKeys: Set<string>,
): WeeklyDayMatch[] =>
  matches.filter(
    (match) => !alreadyBookedKeys.has(weeklyMatchKey(match.driverDay.routeId, match.driverDay.date)),
  );

export const computeWeeklyTotal = (
  days: { price: number; seats: number }[],
) => days.reduce((sum, day) => sum + Number(day.price || 0) * Number(day.seats || 1), 0);

// ---------------------------------------------------------------------------
// Results grouping — regroups a set of per-driver matches (from
// matchDriverWeeklyDays, run once per candidate driver) BY DATE instead of
// by driver, so the results screen can show "which trips exist for THIS
// date" independently per selected date. Never re-derives matching itself —
// every (driver, date) pair here is exactly one entry the caller already
// computed, so a trip can never appear under a date it didn't actually
// match, and never appears twice under the same date (matchDriverWeeklyDays
// itself never returns two matches for the same requested date — see its
// own `find`, which stops at the first match). See driverresults.tsx's own
// use of this for the real Firestore-driven case.
// ---------------------------------------------------------------------------

export type DateGroupedResults<TDriver> = Map<string, { driver: TDriver; match: WeeklyDayMatch }[]>;

export const groupMatchesByDate = <TDriver extends { id: string }>(
  sortedDates: WeeklyRequestDay[],
  candidateDrivers: TDriver[],
  matchesByDriverId: Record<string, WeeklyDayMatch[]>,
): DateGroupedResults<TDriver> => {
  const grouped: DateGroupedResults<TDriver> = new Map();
  sortedDates.forEach((day) => grouped.set(day.date, []));

  candidateDrivers.forEach((driver) => {
    (matchesByDriverId[driver.id] || []).forEach((match) => {
      const bucket = grouped.get(match.requested.date);
      if (bucket) bucket.push({ driver, match });
    });
  });

  grouped.forEach((bucket) => {
    bucket.sort((a, b) => {
      const aTime = a.match.driverDay.time || "";
      const bTime = b.match.driverDay.time || "";
      return aTime.localeCompare(bTime);
    });
  });

  return grouped;
};

// Deduplicates and chronologically sorts a raw list of requested dates,
// floored to today-or-future using ISRAEL-local "now" (never the device's
// own timezone) — the one shared source of truth every selected date is
// read from, both for matching and for results grouping, so the two can
// never disagree about which dates are being searched. See
// driverresults.tsx's own sortedRequestedDates.
export const dedupeSortFutureDates = (
  rawDays: WeeklyRequestDay[],
  todayYMD: string,
): WeeklyRequestDay[] => {
  const seen = new Set<string>();
  const deduped: WeeklyRequestDay[] = [];

  for (const day of rawDays) {
    if (!day?.date || day.date < todayYMD) continue;
    if (seen.has(day.date)) continue;
    seen.add(day.date);
    deduped.push(day);
  }

  return deduped.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
};
