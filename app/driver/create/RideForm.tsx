import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import React, { useState } from "react";
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

  const [hasChildSeat, setHasChildSeat] = useState(false);
  const [allowsPets, setAllowsPets] = useState(false);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [tripDate, setTripDate] = useState("");
  const [showTripDatePicker, setShowTripDatePicker] = useState(false);

  const [isRecurring, setIsRecurring] = useState(false);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);

  const [time, setTime] = useState("");
  const [showTimePicker, setShowTimePicker] = useState(false);

  const [price, setPrice] = useState("");
  const [seats, setSeats] = useState("1");

  const toggleDay = (day: string) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((item) => item !== day) : [...prev, day],
    );
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

    if (
      !car ||
      !carColor ||
      !carPlate ||
      !from ||
      !to ||
      !tripDate ||
      !time ||
      !price ||
      !seats
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

    if (canRepeat && isRecurring && selectedDays.length === 0) {
      Alert.alert("Missing days", "Please choose at least one repeat day.");
      return;
    }

    const finalAvailableDays =
      canRepeat && isRecurring ? selectedDays : [tripDay];

    const cleanTime = normalizeTime(time);

    if (!cleanTime) {
      Alert.alert(
        "Invalid time",
        "Please choose a valid time between 00:00 and 23:59.",
      );
      return;
    }

    const cleanPrice = Number(price);
    const cleanSeats = Number(seats);

    if (Number.isNaN(cleanPrice) || cleanPrice <= 0) {
      Alert.alert("Invalid price", "Price must be more than 0.");
      return;
    }

    if (Number.isNaN(cleanSeats) || cleanSeats < 1 || cleanSeats > 8) {
      Alert.alert("Invalid seats", "Seats must be between 1 and 8.");
      return;
    }

    try {
      setLoading(true);

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

        hasChildSeat,
        allowsPets: showPets ? allowsPets : false,

        from,
        to,
        fromNormalized: normalize(from),
        toNormalized: normalize(to),

        // إذا مش مكرر: هذا هو تاريخ السفرة
        // إذا مكرر: هذا هو تاريخ بداية التكرار
        tripDate: cleanTripDate,
        startDate: cleanTripDate,
        day: tripDay,

        isRecurring: canRepeat ? isRecurring : false,
        repeatDays: finalAvailableDays,
        availableDays: finalAvailableDays,

        time: cleanTime,

        price: cleanPrice,
        seats: cleanSeats,

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

          <YesNoField
            label="Has child seat?"
            value={hasChildSeat}
            onValueChange={setHasChildSeat}
          />

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
                  setSelectedDays([]);
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
            </>
          )}

          <TimeInput
            label="Departure Time"
            value={time}
            onChange={setTime}
            showPicker={showTimePicker}
            setShowPicker={setShowTimePicker}
          />

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
