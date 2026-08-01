// ---------------------------------------------------------------------------
// School Kiosk Links — admin screen. Lets an admin browse the school
// dataset by area, then by name. Reads ONLY the static school dataset
// (schoolKioskLinksLib.ts → schools.ts) — no Firestore reads at all, so no
// child/parent/driver/booking data is ever loaded here. Route protection is
// inherited from app/admin/_layout.tsx (the same admin-only guard every
// /admin/* screen goes through).
//
// School Area is a type-to-search autocomplete (never a permanently
// expanded full list — see filterSchoolAreaOptions's own header comment).
// School Name is a plain select scoped to whichever area is currently
// selected, disabled until one is — never a second free-text search.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useLanguage } from "../i18n/LanguageProvider";
import { adminColors, adminRadius, adminSpacing } from "./adminTheme";
import {
  filterSchoolAreaOptions,
  filterSchoolKioskLinkRows,
  getSchoolAreaOptions,
  getSchoolKioskLinkRows,
  SchoolAreaOption,
  SchoolKioskLinkRow,
} from "./schoolKioskLinksLib";
import AdminScreen from "./components/AdminScreen";
import { EmptyState } from "./components/AdminStates";

export default function AdminSchoolKioskLinksScreen() {
  const { t } = useTranslation();
  const { language } = useLanguage();

  // The CONFIRMED selection — only ever set by tapping a suggestion (see
  // handleSelectArea) or cleared (handleClearArea). `areaQuery` is purely
  // the input's own typed text; the two intentionally fall out of sync the
  // instant the admin edits the field again (handleAreaChangeText) so a
  // half-typed, unconfirmed string can never silently act as a filter.
  const [areaId, setAreaId] = useState<string | null>(null);
  const [areaQuery, setAreaQuery] = useState("");
  const [areaFocused, setAreaFocused] = useState(false);
  const areaBlurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // null = "All Schools" (within the selected area). Meaningless/disabled
  // while areaId is null — see schoolDropdownDisabled below.
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [schoolDropdownOpen, setSchoolDropdownOpen] = useState(false);

  const allRows = useMemo(() => getSchoolKioskLinkRows(language), [language]);
  const areaOptions = useMemo(() => getSchoolAreaOptions(allRows), [allRows]);

  // Only ever computed from typed text — see filterSchoolAreaOptions's own
  // comment: empty input always yields no suggestions at all.
  const areaSuggestions = useMemo(
    () => filterSchoolAreaOptions(areaOptions, areaQuery),
    [areaOptions, areaQuery],
  );
  const showAreaDropdown = areaFocused && areaQuery.trim().length > 0;

  // Every school belonging to the CONFIRMED area — both the School Name
  // dropdown's own option list and (via schoolId below) what narrows the
  // results further. Empty whenever no area is confirmed yet.
  const schoolsInArea = useMemo(
    () => (areaId ? filterSchoolKioskLinkRows(allRows, { areaLocationId: areaId }) : []),
    [allRows, areaId],
  );

  // Spec #4: no area selected -> every school; area + "All Schools" -> every
  // school in that area; area + one school -> only that school.
  const filteredRows = useMemo(() => {
    if (!areaId) return allRows;
    if (!schoolId) return schoolsInArea;
    return schoolsInArea.filter((row) => row.schoolId === schoolId);
  }, [allRows, areaId, schoolId, schoolsInArea]);

  const schoolDropdownDisabled = !areaId;
  const selectedSchoolLabel = !areaId
    ? t("admin.selectAreaFirstPlaceholder")
    : schoolId
      ? schoolsInArea.find((row) => row.schoolId === schoolId)?.name || t("admin.allSchools")
      : t("admin.allSchools");

  const handleAreaChangeText = (text: string) => {
    setAreaQuery(text);

    // Editing the field invalidates whatever was previously confirmed — a
    // real selection only ever happens via handleSelectArea below (spec:
    // "The user must select a valid area from the suggestions").
    if (areaId) {
      setAreaId(null);
      setSchoolId(null);
    }
  };

  const handleAreaFocus = () => {
    if (areaBlurTimeout.current) {
      clearTimeout(areaBlurTimeout.current);
      areaBlurTimeout.current = null;
    }
    setSchoolDropdownOpen(false);
    setAreaFocused(true);
  };

  // Same delay-before-hide trick used elsewhere in the app (see
  // IsraelLocationAutocomplete.tsx): a suggestion Pressable's onPress needs
  // a moment to fire before the input's own onBlur would otherwise hide the
  // dropdown out from under it.
  const handleAreaBlur = () => {
    areaBlurTimeout.current = setTimeout(() => setAreaFocused(false), 150);
  };

  const handleSelectArea = (option: SchoolAreaOption) => {
    if (areaBlurTimeout.current) {
      clearTimeout(areaBlurTimeout.current);
      areaBlurTimeout.current = null;
    }
    setAreaId(option.areaLocationId);
    setAreaQuery(option.label);
    setAreaFocused(false);
    // Spec #2: changing the area always resets the school pick back to
    // "All Schools" for the newly selected area.
    setSchoolId(null);
  };

  const handleClearArea = () => {
    if (areaBlurTimeout.current) {
      clearTimeout(areaBlurTimeout.current);
      areaBlurTimeout.current = null;
    }
    setAreaQuery("");
    setAreaId(null);
    setAreaFocused(false);
    // Spec #1: clearing the area also clears the selected school.
    setSchoolId(null);
  };

  const handleSelectSchool = (nextSchoolId: string | null) => {
    setSchoolId(nextSchoolId);
    setSchoolDropdownOpen(false);
  };

  const renderRow = ({ item }: { item: SchoolKioskLinkRow }) => (
    <View style={styles.card}>
      <Text style={styles.name} numberOfLines={2}>
        {item.name}
      </Text>
      <Text style={styles.schoolId}>
        {t("admin.schoolKioskSchoolIdLabel", { id: item.schoolId })}
      </Text>
    </View>
  );

  return (
    <AdminScreen title={t("admin.schoolKioskLinks")} activeKey="schoolKioskLinks">
      <Text style={styles.intro}>{t("admin.schoolKioskLinksIntro")}</Text>

      <View style={styles.filtersWrap}>
        <Text style={styles.fieldLabel}>{t("admin.schoolAreaLabel")}</Text>
        <View style={styles.searchRow}>
          <Ionicons name="search-outline" size={18} color={adminColors.placeholder} />
          <TextInput
            style={styles.input}
            value={areaQuery}
            onChangeText={handleAreaChangeText}
            onFocus={handleAreaFocus}
            onBlur={handleAreaBlur}
            placeholder={t("admin.schoolAreaSearchPlaceholder")}
            placeholderTextColor={adminColors.placeholder}
            autoCapitalize="none"
          />
          {areaQuery ? (
            <Ionicons
              name="close-circle"
              size={18}
              color={adminColors.placeholder}
              onPress={handleClearArea}
            />
          ) : null}
        </View>

        {showAreaDropdown ? (
          <View style={styles.dropdown}>
            {areaSuggestions.length === 0 ? (
              <View style={styles.emptyDropdownRow}>
                <Ionicons name="search-outline" size={16} color={adminColors.placeholder} />
                <Text style={styles.emptyDropdownText}>{t("admin.noAreasFound")}</Text>
              </View>
            ) : (
              <ScrollView
                style={styles.dropdownScroll}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator
              >
                {areaSuggestions.map((option) => (
                  <Pressable
                    key={option.areaLocationId}
                    style={styles.optionRow}
                    onPress={() => handleSelectArea(option)}
                  >
                    <Text style={styles.optionText} numberOfLines={1}>
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        ) : null}

        <Text style={[styles.fieldLabel, styles.schoolNameFieldLabel]}>
          {t("admin.schoolNameLabel")}
        </Text>
        <Pressable
          style={[styles.selectField, schoolDropdownDisabled && styles.selectFieldDisabled]}
          onPress={() => {
            if (schoolDropdownDisabled) return;
            setAreaFocused(false);
            setSchoolDropdownOpen((prev) => !prev);
          }}
          disabled={schoolDropdownDisabled}
        >
          <Text
            style={[styles.selectFieldText, schoolDropdownDisabled && styles.selectFieldTextDisabled]}
            numberOfLines={1}
          >
            {selectedSchoolLabel}
          </Text>
          <Ionicons
            name={schoolDropdownOpen ? "chevron-up" : "chevron-down"}
            size={18}
            color={adminColors.placeholder}
          />
        </Pressable>

        {schoolDropdownOpen && !schoolDropdownDisabled ? (
          <View style={styles.dropdown}>
            <ScrollView style={styles.dropdownScroll} nestedScrollEnabled showsVerticalScrollIndicator>
              <Pressable style={styles.optionRow} onPress={() => handleSelectSchool(null)}>
                <Text style={[styles.optionText, !schoolId && styles.optionTextActive]}>
                  {t("admin.allSchools")}
                </Text>
                {!schoolId ? <Ionicons name="checkmark" size={16} color={adminColors.primary} /> : null}
              </Pressable>

              {schoolsInArea.map((row) => {
                const active = row.schoolId === schoolId;
                return (
                  <Pressable
                    key={row.schoolId}
                    style={styles.optionRow}
                    onPress={() => handleSelectSchool(row.schoolId)}
                  >
                    <Text style={[styles.optionText, active && styles.optionTextActive]} numberOfLines={1}>
                      {row.name}
                    </Text>
                    {active ? <Ionicons name="checkmark" size={16} color={adminColors.primary} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}
      </View>

      <FlatList
        data={filteredRows}
        keyExtractor={(item) => item.schoolId}
        renderItem={renderRow}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <EmptyState
            icon="school-outline"
            title={t("admin.noSchoolsFound")}
            subtitle={t("admin.tryDifferentSearchFilter")}
          />
        }
      />
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  intro: {
    fontSize: 13,
    color: adminColors.textMuted,
    lineHeight: 19,
    paddingHorizontal: adminSpacing.lg,
    marginBottom: adminSpacing.sm,
  },
  filtersWrap: {
    paddingHorizontal: adminSpacing.lg,
    marginBottom: 6,
  },
  fieldLabel: {
    fontSize: 12.5,
    fontWeight: "800",
    color: adminColors.textMuted,
    marginBottom: 6,
  },
  schoolNameFieldLabel: {
    marginTop: 12,
  },
  selectField: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    backgroundColor: adminColors.card,
    borderWidth: 1,
    borderColor: adminColors.border,
    borderRadius: adminRadius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  selectFieldDisabled: {
    backgroundColor: adminColors.page,
  },
  selectFieldText: {
    flex: 1,
    color: adminColors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  selectFieldTextDisabled: {
    color: adminColors.placeholder,
    fontWeight: "600",
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: adminColors.card,
    borderWidth: 1,
    borderColor: adminColors.border,
    borderRadius: adminRadius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  input: {
    flex: 1,
    color: adminColors.text,
    fontSize: 14,
  },
  dropdown: {
    // Normal document flow — not absolute — so it pushes the field/list
    // below it further down instead of floating over it.
    marginTop: 6,
    backgroundColor: adminColors.card,
    borderWidth: 1,
    borderColor: adminColors.border,
    borderRadius: adminRadius.md,
    overflow: "hidden",
  },
  dropdownScroll: {
    maxHeight: 220,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: adminColors.divider,
  },
  optionText: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: "700",
    color: adminColors.text,
  },
  optionTextActive: {
    color: adminColors.primary,
  },
  emptyDropdownRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  emptyDropdownText: {
    color: adminColors.textMuted,
    fontSize: 13,
    fontWeight: "700",
  },
  list: {
    paddingHorizontal: adminSpacing.lg,
    paddingBottom: 40,
    gap: 10,
  },
  card: {
    backgroundColor: adminColors.card,
    borderWidth: 1,
    borderColor: adminColors.border,
    borderRadius: adminRadius.lg,
    padding: 14,
    gap: 4,
  },
  name: {
    fontSize: 15,
    fontWeight: "900",
    color: adminColors.text,
  },
  schoolId: {
    fontSize: 12.5,
    fontWeight: "700",
    color: adminColors.textMuted,
  },
});
