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
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { getCategoryMeta } from "../bookingsLib";
import {
  DirectionalRow,
  DirectionalScreen,
  DirectionalText,
} from "../../i18n/DirectionalPrimitives";
import { translateCategoryLabel } from "../../i18n/formatters";
import { useLanguage } from "../../i18n/LanguageProvider";
import DirectionSearchForm from "./DirectionSearchForm";
import LegacySchoolSearchForm from "./LegacySchoolSearchForm";

type Mode = "direction" | "legacy";

export default function SchoolRideScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const [mode, setMode] = useState<Mode>("direction");
  // Same compact icon+label chip the driver-side create/school.tsx header
  // already uses, instead of a big emoji+bold-title block — one consistent
  // "category badge" look across both sides of this flow.
  const meta = getCategoryMeta("school");

  return (
    <DirectionalScreen style={styles.page}>
      <View style={styles.header}>
        <DirectionalRow style={styles.topRow}>
          <DirectionalRow style={styles.topRowStart}>
            <Pressable style={styles.backButton} onPress={() => router.back()}>
              <Ionicons
                name={isRTL ? "arrow-forward" : "arrow-back"}
                size={24}
                color="#7C5F46"
              />
            </Pressable>

            <DirectionalRow
              style={[styles.categoryBadge, { backgroundColor: `${meta.color}18` }]}
            >
              <Ionicons name={meta.icon} size={15} color={meta.color} />
              <DirectionalText style={[styles.categoryBadgeText, { color: meta.color }]}>
                {translateCategoryLabel("school", meta.label, t)}
              </DirectionalText>
            </DirectionalRow>
          </DirectionalRow>

          <Pressable onPress={() => router.push("/booking/school/my-children" as any)}>
            <DirectionalRow style={styles.myChildrenButton}>
              <Ionicons name="people-outline" size={16} color="#3B82F6" />
              <DirectionalText style={styles.myChildrenButtonText}>
                {t("schoolChildren.manageChildrenLink")}
              </DirectionalText>
            </DirectionalRow>
          </Pressable>
        </DirectionalRow>

        <DirectionalRow style={styles.tabRow}>
          <Pressable
            style={[styles.tab, mode === "direction" && styles.tabActive]}
            onPress={() => setMode("direction")}
          >
            <DirectionalText style={[styles.tabText, mode === "direction" && styles.tabTextActive]}>
              {t("schoolTrip.modeByDirection")}
            </DirectionalText>
          </Pressable>

          <Pressable
            style={[styles.tab, mode === "legacy" && styles.tabActive]}
            onPress={() => setMode("legacy")}
          >
            <DirectionalText style={[styles.tabText, mode === "legacy" && styles.tabTextActive]}>
              {t("schoolTrip.modeWeekly")}
            </DirectionalText>
          </Pressable>
        </DirectionalRow>
      </View>

      <View style={styles.body}>
        {mode === "direction" ? <DirectionSearchForm /> : <LegacySchoolSearchForm />}
      </View>
    </DirectionalScreen>
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
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  topRowStart: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
  },
  categoryBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  categoryBadgeText: {
    fontSize: 13.5,
    fontWeight: "900",
  },
  myChildrenButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F3ECE3",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  myChildrenButtonText: {
    color: "#3B82F6",
    fontWeight: "800",
    fontSize: 12.5,
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
    color: "#3B82F6",
  },
  body: {
    flex: 1,
    paddingHorizontal: 20,
  },
});
