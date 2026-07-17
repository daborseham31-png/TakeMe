import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { useLanguage } from "../../i18n/LanguageProvider";
import CurrentLocationButton, {
  CurrentLocationResult,
} from "../CurrentLocationButton";
import IsraelLocationAutocomplete from "../IsraelLocationAutocomplete";
import { IsraelLocation } from "../israelLocations";
import DateInput, { TimeInput } from "../../driver/create/DateInput";
import {
  getDayFromDateText,
  isTimeAvailableForDate,
  normalizeDateToYMD,
  normalizeTime,
  styles as weeklyStyles,
} from "../../driver/create/driverHelpers";
import WeeklyDaysCard from "../../driver/create/WeeklyDaysCard";
import { validateWeeklyRows, WeekDayRow } from "../weeklyBookingLib";

const LANGUAGES_LIST = [
  { key: "ar", label: "العربية" },
  { key: "he", label: "עברית" },
  { key: "en", label: "English" },
  { key: "ru", label: "Русский" },
];

const getTodayDate = () => {
  const today = new Date();

  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

export default function SchoolRideScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();

  const [schoolName, setSchoolName] = useState("");
  // Manual matching field ("Nazareth") — this is what driver search compares
  // against driver.from/driver.to. It is NEVER auto-filled with an exact GPS
  // address, and using "Use my current location" below never touches it.
  const [fromAddress, setFromAddress] = useState("");
  const [schoolLocation, setSchoolLocation] = useState("");
  const [fromPlace, setFromPlace] = useState<IsraelLocation | null>(null);
  const [schoolPlace, setSchoolPlace] = useState<IsraelLocation | null>(null);
  const [fromError, setFromError] = useState("");
  const [schoolLocationError, setSchoolLocationError] = useState("");

  const handleFromChange = (text: string) => {
    setFromAddress(text);
    setFromPlace(null);
    if (fromError) setFromError("");
  };

  const handleSchoolLocationChange = (text: string) => {
    setSchoolLocation(text);
    setSchoolPlace(null);
    if (schoolLocationError) setSchoolLocationError("");
  };

  // Separate "pickup location for driver navigation" — an exact GPS point
  // (+ readable address) used ONLY so the driver can navigate to the
  // passenger. Never sent to driver matching, never written into `from`.
  const [navAddress, setNavAddress] = useState("");
  const [navCoords, setNavCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  const [tripDate, setTripDate] = useState(getTodayDate());
  const [showTripDatePicker, setShowTripDatePicker] = useState(false);

  const [tripTime, setTripTime] = useState("07:30");
  const [showTripTimePicker, setShowTripTimePicker] = useState(false);

  const [seats, setSeats] = useState(1);

  const [weeklyBooking, setWeeklyBooking] = useState(false);
  const [weeklyRows, setWeeklyRows] = useState<WeekDayRow[]>([]);

  const [genderPref, setGenderPref] = useState<"any" | "male" | "female">(
    "any",
  );

  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);

  const decreaseSeats = () => {
    setSeats((prev) => Math.max(1, prev - 1));
  };

  const increaseSeats = () => {
    setSeats((prev) => Math.min(8, prev + 1));
  };

  const toggleLanguage = (lang: string) => {
    if (selectedLanguages.includes(lang)) {
      setSelectedLanguages(selectedLanguages.filter((item) => item !== lang));
    } else {
      setSelectedLanguages([...selectedLanguages, lang]);
    }
  };

  const handleUseCurrentLocation = (result: CurrentLocationResult) => {
    setNavAddress(result.address);
    setNavCoords({ latitude: result.latitude, longitude: result.longitude });
  };

  const toggleWeeklyBooking = () => {
    const nextValue = !weeklyBooking;

    setWeeklyBooking(nextValue);

    if (!nextValue) {
      setWeeklyRows([]);
    }
  };

  const handleSearch = () => {
    if (!schoolName.trim() || !fromAddress.trim() || !schoolLocation.trim()) {
      Alert.alert(t("auth.missingDetails"), t("validation.schoolMissingDetails"));
      return;
    }

    if (!fromPlace) {
      setFromError(t("validation.selectLocationFromList"));
      return;
    }

    if (!schoolPlace) {
      setSchoolLocationError(t("validation.selectLocationFromList"));
      return;
    }

    const baseParams: Record<string, string> = {
      category: "school",
      schoolName: schoolName.trim(),
      // Manual matching fields only — driver search compares these, never
      // the GPS pickup point below.
      from: fromAddress.trim(),
      to: schoolLocation.trim(),
      // Stable ids so this matches the same driver regardless of which
      // language each side searched in (see israelLocations.ts). Names are
      // a fallback for the driver side only, in case that trip predates
      // location ids entirely — see sameLocation in locationSearch.ts.
      fromLocationId: fromPlace.id,
      toLocationId: schoolPlace.id,
      fromLocationNames: JSON.stringify({
        english: fromPlace.english,
        arabic: fromPlace.arabic,
        hebrew: fromPlace.hebrew,
      }),
      toLocationNames: JSON.stringify({
        english: schoolPlace.english,
        arabic: schoolPlace.arabic,
        hebrew: schoolPlace.hebrew,
      }),
      genderPref,
      languages: selectedLanguages.join(","),
      // Separate navigation-only pickup point (optional) — passed through
      // untouched to ride-payment/the booking doc, never used for matching.
      ...(navCoords
        ? {
            pickupLatitude: String(navCoords.latitude),
            pickupLongitude: String(navCoords.longitude),
            pickupAddress: navAddress,
          }
        : {}),
    };

    if (weeklyBooking) {
      const cleanedDays = validateWeeklyRows(weeklyRows, {
        requirePrice: false,
      });

      if (!cleanedDays) return;

      router.push({
        pathname: "/booking/driverresults",
        params: {
          ...baseParams,
          bookingType: "weekly",
          weeklyDays: JSON.stringify(
            cleanedDays.map(({ dayKey, dayName, date, time, seats }) => ({
              dayKey,
              dayName,
              date,
              time,
              seats,
            })),
          ),
        },
      } as any);

      return;
    }

    const cleanDate = normalizeDateToYMD(tripDate);

    if (!cleanDate) {
      Alert.alert(t("validation.invalidDateTitle"), t("validation.invalidDateFuture"));
      return;
    }

    const tripDay = getDayFromDateText(cleanDate);

    const cleanTime = normalizeTime(tripTime);

    if (!cleanTime) {
      Alert.alert(t("validation.invalidTimeTitle"), t("validation.invalidTime"));
      return;
    }

    if (!isTimeAvailableForDate(cleanDate, cleanTime)) {
      Alert.alert(t("validation.invalidTimeTitle"), t("validation.pastTime"));
      return;
    }

    if (seats < 1 || seats > 8) {
      Alert.alert(t("validation.invalidSeatsTitle"), t("validation.invalidSeats"));
      return;
    }

    router.push({
      pathname: "/booking/driverresults",
      params: {
        ...baseParams,

        bookForWholeWeek: "false",
        bookingType: "quick",

        tripDate: cleanDate,
        tripDay,
        time: cleanTime,
        seats: String(seats),
      },
    } as any);
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#7C5F46" />
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.headerEmoji}>🎒</Text>
          <Text style={styles.title}>{t("school.headerTitle")}</Text>
        </View>

        <Text style={styles.subtitle}>{t("school.subtitle")}</Text>

        <View style={styles.card}>
          <Text style={[styles.label, isRTL && styles.textRTL]}>
            {t("school.schoolNameLabel")}
          </Text>
          <View style={styles.inputRow}>
            <Ionicons name="school-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.input}
              placeholder={t("school.schoolNamePlaceholder")}
              placeholderTextColor="#8B7B6B"
              value={schoolName}
              onChangeText={setSchoolName}
            />
          </View>

          <View style={styles.twoColumns}>
            <View style={styles.column}>
              <IsraelLocationAutocomplete
                label={t("booking.from")}
                value={fromAddress}
                onChangeText={handleFromChange}
                onSelectLocation={(location) => {
                  setFromPlace(location);
                  setFromError("");
                }}
                placeholder={t("booking.enterDepartureCity")}
                error={fromError}
              />
            </View>

            <View style={styles.column}>
              <IsraelLocationAutocomplete
                label={t("booking.to")}
                value={schoolLocation}
                onChangeText={handleSchoolLocationChange}
                onSelectLocation={(location) => {
                  setSchoolPlace(location);
                  setSchoolLocationError("");
                }}
                placeholder={t("school.toPlaceholder")}
                error={schoolLocationError}
              />
            </View>
          </View>

          <View style={styles.navPickupBox}>
            <Text style={[styles.label, isRTL && styles.textRTL]}>
              {t("booking.pickupSectionTitle")}
            </Text>
            <Text style={[styles.navPickupHint, isRTL && styles.textRTL]}>
              {t("booking.pickupSectionHint")}
            </Text>

            <CurrentLocationButton onLocated={handleUseCurrentLocation} />

            {navAddress ? (
              <View style={styles.navPickupResult}>
                <Text style={styles.navPickupResultText}>📍 {navAddress}</Text>
                <Text style={styles.navPickupSavedText}>
                  {t("booking.locationSaved")}
                </Text>
              </View>
            ) : null}
          </View>

          {!weeklyBooking ? (
            <>
              <DateInput
                label={t("booking.tripDate")}
                value={tripDate}
                onChange={setTripDate}
                showPicker={showTripDatePicker}
                setShowPicker={setShowTripDatePicker}
              />

              <View style={styles.twoColumns}>
                <View style={styles.column}>
                  <TimeInput
                    label={t("booking.tripTime")}
                    value={tripTime}
                    onChange={setTripTime}
                    showPicker={showTripTimePicker}
                    setShowPicker={setShowTripTimePicker}
                    associatedDate={tripDate}
                  />
                </View>

                <View style={styles.column}>
                  <Text style={[weeklyStyles.label, isRTL && styles.textRTL]}>
                    {t("booking.seats")}
                  </Text>
                  <View style={styles.seatsRow}>
                    <Pressable style={styles.seatButton} onPress={decreaseSeats}>
                      <Ionicons name="remove" size={20} color="#111827" />
                    </Pressable>

                    <Text style={styles.seatsNumber}>{seats}</Text>

                    <Pressable style={styles.seatButton} onPress={increaseSeats}>
                      <Ionicons name="add" size={20} color="#111827" />
                    </Pressable>
                  </View>
                </View>
              </View>
            </>
          ) : null}

          <Pressable style={styles.weeklyRow} onPress={toggleWeeklyBooking}>
            <Ionicons
              name={weeklyBooking ? "checkbox" : "square-outline"}
              size={20}
              color={weeklyBooking ? "#F58220" : "#8B7B6B"}
            />
            <Ionicons name="calendar-outline" size={16} color="#7C5F46" />
            <Text style={styles.weeklyText}>{t("booking.bookWholeWeek")}</Text>
          </Pressable>

          {weeklyBooking ? (
            <View style={styles.weeklyBox}>
              <WeeklyDaysCard
                rows={weeklyRows}
                onChange={setWeeklyRows}
                defaultTime="07:30"
                mode="passenger"
              />
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Ionicons name="person-outline" size={18} color="#F58220" />
            <Text style={styles.sectionTitle}>
              {t("booking.driverPreferences")}
            </Text>
          </View>

          <Text style={[styles.label, isRTL && styles.textRTL]}>
            {t("booking.driverGender")}
          </Text>
          <View style={styles.optionRow}>
            {(["any", "male", "female"] as const).map((item) => (
              <Pressable
                key={item}
                style={[
                  styles.optionButton,
                  genderPref === item && styles.optionButtonActive,
                ]}
                onPress={() => setGenderPref(item)}
              >
                <Text
                  style={[
                    styles.optionText,
                    genderPref === item && styles.optionTextActive,
                  ]}
                >
                  {item === "any"
                    ? t("common.any")
                    : item === "male"
                      ? t("common.male")
                      : t("common.female")}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.label, isRTL && styles.textRTL]}>
            {t("booking.driverSpeaks")}
          </Text>
          <View style={styles.languageRow}>
            {LANGUAGES_LIST.map((lang) => {
              const active = selectedLanguages.includes(lang.key);

              return (
                <Pressable
                  key={lang.key}
                  style={[
                    styles.languageButton,
                    active && styles.languageButtonActive,
                  ]}
                  onPress={() => toggleLanguage(lang.key)}
                >
                  <Text
                    style={[
                      styles.languageText,
                      active && styles.languageTextActive,
                    ]}
                  >
                    {lang.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Pressable style={styles.searchButton} onPress={handleSearch}>
          <Ionicons name="search-outline" size={18} color="#FFFFFF" />
          <Text style={styles.searchText}>{t("booking.searchDrivers")}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  scroll: {
    padding: 20,
    paddingTop: 50,
    paddingBottom: 40,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    marginBottom: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 4,
  },
  headerEmoji: {
    fontSize: 30,
  },
  title: {
    fontSize: 30,
    fontWeight: "900",
    color: "#111827",
  },
  subtitle: {
    fontSize: 15,
    color: "#7C5F46",
    marginBottom: 24,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
  },
  twoColumns: {
    flexDirection: "row",
    gap: 12,
  },
  column: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 8,
    marginTop: 10,
  },
  textRTL: {
    textAlign: "right",
    writingDirection: "rtl",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: "#FFFDFC",
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    color: "#111827",
  },
  rowInput: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    color: "#111827",
  },
  navPickupBox: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#F0E5DC",
  },
  navPickupHint: {
    fontSize: 12,
    color: "#7C5F46",
    marginTop: -4,
    marginBottom: 4,
  },
  navPickupResult: {
    marginTop: 10,
    backgroundColor: "#F1FBF4",
    borderWidth: 1,
    borderColor: "#BBE7C6",
    borderRadius: 10,
    padding: 10,
  },
  navPickupResultText: {
    color: "#111827",
    fontWeight: "800",
    fontSize: 13,
  },
  navPickupSavedText: {
    color: "#166534",
    fontWeight: "900",
    fontSize: 12,
    marginTop: 2,
  },
  dayText: {
    marginTop: -2,
    marginBottom: 8,
    fontSize: 13,
    fontWeight: "900",
    color: "#F58220",
  },
  seatsRow: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    backgroundColor: "#FFFDFC",
    paddingHorizontal: 10,
  },
  seatButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  seatsNumber: {
    fontSize: 20,
    fontWeight: "900",
    color: "#111827",
    minWidth: 28,
    textAlign: "center",
  },
  weeklyRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  weeklyText: {
    color: "#111827",
    fontWeight: "800",
  },
  weeklyBox: {
    marginTop: 14,
  },
  optionRow: {
    flexDirection: "row",
    gap: 8,
  },
  optionButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  optionButtonActive: {
    backgroundColor: "#F58220",
    borderColor: "#F58220",
  },
  optionText: {
    fontWeight: "800",
    color: "#7C5F46",
    fontSize: 13,
  },
  optionTextActive: {
    color: "#FFFFFF",
  },
  languageRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  languageButton: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#FFFFFF",
  },
  languageButtonActive: {
    backgroundColor: "#F58220",
    borderColor: "#F58220",
  },
  languageText: {
    color: "#7C5F46",
    fontWeight: "700",
  },
  languageTextActive: {
    color: "#FFFFFF",
  },
  searchButton: {
    backgroundColor: "#F58220",
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  searchText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 16,
  },
});