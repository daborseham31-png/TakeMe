import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { doc, onSnapshot } from "firebase/firestore";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { Marker } from "react-native-maps";

import { useTranslation } from "react-i18next";

import { db } from "../../firebase";
import {
  captureDriverLocationOnce,
  startDriverLocationTracking,
  stopDriverLocationTracking,
} from "../driverLocationTask";
import { TRIP_LOCATIONS_COLLECTION } from "../booking/schoolTripsLib";
import {
  arriveJob,
  collectionFor,
  finishJob,
  normalizeApplication,
  NormalizedApplication,
  WorkErrandKind,
} from "../booking/work-errand/workErrandLib";
import { DirectionalScreen } from "../i18n/DirectionalPrimitives";
import { useLanguage } from "../i18n/LanguageProvider";
import { ltrContentStyle } from "../i18n/rtl";
import { openWazeNavigation } from "./wazeNav";

// Live tracking is active for the whole "Start Driving" → Finish window —
// on_the_way (Errand's own Start Driving step), arrived, and in_progress
// (Work skips straight to in_progress — see workErrandLib.ts's
// beginJobTrip/startJob) — mirroring ride-navigation.tsx's own tracking
// window but starting one stage earlier, per this screen's own spec.
const TRACKED_STATUSES = new Set(["on_the_way", "arrived", "in_progress"]);

