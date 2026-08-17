// ---------------------------------------------------------------------------
// Regression tests for the Weekly Personal Ride multi-day-single-payment fix.
//
// Root cause: a driver's Weekly Personal Ride is stored as one SEPARATE
// driverRoutes document PER selected date (see RideForm.tsx's own comment),
// sharing a `weeklyGroupId` field that used to be written but never read
// back. Matching a single document on its own (matchDriverWeeklyDays) can
// only ever surface the ONE day that document holds, which is why the
// "Book this driver" bottom sheet used to only show the day whose card was
// clicked. groupDriversByWeeklySeries/matchWeeklyGroupDays (both in
// weeklyBookingCore.ts) fix this by grouping sibling documents by
// weeklyGroupId and matching against the UNION of their days.
//
// See tests/personalRideWeeklySearch.test.ts's own header for why this pure
// logic lives in its own dependency-free module (driverresults.tsx/
// weeklyBookingLib.ts pull in react-native/firebase and aren't importable
// under vitest).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import {
  buildBookingDayFromMatch,
  computeWeeklyTotal,
  filterOutAlreadyBookedMatches,
  groupDriversByWeeklySeries,
  matchDriverWeeklyDays,
  matchWeeklyGroupDays,
  weeklyMatchKey,
  WeeklyRequestDay,
} from "../app/booking/weeklyBookingCore";

const TODAY_YMD = "2026-08-10"; // a Monday
const SUN = "2026-08-16";
const TUE = "2026-08-18";
const THU = "2026-08-20";

const requestDay = (date: string, dayName = "day", time = "15:00", seats = 1): WeeklyRequestDay => ({
  dayKey: "sunday",
  dayName,
  date,
  time,
  seats,
});

// One driverRoutes document holding exactly ONE day — mirrors exactly what
// RideForm.tsx writes for a recurring Personal Ride: `weeklyTrips: [{...}]`
// plus a shared `weeklyGroupId`.
const weeklyDoc = (
  id: string,
  groupId: string,
  date: string,
  opts: { time?: string; price?: number; seats?: number; remainingSeats?: number } = {},
) => ({
  id,
  weeklyGroupId: groupId,
  category: "personal",
  weeklyTrips: [
    {
      date,
      time: opts.time ?? "15:00",
      price: opts.price ?? 40,
      seats: opts.seats ?? 4,
      remainingSeats: opts.remainingSeats ?? opts.seats ?? 4,
    },
  ],
});

describe("TEST 1: same driver, three days — grouping surfaces every day, not just one", () => {
  it("clicking ANY one of the three per-day documents' cards resolves the SAME full 3-day match list", () => {
    const groupId = "weeklygrp_driverA";
    const sunDoc = weeklyDoc("routeA-sun", groupId, SUN);
    const tueDoc = weeklyDoc("routeA-tue", groupId, TUE);
    const thuDoc = weeklyDoc("routeA-thu", groupId, THU);

    const requested = [requestDay(SUN), requestDay(TUE), requestDay(THU)];

    // Matching a SINGLE document in isolation (the old behavior) really
    // does only ever surface its own one day — this is the root cause,
    // asserted directly so a future regression here is caught immediately.
    expect(matchDriverWeeklyDays(sunDoc, requested)).toHaveLength(1);

    // Grouping by weeklyGroupId + matching the UNION is the fix: every
    // member resolves to the SAME combined 3-day list.
    const groups = groupDriversByWeeklySeries([sunDoc, tueDoc, thuDoc]);
    expect(groups.size).toBe(1);

    const members = groups.get(groupId)!;
    const combined = matchWeeklyGroupDays(members, requested);

    expect(combined.map((m) => m.requested.date).sort()).toEqual([SUN, THU, TUE].sort());
    expect(combined).toHaveLength(3);
  });

  it("Select All (the full combined match list) totals the sum of all three days' price", () => {
    const groupId = "weeklygrp_driverA";
    const members = [
      weeklyDoc("routeA-sun", groupId, SUN, { price: 40 }),
      weeklyDoc("routeA-tue", groupId, TUE, { price: 40 }),
      weeklyDoc("routeA-thu", groupId, THU, { price: 40 }),
    ];
    const requested = [requestDay(SUN), requestDay(TUE), requestDay(THU)];

    const matches = matchWeeklyGroupDays(members, requested);
    const selectedDays = matches.map(buildBookingDayFromMatch);

    expect(computeWeeklyTotal(selectedDays)).toBe(120);
  });

  it("each booked day carries its OWN source document's routeId (never the clicked card's id for every day)", () => {
    const groupId = "weeklygrp_driverA";
    const members = [
      weeklyDoc("routeA-sun", groupId, SUN),
      weeklyDoc("routeA-tue", groupId, TUE),
      weeklyDoc("routeA-thu", groupId, THU),
    ];
    const requested = [requestDay(SUN), requestDay(TUE), requestDay(THU)];

    const selectedDays = matchWeeklyGroupDays(members, requested).map(buildBookingDayFromMatch);
    const byDate = Object.fromEntries(selectedDays.map((d) => [d.date, d.routeId]));

    expect(byDate[SUN]).toBe("routeA-sun");
    expect(byDate[TUE]).toBe("routeA-tue");
    expect(byDate[THU]).toBe("routeA-thu");
  });
});

