// ---------------------------------------------------------------------------
// Weekly booking – shared types, week/date helpers, matching, and the
// Firestore transaction that books one or more days of a driver's weekly
// trip in a single call.
//
// A weekly booking always covers a single Sunday-to-Saturday week (the one
// containing "today"). Passenger requests and driver weekly trips are both
// arrays of concrete calendar days (not abstract weekday names), so matching
// is a simple same-date comparison.
//
// Every booked day becomes its own document in the `bookings` collection
// (category "school" or "personal"), sharing a `bookingGroupId` so My
// Bookings can group them, but each day keeps its own status/paymentStatus
// because different days can end up with different drivers.
// ---------------------------------------------------------------------------

import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { Alert } from "react-native";

import { auth, db } from "../../firebase";
import i18n from "../i18n";
import { deepRemoveUndefined } from "./schoolTripsLib";
import { translateStoredDayName } from "../i18n/formatters";
import {
  formatDateToYMD,
  getDayFromDateText,
  normalizeDateToYMD,
  normalizeTime,
  parseDateInput,
} from "../driver/create/driverHelpers";
import { notify } from "./work-errand/workErrandLib";

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

export const DAY_KEYS: DayKey[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export const DAY_KEY_LABEL: Record<DayKey, string> = {
  sunday: "Sunday",
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
};

const SHORT_TO_DAYKEY: Record<string, DayKey> = {
  Sun: "sunday",
  Mon: "monday",
  Tue: "tuesday",
  Wed: "wednesday",
  Thu: "thursday",
  Fri: "friday",
  Sat: "saturday",
};

export const getDayKeyFromDate = (dateYMD: string): DayKey | "" => {
  const short = getDayFromDateText(dateYMD);
  return short ? SHORT_TO_DAYKEY[short] || "" : "";
};

const SHORT_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Same idea as getDayKeyFromDate, but doesn't go through
// normalizeDateToYMD/getDayFromDateText (which reject past dates using the
// DEVICE's timezone) — used for weekly validation (which already checked
// past/range itself using Israel-local time) and for display on dates that
// may already be in the past (an existing driver trip someone is matching
// against).
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
// Week bounds — Israel LOCAL time (Asia/Jerusalem), never UTC and never the
// device's own timezone. Weekly booking always covers exactly one
// Sunday-to-Saturday week; which week(s) are currently open depends on this
// clock, not on whatever timezone the passenger's or driver's phone happens
// to be set to.
//
// The next Sunday-to-Saturday week opens every Saturday at 07:00 AM Israel
// time and stays open until the following Sunday, at which point it becomes
// the "current" week and the week after it locks again until the next
// Saturday 07:00.
// ---------------------------------------------------------------------------

const ISRAEL_TIME_ZONE = "Asia/Jerusalem";
const NEXT_WEEK_OPEN_MINUTES = 7 * 60; // 07:00 AM

const formatYMD = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// "Now", as a Date object whose getFullYear/getMonth/getDate/getDay/
// getHours/getMinutes already read back the Israel-local wall-clock values.
// Every helper below can then just use plain Date getters — never UTC math
// — and can't drift a day off no matter what timezone the device is in.
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

export const getStartOfWeekSunday = (date: Date): Date => {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - start.getDay());
  return start;
};

export const getEndOfWeekSaturday = (date: Date): Date => {
  const end = getStartOfWeekSunday(date);
  end.setDate(end.getDate() + 6);
  return end;
};

// True from Saturday 07:00:00 Israel time through the end of that Saturday —
// this is the window where the next Sun-Sat week is open for booking.
export const isNextWeekOpen = (now: Date = getLocalNowInIsrael()): boolean => {
  if (now.getDay() !== 6) return false;
  return now.getHours() * 60 + now.getMinutes() >= NEXT_WEEK_OPEN_MINUTES;
};

export type WeekChoice = "current" | "next";

