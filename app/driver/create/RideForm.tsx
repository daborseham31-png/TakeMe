import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
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
import {
  validateWeeklyRows,
  WeekDayRow,
  WeeklyDriverDay,
} from "../../booking/weeklyBookingLib";
import { fetchDriverEligibility } from "../driverEligibility";
import DateInput, { TimeInput } from "./DateInput";
import WeeklyDaysCard from "./WeeklyDaysCard";
import YesNoField from "./YesNoField";
import {
  getDayFromDateText,
  getDigitsOnly,
  isValidCarPlate,
  normalize,
  normalizeDateToYMD,
  styles,
  useDriverAccount,
  validateAccountInfo,
  validateDateAndTimeNotPassed,
} from "./driverHelpers";

type RideCategory = "school" | "personal";

type Props = {
  category: RideCategory;
  showPets?: boolean;
  onBack?: () => void;
};

export default function RideForm({ category, showPets, onBack }: Props) {
  const { driverName, phone, driverAge, languages } = useDriverAccount();

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
  const [weeklyRows, setWeeklyRows] = useState<WeekDayRow[]>([]);

  const [time, setTime] = useState("");
  const [showTimePicker, setShowTimePicker] = useState(false);

  const [price, setPrice] = useState("");
  const [seats, setSeats] = useState("1");

  const toggleRecurring = (value: boolean) => {
    setIsRecurring(value);

    if (!value) {
      setWeeklyRows([]);
    }
  };

  const handleSubmit = async () => {
    const user = auth.currentUser;

    if (!user) {
      Alert.alert("Login required", "Please login first.");
      router.replace("/");
      return;
    }

    const eligibility = await fetchDriverEligibility(user.uid);

    if (!eligibility.eligible) {
      Alert.alert(
        "Verification required",
        "You must verify a valid driving license before creating a driver trip.",
      );
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
      (!recurring && (!tripDate || !price || !time || !seats))
    ) {
      Alert.alert("Missing details", "Please fill in all fields.");
      return;
    }

    if (!isValidCarPlate(carPlate)) {
      Alert.alert(
        "Invalid vehicle number",
        "Vehicle number must contain between 7 and 9 digits.",
      );
      return;
    }

    let weeklyTrips: WeeklyDriverDay[] = [];
    let cleanTripDate = "";
    let tripDay = "";
    let cleanTime = "";
    let cleanSeats = 0;
    let cleanPrice = 0;

    if (recurring) {
      const cleanedDays = validateWeeklyRows(weeklyRows, {
        requirePrice: true,
      });

      if (!cleanedDays) return;

      weeklyTrips = cleanedDays;
      cleanTripDate = weeklyTrips[0].date;
      tripDay = weeklyTrips[0].dayName;
      cleanTime = weeklyTrips[0].time;
      cleanSeats = Math.max(...weeklyTrips.map((day) => day.seats));
      cleanPrice = weeklyTrips[0].price;
    } else {
      const cleanedDate = normalizeDateToYMD(tripDate);

      if (!cleanedDate) {
        Alert.alert(
          "Invalid date",
          "Travel date must be today or a future date.",
        );
        return;
      }

      cleanTripDate = cleanedDate;
      tripDay = getDayFromDateText(cleanTripDate);

      const validation = validateDateAndTimeNotPassed(tripDate, time, {
        dateLabel: "travel date",
        timeLabel: "departure time",
      });

      if (!validation) return;

      cleanTime = validation.cleanTime;
      cleanSeats = Number(seats);

      if (Number.isNaN(cleanSeats) || cleanSeats < 1 || cleanSeats > 8) {
        Alert.alert("Invalid seats", "Seats must be between 1 and 8.");
        return;
      }

      cleanPrice = Number(price);

      if (Number.isNaN(cleanPrice) || cleanPrice <= 0) {
        Alert.alert("Invalid price", "Price must be more than 0.");
        return;
      }
    }

    const finalAvailableDays = recurring
      ? weeklyTrips.map((day) => day.dayName)
      : [tripDay];

    try {
      setLoading(true);

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

        driverName,
        phone: accountInfo.cleanPhone,
        driverAge: accountInfo.cleanDriverAge,

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

        tripDate: cleanTripDate,
        startDate: cleanTripDate,
        day: tripDay,

        isRecurring: recurring,
        bookingType: recurring ? "weekly" : "quick",
        repeatDays: finalAvailableDays,
        availableDays: finalAvailableDays,
        weeklyTrips: recurring ? weeklyTrips : [],

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
              placeholder="Enter your car model"
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
              placeholder="Enter your car color"
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
              placeholder="Enter your car plate number"
              placeholderTextColor="#8B7B6B"
              keyboardType="number-pad"
              value={carPlate}
              onChangeText={(value) => setCarPlate(getDigitsOnly(value).slice(0, 9))}
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
              placeholder="Enter departure city"
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
              placeholder="Enter destination city"
              placeholderTextColor="#8B7B6B"
              value={to}
              onChangeText={setTo}
            />
          </View>

          {canRepeat && (
            <YesNoField
              label="Repeat on multiple days?"
              value={isRecurring}
              onValueChange={toggleRecurring}
            />
          )}

          {!(canRepeat && isRecurring) ? (
            <>
              <DateInput
                label="Travel Date"
                value={tripDate}
                onChange={setTripDate}
                showPicker={showTripDatePicker}
                setShowPicker={setShowTripDatePicker}
              />

              <TimeInput
                label="Departure Time"
                value={time}
                onChange={setTime}
                showPicker={showTimePicker}
                setShowPicker={setShowTimePicker}
                associatedDate={tripDate}
              />

              <View style={styles.twoColumns}>
                <View style={styles.column}>
                  <Text style={styles.label}>Price (₪)</Text>
                  <View style={styles.inputRow}>
                    <Ionicons name="cash-outline" size={18} color="#8B7B6B" />
                    <TextInput
                      style={styles.rowInput}
                      placeholder="Enter price"
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
                      placeholder="Enter available seats"
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
            </>
          ) : (
            <WeeklyDaysCard
              rows={weeklyRows}
              onChange={setWeeklyRows}
              defaultTime="09:00"
              mode="driver"
            />
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