describe("TEST 2: same driver, partial selection", () => {
  it("selecting only Sunday and Thursday from the full match list leaves Tuesday out of the total", () => {
    const groupId = "weeklygrp_driverA";
    const members = [
      weeklyDoc("routeA-sun", groupId, SUN, { price: 40 }),
      weeklyDoc("routeA-tue", groupId, TUE, { price: 40 }),
      weeklyDoc("routeA-thu", groupId, THU, { price: 40 }),
    ];
    const requested = [requestDay(SUN), requestDay(TUE), requestDay(THU)];

    const allMatches = matchWeeklyGroupDays(members, requested);
    const chosen = allMatches.filter((m) => m.requested.date === SUN || m.requested.date === THU);
    const selectedDays = chosen.map(buildBookingDayFromMatch);

    expect(selectedDays.map((d) => d.date)).toEqual([SUN, THU]);
    expect(computeWeeklyTotal(selectedDays)).toBe(80);
  });
});

describe("TEST 3: different drivers cover different days — remaining/uncovered dates", () => {
  it("driver A covers Sunday+Tuesday, driver B covers Thursday — each is its own group", () => {
    const driverAGroup = "weeklygrp_driverA";
    const driverBGroup = "weeklygrp_driverB";

    const allDocs = [
      weeklyDoc("routeA-sun", driverAGroup, SUN),
      weeklyDoc("routeA-tue", driverAGroup, TUE),
      weeklyDoc("routeB-thu", driverBGroup, THU),
    ];

    const groups = groupDriversByWeeklySeries(allDocs);
    expect(groups.size).toBe(2);
    expect(groups.get(driverAGroup)!.map((d) => d.id).sort()).toEqual(["routeA-sun", "routeA-tue"]);
    expect(groups.get(driverBGroup)!.map((d) => d.id)).toEqual(["routeB-thu"]);
  });

  it("booking Sunday+Tuesday with driver A leaves Thursday as the remaining requested day", () => {
    const requestedWeeklyDays = [requestDay(SUN), requestDay(TUE), requestDay(THU)];
    const chosenDates = new Set([SUN, TUE]);

    const remainingDays = requestedWeeklyDays.filter((day) => !chosenDates.has(day.date));

    expect(remainingDays.map((d) => d.date)).toEqual([THU]);
  });

  it("driver B's Thursday-only group still matches the remaining request after driver A's days are booked", () => {
    const driverBGroup = "weeklygrp_driverB";
    const members = [weeklyDoc("routeB-thu", driverBGroup, THU)];
    const remainingRequest = [requestDay(THU)];

    const matches = matchWeeklyGroupDays(members, remainingRequest);
    expect(matches).toHaveLength(1);
    expect(matches[0].driverDay.routeId).toBe("routeB-thu");
  });
});

