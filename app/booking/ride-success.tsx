import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import {
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";

export default function RideSuccessScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.iconCircle}>
          <Ionicons name="checkmark-circle" size={72} color="#F58220" />
        </View>

        <Text style={styles.title}>Your ride has been booked successfully</Text>

        <Text style={styles.subtitle}>
          The driver has been notified. You can track the ride status any time
          in My Bookings.
        </Text>

        <View style={styles.buttons}>
          <Pressable
            style={styles.primaryButton}
            onPress={() => router.replace("/(tabs)/bookings" as any)}
          >
            <Ionicons name="bag-handle-outline" size={18} color="#FFFFFF" />
            <Text style={styles.primaryButtonText}>Open My Bookings</Text>
          </Pressable>

          <Pressable
            style={styles.outlineButton}
            onPress={() => router.replace("/(tabs)/home" as any)}
          >
            <Ionicons name="home-outline" size={18} color="#2B2118" />
            <Text style={styles.outlineButtonText}>Back to Home</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#FFF2E8",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
  },
  title: {
    fontSize: 25,
    fontWeight: "900",
    color: "#111827",
    textAlign: "center",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    color: "#7C5F46",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 32,
  },
  buttons: {
    width: "100%",
    gap: 12,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#F58220",
    borderRadius: 16,
    paddingVertical: 16,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 16,
  },
  outlineButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "#D9CDBE",
    borderRadius: 16,
    paddingVertical: 16,
  },
  outlineButtonText: {
    color: "#2B2118",
    fontWeight: "900",
    fontSize: 16,
  },
});
