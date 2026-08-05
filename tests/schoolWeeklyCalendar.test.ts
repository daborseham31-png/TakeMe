// ---------------------------------------------------------------------------
// Regression tests for the Driver -> School -> Weekly/Recurring trip
// creation calendar bug: the day-row date picker (WeeklyDaysCard.tsx's
// calendarVariant="anyDate") was previously left on "singleWeek"
// (app/driver/create/RideForm.tsx), which clamps the native date picker's
// maximumDate to the end of the current Sunday-Saturday week — every date
// past that Saturday (including the rest of the current month and every
// future month) was wrongly disabled. "anyDate" has no such clamp: today
// (Israel-local) is the only floor, with no upper bound at all.
//
// WeeklyDaysCard.tsx/RideForm.tsx are React Native screens (pull in
// react-native/expo-router) and are not importable under vitest — see this
// project's other *.test.ts files' own headers for the same constraint.
// These tests exercise the exact pure predicate/bounds functions
// WeeklyDaysCard.tsx now calls for calendarVariant="anyDate" (see
// weeklyBookingCore.ts's own header), not a re-implementation.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from "vitest";

import {
  formatYMD,
  getAnyDateCalendarBounds,
  getLocalNowInIsrael,
  isDateSelectableForAnyDate,
} from "../app/booking/weeklyBookingCore";

// A fixed "now" used throughout — Monday, 5 August 2026, 10:00 Israel-local
// — matching this bug's own reported example exactly.
const FIXED_NOW = new Date(2026, 7, 5, 10, 0, 0); // local machine time, August is month index 7

describe("School weekly/recurring calendar (calendarVariant=\"anyDate\")", () => {
  it("1. past dates are disabled", () => {
    expect(isDateSelectableForAnyDate("2026-08-01", FIXED_NOW)).toBe(false);
    expect(isDateSelectableForAnyDate("2026-08-04", FIXED_NOW)).toBe(false);
    expect(isDateSelectableForAnyDate("2026-07-31", FIXED_NOW)).toBe(false);
  });

  it("2. today is enabled", () => {
    expect(isDateSelectableForAnyDate("2026-08-05", FIXED_NOW)).toBe(true);
  });

  it("3. tomorrow and later dates (including the rest of the current week) are enabled", () => {
    expect(isDateSelectableForAnyDate("2026-08-06", FIXED_NOW)).toBe(true);
    expect(isDateSelectableForAnyDate("2026-08-07", FIXED_NOW)).toBe(true);
    expect(isDateSelectableForAnyDate("2026-08-08", FIXED_NOW)).toBe(true);
    // Past the current Sunday-Saturday week (2-8 Aug) — the exact dates
    // "singleWeek" used to wrongly disable.
    expect(isDateSelectableForAnyDate("2026-08-09", FIXED_NOW)).toBe(true);
    expect(isDateSelectableForAnyDate("2026-08-15", FIXED_NOW)).toBe(true);
    expect(isDateSelectableForAnyDate("2026-08-31", FIXED_NOW)).toBe(true);
  });

  it("4. future dates in the next month (and beyond) are enabled — no month restriction", () => {
    expect(isDateSelectableForAnyDate("2026-09-01", FIXED_NOW)).toBe(true);
    expect(isDateSelectableForAnyDate("2026-12-25", FIXED_NOW)).toBe(true);
    expect(isDateSelectableForAnyDate("2027-01-01", FIXED_NOW)).toBe(true);
  });

  it("the native picker's minimumDate is Israel-local today at midnight, and maximumDate is unset (no upper bound)", () => {
    const bounds = getAnyDateCalendarBounds(FIXED_NOW);

    expect(formatYMD(bounds.minimumDate)).toBe("2026-08-05");
    expect(bounds.minimumDate.getHours()).toBe(0);
    expect(bounds.maximumDate).toBeUndefined();
  });

  it("an empty/missing date is never treated as selectable", () => {
    expect(isDateSelectableForAnyDate("", FIXED_NOW)).toBe(false);
  });
});

describe("5. Israel timezone does not shift today to the previous (or next) day", () => {
  it("getLocalNowInIsrael reads back Israel wall-clock Y/M/D even when UTC is still on the previous day", () => {
    // 2026-08-04T22:00:00Z = 2026-08-05T01:00 in Asia/Jerusalem (UTC+3,
    // daylight saving in August) — UTC is still 4 August, but the correct
    // "today" for this calendar is already 5 August. This is the exact
    // class of bug ("UTC conversion so today isn't accidentally disabled")
    // this fix's own requirements call out.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T22:00:00.000Z"));

    try {
      const israelNow = getLocalNowInIsrael();
      const todayYMD = formatYMD(israelNow);

      expect(todayYMD).toBe("2026-08-05");
      expect(isDateSelectableForAnyDate("2026-08-05", israelNow)).toBe(true);
      expect(isDateSelectableForAnyDate("2026-08-04", israelNow)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("getAnyDateCalendarBounds' minimumDate matches the Israel-local date, not a UTC-shifted one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T22:00:00.000Z"));

    try {
      const bounds = getAnyDateCalendarBounds(getLocalNowInIsrael());
      expect(formatYMD(bounds.minimumDate)).toBe("2026-08-05");
    } finally {
      vi.useRealTimers();
    }
  });
});
