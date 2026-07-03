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

export default function SchoolRideScreen() {
  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#7C5F46" />
        </Pressable>

        <Text style={styles.title}>🎒 School Ride</Text>
        <Text style={styles.subtitle}>Book a ride to school or university</Text>

        <View style={styles.cardsRow}>
          <Pressable
            style={styles.card}
            onPress={() => router.push("/booking/school/quick" as any)}
          >
            <View style={styles.iconBox}>
              <Ionicons name="flash-outline" size={34} color="#F58220" />
            </View>

            <Text style={styles.cardTitle}>Quick Booking</Text>
            <Text style={styles.cardDesc}>Book a one-time ride right now</Text>
          </Pressable>

          <Pressable
            style={styles.card}
            onPress={() => router.push("/booking/school/weekly" as any)}
          >
            <View style={styles.iconBox}>
              <Ionicons name="calendar-outline" size={34} color="#F58220" />
            </View>

            <Text style={styles.cardTitle}>Weekly Booking</Text>
            <Text style={styles.cardDesc}>
              Book rides for the entire week with custom times
            </Text>
          </Pressable>
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
    padding: 24,
    paddingTop: 55,
    paddingBottom: 40,
  },
  backButton: {
    width: 42,
    height: 42,
    justifyContent: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 32,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: "#7C5F46",
    marginBottom: 32,
  },
  cardsRow: {
    flexDirection: "row",
    gap: 16,
  },
  card: {
    flex: 1,
    minHeight: 210,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 18,
    padding: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBox: {
    width: 70,
    height: 70,
    borderRadius: 18,
    backgroundColor: "#FFF2E8",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: "#111827",
    textAlign: "center",
    marginBottom: 10,
  },
  cardDesc: {
    fontSize: 14,
    color: "#7C5F46",
    textAlign: "center",
    lineHeight: 20,
  },
});
