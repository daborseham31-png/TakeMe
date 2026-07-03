import { Feather, Ionicons } from "@expo/vector-icons";
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

export default function WorkErrandScreen() {
  const openWork = () => {
    router.push("/booking/work-errand/work" as any);
  };

  const openErrands = () => {
    router.push("/booking/work-errand/errand/errand" as any);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable style={styles.topBack} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#7A665C" />
        </Pressable>

        <Text style={styles.mainTitle}>What do you need?</Text>

        <Text style={styles.mainSubtitle}>
          Choose the type of ride or service
        </Text>

        <Pressable style={styles.backTextBox} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back to categories</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>Work & Errands</Text>

        <View style={styles.cardsRow}>
          <Pressable style={styles.card} onPress={openWork}>
            <Feather name="briefcase" size={34} color="#22C55E" />

            <Text style={styles.cardTitle}>Work</Text>

            <Text style={styles.cardSubtitle}>
              Find jobs and work opportunities
            </Text>
          </Pressable>

          <Pressable style={styles.card} onPress={openErrands}>
            <Feather name="map-pin" size={34} color="#F97316" />

            <Text style={styles.cardTitle}>Errands</Text>

            <Text style={styles.cardSubtitle}>
              Shopping, appointments, etc.
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
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
  backTextBox: {
    alignSelf: "flex-start",
    marginBottom: 25,
  },
  backText: {
    fontSize: 16,
    color: "#7A5C4B",
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