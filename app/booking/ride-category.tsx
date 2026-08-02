import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { DirectionalScreen } from "../i18n/DirectionalPrimitives";
import { useLanguage } from "../i18n/LanguageProvider";
import { marginStart } from "../i18n/rtl";

type Category = {
  key: string;
  titleKey: string;
  descKey: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
};

const categories: Category[] = [
  {
    key: "school",
    titleKey: "rideCategory.categories.school.title",
    descKey: "rideCategory.categories.school.desc",
    icon: "school-outline",
    color: "#3B82F6",
  },
  {
    key: "workErrands",
    titleKey: "rideCategory.categories.workErrands.title",
    descKey: "rideCategory.categories.workErrands.desc",
    icon: "briefcase-outline",
    color: "#22C55E",
  },
  {
    key: "personal",
    titleKey: "rideCategory.categories.personal.title",
    descKey: "rideCategory.categories.personal.desc",
    icon: "person-outline",
    color: "#EC4899",
  },
  {
    key: "help",
    titleKey: "rideCategory.categories.help.title",
    descKey: "rideCategory.categories.help.desc",
    icon: "construct-outline",
    color: "#EF4444",
  },
];

export default function RideCategoryScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const handleSelect = (key: string) => {
    const routes: Record<string, string> = {
      // Straight into the School Ride form (Daily/By direction + Weekly
      // tabs, see school/index.tsx) — the child-selection step
      // (select-child.tsx/ChildSelector.tsx) only gates booking an already-
      // published School trip from the Home feed (see home.tsx's
      // childSelectItem), never this category entry point.
      school: "/booking/school",
      workErrands: "/booking/work-errand",
      personal: "/personal-ride",
      help: "/booking/roadside-help",
    };

    router.push(routes[key] as any);
  };

  return (
    <DirectionalScreen style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name={isRTL ? "arrow-forward" : "arrow-back"} size={24} color="#7C5F46" />
        </Pressable>

        <Text style={styles.title}>{t("rideCategory.title")}</Text>

        <Text style={styles.subtitle}>{t("rideCategory.subtitle")}</Text>

        <View style={styles.grid}>
          {categories.map((cat, index) => {
            const isLastOdd =
              index === categories.length - 1 && categories.length % 2 !== 0;

            return (
              <Pressable
                key={cat.key}
                style={[
                  styles.card,
                  isLastOdd && styles.lastCard,
                  isLastOdd && marginStart("26%", isRTL),
                ]}
                onPress={() => handleSelect(cat.key)}
              >
                <View
                  style={[
                    styles.iconBox,
                    { backgroundColor: `${cat.color}20` },
                  ]}
                >
                  <Ionicons name={cat.icon} size={32} color={cat.color} />
                </View>

                <Text style={styles.cardTitle}>{t(cat.titleKey)}</Text>
                <Text style={styles.cardDesc}>{t(cat.descKey)}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </DirectionalScreen>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  scroll: {
    padding: 20,
    paddingTop: 50,
    paddingBottom: 40,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    marginBottom: 10,
  },
  title: {
    fontSize: 30,
    fontWeight: "900",
    textAlign: "center",
    color: "#111827",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#7C5F46",
    textAlign: "center",
    marginBottom: 28,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 16,
  },
  card: {
    width: "48%",
    minHeight: 165,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 18,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  lastCard: {
    width: "48%",
  },
  iconBox: {
    width: 58,
    height: 58,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: "#111827",
    textAlign: "center",
    marginBottom: 8,
  },
  cardDesc: {
    fontSize: 13,
    color: "#7C5F46",
    textAlign: "center",
    lineHeight: 18,
  },
});
