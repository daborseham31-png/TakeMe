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

export default function SchoolWeeklyBookingScreen() {
  const [schoolName, setSchoolName] = useState("");
  const [pickupLocation, setPickupLocation] = useState("");
  const [schoolLocation, setSchoolLocation] = useState("");

  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [dayTimes, setDayTimes] = useState<Record<string, string>>({});
  const [daySeats, setDaySeats] = useState<Record<string, number>>({});
  const [openTimePickerDay, setOpenTimePickerDay] = useState<string | null>(
    null,
  );

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

      const newSeats = { ...daySeats };
      delete newSeats[day];
      setDaySeats(newSeats);

      if (openTimePickerDay === day) {
        setOpenTimePickerDay(null);
      }

      return;
    }

    setSelectedDays([...selectedDays, day]);
    setDayTimes({ ...dayTimes, [day]: "07:30" });
    setDaySeats({ ...daySeats, [day]: 1 });
  };

  const toggleLanguage = (lang: string) => {
    if (selectedLanguages.includes(lang)) {
      setSelectedLanguages(selectedLanguages.filter((item) => item !== lang));
    } else {
      setSelectedLanguages([...selectedLanguages, lang]);
    }
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
    if (!schoolName || !pickupLocation || !schoolLocation) {
      Alert.alert("Missing details", "Please fill in all required fields.");
      return;
    }

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
        category: "school",
        from: pickupLocation.trim(),
        to: schoolLocation.trim(),
        genderPref,
        languages: selectedLanguages.join(","),

        // بنبعت أكبر عدد مقاعد مطلوب عشان صفحة النتائج تطلع سائق عنده مقاعد كافية
        seats: String(maxSeatsNeeded),

        days: selectedDays.join(","),
        dayTimes: JSON.stringify(cleanedDayTimes),

        // هذا بنحتاجه بعدين بالحجز الحقيقي: كل يوم كم مقعد
        daySeats: JSON.stringify(cleanedDaySeats),

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
            <View style={styles.daySettingsBox}>
              {selectedDays.map((day, index) => {
                const currentSeats = daySeats[day] || 1;
                const isLast = index === selectedDays.length - 1;

                return (
                  <View
                    key={day}
                    style={[styles.dayItem, !isLast && styles.dayItemDivider]}
                  >
                    <Text style={styles.daySettingTitle}>{day}</Text>

                    <View style={styles.dayFieldsRow}>
                      <View style={styles.dayFieldColumn}>
                        <TimeInput
                          label="Time"
                          value={dayTimes[day] || "07:30"}
                          onChange={(value) =>
                            setDayTimes({
                              ...dayTimes,
                              [day]: value,
                            })
                          }
                          showPicker={openTimePickerDay === day}
                          setShowPicker={(value) =>
                            setOpenTimePickerDay(value ? day : null)
                          }
                        />
                      </View>

                      <View style={styles.dayFieldColumn}>
                        <Text style={styles.smallLabel}>Seats</Text>

                        <View style={styles.inlineSeatsBox}>
                          <Pressable
                            style={styles.inlineSeatButton}
                            onPress={() => decreaseSeatsForDay(day)}
                          >
                            <Ionicons name="remove" size={20} color="#111827" />
                          </Pressable>

                          <Text style={styles.inlineSeatsNumber}>
                            {currentSeats}
                          </Text>

                          <Pressable
                            style={styles.inlineSeatButton}
                            onPress={() => increaseSeatsForDay(day)}
                          >
                            <Ionicons name="add" size={20} color="#111827" />
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
  smallLabel: {
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
    borderTopWidth: 1,
    borderTopColor: "#E7DCD1",
    paddingTop: 12,
  },
  dayItem: {
    paddingVertical: 12,
  },
  dayItemDivider: {
    borderBottomWidth: 1,
    borderBottomColor: "#F1E7DD",
  },
  daySettingTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 8,
  },
  dayFieldsRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  dayFieldColumn: {
    flex: 1,
  },
  inlineSeatsBox: {
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
  inlineSeatButton: {
    width: 36,
    height: 36,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  inlineSeatsNumber: {
    fontSize: 22,
    fontWeight: "900",
    color: "#111827",
    minWidth: 24,
    textAlign: "center",
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