export const getAllowedWeeklyDateRange = (
  selectedWeek: WeekChoice = "current",
  now: Date = getLocalNowInIsrael(),
): { startYMD: string; endYMD: string } => {
  const currentStart = getStartOfWeekSunday(now);

  if (selectedWeek === "next") {
    const nextStart = new Date(currentStart);
    nextStart.setDate(nextStart.getDate() + 7);

    const nextEnd = new Date(nextStart);
    nextEnd.setDate(nextEnd.getDate() + 6);

    return { startYMD: formatYMD(nextStart), endYMD: formatYMD(nextEnd) };
  }

  return {
    startYMD: formatYMD(currentStart),
    endYMD: formatYMD(getEndOfWeekSaturday(now)),
  };
};

// Back-compat alias for any external caller still expecting the old shape.
export const getCurrentWeekBounds = () => getAllowedWeeklyDateRange("current");

// Which allowed week (if any) a date belongs to right now — "current",
// "next" (only meaningful while isNextWeekOpen()), or null if it's outside
// every currently-bookable week (including simply being in the past).
type WeekBucket = WeekChoice | null;

const getWeekBucketForDate = (
  cleanDate: string,
  now: Date = getLocalNowInIsrael(),
): WeekBucket => {
  const todayYMD = formatYMD(now);
  if (cleanDate < todayYMD) return null;

  const currentRange = getAllowedWeeklyDateRange("current", now);
  if (cleanDate >= currentRange.startYMD && cleanDate <= currentRange.endYMD) {
    return "current";
  }

  if (isNextWeekOpen(now)) {
    const nextRange = getAllowedWeeklyDateRange("next", now);
    if (cleanDate >= nextRange.startYMD && cleanDate <= nextRange.endYMD) {
      return "next";
    }
  }

  return null;
};

// today-or-future (Israel-local) AND inside the given allowed week.
export const isDateInAllowedWeek = (
  dateText: string,
  selectedWeek: WeekChoice = "current",
  now: Date = getLocalNowInIsrael(),
) => {
  const clean = normalizeDateToYMD(dateText);
  if (!clean) return false;

  const { startYMD, endYMD } = getAllowedWeeklyDateRange(selectedWeek, now);
  return clean >= startYMD && clean <= endYMD && clean >= formatYMD(now);
};

// Back-compat name — same as isDateInAllowedWeek(dateText, "current").
export const isDateInCurrentWeek = (dateText: string) =>
  isDateInAllowedWeek(dateText, "current");

// ---------------------------------------------------------------------------
// Day entry types
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
};

// Local UI row shape used by WeeklyDaysCard (shared by passenger + driver forms).
export type WeekDayRow = {
  id: string;
  date: string;
  time: string;
  seats: number;
  price: string;
};

