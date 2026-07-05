import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import React, { useEffect, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  formatDateToYMD,
  formatTimeToHM,
  getDayFromDateText,
  normalizeDateToYMD,
  parseDateInput,
  parseTimeToDate,
  styles,
} from "./driverHelpers";

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  showPicker: boolean;
  setShowPicker: (value: boolean) => void;
};

export default function DateInput({
  label,
  value,
  onChange,
  showPicker,
  setShowPicker,
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
        <Text style={styles.autoDayText}>Day: {dayName}</Text>
      )}

      {showPicker && (
        <DateTimePicker
          value={pickerDate}
          mode="date"
          display="default"
          minimumDate={new Date()}
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

type TimeInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  showPicker: boolean;
  setShowPicker: (value: boolean) => void;
};

export function TimeInput({
  label,
  value,
  onChange,
  showPicker,
  setShowPicker,
}: TimeInputProps) {
  const [tempTime, setTempTime] = useState<Date>(parseTimeToDate(value));

  useEffect(() => {
    if (showPicker) {
      setTempTime(parseTimeToDate(value));
    }
  }, [showPicker, value]);

  const handleCancel = () => {
    setTempTime(parseTimeToDate(value));
    setShowPicker(false);
  };

  const handleSave = () => {
    onChange(formatTimeToHM(tempTime));
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
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.25)",
            justifyContent: "flex-end",
          }}
        >
          <Pressable
            style={{
              flex: 1,
            }}
            onPress={handleCancel}
          />

          <View
            style={{
              backgroundColor: "#FBF7F1",
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              paddingHorizontal: 20,
              paddingTop: 18,
              paddingBottom: 34,
            }}
          >
            <View
              style={{
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <View
                style={{
                  width: 46,
                  height: 5,
                  borderRadius: 20,
                  backgroundColor: "#D8C9BC",
                  marginBottom: 14,
                }}
              />

              <Text
                style={{
                  fontSize: 22,
                  fontWeight: "900",
                  color: "#111827",
                }}
              >
                {label}
              </Text>

              <Text
                style={{
                  color: "#7C5F46",
                  fontWeight: "700",
                  marginTop: 4,
                }}
              >
                Choose hour and minutes
              </Text>
            </View>

            <View
              style={{
                backgroundColor: "#FFFFFF",
                borderWidth: 1,
                borderColor: "#E7DCD1",
                borderRadius: 18,
                overflow: "hidden",
                marginBottom: 16,
              }}
            >
              <DateTimePicker
                value={tempTime}
                mode="time"
                is24Hour
                display={Platform.OS === "ios" ? "spinner" : "default"}
                onChange={(event: any, selectedDate?: Date) => {
                  if (event?.type === "dismissed") {
                    handleCancel();
                    return;
                  }

                  if (selectedDate) {
                    setTempTime(selectedDate);
                  }
                }}
                style={{
                  width: "100%",
                  height: Platform.OS === "ios" ? 210 : 120,
                }}
              />
            </View>

            <View
              style={{
                flexDirection: "row",
                gap: 12,
              }}
            >
              <Pressable
                onPress={handleCancel}
                style={{
                  flex: 1,
                  borderWidth: 1,
                  borderColor: "#E2D8CF",
                  borderRadius: 14,
                  padding: 15,
                  alignItems: "center",
                  backgroundColor: "#FFFFFF",
                }}
              >
                <Text
                  style={{
                    fontWeight: "900",
                    color: "#7C5F46",
                    fontSize: 16,
                  }}
                >
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                onPress={handleSave}
                style={{
                  flex: 1,
                  borderRadius: 14,
                  padding: 15,
                  alignItems: "center",
                  backgroundColor: "#F58220",
                }}
              >
                <Text
                  style={{
                    fontWeight: "900",
                    color: "#FFFFFF",
                    fontSize: 16,
                  }}
                >
                  Save
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
