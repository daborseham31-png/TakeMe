// ---------------------------------------------------------------------------
// School ride creation entry point — offers two modes:
//   - "One-time trip": the NEW outbound (+ optional return) flow, writing to
//     the schoolTrips collection (see SchoolTripForm.tsx / schoolTripsLib.ts).
//   - "Weekly recurring": the ORIGINAL school ride form (RideForm.tsx),
//     completely unchanged, still writing to driverRoutes — kept reachable
//     so no existing feature is removed by this upgrade.
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

type Mode = "oneTime" | "weekly";

export default function SchoolRideScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const [mode, setMode] = useState<Mode>("oneTime");

  if (mode === "weekly") {
    return <RideForm category="school" onBack={() => setMode("oneTime")} />;
  }

  return (
    <SafeAreaView style={styles.page}>
      <View style={{ paddingHorizontal: 16, paddingTop: 45 }}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons
            name={isRTL ? "arrow-forward" : "arrow-back"}
            size={24}
            color="#7C5F46"
          />
        </Pressable>

        <Text style={styles.title}>{t("schoolTrip.createScreenTitle")}</Text>
        <Text style={styles.subtitle}>{t("schoolTrip.createScreenSubtitle")}</Text>

        <View style={modeStyles.tabRow}>
          <Pressable
            style={[modeStyles.tab, mode === "oneTime" && modeStyles.tabActive]}
            onPress={() => setMode("oneTime")}
          >
            <Text
              style={[
                modeStyles.tabText,
                mode === "oneTime" && modeStyles.tabTextActive,
              ]}
            >
              {t("schoolTrip.modeOneTime")}
            </Text>
          </Pressable>

          <Pressable
            style={[modeStyles.tab, (mode as Mode) === "weekly" && modeStyles.tabActive]}
            onPress={() => setMode("weekly")}
          >
            <Text
              style={[
                modeStyles.tabText,
                (mode as Mode) === "weekly" && modeStyles.tabTextActive,
              ]}
            >
              {t("schoolTrip.modeWeekly")}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        <SchoolTripForm />
      </View>
    </SafeAreaView>
  );
}

const modeStyles = {
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
    paddingVertical: 10,
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
    color: "#F58220",
  },
};
