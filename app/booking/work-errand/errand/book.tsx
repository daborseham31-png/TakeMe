import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type Driver = {
  id: number;
  name: string;
  gender: "male" | "female";
  age: number;
  phone: string;
  languages: string[];
  rating: number;
  reviews: number;
  price: number;
  destination: string;
  destinationLabel: string;
  departureTime: string;
  returnTime: string;
  date: string;
  day: string;
  location: string;
  seats: number;
};

const LANGUAGES_MAP: Record<string, string> = {
  ar: "العربية",
  he: "עברית",
  en: "English",
  ru: "Русский",
};

const DESTINATION_ICONS: Record<string, string> = {
  shopping: "🛒",
  nature: "🌿",
  beach: "🏖️",
  restaurant: "🍽️",
  hospital: "🏥",
  mall: "🏬",
  gym: "💪",
  pharmacy: "💊",
};

const defaultDriver: Driver = {
  id: 1,
  name: "Layla Mansour",
  gender: "female",
  age: 28,
  phone: "050-1234567",
  languages: ["ar", "he"],
  rating: 4.9,
  reviews: 53,
  price: 20,
  destination: "shopping",
  destinationLabel: "Shopping at Big Mall",
  departureTime: "10:00",
  returnTime: "13:00",
  date: "2026-03-14",
  day: "Sat",
  location: "Nazareth",
  seats: 3,
};

