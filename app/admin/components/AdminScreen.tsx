// ---------------------------------------------------------------------------
// Shared page shell for every admin screen: SafeAreaView + a header (back
// button when nested, screen title, hamburger menu button) + the slide-up
// AdminMenuModal. Every admin screen renders its body as children.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";

import { adminColors } from "../adminTheme";
import AdminMenuModal from "./AdminMenuModal";

type Props = {
  title: string;
  activeKey?: string;
  showBack?: boolean;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
};

export default function AdminScreen({
  title,
  activeKey,
  showBack = true,
  headerRight,
  children,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        {showBack ? (
          <Pressable
            style={styles.iconButton}
            onPress={() => router.back()}
            hitSlop={8}
          >
            <Ionicons name="arrow-back" size={22} color={adminColors.textMuted} />
          </Pressable>
        ) : (
          <View style={styles.iconButton} />
        )}

        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>

        <View style={styles.headerRightRow}>
          {headerRight}
          <Pressable
            style={styles.iconButton}
            onPress={() => setMenuOpen(true)}
            hitSlop={8}
          >
            <Ionicons name="menu" size={24} color={adminColors.textMuted} />
          </Pressable>
        </View>
      </View>

      {children}

      <AdminMenuModal
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        activeKey={activeKey}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: adminColors.page,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerRightRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: "900",
    color: adminColors.text,
    textAlign: "center",
  },
});
