// ---------------------------------------------------------------------------
// Shared Loading / Empty / Error states — every admin list screen uses the
// exact same three components instead of hand-rolling its own.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { adminColors, adminRadius, adminSpacing } from "../adminTheme";

export function LoadingState({ label }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={adminColors.primary} />
      {label ? <Text style={styles.loadingText}>{label}</Text> : null}
    </View>
  );
}

export function EmptyState({
  icon = "file-tray-outline",
  title,
  subtitle,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={styles.center}>
      <Ionicons name={icon} size={40} color={adminColors.placeholder} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <View style={styles.center}>
      <Ionicons name="alert-circle-outline" size={40} color={adminColors.danger} />
      <Text style={styles.emptyTitle}>Something went wrong</Text>
      <Text style={styles.emptySubtitle}>{message}</Text>
      <Pressable style={styles.retryButton} onPress={onRetry}>
        <Ionicons name="refresh" size={16} color="#FFFFFF" />
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: adminSpacing.xl * 1.4,
    paddingHorizontal: adminSpacing.xl,
    gap: 8,
  },
  loadingText: {
    color: adminColors.textMuted,
    fontWeight: "700",
    marginTop: 6,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: adminColors.text,
    marginTop: 4,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 13,
    color: adminColors.textMuted,
    textAlign: "center",
    lineHeight: 19,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: adminColors.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: adminRadius.pill,
    marginTop: 8,
  },
  retryText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
});
