// ---------------------------------------------------------------------------
// Shared school autocomplete — the ONE input to use everywhere a screen asks
// a driver or parent to pick a school for a school trip. Selecting a result
// returns the school's stable id, real name, city, and GPS coordinates, so
// every school trip is matched by schoolId (never a free-text school name
// string) — see schoolTripsLib.ts.
//
// ALWAYS scoped to a single area via `areaLocationId` (the trip's currently
// selected To area for an outbound leg, or From area for a return leg — see
// AGENTS.md's school-search-area rule). Suggestions are never a nationwide
// free search: the field is disabled until an area is selected, and a
// picked school is cleared by the caller whenever that area changes (a
// school picked for one area is never silently kept when the area changes
// to a different one).
//
// Localization: suggestions (and the text filled into the field once one is
// picked) are shown in the app's CURRENT language via
// getLocalizedSchoolName/getLocalizedSchoolCity (schools.ts) — never hardcoded
// to Hebrew. Re-renders automatically when the language changes because
// useLanguage()'s `language` value is a dependency of every computation
// below. See schools.ts's file header for exactly what this localization is
// (a disclosed, best-effort display convenience) and isn't (an official
// government translation).
//
// Deliberately modeled after IsraelLocationAutocomplete.tsx (same dropdown
// behavior, same "only one open at a time" coordinator, same design) so it
// looks and behaves identically to every other location field in the app.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { useLanguage } from "../i18n/LanguageProvider";
import { normalizeLocationText } from "./locationSearch";
import {
  getLocalizedSchoolCity,
  getLocalizedSchoolName,
  MAX_SCHOOL_RESULTS,
  SchoolLocation,
  searchSchools,
} from "./schools";

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  onSelectSchool: (school: SchoolLocation) => void;
  areaLocationId: string | null;
  placeholder?: string;
  label?: string;
  error?: string;
};

let nextInstanceId = 0;
const focusListeners = new Set<(sourceId: number) => void>();
const broadcastFocus = (sourceId: number) => {
  focusListeners.forEach((listener) => listener(sourceId));
};

const splitForHighlight = (
  name: string,
  needle: string,
): [string, string, string] => {
  if (!needle) return [name, "", ""];

  const normalizedName = normalizeLocationText(name);
  const normalizedNeedle = normalizeLocationText(needle);
  const index = normalizedName.indexOf(normalizedNeedle);

  if (index === -1) return [name, "", ""];

  return [
    name.slice(0, index),
    name.slice(index, index + normalizedNeedle.length),
    name.slice(index + normalizedNeedle.length),
  ];
};

