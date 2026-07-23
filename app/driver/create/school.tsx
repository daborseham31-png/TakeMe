// ---------------------------------------------------------------------------
// School ride creation entry point — one screen, two selectable modes:
//   - "One-time trip": writes to the schoolTrips collection (see
//     SchoolTripForm.tsx / schoolTripsLib.ts).
//   - "Weekly recurring": the original school ride form (RideForm.tsx),
//     still writing to driverRoutes — rendered inline (embedded) below the
//     SAME header/subtitle/selector, never a separate screen. Both forms
//     stay mounted at all times (toggled with display:none) so switching
//     between modes never loses whatever the driver already typed.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, SafeAreaView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useLanguage } from "../../i18n/LanguageProvider";
import { styles } from "./driverHelpers";
import RideForm from "./RideForm";
import SchoolTripForm from "./SchoolTripForm";

type TripFrequency = "oneTime" | "weekly";

export default function SchoolRideScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const [tripFrequency, setTripFrequency] = useState<TripFrequency>("oneTime");

  return (
    <SafeAreaView style={styles.page}>
      <View style={{ paddingHorizontal: 16, paddingTop: 45 }}>
        <View style={modeStyles.headerRow}>
          <Pressable style={modeStyles.headerBackButton} onPress={() => router.back()}>
            <Ionicons
              name={isRTL ? "arrow-forward" : "arrow-back"}
              size={24}
              color="#7C5F46"
            />
          </Pressable>

          <Text style={modeStyles.headerTitle}>{t("schoolTrip.createScreenTitle")}</Text>

          <View style={modeStyles.headerSpacer} />
        </View>

        <Text style={styles.subtitle}>{t("schoolTrip.createScreenSubtitle")}</Text>

        <View style={modeStyles.tabRow}>
          <Pressable
            style={[modeStyles.tab, tripFrequency === "oneTime" && modeStyles.tabActive]}
            onPress={() => setTripFrequency("oneTime")}
          >
            <Text
              style={[
                modeStyles.tabText,
                tripFrequency === "oneTime" && modeStyles.tabTextActive,
              ]}
            >
              {t("schoolTrip.modeOneTime")}
            </Text>
          </Pressable>

          <Pressable
            style={[modeStyles.tab, tripFrequency === "weekly" && modeStyles.tabActive]}
            onPress={() => setTripFrequency("weekly")}
          >
            <Text
              style={[
                modeStyles.tabText,
                tripFrequency === "weekly" && modeStyles.tabTextActive,
              ]}
            >
              {t("schoolTrip.modeWeekly")}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        {/* Both forms stay mounted the whole time — only visibility toggles,
            so each keeps whatever the driver already entered when the
            selector flips back and forth. */}
        <View style={{ flex: 1, display: tripFrequency === "oneTime" ? "flex" : "none" }}>
          <SchoolTripForm />
        </View>
        <View style={{ flex: 1, display: tripFrequency === "weekly" ? "flex" : "none" }}>
          <RideForm category="school" embedded forceRecurring />
        </View>
      </View>
    </SafeAreaView>
  );
}

const modeStyles = {
  headerRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  },
  headerBackButton: {
    width: 42,
    height: 42,
    justifyContent: "center" as const,
  },
  headerTitle: {
    flex: 1,
    fontSize: 22,
    fontWeight: "900" as const,
    color: "#111827",
    textAlign: "center" as const,
  },
  // Same width as headerBackButton, invisible — keeps headerTitle
  // mathematically centered on the row instead of just centered in the
  // leftover space next to the back button.
  headerSpacer: {
    width: 42,
  },
  tabRow: {
    flexDirection: "row" as const,
    backgroundColor: "#F3ECE3",
    borderRadius: 12,
    padding: 4,
    marginTop: 18,
    marginBottom: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 9,
    alignItems: "center" as const,
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
    fontWeight: "800" as const,
    color: "#7C5F46",
    fontSize: 13,
  },
  tabTextActive: {
    color: "#3B82F6",
  },
};
