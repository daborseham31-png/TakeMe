import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { adminColors, adminRadius, adminSpacing } from "../adminTheme";

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: number | string;
  tint?: string;
};

export default function StatCard({ icon, label, value, tint = adminColors.primary }: Props) {
  return (
    <View style={styles.card}>
      <View style={[styles.iconCircle, { backgroundColor: `${tint}1A` }]}>
        <Ionicons name={icon} size={18} color={tint} />
      </View>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexBasis: "47%",
    flexGrow: 1,
    backgroundColor: adminColors.card,
    borderWidth: 1,
    borderColor: adminColors.border,
    borderRadius: adminRadius.lg,
    padding: adminSpacing.md,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  value: {
    fontSize: 22,
    fontWeight: "900",
    color: adminColors.text,
  },
  label: {
    fontSize: 12,
    color: adminColors.textMuted,
    fontWeight: "700",
    marginTop: 2,
  },
});