export default function SchoolAutocomplete({
  value,
  onChangeText,
  onSelectSchool,
  areaLocationId,
  placeholder,
  label,
  error,
}: Props) {
  const { t } = useTranslation();
  const { language, isRTL } = useLanguage();
  const [focused, setFocused] = useState(false);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const instanceIdRef = useRef<number | null>(null);
  if (instanceIdRef.current === null) {
    instanceIdRef.current = ++nextInstanceId;
  }
  const instanceId = instanceIdRef.current;

  useEffect(() => {
    const listener = (sourceId: number) => {
      if (sourceId !== instanceId) {
        setFocused(false);
      }
    };
    focusListeners.add(listener);
    return () => {
      focusListeners.delete(listener);
    };
  }, [instanceId]);

  const results = useMemo(
    () => searchSchools(value, areaLocationId, language),
    [value, areaLocationId, language],
  );

  const disabled = !areaLocationId;
  const showDropdown = focused && !disabled;

  const handleSelect = (school: SchoolLocation) => {
    if (blurTimeout.current) {
      clearTimeout(blurTimeout.current);
      blurTimeout.current = null;
    }

    onChangeText(getLocalizedSchoolName(school, language));
    onSelectSchool(school);
    setFocused(false);
  };

  const handleBlur = () => {
    blurTimeout.current = setTimeout(() => setFocused(false), 150);
  };

  const handleFocus = () => {
    if (disabled) return;
    if (blurTimeout.current) {
      clearTimeout(blurTimeout.current);
      blurTimeout.current = null;
    }
    broadcastFocus(instanceId);
    setFocused(true);
  };

  return (
    <View style={styles.wrapper}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      <View style={[styles.inputRow, disabled && styles.inputRowDisabled]}>
        <Ionicons name="school-outline" size={18} color="#8B7B6B" />
        <TextInput
          style={[styles.input, isRTL && styles.inputRTL]}
          value={value}
          onChangeText={onChangeText}
          onFocus={handleFocus}
          onBlur={handleBlur}
          editable={!disabled}
          placeholder={
            disabled
              ? t("schoolTrip.selectAreaFirst")
              : placeholder || t("schoolTrip.searchSchoolPlaceholder")
          }
          placeholderTextColor="#9B7A68"
        />
        {value.length > 0 && !disabled ? (
          <Pressable hitSlop={8} onPress={() => onChangeText("")}>
            <Ionicons name="close-circle" size={18} color="#C7B9AC" />
          </Pressable>
        ) : null}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {showDropdown ? (
        <View style={styles.dropdown}>
          {results.length === 0 ? (
            <View style={styles.emptyRow}>
              <Ionicons name="search-outline" size={16} color="#8B7B6B" />
              <Text style={styles.emptyText}>{t("schoolTrip.noSchoolsFound")}</Text>
            </View>
          ) : (
            <ScrollView
              style={styles.dropdownScroll}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              showsVerticalScrollIndicator
            >
              {results.map((school) => {
                const displayName = getLocalizedSchoolName(school, language);
                const displayCity = getLocalizedSchoolCity(school, language);
                const [before, match, after] = splitForHighlight(displayName, value);

                return (
                  <Pressable
                    key={school.id}
                    style={styles.resultRow}
                    onPress={() => handleSelect(school)}
                  >
                    <Ionicons name="school" size={16} color="#F58220" />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[styles.resultText, isRTL && styles.resultTextRTL]}
                        numberOfLines={1}
                      >
                        {match ? (
                          <>
                            {before}
                            <Text style={styles.resultTextMatch}>{match}</Text>
                            {after}
                          </>
                        ) : (
                          displayName
                        )}
                      </Text>
                      <Text
                        style={[styles.resultAddress, isRTL && styles.resultTextRTL]}
                        numberOfLines={1}
                      >
                        {displayCity}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
              {results.length === MAX_SCHOOL_RESULTS ? (
                <Text style={styles.moreResultsHint}>
                  {t("schoolTrip.moreSchoolsHint")}
                </Text>
              ) : null}
            </ScrollView>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: "100%",
    marginBottom: 18,
  },
  label: {
    fontSize: 14,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#FFFDFC",
  },
  inputRowDisabled: {
    backgroundColor: "#F3ECE3",
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: "#111827",
    padding: 0,
  },
  inputRTL: {
    textAlign: "right",
    writingDirection: "rtl",
  },
  errorText: {
    color: "#B91C1C",
    fontWeight: "700",
    fontSize: 12.5,
    marginTop: 6,
  },
  dropdown: {
    width: "100%",
    marginTop: 6,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 16,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 3,
    overflow: "hidden",
  },
  dropdownScroll: {
    maxHeight: 260,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F3ECE3",
  },
  resultText: {
    fontSize: 14.5,
    color: "#111827",
    fontWeight: "700",
  },
  resultAddress: {
    fontSize: 12,
    color: "#8B7B6B",
    fontWeight: "600",
    marginTop: 2,
  },
  resultTextRTL: {
    textAlign: "right",
    writingDirection: "rtl",
  },
  resultTextMatch: {
    fontWeight: "900",
    color: "#F58220",
  },
  emptyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  emptyText: {
    color: "#7C5F46",
    fontSize: 14,
    fontWeight: "600",
  },
  moreResultsHint: {
    textAlign: "center",
    color: "#8B7B6B",
    fontSize: 11.5,
    fontWeight: "600",
    paddingVertical: 8,
  },
});
