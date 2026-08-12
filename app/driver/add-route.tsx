import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Alert } from "../AppAlert";

import { useTranslation } from "react-i18next";

import { auth } from "../../firebase";
import { getDriverSuspensionBlockedReason } from "../booking/driverViolationsLib";
import { DirectionalScreen } from "../i18n/DirectionalPrimitives";
import { useLanguage } from "../i18n/LanguageProvider";
import { marginStart } from "../i18n/rtl";
import { fetchDriverEligibility, getDriverEligibilityAlertCopy } from "./driverEligibility";

type Category = {
  key: string;
  labelKey: string;
  descriptionKey: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  background: string;
  route: string;
};

const categories: Category[] = [
  {
    key: "school",
    labelKey: "driverCreate.schoolRidesLabel",
    descriptionKey: "driverCreate.schoolRidesDesc",
    icon: "school-outline",
    color: "#3B82F6",
    background: "#EAF2FF",
    route: "/driver/create/school",
  },
  {
    key: "personal",
    labelKey: "driverCreate.personalRidesLabel",
    descriptionKey: "driverCreate.personalRidesDesc",
    icon: "person-outline",
    color: "#EC4899",
    background: "#FDEAF5",
    route: "/driver/create/personal",
  },
  {
    key: "workErrands",
    labelKey: "driverCreate.workHelpersLabel",
    descriptionKey: "driverCreate.workHelpersDesc",
    icon: "briefcase-outline",
    color: "#22C55E",
    background: "#EAF9EF",
    route: "/driver/create/work",
  },
  {
    key: "errands",
    labelKey: "driverCreate.errandsLabel",
    descriptionKey: "driverCreate.errandsDesc",
    icon: "location-outline",
    color: "#F58220",
    background: "#FFF2E8",
    route: "/driver/create/errand",
  },
];

export default function AddDriverRouteScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const { width } = useWindowDimensions();

  const pagePadding = 20;
  const gap = 14;

  const columns = width >= 760 ? 3 : width >= 360 ? 2 : 1;

  const cardWidth = (width - pagePadding * 2 - gap * (columns - 1)) / columns;

  // Guard against this route being opened directly (deep link, back
  // navigation, stale bookmark) by a user who isn't a valid driver.
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const user = auth.currentUser;

    if (!user) {
      router.replace("/");
      return;
    }

    fetchDriverEligibility(user.uid)
      .then(async (result) => {
        if (!result.eligible) {
          // "pending_admin_approval"/"rejected"/"suspended" mean the driver
          // ALREADY completed license verification — sending them back to
          // verify-license would wrongly ask them to re-upload it. Show why
          // they're blocked and return them to wherever they came from
          // instead; only the genuine "never verified / expired" statuses
          // still route to verify-license.
          if (
            result.status === "pending_admin_approval" ||
            result.status === "rejected" ||
            result.status === "suspended"
          ) {
            const copy = getDriverEligibilityAlertCopy(result.status, t);
            Alert.alert(copy.title, copy.message);
            router.back();
            return;
          }

          router.replace("/driver/verify-license" as any);
          return;
        }

        const suspensionBlocked = await getDriverSuspensionBlockedReason(user.uid);
        if (suspensionBlocked) {
          Alert.alert(t("driver.accountSuspendedTitle"), suspensionBlocked);
          router.back();
          return;
        }

        setChecking(false);
      })
      .catch(() => {
        router.replace("/driver/verify-license" as any);
      });
  }, [t]);

  if (checking) {
    return (
      <DirectionalScreen style={styles.page}>
        <View style={styles.checkingBox}>
          <ActivityIndicator size="large" color="#F58220" />
        </View>
      </DirectionalScreen>
    );
  }

  return (
    <DirectionalScreen style={styles.page}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingHorizontal: pagePadding,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name={isRTL ? "arrow-forward" : "arrow-back"} size={26} color="#7C5F46" />
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.title}>{t("driverCreate.addRouteTitle")}</Text>
          <Text style={styles.subtitle}>
            {t("driverCreate.addRouteSubtitle")}
          </Text>
        </View>

        <View style={styles.grid}>
          {categories.map((category, index) => {
            const isLastCard = index === categories.length - 1;
            const shouldCenterLastCard =
              columns === 2 && categories.length % 2 === 1 && isLastCard;

            return (
              <Pressable
                key={category.key}
                style={[
                  styles.categoryCard,
                  {
                    width: cardWidth,
                    minHeight: columns === 1 ? 120 : 165,
                  },
                  shouldCenterLastCard &&
                    marginStart((cardWidth + gap) / 2, isRTL),
                ]}
                onPress={() => router.push(category.route as any)}
              >
                <View
                  style={[
                    styles.iconBox,
                    {
                      backgroundColor: category.background,
                    },
                  ]}
                >
                  <Ionicons
                    name={category.icon}
                    size={34}
                    color={category.color}
                  />
                </View>

                <View style={styles.cardTextBox}>
                  <Text style={styles.cardTitle}>{t(category.labelKey)}</Text>
                  <Text style={styles.cardDescription}>
                    {t(category.descriptionKey)}
                  </Text>
                </View>
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
  checkingBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
    paddingTop: 48,
    paddingBottom: 40,
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
    marginBottom: 14,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: "900",
    color: "#111827",
    lineHeight: 32,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    color: "#7C5F46",
    fontWeight: "700",
    marginTop: 8,
    lineHeight: 22,
    textAlign: "center",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
  },
  categoryCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#E7DCD1",
    padding: 16,
    alignItems: "center",
    justifyContent: "center",

    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowRadius: 10,
    elevation: 2,
  },
  iconBox: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  cardTextBox: {
    alignItems: "center",
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 6,
    textAlign: "center",
  },
  cardDescription: {
    fontSize: 12,
    color: "#7C5F46",
    fontWeight: "700",
    lineHeight: 17,
    textAlign: "center",
  },
});
