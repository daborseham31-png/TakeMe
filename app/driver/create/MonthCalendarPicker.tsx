// ---------------------------------------------------------------------------
// Full month calendar for the Personal Ride weekly flow — lets a driver
// navigate to any future month and multi-select any number of today-or-future
// dates. Past dates are always disabled/faded. Unlike the per-row native
// picker used elsewhere in WeeklyDaysCard (School, passenger booking), this
// is not restricted to a single Sunday-to-Saturday week — see
// validateWeeklyRowsAnyFutureDate in weeklyBookingLib.ts for the matching
// save-time check.
//
// Renders INLINE (directly in the surrounding form, not a popup/bottom-sheet)
// — the caller controls whether it's mounted at all. Tapping a date toggles
// it immediately via onToggleDate; there is no separate confirm step, so
// several dates can be picked one after another without the calendar
// closing.
//
// The grid itself (weekday headers, day numbers, month label) stays fixed
// left-to-right regardless of app language — the same convention already
// used for every other date/time value in this app (see DateInput's
// `DirectionalTextInput ltr` and TimeInput's `ltrText`).
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useLanguage } from "../../i18n/LanguageProvider";
import { getLocalNowInIsrael } from "../../booking/weeklyBookingLib";
import { formatDateToYMD } from "./driverHelpers";

const MONTH_LOCALE: Record<string, string> = {
  ar: "ar",
  en: "en-US",
  he: "he-IL",
  ru: "ru-RU",
};

// Locale-correct SHORT weekday labels (e.g. "Sun", "Mon" in English), not the
// full day names from booking.days.* (those wrap onto two lines inside this
// grid's narrow 1/7-width columns — see the bug this replaces). 2023-01-01 is
// a known Sunday, used purely to walk Sun..Sat in order regardless of locale.
const getWeekdayLabels = (locale: string): string[] =>
  Array.from({ length: 7 }, (_, i) => {
    const d = new Date(2023, 0, 1 + i);
    try {
      return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(d);
    } catch {
      return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][i];
    }
  });

type DayCell = { ymd: string; day: number; inMonth: boolean };

type Props = {
  selectedDates: string[];
  onToggleDate: (date: string) => void;
};