export default function ErrandsBookScreen() {
  const params = useLocalSearchParams();

  const driver = useMemo(() => {
    try {
      if (typeof params.driver === "string") {
        return JSON.parse(params.driver) as Driver;
      }
    } catch {
      return defaultDriver;
    }

    return defaultDriver;
  }, [params.driver]);

  const [submitted, setSubmitted] = useState(false);

  const [fullName, setFullName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [age, setAge] = useState("");
  const [location, setLocation] = useState("");

  const handleSubmit = () => {
    const cleanFullName = fullName.trim();
    const cleanFamilyName = familyName.trim();
    const cleanAge = age.trim();
    const cleanLocation = location.trim();

    if (!cleanFullName || !cleanFamilyName || !cleanAge || !cleanLocation) {
      Alert.alert("Missing details", "Please fill all fields.");
      return;
    }

    const ageNumber = Number(cleanAge);

    if (!Number.isInteger(ageNumber) || ageNumber < 10 || ageNumber > 99) {
      Alert.alert("Invalid age", "Age must be between 10 and 99.");
      return;
    }

    setSubmitted(true);
  };

  if (submitted) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.successContainer}>
          <Ionicons name="checkmark-circle-outline" size={90} color="#F58220" />

          <Text style={styles.successTitle}>Request Sent!</Text>

          <Text style={styles.successText}>
            Your request has been sent to{" "}
            <Text style={styles.boldText}>{driver.name}</Text>. They will
            contact you soon.
          </Text>

          <View style={styles.successButtonsRow}>
            <Pressable
              style={styles.outlineButton}
              onPress={() =>
                router.replace("/booking/work-errand/errand/errand" as any)
              }
            >
              <Text style={styles.outlineButtonText}>Browse More</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.container}>
          <Pressable
            style={styles.backButton}
            onPress={() =>
              router.push("/booking/work-errand/errand/errand" as any)
            }
          >
            <Ionicons name="arrow-back" size={20} color="#7A665C" />
            <Text style={styles.backText}>Back</Text>
          </Pressable>

          <View style={styles.driverCard}>
            <View style={styles.driverHeader}>
              <View style={styles.avatar}>
                <Ionicons name="person-outline" size={26} color="#B45309" />
              </View>

              <View style={styles.driverInfo}>
                <Text style={styles.driverName}>{driver.name}</Text>

                <View style={styles.smallInfoRow}>
                  <Text style={styles.smallText}>
                    {driver.gender === "male" ? "♂" : "♀"} Age {driver.age}
                  </Text>

                  <Text style={styles.smallText}>•</Text>

                  <Ionicons name="star" size={14} color="#F58220" />

                  <Text style={styles.smallText}>{driver.rating}</Text>
                </View>
              </View>
            </View>

            <View style={styles.destinationBox}>
              <Text style={styles.destinationIcon}>
                {DESTINATION_ICONS[driver.destination] || "📍"}
              </Text>

              <Text style={styles.destinationText}>
                {driver.destinationLabel}
              </Text>
            </View>

            <View style={styles.detailsGrid}>
              <View style={styles.detailItem}>
                <Ionicons name="calendar-outline" size={16} color="#F58220" />
                <Text style={styles.detailText}>
                  {driver.date} ({driver.day})
                </Text>
              </View>

              <View style={styles.detailItem}>
                <Ionicons name="time-outline" size={16} color="#F58220" />
                <Text style={styles.detailText}>
                  {driver.departureTime} → {driver.returnTime}
                </Text>
              </View>

              <View style={styles.detailItem}>
                <Ionicons name="location-outline" size={16} color="#F58220" />
                <Text style={styles.detailText}>{driver.location}</Text>
              </View>

              <View style={styles.detailItem}>
                <Text style={styles.price}>{driver.price} ₪</Text>
              </View>
            </View>

            <View style={styles.languagesRow}>
              {driver.languages?.map((lang) => (
                <View key={lang} style={styles.languageBadge}>
                  <Text style={styles.languageText}>{LANGUAGES_MAP[lang]}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.formCard}>
            <Text style={styles.formTitle}>✈️ Your Details</Text>

            <View style={styles.row}>
              <View style={styles.halfField}>
                <Text style={styles.label}>First Name</Text>
                <TextInput
                  style={styles.input}
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder="e.g. Ahmad"
                  placeholderTextColor="#9B7A68"
                  maxLength={50}
                />
              </View>

              <View style={styles.halfField}>
                <Text style={styles.label}>Family Name</Text>
                <TextInput
                  style={styles.input}
                  value={familyName}
                  onChangeText={setFamilyName}
                  placeholder="e.g. Hassan"
                  placeholderTextColor="#9B7A68"
                  maxLength={50}
                />
              </View>
            </View>

            <View style={styles.row}>
              <View style={styles.halfField}>
                <Text style={styles.label}>Age</Text>
                <TextInput
                  style={styles.input}
                  value={age}
                  onChangeText={setAge}
                  placeholder="e.g. 25"
                  placeholderTextColor="#9B7A68"
                  keyboardType="number-pad"
                />
              </View>

              <View style={styles.halfField}>
                <Text style={styles.label}>Your Location</Text>

                <View style={styles.locationInputBox}>
                  <Ionicons name="location-outline" size={17} color="#7A665C" />

                  <TextInput
                    style={styles.locationInput}
                    value={location}
                    onChangeText={setLocation}
                    placeholder="e.g. Nazareth"
                    placeholderTextColor="#9B7A68"
                    maxLength={100}
                  />
                </View>
              </View>
            </View>

            <Pressable style={styles.sendButton} onPress={handleSubmit}>
              <Ionicons name="paper-plane-outline" size={19} color="#FFFFFF" />
              <Text style={styles.sendButtonText}>Send Request</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  keyboard: {
    flex: 1,
  },
  container: {
    paddingHorizontal: 20,
    paddingTop: 30,
    paddingBottom: 40,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    marginBottom: 20,
  },
  backText: {
    fontSize: 16,
    color: "#7A665C",
  },
  driverCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E4DDD7",
    borderRadius: 14,
    padding: 18,
    marginBottom: 24,
  },
  driverHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#FFF3E6",
    alignItems: "center",
    justifyContent: "center",
  },
  driverInfo: {
    flex: 1,
  },
  driverName: {
    fontSize: 20,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 4,
  },
  smallInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  smallText: {
    fontSize: 14,
    color: "#7A5C4B",
  },
  destinationBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#F5F1ED",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  destinationIcon: {
    fontSize: 22,
  },
  destinationText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#111827",
  },
  detailsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 12,
    marginBottom: 14,
  },
  detailItem: {
    width: "50%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingRight: 6,
  },
  detailText: {
    fontSize: 14,
    color: "#111827",
    flexShrink: 1,
  },
  price: {
    fontSize: 15,
    color: "#111827",
    fontWeight: "900",
  },
  languagesRow: {
    flexDirection: "row",
    gap: 7,
    flexWrap: "wrap",
  },
  languageBadge: {
    backgroundColor: "#2F9B95",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  languageText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  formCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E4DDD7",
    borderRadius: 14,
    padding: 18,
  },
  formTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 18,
  },
  row: {
    flexDirection: "row",
    gap: 14,
  },
  halfField: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 8,
    marginTop: 10,
  },
  input: {
    height: 46,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E4DDD7",
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    color: "#111827",
    marginBottom: 10,
  },
  locationInputBox: {
    height: 46,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E4DDD7",
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 10,
  },
  locationInput: {
    flex: 1,
    fontSize: 15,
    color: "#111827",
  },
  sendButton: {
    backgroundColor: "#F58220",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
  },
  sendButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  successContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  successTitle: {
    fontSize: 26,
    fontWeight: "900",
    color: "#111827",
    marginTop: 18,
    marginBottom: 10,
  },
  successText: {
    fontSize: 16,
    color: "#7A5C4B",
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 26,
  },
  boldText: {
    fontWeight: "900",
    color: "#111827",
  },
  successButtonsRow: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
    flexWrap: "wrap",
  },
  outlineButton: {
    borderWidth: 1,
    borderColor: "#E4DDD7",
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 18,
  },
  outlineButtonText: {
    color: "#111827",
    fontSize: 15,
    fontWeight: "900",
  },
  successButton: {
    backgroundColor: "#F58220",
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 18,
  },
  successButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
});
