import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { auth } from "../../firebase";
import { fetchDriverEligibility } from "./driverEligibility";

type Category = {
  key: string;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  background: string;
  route: string;
};

const categories: Category[] = [
  {
    key: "school",
    label: "School Rides",
    description: "Offer student rides",
    icon: "school-outline",
    color: "#3B82F6",
    background: "#EAF2FF",
    route: "/driver/create/school",
  },
  {
    key: "personal",
    label: "Personal Rides",
    description: "Drive people to places",
    icon: "person-outline",
    color: "#EC4899",
    background: "#FDEAF5",
    route: "/driver/create/personal",
  },
  {
    key: "workErrands",
    label: "Work Helpers",
    description: "Post helper work jobs",
    icon: "briefcase-outline",
    color: "#22C55E",
    background: "#EAF9EF",
    route: "/driver/create/work",
  },
  {
    key: "errands",
    label: "Errands",
    description: "Offer errands with others",
    icon: "location-outline",
    color: "#F58220",
    background: "#FFF2E8",
    route: "/driver/create/errand",
  },
  {
    key: "delivery",
    label: "Item Delivery",
    description: "Deliver items or orders",
    icon: "cube-outline",
    color: "#A855F7",
    background: "#F4EAFE",
    route: "/driver/create/delivery",
  },
];

export default function AddDriverRouteScreen() {
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
      .then((result) => {
        if (!result.eligible) {
          router.replace("/driver/verify-license" as any);
          return;
        }

        setChecking(false);
      })
      .catch(() => {
        router.replace("/driver/verify-license" as any);
      });
  }, []);

  if (checking) {
    return (
      <SafeAreaView style={styles.page}>
        <View style={styles.checkingBox}>
          <ActivityIndicator size="large" color="#F58220" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.page}>
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
          <Ionicons name="arrow-back" size={26} color="#7C5F46" />
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.title}>What do you want to offer?</Text>
          <Text style={styles.subtitle}>
            Choose the service you want to provide
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
                    marginLeft: shouldCenterLastCard
                      ? (cardWidth + gap) / 2
                      : 0,
                  },
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
                  <Text style={styles.cardTitle}>{category.label}</Text>
                  <Text style={styles.cardDescription}>
                    {category.description}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
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
    fontSize: 31,
    fontWeight: "900",
    color: "#111827",
    lineHeight: 38,
  },
  subtitle: {
    fontSize: 16,
    color: "#7C5F46",
    fontWeight: "700",
    marginTop: 8,
    lineHeight: 22,
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
