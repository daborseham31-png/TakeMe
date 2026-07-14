import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import IsraelLocationAutocomplete from "../../IsraelLocationAutocomplete";
import { IsraelLocation } from "../../israelLocations";
import {
  createApplication,
  detectCurrentLocation,
  GeoPoint,
} from "../workErrandLib";

type Driver = {
  id: string;
  ownerId: string;
  name: string;
  gender: "male" | "female";
  age: number;
  phone: string;
  languages: string[];
  rating: number;
  reviews: number;
  price: number;
  destination: string;
  destinationLabel: string;
  departureTime: string;
  returnTime: string;
  date: string;
  day: string;
  location: string;
  seats: number;
};

const LANGUAGES_MAP: Record<string, string> = {
  ar: "العربية",
  he: "עברית",
  en: "English",
  ru: "Русский",
};

const DESTINATION_ICONS: Record<string, string> = {
  shopping: "🛒",
  nature: "🌿",
  beach: "🏖️",
  restaurant: "🍽️",
  hospital: "🏥",
  mall: "🏬",
  gym: "💪",
  pharmacy: "💊",
  errands: "📍",
};

const defaultDriver: Driver = {
  id: "",
  ownerId: "",
  name: "Person",
  gender: "female",
  age: 0,
  phone: "",
  languages: [],
  rating: 4.8,
  reviews: 0,
  price: 0,
  destination: "errands",
  destinationLabel: "Errand",
  departureTime: "",
  returnTime: "",
  date: "",
  day: "",
  location: "",
  seats: 1,
};

