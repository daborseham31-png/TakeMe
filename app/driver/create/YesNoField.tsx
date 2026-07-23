import React from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { styles } from "./driverHelpers";

type Props = {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  // Overrides the selected button's default orange with the caller's own
  // category color (e.g. RideForm.tsx passing getCategoryMeta(category).
  // color) — omitted callers keep the plain default orange.
  activeColor?: string;
};

export default function YesNoField({ label, value, onValueChange, activeColor }: Props) {
  const { t } = useTranslation();
  const activeStyle = activeColor
    ? { backgroundColor: activeColor, borderColor: activeColor }
    : styles.optionButtonActive;

  return (
    <>
      <Text style={styles.label}>{label}</Text>

      <View style={styles.optionRow}>
        <Pressable
          style={[styles.optionButton, value && activeStyle]}
          onPress={() => onValueChange(true)}
        >
          <Text style={[styles.optionText, value && styles.optionTextActive]}>
            {t("common.yes")}
          </Text>
        </Pressable>

        <Pressable
          style={[styles.optionButton, !value && activeStyle]}
          onPress={() => onValueChange(false)}
        >
          <Text style={[styles.optionText, !value && styles.optionTextActive]}>
            {t("common.no")}
          </Text>
        </Pressable>
      </View>
    </>
  );
}
