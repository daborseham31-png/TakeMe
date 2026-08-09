// ---------------------------------------------------------------------------
// Regression tests for the Personal Ride multi-date ("rest of the week")
// search flow — two bugs:
//
// 1. Switching to multi-date mode discarded the date already selected in
//    the single-date field instead of carrying it forward (see
//    app/personal-ride/index.tsx's toggleWeeklyBooking, which now delegates
//    to seedWeeklyRowsFromSingleDate/restoreSingleDateFromWeeklyRows below).
//
// 2. Search results implicitly behaved as if a trip had to exist on EVERY
//    selected date (an AND), rather than showing whichever trips exist on
//    ANY selected date, grouped by date, with a clear per-date "no trips"
//    message for the rest (see app/booking/driverresults.tsx, which now
//    delegates to dedupeSortFutureDates/groupMatchesByDate below).
//
// driverresults.tsx and app/personal-ride/index.tsx are both React Native
// screens (pull in react-native/expo-router) and are not importable under
// vitest — see this project's other *.test.ts files' own headers for the
// same constraint, and weeklyBookingCore.ts's own header for why the pure
// logic these two screens now both delegate to lives in its own
// dependency-free module instead of being re-implemented here.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  dedupeSortFutureDates,
  getLocalNowInIsrael,
  groupMatchesByDate,
  isTimeCloseEnough,
  matchDriverWeeklyDays,
  restoreSingleDateFromWeeklyRows,
  seedWeeklyRowsFromSingleDate,
  WeekDayRow,
  WeeklyRequestDay,
} from "../app/booking/weeklyBookingCore";

// A fixed "today" used throughout — every scenario below is built relative
// to this, never the real current date, so the tests never become flaky as
// time passes.
const TODAY_YMD = "2026-08-10"; // a Monday
const WED = "2026-08-12";
const THU = "2026-08-13";
const FRI = "2026-08-14";

const requestDay = (date: string, dayName = "day", time = "09:00", seats = 1): WeeklyRequestDay => ({
  dayKey: "wednesday",
  dayName,
  date,
  time,
  seats,
});

const weekRow = (date: string, time = "09:00"): WeekDayRow => ({
  id: `row-${date}`,
  date,
  time,
  seats: 1,
  price: "",
});

// A driverRoutes-shaped candidate whose only trip is on `date` — mirrors
// exactly what driverresults.tsx reads (getDriverDayTrips' own one-day
// fallback branch).
const driverWithSingleTrip = (id: string, date: string, time = "09:00", seats = 2) => ({
  id,
  tripDate: date,
  time,
  seats,
  price: 40,
});

describe("Bug 1: single-date <-> multi-date state hand-off", () => {
  it("1. the first selected date remains when multi-date/rest-of-week mode is enabled", () => {
    const seeded = seedWeeklyRowsFromSingleDate([], WED, "09:00", TODAY_YMD);

    expect(seeded).toHaveLength(1);
    expect(seeded[0].date).toBe(WED);
    expect(seeded[0].time).toBe("09:00");
  });

  it("seeding never resets/duplicates an already-built weekly list", () => {
    const existing = [weekRow(THU), weekRow(FRI)];
    const seeded = seedWeeklyRowsFromSingleDate(existing, WED, "09:00", TODAY_YMD);

    // Unchanged — WED was never inserted, THU/FRI weren't touched.
    expect(seeded).toBe(existing);
    expect(seeded.map((r) => r.date)).toEqual([THU, FRI]);
  });

  it("seeding never inserts a missing or past single date", () => {
    expect(seedWeeklyRowsFromSingleDate([], "", "09:00", TODAY_YMD)).toEqual([]);
    expect(seedWeeklyRowsFromSingleDate([], "2026-08-01", "09:00", TODAY_YMD)).toEqual([]);
  });

  it("2. disabling multi-date mode restores/keeps the original selected date", () => {
    const rows = [weekRow(WED, "10:30"), weekRow(THU)];
    const restored = restoreSingleDateFromWeeklyRows(rows);

    expect(restored).toEqual({ date: WED, time: "10:30" });
  });

  it("disabling with an empty weekly list leaves nothing to restore", () => {
    expect(restoreSingleDateFromWeeklyRows([])).toBeNull();
  });
});