export default function ErrandsBookScreen() {
  const params = useLocalSearchParams();

  const driver = useMemo(() => {
    try {
      if (typeof params.driver === "string") {
        return JSON.parse(params.driver) as Driver;
      }
    } catch {
      return defaultDriver;
    }

    return defaultDriver;
  }, [params.driver]);

  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [city, setCity] = useState("");
  const [cityPlace, setCityPlace] = useState<IsraelLocation | null>(null);
  const [cityError, setCityError] = useState("");

  const handleCityChange = (text: string) => {
    setCity(text);
    setCityPlace(null);
    if (cityError) setCityError("");
  };

  const [neighborhood, setNeighborhood] = useState("");
  const [notes, setNotes] = useState("");
  const [location, setLocation] = useState<GeoPoint | null>(null);
  const [locating, setLocating] = useState(false);

  const detectLocation = async () => {
    try {
      setLocating(true);
      const loc = await detectCurrentLocation();
      setLocation(loc);
    } catch (error: any) {
      Alert.alert(
        "Location",
        error?.message || "Could not detect your location.",
      );
    } finally {
      setLocating(false);
    }
  };

  const handleSubmit = async () => {
    const cleanCity = city.trim();
    const cleanNeighborhood = neighborhood.trim();

    if (!cleanCity || !cleanNeighborhood) {
      Alert.alert("Missing details", "Please fill City / Village and Neighborhood.");
      return;
    }

    if (!cityPlace) {
      setCityError("Please select a location from the list.");
      return;
    }

    if (!location || location.latitude === null || location.longitude === null) {
      Alert.alert(
        "Location needed",
        "Please detect your current location so the driver can reach you.",
      );
      return;
    }

    try {
      setSubmitting(true);

      await createApplication(
        "errand",
        {
          sourceId: driver.id,
          providerId: driver.ownerId,
          providerName: driver.name,
          title: driver.destinationLabel,
          date: driver.date,
          startTime: driver.departureTime,
          endTime: driver.returnTime,
          price: driver.price || null,
          seats: driver.seats || null,
        },
        {
          city: cleanCity,
          cityLocationId: cityPlace.id,
          cityLocationNames: {
            english: cityPlace.english,
            arabic: cityPlace.arabic,
            hebrew: cityPlace.hebrew,
          },
          neighborhood: cleanNeighborhood,
          notes: notes.trim(),
          location,
        },
      );

      setSubmitted(true);
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Could not send the request.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.successContainer}>
          <Ionicons name="checkmark-circle-outline" size={90} color="#F58220" />

          <Text style={styles.successTitle}>Request Sent!</Text>

          <Text style={styles.successText}>
            Your request has been sent to{" "}
            <Text style={styles.boldText}>{driver.name}</Text>. Once accepted,
            you&apos;ll continue to payment. Track it under My Bookings.
          </Text>

          <View style={styles.successButtonsRow}>
            <Pressable
              style={styles.outlineButton}
              onPress={() =>
                router.replace("/booking/work-errand/errand/errand" as any)
              }
            >
              <Text style={styles.outlineButtonText}>Browse More</Text>
            </Pressable>

            <Pressable
              style={styles.successButton}
              onPress={() => router.replace("/(tabs)/bookings" as any)}
            >
              <Text style={styles.successButtonText}>My Bookings</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable
            style={styles.backButton}
            onPress={() =>
              router.push("/booking/work-errand/errand/errand" as any)
            }
          >
            <Ionicons name="arrow-back" size={20} color="#7A665C" />
            <Text style={styles.backText}>Back</Text>
          </Pressable>

          <View style={styles.driverCard}>
            <View style={styles.driverHeader}>
              <View style={styles.avatar}>
                <Ionicons name="person-outline" size={26} color="#B45309" />
              </View>

              <View style={styles.driverInfo}>
                <Text style={styles.driverName}>{driver.name}</Text>

                <View style={styles.smallInfoRow}>
                  <Text style={styles.smallText}>
                    {driver.gender === "male" ? "♂" : "♀"} Age {driver.age}
                  </Text>

                  <Text style={styles.smallText}>•</Text>

                  <Ionicons name="star" size={14} color="#F58220" />

                  {driver.reviews > 0 ? (
                    <Text style={styles.smallText}>
                      {driver.rating.toFixed(1)} ({driver.reviews})
                    </Text>
                  ) : (
                    <Text style={styles.smallText}>New driver</Text>
                  )}
                </View>
              </View>
            </View>

            <View style={styles.destinationBox}>
              <Text style={styles.destinationIcon}>
                {DESTINATION_ICONS[driver.destination] || "📍"}
              </Text>

              <Text style={styles.destinationText}>
                {driver.destinationLabel}
              </Text>
            </View>

            <View style={styles.detailsGrid}>
              <View style={styles.detailItem}>
                <Ionicons name="calendar-outline" size={16} color="#F58220" />
                <Text style={styles.detailText}>
                  {driver.date} ({driver.day})
                </Text>
              </View>

              <View style={styles.detailItem}>
                <Ionicons name="time-outline" size={16} color="#F58220" />
                <Text style={styles.detailText}>
                  {driver.departureTime} → {driver.returnTime}
                </Text>
              </View>

              <View style={styles.detailItem}>
                <Ionicons name="location-outline" size={16} color="#F58220" />
                <Text style={styles.detailText}>{driver.location}</Text>
              </View>

              <View style={styles.detailItem}>
                <Text style={styles.price}>{driver.price} ₪</Text>
              </View>
            </View>

            <View style={styles.languagesRow}>
              {driver.languages?.map((lang) => (
                <View key={lang} style={styles.languageBadge}>
                  <Text style={styles.languageText}>{LANGUAGES_MAP[lang]}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.formCard}>
            <Text style={styles.formTitle}>✈️ Your Details</Text>

            <Text style={styles.hint}>
              Your name, age and phone are taken from your profile
              automatically.
            </Text>

            <Text style={styles.label}>Your Location</Text>
            <Pressable
              style={styles.locationBox}
              onPress={detectLocation}
              disabled={locating}
            >
              <Ionicons
                name={location ? "location" : "locate-outline"}
                size={20}
                color="#F58220"
              />
              <Text style={styles.locationText} numberOfLines={2}>
                {locating
                  ? "Detecting your location..."
                  : location
                    ? location.address || "Current location detected"
                    : "Tap to detect my current location"}
              </Text>
              {location ? (
                <Ionicons name="checkmark-circle" size={20} color="#16A34A" />
              ) : null}
            </Pressable>

            <View style={styles.row}>
              <View style={styles.halfField}>
                <IsraelLocationAutocomplete
                  label="City / Village"
                  value={city}
                  onChangeText={handleCityChange}
                  onSelectLocation={(location) => {
                    setCityPlace(location);
                    setCityError("");
                  }}
                  placeholder="Enter city or village"
                  error={cityError}
                />
              </View>

              <View style={styles.halfField}>
                <Text style={styles.label}>Neighborhood</Text>
                <TextInput
                  style={styles.input}
                  value={neighborhood}
                  onChangeText={setNeighborhood}
                  placeholder="Enter neighborhood"
                  placeholderTextColor="#9B7A68"
                  maxLength={100}
                />
              </View>
            </View>

            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Anything the driver should know"
              placeholderTextColor="#9B7A68"
              multiline
            />

            <Pressable
              style={[styles.sendButton, submitting && styles.sendDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              <Ionicons name="paper-plane-outline" size={19} color="#FFFFFF" />
              <Text style={styles.sendButtonText}>
                {submitting ? "Sending..." : "Send Request"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  keyboard: {
    flex: 1,
  },
  container: {
    paddingHorizontal: 20,
    paddingTop: 30,
    paddingBottom: 40,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    marginBottom: 20,
  },
  backText: {
    fontSize: 16,
    color: "#7A665C",
  },
  driverCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E4DDD7",
    borderRadius: 14,
    padding: 18,
    marginBottom: 24,
  },
  driverHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#FFF3E6",
    alignItems: "center",
    justifyContent: "center",
  },
  driverInfo: {
    flex: 1,
  },
  driverName: {
    fontSize: 20,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 4,
  },
  smallInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  smallText: {
    fontSize: 14,
    color: "#7A5C4B",
  },
  destinationBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#F5F1ED",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  destinationIcon: {
    fontSize: 22,
  },
  destinationText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#111827",
  },
  detailsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 12,
    marginBottom: 14,
  },
  detailItem: {
    width: "50%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingRight: 6,
  },
  detailText: {
    fontSize: 14,
    color: "#111827",
    flexShrink: 1,
  },
  price: {
    fontSize: 15,
    color: "#111827",
    fontWeight: "900",
  },
  languagesRow: {
    flexDirection: "row",
    gap: 7,
    flexWrap: "wrap",
  },
  languageBadge: {
    backgroundColor: "#2F9B95",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  languageText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  formCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E4DDD7",
    borderRadius: 14,
    padding: 18,
  },
  formTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 10,
  },
  hint: {
    fontSize: 13,
    color: "#7A5C4B",
    marginBottom: 14,
    lineHeight: 18,
  },
  locationBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FFF8F2",
    borderWidth: 1.5,
    borderColor: "#FFE2C5",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 6,
  },
  locationText: {
    flex: 1,
    color: "#3C2319",
    fontSize: 14,
    fontWeight: "700",
  },
  row: {
    flexDirection: "row",
    gap: 14,
  },
  halfField: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 8,
    marginTop: 10,
  },
  input: {
    minHeight: 46,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E4DDD7",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: "#111827",
    marginBottom: 10,
  },
  textArea: {
    minHeight: 90,
    textAlignVertical: "top",
  },
  sendButton: {
    backgroundColor: "#F58220",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
  },
  sendDisabled: {
    opacity: 0.6,
  },
  sendButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  successContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  successTitle: {
    fontSize: 26,
    fontWeight: "900",
    color: "#111827",
    marginTop: 18,
    marginBottom: 10,
  },
  successText: {
    fontSize: 16,
    color: "#7A5C4B",
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 26,
  },
  boldText: {
    fontWeight: "900",
    color: "#111827",
  },
  successButtonsRow: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
    flexWrap: "wrap",
  },
  outlineButton: {
    borderWidth: 1,
    borderColor: "#E4DDD7",
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 18,
  },
  outlineButtonText: {
    color: "#111827",
    fontSize: 15,
    fontWeight: "900",
  },
  successButton: {
    backgroundColor: "#F58220",
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 18,
  },
  successButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
});