export const makeEmptyWeekDayRow = (defaultTime: string): WeekDayRow => ({
  id: `row_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  date: "",
  time: defaultTime,
  seats: 1,
  price: "",
});

// ---------------------------------------------------------------------------
// Validation (mirrors driverHelpers' Alert-and-return-null pattern)
//
// This is the authoritative check before saving to Firestore — it never
// trusts that the calendar UI already blocked an invalid date (item 8):
// every row's date is independently re-checked against Israel-local "now"
// and the two possible open weeks, and every row is required to land in the
// SAME week bucket as the others.
// ---------------------------------------------------------------------------

// Parses "2026-07-04" / "04/07/2026" into a clean YYYY-MM-DD WITHOUT
// rejecting past dates (unlike normalizeDateToYMD, which rejects past dates
// using the DEVICE's timezone) — past/range rejection here is done
// separately, using Israel-local "now" (getWeekBucketForDate).
const parseAnyDateToYMD = (dateText: string): string | null => {
  const parsed = parseDateInput(dateText);
  return parsed ? formatDateToYMD(parsed) : null;
};

const isWeeklyTimeAvailable = (
  dateYMD: string,
  timeText: string,
  now: Date = getLocalNowInIsrael(),
): boolean => {
  const cleanTime = normalizeTime(timeText);
  if (!cleanTime) return false;

  const todayYMD = formatYMD(now);
  if (dateYMD < todayYMD) return false;
  if (dateYMD > todayYMD) return true;

  const [hours, minutes] = cleanTime.split(":").map(Number);
  const selectedMinutes = hours * 60 + minutes;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  return selectedMinutes > currentMinutes;
};

export const validateWeeklyRows = (
  rows: WeekDayRow[],
  options: { requirePrice?: boolean } = {},
): WeeklyDriverDay[] | null => {
  if (rows.length === 0) {
    Alert.alert(i18n.t("validation.missingDaysTitle"), i18n.t("validation.addAtLeastOneDayMessage"));
    return null;
  }

  const now = getLocalNowInIsrael();
  const seenDates = new Set<string>();
  const cleaned: WeeklyDriverDay[] = [];
  let lockedWeek: WeekChoice | null = null;

  for (const row of rows) {
    const cleanDate = parseAnyDateToYMD(row.date);

    if (!cleanDate) {
      Alert.alert(
        i18n.t("validation.invalidDateTitle"),
        i18n.t("validation.chooseValidDateEveryDay"),
      );
      return null;
    }

    const bucket = getWeekBucketForDate(cleanDate, now);

    if (!bucket) {
      Alert.alert(
        i18n.t("validation.bookingUnavailableTitle"),
        i18n.t("validation.bookingUnavailableThisWeekMessage"),
      );
      return null;
    }

    if (lockedWeek && bucket !== lockedWeek) {
      Alert.alert(
        i18n.t("validation.differentWeeksTitle"),
        i18n.t("validation.sameWeekRequiredMessage"),
      );
      return null;
    }

    lockedWeek = bucket;

    if (seenDates.has(cleanDate)) {
      Alert.alert(
        i18n.t("validation.duplicateDayTitle"),
        i18n.t("validation.duplicateDayMessage"),
      );
      return null;
    }

    seenDates.add(cleanDate);

    const cleanTime = normalizeTime(row.time);

    if (!cleanTime) {
      Alert.alert(
        i18n.t("validation.invalidTimeTitle"),
        i18n.t("validation.chooseValidTimeEveryDay"),
      );
      return null;
    }

    if (!isWeeklyTimeAvailable(cleanDate, cleanTime, now)) {
      Alert.alert(
        i18n.t("validation.invalidTimeTitle"),
        i18n.t("validation.timeAlreadyPassedTodayMessage"),
      );
      return null;
    }

    const seatsValue = Number(row.seats);

    if (!Number.isFinite(seatsValue) || seatsValue < 1 || seatsValue > 8) {
      Alert.alert(i18n.t("validation.invalidSeatsTitle"), i18n.t("validation.seatsRangeEveryDay"));
      return null;
    }

    let priceValue = 0;

    if (options.requirePrice) {
      priceValue = Number(row.price);

      if (!Number.isFinite(priceValue) || priceValue <= 0) {
        Alert.alert(
          i18n.t("validation.invalidPriceTitle"),
          i18n.t("validation.priceGreaterThanZeroEveryDay"),
        );
        return null;
      }
    }

    const dayKey = dayKeyFromAnyYMD(cleanDate);

    if (!dayKey) {
      Alert.alert(i18n.t("validation.invalidDateTitle"), i18n.t("validation.chooseValidDateEveryDayShort"));
      return null;
    }

    cleaned.push({
      dayKey,
      dayName: DAY_KEY_LABEL[dayKey],
      date: cleanDate,
      time: cleanTime,
      seats: seatsValue,
      price: priceValue,
      remainingSeats: seatsValue,
    });
  }

  return cleaned.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
};

// Personal Ride weekly creation (driver side) — unlike School's
// validateWeeklyRows above, this allows any number of today-or-future dates
// across ANY future month, never restricted to a single Sunday-to-Saturday
// week bucket. Every other check (past dates, duplicate dates, time already
// passed today, seats, price) is identical to validateWeeklyRows. Kept as a
// separate function rather than changing validateWeeklyRows so School's
// existing single-week restriction is never affected.
export const validateWeeklyRowsAnyFutureDate = (
  rows: WeekDayRow[],
  options: { requirePrice?: boolean } = {},
): WeeklyDriverDay[] | null => {
  if (rows.length === 0) {
    Alert.alert(i18n.t("validation.missingDaysTitle"), i18n.t("validation.addAtLeastOneDayMessage"));
    return null;
  }

  const now = getLocalNowInIsrael();
  const todayYMD = formatYMD(now);
  const seenDates = new Set<string>();
  const cleaned: WeeklyDriverDay[] = [];

  for (const row of rows) {
    const cleanDate = parseAnyDateToYMD(row.date);

    if (!cleanDate || cleanDate < todayYMD) {
      Alert.alert(
        i18n.t("validation.invalidDateTitle"),
        i18n.t("validation.chooseValidDateEveryDay"),
      );
      return null;
    }

    if (seenDates.has(cleanDate)) {
      Alert.alert(
        i18n.t("validation.duplicateDayTitle"),
        i18n.t("validation.duplicateDayMessage"),
      );
      return null;
    }

    seenDates.add(cleanDate);

    const cleanTime = normalizeTime(row.time);

    if (!cleanTime) {
      Alert.alert(
        i18n.t("validation.invalidTimeTitle"),
        i18n.t("validation.chooseValidTimeEveryDay"),
      );
      return null;
    }

    if (!isWeeklyTimeAvailable(cleanDate, cleanTime, now)) {
      Alert.alert(
        i18n.t("validation.invalidTimeTitle"),
        i18n.t("validation.timeAlreadyPassedTodayMessage"),
      );
      return null;
    }

    const seatsValue = Number(row.seats);

    if (!Number.isFinite(seatsValue) || seatsValue < 1 || seatsValue > 8) {
      Alert.alert(i18n.t("validation.invalidSeatsTitle"), i18n.t("validation.seatsRangeEveryDay"));
      return null;
    }

    let priceValue = 0;

    if (options.requirePrice) {
      priceValue = Number(row.price);

      if (!Number.isFinite(priceValue) || priceValue <= 0) {
        Alert.alert(
          i18n.t("validation.invalidPriceTitle"),
          i18n.t("validation.priceGreaterThanZeroEveryDay"),
        );
        return null;
      }
    }

    const dayKey = dayKeyFromAnyYMD(cleanDate);

    if (!dayKey) {
      Alert.alert(i18n.t("validation.invalidDateTitle"), i18n.t("validation.chooseValidDateEveryDayShort"));
      return null;
    }

    cleaned.push({
      dayKey,
      dayName: DAY_KEY_LABEL[dayKey],
      date: cleanDate,
      time: cleanTime,
      seats: seatsValue,
      price: priceValue,
      remainingSeats: seatsValue,
    });
  }

  return cleaned.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
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

const timeToMinutes = (time: string) => {
  const clean = normalizeTime(time);
  if (!clean) return null;

  const [hours, minutes] = clean.split(":").map(Number);
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

export const matchDriverWeeklyDays = (
  driver: any,
  requestedDays: WeeklyRequestDay[],
  options: { maxTimeDiffMinutes?: number } = {},
): WeeklyDayMatch[] => {
  const driverDayTrips = getDriverDayTrips(driver);

  if (driverDayTrips.length === 0) return [];

  const maxDiff = options.maxTimeDiffMinutes ?? 30;
  const matches: WeeklyDayMatch[] = [];

  for (const requested of requestedDays) {
    const driverDay = driverDayTrips.find(
      (trip) => trip.date === requested.date,
    );

    if (!driverDay) continue;

    const remaining =
      typeof driverDay.remainingSeats === "number"
        ? driverDay.remainingSeats
        : driverDay.seats;

    if (remaining < requested.seats) continue;
    if (!isTimeCloseEnough(driverDay.time, requested.time, maxDiff)) continue;

    matches.push({ requested, driverDay });
  }

  return matches;
};

// Turns a match into the day object that actually gets booked: driver's
// scheduled time + price, passenger's requested seat count.
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
});

export const computeWeeklyTotal = (
  days: { price: number; seats: number }[],
) => days.reduce((sum, day) => sum + Number(day.price || 0) * Number(day.seats || 1), 0);

// ---------------------------------------------------------------------------
// Firestore: book one or more days of a single driver's weekly trip
// ---------------------------------------------------------------------------

export type WeeklyPayment =
  | { method: "cash" }
  | { method: "card"; cardLast4: string }
  | { method: "bit" };

export type CreateWeeklyBookingsInput = {
  category: "school" | "personal";

  driverId: string;
  driverName: string;
  driverPhone?: string;

  driverCar?: string;
  driverCarColor?: string;
  driverCarPlateLast3?: string;

  routeId: string;
  from: string;
  to: string;
  // School only — the exact school/university name.
  schoolName?: string;
  // The exact place within the destination city (optional, Personal Ride
  // only) — informational for the driver, never used for matching.
  destinationDetails?: string;
  // The passenger's chosen pickup point (see PickupLocationPicker.tsx) —
  // the same point is shared by every selected day, same as from/to above.
  pickupLocation?: {
    latitude: number;
    longitude: number;
    address: string;
    source: "current" | "home" | "custom";
  } | null;

  // School only — the child(ren) this weekly booking is for, selected up
  // front on select-child.tsx (Home → School Ride) and carried through
  // LegacySchoolSearchForm.tsx → driverresults.tsx → ride-payment.tsx.
  // Undefined for Personal Ride and any School booking made before this
  // existed — every selected day gets the same roster (see the write below).
  childId?: string;
  childName?: string;
  childEntries?: { localId: string; childId?: string; childName?: string }[];

  selectedDays: WeeklyDriverDay[];
  payment: WeeklyPayment;
};

export const generateBookingGroupId = () =>
  `weekly_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

// Links the separate driverRoutes documents created from one weekly Personal
// Ride submission (one document per selected date — see RideForm.tsx) so
// they can be traced back to the same submission, without ever being stored
// as a single combined document. Same naming convention as
// generateBookingGroupId above.
export const generateWeeklyGroupId = () =>
  `weeklygrp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export const createWeeklyBookings = async (
  input: CreateWeeklyBookingsInput,
): Promise<{ bookingGroupId: string; bookingIds: string[] }> => {
  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t("validation.mustBeLoggedInToBook"));

  if (!input.routeId) {
    throw new Error(i18n.t("rides.missingTripId"));
  }

  if (!input.selectedDays || input.selectedDays.length === 0) {
    throw new Error(i18n.t("validation.chooseAtLeastOneDayToBook"));
  }

  let passengerName = user.displayName || i18n.t("common.passenger");
  let passengerPhone = "";

  try {
    const snap = await getDoc(doc(db, "users", user.uid));

    if (snap.exists()) {
      const data = snap.data();
      passengerName = data.name || passengerName;
      passengerPhone = data.phone || "";
    }
  } catch {
    // fallback to auth profile values
  }

  const bookingGroupId = generateBookingGroupId();
  const routeRef = doc(db, "driverRoutes", input.routeId);
  const bookingRefs = input.selectedDays.map(() => doc(collection(db, "bookings")));

  const paymentFields =
    input.payment.method === "cash"
      ? { paymentMethod: "cash", paymentStatus: "cash_pending", cardLast4: null }
      : input.payment.method === "bit"
        ? { paymentMethod: "bit", paymentStatus: "mock_paid", cardLast4: null }
        : {
            paymentMethod: "card",
            paymentStatus: "mock_paid",
            cardLast4: input.payment.cardLast4.slice(-4),
          };

  await runTransaction(db, async (transaction) => {
    const routeSnap = await transaction.get(routeRef);

    if (!routeSnap.exists()) {
      throw new Error(i18n.t("rides.tripNoLongerAvailable"));
    }

    const routeData: any = routeSnap.data();
    const hasWeeklyTrips =
      Array.isArray(routeData.weeklyTrips) && routeData.weeklyTrips.length > 0;

    if (hasWeeklyTrips) {
      const weeklyTrips: any[] = [...routeData.weeklyTrips];

      for (const day of input.selectedDays) {
        const index = weeklyTrips.findIndex((trip) => trip.date === day.date);

        if (index === -1) {
          throw new Error(
            i18n.t("booking.dayNoLongerAvailable", {
              day: translateStoredDayName(day.dayName, i18n.t),
            }),
          );
        }

        const currentRemaining =
          typeof weeklyTrips[index].remainingSeats === "number"
            ? weeklyTrips[index].remainingSeats
            : weeklyTrips[index].seats;

        if (currentRemaining < day.seats) {
          throw new Error(
            i18n.t("booking.dayNotEnoughSeats", {
              day: translateStoredDayName(day.dayName, i18n.t),
            }),
          );
        }

        weeklyTrips[index] = {
          ...weeklyTrips[index],
          remainingSeats: currentRemaining - day.seats,
        };
      }

      transaction.update(routeRef, {
        weeklyTrips,
        updatedAt: serverTimestamp(),
      });
    } else {
      // Normal one-day driver route matched against a single day of the
      // passenger's weekly request. It has no per-day remainingSeats to
      // decrement — booking its one day consumes the whole route, exactly
      // like the quick-booking flow does.
      const alreadyBooked =
        routeData.status === "booked" ||
        routeData.status === "completed" ||
        routeData.tripStatus === "completed" ||
        routeData.isBooked === true ||
        routeData.available === false ||
        !!routeData.bookingId ||
        !!routeData.bookedBy;

      if (alreadyBooked) {
        throw new Error(i18n.t("rides.tripAlreadyBooked"));
      }

      const routeSeats = Number(routeData.seats || 0);
      const requestedSeats = input.selectedDays[0]?.seats || 0;

      if (routeSeats < requestedSeats) {
        throw new Error(i18n.t("booking.notEnoughSeatsAvailable"));
      }

      transaction.update(routeRef, {
        status: "booked",
        tripStatus: "booked",
        isBooked: true,
        available: false,
        bookingId: bookingRefs[0].id,
        bookedBy: user.uid,
        bookedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    input.selectedDays.forEach((day, index) => {
      transaction.set(bookingRefs[index], {
        bookingGroupId,
        bookingType: "weekly",
        category: input.category,

        passengerId: user.uid,
        passengerName,
        passengerPhone,

        driverId: input.driverId || null,
        driverName: input.driverName || "Driver",
        driverPhone: input.driverPhone || "",

        driverCar: input.driverCar || "",
        driverCarColor: input.driverCarColor || "",
        driverCarPlateLast3: input.driverCarPlateLast3 || "",

        routeId: input.routeId,
        from: input.from || "",
        to: input.to || "",
        schoolName: input.schoolName || null,
        destinationDetails: input.destinationDetails || null,
        pickupLocation: input.pickupLocation || null,

        childId: input.childId || null,
        childName: input.childName || null,
        // deepRemoveUndefined defensively, same as every other school-
        // booking write (see its own header comment in schoolTripsLib.ts) —
        // Firestore rejects a literal `undefined` anywhere in the document,
        // including nested inside this array.
        childEntries:
          input.childEntries && input.childEntries.length > 0
            ? deepRemoveUndefined(input.childEntries)
            : null,

        dayKey: day.dayKey,
        dayName: day.dayName,
        date: day.date,
        time: day.time,
        seats: day.seats,
        price: day.price,

        ...paymentFields,

        status: "ongoing",
        tripStatus: "booked",
        trackingEnabled: false,

        driverLocation: null,
        driverLocationUpdatedAt: null,

        needsPassengerRating: false,
        ratingSubmitted: false,
        rating: null,
        reviewComment: "",
        ratedAt: null,

        finishedByDriver: false,

        roleType: "passenger_booking",
        deletedForPassenger: false,
        deletedForDriver: false,

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),

        startedAt: null,
        arrivedAt: null,
        completedAt: null,
      });
    });
  });

  if (input.driverId) {
    await Promise.all(
      input.selectedDays.map((day) =>
        notify({
          receiverId: input.driverId,
          senderId: user.uid,
          type:
            input.category === "school"
              ? "school_ride_booking"
              : "personal_ride_booking",
          title: "New weekly ride booking",
          message: `${passengerName} booked ${day.dayName} with you`,
          applicationId: bookingGroupId,
          bookingId: bookingGroupId,
          category: input.category,
          status: "booked",
          targetTab: "driver",
        }),
      ),
    );
  }

  return {
    bookingGroupId,
    bookingIds: bookingRefs.map((ref) => ref.id),
  };
};
