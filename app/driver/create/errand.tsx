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
import IsraelLocationAutocomplete from "../../booking/IsraelLocationAutocomplete";
import { IsraelLocation } from "../../booking/israelLocations";
import { resolveLocationCoordinates } from "../../booking/locationSearch";
import { fetchDriverEligibility } from "../driverEligibility";
import DateInput, { TimeInput } from "./DateInput";
import YesNoField from "./YesNoField";
import {
  getDigitsOnly,
  normalize,
  normalizeTime,
  styles,
  timeToMinutes,
  useDriverAccount,
  validateAccountInfo,
  validateDateAndTimeNotPassed,
} from "./driverHelpers";

export default function ErrandJobScreen() {
  const { driverName, phone, driverAge, languages } = useDriverAccount();

  const [loading, setLoading] = useState(false);

  const [canTakeKids, setCanTakeKids] = useState(false);
  const [allowsPets, setAllowsPets] = useState(false);
  const [errandTitle, setErrandTitle] = useState("");
  const [errandDescription, setErrandDescription] = useState("");
  const [errandLocation, setErrandLocation] = useState("");
  const [errandLocationPlace, setErrandLocationPlace] =
    useState<IsraelLocation | null>(null);
  const [errandLocationError, setErrandLocationError] = useState("");

  const handleErrandLocationChange = (text: string) => {
    setErrandLocation(text);
    setErrandLocationPlace(null);
    if (errandLocationError) setErrandLocationError("");
  };
  const [errandDate, setErrandDate] = useState("");
  const [showErrandDatePicker, setShowErrandDatePicker] = useState(false);
  const [errandStartTime, setErrandStartTime] = useState("");
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);
  const [errandEndTime, setErrandEndTime] = useState("");
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);
  const [errandPrice, setErrandPrice] = useState("");
  const [errandSeats, setErrandSeats] = useState("1");

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

    if (
      !errandTitle ||
      !errandDescription ||
      !errandLocation ||
      !errandDate ||
      !errandStartTime ||
      !errandEndTime ||
      !errandPrice ||
      !errandSeats
    ) {
      Alert.alert("Missing details", "Please fill in all errand details.");
      return;
    }

    if (!errandLocationPlace) {
      setErrandLocationError("Please select a location from the list.");
      return;
    }

    const dateTimeValidation = validateDateAndTimeNotPassed(
      errandDate,
      errandStartTime,
      {
        dateLabel: "errand date",
        timeLabel: "start time",
      },
    );

    if (!dateTimeValidation) return;

    const cleanErrandDate = dateTimeValidation.cleanDate;
    const cleanStartTime = dateTimeValidation.cleanTime;
    const errandDay = dateTimeValidation.day;

    const cleanEndTime = normalizeTime(errandEndTime);

    if (!cleanEndTime) {
      Alert.alert(
        "Invalid time",
        "Please choose a valid end time between 00:00 and 23:59.",
      );
      return;
    }

    const startMinutes = timeToMinutes(cleanStartTime);
    const endMinutes = timeToMinutes(cleanEndTime);

    if (
      startMinutes === null ||
      endMinutes === null ||
      endMinutes <= startMinutes
    ) {
      Alert.alert("Invalid time", "End time must be after start time.");
      return;
    }

    const cleanPrice = Number(errandPrice);
    const cleanSeats = Number(errandSeats);

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

      // Resolved ONCE here at creation time (never re-geocoded when Home
      // loads) — see resolveLocationCoordinates in locationSearch.ts.
      const locationCoords = await resolveLocationCoordinates(
        errandLocationPlace,
        errandLocation,
      );

      await addDoc(collection(db, "errandJobs"), {
        ownerId: user.uid,

        ownerName: driverName,
        phone: accountInfo.cleanPhone,
        driverAge: accountInfo.cleanDriverAge,

        languages,

        canTakeKids,
        allowsPets,

        errandTitle,
        errandTitleNormalized: normalize(errandTitle),
        description: errandDescription,

        location: errandLocation,
        locationNormalized: normalize(errandLocation),
        // Stable id for cross-language matching — see israelLocations.ts.
        locationId: errandLocationPlace.id,
        locationNames: {
          english: errandLocationPlace.english,
          arabic: errandLocationPlace.arabic,
          hebrew: errandLocationPlace.hebrew,
        },
        locationLat: locationCoords?.latitude ?? null,
        locationLng: locationCoords?.longitude ?? null,

        date: cleanErrandDate,
        day: errandDay,
        startTime: cleanStartTime,
        endTime: cleanEndTime,

        price: cleanPrice,
        seats: cleanSeats,

        rating: 4.8,
        reviews: 0,
        active: true,
        category: "errands",

        createdAt: serverTimestamp(),
      });

      Alert.alert("Success", "Your errand was created successfully.");
      router.replace("/(tabs)/home" as any);
    } catch (error: any) {
      console.log("CREATE ERRAND ERROR:", error);
      Alert.alert("Error", error.message || "Could not create errand.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#7C5F46" />
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.title}>Create an Errand</Text>
          <Text style={styles.subtitle}>
            Post your errand details for people to join
          </Text>

          <YesNoField
            label="Can take kids?"
            value={canTakeKids}
            onValueChange={setCanTakeKids}
          />

          <YesNoField
            label="Allows pets?"
            value={allowsPets}
            onValueChange={setAllowsPets}
          />

          <Text style={styles.label}>Errand Title</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter errand title"
            placeholderTextColor="#8B7B6B"
            value={errandTitle}
            onChangeText={setErrandTitle}
          />

          <Text style={styles.label}>Errand Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Describe the errand"
            placeholderTextColor="#8B7B6B"
            value={errandDescription}
            onChangeText={setErrandDescription}
            multiline
          />

          <IsraelLocationAutocomplete
            label="Errand Location"
            value={errandLocation}
            onChangeText={handleErrandLocationChange}
            onSelectLocation={(location) => {
              setErrandLocationPlace(location);
              setErrandLocationError("");
            }}
            placeholder="Enter errand location"
            error={errandLocationError}
          />

          <DateInput
            label="Errand Date"
            value={errandDate}
            onChange={setErrandDate}
            showPicker={showErrandDatePicker}
            setShowPicker={setShowErrandDatePicker}
          />

          <View style={styles.twoColumns}>
            <View style={styles.column}>
              <TimeInput
                label="Start Time"
                value={errandStartTime}
                onChange={setErrandStartTime}
                showPicker={showStartTimePicker}
                setShowPicker={(value) => {
                  setShowStartTimePicker(value);

                  if (value) {
                    setShowEndTimePicker(false);
                  }
                }}
              />
            </View>

            <View style={styles.column}>
              <TimeInput
                label="End Time"
                value={errandEndTime}
                onChange={setErrandEndTime}
                showPicker={showEndTimePicker}
                setShowPicker={(value) => {
                  setShowEndTimePicker(value);

                  if (value) {
                    setShowStartTimePicker(false);
                  }
                }}
              />
            </View>
          </View>

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
                  value={errandPrice}
                  onChangeText={(text) => setErrandPrice(getDigitsOnly(text))}
                />
              </View>
            </View>

            <View style={styles.column}>
              <Text style={styles.label}>Seats Available</Text>
              <View style={styles.inputRow}>
                <Ionicons name="people-outline" size={18} color="#8B7B6B" />
                <TextInput
                  style={styles.rowInput}
                  placeholder="Enter available seats"
                  placeholderTextColor="#8B7B6B"
                  keyboardType="numeric"
                  maxLength={1}
                  value={errandSeats}
                  onChangeText={(text) =>
                    setErrandSeats(getDigitsOnly(text).slice(0, 1))
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
              {loading ? "Creating..." : "Create Errand"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
