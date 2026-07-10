import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import React, { useEffect, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  formatDateToYMD,
  getDayFromDateText,
  getTodayYMD,
  normalizeDateToYMD,
  normalizeTime,
  parseDateInput,
  styles,
} from "./driverHelpers";

const DAY_FULL_NAME: Record<string, string> = {
  Sun: "Sunday",
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
};

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  showPicker: boolean;
  setShowPicker: (value: boolean) => void;
  maximumDate?: Date;
};

export default function DateInput({
  label,
  value,
  onChange,
  showPicker,
  setShowPicker,
  maximumDate,
}: Props) {
  const cleanDate = normalizeDateToYMD(value);
  const dayName = getDayFromDateText(value);
  const pickerDate = cleanDate
    ? parseDateInput(cleanDate) || new Date()
    : new Date();

  return (
    <>
      <Text style={styles.label}>{label}</Text>

      <View style={styles.inputRow}>
        <Pressable
          style={styles.calendarButton}
          onPress={() => setShowPicker(true)}
        >
          <Ionicons name="calendar-outline" size={24} color="#8B7B6B" />
        </Pressable>

        <TextInput
          style={styles.rowInput}
          placeholder="2026-07-04 or 04/07/2026"
          placeholderTextColor="#8B7B6B"
          keyboardType="numbers-and-punctuation"
          maxLength={10}
          value={value}
          onChangeText={onChange}
        />
      </View>

      {cleanDate && dayName && (
        <Text style={styles.autoDayText}>
          Day: {DAY_FULL_NAME[dayName] || dayName}
        </Text>
      )}

      {showPicker && (
        <DateTimePicker
          value={pickerDate}
          mode="date"
          display="default"
          minimumDate={new Date()}
          maximumDate={maximumDate}
          onChange={(_event: any, selectedDate?: Date) => {
            setShowPicker(false);

            if (selectedDate) {
              onChange(formatDateToYMD(selectedDate));
            }
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// TimeInput – a fully custom hour/minute grid picker.
//
// The native @react-native-community/datetimepicker "time" mode is
// unreliable when embedded (controlled) inside a custom Modal on Android —
// it can appear to get stuck on a single hour because the OS dialog re-opens
// imperatively on every controlled re-render. Building the picker out of
// plain scrollable button lists sidesteps that entirely and behaves
// identically on iOS, Android, and Expo Go.
// ---------------------------------------------------------------------------

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const ROW_HEIGHT = 46;
const VISIBLE_ROWS = 5;

const pad2 = (value: number) => String(value).padStart(2, "0");

const nearestMinuteStep = (minute: number) =>
  MINUTES.reduce((closest, step) =>
    Math.abs(step - minute) < Math.abs(closest - minute) ? step : closest,
  );

type TimeInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  showPicker: boolean;
  setShowPicker: (value: boolean) => void;
  // Optional YYYY-MM-DD this time belongs to. When it resolves to today,
  // hours/minutes already in the past are disabled. Any other date (or no
  // date at all) allows every hour/minute — the time is never locked.
  associatedDate?: string;
};

export function TimeInput({
  label,
  value,
  onChange,
  showPicker,
  setShowPicker,
  associatedDate,
}: TimeInputProps) {
  const isToday = associatedDate
    ? normalizeDateToYMD(associatedDate) === getTodayYMD()
    : false;

  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  const hasValidMinuteForHour = (hour: number) => {
    if (!isToday) return true;
    if (hour > currentHour) return true;
    if (hour < currentHour) return false;
    return MINUTES.some((minute) => minute >= currentMinute);
  };

  const isHourDisabled = (hour: number) => !hasValidMinuteForHour(hour);

  const isMinuteDisabled = (hour: number, minute: number) => {
    if (!isToday) return false;
    if (hour !== currentHour) return false;
    return minute < currentMinute;
  };

  const findInitialSelection = (): [number, number] => {
    const parsed = normalizeTime(value);
    let hour = parsed ? Number(parsed.split(":")[0]) : isToday ? currentHour : 0;
    let minute = parsed
      ? nearestMinuteStep(Number(parsed.split(":")[1]))
      : isToday
        ? nearestMinuteStep(currentMinute)
        : 0;

    if (isToday) {
      while (hour < 24 && !hasValidMinuteForHour(hour)) {
        hour += 1;
      }

      if (hour > 23) hour = 23;

      if (hour === currentHour) {
        const validMinutes = MINUTES.filter((m) => m >= currentMinute);
        if (!validMinutes.includes(minute)) {
          minute = validMinutes[0] ?? MINUTES[MINUTES.length - 1];
        }
      }
    }

    return [hour, minute];
  };

  const [selectedHour, setSelectedHour] = useState(0);
  const [selectedMinute, setSelectedMinute] = useState(0);

  const hourScrollRef = useRef<ScrollView>(null);
  const minuteScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!showPicker) return;

    const [hour, minute] = findInitialSelection();

    setSelectedHour(hour);
    setSelectedMinute(minute);

    requestAnimationFrame(() => {
      hourScrollRef.current?.scrollTo({
        y: hour * ROW_HEIGHT,
        animated: false,
      });
      minuteScrollRef.current?.scrollTo({
        y: MINUTES.indexOf(minute) * ROW_HEIGHT,
        animated: false,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPicker, value, associatedDate]);

  const clampIndex = (index: number, length: number) =>
    Math.max(0, Math.min(length - 1, index));

  const findFirstEnabledHourFrom = (startIndex: number) => {
    let index = HOURS.findIndex(
      (hour, i) => i >= startIndex && !isHourDisabled(hour),
    );
    if (index === -1) index = HOURS.findIndex((hour) => !isHourDisabled(hour));
    return index;
  };

  const findFirstEnabledMinuteFrom = (hour: number, startIndex: number) => {
    let index = MINUTES.findIndex(
      (minute, i) => i >= startIndex && !isMinuteDisabled(hour, minute),
    );
    if (index === -1) {
      index = MINUTES.findIndex((minute) => !isMinuteDisabled(hour, minute));
    }
    return index;
  };

  // The centered hour becomes selectedHour as soon as the wheel settles — no
  // tap required. If it settles on a disabled hour it snaps forward to the
  // nearest selectable one, and clamps the minute wheel to match.
  const applyHourSelection = (index: number) => {
    const hour = HOURS[index];
    setSelectedHour(hour);

    if (isMinuteDisabled(hour, selectedMinute)) {
      const minuteIndex = findFirstEnabledMinuteFrom(hour, 0);

      if (minuteIndex !== -1) {
        setSelectedMinute(MINUTES[minuteIndex]);
        minuteScrollRef.current?.scrollTo({
          y: minuteIndex * ROW_HEIGHT,
          animated: true,
        });
      }
    }
  };

  const applyMinuteSelection = (index: number) => {
    setSelectedMinute(MINUTES[index]);
  };

  const handleHourScrollEnd = (event: any) => {
    const rawIndex = clampIndex(
      Math.round(event.nativeEvent.contentOffset.y / ROW_HEIGHT),
      HOURS.length,
    );

    const index = isHourDisabled(HOURS[rawIndex])
      ? findFirstEnabledHourFrom(rawIndex)
      : rawIndex;

    if (index === -1) return;

    if (index !== rawIndex) {
      hourScrollRef.current?.scrollTo({
        y: index * ROW_HEIGHT,
        animated: true,
      });
    }

    applyHourSelection(index);
  };

  const handleMinuteScrollEnd = (event: any) => {
    const rawIndex = clampIndex(
      Math.round(event.nativeEvent.contentOffset.y / ROW_HEIGHT),
      MINUTES.length,
    );

    const index = isMinuteDisabled(selectedHour, MINUTES[rawIndex])
      ? findFirstEnabledMinuteFrom(selectedHour, rawIndex)
      : rawIndex;

    if (index === -1) return;

    if (index !== rawIndex) {
      minuteScrollRef.current?.scrollTo({
        y: index * ROW_HEIGHT,
        animated: true,
      });
    }

    applyMinuteSelection(index);
  };

  // Tapping a cell is still supported as a shortcut, but it isn't required —
  // scrolling a value to the center is enough.
  const handleSelectHour = (hour: number) => {
    if (isHourDisabled(hour)) return;

    const index = HOURS.indexOf(hour);
    applyHourSelection(index);
    hourScrollRef.current?.scrollTo({ y: index * ROW_HEIGHT, animated: true });
  };

  const handleSelectMinute = (minute: number) => {
    if (isMinuteDisabled(selectedHour, minute)) return;

    const index = MINUTES.indexOf(minute);
    applyMinuteSelection(index);
    minuteScrollRef.current?.scrollTo({
      y: index * ROW_HEIGHT,
      animated: true,
    });
  };

  const handleCancel = () => {
    setShowPicker(false);
  };

  const handleSave = () => {
    onChange(`${pad2(selectedHour)}:${pad2(selectedMinute)}`);
    setShowPicker(false);
  };

  return (
    <>
      <Text style={styles.label}>{label}</Text>

      <Pressable style={styles.inputRow} onPress={() => setShowPicker(true)}>
        <Ionicons name="time-outline" size={18} color="#8B7B6B" />

        <Text style={[styles.rowInput, !value && { color: "#8B7B6B" }]}>
          {value || "Select time"}
        </Text>
      </Pressable>

      <Modal
        visible={showPicker}
        transparent
        animationType="slide"
        onRequestClose={handleCancel}
      >
        <View style={timeStyles.overlay}>
          <Pressable style={timeStyles.backdrop} onPress={handleCancel} />

          <View style={timeStyles.sheet}>
            <View style={timeStyles.headerBox}>
              <View style={timeStyles.handle} />
              <Text style={timeStyles.title}>{label}</Text>
              <Text style={timeStyles.subtitle}>Choose hour and minutes</Text>
            </View>

            <View style={timeStyles.pickerBox}>
              <View style={timeStyles.columnsRow}>
                <ScrollView
                  ref={hourScrollRef}
                  style={timeStyles.column}
                  contentContainerStyle={timeStyles.columnContent}
                  showsVerticalScrollIndicator={false}
                  snapToInterval={ROW_HEIGHT}
                  decelerationRate="fast"
                  onMomentumScrollEnd={handleHourScrollEnd}
                  onScrollEndDrag={handleHourScrollEnd}
                >
                  {HOURS.map((hour) => {
                    const disabled = isHourDisabled(hour);
                    const selected = hour === selectedHour;

                    return (
                      <Pressable
                        key={hour}
                        disabled={disabled}
                        onPress={() => handleSelectHour(hour)}
                        style={[
                          timeStyles.cell,
                          selected && timeStyles.cellSelected,
                        ]}
                      >
                        <Text
                          style={[
                            timeStyles.cellText,
                            selected && timeStyles.cellTextSelected,
                            disabled && timeStyles.cellTextDisabled,
                          ]}
                        >
                          {pad2(hour)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                <Text style={timeStyles.colon}>:</Text>

                <ScrollView
                  ref={minuteScrollRef}
                  style={timeStyles.column}
                  contentContainerStyle={timeStyles.columnContent}
                  showsVerticalScrollIndicator={false}
                  snapToInterval={ROW_HEIGHT}
                  decelerationRate="fast"
                  onMomentumScrollEnd={handleMinuteScrollEnd}
                  onScrollEndDrag={handleMinuteScrollEnd}
                >
                  {MINUTES.map((minute) => {
                    const disabled = isMinuteDisabled(selectedHour, minute);
                    const selected = minute === selectedMinute;

                    return (
                      <Pressable
                        key={minute}
                        disabled={disabled}
                        onPress={() => handleSelectMinute(minute)}
                        style={[
                          timeStyles.cell,
                          selected && timeStyles.cellSelected,
                        ]}
                      >
                        <Text
                          style={[
                            timeStyles.cellText,
                            selected && timeStyles.cellTextSelected,
                            disabled && timeStyles.cellTextDisabled,
                          ]}
                        >
                          {pad2(minute)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              <View pointerEvents="none" style={timeStyles.selectionHighlight} />
            </View>

            <View style={timeStyles.buttonsRow}>
              <Pressable onPress={handleCancel} style={timeStyles.cancelButton}>
                <Text style={timeStyles.cancelButtonText}>Cancel</Text>
              </Pressable>

              <Pressable onPress={handleSave} style={timeStyles.saveButton}>
                <Text style={timeStyles.saveButtonText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const timeStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.25)",
    justifyContent: "flex-end",
  },
  backdrop: {
    flex: 1,
  },
  sheet: {
    backgroundColor: "#FBF7F1",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 34,
  },
  headerBox: {
    alignItems: "center",
    marginBottom: 12,
  },
  handle: {
    width: 46,
    height: 5,
    borderRadius: 20,
    backgroundColor: "#D8C9BC",
    marginBottom: 14,
  },
  title: {
    fontSize: 22,
    fontWeight: "900",
    color: "#111827",
  },
  subtitle: {
    color: "#7C5F46",
    fontWeight: "700",
    marginTop: 4,
  },
  pickerBox: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 18,
    marginBottom: 16,
    position: "relative",
  },
  columnsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  column: {
    height: ROW_HEIGHT * VISIBLE_ROWS,
    width: 90,
  },
  // Pads the scrollable content itself (not the row around it) so the
  // first and last cell can each be scrolled all the way to the centered
  // selection slot.
  columnContent: {
    paddingVertical: (ROW_HEIGHT * (VISIBLE_ROWS - 1)) / 2,
  },
  colon: {
    fontSize: 24,
    fontWeight: "900",
    color: "#111827",
    marginHorizontal: 6,
  },
  cell: {
    height: ROW_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  cellSelected: {
    backgroundColor: "#FFF2E8",
    borderRadius: 12,
  },
  cellText: {
    fontSize: 20,
    fontWeight: "800",
    color: "#111827",
  },
  cellTextSelected: {
    color: "#F58220",
    fontWeight: "900",
  },
  cellTextDisabled: {
    color: "#D9CFC5",
  },
  selectionHighlight: {
    position: "absolute",
    left: 12,
    right: 12,
    top: (ROW_HEIGHT * VISIBLE_ROWS) / 2 - ROW_HEIGHT / 2,
    height: ROW_HEIGHT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#F1CBA5",
  },
  buttonsRow: {
    flexDirection: "row",
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 14,
    padding: 15,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  cancelButtonText: {
    fontWeight: "900",
    color: "#7C5F46",
    fontSize: 16,
  },
  saveButton: {
    flex: 1,
    borderRadius: 14,
    padding: 15,
    alignItems: "center",
    backgroundColor: "#F58220",
  },
  saveButtonText: {
    fontWeight: "900",
    color: "#FFFFFF",
    fontSize: 16,
  },
});
