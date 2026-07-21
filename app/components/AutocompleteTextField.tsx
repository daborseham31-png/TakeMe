// ---------------------------------------------------------------------------
// Shared autocomplete text field — car model, car color, plate number, price
// suggestions everywhere a driver creates a trip/route/job/errand. Wraps a
// normal, always-editable TextInput; suggestions are just a convenience
// list, never forced or auto-filled without the driver tapping one. See
// app/driver/create/savedFormValuesLib.ts for where the suggestion list
// itself comes from.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useRef, useState } from "react";
import {
  KeyboardTypeOptions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { styles as sharedStyles } from "../driver/create/driverHelpers";

type Props = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  suggestions: string[];
  placeholder?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
  error?: string;
  // Price shows "40 ₪" in the dropdown but still fills the field with the
  // plain "40" — the underlying suggestion value is never the formatted one.
  formatSuggestion?: (value: string) => string;
};

export default function AutocompleteTextField({
  label,
  value,
  onChangeText,
  suggestions,
  placeholder,
  icon,
  keyboardType,
  maxLength,
  error,
  formatSuggestion,
}: Props) {
  const [focused, setFocused] = useState(false);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filtered = useMemo(() => {
    const query = value.trim().toLowerCase();
    const list = query
      ? suggestions.filter((s) => s.toLowerCase().includes(query) && s.toLowerCase() !== query)
      : suggestions;
    return list.slice(0, 8);
  }, [suggestions, value]);

  const showDropdown = focused && filtered.length > 0;

  const handleBlur = () => {
    // Delayed so a suggestion's onPress (which fires shortly after this
    // blur, on the same touch sequence) still lands before the dropdown
    // disappears — a plain synchronous setFocused(false) here would hide
    // the list before the tap could ever register.
    blurTimeout.current = setTimeout(() => setFocused(false), 150);
  };

  const handleSelect = (suggestion: string) => {
    if (blurTimeout.current) clearTimeout(blurTimeout.current);
    onChangeText(suggestion);
    setFocused(false);
  };

  return (
    <View style={localStyles.wrapper}>
      <Text style={sharedStyles.label}>{label}</Text>

      <View style={sharedStyles.inputRow}>
        {icon ? <Ionicons name={icon} size={18} color="#8B7B6B" /> : null}
        <TextInput
          style={sharedStyles.rowInput}
          placeholder={placeholder}
          placeholderTextColor="#8B7B6B"
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          keyboardType={keyboardType}
          maxLength={maxLength}
        />
      </View>

      {error ? <Text style={localStyles.errorText}>{error}</Text> : null}

      {showDropdown ? (
        <View style={localStyles.dropdown}>
          <ScrollView keyboardShouldPersistTaps="handled" style={localStyles.dropdownScroll}>
            {filtered.map((suggestion, index) => (
              <Pressable
                key={`${suggestion}-${index}`}
                style={[localStyles.suggestionRow, index === filtered.length - 1 && localStyles.suggestionRowLast]}
                onPress={() => handleSelect(suggestion)}
              >
                <Ionicons name="time-outline" size={14} color="#8B7B6B" />
                <Text style={localStyles.suggestionText}>
                  {formatSuggestion ? formatSuggestion(suggestion) : suggestion}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const localStyles = StyleSheet.create({
  wrapper: {
    position: "relative",
    zIndex: 10,
  },
  errorText: {
    color: "#B91C1C",
    fontWeight: "700",
    fontSize: 12,
    marginTop: 4,
  },
  dropdown: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "100%",
    marginTop: 2,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    maxHeight: 190,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 6,
    zIndex: 20,
  },
  dropdownScroll: {
    maxHeight: 190,
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: "#F3ECE3",
  },
  suggestionRowLast: {
    borderBottomWidth: 0,
  },
  suggestionText: {
    color: "#111827",
    fontWeight: "700",
    fontSize: 14,
  },
});
