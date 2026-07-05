import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { TimeInput } from "../../driver/create/DateInput";

const LANGUAGES_LIST = [
  { key: "ar", label: "العربية" },
  { key: "he", label: "עברית" },
  { key: "en", label: "English" },
  { key: "ru", label: "Русский" },
];

const getTodayDate = () => {
  const today = new Date();

  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const normalizeTime = (value: string) => {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);

  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours < 0 || hours > 23) return null;
  if (minutes < 0 || minutes > 59) return null;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0",
  )}`;
};

export default function SchoolQuickBookingScreen() {
  const [pickupLocation, setPickupLocation] = useState("");
  const [schoolLocation, setSchoolLocation] = useState("");
  const [seatsNeeded, setSeatsNeeded] = useState(1);

  const [tripTime, setTripTime] = useState("07:30");
  const [showTripTimePicker, setShowTripTimePicker] = useState(false);

  const [needReturn, setNeedReturn] = useState(false);

  const [genderPref, setGenderPref] = useState<"any" | "male" | "female">(
    "any",
  );

  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);

  const toggleLanguage = (lang: string) => {
    if (selectedLanguages.includes(lang)) {
      setSelectedLanguages(selectedLanguages.filter((item) => item !== lang));
    } else {
      setSelectedLanguages([...selectedLanguages, lang]);
    }
  };

  const handleSearch = () => {
    if (!pickupLocation || !schoolLocation) {
      Alert.alert("Missing details", "Please fill in all required fields.");
      return;
    }

    if (seatsNeeded < 1 || seatsNeeded > 8) {
      Alert.alert("Invalid seats", "Seats needed must be between 1 and 8.");
      return;
    }

    const cleanTime = normalizeTime(tripTime);

    if (!cleanTime) {
      Alert.alert(
        "Invalid time",
        "Please choose a valid time between 00:00 and 23:59.",
      );
      return;
    }

    router.push({
      pathname: "/booking/driverresults",
      params: {
        category: "school",
        from: pickupLocation,
        to: schoolLocation,
        genderPref,
        languages: selectedLanguages.join(","),
        seats: String(seatsNeeded),
        time: cleanTime,
        tripDate: getTodayDate(),
        bookingType: "quick",
        needReturn: String(needReturn),
      },
    } as any);
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#7C5F46" />
        </Pressable>

        <Text style={styles.title}>⚡ Quick Booking</Text>
        <Text style={styles.subtitle}>Book a one-time ride right now</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Pickup Location</Text>
          <View style={styles.inputRow}>
            <Ionicons name="location-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.input}
              placeholder="Your home address"
              placeholderTextColor="#8B7B6B"
              value={pickupLocation}
              onChangeText={setPickupLocation}
            />
          </View>

          <Text style={styles.label}>School Location</Text>
          <View style={styles.inputRow}>
            <Ionicons name="location-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.input}
              placeholder="School address"
              placeholderTextColor="#8B7B6B"
              value={schoolLocation}
              onChangeText={setSchoolLocation}
            />
          </View>

          <Text style={styles.label}>Seats</Text>
          <View style={styles.seatsRow}>
            <Pressable
              style={styles.seatButton}
              onPress={() => setSeatsNeeded(Math.max(1, seatsNeeded - 1))}
            >
              <Ionicons name="remove" size={20} color="#111827" />
            </Pressable>

            <Text style={styles.seatsNumber}>{seatsNeeded}</Text>

            <Pressable
              style={styles.seatButton}
              onPress={() => setSeatsNeeded(Math.min(8, seatsNeeded + 1))}
            >
              <Ionicons name="add" size={20} color="#111827" />
            </Pressable>
          </View>

          <TimeInput
            label="Trip Time"
            value={tripTime}
            onChange={setTripTime}
            showPicker={showTripTimePicker}
            setShowPicker={setShowTripTimePicker}
          />

          <Text style={styles.label}>Need a return trip?</Text>
          <View style={styles.optionRow}>
            <Pressable
              style={[
                styles.optionButton,
                needReturn && styles.optionButtonActive,
              ]}
              onPress={() => setNeedReturn(true)}
            >
              <Text
                style={[
                  styles.optionText,
                  needReturn && styles.optionTextActive,
                ]}
              >
                Yes, with return
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.optionButton,
                !needReturn && styles.optionButtonActive,
              ]}
              onPress={() => setNeedReturn(false)}
            >
              <Text
                style={[
                  styles.optionText,
                  !needReturn && styles.optionTextActive,
                ]}
              >
                No, one way only
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Driver Preferences</Text>

          <Text style={styles.label}>Driver Gender</Text>
          <View style={styles.optionRow}>
            <Pressable
              style={[
                styles.optionButton,
                genderPref === "any" && styles.optionButtonActive,
              ]}
              onPress={() => setGenderPref("any")}
            >
              <Text
                style={[
                  styles.optionText,
                  genderPref === "any" && styles.optionTextActive,
                ]}
              >
                Any
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.optionButton,
                genderPref === "male" && styles.optionButtonActive,
              ]}
              onPress={() => setGenderPref("male")}
            >
              <Text
                style={[
                  styles.optionText,
                  genderPref === "male" && styles.optionTextActive,
                ]}
              >
                Male
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.optionButton,
                genderPref === "female" && styles.optionButtonActive,
              ]}
              onPress={() => setGenderPref("female")}
            >
              <Text
                style={[
                  styles.optionText,
                  genderPref === "female" && styles.optionTextActive,
                ]}
              >
                Female
              </Text>
            </Pressable>
          </View>

          <Text style={styles.label}>Driver speaks</Text>
          <View style={styles.languageRow}>
            {LANGUAGES_LIST.map((lang) => {
              const active = selectedLanguages.includes(lang.key);

              return (
                <Pressable
                  key={lang.key}
                  style={[
                    styles.languageButton,
                    active && styles.languageButtonActive,
                  ]}
                  onPress={() => toggleLanguage(lang.key)}
                >
                  <Text
                    style={[
                      styles.languageText,
                      active && styles.languageTextActive,
                    ]}
                  >
                    {lang.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Pressable style={styles.searchButton} onPress={handleSearch}>
          <Ionicons name="search-outline" size={20} color="#FFFFFF" />
          <Text style={styles.searchText}>Search Drivers</Text>
        </Pressable>
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
    marginBottom: 4,
  },
  title: {
    fontSize: 30,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: "#7C5F46",
    marginBottom: 24,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 8,
    marginTop: 10,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: "#FFFDFC",
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    color: "#111827",
  },

  // نفس حجم وشكل Seats من صفحة Weekly
  seatsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 8,
  },
  seatButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  seatsNumber: {
    fontSize: 22,
    fontWeight: "900",
    color: "#111827",
    minWidth: 28,
    textAlign: "center",
  },

  optionRow: {
    flexDirection: "row",
    gap: 8,
  },
  optionButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  optionButtonActive: {
    backgroundColor: "#F58220",
    borderColor: "#F58220",
  },
  optionText: {
    fontWeight: "800",
    color: "#7C5F46",
    fontSize: 13,
  },
  optionTextActive: {
    color: "#FFFFFF",
  },
  languageRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  languageButton: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#FFFFFF",
  },
  languageButtonActive: {
    backgroundColor: "#F58220",
    borderColor: "#F58220",
  },
  languageText: {
    color: "#7C5F46",
    fontWeight: "700",
  },
  languageTextActive: {
    color: "#FFFFFF",
  },
  searchButton: {
    backgroundColor: "#F58220",
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  searchText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 16,
  },
});
