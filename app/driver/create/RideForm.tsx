import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { router } from "expo-router";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { auth, db } from "../../../firebase";
import DateInput, { TimeInput } from "./DateInput";
import YesNoField from "./YesNoField";
import {
  dayNames,
  getDayFromDateText,
  getDigitsOnly,
  normalize,
  normalizeDateToYMD,
  normalizeTime,
  styles,
  useDriverAccount,
  validateAccountInfo,
} from "./driverHelpers";

type RideCategory = "school" | "personal";

type Props = {
  category: RideCategory;
  showPets?: boolean;
  onBack?: () => void;
};

export default function RideForm({ category, showPets, onBack }: Props) {
  const { driverName, phone, driverAge, languages } = useDriverAccount();

  // نسمح بالتكرار للمدرسة و Ride Person
  const canRepeat = category === "school" || category === "personal";

  const [loading, setLoading] = useState(false);

  const [car, setCar] = useState("");
  const [carColor, setCarColor] = useState("");
  const [carPlate, setCarPlate] = useState("");

  const [allowsPets, setAllowsPets] = useState(false);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [tripDate, setTripDate] = useState("");
  const [showTripDatePicker, setShowTripDatePicker] = useState(false);

  const [isRecurring, setIsRecurring] = useState(false);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);

  // Weekly (recurring): each selected day has its own time + seats
  const [dayTimes, setDayTimes] = useState<Record<string, string>>({});
  const [daySeats, setDaySeats] = useState<Record<string, number>>({});
  const [openDayTimePicker, setOpenDayTimePicker] = useState<string | null>(
    null,
  );

  const [time, setTime] = useState("");
  const [showTimePicker, setShowTimePicker] = useState(false);

  const [price, setPrice] = useState("");
  const [seats, setSeats] = useState("1");

  const clearWeeklyDays = () => {
    setSelectedDays([]);
    setDayTimes({});
    setDaySeats({});
    setOpenDayTimePicker(null);
  };

  const toggleDay = (day: string) => {
    if (selectedDays.includes(day)) {
      setSelectedDays((prev) => prev.filter((item) => item !== day));

      setDayTimes((prev) => {
        const next = { ...prev };
        delete next[day];
        return next;
      });

      setDaySeats((prev) => {
        const next = { ...prev };
        delete next[day];
        return next;
      });

      if (openDayTimePicker === day) {
        setOpenDayTimePicker(null);
      }

      return;
    }

    setSelectedDays((prev) => [...prev, day]);
    setDayTimes((prev) => ({ ...prev, [day]: "09:00" }));
    setDaySeats((prev) => ({ ...prev, [day]: 1 }));
  };

  // The chosen Start Date's own day is always included in the weekly plan,
  // so the driver sets a time + seats for that date too.
  useEffect(() => {
    if (!(canRepeat && isRecurring)) return;

    const startDay = getDayFromDateText(tripDate);

    if (!startDay) return;

    setSelectedDays((prev) =>
      prev.includes(startDay) ? prev : [...prev, startDay],
    );
    setDayTimes((prev) =>
      prev[startDay] ? prev : { ...prev, [startDay]: "09:00" },
    );
    setDaySeats((prev) => (prev[startDay] ? prev : { ...prev, [startDay]: 1 }));
  }, [tripDate, isRecurring, canRepeat]);

  const decreaseSeatsForDay = (day: string) => {
    setDaySeats((prev) => ({
      ...prev,
      [day]: Math.max(1, (prev[day] || 1) - 1),
    }));
  };

  const increaseSeatsForDay = (day: string) => {
    setDaySeats((prev) => ({
      ...prev,
      [day]: Math.min(8, (prev[day] || 1) + 1),
    }));
  };

  const handleSubmit = async () => {
    const user = auth.currentUser;

    if (!user) {
      Alert.alert("Login required", "Please login first.");
      router.replace("/");
      return;
    }

    const accountInfo = validateAccountInfo(driverName, phone, driverAge);

    if (!accountInfo) return;

    if (languages.length === 0) {
      Alert.alert(
        "Missing language",
        "Your language is missing from your account profile.",
      );
      return;
    }

    const recurring = canRepeat && isRecurring;

    if (
      !car ||
      !carColor ||
      !carPlate ||
      !from ||
      !to ||
      !tripDate ||
      !price ||
      (!recurring && (!time || !seats))
    ) {
      Alert.alert("Missing details", "Please fill in all fields.");
      return;
    }

    const cleanTripDate = normalizeDateToYMD(tripDate);

    if (!cleanTripDate) {
      Alert.alert(
        "Invalid date",
        "Travel date must be today or a future date.",
      );
      return;
    }

    const tripDay = getDayFromDateText(cleanTripDate);

    if (recurring && selectedDays.length === 0) {
      Alert.alert("Missing days", "Please choose at least one repeat day.");
      return;
    }

    const finalAvailableDays = recurring ? selectedDays : [tripDay];

    const cleanPrice = Number(price);

    if (Number.isNaN(cleanPrice) || cleanPrice <= 0) {
      Alert.alert("Invalid price", "Price must be more than 0.");
      return;
    }

    // Time + seats: per-day when recurring, otherwise a single value
    let cleanTime = "";
    let cleanSeats = 0;
    const cleanedDayTimes: Record<string, string> = {};
    const cleanedDaySeats: Record<string, number> = {};

    if (recurring) {
      for (const day of selectedDays) {
        const dayTime = normalizeTime(dayTimes[day] || "");

        if (!dayTime) {
          Alert.alert(
            "Invalid time",
            `Please choose a valid time for ${day} between 00:00 and 23:59.`,
          );
          return;
        }

        const daySeatsValue = daySeats[day] || 1;

        if (daySeatsValue < 1 || daySeatsValue > 8) {
          Alert.alert(
            "Invalid seats",
            `Seats for ${day} must be between 1 and 8.`,
          );
          return;
        }

        cleanedDayTimes[day] = dayTime;
        cleanedDaySeats[day] = daySeatsValue;
      }

      // fallback single values (used by the passenger search matching)
      cleanTime = cleanedDayTimes[selectedDays[0]];
      cleanSeats = Math.max(...Object.values(cleanedDaySeats));
    } else {
      const normalizedTime = normalizeTime(time);

      if (!normalizedTime) {
        Alert.alert(
          "Invalid time",
          "Please choose a valid time between 00:00 and 23:59.",
        );
        return;
      }

      cleanTime = normalizedTime;
      cleanSeats = Number(seats);

      if (Number.isNaN(cleanSeats) || cleanSeats < 1 || cleanSeats > 8) {
        Alert.alert("Invalid seats", "Seats must be between 1 and 8.");
        return;
      }
    }

    try {
      setLoading(true);

      // Best-effort: store route coordinates so Roadside Help can match
      // passengers to this route quickly. Falls back to city text if geocoding
      // fails (Roadside Help geocodes the text at match time in that case).
      const routeCoords: Record<string, number> = {};

      try {
        const [fromGeo] = await Location.geocodeAsync(from);
        if (fromGeo) {
          routeCoords.fromLat = fromGeo.latitude;
          routeCoords.fromLng = fromGeo.longitude;
        }

        const [toGeo] = await Location.geocodeAsync(to);
        if (toGeo) {
          routeCoords.toLat = toGeo.latitude;
          routeCoords.toLng = toGeo.longitude;
        }
      } catch {
        // Ignore geocoding errors — matching still works via text fallback.
      }

      await addDoc(collection(db, "driverRoutes"), {
        driverId: user.uid,

        // fallback فقط. صفحة المسافر تقرأ الأساسي من users/{driverId}
        driverName,
        phone: accountInfo.cleanPhone,
        driverAge: accountInfo.cleanDriverAge,

        // اللغة جاية لحالها من بروفايل السائق
        languages,

        category,

        car,
        carColor,
        carPlate,

        allowsPets: showPets ? allowsPets : false,

        from,
        to,
        fromNormalized: normalize(from),
        toNormalized: normalize(to),
        ...routeCoords,

        // إذا مش مكرر: هذا هو تاريخ السفرة
        // إذا مكرر: هذا هو تاريخ بداية التكرار
        tripDate: cleanTripDate,
        startDate: cleanTripDate,
        day: tripDay,

        isRecurring: recurring,
        repeatDays: finalAvailableDays,
        availableDays: finalAvailableDays,

        time: cleanTime,
        dayTimes: recurring ? cleanedDayTimes : {},

        price: cleanPrice,
        seats: cleanSeats,
        daySeats: recurring ? cleanedDaySeats : {},

        rating: 4.8,
        reviews: 0,
        eta: 10,
        active: true,

        createdAt: serverTimestamp(),
      });

      Alert.alert("Success", "Your trip was created successfully.");
      router.replace("/(tabs)/home" as any);
    } catch (error: any) {
      console.log("CREATE RIDE ERROR:", error);
      Alert.alert("Error", error.message || "Could not create trip.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable
          style={styles.backButton}
          onPress={() => (onBack ? onBack() : router.back())}
        >
          <Ionicons name="arrow-back" size={24} color="#7C5F46" />
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.title}>Create a New Trip</Text>
          <Text style={styles.subtitle}>
            Set your car, destination, date, time, price, and available seats
          </Text>

          <Text style={styles.label}>Car Model</Text>
          <View style={styles.inputRow}>
            <Ionicons name="car-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.rowInput}
              placeholder="e.g. Toyota Corolla 2022"
              placeholderTextColor="#8B7B6B"
              value={car}
              onChangeText={setCar}
            />
          </View>

          <Text style={styles.label}>Car Color</Text>
          <View style={styles.inputRow}>
            <Ionicons name="color-palette-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.rowInput}
              placeholder="e.g. White / Black / Silver"
              placeholderTextColor="#8B7B6B"
              value={carColor}
              onChangeText={setCarColor}
            />
          </View>

          <Text style={styles.label}>Car Plate Number</Text>
          <View style={styles.inputRow}>
            <Ionicons name="barcode-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.rowInput}
              placeholder="e.g. 1234567"
              placeholderTextColor="#8B7B6B"
              value={carPlate}
              onChangeText={setCarPlate}
            />
          </View>

          {showPets && (
            <YesNoField
              label="Allows pets?"
              value={allowsPets}
              onValueChange={setAllowsPets}
            />
          )}

          <Text style={styles.label}>From</Text>
          <View style={styles.inputRow}>
            <Ionicons name="location-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.rowInput}
              placeholder="e.g. Nazareth"
              placeholderTextColor="#8B7B6B"
              value={from}
              onChangeText={setFrom}
            />
          </View>

          <Text style={styles.label}>To</Text>
          <View style={styles.inputRow}>
            <Ionicons name="location-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.rowInput}
              placeholder="e.g. Mashhad"
              placeholderTextColor="#8B7B6B"
              value={to}
              onChangeText={setTo}
            />
          </View>

          <DateInput
            label={isRecurring ? "Start Date" : "Travel Date"}
            value={tripDate}
            onChange={setTripDate}
            showPicker={showTripDatePicker}
            setShowPicker={setShowTripDatePicker}
          />

          {canRepeat && (
            <YesNoField
              label="Repeat on multiple days?"
              value={isRecurring}
              onValueChange={(value) => {
                setIsRecurring(value);

                if (!value) {
                  clearWeeklyDays();
                }
              }}
            />
          )}

          {canRepeat && isRecurring && (
            <>
              <Text style={styles.label}>Choose Repeat Days</Text>

              <View style={styles.languageRow}>
                {dayNames.map((day) => {
                  const active = selectedDays.includes(day);

                  return (
                    <Pressable
                      key={day}
                      style={[
                        styles.languageButton,
                        active && styles.languageButtonActive,
                      ]}
                      onPress={() => toggleDay(day)}
                    >
                      <Text
                        style={[
                          styles.languageText,
                          active && styles.languageTextActive,
                        ]}
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
                                setDayTimes((prev) => ({
                                  ...prev,
                                  [day]: value,
                                }))
                              }
                              showPicker={openDayTimePicker === day}
                              setShowPicker={(value) =>
                                setOpenDayTimePicker(value ? day : null)
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
            </>
          )}

          {!(canRepeat && isRecurring) && (
            <TimeInput
              label="Departure Time"
              value={time}
              onChange={setTime}
              showPicker={showTimePicker}
              setShowPicker={setShowTimePicker}
            />
          )}

          {canRepeat && isRecurring ? (
            <>
              <Text style={styles.label}>Price (₪)</Text>
              <View style={styles.inputRow}>
                <Ionicons name="cash-outline" size={18} color="#8B7B6B" />
                <TextInput
                  style={styles.rowInput}
                  placeholder="₪"
                  placeholderTextColor="#8B7B6B"
                  keyboardType="numeric"
                  value={price}
                  onChangeText={(text) => setPrice(getDigitsOnly(text))}
                />
              </View>
            </>
          ) : (
            <View style={styles.twoColumns}>
              <View style={styles.column}>
                <Text style={styles.label}>Price (₪)</Text>
                <View style={styles.inputRow}>
                  <Ionicons name="cash-outline" size={18} color="#8B7B6B" />
                  <TextInput
                    style={styles.rowInput}
                    placeholder="₪"
                    placeholderTextColor="#8B7B6B"
                    keyboardType="numeric"
                    value={price}
                    onChangeText={(text) => setPrice(getDigitsOnly(text))}
                  />
                </View>
              </View>

              <View style={styles.column}>
                <Text style={styles.label}>Available Seats</Text>
                <View style={styles.inputRow}>
                  <Ionicons name="people-outline" size={18} color="#8B7B6B" />
                  <TextInput
                    style={styles.rowInput}
                    placeholder="1"
                    placeholderTextColor="#8B7B6B"
                    keyboardType="numeric"
                    maxLength={1}
                    value={seats}
                    onChangeText={(text) =>
                      setSeats(getDigitsOnly(text).slice(0, 1))
                    }
                  />
                </View>
              </View>
            </View>
          )}

          <Pressable
            style={[
              styles.submitButton,
              loading && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={loading}
          >
            <Text style={styles.submitText}>
              {loading ? "Creating..." : "Create Trip"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
