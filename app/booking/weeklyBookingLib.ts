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
import {
  getDayFromDateText,
  getTodayYMD,
  isTimeAvailableForDate,
  normalizeDateToYMD,
  normalizeTime,
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
// normalizeDateToYMD/getDayFromDateText (which reject past dates) — used
// purely for display, on dates that may already be in the past (an existing
// driver trip someone is matching against).
const dayKeyFromAnyYMD = (dateYMD: string): DayKey | "" => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateYMD || ""));
  if (!match) return "";

  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));

  if (Number.isNaN(date.getTime())) return "";

  const short = SHORT_DAY_NAMES[date.getDay()];
  return SHORT_TO_DAYKEY[short] || "";
};

// ---------------------------------------------------------------------------
// Week bounds (current Sunday -> Saturday, relative to "today")
// ---------------------------------------------------------------------------

const parseYMD = (ymd: string) => {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const formatYMD = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const getCurrentWeekBounds = () => {
  const today = parseYMD(getTodayYMD());

  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);

  return { startYMD: formatYMD(startOfWeek), endYMD: formatYMD(endOfWeek) };
};

// today-or-future (normalizeDateToYMD already rejects past dates) AND
// inside the current Sun-Sat week.
export const isDateInCurrentWeek = (dateText: string) => {
  const clean = normalizeDateToYMD(dateText);
  if (!clean) return false;

  const { endYMD } = getCurrentWeekBounds();
  return clean <= endYMD;
};

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
// ---------------------------------------------------------------------------

export const validateWeeklyRows = (
  rows: WeekDayRow[],
  options: { requirePrice?: boolean } = {},
): WeeklyDriverDay[] | null => {
  if (rows.length === 0) {
    Alert.alert("Missing days", "Please add at least one day for this week.");
    return null;
  }

  const seenDates = new Set<string>();
  const cleaned: WeeklyDriverDay[] = [];

  for (const row of rows) {
    const cleanDate = normalizeDateToYMD(row.date);

    if (!cleanDate) {
      Alert.alert(
        "Invalid date",
        "Please choose a valid date (today or later) for every day.",
      );
      return null;
    }

    if (!isDateInCurrentWeek(cleanDate)) {
      Alert.alert(
        "Invalid date",
        "Weekly booking only supports the current week (Sunday to Saturday). Please choose a date in this week.",
      );
      return null;
    }

    if (seenDates.has(cleanDate)) {
      Alert.alert(
        "Duplicate day",
        "You already added this date. Please choose a different day.",
      );
      return null;
    }

    seenDates.add(cleanDate);

    const cleanTime = normalizeTime(row.time);

    if (!cleanTime) {
      Alert.alert(
        "Invalid time",
        "Please choose a valid time between 00:00 and 23:59 for every day.",
      );
      return null;
    }

    if (!isTimeAvailableForDate(cleanDate, cleanTime)) {
      Alert.alert(
        "Invalid time",
        "You cannot choose a time that already passed today.",
      );
      return null;
    }

    const seatsValue = Number(row.seats);

    if (!Number.isFinite(seatsValue) || seatsValue < 1 || seatsValue > 8) {
      Alert.alert("Invalid seats", "Seats must be between 1 and 8 for every day.");
      return null;
    }

    let priceValue = 0;

    if (options.requirePrice) {
      priceValue = Number(row.price);

      if (!Number.isFinite(priceValue) || priceValue <= 0) {
        Alert.alert(
          "Invalid price",
          "Please enter a price greater than 0 for every day.",
        );
        return null;
      }
    }

    const dayKey = getDayKeyFromDate(cleanDate);

    if (!dayKey) {
      Alert.alert("Invalid date", "Please choose a valid date for every day.");
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
  | { method: "card"; cardLast4: string };

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

  selectedDays: WeeklyDriverDay[];
  payment: WeeklyPayment;
};

export const generateBookingGroupId = () =>
  `weekly_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export const createWeeklyBookings = async (
  input: CreateWeeklyBookingsInput,
): Promise<{ bookingGroupId: string; bookingIds: string[] }> => {
  const user = auth.currentUser;
  if (!user) throw new Error("You must be logged in to book.");

  if (!input.routeId) {
    throw new Error(
      "Missing trip id. Please go back and choose the driver again.",
    );
  }

  if (!input.selectedDays || input.selectedDays.length === 0) {
    throw new Error("Please choose at least one day to book.");
  }

  let passengerName = user.displayName || "Passenger";
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
      : {
          paymentMethod: "card",
          paymentStatus: "mock_paid",
          cardLast4: input.payment.cardLast4.slice(-4),
        };

  await runTransaction(db, async (transaction) => {
    const routeSnap = await transaction.get(routeRef);

    if (!routeSnap.exists()) {
      throw new Error("This trip is no longer available.");
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
            `This driver no longer has ${day.dayName} available.`,
          );
        }

        const currentRemaining =
          typeof weeklyTrips[index].remainingSeats === "number"
            ? weeklyTrips[index].remainingSeats
            : weeklyTrips[index].seats;

        if (currentRemaining < day.seats) {
          throw new Error(
            `${day.dayName} no longer has enough seats. Please choose another driver.`,
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
        throw new Error("This trip was already booked by someone else.");
      }

      const routeSeats = Number(routeData.seats || 0);
      const requestedSeats = input.selectedDays[0]?.seats || 0;

      if (routeSeats < requestedSeats) {
        throw new Error(
          "Not enough seats available. Please choose another driver.",
        );
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
