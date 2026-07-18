// ---------------------------------------------------------------------------
// School ride search entry point — mode toggle between:
//   - "By direction" (NEW): outbound only / return only / round trip,
//     searching the new schoolTrips collection (see DirectionSearchForm.tsx).
//   - "Weekly / classic": the ORIGINAL quick+weekly search, unchanged,
//     against driverRoutes (see LegacySchoolSearchForm.tsx).
// Mirrors the same mode-toggle pattern used on the driver side
// (app/driver/create/school.tsx) so nothing existing is removed.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useLanguage } from "../../i18n/LanguageProvider";
import DirectionSearchForm from "./DirectionSearchForm";
import LegacySchoolSearchForm from "./LegacySchoolSearchForm";

type Mode = "direction" | "legacy";

export default function SchoolRideScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const [mode, setMode] = useState<Mode>("direction");

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons
            name={isRTL ? "arrow-forward" : "arrow-back"}
            size={24}
            color="#7C5F46"
          />
        </Pressable>

        <View style={styles.headerRow}>
          <Text style={styles.headerEmoji}>🎒</Text>
          <Text style={styles.title}>{t("school.headerTitle")}</Text>
        </View>
        <Text style={styles.subtitle}>{t("school.subtitle")}</Text>

        <View style={styles.tabRow}>
          <Pressable
            style={[styles.tab, mode === "direction" && styles.tabActive]}
            onPress={() => setMode("direction")}
          >
            <Text style={[styles.tabText, mode === "direction" && styles.tabTextActive]}>
              {t("schoolTrip.modeByDirection")}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.tab, mode === "legacy" && styles.tabActive]}
            onPress={() => setMode("legacy")}
          >
            <Text style={[styles.tabText, mode === "legacy" && styles.tabTextActive]}>
              {t("schoolTrip.modeWeekly")}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.body}>
        {mode === "direction" ? <DirectionSearchForm /> : <LegacySchoolSearchForm />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 50,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    marginBottom: 4,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 4,
  },
  headerEmoji: {
    fontSize: 30,
  },
  title: {
    fontSize: 30,
    fontWeight: "900",
    color: "#111827",
  },
  subtitle: {
    fontSize: 15,
    color: "#7C5F46",
    marginBottom: 18,
  },
  tabRow: {
    flexDirection: "row",
    backgroundColor: "#F3ECE3",
    borderRadius: 12,
    padding: 4,
    marginBottom: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: "center",
  },
  tabActive: {
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 1,
  },
  tabText: {
    fontWeight: "800",
    color: "#7C5F46",
    fontSize: 13,
  },
  tabTextActive: {
    color: "#F58220",
  },
  body: {
    flex: 1,
    paddingHorizontal: 20,
  },
});
