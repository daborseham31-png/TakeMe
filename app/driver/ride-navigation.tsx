import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { doc, onSnapshot } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { Marker } from "react-native-maps";

import { db } from "../../firebase";
import {
  arriveRide,
  normalizeRideBooking,
  RideBooking,
} from "../booking/rideBookingLib";

export default function RideNavigationScreen() {
  const params = useLocalSearchParams();
  const id = typeof params.id === "string" ? params.id : "";

  const [booking, setBooking] = useState<RideBooking | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Live listener so the screen reflects status changes immediately.
  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }

    const unsub = onSnapshot(
      doc(db, "bookings", id),
      (snap) => {
        if (snap.exists()) {
          setBooking(normalizeRideBooking(snap.id, snap.data()));
        }
        setLoading(false);
      },
      () => setLoading(false),
    );

    return unsub;
  }, [id]);

  // Navigation always uses the passenger's REAL detected coordinates, never the
  // typed city text. Missing coordinates are surfaced instead of guessed.
  const coords = (b: RideBooking) => {
    const lat = b.pickup?.latitude;
    const lng = b.pickup?.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    return { lat, lng };
  };

  const openMaps = (b: RideBooking) => {
    const c = coords(b);
    if (!c) {
      Alert.alert("Location", "Exact pickup location is not available.");
      return;
    }
    const url = `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`;
    Linking.openURL(url).catch(() =>
      Alert.alert("Error", "Could not open maps."),
    );
  };

  const openWaze = (b: RideBooking) => {
    const c = coords(b);
    if (!c) {
      Alert.alert("Location", "Exact pickup location is not available.");
      return;
    }
    const url = `https://waze.com/ul?ll=${c.lat},${c.lng}&navigate=yes`;
    Linking.openURL(url).catch(() =>
      Alert.alert("Error", "Could not open Waze."),
    );
  };

  const handleArrived = () => {
    if (!booking) return;
    Alert.alert("Confirm arrival", "Let the passenger know you have arrived?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "I arrived",
        onPress: async () => {
          try {
            setBusy(true);
            await arriveRide(booking.id, booking);
          } catch (error: any) {
            Alert.alert("Error", error?.message || "Could not update.");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#F58220" />
        </View>
      </SafeAreaView>
    );
  }

  if (!booking) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={44} color="#8B7B6B" />
          <Text style={styles.emptyTitle}>Booking not found</Text>
          <Pressable style={styles.backLink} onPress={() => router.back()}>
            <Text style={styles.backLinkText}>Go back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const c = coords(booking);
  const arrived = booking.status === "arrived";
  const completed = booking.status === "completed";

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#7C5F46" />
          <Text style={styles.backText}>Back</Text>
        </Pressable>

        <View style={styles.header}>
          <Ionicons name="navigate" size={26} color="#F58220" />
          <Text style={styles.title}>Ride Navigation</Text>
        </View>

        {/* Real map to the passenger's pickup location */}
        {c ? (
          <View style={styles.mapWrapper}>
            <MapView
              style={styles.map}
              initialRegion={{
                latitude: c.lat,
                longitude: c.lng,
                latitudeDelta: 0.02,
                longitudeDelta: 0.02,
              }}
            >
              <Marker
                coordinate={{ latitude: c.lat, longitude: c.lng }}
                title={booking.passengerName}
                description="Pickup location"
              />
            </MapView>
          </View>
        ) : (
          <View style={styles.mapBox}>
            <Ionicons name="map-outline" size={40} color="#F58220" />
            <Text style={styles.mapText}>
              Exact pickup location is not available for this ride.
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Ionicons name="person-outline" size={16} color="#7C5F46" />
            <Text style={styles.infoText}>{booking.passengerName}</Text>
          </View>

          {booking.passengerPhone ? (
            <Pressable
              style={styles.infoRow}
              onPress={() =>
                Linking.openURL(`tel:${booking.passengerPhone}`).catch(() => {})
              }
            >
              <Ionicons name="call-outline" size={16} color="#F58220" />
              <Text style={[styles.infoText, styles.phone]}>
                {booking.passengerPhone}
              </Text>
            </Pressable>
          ) : null}

          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={16} color="#7C5F46" />
            <Text style={styles.infoText}>
              {booking.from || "?"} → {booking.to || "?"}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="navigate-circle-outline" size={16} color="#7C5F46" />
            <Text style={styles.infoText}>
              {c
                ? booking.pickup?.address ||
                  `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`
                : "Exact pickup not available"}
            </Text>
          </View>

          {booking.date ? (
            <View style={styles.infoRow}>
              <Ionicons name="calendar-outline" size={16} color="#7C5F46" />
              <Text style={styles.infoText}>
                {booking.date}
                {booking.day ? ` (${booking.day})` : ""}
              </Text>
            </View>
          ) : null}

          {booking.time ? (
            <View style={styles.infoRow}>
              <Ionicons name="time-outline" size={16} color="#7C5F46" />
              <Text style={styles.infoText}>{booking.time}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.navRow}>
          <Pressable style={styles.navButton} onPress={() => openMaps(booking)}>
            <Ionicons name="map" size={18} color="#FFFFFF" />
            <Text style={styles.navButtonText}>Google Maps</Text>
          </Pressable>
          <Pressable
            style={[styles.navButton, styles.wazeButton]}
            onPress={() => openWaze(booking)}
          >
            <Ionicons name="navigate-circle" size={18} color="#FFFFFF" />
            <Text style={styles.navButtonText}>Waze</Text>
          </Pressable>
        </View>

        {completed ? (
          <View style={styles.doneBanner}>
            <Ionicons name="checkmark-circle" size={20} color="#166534" />
            <Text style={styles.doneText}>Ride completed</Text>
          </View>
        ) : arrived ? (
          <View style={styles.waitBanner}>
            <Ionicons name="time-outline" size={18} color="#B86115" />
            <Text style={styles.waitText}>
              Arrived — waiting for the passenger to finish the trip.
            </Text>
          </View>
        ) : (
          <Pressable
            style={[styles.arrivedButton, busy && styles.disabled]}
            onPress={handleArrived}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="flag" size={19} color="#FFFFFF" />
                <Text style={styles.arrivedText}>I arrived</Text>
              </>
            )}
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 30,
  },
  container: {
    padding: 20,
    paddingTop: 50,
    paddingBottom: 40,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 16,
  },
  backText: {
    color: "#7C5F46",
    fontWeight: "800",
    fontSize: 15,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 18,
  },
  title: {
    fontSize: 26,
    fontWeight: "900",
    color: "#111827",
  },
  mapWrapper: {
    height: 260,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    marginBottom: 18,
  },
  map: {
    width: "100%",
    height: "100%",
  },
  mapBox: {
    backgroundColor: "#FFF8F2",
    borderWidth: 1.5,
    borderColor: "#FFE2C5",
    borderRadius: 18,
    paddingVertical: 40,
    alignItems: "center",
    gap: 10,
    marginBottom: 18,
  },
  mapText: {
    color: "#B86115",
    fontWeight: "800",
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  infoText: {
    color: "#3C2319",
    fontSize: 14,
    fontWeight: "700",
    flexShrink: 1,
  },
  phone: {
    color: "#F58220",
  },
  navRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 18,
  },
  navButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#4285F4",
    borderRadius: 14,
    paddingVertical: 14,
  },
  wazeButton: {
    backgroundColor: "#33CCFF",
  },
  navButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
  },
  arrivedButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#F58220",
    borderRadius: 14,
    paddingVertical: 16,
  },
  arrivedText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 16,
  },
  waitBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#FFF2E8",
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 14,
  },
  waitText: {
    color: "#B86115",
    fontWeight: "800",
    fontSize: 14,
    flexShrink: 1,
    textAlign: "center",
  },
  disabled: {
    opacity: 0.6,
  },
  doneBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#E7F7EC",
    borderRadius: 14,
    paddingVertical: 16,
  },
  doneText: {
    color: "#166534",
    fontWeight: "900",
    fontSize: 16,
  },
  emptyTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: "#111827",
    marginTop: 12,
    marginBottom: 6,
  },
  backLink: {
    marginTop: 16,
  },
  backLinkText: {
    color: "#F58220",
    fontWeight: "900",
    fontSize: 15,
  },
});
