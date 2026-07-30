import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { doc, onSnapshot } from "firebase/firestore";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import { useTranslation } from "react-i18next";

import { db } from "../../firebase";
import { TRIP_LOCATIONS_COLLECTION } from "../booking/schoolTripsLib";
import { translateProblemTypesList } from "../i18n/formatters";
import { useLanguage } from "../i18n/LanguageProvider";
import { positionEnd } from "../i18n/rtl";

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

// Roadside Help reuses this exact screen (same tripStatus vocabulary as
// Rides — see roadsideLib.ts's own comment on why) but shows helper-facing
// copy instead of driver-facing copy for the same underlying states.
const getStatusKey = (booking: any) => {
  const status = booking?.tripStatus || booking?.status;
  const isRoadside = booking?.category === "roadside";

  if (isRoadside) {
    if (status === "driver_on_way") return "roadsideHelp.helperOnTheWay";
    if (status === "arrived_pickup") return "roadsideHelp.helperArrivedHint";
    if (status === "in_progress") return "roadsideHelp.helpInProgressHint";
    if (status === "completion_pending") return "roadsideHelp.waitingForPassengerConfirmation";
    if (status === "completed") return "roadsideHelp.badgeCompleted";

    return "roadsideHelp.waitingForHelperToStartDriving";
  }

  if (status === "driver_on_way") return "rides.driverOnWay";
  if (status === "arrived_pickup") return "rides.driverArrivedPickup";
  if (status === "in_progress") return "rides.tripInProgress";
  if (status === "completed") return "rides.tripCompleted";

  return "rides.waitingForDriver";
};

// Show a "location hasn't updated recently" warning once this many ms pass
// with no new tick — within the 15-30s window requested.
const STALE_AFTER_MS = 20000;

