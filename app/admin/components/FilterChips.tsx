import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity } from "react-native";

import { adminColors, adminRadius } from "../adminTheme";

export type ChipOption<T extends string> = { key: T; label: string };

type Props<T extends string> = {
  options: ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
};

export default function FilterChips<T extends string>({ options, value, onChange }: Props<T>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {options.map((option) => {
        const active = option.key === value;

        return (
          <TouchableOpacity
            key={option.key}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onChange(option.key)}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 8,
    paddingVertical: 4,
  },
  chip: {
    borderWidth: 1,
    borderColor: adminColors.border,
    backgroundColor: adminColors.card,
    borderRadius: adminRadius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: adminColors.primary,
    borderColor: adminColors.primary,
  },
  chipText: {
    color: adminColors.textMuted,
    fontWeight: "800",
    fontSize: 12.5,
  },
  chipTextActive: {
    color: "#FFFFFF",
  },
});
