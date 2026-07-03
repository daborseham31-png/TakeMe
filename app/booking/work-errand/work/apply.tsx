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

type JobListing = {
  id: number;
  name: string;
  gender: "male" | "female";
  jobTypeEn: string;
  descriptionEn: string;
  hourlyRate: number;
  phone: string;
  workHoursFrom: string;
  workHoursTo: string;
  dayEn: string;
  date: string;
  workersNeeded: number;
  locationEn: string;
  rating: number;
  ratingCount: number;
  languages: string[];
};

const defaultJob: JobListing = {
  id: 1,
  name: "Ahmad Jabarin",
  gender: "male",
  jobTypeEn: "Carpenter",
  descriptionEn: "Looking for a carpenter to help install a full kitchen",
  hourlyRate: 80,
  phone: "050-1234567",
  workHoursFrom: "08:00",
  workHoursTo: "16:00",
  dayEn: "Sunday",
  date: "2026-03-15",
  workersNeeded: 2,
  locationEn: "Nazareth",
  rating: 4.8,
  ratingCount: 23,
  languages: ["ar", "he"],
};

export default function WorkApplyScreen() {
  const params = useLocalSearchParams();

  const job = useMemo(() => {
    try {
      if (typeof params.job === "string") {
        return JSON.parse(params.job) as JobListing;
      }
    } catch {
      return defaultJob;
    }

    return defaultJob;
  }, [params.job]);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [age, setAge] = useState("");
  const [location, setLocation] = useState("");
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState(false);

  const goToCategories = () => {
    router.replace("/booking" as any);
  };

  const handleSubmit = () => {
    const cleanFirstName = firstName.trim();
    const cleanLastName = lastName.trim();
    const cleanAge = age.trim();
    const cleanLocation = location.trim();
    const cleanPhone = phone.replace(/\D/g, "");

    if (
      !cleanFirstName ||
      !cleanLastName ||
      !cleanAge ||
      !cleanLocation ||
      !cleanPhone
    ) {
      Alert.alert("Missing details", "Please fill all fields.");
      return;
    }

    const ageNumber = Number(cleanAge);

    if (!Number.isInteger(ageNumber) || ageNumber < 16 || ageNumber > 80) {
      Alert.alert("Invalid age", "Age must be between 16 and 80.");
      return;
    }

    if (!/^05\d{8}$/.test(cleanPhone)) {
      Alert.alert(
        "Invalid phone number",
        "Phone number must start with 05 and contain 10 digits."
      );
      return;
    }

    setSent(true);

    setTimeout(() => {
      const accepted = Math.random() > 0.3;

      Alert.alert(
        "Employer Response",
        accepted
          ? `Good news! ${job.name} accepted your application.`
          : `${job.name} reviewed your application, but it was not accepted this time.`
      );
    }, 5000);
  };

  if (sent) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.successContainer}>
          <Ionicons name="checkmark-circle-outline" size={96} color="#F58220" />

          <Text style={styles.successTitle}>Application Sent!</Text>

          <Text style={styles.successText}>
            The employer will review your application and get back to you.
          </Text>
       <Pressable
            style={styles.successButton}
            onPress={() => {
                router.dismissAll();
                router.push("/booking/ride-category" as any);
            }}
            >
            <Text style={styles.successButtonText}>Back to Categories</Text>
            </Pressable>

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
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#7A665C" />
          </Pressable>

          <View style={styles.jobCard}>
            <View style={styles.jobHeader}>
              <View style={styles.jobLeft}>
                <Text style={styles.jobName}>{job.name}</Text>

                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{job.jobTypeEn}</Text>
                </View>
              </View>

              <View style={styles.ratingBox}>
                <Ionicons name="star" size={17} color="#F58220" />
                <Text style={styles.ratingText}>{job.rating}</Text>
              </View>
            </View>

            <Text style={styles.description}>{job.descriptionEn}</Text>

            <Text style={styles.price}>₪{job.hourlyRate}/hr</Text>
          </View>

          <Text style={styles.sectionTitle}>Your Details</Text>

          <View style={styles.row}>
            <View style={styles.halfField}>
              <Text style={styles.label}>First Name</Text>
              <TextInput
                style={styles.input}
                value={firstName}
                onChangeText={setFirstName}
                placeholder="e.g. Ahmad"
                placeholderTextColor="#9B7A68"
              />
            </View>

            <View style={styles.halfField}>
              <Text style={styles.label}>Last Name</Text>
              <TextInput
                style={styles.input}
                value={lastName}
                onChangeText={setLastName}
                placeholder="e.g. Khatib"
                placeholderTextColor="#9B7A68"
              />
            </View>
          </View>

          <Text style={styles.label}>Age</Text>
          <TextInput
            style={styles.input}
            value={age}
            onChangeText={setAge}
            keyboardType="number-pad"
            placeholder="e.g. 22"
            placeholderTextColor="#9B7A68"
          />

          <Text style={styles.label}>Your Location</Text>
          <TextInput
            style={styles.input}
            value={location}
            onChangeText={setLocation}
            placeholder="e.g. Nazareth"
            placeholderTextColor="#9B7A68"
          />

          <Text style={styles.label}>Phone Number</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="05X-XXXXXXX"
            placeholderTextColor="#9B7A68"
          />

          <Pressable style={styles.submitButton} onPress={handleSubmit}>
            <Text style={styles.submitText}>Send Application</Text>
          </Pressable>
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
    paddingHorizontal: 22,
    paddingTop: 25,
    paddingBottom: 40,
  },
  backButton: {
    width: 45,
    height: 40,
    justifyContent: "center",
    marginBottom: 8,
  },
  jobCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E4DDD7",
    borderRadius: 14,
    padding: 18,
    marginBottom: 26,
  },
  jobHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  jobLeft: {
    flex: 1,
  },
  jobName: {
    fontSize: 20,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 8,
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "#2F9B95",
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 14,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  ratingBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  ratingText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#111827",
  },
  description: {
    fontSize: 15,
    color: "#7A5C4B",
    lineHeight: 22,
    marginBottom: 10,
  },
  price: {
    fontSize: 16,
    color: "#F58220",
    fontWeight: "900",
  },
  sectionTitle: {
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
  submitButton: {
    backgroundColor: "#F58220",
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 8,
  },
  submitText: {
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
  successButton: {
    backgroundColor: "#F58220",
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  successButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
});