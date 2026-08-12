import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "../../../components/PlatformDateTimePicker";
import React, { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import InfiniteTimeWheelPicker from "../../components/InfiniteTimeWheelPicker";
import {
  DirectionalCard,
  DirectionalRow,
  DirectionalText,
  DirectionalTextInput,
  PhysicalDirectionalBlockText,
} from "../../i18n/DirectionalPrimitives";
import {
  formatDateToYMD,
  getDayFromDateText,
  getTodayYMD,
  normalizeDateToYMD,
  normalizeTime,
  parseDateInput,
  styles,
} from "./driverHelpers";

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  showPicker: boolean;
  setShowPicker: (value: boolean) => void;
  maximumDate?: Date;
  // Defaults to "now" (today), same as before this prop existed — pass an
  // explicit value only when the caller needs a tighter lower bound (e.g.
  // weekly booking locking the picker to the currently open week).
  minimumDate?: Date;
};

export default function DateInput({
  label,
  value,
  onChange,
  showPicker,
  setShowPicker,
  maximumDate,
  minimumDate,
}: Props) {
  const { t } = useTranslation();
  const cleanDate = normalizeDateToYMD(value);
  const dayName = getDayFromDateText(value);
  const pickerDate = cleanDate
    ? parseDateInput(cleanDate) || new Date()
    : new Date();

  // parseDateInput always returns local midnight (00:00:00) for `value` —
  // but a bare `new Date()` default here carries the CURRENT time-of-day.
  // When today is selected, comparing pickerDate (00:00:00) against a
  // minimumDate of "right now" (e.g. 14:32) reads as "before the minimum"
  // even though it's the same calendar day, and some native date-picker
  // implementations respond by silently rolling the shown/selected day
  // forward to tomorrow. Zeroing the default minimumDate's time-of-day too
  // keeps both values anchored to the same local midnight so today is never
  // pushed to tomorrow just because it's already afternoon.
  const defaultMinimumDate = new Date();
  defaultMinimumDate.setHours(0, 0, 0, 0);

  return (
    <>
      <PhysicalDirectionalBlockText style={styles.label}>{label}</PhysicalDirectionalBlockText>

      <DirectionalRow style={styles.inputRow}>
        <Pressable
          style={styles.calendarButton}
          onPress={() => setShowPicker(true)}
        >
          <Ionicons name="calendar-outline" size={24} color="#8B7B6B" />
        </Pressable>

        <DirectionalTextInput
          ltr
          style={styles.rowInput}
          placeholder={`${t("common.select")} ${label}`}
          placeholderTextColor="#8B7B6B"
          keyboardType="numbers-and-punctuation"
          maxLength={10}
          value={value}
          onChangeText={onChange}
        />
      </DirectionalRow>

      {cleanDate && dayName && (
        <PhysicalDirectionalBlockText style={styles.autoDayText}>
          {t("booking.day")}: {t(`booking.days.${dayName}`, { defaultValue: dayName })}
        </PhysicalDirectionalBlockText>
      )}

      {showPicker && (
        <DateTimePicker
          value={pickerDate}
          mode="date"
          display="default"
          minimumDate={minimumDate || defaultMinimumDate}
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
// TimeInput – the app's shared time field: a pressable row that opens a
// Confirm/Cancel modal wrapping InfiniteTimeWheelPicker (see
// app/components/InfiniteTimeWheelPicker.tsx for the actual continuous
// hour/minute wheel — this file owns only the field/modal chrome and this
// screen-shared "today only, no past times" restriction).
// ---------------------------------------------------------------------------

const pad2 = (value: number) => String(value).padStart(2, "0");

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
  // Matches the app's existing default when omitted.
  minuteInterval?: number;
};

export function TimeInput({
  label,
  value,
  onChange,
  showPicker,
  setShowPicker,
  associatedDate,
  minuteInterval = 5,
}: TimeInputProps) {
  const { t } = useTranslation();
  const isToday = associatedDate
    ? normalizeDateToYMD(associatedDate) === getTodayYMD()
    : false;

  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  const isHourDisabled = (hour: number) => {
    if (!isToday) return false;
    return hour < currentHour;
  };

  const isMinuteDisabled = (hour: number, minute: number) => {
    if (!isToday) return false;
    if (hour !== currentHour) return false;
    return minute < currentMinute;
  };

  // Rule 8 (this component's own contract, see InfiniteTimeWheelPicker's
  // header comment): the wheel itself never stops looping just because
  // today's past hours/minutes are disabled here — only taps/settling on
  // those specific rows are blocked, for this field only.
  const [draftValue, setDraftValue] = useState(value);

  useEffect(() => {
    if (!showPicker) return;

    // Rule 2: center on the current value, or (nothing selected yet) on the
    // device's current time rounded to the configured interval.
    if (normalizeTime(value)) {
      setDraftValue(normalizeTime(value)!);
      return;
    }

    const step = Math.max(1, Math.min(30, Math.round(minuteInterval)));
    const roundedMinute = Math.round(currentMinute / step) * step;
    const rollOverHour = roundedMinute >= 60 ? 1 : 0;

    setDraftValue(`${pad2((currentHour + rollOverHour) % 24)}:${pad2(roundedMinute % 60)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPicker]);

  const handleCancel = () => {
    // Rule 4: Cancel keeps the previous value — the draft is simply
    // discarded (never committed via the external onChange).
    setShowPicker(false);
  };

  const handleSave = () => {
    onChange(draftValue);
    setShowPicker(false);
  };

  return (
    <>
      <PhysicalDirectionalBlockText style={styles.label}>{label}</PhysicalDirectionalBlockText>

      <Pressable style={{ width: "100%" }} onPress={() => setShowPicker(true)}>
        <DirectionalRow style={styles.inputRow}>
          <Ionicons name="time-outline" size={18} color="#8B7B6B" />

          <Text
            style={[styles.rowInput, styles.ltrText, !value && { color: "#8B7B6B" }]}
            numberOfLines={1}
          >
            {value || `${t("common.select")} ${label}`}
          </Text>
        </DirectionalRow>
      </Pressable>

      <Modal
        visible={showPicker}
        transparent
        animationType="slide"
        onRequestClose={handleCancel}
      >
        <View style={timeStyles.overlay}>
          <Pressable style={timeStyles.backdrop} onPress={handleCancel} />

          <DirectionalCard style={timeStyles.sheet}>
            <View style={timeStyles.headerBox}>
              <View style={timeStyles.handle} />
              <Text style={timeStyles.title}>{label}</Text>
              <Text style={timeStyles.subtitle}>
                {t("booking.chooseHourAndMinutes")}
              </Text>
            </View>

            <InfiniteTimeWheelPicker
              value={draftValue}
              onChange={setDraftValue}
              minuteInterval={minuteInterval}
              isHourDisabled={isHourDisabled}
              isMinuteDisabled={isMinuteDisabled}
            />

            <DirectionalRow style={timeStyles.buttonsRow}>
              <Pressable onPress={handleCancel} style={timeStyles.cancelButton}>
                <DirectionalText style={timeStyles.cancelButtonText}>
                  {t("common.cancel")}
                </DirectionalText>
              </Pressable>

              <Pressable onPress={handleSave} style={timeStyles.saveButton}>
                <DirectionalText style={timeStyles.saveButtonText}>
                  {t("common.save")}
                </DirectionalText>
              </Pressable>
            </DirectionalRow>
          </DirectionalCard>
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
  buttonsRow: {
    marginTop: 16,
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