export default function MonthCalendarPicker({ selectedDates, onToggleDate }: Props) {
  const { language } = useLanguage();

  const weekdayLabels = useMemo(
    () => getWeekdayLabels(MONTH_LOCALE[language] || "en-US"),
    [language],
  );

  // Israel-local "today" — matches validateWeeklyRowsAnyFutureDate, the
  // authoritative save-time check, so the calendar never allows a date that
  // would then be rejected on submit just because the device is in a
  // different timezone.
  const todayYMD = useMemo(() => formatDateToYMD(getLocalNowInIsrael()), []);
  const todayParts = useMemo(() => todayYMD.split("-").map(Number), [todayYMD]);
  const todayYear = todayParts[0];
  const todayMonthIndex = todayParts[1] - 1;

  const [viewYear, setViewYear] = useState(todayYear);
  const [viewMonth, setViewMonth] = useState(todayMonthIndex);

  const selectedSet = useMemo(() => new Set(selectedDates), [selectedDates]);

  const monthLabel = useMemo(() => {
    const date = new Date(viewYear, viewMonth, 1);

    try {
      return new Intl.DateTimeFormat(MONTH_LOCALE[language] || "en-US", {
        month: "long",
        year: "numeric",
        calendar: "gregory",
      }).format(date);
    } catch {
      return `${viewMonth + 1}/${viewYear}`;
    }
  }, [viewYear, viewMonth, language]);

  const isCurrentMonth = viewYear === todayYear && viewMonth === todayMonthIndex;

  const goPrevMonth = () => {
    if (isCurrentMonth) return;
    const prev = new Date(viewYear, viewMonth - 1, 1);
    setViewYear(prev.getFullYear());
    setViewMonth(prev.getMonth());
  };

  const goNextMonth = () => {
    const next = new Date(viewYear, viewMonth + 1, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };

  const weeks = useMemo(() => {
    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const startWeekday = firstOfMonth.getDay(); // 0 = Sunday
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    const cells: DayCell[] = [];

    // Leading cells from the previous month, purely for grid alignment —
    // always disabled regardless of date (never selectable).
    for (let i = 0; i < startWeekday; i++) {
      const d = new Date(viewYear, viewMonth, i - startWeekday + 1);
      cells.push({ ymd: formatDateToYMD(d), day: d.getDate(), inMonth: false });
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(viewYear, viewMonth, day);
      cells.push({ ymd: formatDateToYMD(d), day, inMonth: true });
    }

    // Trailing cells to complete the last week row.
    let trailingDay = 1;
    while (cells.length % 7 !== 0) {
      const d = new Date(viewYear, viewMonth + 1, trailingDay);
      cells.push({ ymd: formatDateToYMD(d), day: d.getDate(), inMonth: false });
      trailingDay += 1;
    }

    const rows: DayCell[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      rows.push(cells.slice(i, i + 7));
    }
    return rows;
  }, [viewYear, viewMonth]);

  const handlePress = (cell: DayCell) => {
    if (!cell.inMonth) return;
    if (cell.ymd < todayYMD) return;
    onToggleDate(cell.ymd);
  };

  return (
    <View style={styles.calendarBox}>
      <View style={styles.monthNavRow}>
        <Pressable
          onPress={goPrevMonth}
          disabled={isCurrentMonth}
          style={styles.navButton}
          hitSlop={8}
        >
          <Ionicons
            name="chevron-back"
            size={20}
            color={isCurrentMonth ? "#D8C9BC" : "#7C5F46"}
          />
        </Pressable>

        <Text style={styles.monthLabel}>{monthLabel}</Text>

        <Pressable onPress={goNextMonth} style={styles.navButton} hitSlop={8}>
          <Ionicons name="chevron-forward" size={20} color="#7C5F46" />
        </Pressable>
      </View>

      <View style={styles.weekdayRow}>
        {weekdayLabels.map((label, i) => (
          <Text key={i} style={styles.weekdayText} numberOfLines={1}>
            {label}
          </Text>
        ))}
      </View>

      {weeks.map((week, weekIndex) => (
        <View key={weekIndex} style={styles.weekRow}>
          {week.map((cell) => {
            const isPast = cell.ymd < todayYMD;
            const disabled = !cell.inMonth || isPast;
            const isSelected = cell.inMonth && selectedSet.has(cell.ymd);

            return (
              <Pressable
                key={cell.ymd}
                style={styles.dayCell}
                onPress={() => handlePress(cell)}
                disabled={disabled}
              >
                <View style={[styles.dayCircle, isSelected && styles.dayCircleSelected]}>
                  <Text
                    style={[
                      styles.dayText,
                      !cell.inMonth && styles.dayTextOutside,
                      cell.inMonth && isPast && styles.dayTextPast,
                      isSelected && styles.dayTextSelected,
                    ]}
                  >
                    {cell.day}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  calendarBox: {
    // Always LTR — the day grid, weekday headers, and month label read the
    // same left-to-right order in every app language, matching the app's
    // existing convention for dates/times (DateInput/TimeInput).
    direction: "ltr",
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    padding: 12,
    marginBottom: 12,
  },
  monthNavRow: {
    direction: "ltr",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  navButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  monthLabel: {
    fontSize: 16,
    fontWeight: "900",
    color: "#111827",
  },
  weekdayRow: {
    direction: "ltr",
    flexDirection: "row",
    marginBottom: 4,
  },
  weekdayText: {
    flex: 1,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "800",
    color: "#8B7B6B",
  },
  weekRow: {
    direction: "ltr",
    flexDirection: "row",
  },
  dayCell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dayCircle: {
    width: "78%",
    height: "78%",
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  dayCircleSelected: {
    backgroundColor: "#007AFF",
  },
  dayText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
  },
  dayTextOutside: {
    color: "transparent",
  },
  dayTextPast: {
    color: "#C9BCAF",
  },
  dayTextSelected: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
});
