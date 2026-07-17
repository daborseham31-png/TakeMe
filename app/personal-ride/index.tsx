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

import CurrentLocationButton, {
  CurrentLocationResult,
} from "../booking/CurrentLocationButton";
import IsraelLocationAutocomplete from "../booking/IsraelLocationAutocomplete";
import { IsraelLocation } from "../booking/israelLocations";
import { validateWeeklyRows, WeekDayRow } from "../booking/weeklyBookingLib";
import DateInput, { TimeInput } from "../driver/create/DateInput";
import {
  getDayFromDateText,
  normalizeDateToYMD,
  normalizeTime,
  styles as weeklyStyles,
} from "../driver/create/driverHelpers";
import WeeklyDaysCard from "../driver/create/WeeklyDaysCard";
import { useTranslation } from "react-i18next";
import { useLanguage } from "../i18n/LanguageProvider";

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

const getTimeMinutes = (timeText: string) => {
  const cleanTime = normalizeTime(timeText);

  if (!cleanTime) return null;

  const [hours, minutes] = cleanTime.split(":").map(Number);

  return hours * 60 + minutes;
};

const isTimeAvailableForDate = (dateText: string, timeText: string) => {
  const cleanDate = normalizeDateToYMD(dateText);
  const cleanTime = normalizeTime(timeText);

  if (!cleanDate || !cleanTime) return false;

  const today = getTodayDate();

  if (cleanDate < today) return false;

  if (cleanDate > today) return true;

  const selectedMinutes = getTimeMinutes(cleanTime);

  if (selectedMinutes === null) return false;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  return selectedMinutes > currentMinutes;
};