export default function LiveTrackingScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const params = useLocalSearchParams();
  const id = typeof params.id === "string" ? params.id : "";

  // A school trip's live location is shared by every passenger booked on it
  // (see app/driver/ride-navigation.tsx's top-of-file comment), so `id`
  // here is the tripId, not a booking id, whenever source=schoolTrips —
  // tripLocations/{id} matches either case directly (see
  // driverLocationTask.ts / schoolTripsLib.ts).
  const isSchoolTripsSource = String(params.source || "") === "schoolTrips";
  const bookingCollection = isSchoolTripsSource ? "schoolTrips" : "bookings";

  const mapRef = useRef<MapView | null>(null);
  const hasCenteredOnceRef = useRef(false);
  const userHasPannedRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState<any | null>(null);
  const [locationError, setLocationError] = useState(false);

  // The driver's real GPS — read from its own tripLocations doc via a
  // dedicated real-time listener (never a static/simulated value, never
  // re-fetched by reloading this screen). Firestore rules restrict this
  // read to the assigned driver + authorized passenger(s) only.
  const [driverDoc, setDriverDoc] = useState<any | null>(null);
  // The marker is rendered straight off this state (no ref, no imperative
  // animation API) — those native marker commands aren't available under
  // the New Architecture in Expo Go and crash on iOS.
  const [driverLocation, setDriverLocation] = useState<LatLng | null>(null);

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

  useEffect(() => {
    if (!id) {
      setDriverDoc(null);
      return;
    }

    const unsub = onSnapshot(
      doc(db, TRIP_LOCATIONS_COLLECTION, id),
      (snap) => {
        const data = snap.exists() ? snap.data() : null;
        setDriverDoc(data);
        setDriverLocation(toLatLng(data));
        setLocationError(false);
      },
      // A permission-denied or offline read lands here — surfaced as a
      // small inline notice below rather than a blank/crashed screen.
      () => setLocationError(true),
    );

    return unsub;
  }, [id]);

  const driverUpdatedAtMs: number | null = driverDoc?.updatedAt?.seconds
    ? driverDoc.updatedAt.seconds * 1000
    : null;

  const pickupLocation = useMemo(() => {
    return (
      toLatLng(booking?.pickupCoords) ||
      toLatLng(booking?.pickup) ||
      toLatLng(booking?.passengerPickupLocation) ||
      // A school trip's own "From" GPS point (see ride-navigation.tsx's
      // matching fallback).
      toLatLng(booking?.fromLocation) ||
      // Roadside Help's own location shape (see roadsideLib.ts's
      // acceptOffer) — the help location itself, not a pickup point.
      toLatLng(booking?.location) ||
      (typeof booking?.latitude === "number" && typeof booking?.longitude === "number"
        ? { latitude: booking.latitude, longitude: booking.longitude }
        : null)
    );
  }, [booking]);

  const destinationLocation = useMemo(() => {
    return (
      toLatLng(booking?.schoolCoords) ||
      toLatLng(booking?.destinationCoords) ||
      toLatLng(booking?.schoolLocation)
    );
  }, [booking]);

  const mapCenter = driverLocation || pickupLocation || destinationLocation;

  // Auto-frame the map ONCE, the first time a driver fix arrives, so the
  // passenger doesn't open to an empty ocean tile — never again after that,
  // so manual pan/zoom is never fought (see recenter() for the explicit,
  // on-demand alternative).
  useEffect(() => {
    if (!driverLocation || !mapRef.current || hasCenteredOnceRef.current || userHasPannedRef.current) {
      return;
    }

    hasCenteredOnceRef.current = true;
    mapRef.current.animateToRegion(
      { latitude: driverLocation.latitude, longitude: driverLocation.longitude, latitudeDelta: 0.015, longitudeDelta: 0.015 },
      700,
    );
  }, [driverLocation]);

  const recenter = useCallback(() => {
    if (!driverLocation || !mapRef.current) return;

    userHasPannedRef.current = false;
    mapRef.current.animateToRegion(
      { latitude: driverLocation.latitude, longitude: driverLocation.longitude, latitudeDelta: 0.015, longitudeDelta: 0.015 },
      500,
    );
  }, [driverLocation]);

  // Ticks once a second purely to re-evaluate the "stale" / "last updated"
  // text below against the current time — never touches the map itself.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const isStale = !!driverUpdatedAtMs && nowMs - driverUpdatedAtMs > STALE_AFTER_MS;

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

  const trackingActive = (booking.tripStatus || booking.status) === "in_progress";
  const isRoadside = booking.category === "roadside";

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

        {locationError ? (
          <View style={styles.warningBox}>
            <Ionicons name="cloud-offline-outline" size={16} color="#B91C1C" />
            <Text style={styles.warningText}>{t("rides.locationTemporarilyUnavailable")}</Text>
          </View>
        ) : null}

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
              onPanDrag={() => {
                userHasPannedRef.current = true;
              }}
            >
              {pickupLocation && destinationLocation ? (
                <Polyline
                  coordinates={[pickupLocation, destinationLocation]}
                  strokeColor="#F58220"
                  strokeWidth={3}
                  lineDashPattern={[8, 6]}
                />
              ) : null}

              {pickupLocation ? (
                <Marker
                  coordinate={pickupLocation}
                  title={isRoadside ? t("roadsideHelp.helpLocationMarkerTitle") : t("rides.pickupMarkerTitle")}
                  description={isRoadside ? "" : t("rides.pickupMarkerDesc")}
                >
                  <View style={styles.pickupMarker}>
                    <Ionicons name={isRoadside ? "construct" : "home"} size={17} color="#FFFFFF" />
                  </View>
                </Marker>
              ) : null}

              {destinationLocation ? (
                <Marker
                  coordinate={destinationLocation}
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
                  coordinate={{
                    latitude: driverLocation.latitude,
                    longitude: driverLocation.longitude,
                  }}
                  title={isRoadside ? t("roadsideHelp.helperMapLabel") : t("rides.driverMarkerTitle")}
                  description={isRoadside ? "" : t("rides.driverMarkerDesc")}
                  anchor={{ x: 0.5, y: 0.5 }}
                >
                  <View style={styles.driverMarker}>
                    <Ionicons name="car" size={20} color="#FFFFFF" />
                  </View>
                </Marker>
              ) : null}
            </MapView>

            {driverLocation ? (
              <Pressable style={[styles.recenterButton, positionEnd(14, isRTL)]} onPress={recenter} hitSlop={8}>
                <Ionicons name="locate" size={20} color="#F58220" />
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={styles.noMapBox}>
            <Ionicons name="map-outline" size={42} color="#F58220" />
            <Text style={styles.noMapText}>
              {t("rides.waitingForDriverLocation")}
            </Text>
          </View>
        )}

        {isStale ? (
          <View style={styles.warningBox}>
            <Ionicons name="warning-outline" size={16} color="#B91C1C" />
            <Text style={styles.warningText}>{t("rides.driverLocationStale")}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Ionicons name="person-outline" size={16} color="#7C5F46" />
            <Text style={styles.infoText}>
              {isRoadside
                ? t("roadsideHelp.helperLabel", { name: booking.driverName || t("roadsideHelp.yourHelperFallback") })
                : t("rides.driverLabel", { name: booking.driverName || t("rides.driverFallback") })}
            </Text>
          </View>

          {!isRoadside && (booking.car || booking.carColor || booking.carPlate) ? (
            <View style={styles.infoRow}>
              <Ionicons name="car-outline" size={16} color="#7C5F46" />
              <Text style={styles.infoText}>
                {[booking.car, booking.carColor].filter(Boolean).join(" · ")}
                {booking.carPlate ? (
                  <Text style={styles.ltrText}> · {booking.carPlate}</Text>
                ) : null}
              </Text>
            </View>
          ) : null}

          {isRoadside ? (
            <>
              {Array.isArray(booking.problemTypes) && booking.problemTypes.length > 0 ? (
                <View style={styles.infoRow}>
                  <Ionicons name="build-outline" size={16} color="#7C5F46" />
                  <Text style={styles.infoText}>
                    {translateProblemTypesList(booking.problemTypes, t)}
                  </Text>
                </View>
              ) : null}

              {booking.address || booking.location?.address ? (
                <View style={styles.infoRow}>
                  <Ionicons name="location-outline" size={16} color="#7C5F46" />
                  <Text style={styles.infoText}>{booking.address || booking.location?.address}</Text>
                </View>
              ) : null}
            </>
          ) : (
            <View style={styles.infoRow}>
              <Ionicons name="location-outline" size={16} color="#7C5F46" />
              <Text style={styles.infoText}>
                {booking.from || "?"} → {booking.to || "?"}
              </Text>
            </View>
          )}

          {booking.date ? (
            <View style={styles.infoRow}>
              <Ionicons name="calendar-outline" size={16} color="#7C5F46" />
              <Text style={styles.infoText}>{booking.date}</Text>
            </View>
          ) : null}

          {booking.time ? (
            <View style={styles.infoRow}>
              <Ionicons name="time-outline" size={16} color="#7C5F46" />
              <Text style={[styles.infoText, styles.ltrText]}>{booking.time}</Text>
            </View>
          ) : null}

          {driverUpdatedAtMs ? (
            <Text style={[styles.updatedText, isStale && styles.updatedTextStale]}>
              {t("rides.lastUpdate", {
                time: new Date(driverUpdatedAtMs).toLocaleTimeString("en-US", { hour12: false }),
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
  warningBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FEE2E2",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  warningText: {
    flex: 1,
    color: "#B91C1C",
    fontWeight: "800",
    fontSize: 12.5,
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
  recenterButton: {
    position: "absolute",
    bottom: 14,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 3,
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
  ltrText: {
    writingDirection: "ltr",
  },
  updatedText: {
    marginTop: 8,
    color: "#7C5F46",
    fontWeight: "700",
    fontSize: 13,
  },
  updatedTextStale: {
    color: "#B91C1C",
  },
  emptyTitle: {
    color: "#111827",
    fontWeight: "900",
    fontSize: 18,
    marginTop: 12,
  },
});
