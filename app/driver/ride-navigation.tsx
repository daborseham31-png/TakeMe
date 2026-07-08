import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
import { doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
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
import { normalizeRideBooking, RideBooking } from "../booking/rideBookingLib";

type TripStatus =
  | "booked"
  | "driver_on_way"
  | "arrived_pickup"
  | "in_progress"
  | "completed";

const getTripStatus = (booking: any): TripStatus => {
  if (booking?.tripStatus) return booking.tripStatus;
  if (booking?.status === "completed") return "completed";
  if (booking?.status === "arrived") return "arrived_pickup";
  return "booked";
};

// Live tracking يظهر للراكب فقط بعد ما الولد يطلع بالسيارة ويكبس السائق Start Trip.
const shouldTrackDriver = (status: TripStatus) => {
  return status === "in_progress";
};

const getDriverLocation = (booking: any) => {
  const lat = Number(booking?.driverLocation?.latitude);
  const lng = Number(booking?.driverLocation?.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return { latitude: lat, longitude: lng };
};

export default function RideNavigationScreen() {
  const params = useLocalSearchParams();
  const id = typeof params.id === "string" ? params.id : "";

  const [booking, setBooking] = useState<RideBooking | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }

    const unsub = onSnapshot(
      doc(db, "bookings", id),
      (snap) => {
        if (snap.exists()) {
          const rawData = snap.data();

          setBooking({
            ...(normalizeRideBooking(snap.id, rawData) as any),
            ...rawData,
            id: snap.id,
          } as RideBooking);
        }

        setLoading(false);
      },
      () => setLoading(false),
    );

    return unsub;
  }, [id]);

  const coords = (b: any) => {
    const lat = b?.pickup?.latitude ?? b?.pickupCoords?.latitude;
    const lng = b?.pickup?.longitude ?? b?.pickupCoords?.longitude;

    if (typeof lat !== "number" || typeof lng !== "number") return null;

    return { lat, lng };
  };

  const updateDriverLocationOnce = async () => {
    if (!id) return;

    const permission = await Location.requestForegroundPermissionsAsync();

    if (permission.status !== "granted") {
      Alert.alert(
        "Location permission",
        "Please allow location access so the passenger can track the ride.",
      );
      return;
    }

    const current = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    await updateDoc(doc(db, "bookings", id), {
      driverLocation: {
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
        accuracy: current.coords.accuracy ?? null,
        heading: current.coords.heading ?? null,
        speed: current.coords.speed ?? null,
      },
      driverLocationUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  };

useEffect(() => {
  if (!booking || !id) return;

  const tripStatus = getTripStatus(booking);

  // التتبع الحقيقي يشتغل بس بعد Start Trip
  if (tripStatus !== "in_progress") return;

  let subscription: Location.LocationSubscription | null = null;
  let cancelled = false;

  const startLiveTracking = async () => {
    const permission = await Location.requestForegroundPermissionsAsync();

    if (permission.status !== "granted") {
      Alert.alert(
        "Location permission",
        "Please allow location access so the passenger can track the ride.",
      );
      return;
    }

    subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 3000,
        distanceInterval: 5,
      },
      async (location) => {
        if (cancelled) return;

        try {
          await updateDoc(doc(db, "bookings", id), {
            driverLocation: {
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
              accuracy: location.coords.accuracy ?? null,
              heading: location.coords.heading ?? null,
              speed: location.coords.speed ?? null,
            },
            driverLocationUpdatedAt: serverTimestamp(),
            trackingEnabled: true,
            updatedAt: serverTimestamp(),
          });
        } catch (error) {
          console.log("Could not update driver location", error);
        }
      },
    );
  };

  startLiveTracking();

  return () => {
    cancelled = true;

    if (subscription) {
      subscription.remove();
    }
  };
}, [id, booking]);

  const updateTripStatus = async (nextStatus: TripStatus) => {
    if (!id) return;

    const payload: any = {
      tripStatus: nextStatus,
      updatedAt: serverTimestamp(),
    };

    if (nextStatus === "driver_on_way") {
      payload.status = "ongoing";
      payload.trackingEnabled = false;
      payload.needsPassengerRating = false;
      payload.driverOnWayAt = serverTimestamp();
    }

    if (nextStatus === "arrived_pickup") {
      payload.status = "arrived";
      payload.trackingEnabled = false;
      payload.needsPassengerRating = false;
      payload.arrivedPickupAt = serverTimestamp();
    }

    if (nextStatus === "in_progress") {
      payload.status = "ongoing";
      payload.trackingEnabled = true;
      payload.needsPassengerRating = false;
      payload.tripStartedAt = serverTimestamp();
    }

    if (nextStatus === "completed") {
      payload.status = "completed";
      payload.tripStatus = "completed";
      payload.trackingEnabled = false;
      payload.completedAt = serverTimestamp();
      payload.finishedByDriver = true;

      // التقييم يظهر عند المسافر فقط بعد End Trip.
      payload.needsPassengerRating = true;
      payload.ratingSubmitted = false;
      payload.rating = null;
      payload.reviewComment = "";
    }

    await updateDoc(doc(db, "bookings", id), payload);

    if (nextStatus === "completed" && (booking as any)?.routeId) {
      await updateDoc(doc(db, "driverRoutes", (booking as any).routeId), {
        status: "completed",
        tripStatus: "completed",
        available: false,
        isBooked: true,
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    if (nextStatus === "in_progress") {
      await updateDriverLocationOnce();
    }
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

  const handleStartDriving = () => {
    Alert.alert("Start driving", "Start driving to pickup?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Start",
        onPress: async () => {
          try {
            setBusy(true);
            await updateTripStatus("driver_on_way");
          } catch (error: any) {
            Alert.alert("Error", error?.message || "Could not update.");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const handleArrived = () => {
    Alert.alert("Confirm arrival", "Let the passenger know you have arrived?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "I arrived",
        onPress: async () => {
          try {
            setBusy(true);
            await updateTripStatus("arrived_pickup");
          } catch (error: any) {
            Alert.alert("Error", error?.message || "Could not update.");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const handleStartTrip = () => {
    Alert.alert(
      "Start trip",
      "Start the trip after the passenger entered the car?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Start trip",
          onPress: async () => {
            try {
              setBusy(true);
              await updateTripStatus("in_progress");
            } catch (error: any) {
              Alert.alert("Error", error?.message || "Could not update.");
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const handleEndTrip = () => {
    Alert.alert("End trip", "End this trip and ask passenger to rate you?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "End trip",
        style: "destructive",
        onPress: async () => {
          try {
            setBusy(true);
            await updateTripStatus("completed");
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
  const driverLocation = getDriverLocation(booking);
  const tripStatus = getTripStatus(booking);
  const completed = tripStatus === "completed";

  const mapCenter = driverLocation
    ? {
        latitude: driverLocation.latitude,
        longitude: driverLocation.longitude,
      }
    : c
      ? {
          latitude: c.lat,
          longitude: c.lng,
        }
      : null;

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

        <View style={styles.statusBox}>
          <Ionicons name="radio-outline" size={18} color="#F58220" />
          <Text style={styles.statusText}>
            {tripStatus === "booked" && "Booked - not started yet"}
            {tripStatus === "driver_on_way" && "Driver on the way to pickup"}
            {tripStatus === "arrived_pickup" && "Arrived at pickup"}
            {tripStatus === "in_progress" && "Trip in progress"}
            {tripStatus === "completed" && "Trip completed"}
          </Text>
        </View>

        {mapCenter ? (
          <View style={styles.mapWrapper}>
            <MapView
              style={styles.map}
              region={{
                latitude: mapCenter.latitude,
                longitude: mapCenter.longitude,
                latitudeDelta: 0.02,
                longitudeDelta: 0.02,
              }}
            >
              {c ? (
                <Marker
                  coordinate={{ latitude: c.lat, longitude: c.lng }}
                  title={(booking as any).passengerName}
                  description="Pickup location"
                  pinColor="#F58220"
                />
              ) : null}

              {driverLocation ? (
                <Marker
                  coordinate={driverLocation}
                  title="Your location"
                  description="Live driver location"
                >
                  <View style={styles.driverMarker}>
                    <Ionicons name="car" size={18} color="#FFFFFF" />
                  </View>
                </Marker>
              ) : null}
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
            <Text style={styles.infoText}>{(booking as any).passengerName}</Text>
          </View>

          {(booking as any).passengerPhone ? (
            <Pressable
              style={styles.infoRow}
              onPress={() =>
                Linking.openURL(`tel:${(booking as any).passengerPhone}`).catch(
                  () => {},
                )
              }
            >
              <Ionicons name="call-outline" size={16} color="#F58220" />
              <Text style={[styles.infoText, styles.phone]}>
                {(booking as any).passengerPhone}
              </Text>
            </Pressable>
          ) : null}

          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={16} color="#7C5F46" />
            <Text style={styles.infoText}>
              {(booking as any).from || "?"} → {(booking as any).to || "?"}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="navigate-circle-outline" size={16} color="#7C5F46" />
            <Text style={styles.infoText}>
              {c
                ? (booking as any).pickup?.address ||
                  `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`
                : "Exact pickup not available"}
            </Text>
          </View>

          {(booking as any).date ? (
            <View style={styles.infoRow}>
              <Ionicons name="calendar-outline" size={16} color="#7C5F46" />
              <Text style={styles.infoText}>
                {(booking as any).date}
                {(booking as any).day ? ` (${(booking as any).day})` : ""}
              </Text>
            </View>
          ) : null}

          {(booking as any).time ? (
            <View style={styles.infoRow}>
              <Ionicons name="time-outline" size={16} color="#7C5F46" />
              <Text style={styles.infoText}>{(booking as any).time}</Text>
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
        ) : (
          <View style={styles.actionsCard}>
            {tripStatus === "booked" ? (
              <Pressable
                style={[styles.actionButton, busy && styles.disabled]}
                onPress={handleStartDriving}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="car-outline" size={19} color="#FFFFFF" />
                    <Text style={styles.actionText}>Start Driving to Pickup</Text>
                  </>
                )}
              </Pressable>
            ) : null}

            {tripStatus === "driver_on_way" ? (
              <Pressable
                style={[styles.actionButton, busy && styles.disabled]}
                onPress={handleArrived}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="flag" size={19} color="#FFFFFF" />
                    <Text style={styles.actionText}>I arrived at pickup</Text>
                  </>
                )}
              </Pressable>
            ) : null}

            {tripStatus === "arrived_pickup" ? (
              <Pressable
                style={[styles.actionButton, busy && styles.disabled]}
                onPress={handleStartTrip}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons
                      name="play-circle-outline"
                      size={20}
                      color="#FFFFFF"
                    />
                    <Text style={styles.actionText}>Start Trip</Text>
                  </>
                )}
              </Pressable>
            ) : null}

            {tripStatus === "in_progress" ? (
              <Pressable
                style={[styles.endButton, busy && styles.disabled]}
                onPress={handleEndTrip}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons
                      name="checkmark-circle-outline"
                      size={20}
                      color="#FFFFFF"
                    />
                    <Text style={styles.actionText}>End Trip</Text>
                  </>
                )}
              </Pressable>
            ) : null}

            {shouldTrackDriver(tripStatus) ? (
              <Text style={styles.trackingHint}>
                Live tracking is active while this trip is running.
              </Text>
            ) : null}
          </View>
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
  statusBox: {
    backgroundColor: "#FFF8F2",
    borderWidth: 1,
    borderColor: "#FFE2C5",
    borderRadius: 14,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  statusText: {
    color: "#B86115",
    fontWeight: "900",
    fontSize: 14,
    flexShrink: 1,
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
  driverMarker: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F58220",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#FFFFFF",
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
  actionsCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 18,
    padding: 14,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#F58220",
    borderRadius: 14,
    paddingVertical: 16,
  },
  endButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#166534",
    borderRadius: 14,
    paddingVertical: 16,
  },
  actionText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 16,
  },
  trackingHint: {
    marginTop: 12,
    color: "#7C5F46",
    fontWeight: "800",
    fontSize: 13,
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
