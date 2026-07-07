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

type DeliveryOption = {
  key: string;
  title: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  route: string;
};

const OPTIONS: DeliveryOption[] = [
  {
    key: "deliver-item",
    title: "Deliver Item",
    desc: "Send an item from one person to another",
    icon: "cube-outline",
    iconColor: "#A855F7",
    iconBg: "#F3E8FF",
    route: "/item-delivery/deliver-item",
  },
  {
    key: "store-delivery",
    title: "Store Delivery",
    desc: "Bring items from a store or supermarket",
    icon: "storefront-outline",
    iconColor: "#F58220",
    iconBg: "#FFF3E8",
    route: "/item-delivery/store-delivery",
  },
];

export default function ItemDeliverySelectionScreen() {
  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#7C5F46" />
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.title}>Item Delivery</Text>
          <Text style={styles.subtitle}>What would you like to offer?</Text>

          {OPTIONS.map((option) => (
            <Pressable
              key={option.key}
              style={styles.optionCard}
              onPress={() => router.push(option.route as any)}
            >
              <View
                style={[styles.iconBox, { backgroundColor: option.iconBg }]}
              >
                <Ionicons
                  name={option.icon}
                  size={26}
                  color={option.iconColor}
                />
              </View>

              <View style={styles.optionTextBox}>
                <Text style={styles.optionTitle}>{option.title}</Text>
                <Text style={styles.optionDesc}>{option.desc}</Text>
              </View>
            </Pressable>
          ))}
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
    paddingTop: 50,
    paddingBottom: 40,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    marginBottom: 16,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 20,
    padding: 22,
  },
  title: {
    fontSize: 30,
    fontWeight: "900",
    color: "#111827",
    textAlign: "center",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 16,
    color: "#7C5F46",
    textAlign: "center",
    marginBottom: 22,
  },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    backgroundColor: "#FFFDFC",
  },
  iconBox: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  optionTextBox: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 4,
  },
  optionDesc: {
    fontSize: 14,
    color: "#7C5F46",
    lineHeight: 19,
  },
});
