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
//
// The dependency-free matching/date-key/Israel-timezone core (everything
// that doesn't need react-native's Alert or a live Firestore write) lives in
// weeklyBookingCore.ts instead — re-exported below so every existing call
// site's import path keeps working unchanged (same split/re-export pattern
// driverViolationsLib.ts already uses for driverViolationCore.ts). See that
// file's own header for why the split exists: this file can't be imported
// under this project's vitest config at all (react-native's own source uses
// Flow syntax the Node/Vite parser rejects outright).
// ---------------------------------------------------------------------------

import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { Alert } from "../AppAlert";

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
import {
  buildBookingDayFromMatch,
  computeWeeklyTotal,
  DayKey,
  DAY_KEY_LABEL,
  dayKeyFromAnyYMD,
  getAnyDateCalendarBounds,
  getDriverDayTrips,
  getLocalNowInIsrael,
  isDateSelectableForAnyDate,
  isTimeCloseEnough,
  matchDriverWeeklyDays,
  restoreSingleDateFromWeeklyRows,
  seedWeeklyRowsFromSingleDate,
  WeekDayRow,
  WeeklyDayMatch,
  WeeklyDriverDay,
  WeeklyRequestDay,
} from "./weeklyBookingCore";

export {
  buildBookingDayFromMatch,
  computeWeeklyTotal,
  DAY_KEY_LABEL,
  dayKeyFromAnyYMD,
  getAnyDateCalendarBounds,
  getDriverDayTrips,
  getLocalNowInIsrael,
  isDateSelectableForAnyDate,
  isTimeCloseEnough,
  matchDriverWeeklyDays,
  restoreSingleDateFromWeeklyRows,
  seedWeeklyRowsFromSingleDate,
};
export type { DayKey, WeekDayRow, WeeklyDayMatch, WeeklyDriverDay, WeeklyRequestDay };

// ---------------------------------------------------------------------------
// Day keys — DAY_KEYS/getDayKeyFromDate stay here (not in weeklyBookingCore)
// since getDayFromDateText comes from driverHelpers.ts, which weeklyBooking
// Core.ts deliberately never imports (see that file's header). dayKeyFromAny
// YMD above is the self-contained, vitest-safe equivalent used by matching.
// ---------------------------------------------------------------------------

export const DAY_KEYS: DayKey[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

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

const NEXT_WEEK_OPEN_MINUTES = 7 * 60; // 07:00 AM

const formatYMD = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
// UI row shape used by WeeklyDaysCard (shared by passenger + driver forms) —
// WeekDayRow itself is now defined in weeklyBookingCore.ts (re-exported
// above) since seedWeeklyRowsFromSingleDate/restoreSingleDateFromWeeklyRows
// need it there too; makeEmptyWeekDayRow stays here since nothing in the
// pure core module needs it.
// ---------------------------------------------------------------------------

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
  // `area` is a best-effort reverse-geocoded city/area name (see
  // resolvePickupArea in PickupLocationPicker.tsx) — display-only, never
  // required.
  pickupLocation?: {
    latitude: number;
    longitude: number;
    address: string;
    area?: string;
    source: "current" | "home" | "custom";
  } | null;
  // The driver's own route origin, snapshotted so the driver's incoming-
  // request card can show an approximate distance to the passenger's pickup
  // point without a second Firestore read per card (see
  // driverresults.tsx's handleBookDriver). Never required.
  driverFromLat?: number;
  driverFromLng?: number;

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
        ...(typeof input.driverFromLat === "number" && typeof input.driverFromLng === "number"
          ? { driverFromLat: input.driverFromLat, driverFromLng: input.driverFromLng }
          : {}),

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
