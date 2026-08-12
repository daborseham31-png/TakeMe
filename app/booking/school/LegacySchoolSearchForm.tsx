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
// is now always in weekly mode. The calendar (WeeklyDaysCard) uses
// calendarVariant="anyDate" — same per-row native date picker as every
// other weekly flow, just without the current/next-week clamp, so any
// today-or-future date can be picked; validated with
// validateWeeklyRowsAnyFutureDate (weeklyBookingLib.ts), the same
// any-future-date check Personal Ride's weekly booking already uses.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Alert } from "../../AppAlert";
import { useTranslation } from "react-i18next";

import { PhysicalDirectionalBlockText } from "../../i18n/DirectionalPrimitives";
import { useLanguage } from "../../i18n/LanguageProvider";
import KeyboardAvoidingWrapper from "../../components/KeyboardAvoidingWrapper";
import IsraelLocationAutocomplete from "../IsraelLocationAutocomplete";
import { IsraelLocation } from "../israelLocations";
import PickupLocationPicker, { PickupLocation } from "../PickupLocationPicker";
import SchoolAutocomplete from "../SchoolAutocomplete";
import { getLocalizedSchoolName, SchoolLocation } from "../schools";
import WeeklyDaysCard from "../../driver/create/WeeklyDaysCard";
import { validateWeeklyRowsAnyFutureDate, WeekDayRow } from "../weeklyBookingLib";

const LANGUAGES_LIST = [
  { key: "ar", label: "العربية" },
  { key: "he", label: "עברית" },
  { key: "en", label: "English" },
  { key: "ru", label: "Русский" },
];

export default function LegacySchoolSearchForm() {
  const { t } = useTranslation();
  const { isRTL, language } = useLanguage();

  // The child(ren) already confirmed on select-child.tsx before this screen
  // ever mounted (see ride-category.tsx) — this form and DirectionSearchForm
  // read the same `childEntries` route param (both are rendered inside the
  // same /booking/school route, not separate routes). This legacy/weekly
  // flow has no per-row child picker of its own, so the roster is simply
  // carried straight through to /booking/driverresults unchanged.
  const params = useLocalSearchParams<{ childEntries?: string }>();
  const childEntriesParam = String(params.childEntries || "");

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

  // The student's real GPS pickup/home point (B — see routeMatchLib.ts and
  // PickupLocationPicker.tsx, the exact same shared component Personal Ride
  // already uses) — separate from fromAddress/fromPlace above, which stay
  // pure city-matching text. Lets driverresults.tsx run the local
  // route-matching algorithm for weekly School searches instead of only
  // exact from/to text matching, without ever exposing latitude/longitude
  // fields to the user.
  const [pickupLocation, setPickupLocation] = useState<PickupLocation | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);

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

    if (!pickupLocation) {
      Alert.alert(t("auth.missingDetails"), t("pickupLocation.pickupLocationRequired"));
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
      childEntries: childEntriesParam,
      // The student's real GPS pickup point (B) — see routeMatchLib.ts.
      // driverresults.tsx already reads these exact param names for both
      // Personal Ride and (legacy weekly) School Ride; never rendered as
      // raw numbers anywhere in this form's own UI.
      pickupLat: String(pickupLocation.latitude),
      pickupLng: String(pickupLocation.longitude),
      pickupAddress: pickupLocation.address,
      pickupSource: pickupLocation.source,
    };

    const cleanedDays = validateWeeklyRowsAnyFutureDate(weeklyRows, {
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
    <>
    <KeyboardAvoidingWrapper>
    <ScrollView
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <PhysicalDirectionalBlockText style={styles.formSubtitle}>
        {t("school.subtitle")}
      </PhysicalDirectionalBlockText>

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

        <Text style={[styles.label, isRTL && styles.textRTL]}>
          {t("pickupLocation.fieldLabel")}
        </Text>
        <Pressable style={styles.pickupRow} onPress={() => setPickerVisible(true)}>
          <Ionicons name="location-outline" size={18} color="#8B7B6B" />
          <Text style={styles.pickupRowText} numberOfLines={1}>
            {pickupLocation?.address || t("pickupLocation.notSelectedPlaceholder")}
          </Text>
          <Ionicons name="chevron-forward" size={16} color="#C7B9AC" />
        </Pressable>

        <View style={styles.sectionDivider} />

        <WeeklyDaysCard
          rows={weeklyRows}
          onChange={setWeeklyRows}
          defaultTime="07:30"
          mode="passenger"
          title={t("rides.weeklyTripDays")}
          calendarVariant="anyDate"
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

    <PickupLocationPicker
      visible={pickerVisible}
      onClose={() => setPickerVisible(false)}
      onSelect={setPickupLocation}
    />
    </>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: 40,
  },
  formSubtitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 18,
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
  pickupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "#FFFDFC",
  },
  pickupRowText: {
    flex: 1,
    color: "#111827",
    fontWeight: "700",
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
