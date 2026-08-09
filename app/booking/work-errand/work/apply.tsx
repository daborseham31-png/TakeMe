import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { DirectionalScreen } from "../../../i18n/DirectionalPrimitives";
import { useLanguage } from "../../../i18n/LanguageProvider";
import { paddingEnd } from "../../../i18n/rtl";
import PickupLocationPicker, { PickupLocation, resolvePickupArea } from "../../PickupLocationPicker";
import { createApplication } from "../workErrandLib";

type JobListing = {
  id: string;
  employerId: string;
  name: string;
  gender: "male" | "female";
  jobTypeEn: string;
  descriptionEn: string;
  hourlyRate: number;
  phone: string;
  workHoursFrom: string;
  workHoursTo: string;
  dayEn: string;
  date: string;
  workersNeeded: number;
  remainingSeats: number;
  locationEn: string;
  rating: number;
  ratingCount: number;
  languages: string[];
};

const defaultJob: JobListing = {
  id: "",
  employerId: "",
  name: "Employer",
  gender: "male",
  jobTypeEn: "Work Job",
  descriptionEn: "No description",
  hourlyRate: 0,
  phone: "",
  workHoursFrom: "",
  workHoursTo: "",
  dayEn: "",
  date: "",
  workersNeeded: 1,
  remainingSeats: 1,
  locationEn: "",
  rating: 4.8,
  ratingCount: 0,
  languages: [],
};

