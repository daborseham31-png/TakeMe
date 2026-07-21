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

import IsraelLocationAutocomplete from "../booking/IsraelLocationAutocomplete";
import { IsraelLocation } from "../booking/israelLocations";

const LANGUAGES_LIST = [
  { key: "ar", label: "العربية" },
  { key: "he", label: "עברית" },
  { key: "en", label: "English" },
  { key: "ru", label: "Русский" },
];

const WEEK_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const getTodayDate = () => {
  const today = new Date();

  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const getDigitsOnly = (value: string) => {
  return value.replace(/\D/g, "");
};

const cleanTimeInput = (value: string) => {
  return value.replace(/[^\d:]/g, "").slice(0, 5);
};

const normalizeTime = (value: string) => {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);

  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours < 0 || hours > 23) return null;
  if (minutes < 0 || minutes > 59) return null;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0",
  )}`;
};

export default function DeliverItemScreen() {
  const { t } = useTranslation();
  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [fromPlace, setFromPlace] = useState<IsraelLocation | null>(null);
  const [toPlace, setToPlace] = useState<IsraelLocation | null>(null);
  const [fromError, setFromError] = useState("");
  const [toError, setToError] = useState("");
  const [tripTime, setTripTime] = useState("09:00");

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

  const [recipientPhone, setRecipientPhone] = useState("");
  const [itemDescription, setItemDescription] = useState("");

  const [weeklyBooking, setWeeklyBooking] = useState(false);

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

    const cleanTime = normalizeTime(tripTime);

    if (!cleanTime) {
      Alert.alert(t("validation.invalidTimeTitle"), t("validation.invalidTime"));
      return;
    }

    const cleanPhone = getDigitsOnly(recipientPhone);

    if (cleanPhone.length !== 10) {
      Alert.alert(
        t("validation.invalidPhoneTitle"),
        t("validation.recipientPhoneDigits"),
      );
      return;
    }

    if (!itemDescription.trim()) {
      Alert.alert(t("validation.missingItemTitle"), t("validation.describeItemMessage"));
      return;
    }

    const baseParams: Record<string, string> = {
      category: "delivery",
      from: fromLocation.trim(),
      to: toLocation.trim(),
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
      seats: "1",
      recipientPhone: cleanPhone,
      itemDescription: itemDescription.trim(),
      deliveryType: "person",
    };

    if (weeklyBooking) {
      const dayTimes: Record<string, string> = {};

      for (const day of WEEK_DAYS) {
        dayTimes[day] = cleanTime;
      }

      router.push({
        pathname: "/booking/driverresults",
        params: {
          ...baseParams,
          days: WEEK_DAYS.join(","),
          dayTimes: JSON.stringify(dayTimes),
          bookingType: "weekly",
        },
      } as any);
    } else {
      router.push({
        pathname: "/booking/driverresults",
        params: {
          ...baseParams,
          time: cleanTime,
          tripDate: getTodayDate(),
          bookingType: "quick",
        },
      } as any);
    }
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
          <Text style={styles.headerEmoji}>📦</Text>
          <Text style={styles.title}>{t("driverCreate.deliverItemTitle")}</Text>
        </View>
        <Text style={styles.subtitle}>{t("driverCreate.deliverItemDesc")}</Text>

        {/* Trip details */}
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

          <Text style={styles.labelOrange}>
            <Text>🕐 </Text>{t("booking.deliveryTimeLabel")}
          </Text>
          <View style={styles.timeRowFull}>
            <TextInput
              style={styles.timeInput}
              placeholder="--:--"
              placeholderTextColor="#8B7B6B"
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              value={tripTime}
              onChangeText={(text) => setTripTime(cleanTimeInput(text))}
            />
            <Ionicons name="time-outline" size={18} color="#111827" />
          </View>

          <Text style={styles.label}>📦 {t("driverCreate.recipientPhoneLabel")}</Text>
          <View style={styles.inputRow}>
            <Ionicons name="call-outline" size={18} color="#F58220" />
            <TextInput
              style={styles.rowInput}
              placeholder={t("driverCreate.enterRecipientPhone")}
              placeholderTextColor="#8B7B6B"
              keyboardType="phone-pad"
              maxLength={10}
              value={recipientPhone}
              onChangeText={(text) =>
                setRecipientPhone(getDigitsOnly(text).slice(0, 10))
              }
            />
          </View>

          <Text style={styles.label}>📦 {t("driverCreate.itemDescriptionLabel")}</Text>
          <TextInput
            style={styles.textArea}
            placeholder={t("driverCreate.describeItemToDeliver")}
            placeholderTextColor="#8B7B6B"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            value={itemDescription}
            onChangeText={setItemDescription}
          />

          <Pressable
            style={styles.weeklyRow}
            onPress={() => setWeeklyBooking(!weeklyBooking)}
          >
            <Ionicons
              name={weeklyBooking ? "checkbox" : "square-outline"}
              size={20}
              color={weeklyBooking ? "#F58220" : "#8B7B6B"}
            />
            <Ionicons name="calendar-outline" size={16} color="#7C5F46" />
            <Text style={styles.weeklyText}>
              {t("booking.bookWholeWeekOptional")}
            </Text>
          </Pressable>
        </View>

        {/* Driver Preferences */}
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
  labelOrange: {
    fontSize: 14,
    fontWeight: "800",
    color: "#F58220",
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
  textArea: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    padding: 14,
    minHeight: 90,
    backgroundColor: "#FFFDFC",
    color: "#111827",
  },
  timeRowFull: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: "#FFFDFC",
  },
  timeInput: {
    flex: 1,
    paddingVertical: 12,
    color: "#111827",
    fontWeight: "700",
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