describe("Bug 2: each selected date is matched independently (OR, never AND)", () => {
  it("3. two selected dates, a trip on only one date, still displays that trip", () => {
    const driver = driverWithSingleTrip("driver-thu", THU);
    const requested = [requestDay(WED), requestDay(THU)];

    const matches = matchDriverWeeklyDays(driver, requested);

    // Matched exactly the one date the trip actually exists on — the
    // driver is still returned (kept in results) even though WED has no
    // matching trip at all.
    expect(matches).toHaveLength(1);
    expect(matches[0].requested.date).toBe(THU);
  });

  it("4. three selected dates with trips on two dates: both result groups populate, one date is left with no matches", () => {
    const driverWed = driverWithSingleTrip("driver-wed", WED);
    const driverThu = driverWithSingleTrip("driver-thu", THU);
    const requested = [requestDay(WED), requestDay(THU), requestDay(FRI)];
    const sortedDates = dedupeSortFutureDates(requested, TODAY_YMD);

    const matchesByDriverId: Record<string, ReturnType<typeof matchDriverWeeklyDays>> = {
      [driverWed.id]: matchDriverWeeklyDays(driverWed, requested),
      [driverThu.id]: matchDriverWeeklyDays(driverThu, requested),
    };

    const grouped = groupMatchesByDate(sortedDates, [driverWed, driverThu], matchesByDriverId);

    expect(grouped.get(WED)).toHaveLength(1);
    expect(grouped.get(WED)?.[0].driver.id).toBe("driver-wed");
    expect(grouped.get(THU)).toHaveLength(1);
    expect(grouped.get(THU)?.[0].driver.id).toBe("driver-thu");
    // FRI has no matching trip — present as its own empty group, never
    // dropped from the map (this is what lets the UI show its own
    // "No trips were found for this date." message).
    expect(grouped.get(FRI)).toEqual([]);
  });

  it("5. no trips on any selected date: every date gets its own empty group", () => {
    const driverUnrelated = driverWithSingleTrip("driver-x", "2026-09-01");
    const requested = [requestDay(WED), requestDay(THU), requestDay(FRI)];
    const sortedDates = dedupeSortFutureDates(requested, TODAY_YMD);

    const matchesByDriverId = { [driverUnrelated.id]: matchDriverWeeklyDays(driverUnrelated, requested) };
    const grouped = groupMatchesByDate(sortedDates, [driverUnrelated], matchesByDriverId);

    expect(grouped.size).toBe(3);
    expect(grouped.get(WED)).toEqual([]);
    expect(grouped.get(THU)).toEqual([]);
    expect(grouped.get(FRI)).toEqual([]);
  });

  it("6. duplicate selected dates do not duplicate results", () => {
    const requested = [requestDay(WED), requestDay(WED), requestDay(THU)];
    const deduped = dedupeSortFutureDates(requested, TODAY_YMD);

    expect(deduped.map((d) => d.date)).toEqual([WED, THU]);

    // Even if a duplicate somehow slipped into matching directly, grouping
    // must still never produce two entries under the same date for the
    // same driver — the map is keyed by date and a driver's own single
    // trip.date can only ever equal ONE requested.date value once.
    const driver = driverWithSingleTrip("driver-wed", WED);
    const grouped = groupMatchesByDate(deduped, [driver], {
      [driver.id]: matchDriverWeeklyDays(driver, deduped),
    });
    expect(grouped.get(WED)).toHaveLength(1);
  });

  it("trips are sorted by departure time within a date group", () => {
    const early = driverWithSingleTrip("driver-early", WED, "07:00");
    const late = driverWithSingleTrip("driver-late", WED, "18:00");
    const requested = [requestDay(WED)];
    // A wide time window so both drivers' quite different departure times
    // both count as a match — this test is about sort order, not the
    // (already covered elsewhere) time-closeness filter.
    const options = { maxTimeDiffMinutes: 12 * 60 };

    const grouped = groupMatchesByDate(requested, [late, early], {
      [late.id]: matchDriverWeeklyDays(late, requested, options),
      [early.id]: matchDriverWeeklyDays(early, requested, options),
    });

    expect(grouped.get(WED)?.map((r) => r.driver.id)).toEqual(["driver-early", "driver-late"]);
  });
});

