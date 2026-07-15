import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { adminColors, adminRadius } from "../adminTheme";

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
};

export default function SearchBar({ value, onChangeText, placeholder = "Search…" }: Props) {
  return (
    <View style={styles.row}>
      <Ionicons name="search-outline" size={18} color={adminColors.placeholder} />
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={adminColors.placeholder}
        autoCapitalize="none"
      />
      {value ? (
        <Ionicons
          name="close-circle"
          size={18}
          color={adminColors.placeholder}
          onPress={() => onChangeText("")}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
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
});