export default function PersonalRideScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  // Manual matching field ("Nazareth") — this is what driver search compares
  // against driver.from/driver.to. It is NEVER auto-filled with an exact GPS
  // address, and using "Use my current location" below never touches it.
  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [fromPlace, setFromPlace] = useState<IsraelLocation | null>(null);
  const [toPlace, setToPlace] = useState<IsraelLocation | null>(null);
  const [fromError, setFromError] = useState("");
  const [toError, setToError] = useState("");

  const handleFromChange = (text: string) => {
    setFromLocation(text);
    setFromPlace(null);
    if (fromError) setFromError("");
  };

  const handleToChange = (text: string) => {
    setToLocation(text);
    setToPlace(null);
    if (toError) setToError("");
  };

  // The exact place within the destination city (a building, university,
  // landmark, ...) — free text, optional, never used for driver matching
  // (that's `toLocation`/`toPlace` above). Only shown to the driver on the
  // payment/confirmation screen and saved on the booking.
  const [destinationDetails, setDestinationDetails] = useState("");

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

  const [tripTime, setTripTime] = useState("09:00");
  const [showTripTimePicker, setShowTripTimePicker] = useState(false);
  const [seats, setSeats] = useState(1);

  const [weeklyBooking, setWeeklyBooking] = useState(false);
  const [weeklyRows, setWeeklyRows] = useState<WeekDayRow[]>([]);

  const [genderPref, setGenderPref] = useState<"any" | "male" | "female">(
    "any",
  );

  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);

  const toggleLanguage = (lang: string) => {
    if (selectedLanguages.includes(lang)) {
      setSelectedLanguages(selectedLanguages.filter((item) => item !== lang));
    } else {
      setSelectedLanguages([...selectedLanguages, lang]);
    }
  };

  const toggleWeeklyBooking = () => {
    const nextValue = !weeklyBooking;

    setWeeklyBooking(nextValue);

    if (!nextValue) {
      setWeeklyRows([]);
    }
  };

  const handleUseCurrentLocation = (result: CurrentLocationResult) => {
    setNavAddress(result.address);
    setNavCoords({ latitude: result.latitude, longitude: result.longitude });
  };

  const decreaseSeats = () => {
    setSeats((prev) => Math.max(1, prev - 1));
  };

  const increaseSeats = () => {
    setSeats((prev) => Math.min(8, prev + 1));
  };

  const handleSearch = () => {
    if (!fromLocation || !toLocation) {
      Alert.alert(t("auth.missingDetails"), t("validation.enterFromAndTo"));
      return;
    }

    if (!fromPlace) {
      setFromError(t("validation.selectLocationFromList"));
      return;
    }

    if (!toPlace) {
      setToError(t("validation.selectLocationFromList"));
      return;
    }

    const baseParams: Record<string, string> = {
      category: "personal",
      // Manual matching fields only — driver search compares these, never
      // the GPS pickup point below.
      from: fromLocation.trim(),
      to: toLocation.trim(),
      // Stable ids so this matches the same driver regardless of which
      // language each side searched in (see israelLocations.ts). Names are
      // a fallback for the driver side only, in case that trip predates
      // location ids entirely — see sameLocation in locationSearch.ts.
      fromLocationId: fromPlace.id,
      toLocationId: toPlace.id,
      fromLocationNames: JSON.stringify({
        english: fromPlace.english,
        arabic: fromPlace.arabic,
        hebrew: fromPlace.hebrew,
      }),
      toLocationNames: JSON.stringify({
        english: toPlace.english,
        arabic: toPlace.arabic,
        hebrew: toPlace.hebrew,
      }),
      genderPref,
      languages: selectedLanguages.join(","),
      // The exact place within the destination city (optional) — shown to
      // the driver, never used for matching.
      ...(destinationDetails.trim()
        ? { destinationDetails: destinationDetails.trim() }
        : {}),
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
      Alert.alert(
        t("validation.invalidDateTitle"),
        t("validation.chooseValidTripDate"),
      );
      return;
    }

    if (cleanDate < getTodayDate()) {
      Alert.alert(t("validation.invalidDateTitle"), t("validation.chooseTodayOrFuture"));
      return;
    }

    const tripDay = getDayFromDateText(cleanDate);

    const cleanTime = normalizeTime(tripTime);

    if (!cleanTime) {
      Alert.alert(
        t("validation.invalidTimeTitle"),
        t("validation.chooseValidTimeRange"),
      );
      return;
    }

    if (!isTimeAvailableForDate(cleanDate, cleanTime)) {
      Alert.alert(
        t("validation.invalidTimeTitle"),
        t("validation.cannotBookPastTime"),
      );
      return;
    }

    if (seats < 1 || seats > 8) {
      Alert.alert(t("validation.invalidSeatsTitle"), t("validation.seatsRange"));
      return;
    }

    router.push({
      pathname: "/booking/driverresults",
      params: {
        ...baseParams,
        tripDate: cleanDate,
        tripDay,
        bookForWholeWeek: "false",
        time: cleanTime,
        seats: String(seats),
        bookingType: "quick",
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
          <Ionicons name={isRTL ? "arrow-forward" : "arrow-back"} size={24} color="#7C5F46" />
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.headerEmoji}>🚗</Text>
          <Text style={styles.title}>{t("rideCategory.categories.personal.title")}</Text>
        </View>
        <Text style={styles.subtitle}>{t("rideCategory.categories.personal.desc")}</Text>

        <View style={styles.card}>
          <View style={styles.twoColumns}>
            <View style={styles.column}>
              <IsraelLocationAutocomplete
                label={t("booking.from")}
                value={fromLocation}
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
                value={toLocation}
                onChangeText={handleToChange}
                onSelectLocation={(location) => {
                  setToPlace(location);
                  setToError("");
                }}
                placeholder={t("booking.enterDestinationCity")}
                error={toError}
              />
            </View>
          </View>

          <Text style={styles.label}>{t("booking.exactDestination")} </Text>
          <View style={styles.inputRow}>
            <Ionicons name="flag-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.rowInput}
              placeholder={t("booking.enterExactBuildingHint")}
              placeholderTextColor="#8B7B6B"
              value={destinationDetails}
              onChangeText={setDestinationDetails}
            />
          </View>

          <View style={styles.navPickupBox}>
            <Text style={styles.label}>{t("booking.pickupLocationForDriverNav")}</Text>
            <Text style={styles.navPickupHint}>
              {t("booking.pickupOptionalHint")}
            </Text>

            <CurrentLocationButton onLocated={handleUseCurrentLocation} />

            {navAddress ? (
              <View style={styles.navPickupResult}>
                <Text style={styles.navPickupResultText}>📍 {navAddress}</Text>
                <Text style={styles.navPickupSavedText}>{t("booking.locationSaved")}</Text>
              </View>
            ) : null}
          </View>

          {!weeklyBooking && (
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
                  <Text style={weeklyStyles.label}>{t("booking.seats")}</Text>
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
          )}

          <Pressable style={styles.weeklyRow} onPress={toggleWeeklyBooking}>
            <Ionicons
              name={weeklyBooking ? "checkbox" : "square-outline"}
              size={20}
              color={weeklyBooking ? "#F58220" : "#8B7B6B"}
            />
            <Ionicons name="calendar-outline" size={16} color="#7C5F46" />
            <Text style={styles.weeklyText}>{t("booking.bookForWholeWeek")}</Text>
          </Pressable>

          {weeklyBooking && (
            <View style={styles.weeklyBox}>
              <WeeklyDaysCard
                rows={weeklyRows}
                onChange={setWeeklyRows}
                defaultTime="09:00"
                mode="passenger"
              />
            </View>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.prefTitleRow}>
            <Ionicons name="person-outline" size={18} color="#F58220" />
            <Text style={styles.sectionTitle}>{t("booking.driverPreferences")}</Text>
          </View>

          <Text style={styles.label}>{t("booking.driverGender")}</Text>
          <View style={styles.optionRow}>
            <Pressable
              style={[
                styles.optionButton,
                genderPref === "any" && styles.optionButtonActive,
              ]}
              onPress={() => setGenderPref("any")}
            >
              <Text
                style={[
                  styles.optionText,
                  genderPref === "any" && styles.optionTextActive,
                ]}
              >
                {t("common.any")}
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.optionButton,
                genderPref === "male" && styles.optionButtonActive,
              ]}
              onPress={() => setGenderPref("male")}
            >
              <Text
                style={[
                  styles.optionText,
                  genderPref === "male" && styles.optionTextActive,
                ]}
              >
                {t("common.male")}
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.optionButton,
                genderPref === "female" && styles.optionButtonActive,
              ]}
              onPress={() => setGenderPref("female")}
            >
              <Text
                style={[
                  styles.optionText,
                  genderPref === "female" && styles.optionTextActive,
                ]}
              >
                {t("common.female")}
              </Text>
            </Pressable>
          </View>

          <Text style={styles.label}>{t("booking.driverSpeaks")}</Text>
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
          <Ionicons name="search-outline" size={20} color="#FFFFFF" />
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
    gap: 10,
  },
  headerEmoji: {
    fontSize: 26,
  },
  title: {
    fontSize: 30,
    fontWeight: "900",
    color: "#111827",
  },
  subtitle: {
    fontSize: 15,
    color: "#7C5F46",
    marginTop: 6,
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 8,
  },
  prefTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: "#FFFDFC",
  },
  rowInput: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
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
  seatsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: "#FFFDFC",
  },
  seatButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
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
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
  },
  weeklyText: {
    fontWeight: "800",
    color: "#111827",
  },
  weeklyBox: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#E7DCD1",
    paddingTop: 14,
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