describe("7. date comparison is correct in the Israel timezone", () => {
  it("getLocalNowInIsrael reads back Israel wall-clock Y/M/D, not UTC or the test runner's own zone", () => {
    // A fixed real instant just past midnight in Israel (UTC+3 in August,
    // daylight saving) but still the PREVIOUS calendar day in UTC — the
    // exact class of bug ("Avoid UTC conversion shifting a trip into the
    // previous or next day") this fix's own requirements call out.
    // 2026-08-12T22:30:00Z = 2026-08-13T01:30 in Asia/Jerusalem (UTC+3).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T22:30:00.000Z"));

    try {
      const israelNow = getLocalNowInIsrael();
      expect(israelNow.getFullYear()).toBe(2026);
      expect(israelNow.getMonth()).toBe(7); // 0-indexed: August
      expect(israelNow.getDate()).toBe(13);
      expect(israelNow.getHours()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("dedupeSortFutureDates floors to the given Israel-local today, excluding anything earlier", () => {
    const requested = [requestDay("2026-08-09"), requestDay(TODAY_YMD), requestDay(WED)];
    const deduped = dedupeSortFutureDates(requested, TODAY_YMD);

    expect(deduped.map((d) => d.date)).toEqual([TODAY_YMD, WED]);
  });
});

describe("8. cancelled and expired trips remain excluded", () => {
  // matchDriverWeeklyDays/getDriverDayTrips only ever compare DATES — the
  // cancelled/deleted-listing check happens one layer up, in
  // driverresults.tsx's own commonFiltered (see isCancelledTripStatus in
  // driverViolationCore.ts). That module transitively imports firebase/
  // react-native and can't be imported here (same constraint as this file's
  // own header) — this mirrors its exact predicate shape instead, the same
  // way tests/legacyWeeklySchoolRouteMatch.test.ts mirrors driverresults.tsx's
  // own candidate-building rather than re-importing the screen.
  const isCancelledStatus = (status: unknown) =>
    status === "cancelled" || status === "cancelled_by_driver";

  const isActiveListing = (driver: Record<string, unknown>) =>
    driver.active !== false && !isCancelledStatus(driver.status) && driver.deletedForDriver !== true;

  it("a cancelled or driver-deleted listing is excluded before matching ever runs", () => {
    const cancelled = { ...driverWithSingleTrip("driver-cancelled", WED), status: "cancelled_by_driver" };
    const deleted = { ...driverWithSingleTrip("driver-deleted", WED), deletedForDriver: true };
    const active = driverWithSingleTrip("driver-active", WED);

    expect(isActiveListing(cancelled)).toBe(false);
    expect(isActiveListing(deleted)).toBe(false);
    expect(isActiveListing(active)).toBe(true);
  });

  it("an expired (past) requested date is filtered out before matching, so a past trip can never surface", () => {
    const pastDate = "2026-08-01";
    const driver = driverWithSingleTrip("driver-past", pastDate);
    const requested = [requestDay(pastDate), requestDay(WED)];

    const sortedDates = dedupeSortFutureDates(requested, TODAY_YMD);

    // The past date never even reaches matching/grouping.
    expect(sortedDates.map((d) => d.date)).toEqual([WED]);

    const grouped = groupMatchesByDate(sortedDates, [driver], {
      [driver.id]: matchDriverWeeklyDays(driver, sortedDates),
    });
    expect(grouped.has(pastDate)).toBe(false);
    expect(grouped.get(WED)).toEqual([]);
  });

  it("seats and time-window filters inside matchDriverWeeklyDays are unchanged", () => {
    const notEnoughSeats = driverWithSingleTrip("driver-small", WED, "09:00", 1);
    const tooFarInTime = driverWithSingleTrip("driver-late", WED, "23:00");
    const requested = [requestDay(WED, "day", "09:00", 2)];

    expect(matchDriverWeeklyDays(notEnoughSeats, requested)).toHaveLength(0);
    expect(matchDriverWeeklyDays(tooFarInTime, [requestDay(WED, "day", "09:00", 1)])).toHaveLength(0);
    expect(isTimeCloseEnough("09:00", "09:20")).toBe(true);
    expect(isTimeCloseEnough("09:00", "10:00")).toBe(false);
  });
});
