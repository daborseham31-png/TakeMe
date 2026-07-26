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
import IsraelLocationAutocomplete from "../../IsraelLocationAutocomplete";
import { IsraelLocation } from "../../israelLocations";
import {
  createApplication,
  detectCurrentLocation,
  GeoPoint,
} from "../workErrandLib";

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

  const [city, setCity] = useState("");
  const [cityPlace, setCityPlace] = useState<IsraelLocation | null>(null);
  const [cityError, setCityError] = useState("");

  const handleCityChange = (text: string) => {
    setCity(text);
    setCityPlace(null);
    if (cityError) setCityError("");
  };

  const [neighborhood, setNeighborhood] = useState("");
  const [notes, setNotes] = useState("");
  const [location, setLocation] = useState<GeoPoint | null>(null);
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const detectLocation = async () => {
    try {
      setLocating(true);
      const loc = await detectCurrentLocation();
      setLocation(loc);
    } catch (error: any) {
      Alert.alert(
        t("workErrand.locationTitle"),
        error?.message || t("workErrand.couldNotDetectLocation"),
      );
    } finally {
      setLocating(false);
    }
  };

  const handleSubmit = async () => {
    const cleanCity = city.trim();
    const cleanNeighborhood = neighborhood.trim();

    if (!cleanCity || !cleanNeighborhood) {
      Alert.alert(t("auth.missingDetails"), t("workErrand.fillCityNeighborhood"));
      return;
    }

    if (!cityPlace) {
      setCityError(t("validation.selectLocationFromList"));
      return;
    }

    if (!location || location.latitude === null || location.longitude === null) {
      Alert.alert(
        t("workErrand.locationNeededTitle"),
        t("workErrand.detectLocationMessage"),
      );
      return;
    }

    try {
      setSubmitting(true);

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
          city: cleanCity,
          cityLocationId: cityPlace.id,
          cityLocationNames: {
            english: cityPlace.english,
            arabic: cityPlace.arabic,
            hebrew: cityPlace.hebrew,
          },
          neighborhood: cleanNeighborhood,
          notes: notes.trim(),
          location,
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
          <Ionicons name="checkmark-circle-outline" size={96} color="#F58220" />

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
                <Ionicons name="star" size={17} color="#F58220" />
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

          <Text style={styles.label}>{t("workErrand.yourLocation")}</Text>
          <Pressable
            style={styles.locationBox}
            onPress={detectLocation}
            disabled={locating}
          >
            <Ionicons
              name={location ? "location" : "locate-outline"}
              size={20}
              color="#F58220"
            />
            <Text style={styles.locationText} numberOfLines={2}>
              {locating
                ? t("booking.findingLocation")
                : location
                  ? location.address || t("workErrand.currentLocationDetected")
                  : t("workErrand.tapToDetectLocation")}
            </Text>
            {location ? (
              <Ionicons name="checkmark-circle" size={20} color="#16A34A" />
            ) : null}
          </Pressable>

          <View style={styles.row}>
            <View style={styles.halfField}>
              <IsraelLocationAutocomplete
                label={t("workErrand.cityVillageLabel")}
                value={city}
                onChangeText={handleCityChange}
                onSelectLocation={(location) => {
                  setCityPlace(location);
                  setCityError("");
                }}
                placeholder={t("workErrand.enterCityVillage")}
                error={cityError}
              />
            </View>

            <View style={styles.halfField}>
              <Text style={styles.label}>{t("workErrand.neighborhoodLabel")}</Text>
              <TextInput
                style={styles.input}
                value={neighborhood}
                onChangeText={setNeighborhood}
                placeholder={t("workErrand.enterNeighborhood")}
                placeholderTextColor="#9B7A68"
              />
            </View>
          </View>

          <Text style={styles.label}>{t("workErrand.notesLabel")}</Text>
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
    color: "#F58220",
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
  locationBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FFF8F2",
    borderWidth: 1.5,
    borderColor: "#FFE2C5",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 6,
  },
  locationText: {
    flex: 1,
    color: "#3C2319",
    fontSize: 14,
    fontWeight: "700",
  },
  row: {
    flexDirection: "row",
    gap: 14,
  },
  halfField: {
    flex: 1,
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
    backgroundColor: "#F58220",
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
    backgroundColor: "#F58220",
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
