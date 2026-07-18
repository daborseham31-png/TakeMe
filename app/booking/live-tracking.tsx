import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { doc, onSnapshot } from "firebase/firestore";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import { useTranslation } from "react-i18next";

import { db } from "../../firebase";
import { useLanguage } from "../i18n/LanguageProvider";

type LatLng = {
  latitude: number;
  longitude: number;
};

const toLatLng = (value: any): LatLng | null => {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
};

const getStatusKey = (booking: any) => {
  const status = booking?.tripStatus || booking?.status;

  if (status === "driver_on_way") return "rides.driverOnWay";
  if (status === "arrived_pickup") return "rides.driverArrivedPickup";
  if (status === "in_progress") return "rides.tripInProgress";
  if (status === "completed") return "rides.tripCompleted";

  return "rides.waitingForDriver";
};

export default function LiveTrackingScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const params = useLocalSearchParams();
  const id = typeof params.id === "string" ? params.id : "";

  // A school trip's live location lives on the schoolTrips/{id} doc itself
  // (one car, shared by every passenger booked on it — see
  // app/driver/ride-navigation.tsx's top-of-file comment), so `id` here is
  // the tripId, not a booking id, whenever source=schoolTrips.
  const isSchoolTripsSource = String(params.source || "") === "schoolTrips";
  const bookingCollection = isSchoolTripsSource ? "schoolTrips" : "bookings";

  const mapRef = useRef<MapView | null>(null);

  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState<any | null>(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }

    const unsub = onSnapshot(
      doc(db, bookingCollection, id),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();

          setBooking({
            id: snap.id,
            ...data,
            // Field-name aliases (SchoolTrip uses fromAddress/toAddress/
            // departureTime — every other read below, shared with Personal
            // Ride, expects from/to/time).
            ...(isSchoolTripsSource
              ? { from: data.fromAddress, to: data.toAddress, time: data.departureTime }
              : {}),
          });
        } else {
          setBooking(null);
        }

        setLoading(false);
      },
      () => setLoading(false),
    );

    return unsub;
  }, [id]);

  const driverLocation = useMemo(
    () => toLatLng(booking?.driverLocation),
    [booking],
  );

  const pickupLocation = useMemo(() => {
    return (
      toLatLng(booking?.pickupCoords) ||
      toLatLng(booking?.pickup) ||
      toLatLng(booking?.passengerPickupLocation) ||
      // A school trip's own "From" GPS point (see ride-navigation.tsx's
      // matching fallback).
      toLatLng(booking?.fromLocation)
    );
  }, [booking]);

  const schoolLocation = useMemo(() => {
    return (
      toLatLng(booking?.schoolCoords) ||
      toLatLng(booking?.destinationCoords) ||
      toLatLng(booking?.schoolLocation)
    );
  }, [booking]);

  const mapCenter = driverLocation || pickupLocation || schoolLocation;

  useEffect(() => {
    if (!driverLocation || !mapRef.current) return;

    mapRef.current.animateToRegion(
      {
        latitude: driverLocation.latitude,
        longitude: driverLocation.longitude,
        latitudeDelta: 0.015,
        longitudeDelta: 0.015,
      },
      700,
    );
  }, [driverLocation]);

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
          <Text style={styles.emptyTitle}>{t("rides.bookingNotFound")}</Text>
          <Pressable style={styles.backButtonSmall} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>{t("common.goBack")}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const trackingActive = booking.trackingEnabled === true;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons
            name={isRTL ? "arrow-forward" : "arrow-back"}
            size={22}
            color="#7C5F46"
          />
          <Text style={styles.backText}>{t("common.back")}</Text>
        </Pressable>

        <View style={styles.header}>
          <Ionicons name="car" size={28} color="#F58220" />
          <Text style={styles.title}>{t("rides.liveTracking")}</Text>
        </View>

        <View style={styles.statusBox}>
          <Ionicons
            name={trackingActive ? "radio" : "time-outline"}
            size={18}
            color={trackingActive ? "#166534" : "#B86115"}
          />
          <Text
            style={[
              styles.statusText,
              trackingActive ? styles.statusActive : styles.statusWaiting,
            ]}
          >
            {t(getStatusKey(booking))}
          </Text>
        </View>

        {mapCenter ? (
          <View style={styles.mapWrapper}>
            <MapView
              ref={mapRef}
              style={styles.map}
              initialRegion={{
                latitude: mapCenter.latitude,
                longitude: mapCenter.longitude,
                latitudeDelta: 0.03,
                longitudeDelta: 0.03,
              }}
            >
              {pickupLocation ? (
                <Marker
                  coordinate={pickupLocation}
                  title={t("rides.pickupMarkerTitle")}
                  description={t("rides.pickupMarkerDesc")}
                >
                  <View style={styles.pickupMarker}>
                    <Ionicons name="home" size={17} color="#FFFFFF" />
                  </View>
                </Marker>
              ) : null}

              {schoolLocation ? (
                <Marker
                  coordinate={schoolLocation}
                  title={t("rides.schoolMarkerTitle")}
                  description={t("rides.schoolMarkerDesc")}
                >
                  <View style={styles.schoolMarker}>
                    <Ionicons name="school" size={17} color="#FFFFFF" />
                  </View>
                </Marker>
              ) : null}

              {driverLocation ? (
                <Marker
                  coordinate={driverLocation}
                  title={t("rides.driverMarkerTitle")}
                  description={t("rides.driverMarkerDesc")}
                >
                  <View style={styles.driverMarker}>
                    <Ionicons name="car" size={20} color="#FFFFFF" />
                  </View>
                </Marker>
              ) : null}
            </MapView>
          </View>
        ) : (
          <View style={styles.noMapBox}>
            <Ionicons name="map-outline" size={42} color="#F58220" />
            <Text style={styles.noMapText}>
              {t("rides.waitingForDriverLocation")}
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Ionicons name="person-outline" size={16} color="#7C5F46" />
            <Text style={styles.infoText}>
              {t("rides.driverLabel", { name: booking.driverName || t("rides.driverFallback") })}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={16} color="#7C5F46" />
            <Text style={styles.infoText}>
              {booking.from || "?"} → {booking.to || "?"}
            </Text>
          </View>

          {booking.date ? (
            <View style={styles.infoRow}>
              <Ionicons name="calendar-outline" size={16} color="#7C5F46" />
              <Text style={styles.infoText}>{booking.date}</Text>
            </View>
          ) : null}

          {booking.time ? (
            <View style={styles.infoRow}>
              <Ionicons name="time-outline" size={16} color="#7C5F46" />
              <Text style={styles.infoText}>{booking.time}</Text>
            </View>
          ) : null}

          {booking.driverLocationUpdatedAt?.seconds ? (
            <Text style={styles.updatedText}>
              {t("rides.lastUpdate", {
                time: new Date(
                  booking.driverLocationUpdatedAt.seconds * 1000,
                ).toLocaleTimeString(),
              })}
            </Text>
          ) : (
            <Text style={styles.updatedText}>
              {t("rides.driverLocationWillAppear")}
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  container: {
    padding: 20,
    paddingTop: 50,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 30,
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
  backButtonSmall: {
    marginTop: 18,
    backgroundColor: "#F58220",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
  },
  backButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  title: {
    fontSize: 28,
    fontWeight: "900",
    color: "#111827",
  },
  statusBox: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  statusText: {
    fontWeight: "900",
    fontSize: 14,
    flexShrink: 1,
  },
  statusActive: {
    color: "#166534",
  },
  statusWaiting: {
    color: "#B86115",
  },
  mapWrapper: {
    height: 420,
    borderRadius: 22,
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
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#F58220",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#FFFFFF",
  },
  pickupMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#FFFFFF",
  },
  schoolMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#FFFFFF",
  },
  noMapBox: {
    backgroundColor: "#FFF8F2",
    borderWidth: 1,
    borderColor: "#FFE2C5",
    borderRadius: 18,
    paddingVertical: 50,
    paddingHorizontal: 20,
    alignItems: "center",
    marginBottom: 18,
  },
  noMapText: {
    marginTop: 10,
    color: "#B86115",
    fontWeight: "800",
    textAlign: "center",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 18,
    padding: 18,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  infoText: {
    color: "#3C2319",
    fontWeight: "800",
    fontSize: 14,
    flexShrink: 1,
  },
  updatedText: {
    marginTop: 8,
    color: "#7C5F46",
    fontWeight: "700",
    fontSize: 13,
  },
  emptyTitle: {
    color: "#111827",
    fontWeight: "900",
    fontSize: 18,
    marginTop: 12,
  },
});