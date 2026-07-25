import { Feather, Ionicons } from "@expo/vector-icons";
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

import { DirectionalScreen } from "../../i18n/DirectionalPrimitives";
import { useLanguage } from "../../i18n/LanguageProvider";
import { backIconName } from "../../i18n/rtl";

export default function WorkErrandScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();

  const openWork = () => {
    router.push("/booking/work-errand/work" as any);
  };

  const openErrands = () => {
    router.push("/booking/work-errand/errand/errand" as any);
  };

  return (
    <DirectionalScreen style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable style={styles.topBack} onPress={() => router.back()}>
          <Ionicons name={backIconName(isRTL)} size={24} color="#7A665C" />
        </Pressable>

        <Text style={styles.mainTitle}>{t("rideCategory.title")}</Text>

        <Text style={styles.mainSubtitle}>{t("rideCategory.subtitle")}</Text>

        <View style={styles.cardsRow}>
          <Pressable style={styles.card} onPress={openWork}>
            <Feather name="briefcase" size={34} color="#22C55E" />

            <Text style={styles.cardTitle}>{t("workErrand.workTitle")}</Text>

            <Text style={styles.cardSubtitle}>
              {t("workErrand.workSubtitle")}
            </Text>
          </Pressable>

          <Pressable style={styles.card} onPress={openErrands}>
            <Feather name="map-pin" size={34} color="#F97316" />

            <Text style={styles.cardTitle}>{t("workErrand.errandsTitle")}</Text>

            <Text style={styles.cardSubtitle}>
              {t("workErrand.errandsSubtitle")}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </DirectionalScreen>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 35,
    paddingBottom: 40,
  },
  topBack: {
    width: 40,
    height: 40,
    justifyContent: "center",
    marginBottom: 10,
  },
  mainTitle: {
    fontSize: 31,
    fontWeight: "900",
    color: "#111827",
    textAlign: "center",
    marginTop: 10,
  },
  mainSubtitle: {
    fontSize: 18,
    color: "#7A5C4B",
    textAlign: "center",
    marginTop: 12,
    marginBottom: 42,
  },

  sectionTitle: {
    fontSize: 24,
    fontWeight: "900",
    color: "#111827",
    textAlign: "center",
    marginBottom: 24,
  },
  cardsRow: {
    flexDirection: "row",
    gap: 20,
    justifyContent: "center",
    flexWrap: "wrap",
  },
  card: {
    width: 295,
    height: 195,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E4DDD7",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    marginBottom: 18,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: "#111827",
    marginTop: 24,
    marginBottom: 12,
  },
  cardSubtitle: {
    fontSize: 15,
    color: "#7A5C4B",
    textAlign: "center",
    lineHeight: 22,
  },
});
