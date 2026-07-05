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

const WEEK_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

const isTodayTimeStillAvailable = (timeValue: string) => {
  const parts = timeValue.split(":");

  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return false;

  const selectedTime = new Date();
  selectedTime.setHours(hours, minutes, 0, 0);

  const now = new Date();

  return selectedTime.getTime() > now.getTime();
};

export default function RidePersonScreen() {
  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");

  const [tripTime, setTripTime] = useState("09:00");
  const [showTripTimePicker, setShowTripTimePicker] = useState(false);
  const [seats, setSeats] = useState(1);

  const [weeklyBooking, setWeeklyBooking] = useState(false);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [dayTimes, setDayTimes] = useState<Record<string, string>>({});
  const [daySeats, setDaySeats] = useState<Record<string, number>>({});
  const [openWeeklyTimePickerDay, setOpenWeeklyTimePickerDay] = useState<
    string | null
  >(null);

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
      setSelectedDays([]);
      setDayTimes({});
      setDaySeats({});
      setOpenWeeklyTimePickerDay(null);
    }
  };

  const toggleDay = (day: string) => {
    if (selectedDays.includes(day)) {
      setSelectedDays(selectedDays.filter((item) => item !== day));

      const newTimes = { ...dayTimes };
      delete newTimes[day];
      setDayTimes(newTimes);

      const newSeats = { ...daySeats };
      delete newSeats[day];
      setDaySeats(newSeats);

      if (openWeeklyTimePickerDay === day) {
        setOpenWeeklyTimePickerDay(null);
      }

      return;
    }

    setSelectedDays([...selectedDays, day]);
    setDayTimes({ ...dayTimes, [day]: "09:00" });
    setDaySeats({ ...daySeats, [day]: 1 });
  };

  const decreaseSeats = () => {
    setSeats((prev) => Math.max(1, prev - 1));
  };

  const increaseSeats = () => {
    setSeats((prev) => Math.min(8, prev + 1));
  };

  const decreaseSeatsForDay = (day: string) => {
    const currentSeats = daySeats[day] || 1;

    setDaySeats({
      ...daySeats,
      [day]: Math.max(1, currentSeats - 1),
    });
  };

  const increaseSeatsForDay = (day: string) => {
    const currentSeats = daySeats[day] || 1;

    setDaySeats({
      ...daySeats,
      [day]: Math.min(8, currentSeats + 1),
    });
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
      if (selectedDays.length === 0) {
        Alert.alert("Missing days", "Please choose at least one day.");
        return;
      }

      const cleanedDayTimes: Record<string, string> = {};
      const cleanedDaySeats: Record<string, number> = {};

      for (const day of selectedDays) {
        const timeValue = dayTimes[day] || "";
        const cleanTime = normalizeTime(timeValue);

        if (!cleanTime) {
          Alert.alert(
            "Invalid time",
            `Please choose a valid time for ${day} between 00:00 and 23:59.`,
          );
          return;
        }

        const seatsValue = daySeats[day] || 1;

        if (seatsValue < 1 || seatsValue > 8) {
          Alert.alert(
            "Invalid seats",
            `Seats for ${day} must be between 1 and 8.`,
          );
          return;
        }

        cleanedDayTimes[day] = cleanTime;
        cleanedDaySeats[day] = seatsValue;
      }

      const maxSeatsNeeded = Math.max(...Object.values(cleanedDaySeats));

      router.push({
        pathname: "/booking/driverresults",
        params: {
          ...baseParams,
          seats: String(maxSeatsNeeded),
          days: selectedDays.join(","),
          dayTimes: JSON.stringify(cleanedDayTimes),
          daySeats: JSON.stringify(cleanedDaySeats),
          bookingType: "weekly",
        },
      } as any);

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

    if (!isTodayTimeStillAvailable(cleanTime)) {
      Alert.alert(
        "Invalid time",
        "This time has already passed today. Please choose a later time.",
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
        seats: String(seats),
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

        <View style={styles.header}>
          <Text style={styles.headerEmoji}>🚗</Text>
          <Text style={styles.title}>Personal Ride</Text>
        </View>
        <Text style={styles.subtitle}>Personal trips & visits</Text>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Ride Type</Text>

          <View style={styles.rideTypeRow}>
            <Pressable style={[styles.rideTypeBox, styles.rideTypeBoxActive]}>
              <Ionicons name="person-outline" size={22} color="#F58220" />
              <Text style={styles.rideTypeTitle}>Ride (Person)</Text>
              <Text style={styles.rideTypeDesc}>
                Get a ride to your destination
              </Text>
            </Pressable>

            <Pressable
              style={styles.rideTypeBox}
              onPress={() =>
                router.replace("/booking/personal-ride/deliver-item" as any)
              }
            >
              <Ionicons name="cube-outline" size={22} color="#8B7B6B" />
              <Text style={styles.rideTypeTitle}>Deliver Item</Text>
              <Text style={styles.rideTypeDesc}>Send an item to someone</Text>
            </Pressable>
          </View>
        </View>

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
            <View style={styles.twoColumns}>
              <View style={styles.column}>
                <TimeInput
                  label="Trip Time"
                  value={tripTime}
                  onChange={setTripTime}
                  showPicker={showTripTimePicker}
                  setShowPicker={setShowTripTimePicker}
                />
              </View>

              <View style={styles.column}>
                <Text style={styles.label}>Seats</Text>
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
          )}

          <Pressable style={styles.weeklyRow} onPress={toggleWeeklyBooking}>
            <Ionicons
              name={weeklyBooking ? "radio-button-on" : "radio-button-off"}
              size={20}
              color={weeklyBooking ? "#F58220" : "#8B7B6B"}
            />
            <Ionicons name="calendar-outline" size={16} color="#7C5F46" />
            <Text style={styles.weeklyText}>Book for the whole week</Text>
          </Pressable>

          {weeklyBooking && (
            <View style={styles.weeklyBox}>
              <Text style={styles.label}>Select Days</Text>

              <View style={styles.daysRow}>
                {WEEK_DAYS.map((day) => {
                  const active = selectedDays.includes(day);

                  return (
                    <Pressable
                      key={day}
                      style={[
                        styles.dayButton,
                        active && styles.dayButtonActive,
                      ]}
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
                <View style={styles.daySettingsBox}>
                  {selectedDays.map((day, index) => {
                    const currentSeats = daySeats[day] || 1;
                    const isLast = index === selectedDays.length - 1;

                    return (
                      <View
                        key={day}
                        style={[
                          styles.dayItem,
                          !isLast && styles.dayItemDivider,
                        ]}
                      >
                        <Text style={styles.dayTitle}>{day}</Text>

                        <View style={styles.dayFieldsRow}>
                          <View style={styles.dayFieldColumn}>
                            <TimeInput
                              label="Time"
                              value={dayTimes[day] || "09:00"}
                              onChange={(value) =>
                                setDayTimes({
                                  ...dayTimes,
                                  [day]: value,
                                })
                              }
                              showPicker={openWeeklyTimePickerDay === day}
                              setShowPicker={(value) =>
                                setOpenWeeklyTimePickerDay(value ? day : null)
                              }
                            />
                          </View>

                          <View style={styles.dayFieldColumn}>
                            <Text style={styles.label}>Seats</Text>

                            <View style={styles.weeklySeatsRow}>
                              <Pressable
                                style={styles.weeklySeatButton}
                                onPress={() => decreaseSeatsForDay(day)}
                              >
                                <Ionicons
                                  name="remove"
                                  size={20}
                                  color="#111827"
                                />
                              </Pressable>

                              <Text style={styles.weeklySeatsNumber}>
                                {currentSeats}
                              </Text>

                              <Pressable
                                style={styles.weeklySeatButton}
                                onPress={() => increaseSeatsForDay(day)}
                              >
                                <Ionicons
                                  name="add"
                                  size={20}
                                  color="#111827"
                                />
                              </Pressable>
                            </View>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
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
  rideTypeRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 6,
  },
  rideTypeBox: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: "#E2D8CF",
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  rideTypeBoxActive: {
    borderColor: "#F58220",
    backgroundColor: "#FFF3E8",
  },
  rideTypeTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: "#111827",
    marginTop: 8,
    marginBottom: 4,
  },
  rideTypeDesc: {
    fontSize: 12,
    color: "#7C5F46",
    textAlign: "center",
    lineHeight: 16,
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
  daySettingsBox: {
    marginTop: 14,
  },
  dayItem: {
    paddingVertical: 12,
  },
  dayItemDivider: {
    borderBottomWidth: 1,
    borderBottomColor: "#F1E7DD",
  },
  dayTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 8,
  },
  dayFieldsRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  dayFieldColumn: {
    flex: 1,
  },
  weeklySeatsRow: {
    height: 56,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 14,
    backgroundColor: "#FFFDFC",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
  },
  weeklySeatButton: {
    width: 36,
    height: 36,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  weeklySeatsNumber: {
    fontSize: 22,
    fontWeight: "900",
    color: "#111827",
    minWidth: 24,
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
