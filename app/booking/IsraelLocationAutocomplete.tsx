// ---------------------------------------------------------------------------
// Shared multilingual Israeli locality autocomplete — the ONE input to use
// everywhere a screen asks for a city / town / village / locality (From, To,
// work location, errand location, City/Village, ...). Do NOT use this for
// exact GPS pickup fields, street addresses, phone numbers, or free-text
// descriptions — those stay plain TextInput.
//
// No API key / network request: it searches the bundled israelLocations.ts
// dataset entirely on-device (see locationSearch.ts for the language
// detection + normalization + ranking logic).
//
// The dropdown renders in normal document flow directly below the input
// (NOT position: "absolute") so it pushes whatever comes after it — the next
// field's label, input, etc. — further down instead of overlapping it. This
// matters on screens with two of these stacked back-to-back (e.g. From/To in
// RideForm.tsx) — the one requirement on the CALLER is that the surrounding
// ScrollView passes `keyboardShouldPersistTaps="handled"`, otherwise the
// first tap on a suggestion just dismisses the keyboard instead of
// registering the press.
//
// Only one instance's dropdown is ever open at a time: focusing one instance
// broadcasts to every other mounted instance (module-level pub/sub below) so
// e.g. focusing "To" always closes "From"'s suggestions first, regardless of
// how many of these are on the same screen.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { IsraelLocation } from "./israelLocations";
import {
  detectInputLanguage,
  getLocationDisplayName,
  normalizeLocationText,
  searchIsraelLocations,
} from "./locationSearch";

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  onSelectLocation: (location: IsraelLocation) => void;
  placeholder?: string;
  label?: string;
  error?: string;
};

// Module-level "only one dropdown open at a time" coordinator. Every mounted
// instance registers a listener; focusing one instance tells every other
// instance (on any screen currently mounted) to close its own dropdown.
let nextInstanceId = 0;
const focusListeners = new Set<(sourceId: number) => void>();
const broadcastFocus = (sourceId: number) => {
  focusListeners.forEach((listener) => listener(sourceId));
};

// Splits `name` into [before, match, after] around the first case/diacritic
// -insensitive occurrence of `needle`, so the matching portion can be bolded.
// Falls back to [name, "", ""] when there's no match to highlight.
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

export default function IsraelLocationAutocomplete({
  value,
  onChangeText,
  onSelectLocation,
  placeholder,
  label,
  error,
}: Props) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const instanceIdRef = useRef<number | null>(null);
  if (instanceIdRef.current === null) {
    instanceIdRef.current = ++nextInstanceId;
  }
  const instanceId = instanceIdRef.current;

  // Close this instance's dropdown whenever a DIFFERENT instance is focused
  // — this is what keeps From/To (or any other pair on the same screen) from
  // both staying open at once.
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

  const language = useMemo(() => detectInputLanguage(value), [value]);

  const results = useMemo(
    () => searchIsraelLocations(value, language),
    [value, language],
  );

  const showDropdown = focused && value.trim().length > 0;

  const handleSelect = (location: IsraelLocation) => {
    if (blurTimeout.current) {
      clearTimeout(blurTimeout.current);
      blurTimeout.current = null;
    }

    onChangeText(getLocationDisplayName(location, language));
    onSelectLocation(location);
    setFocused(false);
  };

  // A short delay before hiding on blur gives the suggestion Pressable's
  // onPress time to fire first (tapping a suggestion blurs the TextInput
  // immediately, before the press is registered).
  const handleBlur = () => {
    blurTimeout.current = setTimeout(() => setFocused(false), 150);
  };

  const handleFocus = () => {
    if (blurTimeout.current) {
      clearTimeout(blurTimeout.current);
      blurTimeout.current = null;
    }
    broadcastFocus(instanceId);
    setFocused(true);
  };

  const isRTL = language !== "english";

  return (
    <View style={styles.wrapper}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      <View style={styles.inputRow}>
        <Ionicons name="location-outline" size={18} color="#8B7B6B" />
        <TextInput
          style={[styles.input, isRTL && styles.inputRTL]}
          value={value}
          onChangeText={onChangeText}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder || t("booking.enterCityTownVillage")}
          placeholderTextColor="#9B7A68"
        />
        {value.length > 0 ? (
          <Pressable
            hitSlop={8}
            onPress={() => {
              onChangeText("");
            }}
          >
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
              <Text style={styles.emptyText}>
                {t("booking.noLocationsFound")}
              </Text>
            </View>
          ) : (
            <ScrollView
              style={styles.dropdownScroll}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              showsVerticalScrollIndicator
            >
              {results.map((location) => {
                const name = getLocationDisplayName(location, language);
                const [before, match, after] = splitForHighlight(name, value);

                return (
                  <Pressable
                    key={location.id}
                    style={styles.resultRow}
                    onPress={() => handleSelect(location)}
                  >
                    <Ionicons name="location-sharp" size={16} color="#F58220" />
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
                        name
                      )}
                    </Text>
                  </Pressable>
                );
              })}
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
    // Normal document flow — NOT absolute — so it pushes whatever renders
    // after this field (the next label/input) further down the screen
    // instead of floating over it.
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
    maxHeight: 220,
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
    flex: 1,
    fontSize: 14.5,
    color: "#111827",
    fontWeight: "600",
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
});