describe("TEST 4: already-booked dates are excluded", () => {
  it("a day already booked by this passenger (by routeId+date) is filtered out of the match list", () => {
    const groupId = "weeklygrp_driverA";
    const members = [
      weeklyDoc("routeA-sun", groupId, SUN),
      weeklyDoc("routeA-tue", groupId, TUE),
      weeklyDoc("routeA-thu", groupId, THU),
    ];
    const requested = [requestDay(SUN), requestDay(TUE), requestDay(THU)];

    const allMatches = matchWeeklyGroupDays(members, requested);
    const alreadyBooked = new Set([weeklyMatchKey("routeA-sun", SUN)]);

    const filtered = filterOutAlreadyBookedMatches(allMatches, alreadyBooked);

    expect(filtered.map((m) => m.requested.date).sort()).toEqual([THU, TUE].sort());
    expect(filtered.some((m) => m.requested.date === SUN)).toBe(false);
  });

  it("Select All (the filtered list) never re-includes an already-booked day, so no duplicate can be created", () => {
    const groupId = "weeklygrp_driverA";
    const members = [weeklyDoc("routeA-sun", groupId, SUN), weeklyDoc("routeA-tue", groupId, TUE)];
    const requested = [requestDay(SUN), requestDay(TUE)];

    const alreadyBooked = new Set([weeklyMatchKey("routeA-sun", SUN)]);
    const selectable = filterOutAlreadyBookedMatches(matchWeeklyGroupDays(members, requested), alreadyBooked);
    const selectAllDates = selectable.map((m) => m.requested.date);

    expect(selectAllDates).toEqual([TUE]);
  });
});

describe("TEST 5: full ride (0 remaining seats) is never selectable", () => {
  it("a day with no remaining seats is excluded from the match list entirely", () => {
    const groupId = "weeklygrp_driverA";
    const members = [
      weeklyDoc("routeA-sun", groupId, SUN, { seats: 2, remainingSeats: 2 }),
      weeklyDoc("routeA-tue", groupId, TUE, { seats: 2, remainingSeats: 0 }),
      weeklyDoc("routeA-thu", groupId, THU, { seats: 2, remainingSeats: 1 }),
    ];
    const requested = [requestDay(SUN), requestDay(TUE), requestDay(THU)];

    const matches = matchWeeklyGroupDays(members, requested);

    expect(matches.map((m) => m.requested.date).sort()).toEqual([SUN, THU].sort());
    expect(matches.some((m) => m.requested.date === TUE)).toBe(false);
  });
});

describe("Legacy/standalone documents (no weeklyGroupId) remain safe", () => {
  it("a document with no weeklyGroupId acts as its own group of one — identical to today's behavior", () => {
    const legacyDoc = { id: "legacy-route-1", tripDate: SUN, time: "15:00", price: 40, seats: 3 };
    const groups = groupDriversByWeeklySeries([legacyDoc]);

    expect(groups.size).toBe(1);
    expect(groups.get("legacy-route-1")).toEqual([legacyDoc]);
  });

  it("two unrelated legacy documents (no weeklyGroupId) never get merged into the same group", () => {
    const docA = { id: "legacy-a", tripDate: SUN, time: "15:00", price: 40, seats: 3 };
    const docB = { id: "legacy-b", tripDate: TUE, time: "15:00", price: 40, seats: 3 };

    const groups = groupDriversByWeeklySeries([docA, docB]);

    expect(groups.size).toBe(2);
    expect(groups.get("legacy-a")).toEqual([docA]);
    expect(groups.get("legacy-b")).toEqual([docB]);
  });

  it("a School-style single document already holding its full weeklyTrips array matches unchanged", () => {
    // Weekly School creation writes ONE document with the full array (see
    // RideForm.tsx's else branch) — never per-day documents/weeklyGroupId —
    // so grouping falls back to the document's own id (a singleton group)
    // and matchWeeklyGroupDays over that one member reproduces exactly what
    // matchDriverWeeklyDays already returned for it.
    const schoolDoc = {
      id: "school-route-1",
      category: "school",
      weeklyTrips: [
        { date: SUN, time: "07:30", price: 25, seats: 4, remainingSeats: 4 },
        { date: TUE, time: "07:30", price: 25, seats: 4, remainingSeats: 4 },
      ],
    };
    const requested = [requestDay(SUN, "day", "07:30"), requestDay(TUE, "day", "07:30")];

    const viaGroup = matchWeeklyGroupDays(groupDriversByWeeklySeries([schoolDoc]).get("school-route-1")!, requested);
    const viaDirect = matchDriverWeeklyDays(schoolDoc, requested);

    expect(viaGroup.map((m) => m.requested.date)).toEqual(viaDirect.map((m) => m.requested.date));
  });
});
