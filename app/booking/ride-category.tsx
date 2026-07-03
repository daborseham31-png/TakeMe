import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

type Category = {
  key: string;
  title: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
};

const categories: Category[] = [
  {
    key: "school",
    title: "School",
    desc: "Rides to school or university",
    icon: "school-outline",
    color: "#3B82F6",
  },
  {
    key: "workErrands",
    title: "Work & Errands",
    desc: "Jobs, shopping, appointments",
    icon: "briefcase-outline",
    color: "#22C55E",
  },
  {
    key: "personal",
    title: "Personal Ride",
    desc: "Personal trips & visits",
    icon: "person-outline",
    color: "#EC4899",
  },
  {
    key: "delivery",
    title: "Item Delivery",
    desc: "Medicine, groceries, packages",
    icon: "cube-outline",
    color: "#A855F7",
  },
  {
    key: "help",
    title: "Roadside Help",
    desc: "Flat tire, jump start, towing",
    icon: "construct-outline",
    color: "#EF4444",
  },
];

export default function RideCategoryScreen() {
  const handleSelect = (key: string) => {
    const routes: Record<string, string> = {
      school: "/school-ride",
      workErrands: "/booking/work-errand",
      personal: "/personal-ride",
      delivery: "/item-delivery",
      help: "/roadside-help",
    };

    router.push(routes[key] as any);
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>What do you need?</Text>

        <Text style={styles.subtitle}>Choose the type of ride or service</Text>

        <View style={styles.grid}>
          {categories.map((cat, index) => {
            const isLastOdd =
              index === categories.length - 1 && categories.length % 2 !== 0;

            return (
              <Pressable
                key={cat.key}
                style={[styles.card, isLastOdd && styles.lastCard]}
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

                <Text style={styles.cardTitle}>{cat.title}</Text>
                <Text style={styles.cardDesc}>{cat.desc}</Text>
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
  scroll: {
    padding: 20,
    paddingTop: 60,
    paddingBottom: 40,
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
    marginLeft: "26%",
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
