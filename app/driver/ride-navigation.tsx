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
import { canStartTrip, getStartTripBlockedReason } from "../booking/bookingsLib";
import { normalizeRideBooking, RideBooking } from "../booking/rideBookingLib";
import { notify } from "../booking/work-errand/workErrandLib";

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

// Live tracking starts as soon as the driver arrives for pickup (there is no
// separate "Start Trip" step) and stays on until Finish Trip.
const shouldTrackDriver = (status: TripStatus) => {
  return status === "arrived_pickup";
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

  // Exact GPS pickup point, if the passenger captured one — checked across
  // every field name this has ever been saved under. This is completely
  // separate from booking.from/to (the manual matching fields).
  const coords = (b: any) => {
    const lat =
      b?.pickupLatitude ??
      b?.pickup?.latitude ??
      b?.pickupCoords?.latitude ??
      b?.pickupLocation?.latitude ??
      b?.passengerPickupLocation?.latitude;
    const lng =
      b?.pickupLongitude ??
      b?.pickup?.longitude ??
      b?.pickupCoords?.longitude ??
      b?.pickupLocation?.longitude ??
      b?.passengerPickupLocation?.longitude;

    if (typeof lat !== "number" || typeof lng !== "number") return null;

    return { lat, lng };
  };

  // The exact readable address, if one was captured (independent of the
  // coordinates above — used only as a last-resort navigation target).
  const pickupAddressText = (b: any): string =>
    b?.pickupAddress || b?.pickup?.address || b?.passengerPickupLocation?.address || "";

  // Navigation destination with the exact fallback chain: precise
  // coordinates -> exact pickup address text -> manual From address. This
  // is ONLY for guiding the driver to the passenger — never used to decide
  // which drivers a passenger sees (that's from/to matching, elsewhere).
  type NavTarget =
    | { kind: "coords"; lat: number; lng: number }
    | { kind: "text"; text: string }
    | null;

  const getNavTarget = (b: any): NavTarget => {
    const c = coords(b);
    if (c) return { kind: "coords", lat: c.lat, lng: c.lng };

    const address = pickupAddressText(b);
    if (address) return { kind: "text", text: address };

    if (b?.from) return { kind: "text", text: b.from };

    return null;
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

  // Live location updates run while the driver has arrived for pickup, up
  // until Finish Trip.
  if (tripStatus !== "arrived_pickup") return;

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
    if (!id || !booking) return;

    // Guard the actual write, not just the button — this is the one place
    // that flips tripStatus to driver_on_way for school + weekly bookings
    // reached through this screen, so it must never allow starting a trip
    // outside its own trip date even if this gets called some other way.
    if (nextStatus === "driver_on_way" && !canStartTrip(booking)) {
      Alert.alert(
        "Not available yet",
        getStartTripBlockedReason(booking) ||
          "You can start this trip only on the trip date.",
      );
      return;
    }

    const payload: any = {
      tripStatus: nextStatus,
      updatedAt: serverTimestamp(),
    };

    if (nextStatus === "driver_on_way") {
      payload.status = "on_the_way";
      payload.trackingEnabled = false;
      payload.needsPassengerRating = false;
      payload.driverOnWayAt = serverTimestamp();
    }

    if (nextStatus === "arrived_pickup") {
      payload.status = "arrived";
      payload.trackingEnabled = true;
      payload.needsPassengerRating = false;
      payload.arrivedPickupAt = serverTimestamp();
    }

    if (nextStatus === "completed") {
      payload.status = "completed";
      payload.tripStatus = "completed";
      payload.trackingEnabled = false;
      payload.completedAt = serverTimestamp();
      payload.finishedByDriver = true;

      // The rating popup only appears for the passenger after Finish Trip.
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

    if (nextStatus === "arrived_pickup") {
      await updateDriverLocationOnce();
    }

    const passengerId = (booking as any).passengerId;
    const category = (booking as any).category || "personal_ride";

    if (passengerId && nextStatus === "driver_on_way") {
      await notify({
        receiverId: passengerId,
        type: "ride_on_the_way",
        title: "Driver on the way",
        message: "Your driver is on the way",
        applicationId: id,
        bookingId: id,
        category,
        status: "on_the_way",
        targetTab: "passenger",
      });
    }

    if (passengerId && nextStatus === "arrived_pickup") {
      await notify({
        receiverId: passengerId,
        type: "ride_arrived",
        title: "Driver arrived",
        message: "Your driver has arrived",
        applicationId: id,
        bookingId: id,
        category,
        status: "arrived",
        targetTab: "passenger",
      });
    }

    if (passengerId && nextStatus === "completed") {
      await notify({
        receiverId: passengerId,
        type: "ride_trip_completed",
        title: "Trip completed",
        message: "Your trip is completed. Please rate your driver.",
        applicationId: id,
        bookingId: id,
        category,
        status: "completed",
        targetTab: "passenger",
      });
    }
  };

  const openMaps = (b: RideBooking) => {
    const target = getNavTarget(b);

    if (!target) {
      Alert.alert("Location", "Pickup location is not available.");
      return;
    }

    const url =
      target.kind === "coords"
        ? `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}`
        : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(target.text)}`;

    Linking.openURL(url).catch(() =>
      Alert.alert("Error", "Could not open maps."),
    );
  };

  const openWaze = (b: RideBooking) => {
    const target = getNavTarget(b);

    if (!target) {
      Alert.alert("Location", "Pickup location is not available.");
      return;
    }

    const url =
      target.kind === "coords"
        ? `https://waze.com/ul?ll=${target.lat},${target.lng}&navigate=yes`
        : `https://waze.com/ul?q=${encodeURIComponent(target.text)}&navigate=yes`;

    Linking.openURL(url).catch(() =>
      Alert.alert("Error", "Could not open Waze."),
    );
  };

  const handleStartDriving = () => {
    if (!booking || !canStartTrip(booking)) {
      Alert.alert(
        "Not available yet",
        getStartTripBlockedReason(booking) ||
          "You can start this trip only on the trip date.",
      );
      return;
    }

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

  const handleFinishTrip = () => {
    Alert.alert(
      "Finish trip",
      "Finish this trip and ask the passenger to rate you?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Finish trip",
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
      ],
    );
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
  const canStart = canStartTrip(booking);
  const blockedReason = getStartTripBlockedReason(booking);

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
                ? pickupAddressText(booking) ||
                  `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`
                : pickupAddressText(booking) || "Exact pickup not available"}
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
              <>
                <Pressable
                  style={[
                    styles.actionButton,
                    (busy || !canStart) && styles.disabled,
                  ]}
                  onPress={handleStartDriving}
                  disabled={busy || !canStart}
                >
                  {busy ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="car-outline" size={19} color="#FFFFFF" />
                      <Text style={styles.actionText}>
                        Start Driving to Pickup
                      </Text>
                    </>
                  )}
                </Pressable>

                {!canStart && blockedReason ? (
                  <Text style={styles.gateHint}>{blockedReason}</Text>
                ) : null}
              </>
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
                style={[styles.endButton, busy && styles.disabled]}
                onPress={handleFinishTrip}
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
                    <Text style={styles.actionText}>Finish Trip</Text>
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
  gateHint: {
    marginTop: 10,
    color: "#B86115",
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
