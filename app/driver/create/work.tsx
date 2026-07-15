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

export default function WorkJobScreen() {
  const { driverName, phone, driverAge, languages } = useDriverAccount();

  const [loading, setLoading] = useState(false);

  const [jobTitle, setJobTitle] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [jobLocation, setJobLocation] = useState("");
  const [jobLocationPlace, setJobLocationPlace] =
    useState<IsraelLocation | null>(null);
  const [jobLocationError, setJobLocationError] = useState("");

  const handleJobLocationChange = (text: string) => {
    setJobLocation(text);
    setJobLocationPlace(null);
    if (jobLocationError) setJobLocationError("");
  };

  const [jobDate, setJobDate] = useState("");
  const [showJobDatePicker, setShowJobDatePicker] = useState(false);

  const [startTime, setStartTime] = useState("");
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);

  const [endTime, setEndTime] = useState("");
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);

  const [hourlyPay, setHourlyPay] = useState("");
  const [workersNeeded, setWorkersNeeded] = useState("1");

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
      !jobTitle ||
      !jobDescription ||
      !jobLocation ||
      !jobDate ||
      !startTime ||
      !endTime ||
      !hourlyPay ||
      !workersNeeded
    ) {
      Alert.alert("Missing details", "Please fill in all work details.");
      return;
    }

    if (!jobLocationPlace) {
      setJobLocationError("Please select a location from the list.");
      return;
    }

    const dateTimeValidation = validateDateAndTimeNotPassed(
      jobDate,
      startTime,
      {
        dateLabel: "work date",
        timeLabel: "start time",
      },
    );

    if (!dateTimeValidation) return;

    const cleanJobDate = dateTimeValidation.cleanDate;
    const cleanStartTime = dateTimeValidation.cleanTime;
    const jobDay = dateTimeValidation.day;

    const cleanEndTime = normalizeTime(endTime);

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

    const cleanHourlyPay = Number(hourlyPay);
    const cleanWorkersNeeded = Number(workersNeeded);

    if (Number.isNaN(cleanHourlyPay) || cleanHourlyPay <= 0) {
      Alert.alert("Invalid pay", "Hourly pay must be more than 0.");
      return;
    }

    if (
      Number.isNaN(cleanWorkersNeeded) ||
      cleanWorkersNeeded < 1 ||
      cleanWorkersNeeded > 20
    ) {
      Alert.alert(
        "Invalid workers",
        "Workers needed must be between 1 and 20.",
      );
      return;
    }

    try {
      setLoading(true);

      // Resolved ONCE here at creation time (never re-geocoded when Home
      // loads) — see resolveLocationCoordinates in locationSearch.ts.
      const locationCoords = await resolveLocationCoordinates(
        jobLocationPlace,
        jobLocation,
      );

      await addDoc(collection(db, "workJobs"), {
        employerId: user.uid,

        employerName: driverName,
        phone: accountInfo.cleanPhone,
        driverAge: accountInfo.cleanDriverAge,

        languages,

        jobTitle,
        jobTitleNormalized: normalize(jobTitle),

        description: jobDescription,

        location: jobLocation,
        locationNormalized: normalize(jobLocation),
        // Stable id for cross-language matching — see israelLocations.ts.
        locationId: jobLocationPlace.id,
        locationNames: {
          english: jobLocationPlace.english,
          arabic: jobLocationPlace.arabic,
          hebrew: jobLocationPlace.hebrew,
        },
        locationLat: locationCoords?.latitude ?? null,
        locationLng: locationCoords?.longitude ?? null,

        date: cleanJobDate,
        day: jobDay,

        startTime: cleanStartTime,
        endTime: cleanEndTime,

        hourlyPay: cleanHourlyPay,

        // "workersNeeded" is kept for existing readers; seats/totalSeats are
        // aliases of the same number. remainingSeats is the only one that
        // ever changes after creation — see acceptRequest/cancelApplication
        // in workErrandLib.ts. A pending request never touches this; only
        // an accepted worker (or a later cancellation) does.
        workersNeeded: cleanWorkersNeeded,
        seats: cleanWorkersNeeded,
        totalSeats: cleanWorkersNeeded,
        remainingSeats: cleanWorkersNeeded,
        acceptedWorkersCount: 0,

        status: "available",
        available: true,
        isFull: false,

        rating: 4.8,
        reviews: 0,

        active: true,
        category: "workErrands",

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      Alert.alert("Success", "Your work job was created successfully.");
      router.replace("/(tabs)/home" as any);
    } catch (error: any) {
      console.log("CREATE WORK JOB ERROR:", error);
      Alert.alert("Error", error.message || "Could not create work job.");
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
          <Text style={styles.title}>Create a Work Job</Text>

          <Text style={styles.subtitle}>
            Post work details for helpers to apply
          </Text>

          <Text style={styles.label}>Job Title</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter job title"
            placeholderTextColor="#8B7B6B"
            value={jobTitle}
            onChangeText={setJobTitle}
          />

          <Text style={styles.label}>Job Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Describe the work needed"
            placeholderTextColor="#8B7B6B"
            value={jobDescription}
            onChangeText={setJobDescription}
            multiline
          />

          <IsraelLocationAutocomplete
            label="Work Location"
            value={jobLocation}
            onChangeText={handleJobLocationChange}
            onSelectLocation={(location) => {
              setJobLocationPlace(location);
              setJobLocationError("");
            }}
            placeholder="Enter work location"
            error={jobLocationError}
          />

          <DateInput
            label="Work Date"
            value={jobDate}
            onChange={setJobDate}
            showPicker={showJobDatePicker}
            setShowPicker={setShowJobDatePicker}
          />

          <View style={styles.twoColumns}>
            <View style={styles.column}>
              <TimeInput
                label="Start Time"
                value={startTime}
                onChange={setStartTime}
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
                value={endTime}
                onChange={setEndTime}
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
              <Text style={styles.label}>Hourly Pay (₪)</Text>

              <View style={styles.inputRow}>
                <Ionicons name="cash-outline" size={18} color="#8B7B6B" />
                <TextInput
                  style={styles.rowInput}
                  placeholder="Enter hourly pay"
                  placeholderTextColor="#8B7B6B"
                  keyboardType="numeric"
                  value={hourlyPay}
                  onChangeText={(text) => setHourlyPay(getDigitsOnly(text))}
                />
              </View>
            </View>

            <View style={styles.column}>
              <Text style={styles.label}>Workers Needed</Text>

              <View style={styles.inputRow}>
                <Ionicons name="people-outline" size={18} color="#8B7B6B" />
                <TextInput
                  style={styles.rowInput}
                  placeholder="Enter workers needed"
                  placeholderTextColor="#8B7B6B"
                  keyboardType="numeric"
                  maxLength={2}
                  value={workersNeeded}
                  onChangeText={(text) =>
                    setWorkersNeeded(getDigitsOnly(text).slice(0, 2))
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
              {loading ? "Creating..." : "Create Work Job"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