export default function JobNavigationScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const params = useLocalSearchParams();
  const kind = (params.kind === "errand" ? "errand" : "work") as WorkErrandKind;
  const id = typeof params.id === "string" ? params.id : "";

  const [app, setApp] = useState<NormalizedApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Live listener so the screen reflects status changes immediately.
  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }

    const unsub = onSnapshot(
      doc(db, collectionFor(kind), id),
      (snap) => {
        if (snap.exists()) {
          setApp(normalizeApplication(snap.id, snap.data(), kind));
        }
        setLoading(false);
      },
      () => setLoading(false),
    );

    return unsub;
  }, [id, kind]);

  // The driver's own live location, read back from the SAME tripLocations
  // doc driverLocationTask.ts writes to — same round-trip pattern as
  // ride-navigation.tsx, reused verbatim rather than a second tracking path.
  const [liveDriverLocation, setLiveDriverLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  useEffect(() => {
    if (!id) {
      setLiveDriverLocation(null);
      return;
    }

    const unsub = onSnapshot(
      doc(db, TRIP_LOCATIONS_COLLECTION, id),
      (snap) => {
        const data = snap.data();
        const lat = Number(data?.latitude);
        const lng = Number(data?.longitude);

        setLiveDriverLocation(
          Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : null,
        );
      },
      (error) => {
        console.log("Listener failed:", {
          feature: "job-navigation.tripLocations",
          collection: TRIP_LOCATIONS_COLLECTION,
          docId: id,
          code: error.code,
          message: error.message,
        });
        setLiveDriverLocation(null);
      },
    );

    return unsub;
  }, [id]);

  // tripLocations/{applicationId} — targetId is this application's own id
  // (workApplications/errandApplications), the exact same 1:1 shape
  // Personal Ride already uses (tripLocations/{bookingId}): one driver, one
  // customer, both known up front, no School-style shared-car authorized
  // list needed. driverId is always the provider viewing this screen
  // (app.providerId); passengerId is the applicant/customer (app.customerId)
  // — named "passengerId" (not "customerId") because that is the literal
  // field firestore.rules' tripLocations read rule checks for the non-driver
  // party, so this must match it exactly, not invent a new field name.
  const getTrackingTarget = () => {
    if (!id || !app?.providerId) return null;
    return { targetId: id, driverId: app.providerId, passengerId: app.customerId };
  };

  // Starts the moment this screen shows a tracked stage (on_the_way onward —
  // i.e. right after "Start Driving", per this screen's own spec) and keeps
  // running only while the screen stays mounted; stops on unmount, and
  // separately the instant the job is marked completed (see handleFinish).
  useEffect(() => {
    if (!app || !id) return;
    if (!TRACKED_STATUSES.has(app.status)) return;

    const target = getTrackingTarget();
    if (!target) return;

    let cancelled = false;

    (async () => {
      try {
        await captureDriverLocationOnce(target);
        if (cancelled) return;

        const result = await startDriverLocationTracking(target);
        if (!cancelled && !result.started) {
          Alert.alert(t("booking.locationPermissionTitle"), t("booking.allowLocationForTracking"));
        }
      } catch (error) {
        console.log("job-navigation: failed to start driver location tracking", error);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app?.status, id, app?.providerId, app?.customerId]);

  // Screen closed / component unmounted — always stop the watcher, unlike
  // ride-navigation.tsx's deliberate "keep tracking across navigation"
  // choice; this screen's own spec requires tracking to stop here.
  useEffect(() => {
    return () => {
      stopDriverLocationTracking().catch(() => {});
    };
  }, []);

  const mapRef = useRef<MapView | null>(null);

  const customerCoord =
    app?.location?.latitude != null && app?.location?.longitude != null
      ? { latitude: app.location.latitude, longitude: app.location.longitude }
      : null;

  // Keeps both markers on screen together instead of a fixed zoom/region —
  // re-fits whenever either point changes (the driver marker moves every
  // few seconds while tracking is active).
  useEffect(() => {
    if (!mapRef.current || !customerCoord || !liveDriverLocation) return;

    mapRef.current.fitToCoordinates([customerCoord, liveDriverLocation], {
      edgePadding: { top: 60, right: 60, bottom: 60, left: 60 },
      animated: true,
    });
  }, [customerCoord?.latitude, customerCoord?.longitude, liveDriverLocation]);

  // Both maps use the customer's REAL detected coordinates, never the typed
  // city/neighborhood. If coordinates are missing we tell the driver instead
  // of opening a wrong (text-based) destination.
  const coords = (app_: NormalizedApplication) => {
    const lat = app_.location?.latitude;
    const lng = app_.location?.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    return { lat, lng };
  };

  const openMaps = (app_: NormalizedApplication) => {
    const c = coords(app_);
    if (!c) {
      Alert.alert(t("booking.locationLabel"), t("booking.exactLocationNotAvailable"));
      return;
    }
    const url = `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`;
    Linking.openURL(url).catch(() =>
      Alert.alert(t("common.error"), t("booking.couldNotOpenMaps")),
    );
  };

  const openWaze = (app_: NormalizedApplication) => {
    const c = coords(app_);
    if (!c) {
      Alert.alert(t("booking.locationLabel"), t("booking.exactLocationNotAvailable"));
      return;
    }
    openWazeNavigation(c.lat, c.lng).catch(() =>
      Alert.alert(t("common.error"), t("booking.couldNotOpenWaze")),
    );
  };

  const handleArrived = async () => {
    if (!app) return;
    try {
      setBusy(true);
      await arriveJob(kind, app.id, app);
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("booking.couldNotUpdate"));
    } finally {
      setBusy(false);
    }
  };

  const handleFinish = () => {
    if (!app) return;
    Alert.alert(
      kind === "work" ? t("booking.finishWork") : t("booking.finishErrand"),
      t("booking.markCompletedConfirm"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.yesFinish"),
          onPress: async () => {
            try {
              setBusy(true);
              await finishJob(kind, app.id, app);
              await stopDriverLocationTracking().catch(() => {});
              Alert.alert(t("common.completed"), t("booking.greatJobCompletedMessage"), [
                {
                  text: t("common.ok"),
                  onPress: () => router.replace("/(tabs)/bookings" as any),
                },
              ]);
            } catch (error: any) {
              Alert.alert(t("common.error"), error?.message || t("booking.couldNotComplete"));
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
      <DirectionalScreen style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#F58220" />
        </View>
      </DirectionalScreen>
    );
  }

  if (!app) {
    return (
      <DirectionalScreen style={styles.safe}>
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={44} color="#8B7B6B" />
          <Text style={styles.emptyTitle}>{t("rides.bookingNotFound")}</Text>
          <Pressable style={styles.backLink} onPress={() => router.back()}>
            <Text style={styles.backLinkText}>{t("common.goBack")}</Text>
          </Pressable>
        </View>
      </DirectionalScreen>
    );
  }

  const arrived = app.status === "arrived";
  const completed = app.status === "completed";

  return (
    <DirectionalScreen style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name={isRTL ? "arrow-forward" : "arrow-back"} size={22} color="#7C5F46" />
          <Text style={styles.backText}>{t("common.back")}</Text>
        </Pressable>

        <View style={styles.header}>
          <Ionicons name="navigate" size={26} color="#F58220" />
          <Text style={styles.title}>
            {kind === "work" ? t("booking.workNavigationTitle") : t("booking.errandNavigationTitle")}
          </Text>
        </View>

        {/* Live map — driver + customer markers when a customer coordinate
            exists; falls back to the plain status placeholder otherwise
            (missing customer coordinates, exactly like openMaps/openWaze's
            own fallback above). */}
        {customerCoord ? (
          <View style={styles.mapWrapper}>
            <MapView
              ref={mapRef}
              style={styles.map}
              initialRegion={{
                latitude: (liveDriverLocation ?? customerCoord).latitude,
                longitude: (liveDriverLocation ?? customerCoord).longitude,
                latitudeDelta: 0.02,
                longitudeDelta: 0.02,
              }}
            >
              <Marker
                coordinate={customerCoord}
                title={app.customerName}
                description={t("booking.locationLabel")}
                pinColor="#F58220"
              />

              {liveDriverLocation ? (
                <Marker
                  coordinate={liveDriverLocation}
                  title={t("booking.yourLocationLabel")}
                  description={t("booking.liveDriverLocation")}
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
              {arrived
                ? t("booking.arrivedAtDestination")
                : t("booking.exactLocationNotAvailableShort")}
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{app.title}</Text>

          <View style={styles.infoRow}>
            <Ionicons name="person-outline" size={16} color="#7C5F46" />
            <Text style={styles.infoText}>{app.customerName}</Text>
          </View>

          {app.customerPhone ? (
            <Pressable
              style={styles.infoRow}
              onPress={() =>
                Linking.openURL(`tel:${app.customerPhone}`).catch(() => {})
              }
            >
              <Ionicons name="call-outline" size={16} color="#F58220" />
              <Text style={[styles.infoText, styles.phone, ltrContentStyle]}>
                {app.customerPhone}
              </Text>
            </Pressable>
          ) : null}

          <View style={styles.infoRow}>
            <Ionicons name="business-outline" size={16} color="#7C5F46" />
            <Text style={styles.infoText}>{t("booking.cityVillageColon", { city: app.city })}</Text>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={16} color="#7C5F46" />
            <Text style={styles.infoText}>
              {t("booking.neighborhoodColon", { neighborhood: app.neighborhood })}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="navigate-circle-outline" size={16} color="#7C5F46" />
            <Text style={styles.infoText}>
              {app.location?.latitude != null && app.location?.longitude != null
                ? app.location.address ||
                  `${app.location.latitude.toFixed(5)}, ${app.location.longitude.toFixed(5)}`
                : t("booking.exactLocationNotAvailableShort")}
            </Text>
          </View>

          {app.date ? (
            <View style={styles.infoRow}>
              <Ionicons name="calendar-outline" size={16} color="#7C5F46" />
              <Text style={styles.infoText}>{app.date}</Text>
            </View>
          ) : null}

          {app.startTime || app.endTime ? (
            <View style={styles.infoRow}>
              <Ionicons name="time-outline" size={16} color="#7C5F46" />
              <Text style={styles.infoText}>
                {app.startTime} - {app.endTime}
              </Text>
            </View>
          ) : null}

          {app.notes ? (
            <View style={styles.notesBox}>
              <Text style={styles.notesLabel}>{t("common.notes")}</Text>
              <Text style={styles.notesText}>{app.notes}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.navRow}>
          <Pressable style={styles.navButton} onPress={() => openMaps(app)}>
            <Ionicons name="map" size={18} color="#FFFFFF" />
            <Text style={styles.navButtonText}>{t("booking.googleMaps")}</Text>
          </Pressable>
          <Pressable
            style={[styles.navButton, styles.wazeButton]}
            onPress={() => openWaze(app)}
          >
            <Ionicons name="navigate-circle" size={18} color="#FFFFFF" />
            <Text style={styles.navButtonText}>{t("booking.waze")}</Text>
          </Pressable>
        </View>

        {completed ? (
          <View style={styles.doneBanner}>
            <Ionicons name="checkmark-circle" size={20} color="#166534" />
            <Text style={styles.doneText}>{t("common.completed")}</Text>
          </View>
        ) : arrived ? (
          <Pressable
            style={[styles.finishButton, busy && styles.disabled]}
            onPress={handleFinish}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="checkmark-done" size={19} color="#FFFFFF" />
                <Text style={styles.finishText}>
                  {kind === "work" ? t("booking.finishWork") : t("booking.finishErrand")}
                </Text>
              </>
            )}
          </Pressable>
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
                <Text style={styles.arrivedText}>{t("booking.iArrivedButton")}</Text>
              </>
            )}
          </Pressable>
        )}
      </ScrollView>
    </DirectionalScreen>
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
  cardTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 12,
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
  notesBox: {
    backgroundColor: "#F8F4EF",
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
  },
  notesLabel: {
    color: "#7C5F46",
    fontWeight: "900",
    fontSize: 12,
    marginBottom: 4,
  },
  notesText: {
    color: "#3C2319",
    fontSize: 14,
    lineHeight: 20,
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
  finishButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#16A34A",
    borderRadius: 14,
    paddingVertical: 16,
  },
  finishText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 16,
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
