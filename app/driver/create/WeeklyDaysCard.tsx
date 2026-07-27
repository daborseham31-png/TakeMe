import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { translateStoredDayName } from "../../i18n/formatters";
import {
  DAY_KEY_LABEL,
  getAllowedWeeklyDateRange,
  getDayKeyFromDate,
  getLocalNowInIsrael,
  isDateInAllowedWeek,
  isNextWeekOpen,
  makeEmptyWeekDayRow,
  WeekChoice,
  WeekDayRow,
} from "../../booking/weeklyBookingLib";
import DateInput, { TimeInput } from "./DateInput";
import { getDigitsOnly, styles as sharedStyles } from "./driverHelpers";

type Props = {
  rows: WeekDayRow[];
  onChange: (rows: WeekDayRow[]) => void;
  defaultTime: string;
  mode: "passenger" | "driver";
  // Overrides the default per-mode title ("Weekly Trip Days" for driver,
  // "Choose Days" for passenger) — e.g. the School weekly search screen
  // wants "Weekly Trip Days" on the passenger side too, without changing
  // the title any OTHER existing caller (Personal Ride weekly, driver
  // route creation) already relies on.
  title?: string;
};

const parseYMDToEndOfDay = (ymd: string) => {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(year, month - 1, day, 23, 59, 59);
};

const parseYMDToStartOfDay = (ymd: string) => {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(year, month - 1, day, 0, 0, 0);
};

