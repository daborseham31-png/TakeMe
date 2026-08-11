// ---------------------------------------------------------------------------
// Live password-strength checklist — the ONE place this is rendered, so
// every screen where a user chooses a new password (Sign Up today; any
// future in-app Change Password screen) shows an identical UI instead of
// re-implementing its own checklist. Reads app/login/passwordValidation.ts
// (the shared rule set) and re-evaluates on every render, so it updates
// live as the caller's password state changes on each keystroke — no
// internal state or debouncing of its own.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  evaluatePasswordRequirements,
  PASSWORD_REQUIREMENT_I18N_KEY,
} from "../login/passwordValidation";

type Props = {
  password: string;
};

export default function PasswordRequirementsChecklist({ password }: Props) {
  const { t } = useTranslation();
  const requirements = evaluatePasswordRequirements(password);

  return (
    <View style={styles.container}>
      {requirements.map((requirement) => (
        <View key={requirement.key} style={styles.row}>
          <Ionicons
            name={requirement.passed ? "checkmark-circle" : "ellipse-outline"}
            size={15}
            color={requirement.passed ? "#166534" : "#8B7B6B"}
          />
          <Text style={[styles.text, requirement.passed && styles.textPassed]}>
            {t(PASSWORD_REQUIREMENT_I18N_KEY[requirement.key])}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
    marginBottom: 4,
    gap: 5,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  text: {
    fontSize: 12.5,
    fontWeight: "700",
    color: "#8B7B6B",
  },
  textPassed: {
    color: "#166534",
  },
});