export default function WorkApplyScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const params = useLocalSearchParams();

  const job = useMemo(() => {
    try {
      if (typeof params.job === "string") {
        return JSON.parse(params.job) as JobListing;
      }
    } catch {
      return defaultJob;
    }

    return defaultJob;
  }, [params.job]);

  const [pickupLocation, setPickupLocation] = useState<PickupLocation | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async () => {
    if (!pickupLocation) {
      Alert.alert(t("auth.missingDetails"), t("pickupLocation.pickupLocationRequired"));
      return;
    }

    try {
      setSubmitting(true);

      // Best-effort — the SAME point already selected above, never a fresh
      // location fix. A resolution failure/timeout must never block sending
      // the request (see resolvePickupArea's own header) — the employer
      // still sees the address either way.
      const area = await resolvePickupArea(pickupLocation.latitude, pickupLocation.longitude).catch(() => "");

      await createApplication(
        "work",
        {
          sourceId: job.id,
          providerId: job.employerId,
          providerName: job.name,
          title: job.jobTypeEn,
          date: job.date,
          startTime: job.workHoursFrom,
          endTime: job.workHoursTo,
          hourlyPay: job.hourlyRate || null,
          price: null,
        },
        {
          notes: notes.trim(),
          location: {
            latitude: pickupLocation.latitude,
            longitude: pickupLocation.longitude,
            address: pickupLocation.address,
          },
          area,
          pickupSource: pickupLocation.source,
        },
      );

      setSent(true);
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("workErrand.couldNotSendRequest"));
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <DirectionalScreen style={styles.safe}>
        <View style={styles.successContainer}>
          <Ionicons name="checkmark-circle-outline" size={96} color="#22C55E" />

          <Text style={styles.successTitle}>{t("workErrand.requestSentTitle")}</Text>

          <Text style={styles.successText}>
            {t("workErrand.requestSentMessage", { name: job.name })}
          </Text>

          <Pressable
            style={styles.successButton}
            onPress={() => router.replace("/(tabs)/bookings" as any)}
          >
            <Text style={styles.successButtonText}>{t("rides.goToMyBookings")}</Text>
          </Pressable>
        </View>
      </DirectionalScreen>
    );
  }

  return (
    <DirectionalScreen style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Ionicons
              name={isRTL ? "arrow-forward" : "arrow-back"}
              size={24}
              color="#7A665C"
            />
          </Pressable>

          <View style={styles.jobCard}>
            <View style={styles.jobHeader}>
              <View style={styles.jobLeft}>
                <Text style={styles.jobName}>{job.name}</Text>

                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{job.jobTypeEn}</Text>
                </View>
              </View>

              <View style={styles.ratingBox}>
                <Ionicons name="star" size={17} color="#22C55E" />
                {job.ratingCount > 0 ? (
                  <>
                    <Text style={styles.ratingText}>
                      {job.rating.toFixed(1)}
                    </Text>
                    <Text style={styles.ratingText}>({job.ratingCount})</Text>
                  </>
                ) : (
                  <Text style={styles.ratingText}>{t("workErrand.newEmployer")}</Text>
                )}
              </View>
            </View>

            <Text style={styles.description}>{job.descriptionEn}</Text>

            <View style={styles.detailsGrid}>
              {job.locationEn ? (
                <View style={[styles.detail, paddingEnd(6, isRTL)]}>
                  <Ionicons name="location-outline" size={15} color="#7A665C" />
                  <Text style={styles.detailText}>{job.locationEn}</Text>
                </View>
              ) : null}

              {job.date ? (
                <View style={[styles.detail, paddingEnd(6, isRTL)]}>
                  <Ionicons name="calendar-outline" size={15} color="#7A665C" />
                  <Text style={styles.detailText}>{job.date}</Text>
                </View>
              ) : null}

              {job.workHoursFrom || job.workHoursTo ? (
                <View style={[styles.detail, paddingEnd(6, isRTL)]}>
                  <Ionicons name="time-outline" size={15} color="#7A665C" />
                  <Text style={styles.detailText}>
                    {job.workHoursFrom} - {job.workHoursTo}
                  </Text>
                </View>
              ) : null}

              {job.workersNeeded ? (
                <View style={[styles.detail, paddingEnd(6, isRTL)]}>
                  <Ionicons name="people-outline" size={15} color="#7A665C" />
                  <Text style={styles.detailText}>
                    {t("workErrand.workersNeededCount", { count: job.workersNeeded })}
                  </Text>
                </View>
              ) : null}

              {typeof job.remainingSeats === "number" ? (
                <View style={[styles.detail, paddingEnd(6, isRTL)]}>
                  <Ionicons
                    name="checkmark-done-outline"
                    size={15}
                    color="#7A665C"
                  />
                  <Text style={styles.detailText}>
                    {t("workErrand.placesRemainingCount", { count: job.remainingSeats })}
                  </Text>
                </View>
              ) : null}
            </View>

            <Text style={styles.price}>
              ₪{job.hourlyRate}{t("booking.perHourShort")}
            </Text>
          </View>

          <Text style={styles.sectionTitle}>{t("workErrand.yourDetails")}</Text>

          <Text style={styles.hint}>{t("workErrand.autoProfileHint")}</Text>

          <Text style={[styles.label, { marginTop: 0 }]}>{t("pickupLocation.fieldLabel")}</Text>
          <Pressable style={styles.pickupField} onPress={() => setPickerVisible(true)}>
            <Ionicons name="location-outline" size={18} color="#7A665C" />
            <Text style={styles.pickupFieldText} numberOfLines={1}>
              {pickupLocation?.address || t("pickupLocation.notSelectedPlaceholder")}
            </Text>
            <Ionicons name="chevron-forward" size={16} color="#C7B9AC" />
          </Pressable>

          <Text style={styles.label}>{t("common.notes")}</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={notes}
            onChangeText={setNotes}
            placeholder={t("workErrand.notesPlaceholder")}
            placeholderTextColor="#9B7A68"
            multiline
          />

          <Pressable
            style={[styles.submitButton, submitting && styles.submitDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            <Text style={styles.submitText}>
              {submitting ? t("workErrand.sending") : t("workErrand.sendRequest")}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <PickupLocationPicker
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={setPickupLocation}
      />
    </DirectionalScreen>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  keyboard: {
    flex: 1,
  },
  container: {
    paddingHorizontal: 22,
    paddingTop: 25,
    paddingBottom: 40,
  },
  backButton: {
    width: 45,
    height: 40,
    justifyContent: "center",
    marginBottom: 8,
  },
  jobCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E4DDD7",
    borderRadius: 14,
    padding: 18,
    marginBottom: 26,
  },
  jobHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  jobLeft: {
    flex: 1,
  },
  jobName: {
    fontSize: 20,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 8,
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "#2F9B95",
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 14,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  ratingBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  ratingText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#111827",
  },
  description: {
    fontSize: 15,
    color: "#7A5C4B",
    lineHeight: 22,
    marginBottom: 12,
  },
  detailsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 8,
    marginBottom: 10,
  },
  detail: {
    width: "50%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  detailText: {
    fontSize: 13,
    color: "#7A5C4B",
    flexShrink: 1,
  },
  price: {
    fontSize: 16,
    color: "#22C55E",
    fontWeight: "900",
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 10,
  },
  hint: {
    fontSize: 13,
    color: "#7A5C4B",
    marginBottom: 14,
    lineHeight: 18,
  },
  pickupField: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 46,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E4DDD7",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 14,
  },
  pickupFieldText: {
    flex: 1,
    fontSize: 15,
    color: "#111827",
    fontWeight: "700",
  },
  label: {
    fontSize: 14,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 8,
    marginTop: 10,
  },
  input: {
    minHeight: 46,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E4DDD7",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: "#111827",
    marginBottom: 10,
  },
  textArea: {
    minHeight: 90,
    textAlignVertical: "top",
  },
  submitButton: {
    backgroundColor: "#22C55E",
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 8,
  },
  submitDisabled: {
    opacity: 0.6,
  },
  submitText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  successContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  successTitle: {
    fontSize: 26,
    fontWeight: "900",
    color: "#111827",
    marginTop: 18,
    marginBottom: 10,
  },
  successText: {
    fontSize: 16,
    color: "#7A5C4B",
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 26,
  },
  successButton: {
    backgroundColor: "#22C55E",
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  successButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
});
