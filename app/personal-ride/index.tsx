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

const WEEK_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const getTodayDate = () => {
  const today = new Date();

  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const cleanTimeInput = (value: string) => {
  return value.replace(/[^\d:]/g, "").slice(0, 5);
};

const cleanDateInput = (value: string) => {
  return value.replace(/[^\d-]/g, "").slice(0, 10);
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

const normalizeDate = (value: string) => {
  const match = value.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0",
  )}`;
};

export default function PersonalRideScreen() {
  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [tripDate, setTripDate] = useState(getTodayDate());
  const [tripTime, setTripTime] = useState("09:00");
  const [seats, setSeats] = useState(1);

  const [weeklyBooking, setWeeklyBooking] = useState(false);

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
    if (!fromLocation || !toLocation) {
      Alert.alert("Missing details", "Please enter both From and To.");
      return;
    }

    const cleanDate = normalizeDate(tripDate);

    if (!cleanDate) {
      Alert.alert(
        "Invalid date",
        "Please enter a valid trip date (YYYY-MM-DD).",
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

    if (seats < 1) {
      Alert.alert("Invalid seats", "Please select at least one seat.");
      return;
    }

    const baseParams: Record<string, string> = {
      category: "personal",
      from: fromLocation.trim(),
      to: toLocation.trim(),
      genderPref,
      languages: selectedLanguages.join(","),
      seats: String(seats),
      tripDate: cleanDate,
    };

    if (weeklyBooking) {
      const dayTimes: Record<string, string> = {};

      for (const day of WEEK_DAYS) {
        dayTimes[day] = cleanTime;
      }

      router.push({
        pathname: "/booking/driverresults",
        params: {
          ...baseParams,
          days: WEEK_DAYS.join(","),
          dayTimes: JSON.stringify(dayTimes),
          bookingType: "weekly",
        },
      } as any);
    } else {
      router.push({
        pathname: "/booking/driverresults",
        params: {
          ...baseParams,
          time: cleanTime,
          bookingType: "quick",
        },
      } as any);
    }
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#7C5F46" />
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.headerEmoji}>🚗</Text>
          <Text style={styles.title}>Personal Ride</Text>
        </View>
        <Text style={styles.subtitle}>Personal trips & visits</Text>

        {/* Trip details */}
        <View style={styles.card}>
          <View style={styles.twoColumns}>
            <View style={styles.column}>
              <Text style={styles.label}>From</Text>
              <View style={styles.inputRow}>
                <Ionicons name="location-outline" size={18} color="#8B7B6B" />
                <TextInput
                  style={styles.rowInput}
                  placeholder="Nazareth"
                  placeholderTextColor="#8B7B6B"
                  value={fromLocation}
                  onChangeText={setFromLocation}
                />
              </View>
            </View>

            <View style={styles.column}>
              <Text style={styles.label}>To</Text>
              <View style={styles.inputRow}>
                <Ionicons name="location-outline" size={18} color="#8B7B6B" />
                <TextInput
                  style={styles.rowInput}
                  placeholder="Haifa"
                  placeholderTextColor="#8B7B6B"
                  value={toLocation}
                  onChangeText={setToLocation}
                />
              </View>
            </View>
          </View>

          <Text style={styles.labelOrange}>
            <Text>📅 </Text>Trip Date
          </Text>
          <View style={styles.timeRowFull}>
            <TextInput
              style={styles.timeInput}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#8B7B6B"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              value={tripDate}
              onChangeText={(text) => setTripDate(cleanDateInput(text))}
            />
            <Ionicons name="calendar-outline" size={18} color="#111827" />
          </View>

          <View style={styles.twoColumns}>
            <View style={styles.column}>
              <Text style={styles.labelOrange}>
                <Text>🕐 </Text>Trip Time
              </Text>
              <View style={styles.timeRowFull}>
                <TextInput
                  style={styles.timeInput}
                  placeholder="09:00"
                  placeholderTextColor="#8B7B6B"
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                  value={tripTime}
                  onChangeText={(text) => setTripTime(cleanTimeInput(text))}
                />
                <Ionicons name="time-outline" size={18} color="#111827" />
              </View>
            </View>

            <View style={styles.column}>
              <Text style={styles.label}>Seats</Text>
              <View style={styles.seatsRow}>
                <Pressable
                  style={styles.seatButton}
                  onPress={() => setSeats(Math.max(1, seats - 1))}
                >
                  <Ionicons name="remove" size={20} color="#111827" />
                </Pressable>

                <Text style={styles.seatsNumber}>{seats}</Text>

                <Pressable
                  style={styles.seatButton}
                  onPress={() => setSeats(Math.min(8, seats + 1))}
                >
                  <Ionicons name="add" size={20} color="#111827" />
                </Pressable>
              </View>
            </View>
          </View>

          <Pressable
            style={styles.weeklyRow}
            onPress={() => setWeeklyBooking(!weeklyBooking)}
          >
            <Ionicons
              name={weeklyBooking ? "checkbox" : "square-outline"}
              size={20}
              color={weeklyBooking ? "#F58220" : "#8B7B6B"}
            />
            <Ionicons name="calendar-outline" size={16} color="#7C5F46" />
            <Text style={styles.weeklyText}>
              Book for the whole week (optional)
            </Text>
          </Pressable>
        </View>

        {/* Driver Preferences */}
        <View style={styles.card}>
          <View style={styles.prefTitleRow}>
            <Ionicons name="person-outline" size={18} color="#F58220" />
            <Text style={styles.sectionTitle}>Driver Preferences</Text>
          </View>

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
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerEmoji: {
    fontSize: 26,
  },
  title: {
    fontSize: 30,
    fontWeight: "900",
    color: "#111827",
  },
  subtitle: {
    fontSize: 15,
    color: "#7C5F46",
    marginTop: 6,
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
  prefTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  twoColumns: {
    flexDirection: "row",
    gap: 12,
  },
  column: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 8,
    marginTop: 10,
  },
  labelOrange: {
    fontSize: 14,
    fontWeight: "800",
    color: "#F58220",
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
  rowInput: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    color: "#111827",
  },
  timeRowFull: {
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
  seatsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: "#FFFDFC",
  },
  seatButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  seatsNumber: {
    fontSize: 20,
    fontWeight: "900",
    color: "#111827",
    minWidth: 28,
    textAlign: "center",
  },
  weeklyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
  },
  weeklyText: {
    fontWeight: "800",
    color: "#111827",
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
