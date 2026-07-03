import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";
import React, { useEffect, useState } from "react";
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

import { auth, db } from "../../firebase";

type TripType = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
};

const tripTypes: TripType[] = [
  {
    key: "school",
    label: "School Rides",
    icon: "school-outline",
    color: "#3B82F6",
  },
  {
    key: "personal",
    label: "Personal Rides",
    icon: "person-outline",
    color: "#EC4899",
  },
  {
    key: "workErrands",
    label: "Work Helpers",
    icon: "briefcase-outline",
    color: "#22C55E",
  },
  {
    key: "errands",
    label: "Errands",
    icon: "location-outline",
    color: "#F58220",
  },
  {
    key: "delivery",
    label: "Item Delivery",
    icon: "cube-outline",
    color: "#A855F7",
  },
];

const languageOptions = [
  { key: "ar", label: "Arabic" },
  { key: "he", label: "Hebrew" },
  { key: "en", label: "English" },
  { key: "ru", label: "Russian" },
];

const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const normalize = (value: string) => {
  return value.trim().toLowerCase();
};

const getDigitsOnly = (value: string) => {
  return value.replace(/\D/g, "");
};

const normalizeDateToYMD = (dateText: string) => {
  const value = dateText.trim();

  let year: number;
  let month: number;
  let day: number;

  const ymdMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dmyMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (ymdMatch) {
    year = Number(ymdMatch[1]);
    month = Number(ymdMatch[2]);
    day = Number(ymdMatch[3]);
  } else if (dmyMatch) {
    day = Number(dmyMatch[1]);
    month = Number(dmyMatch[2]);
    year = Number(dmyMatch[3]);
  } else {
    return null;
  }

  const enteredDate = new Date(year, month - 1, day);

  const isRealDate =
    enteredDate.getFullYear() === year &&
    enteredDate.getMonth() === month - 1 &&
    enteredDate.getDate() === day;

  if (!isRealDate) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  enteredDate.setHours(0, 0, 0, 0);

  if (enteredDate < today) return null;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0",
  )}`;
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

const timeToMinutes = (timeValue: string) => {
  const cleanTime = normalizeTime(timeValue);

  if (!cleanTime) return null;

  const [hours, minutes] = cleanTime.split(":").map(Number);

  return hours * 60 + minutes;
};

export default function AddDriverRouteScreen() {
  const [loading, setLoading] = useState(false);

  const [driverName, setDriverName] = useState("");
  const [phone, setPhone] = useState("");
  const [car, setCar] = useState("");
  const [gender, setGender] = useState<"male" | "female">("male");
  const [languages, setLanguages] = useState<string[]>([]);

  const [tripType, setTripType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tripDate, setTripDate] = useState("");
  const [availableDays, setAvailableDays] = useState<string[]>([]);
  const [time, setTime] = useState("");
  const [price, setPrice] = useState("");
  const [seats, setSeats] = useState("1");

  const [jobTitle, setJobTitle] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [jobLocation, setJobLocation] = useState("");
  const [jobDate, setJobDate] = useState("");
  const [jobDay, setJobDay] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [hourlyPay, setHourlyPay] = useState("");
  const [workersNeeded, setWorkersNeeded] = useState("1");

  const [errandTitle, setErrandTitle] = useState("");
  const [errandDescription, setErrandDescription] = useState("");
  const [errandLocation, setErrandLocation] = useState("");
  const [errandDate, setErrandDate] = useState("");
  const [errandDay, setErrandDay] = useState("");
  const [errandStartTime, setErrandStartTime] = useState("");
  const [errandEndTime, setErrandEndTime] = useState("");
  const [errandPrice, setErrandPrice] = useState("");
  const [errandSeats, setErrandSeats] = useState("1");

  useEffect(() => {
    loadDriverInfo();
  }, []);

  const loadDriverInfo = async () => {
    const user = auth.currentUser;

    if (!user) {
      router.replace("/");
      return;
    }

    const userSnap = await getDoc(doc(db, "users", user.uid));

    if (userSnap.exists()) {
      const data = userSnap.data();

      setDriverName(data.name || "");
      setPhone(getDigitsOnly(data.phone || ""));

      if (data.gender === "Female") {
        setGender("female");
      } else {
        setGender("male");
      }

      if (data.language === "عربي") {
        setLanguages(["ar"]);
      } else if (data.language === "עברית") {
        setLanguages(["he"]);
      } else if (data.language === "English") {
        setLanguages(["en"]);
      }
    }
  };

  const toggleLanguage = (lang: string) => {
    if (languages.includes(lang)) {
      setLanguages(languages.filter((item) => item !== lang));
    } else {
      setLanguages([...languages, lang]);
    }
  };

  const toggleDay = (day: string) => {
    if (availableDays.includes(day)) {
      setAvailableDays(availableDays.filter((item) => item !== day));
    } else {
      setAvailableDays([...availableDays, day]);
    }
  };

  const handleCreateWorkJob = async (userId: string) => {
    if (
      !driverName ||
      !phone ||
      !jobTitle ||
      !jobDescription ||
      !jobLocation ||
      !jobDate ||
      !jobDay ||
      !startTime ||
      !endTime ||
      !hourlyPay ||
      !workersNeeded
    ) {
      Alert.alert("Missing details", "Please fill in all work details.");
      return;
    }

    const cleanPhone = getDigitsOnly(phone);

    if (cleanPhone.length !== 10) {
      Alert.alert(
        "Invalid phone number",
        "Phone number must be exactly 10 digits.",
      );
      return;
    }

    const cleanJobDate = normalizeDateToYMD(jobDate);

    if (!cleanJobDate) {
      Alert.alert(
        "Invalid date",
        "Work date must be today or a future date. You can write it like 2026-07-04 or 04/07/2026.",
      );
      return;
    }

    const cleanStartTime = normalizeTime(startTime);
    const cleanEndTime = normalizeTime(endTime);

    if (!cleanStartTime || !cleanEndTime) {
      Alert.alert(
        "Invalid time",
        "Please enter valid start and end time between 00:00 and 23:59.",
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

    if (languages.length === 0) {
      Alert.alert("Missing language", "Please choose at least one language.");
      return;
    }

    try {
      setLoading(true);

      await addDoc(collection(db, "workJobs"), {
        employerId: userId,
        employerName: driverName,
        phone: cleanPhone,
        gender,
        languages,

        jobTitle,
        jobTitleNormalized: normalize(jobTitle),
        description: jobDescription,

        location: jobLocation,
        locationNormalized: normalize(jobLocation),

        date: cleanJobDate,
        day: jobDay,
        startTime: cleanStartTime,
        endTime: cleanEndTime,

        hourlyPay: cleanHourlyPay,
        workersNeeded: cleanWorkersNeeded,

        rating: 4.8,
        reviews: 0,
        active: true,
        category: "workErrands",

        createdAt: serverTimestamp(),
      });

      Alert.alert("Success", "Your work job was created successfully.");
      router.replace("/(tabs)/home" as any);
    } catch (error: any) {
      Alert.alert("Error", error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateErrandJob = async (userId: string) => {
    if (
      !driverName ||
      !phone ||
      !errandTitle ||
      !errandDescription ||
      !errandLocation ||
      !errandDate ||
      !errandDay ||
      !errandStartTime ||
      !errandEndTime ||
      !errandPrice ||
      !errandSeats
    ) {
      Alert.alert("Missing details", "Please fill in all errand details.");
      return;
    }

    const cleanPhone = getDigitsOnly(phone);

    if (cleanPhone.length !== 10) {
      Alert.alert(
        "Invalid phone number",
        "Phone number must be exactly 10 digits.",
      );
      return;
    }

    const cleanErrandDate = normalizeDateToYMD(errandDate);

    if (!cleanErrandDate) {
      Alert.alert(
        "Invalid date",
        "Errand date must be today or a future date. You can write it like 2026-07-04 or 04/07/2026.",
      );
      return;
    }

    const cleanStartTime = normalizeTime(errandStartTime);
    const cleanEndTime = normalizeTime(errandEndTime);

    if (!cleanStartTime || !cleanEndTime) {
      Alert.alert(
        "Invalid time",
        "Please enter valid start and end time between 00:00 and 23:59.",
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

    if (languages.length === 0) {
      Alert.alert("Missing language", "Please choose at least one language.");
      return;
    }

    try {
      setLoading(true);

      await addDoc(collection(db, "errandJobs"), {
        ownerId: userId,
        ownerName: driverName,
        phone: cleanPhone,
        gender,
        languages,

        errandTitle,
        errandTitleNormalized: normalize(errandTitle),
        description: errandDescription,

        location: errandLocation,
        locationNormalized: normalize(errandLocation),

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
      Alert.alert("Error", error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    const user = auth.currentUser;

    if (!user) {
      Alert.alert("Login required", "Please login first.");
      router.replace("/");
      return;
    }

    if (!tripType) {
      Alert.alert("Missing type", "Please choose a type.");
      return;
    }

    if (tripType === "workErrands") {
      await handleCreateWorkJob(user.uid);
      return;
    }

    if (tripType === "errands") {
      await handleCreateErrandJob(user.uid);
      return;
    }

    if (
      !driverName ||
      !phone ||
      !car ||
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

    const cleanPhone = getDigitsOnly(phone);

    if (cleanPhone.length !== 10) {
      Alert.alert(
        "Invalid phone number",
        "Phone number must be exactly 10 digits.",
      );
      return;
    }

    const cleanTripDate = normalizeDateToYMD(tripDate);

    if (!cleanTripDate) {
      Alert.alert(
        "Invalid date",
        "Travel date must be today or a future date. You can write it like 2026-07-04 or 04/07/2026.",
      );
      return;
    }

    const cleanTime = normalizeTime(time);

    if (!cleanTime) {
      Alert.alert(
        "Invalid time",
        "Please enter a valid time between 00:00 and 23:59.",
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

    if (availableDays.length === 0) {
      Alert.alert("Missing days", "Please choose at least one available day.");
      return;
    }

    if (languages.length === 0) {
      Alert.alert("Missing language", "Please choose at least one language.");
      return;
    }

    try {
      setLoading(true);

      await addDoc(collection(db, "driverRoutes"), {
        driverId: user.uid,
        driverName,
        phone: cleanPhone,
        car,
        gender,
        languages,

        category: tripType,
        from,
        to,
        fromNormalized: normalize(from),
        toNormalized: normalize(to),

        tripDate: cleanTripDate,
        availableDays,
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
      Alert.alert("Error", error.message);
    } finally {
      setLoading(false);
    }
  };

  const pageTitle =
    tripType === "workErrands"
      ? "Create a Work Job"
      : tripType === "errands"
        ? "Create an Errand"
        : "Create a New Trip";

  const pageSubtitle =
    tripType === "workErrands"
      ? "Post work details for helpers to apply"
      : tripType === "errands"
        ? "Post your errand details for people to join"
        : "Set your destination, date, time, price, and available seats";

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#7C5F46" />
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.title}>{pageTitle}</Text>
          <Text style={styles.subtitle}>{pageSubtitle}</Text>

          <Text style={styles.label}>Your Info</Text>

          <TextInput
            style={styles.input}
            placeholder="Your name"
            placeholderTextColor="#8B7B6B"
            value={driverName}
            onChangeText={setDriverName}
          />

          <TextInput
            style={styles.input}
            placeholder="Phone number"
            placeholderTextColor="#8B7B6B"
            keyboardType="phone-pad"
            maxLength={10}
            value={phone}
            onChangeText={(text) => setPhone(getDigitsOnly(text).slice(0, 10))}
          />

          {tripType !== "workErrands" && tripType !== "errands" && (
            <TextInput
              style={styles.input}
              placeholder="Car model, e.g. Toyota Corolla 2022"
              placeholderTextColor="#8B7B6B"
              value={car}
              onChangeText={setCar}
            />
          )}

          <Text style={styles.label}>
            {tripType === "workErrands"
              ? "Employer Gender"
              : tripType === "errands"
                ? "Person Gender"
                : "Driver Gender"}
          </Text>

          <View style={styles.optionRow}>
            <Pressable
              style={[
                styles.optionButton,
                gender === "male" && styles.optionButtonActive,
              ]}
              onPress={() => setGender("male")}
            >
              <Text
                style={[
                  styles.optionText,
                  gender === "male" && styles.optionTextActive,
                ]}
              >
                Male
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.optionButton,
                gender === "female" && styles.optionButtonActive,
              ]}
              onPress={() => setGender("female")}
            >
              <Text
                style={[
                  styles.optionText,
                  gender === "female" && styles.optionTextActive,
                ]}
              >
                Female
              </Text>
            </Pressable>
          </View>

          <Text style={styles.label}>
            {tripType === "workErrands"
              ? "Languages Needed"
              : tripType === "errands"
                ? "Languages"
                : "Driver Speaks"}
          </Text>

          <View style={styles.languageRow}>
            {languageOptions.map((lang) => {
              const active = languages.includes(lang.key);

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

          <Text style={styles.label}>Type</Text>

          <View style={styles.tripGrid}>
            {tripTypes.map((type) => {
              const selected = tripType === type.key;

              return (
                <Pressable
                  key={type.key}
                  style={[styles.tripType, selected && styles.tripTypeActive]}
                  onPress={() => setTripType(type.key)}
                >
                  <View
                    style={[
                      styles.iconBox,
                      { backgroundColor: `${type.color}20` },
                    ]}
                  >
                    <Ionicons name={type.icon} size={24} color={type.color} />
                  </View>

                  <Text style={styles.tripText}>{type.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {tripType === "workErrands" && (
            <>
              <Text style={styles.label}>Job Title</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Carpenter, Painter, Cleaner"
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

              <Text style={styles.label}>Work Location</Text>
              <View style={styles.inputRow}>
                <Ionicons name="location-outline" size={18} color="#8B7B6B" />
                <TextInput
                  style={styles.rowInput}
                  placeholder="e.g. Nazareth"
                  placeholderTextColor="#8B7B6B"
                  value={jobLocation}
                  onChangeText={setJobLocation}
                />
              </View>

              <Text style={styles.label}>Work Date</Text>
              <View style={styles.inputRow}>
                <Ionicons name="calendar-outline" size={18} color="#8B7B6B" />
                <TextInput
                  style={styles.rowInput}
                  placeholder="e.g. 2026-07-04 or 04/07/2026"
                  placeholderTextColor="#8B7B6B"
                  keyboardType="numbers-and-punctuation"
                  maxLength={10}
                  value={jobDate}
                  onChangeText={(text) => setJobDate(text.slice(0, 10))}
                />
              </View>

              <Text style={styles.label}>Work Day</Text>
              <View style={styles.daysRow}>
                {days.map((day) => {
                  const active = jobDay === day;

                  return (
                    <Pressable
                      key={day}
                      style={[
                        styles.dayButton,
                        active && styles.dayButtonActive,
                      ]}
                      onPress={() => setJobDay(day)}
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

              <View style={styles.twoColumns}>
                <View style={styles.column}>
                  <Text style={styles.label}>Start Time</Text>
                  <View style={styles.inputRow}>
                    <Ionicons name="time-outline" size={18} color="#8B7B6B" />
                    <TextInput
                      style={styles.rowInput}
                      placeholder="08:00"
                      placeholderTextColor="#8B7B6B"
                      keyboardType="numbers-and-punctuation"
                      maxLength={5}
                      value={startTime}
                      onChangeText={(text) =>
                        setStartTime(text.replace(/[^\d:]/g, "").slice(0, 5))
                      }
                    />
                  </View>
                </View>

                <View style={styles.column}>
                  <Text style={styles.label}>End Time</Text>
                  <View style={styles.inputRow}>
                    <Ionicons name="time-outline" size={18} color="#8B7B6B" />
                    <TextInput
                      style={styles.rowInput}
                      placeholder="16:00"
                      placeholderTextColor="#8B7B6B"
                      keyboardType="numbers-and-punctuation"
                      maxLength={5}
                      value={endTime}
                      onChangeText={(text) =>
                        setEndTime(text.replace(/[^\d:]/g, "").slice(0, 5))
                      }
                    />
                  </View>
                </View>
              </View>

              <View style={styles.twoColumns}>
                <View style={styles.column}>
                  <Text style={styles.label}>Hourly Pay (₪)</Text>
                  <View style={styles.inputRow}>
                    <Ionicons name="cash-outline" size={18} color="#8B7B6B" />
                    <TextInput
                      style={styles.rowInput}
                      placeholder="80"
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
                      placeholder="2"
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
            </>
          )}

          {tripType === "errands" && (
            <>
              <Text style={styles.label}>Errand Title</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Shopping at Big Mall"
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

              <Text style={styles.label}>Errand Location</Text>
              <View style={styles.inputRow}>
                <Ionicons name="location-outline" size={18} color="#8B7B6B" />
                <TextInput
                  style={styles.rowInput}
                  placeholder="e.g. Nazareth"
                  placeholderTextColor="#8B7B6B"
                  value={errandLocation}
                  onChangeText={setErrandLocation}
                />
              </View>

              <Text style={styles.label}>Errand Date</Text>
              <View style={styles.inputRow}>
                <Ionicons name="calendar-outline" size={18} color="#8B7B6B" />
                <TextInput
                  style={styles.rowInput}
                  placeholder="e.g. 2026-07-04 or 04/07/2026"
                  placeholderTextColor="#8B7B6B"
                  keyboardType="numbers-and-punctuation"
                  maxLength={10}
                  value={errandDate}
                  onChangeText={(text) => setErrandDate(text.slice(0, 10))}
                />
              </View>

              <Text style={styles.label}>Errand Day</Text>
              <View style={styles.daysRow}>
                {days.map((day) => {
                  const active = errandDay === day;

                  return (
                    <Pressable
                      key={day}
                      style={[
                        styles.dayButton,
                        active && styles.dayButtonActive,
                      ]}
                      onPress={() => setErrandDay(day)}
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

              <View style={styles.twoColumns}>
                <View style={styles.column}>
                  <Text style={styles.label}>Start Time</Text>
                  <View style={styles.inputRow}>
                    <Ionicons name="time-outline" size={18} color="#8B7B6B" />
                    <TextInput
                      style={styles.rowInput}
                      placeholder="10:00"
                      placeholderTextColor="#8B7B6B"
                      keyboardType="numbers-and-punctuation"
                      maxLength={5}
                      value={errandStartTime}
                      onChangeText={(text) =>
                        setErrandStartTime(
                          text.replace(/[^\d:]/g, "").slice(0, 5),
                        )
                      }
                    />
                  </View>
                </View>

                <View style={styles.column}>
                  <Text style={styles.label}>End Time</Text>
                  <View style={styles.inputRow}>
                    <Ionicons name="time-outline" size={18} color="#8B7B6B" />
                    <TextInput
                      style={styles.rowInput}
                      placeholder="13:00"
                      placeholderTextColor="#8B7B6B"
                      keyboardType="numbers-and-punctuation"
                      maxLength={5}
                      value={errandEndTime}
                      onChangeText={(text) =>
                        setErrandEndTime(
                          text.replace(/[^\d:]/g, "").slice(0, 5),
                        )
                      }
                    />
                  </View>
                </View>
              </View>

              <View style={styles.twoColumns}>
                <View style={styles.column}>
                  <Text style={styles.label}>Price (₪)</Text>
                  <View style={styles.inputRow}>
                    <Ionicons name="cash-outline" size={18} color="#8B7B6B" />
                    <TextInput
                      style={styles.rowInput}
                      placeholder="20"
                      placeholderTextColor="#8B7B6B"
                      keyboardType="numeric"
                      value={errandPrice}
                      onChangeText={(text) =>
                        setErrandPrice(getDigitsOnly(text))
                      }
                    />
                  </View>
                </View>

                <View style={styles.column}>
                  <Text style={styles.label}>Seats Available</Text>
                  <View style={styles.inputRow}>
                    <Ionicons name="people-outline" size={18} color="#8B7B6B" />
                    <TextInput
                      style={styles.rowInput}
                      placeholder="3"
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
            </>
          )}

          {tripType !== "workErrands" && tripType !== "errands" && (
            <>
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

              <Text style={styles.label}>Travel Date</Text>
              <View style={styles.inputRow}>
                <Ionicons name="calendar-outline" size={18} color="#8B7B6B" />
                <TextInput
                  style={styles.rowInput}
                  placeholder="e.g. 2026-07-04 or 04/07/2026"
                  placeholderTextColor="#8B7B6B"
                  keyboardType="numbers-and-punctuation"
                  maxLength={10}
                  value={tripDate}
                  onChangeText={(text) => setTripDate(text.slice(0, 10))}
                />
              </View>

              <Text style={styles.label}>Available Days</Text>
              <View style={styles.daysRow}>
                {days.map((day) => {
                  const active = availableDays.includes(day);

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

              <View style={styles.twoColumns}>
                <View style={styles.column}>
                  <Text style={styles.label}>Departure Time</Text>
                  <View style={styles.inputRow}>
                    <Ionicons name="time-outline" size={18} color="#8B7B6B" />
                    <TextInput
                      style={styles.rowInput}
                      placeholder="07:30"
                      placeholderTextColor="#8B7B6B"
                      keyboardType="numbers-and-punctuation"
                      maxLength={5}
                      value={time}
                      onChangeText={(text) =>
                        setTime(text.replace(/[^\d:]/g, "").slice(0, 5))
                      }
                    />
                  </View>
                </View>

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
              </View>

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
            </>
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
              {loading
                ? "Creating..."
                : tripType === "workErrands"
                  ? "Create Work Job"
                  : tripType === "errands"
                    ? "Create Errand"
                    : "Create Trip"}
            </Text>
          </Pressable>
        </View>
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
    padding: 16,
    paddingTop: 45,
    paddingBottom: 40,
  },
  backButton: {
    width: 42,
    height: 42,
    justifyContent: "center",
    marginBottom: 8,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 22,
    borderWidth: 1,
    borderColor: "#E7DCD1",
  },
  title: {
    fontSize: 28,
    fontWeight: "900",
    color: "#111827",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: "#7C5F46",
    textAlign: "center",
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 9,
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    padding: 14,
    backgroundColor: "#FFFDFC",
    color: "#111827",
    marginBottom: 10,
  },
  textArea: {
    minHeight: 90,
    textAlignVertical: "top",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: "#FFFDFC",
  },
  rowInput: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 8,
    color: "#111827",
  },
  tripGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tripType: {
    width: "31.8%",
    minHeight: 100,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
    backgroundColor: "#FFFFFF",
  },
  tripTypeActive: {
    borderColor: "#F58220",
    backgroundColor: "#FFF8F2",
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  tripText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#111827",
    textAlign: "center",
  },
  twoColumns: {
    flexDirection: "row",
    gap: 12,
  },
  column: {
    flex: 1,
  },
  optionRow: {
    flexDirection: "row",
    gap: 8,
  },
  optionButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  optionButtonActive: {
    backgroundColor: "#F58220",
    borderColor: "#F58220",
  },
  optionText: {
    color: "#7C5F46",
    fontWeight: "800",
  },
  optionTextActive: {
    color: "#FFFFFF",
  },
  languageRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  languageButton: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
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
  submitButton: {
    backgroundColor: "#F58220",
    borderRadius: 12,
    padding: 16,
    marginTop: 24,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitText: {
    color: "#FFFFFF",
    textAlign: "center",
    fontWeight: "900",
    fontSize: 16,
  },
});
