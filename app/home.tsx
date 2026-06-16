import React from "react";
import {
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";

const logoImg = require("../assets/images/logo-new.jpg");

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.hero}>
        <Image source={logoImg} style={styles.logo} />

        <Text style={styles.title}>Take Me</Text>

        <View style={styles.badge}>
          <Text style={styles.badgeText}>🚗 Community Rides & Deliveries</Text>
        </View>

        <Text style={styles.description}>
          Connect with neighbors heading your way. Safe, affordable rides and
          deliveries for your community.
        </Text>

        <Pressable style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>🔍 Find a Ride</Text>
        </Pressable>

        <Pressable style={styles.outlineButton}>
          <Text style={styles.outlineButtonText}>Become a Driver →</Text>
        </Pressable>

        <Pressable style={styles.ghostButton}>
          <Text style={styles.ghostButtonText}>❓ Forgot Something?</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#F8F2EA",
  },
  hero: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  logo: {
    width: 170,
    height: 170,
    borderRadius: 85,
    marginBottom: 24,
  },
  title: {
    fontSize: 56,
    fontWeight: "900",
    color: "#F39C2D",
    marginBottom: 14,
  },
  badge: {
    backgroundColor: "#FFF2E2",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 30,
    marginBottom: 24,
  },
  badgeText: {
    color: "#B86115",
    fontWeight: "700",
    fontSize: 15,
  },
  description: {
    textAlign: "center",
    fontSize: 20,
    lineHeight: 30,
    color: "#6B7280",
    marginBottom: 35,
  },
  primaryButton: {
    width: "100%",
    backgroundColor: "#F28C28",
    paddingVertical: 18,
    borderRadius: 18,
    marginBottom: 14,
  },
  primaryButtonText: {
    textAlign: "center",
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 18,
  },
  outlineButton: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "#D9CDBE",
    paddingVertical: 18,
    borderRadius: 18,
    marginBottom: 14,
  },
  outlineButtonText: {
    textAlign: "center",
    color: "#2B2118",
    fontWeight: "800",
    fontSize: 18,
  },
  ghostButton: {
    paddingVertical: 12,
  },
  ghostButtonText: {
    color: "#7A6A5A",
    fontWeight: "700",
    fontSize: 17,
  },
});
