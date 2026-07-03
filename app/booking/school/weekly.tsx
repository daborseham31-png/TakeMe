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

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

const cleanTimeInput = (value: string) => {
  return value.replace(/[^\d:]/g, "").slice(0, 5);
};

export default function SchoolWeeklyBookingScreen() {
  const [schoolName, setSchoolName] = useState("");
  const [pickupLocation, setPickupLocation] = useState("");
  const [schoolLocation, setSchoolLocation] = useState("");
  const [seats, setSeats] = useState(1);

  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [dayTimes, setDayTimes] = useState<Record<string, string>>({});

  const [genderPref, setGenderPref] = useState<"any" | "male" | "female">(
    "any",
  );

  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);

  const toggleDay = (day: string) => {
    if (selectedDays.includes(day)) {
      setSelectedDays(selectedDays.filter((item) => item !== day));

      const newTimes = { ...dayTimes };
      delete newTimes[day];
      setDayTimes(newTimes);
    } else {
      setSelectedDays([...selectedDays, day]);
      setDayTimes({ ...dayTimes, [day]: "07:30" });
    }
  };

  const toggleLanguage = (lang: string) => {
    if (selectedLanguages.includes(lang)) {
      setSelectedLanguages(selectedLanguages.filter((item) => item !== lang));
    } else {
      setSelectedLanguages([...selectedLanguages, lang]);
    }
  };

  const handleSearch = () => {
    if (!schoolName || !pickupLocation || !schoolLocation) {
      Alert.alert("Missing details", "Please fill in all required fields.");
      return;
    }

    if (selectedDays.length === 0) {
      Alert.alert("Missing days", "Please choose at least one day.");
      return;
    }

    const cleanedDayTimes: Record<string, string> = {};

    for (const day of selectedDays) {
      const timeValue = dayTimes[day] || "";
      const cleanTime = normalizeTime(timeValue);

      if (!cleanTime) {
        Alert.alert(
          "Invalid time",
          `Please enter a valid time for ${day} between 00:00 and 23:59.`,
        );
        return;
      }

      cleanedDayTimes[day] = cleanTime;
    }

    router.push({
      pathname: "/booking/driverresults",
      params: {
        category: "school",
        from: pickupLocation.trim(),
        to: schoolLocation.trim(),
        genderPref,
        languages: selectedLanguages.join(","),
        seats: String(seats),
        days: selectedDays.join(","),
        dayTimes: JSON.stringify(cleanedDayTimes),
        bookingType: "weekly",
      },
    } as any);
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#7C5F46" />
        </Pressable>

        <Text style={styles.title}>🗓️ Weekly Booking</Text>
        <Text style={styles.subtitle}>
          Book rides for the entire week with custom times
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>School / University Name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Nazareth Academic Institute"
            placeholderTextColor="#8B7B6B"
            value={schoolName}
            onChangeText={setSchoolName}
          />

          <View style={styles.twoColumns}>
            <View style={styles.column}>
              <Text style={styles.label}>Pickup Location</Text>
              <View style={styles.inputRow}>
                <Ionicons name="location-outline" size={18} color="#8B7B6B" />
                <TextInput
                  style={styles.rowInput}
                  placeholder="Your home address"
                  placeholderTextColor="#8B7B6B"
                  value={pickupLocation}
                  onChangeText={setPickupLocation}
                />
              </View>
            </View>

            <View style={styles.column}>
              <Text style={styles.label}>School Location</Text>
              <View style={styles.inputRow}>
                <Ionicons name="location-outline" size={18} color="#8B7B6B" />
                <TextInput
                  style={styles.rowInput}
                  placeholder="School address"
                  placeholderTextColor="#8B7B6B"
                  value={schoolLocation}
                  onChangeText={setSchoolLocation}
                />
              </View>
            </View>
          </View>

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

          <Text style={styles.label}>Select Days</Text>
          <View style={styles.daysRow}>
            {DAYS.map((day) => {
              const active = selectedDays.includes(day);

              return (
                <Pressable
                  key={day}
                  style={[styles.dayButton, active && styles.dayButtonActive]}
                  onPress={() => toggleDay(day)}
                >
                  <Text
                    style={[styles.dayText, active && styles.dayTextActive]}
                  >
                    {day}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {selectedDays.length > 0 && (
            <View style={styles.timesBox}>
              {selectedDays.map((day) => (
                <View key={day} style={styles.dayTimeRow}>
                  <Text style={styles.dayTimeLabel}>{day}</Text>

                  <TextInput
                    style={styles.timeInput}
                    value={dayTimes[day] || "07:30"}
                    onChangeText={(text) =>
                      setDayTimes({
                        ...dayTimes,
                        [day]: cleanTimeInput(text),
                      })
                    }
                    placeholder="07:30"
                    placeholderTextColor="#8B7B6B"
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                  />
                </View>
              ))}
            </View>
          )}
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
  label: {
    fontSize: 14,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 8,
    marginTop: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    padding: 14,
    backgroundColor: "#FFFDFC",
    color: "#111827",
  },
  twoColumns: {
    flexDirection: "row",
    gap: 12,
  },
  column: {
    flex: 1,
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
  daysRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  dayButton: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#FFFFFF",
  },
  dayButtonActive: {
    backgroundColor: "#F58220",
    borderColor: "#F58220",
  },
  dayText: {
    color: "#7C5F46",
    fontWeight: "800",
  },
  dayTextActive: {
    color: "#FFFFFF",
  },
  timesBox: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#E7DCD1",
    paddingTop: 12,
    gap: 10,
  },
  dayTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  dayTimeLabel: {
    width: 45,
    fontWeight: "900",
    color: "#111827",
  },
  timeInput: {
    width: 120,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    padding: 12,
    backgroundColor: "#FFFDFC",
    color: "#111827",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 8,
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