export default function WeeklyDaysCard({
  rows,
  onChange,
  defaultTime,
  mode,
  title,
}: Props) {
  const { t } = useTranslation();
  const [openDatePickerId, setOpenDatePickerId] = useState<string | null>(null);
  const [openTimePickerId, setOpenTimePickerId] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<WeekChoice>("current");

  const nextWeekOpen = isNextWeekOpen();

  // The next-week window only lasts through Saturday — if it closes again
  // while "next" is still selected (e.g. this screen was left open across
  // midnight), fall back to "current" instead of silently showing a locked
  // week's dates.
  useEffect(() => {
    if (!nextWeekOpen && selectedWeek === "next") {
      setSelectedWeek("current");
      onChange([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextWeekOpen]);

  const { startYMD, endYMD } = getAllowedWeeklyDateRange(selectedWeek);
  const todayYMD = (() => {
    const now = getLocalNowInIsrael();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  })();
  const effectiveStartYMD = startYMD > todayYMD ? startYMD : todayYMD;
  const minimumDate = parseYMDToStartOfDay(effectiveStartYMD);
  const maximumDate = parseYMDToEndOfDay(endYMD);

  const updateRow = (id: string, patch: Partial<WeekDayRow>) => {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const removeRow = (id: string) => {
    onChange(rows.filter((row) => row.id !== id));

    if (openDatePickerId === id) setOpenDatePickerId(null);
    if (openTimePickerId === id) setOpenTimePickerId(null);
  };

  const addRow = () => {
    if (rows.length >= 7) return;
    onChange([...rows, makeEmptyWeekDayRow(defaultTime)]);
  };

  const switchWeek = (week: WeekChoice) => {
    if (week === selectedWeek) return;

    // Dates picked for one week don't carry over to the other — clearing
    // avoids silently leaving a now-out-of-range date in the list.
    setSelectedWeek(week);
    onChange([]);
  };

  const handleDateChange = (id: string, value: string) => {
    const duplicate = rows.some(
      (row) => row.id !== id && row.date && row.date === value,
    );

    if (duplicate) {
      Alert.alert(
        t("rides.alreadyAddedTitle"),
        t("rides.alreadyAddedMessage"),
      );
      return;
    }

    if (value && !isDateInAllowedWeek(value, selectedWeek)) {
      Alert.alert(
        t("rides.bookingUnavailableTitle"),
        t("rides.bookingUnavailableMessage"),
      );
      return;
    }

    updateRow(id, { date: value });
  };

  const decreaseSeats = (id: string, current: number) =>
    updateRow(id, { seats: Math.max(1, current - 1) });

  const increaseSeats = (id: string, current: number) =>
    updateRow(id, { seats: Math.min(8, current + 1) });

  return (
    <View style={styles.container}>
      <Text style={sharedStyles.label}>
        {title ?? (mode === "driver" ? t("rides.weeklyTripDays") : t("rides.chooseDaysLabel"))}
      </Text>
      <Text style={styles.hint}>{t("rides.weeklyHintRange")}</Text>
      <Text style={styles.hint}>
        {nextWeekOpen
          ? t("rides.nextWeekAvailable")
          : t("rides.nextWeekOpensSaturday")}
      </Text>

      {nextWeekOpen ? (
        <View style={styles.weekToggleRow}>
          <Pressable
            style={[
              styles.weekToggleButton,
              selectedWeek === "current" && styles.weekToggleButtonActive,
            ]}
            onPress={() => switchWeek("current")}
          >
            <Text
              style={[
                styles.weekToggleText,
                selectedWeek === "current" && styles.weekToggleTextActive,
              ]}
            >
              {t("rides.thisWeek")}
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.weekToggleButton,
              selectedWeek === "next" && styles.weekToggleButtonActive,
            ]}
            onPress={() => switchWeek("next")}
          >
            <Text
              style={[
                styles.weekToggleText,
                selectedWeek === "next" && styles.weekToggleTextActive,
              ]}
            >
              {t("rides.nextWeek")}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {rows.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="calendar-outline" size={22} color="#8B7B6B" />
          <Text style={styles.emptyText}>
            {mode === "driver"
              ? t("rides.addDaysHintDriver")
              : t("rides.addDaysHintPassenger")}
          </Text>
        </View>
      ) : null}

      {rows.map((row, index) => {
        const dayKey = row.date ? getDayKeyFromDate(row.date) : "";
        const dayLabel = dayKey
          ? translateStoredDayName(DAY_KEY_LABEL[dayKey], t)
          : "";

        return (
          <View key={row.id} style={styles.rowCard}>
            <View style={styles.rowHeader}>
              <Text style={styles.rowTitle}>
                {t("rides.dayNumber", { number: index + 1 })}
                {dayLabel ? ` — ${dayLabel}` : ""}
              </Text>

              <Pressable
                onPress={() => removeRow(row.id)}
                hitSlop={8}
                style={styles.removeButton}
              >
                <Ionicons name="trash-outline" size={18} color="#B91C1C" />
              </Pressable>
            </View>

            <DateInput
              label={t("booking.date")}
              value={row.date}
              onChange={(value) => handleDateChange(row.id, value)}
              showPicker={openDatePickerId === row.id}
              setShowPicker={(value) =>
                setOpenDatePickerId(value ? row.id : null)
              }
              minimumDate={minimumDate}
              maximumDate={maximumDate}
            />

            <View style={sharedStyles.twoColumns}>
              <View style={sharedStyles.column}>
                <TimeInput
                  label={t("booking.time")}
                  value={row.time}
                  onChange={(value) => updateRow(row.id, { time: value })}
                  showPicker={openTimePickerId === row.id}
                  setShowPicker={(value) =>
                    setOpenTimePickerId(value ? row.id : null)
                  }
                  associatedDate={row.date}
                />
              </View>

              <View style={sharedStyles.column}>
                <Text style={sharedStyles.label}>{t("booking.seats")}</Text>

                <View style={sharedStyles.weeklySeatsRow}>
                  <Pressable
                    style={sharedStyles.weeklySeatButton}
                    onPress={() => decreaseSeats(row.id, row.seats)}
                  >
                    <Ionicons name="remove" size={20} color="#111827" />
                  </Pressable>

                  <Text style={sharedStyles.weeklySeatsNumber}>
                    {row.seats}
                  </Text>

                  <Pressable
                    style={sharedStyles.weeklySeatButton}
                    onPress={() => increaseSeats(row.id, row.seats)}
                  >
                    <Ionicons name="add" size={20} color="#111827" />
                  </Pressable>
                </View>
              </View>
            </View>

            {mode === "driver" ? (
              <>
                <Text style={sharedStyles.label}>{t("booking.price")}</Text>
                <View style={sharedStyles.inputRow}>
                  <Ionicons name="cash-outline" size={18} color="#8B7B6B" />
                  <TextInput
                    style={sharedStyles.rowInput}
                    placeholder={t("booking.enterPrice")}
                    placeholderTextColor="#8B7B6B"
                    keyboardType="numeric"
                    value={row.price}
                    onChangeText={(text) =>
                      updateRow(row.id, { price: getDigitsOnly(text) })
                    }
                  />
                </View>
              </>
            ) : null}
          </View>
        );
      })}

      <Pressable
        style={[styles.addButton, rows.length >= 7 && styles.addButtonDisabled]}
        onPress={addRow}
        disabled={rows.length >= 7}
      >
        <Ionicons name="add-circle-outline" size={18} color="#F58220" />
        <Text style={styles.addButtonText}>{t("rides.addAnotherDay")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 6,
  },
  hint: {
    fontSize: 12,
    color: "#7C5F46",
    marginTop: -4,
    marginBottom: 6,
  },
  weekToggleRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
    marginBottom: 12,
  },
  weekToggleButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  weekToggleButtonActive: {
    backgroundColor: "#F58220",
    borderColor: "#F58220",
  },
  weekToggleText: {
    color: "#7C5F46",
    fontWeight: "800",
    fontSize: 13,
  },
  weekToggleTextActive: {
    color: "#FFFFFF",
  },
  emptyBox: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderStyle: "dashed",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFFDFC",
    marginBottom: 10,
  },
  emptyText: {
    color: "#7C5F46",
    fontWeight: "700",
    textAlign: "center",
    fontSize: 13,
  },
  rowCard: {
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    backgroundColor: "#FFFDFC",
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: "#111827",
  },
  removeButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FEE2E2",
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#F58220",
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 2,
  },
  addButtonDisabled: {
    opacity: 0.5,
  },
  addButtonText: {
    color: "#F58220",
    fontWeight: "900",
    fontSize: 14,
  },
});
