// ---------------------------------------------------------------------------
// Shared "Use my current location" button for passenger booking forms
// (School Ride, Personal Ride). Foreground-only — location is requested
// exactly once, right when the passenger presses this button, never in the
// background and never automatically.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
} from "react-native";

export type CurrentLocationResult = {
  address: string;
  latitude: number;
  longitude: number;
};

type Props = {
  onLocated: (result: CurrentLocationResult) => void;
};

export default function CurrentLocationButton({ onLocated }: Props) {
  const [loading, setLoading] = useState(false);

  const handlePress = async () => {
    if (loading) return;

    try {
      setLoading(true);

      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        Alert.alert(
          "Location permission needed",
          "Location permission is required to use your current location. You can still enter the address manually.",
        );
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const { latitude, longitude } = position.coords;

      // Best-effort readable address — coordinates alone are still a valid
      // fallback if reverse geocoding fails or returns nothing.
      let address = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

      try {
        const results = await Location.reverseGeocodeAsync({
          latitude,
          longitude,
        });
        const place = results[0];

        if (place) {
          address =
            [place.name, place.street, place.city || place.region, place.country]
              .filter(Boolean)
              .join(", ") || address;
        }
      } catch {
        // Keep the coordinate fallback address.
      }

      onLocated({ address, latitude, longitude });
    } catch {
      Alert.alert(
        "Could not detect your location",
        "Could not detect your location. Please try again or enter the address manually.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Pressable
      style={[styles.button, loading && styles.buttonDisabled]}
      onPress={handlePress}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#F58220" />
      ) : (
        <Ionicons name="locate" size={15} color="#F58220" />
      )}
      <Text style={styles.text}>
        {loading ? "Finding your location..." : "Use my current location"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#F7D3B4",
    backgroundColor: "#FFF8F2",
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  text: {
    color: "#F58220",
    fontWeight: "800",
    fontSize: 12.5,
  },
});
