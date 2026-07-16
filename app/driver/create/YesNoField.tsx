import React from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { styles } from "./driverHelpers";

type Props = {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
};

export default function YesNoField({ label, value, onValueChange }: Props) {
  const { t } = useTranslation();

  return (
    <>
      <Text style={styles.label}>{label}</Text>

      <View style={styles.optionRow}>
        <Pressable
          style={[styles.optionButton, value && styles.optionButtonActive]}
          onPress={() => onValueChange(true)}
        >
          <Text style={[styles.optionText, value && styles.optionTextActive]}>
            {t("common.yes")}
          </Text>
        </Pressable>

        <Pressable
          style={[styles.optionButton, !value && styles.optionButtonActive]}
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
