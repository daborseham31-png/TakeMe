// ---------------------------------------------------------------------------
// The "Weekly recurring" school ride search form — reachable as that tab
// (see index.tsx) alongside the newer outbound/return/round-trip direction
// search (DirectionSearchForm.tsx). Still searches against the legacy
// driverRoutes collection via /booking/driverresults — completely
// independent of the new schoolTrips collection.
//
// This form used to ALSO offer a single "quick" (non-weekly) day inside a
// checkbox toggle, on top of the weekly-days flow — removed since a
// one-time booking already has its own dedicated tab ("By direction")
// one level up, and having it duplicated inside a tab literally labeled
// "Weekly recurring" was confusing UI, not a distinct feature. This screen
// is now always in weekly mode; validateWeeklyRows/weeklyBookingLib.ts's
// own rules (past-day/next-week-window/etc.) are unchanged.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { getCategoryMeta } from "../bookingsLib";
import { translateCategoryLabel } from "../../i18n/formatters";
import { useLanguage } from "../../i18n/LanguageProvider";
import KeyboardAvoidingWrapper from "../../components/KeyboardAvoidingWrapper";
import IsraelLocationAutocomplete from "../IsraelLocationAutocomplete";
import { IsraelLocation } from "../israelLocations";
import SchoolAutocomplete from "../SchoolAutocomplete";
import { getLocalizedSchoolName, SchoolLocation } from "../schools";
import WeeklyDaysCard from "../../driver/create/WeeklyDaysCard";
import { validateWeeklyRows, WeekDayRow } from "../weeklyBookingLib";

const SCHOOL_CATEGORY_META = getCategoryMeta("school");

const LANGUAGES_LIST = [
  { key: "ar", label: "العربية" },
  { key: "he", label: "עברית" },
  { key: "en", label: "English" },
  { key: "ru", label: "Русский" },
];

export default function LegacySchoolSearchForm() {
  const { t } = useTranslation();
  const { isRTL, language } = useLanguage();

  const [fromAddress, setFromAddress] = useState("");
  const [schoolLocation, setSchoolLocation] = useState("");
  const [fromPlace, setFromPlace] = useState<IsraelLocation | null>(null);
  const [schoolPlace, setSchoolPlace] = useState<IsraelLocation | null>(null);
  const [fromError, setFromError] = useState("");
  const [schoolLocationError, setSchoolLocationError] = useState("");

  // The actual school/university institution, picked from SchoolAutocomplete
  // (see below) — always scoped to `schoolPlace` (this form's To/destination
  // field), never a free-text name. `schoolQuery` is purely the field's own
  // displayed text (the selected school's stored name, or "" once cleared);
  // `selectedSchool` is the validated SchoolLocation Search Drivers actually
  // requires — see handleSearch.
  const [schoolQuery, setSchoolQuery] = useState("");
  const [selectedSchool, setSelectedSchool] = useState<SchoolLocation | null>(null);
  const [schoolError, setSchoolError] = useState("");

  const handleFromChange = (text: string) => {
    setFromAddress(text);
    setFromPlace(null);
    if (fromError) setFromError("");
  };

  const handleSchoolLocationChange = (text: string) => {
    setSchoolLocation(text);
    setSchoolPlace(null);
    if (schoolLocationError) setSchoolLocationError("");

    // The school picker is scoped to THIS field (the destination city/area
    // — see schoolAreaLocationId below), so a school picked for the
    // previous destination is never silently kept once it changes (spec
    // item 4) — mirrors DirectionSearchForm.tsx's handleToChange.
    setSchoolQuery("");
    setSelectedSchool(null);
    if (schoolError) setSchoolError("");
  };

  const handleSchoolQueryChange = (text: string) => {
    setSchoolQuery(text);
    setSelectedSchool(null);
    if (schoolError) setSchoolError("");
  };

  // AGENTS.md's schoolSearchArea rule (same as DirectionSearchForm.tsx):
  // school suggestions are scoped to the destination city/area — here,
  // this form's own "To" field — never a nationwide search.
  const schoolAreaLocationId = schoolPlace?.id ?? null;

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

  const handleSearch = () => {
    if (!fromAddress.trim() || !schoolLocation.trim()) {
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

    if (!selectedSchool) {
      setSchoolError(t("schoolTrip.selectSchoolFromList"));
      return;
    }

    const baseParams: Record<string, string> = {
      category: "school",
      schoolName: getLocalizedSchoolName(selectedSchool, language),
      from: fromAddress.trim(),
      to: schoolLocation.trim(),
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
    };

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
  };

  return (
    <KeyboardAvoidingWrapper>
    <ScrollView
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.categoryPillRow}>
        <View
          style={[
            styles.categoryPill,
            { backgroundColor: `${SCHOOL_CATEGORY_META.color}18` },
          ]}
        >
          <Ionicons
            name={SCHOOL_CATEGORY_META.icon}
            size={14}
            color={SCHOOL_CATEGORY_META.color}
          />
          <Text style={[styles.categoryPillText, { color: SCHOOL_CATEGORY_META.color }]}>
            {translateCategoryLabel("school", SCHOOL_CATEGORY_META.label, t)}
          </Text>
        </View>
      </View>

      <View style={styles.card}>
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

        <SchoolAutocomplete
          label={t("school.schoolNameLabel")}
          value={schoolQuery}
          onChangeText={handleSchoolQueryChange}
          onSelectSchool={(school) => {
            setSelectedSchool(school);
            setSchoolError("");
          }}
          areaLocationId={schoolAreaLocationId}
          placeholder={t("school.schoolNamePlaceholder")}
          error={schoolError}
        />

        <View style={styles.sectionDivider} />

        <WeeklyDaysCard
          rows={weeklyRows}
          onChange={setWeeklyRows}
          defaultTime="07:30"
          mode="passenger"
          title={t("rides.weeklyTripDays")}
        />
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
    </KeyboardAvoidingWrapper>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: 40,
  },
  categoryPillRow: {
    flexDirection: "row",
    marginBottom: 12,
  },
  categoryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
  },
  categoryPillText: {
    fontWeight: "900",
    fontSize: 13,
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
  sectionDivider: {
    height: 1,
    backgroundColor: "#F0E7DB",
    marginTop: 16,
    marginBottom: 4,
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
