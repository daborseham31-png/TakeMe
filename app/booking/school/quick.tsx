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

const getDigitsOnly = (value: string) => {
  return value.replace(/\D/g, "");
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
  const [childName, setChildName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [tripTime, setTripTime] = useState("07:30");
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
    if (!pickupLocation || !schoolLocation || !childName || !parentPhone) {
      Alert.alert("Missing details", "Please fill in all required fields.");
      return;
    }

    const cleanPhone = getDigitsOnly(parentPhone);

    if (cleanPhone.length !== 10) {
      Alert.alert(
        "Invalid phone number",
        "Phone number must be exactly 10 digits.",
      );
      return;
    }

    const cleanTime = normalizeTime(tripTime);

    if (!cleanTime) {
      Alert.alert(
        "Invalid time",
        "Please enter a valid time between 00:00 and 23:59.",
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
        seats: "1",
        time: cleanTime,
        tripDate: getTodayDate(),
        bookingType: "quick",
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

          <Text style={styles.label}>Child Name</Text>
          <View style={styles.inputRow}>
            <Ionicons name="person-outline" size={18} color="#F58220" />
            <TextInput
              style={styles.input}
              placeholder="Name of the child going to school"
              placeholderTextColor="#8B7B6B"
              value={childName}
              onChangeText={setChildName}
            />
          </View>

          <Text style={styles.label}>Parent Phone Number</Text>
          <View style={styles.inputRow}>
            <Ionicons name="call-outline" size={18} color="#F58220" />
            <TextInput
              style={styles.input}
              placeholder="e.g. 0501234567"
              placeholderTextColor="#8B7B6B"
              keyboardType="phone-pad"
              maxLength={10}
              value={parentPhone}
              onChangeText={(text) =>
                setParentPhone(getDigitsOnly(text).slice(0, 10))
              }
            />
          </View>

          <Text style={styles.label}>Trip Time</Text>
          <View style={styles.timeRow}>
            <TextInput
              style={styles.timeInput}
              placeholder="07:30"
              placeholderTextColor="#8B7B6B"
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              value={tripTime}
              onChangeText={(text) =>
                setTripTime(text.replace(/[^\d:]/g, "").slice(0, 5))
              }
            />
            <Ionicons name="time-outline" size={18} color="#111827" />
          </View>

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
  timeRow: {
    width: 135,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: "#FFFDFC",
  },
  timeInput: {
    flex: 1,
    paddingVertical: 12,
    color: "#111827",
    fontWeight: "700",
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
