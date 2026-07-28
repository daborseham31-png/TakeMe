// ---------------------------------------------------------------------------
// Shared "Republish Trip" confirmation dialog — the ONE modal both the
// driver "trip"/ride cards (app/(tabs)/bookings.tsx) and the one-time
// School trip card (app/booking/school/useMySchoolRows.tsx) render, so the
// two can never visually drift apart again. A centered dialog (NOT a
// bottom sheet): dimmed overlay, rounded card centered both horizontally
// and vertically, capped width/height so it stays a compact dialog on
// every screen size, with its own ScrollView so content never gets clipped
// on a short device instead of growing into a tall bottom sheet.
//
// This component is purely presentational — it owns no Firestore/
// validation logic at all. Each caller keeps its own state, its own
// category-specific submit handler, and its own translated strings; this
// file only renders them consistently.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import KeyboardAvoidingWrapper from "../../components/KeyboardAvoidingWrapper";
import { DirectionalCard, PhysicalDirectionalBlockText } from "../../i18n/DirectionalPrimitives";
import DateInput, { TimeInput } from "./DateInput";

type Props = {
  visible: boolean;
  title: string;
  subtitle: string;
  // "Origin → Destination" (route categories) or a job title (Work/Errand).
  routeLabel: string;
  // Secondary line under the route — e.g. the school name. Omitted when
  // there's nothing more to show.
  subLabel?: string;

  dateLabel: string;
  date: string;
  onChangeDate: (value: string) => void;
  showDatePicker: boolean;
  setShowDatePicker: (value: boolean) => void;

  timeLabel: string;
  time: string;
  onChangeTime: (value: string) => void;
  showTimePicker: boolean;
  setShowTimePicker: (value: boolean) => void;

  priceLabel: string;
  price: string;
  onChangePrice: (value: string) => void;

  seatsLabel: string;
  seats: string;
  onChangeSeats: (value: string) => void;

  submitLabel: string;
  cancelLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
  submitting: boolean;
};

export default function RepublishTripModal({
  visible,
  title,
  subtitle,
  routeLabel,
  subLabel,
  dateLabel,
  date,
  onChangeDate,
  showDatePicker,
  setShowDatePicker,
  timeLabel,
  time,
  onChangeTime,
  showTimePicker,
  setShowTimePicker,
  priceLabel,
  price,
  onChangePrice,
  seatsLabel,
  seats,
  onChangeSeats,
  submitLabel,
  cancelLabel,
  onSubmit,
  onCancel,
  submitting,
}: Props) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <KeyboardAvoidingWrapper style={styles.overlay}>
        <DirectionalCard style={styles.sheet}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>

            <View style={styles.summary}>
              <PhysicalDirectionalBlockText style={styles.routeText}>
                {routeLabel}
              </PhysicalDirectionalBlockText>
              {subLabel ? (
                <PhysicalDirectionalBlockText style={styles.subLabelText}>
                  {subLabel}
                </PhysicalDirectionalBlockText>
              ) : null}
            </View>

            <DateInput
              label={dateLabel}
              value={date}
              onChange={onChangeDate}
              showPicker={showDatePicker}
              setShowPicker={setShowDatePicker}
            />

            <TimeInput
              label={timeLabel}
              value={time}
              onChange={onChangeTime}
              showPicker={showTimePicker}
              setShowPicker={setShowTimePicker}
            />

            <View style={styles.row}>
              <View style={styles.halfField}>
                <PhysicalDirectionalBlockText style={styles.fieldLabel}>
                  {priceLabel}
                </PhysicalDirectionalBlockText>
                <View style={styles.priceBox}>
                  <Ionicons name="cash-outline" size={16} color="#8B7B6B" />
                  <TextInput
                    style={styles.priceInput}
                    keyboardType="numeric"
                    value={price}
                    onChangeText={(text) => onChangePrice(text.replace(/[^0-9]/g, ""))}
                    placeholder="0"
                    placeholderTextColor="#8B7B6B"
                  />
                </View>
              </View>

              <View style={styles.halfField}>
                <PhysicalDirectionalBlockText style={styles.fieldLabel}>
                  {seatsLabel}
                </PhysicalDirectionalBlockText>
                <View style={styles.stepper}>
                  <Pressable
                    style={styles.stepperButton}
                    onPress={() => onChangeSeats(String(Math.max(1, (Number(seats) || 1) - 1)))}
                    hitSlop={6}
                  >
                    <Ionicons name="remove" size={16} color="#F58220" />
                  </Pressable>

                  <Text style={styles.stepperValue}>{seats || "1"}</Text>

                  <Pressable
                    style={styles.stepperButton}
                    onPress={() => onChangeSeats(String((Number(seats) || 1) + 1))}
                    hitSlop={6}
                  >
                    <Ionicons name="add" size={16} color="#F58220" />
                  </Pressable>
                </View>
              </View>
            </View>

            <Pressable
              style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
              onPress={onSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.submitText}>{submitLabel}</Text>
              )}
            </Pressable>

            <Pressable style={styles.cancelLink} onPress={onCancel}>
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </Pressable>
          </ScrollView>
        </DirectionalCard>
      </KeyboardAvoidingWrapper>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "85%",
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
  },
  scroll: {
    width: "100%",
  },
  scrollContent: {
    padding: 22,
  },
  title: {
    fontSize: 20,
    fontWeight: "900",
    color: "#111827",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 13,
    color: "#7C5F46",
    fontWeight: "700",
    textAlign: "center",
    marginTop: 4,
    marginBottom: 16,
  },
  summary: {
    width: "100%",
    backgroundColor: "#FBF7F1",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  routeText: {
    fontSize: 15,
    fontWeight: "900",
    color: "#111827",
  },
  subLabelText: {
    fontSize: 13,
    color: "#7C5F46",
    fontWeight: "700",
    marginTop: 2,
  },
  row: {
    flexDirection: "row",
    width: "100%",
    gap: 12,
    marginTop: 4,
    marginBottom: 16,
  },
  halfField: {
    flex: 1,
    minWidth: 0,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 6,
  },
  priceBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  priceInput: {
    flex: 1,
    minWidth: 0,
    color: "#111827",
    fontWeight: "700",
    fontSize: 14,
    padding: 0,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  stepperButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#FFF3E9",
    alignItems: "center",
    justifyContent: "center",
  },
  stepperValue: {
    fontSize: 15,
    fontWeight: "900",
    color: "#111827",
  },
  submitButton: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#F58220",
    borderRadius: 14,
    paddingVertical: 15,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
    textAlign: "center",
  },
  cancelLink: {
    marginTop: 12,
    paddingVertical: 8,
    alignItems: "center",
  },
  cancelText: {
    color: "#7C5F46",
    fontWeight: "800",
    fontSize: 14,
  },
});
