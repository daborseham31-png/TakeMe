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

import DateInput, { TimeInput } from "../driver/create/DateInput";
import {
  getDayFromDateText,
  normalizeDateToYMD,
  normalizeTime,
  styles as weeklyStyles,
} from "../driver/create/driverHelpers";
import WeeklyDaysCard from "../driver/create/WeeklyDaysCard";
import { validateWeeklyRows, WeekDayRow } from "../booking/weeklyBookingLib";

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

const getTimeMinutes = (timeText: string) => {
  const cleanTime = normalizeTime(timeText);

  if (!cleanTime) return null;

  const [hours, minutes] = cleanTime.split(":").map(Number);

  return hours * 60 + minutes;
};

const isTimeAvailableForDate = (dateText: string, timeText: string) => {
  const cleanDate = normalizeDateToYMD(dateText);
  const cleanTime = normalizeTime(timeText);

  if (!cleanDate || !cleanTime) return false;

  const today = getTodayDate();

  if (cleanDate < today) return false;

  if (cleanDate > today) return true;

  const selectedMinutes = getTimeMinutes(cleanTime);

  if (selectedMinutes === null) return false;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  return selectedMinutes > currentMinutes;
};

export default function PersonalRideScreen() {
  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");

  const [tripDate, setTripDate] = useState(getTodayDate());
  const [showTripDatePicker, setShowTripDatePicker] = useState(false);

  const [tripTime, setTripTime] = useState("09:00");
  const [showTripTimePicker, setShowTripTimePicker] = useState(false);
  const [seats, setSeats] = useState(1);

  const [weeklyBooking, setWeeklyBooking] = useState(false);
  const [weeklyRows, setWeeklyRows] = useState<WeekDayRow[]>([]);

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

  const toggleWeeklyBooking = () => {
    const nextValue = !weeklyBooking;

    setWeeklyBooking(nextValue);

    if (!nextValue) {
      setWeeklyRows([]);
    }
  };

  const decreaseSeats = () => {
    setSeats((prev) => Math.max(1, prev - 1));
  };

  const increaseSeats = () => {
    setSeats((prev) => Math.min(8, prev + 1));
  };

  const handleSearch = () => {
    if (!fromLocation || !toLocation) {
      Alert.alert("Missing details", "Please enter both From and To.");
      return;
    }

    const baseParams: Record<string, string> = {
      category: "personal",
      from: fromLocation.trim(),
      to: toLocation.trim(),
      genderPref,
      languages: selectedLanguages.join(","),
    };

    if (weeklyBooking) {
      const cleanedDays = validateWeeklyRows(weeklyRows, {
        requirePrice: false,
      });

      if (!cleanedDays) return;

      router.push({
        pathname: "/booking/driverresults",
        params: {
          ...baseParams,
          bookingType: "weekly",
          weeklyDays: JSON.stringify(
            cleanedDays.map(({ dayKey, dayName, date, time, seats }) => ({
              dayKey,
              dayName,
              date,
              time,
              seats,
            })),
          ),
        },
      } as any);

      return;
    }

    const cleanDate = normalizeDateToYMD(tripDate);

    if (!cleanDate) {
      Alert.alert(
        "Invalid date",
        "Please choose a valid trip date (today or a future date).",
      );
      return;
    }

    if (cleanDate < getTodayDate()) {
      Alert.alert("Invalid date", "Please choose today or a future date.");
      return;
    }

    const tripDay = getDayFromDateText(cleanDate);

    const cleanTime = normalizeTime(tripTime);

    if (!cleanTime) {
      Alert.alert(
        "Invalid time",
        "Please choose a valid time between 00:00 and 23:59.",
      );
      return;
    }

    if (!isTimeAvailableForDate(cleanDate, cleanTime)) {
      Alert.alert(
        "Invalid time",
        "You cannot book a time that already passed.",
      );
      return;
    }

    if (seats < 1 || seats > 8) {
      Alert.alert("Invalid seats", "Seats must be between 1 and 8.");
      return;
    }

    router.push({
      pathname: "/booking/driverresults",
      params: {
        ...baseParams,
        tripDate: cleanDate,
        tripDay,
        bookForWholeWeek: "false",
        time: cleanTime,
        seats: String(seats),
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

        <View style={styles.header}>
          <Text style={styles.headerEmoji}>🚗</Text>
          <Text style={styles.title}>Personal Ride</Text>
        </View>
        <Text style={styles.subtitle}>Personal trips & visits</Text>

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

          {!weeklyBooking && (
            <>
              <DateInput
                label="Trip Date"
                value={tripDate}
                onChange={setTripDate}
                showPicker={showTripDatePicker}
                setShowPicker={setShowTripDatePicker}
              />

              <View style={styles.twoColumns}>
                <View style={styles.column}>
                  <TimeInput
                    label="Trip Time"
                    value={tripTime}
                    onChange={setTripTime}
                    showPicker={showTripTimePicker}
                    setShowPicker={setShowTripTimePicker}
                    associatedDate={tripDate}
                  />
                </View>

                <View style={styles.column}>
                  <Text style={weeklyStyles.label}>Seats</Text>
                  <View style={styles.seatsRow}>
                    <Pressable style={styles.seatButton} onPress={decreaseSeats}>
                      <Ionicons name="remove" size={20} color="#111827" />
                    </Pressable>

                    <Text style={styles.seatsNumber}>{seats}</Text>

                    <Pressable style={styles.seatButton} onPress={increaseSeats}>
                      <Ionicons name="add" size={20} color="#111827" />
                    </Pressable>
                  </View>
                </View>
              </View>
            </>
          )}

          <Pressable style={styles.weeklyRow} onPress={toggleWeeklyBooking}>
            <Ionicons
              name={weeklyBooking ? "checkbox" : "square-outline"}
              size={20}
              color={weeklyBooking ? "#F58220" : "#8B7B6B"}
            />
            <Ionicons name="calendar-outline" size={16} color="#7C5F46" />
            <Text style={styles.weeklyText}>Book for the whole week</Text>
          </Pressable>

          {weeklyBooking && (
            <View style={styles.weeklyBox}>
              <WeeklyDaysCard
                rows={weeklyRows}
                onChange={setWeeklyRows}
                defaultTime="09:00"
                mode="passenger"
              />
            </View>
          )}
        </View>

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
  weeklyBox: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#E7DCD1",
    paddingTop: 14,
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
