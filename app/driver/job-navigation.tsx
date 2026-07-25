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

import { useTranslation } from "react-i18next";

import { db } from "../../firebase";
import {
  arriveJob,
  collectionFor,
  finishJob,
  normalizeApplication,
  NormalizedApplication,
  WorkErrandKind,
} from "../booking/work-errand/workErrandLib";
import { useLanguage } from "../i18n/LanguageProvider";
import { ltrContentStyle } from "../i18n/rtl";

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
    const url = `https://waze.com/ul?ll=${c.lat},${c.lng}&navigate=yes`;
    Linking.openURL(url).catch(() =>
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
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#F58220" />
        </View>
      </SafeAreaView>
    );
  }

  if (!app) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={44} color="#8B7B6B" />
          <Text style={styles.emptyTitle}>{t("rides.bookingNotFound")}</Text>
          <Pressable style={styles.backLink} onPress={() => router.back()}>
            <Text style={styles.backLinkText}>{t("common.goBack")}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const arrived = app.status === "arrived";
  const completed = app.status === "completed";

  return (
    <SafeAreaView style={styles.safe}>
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

        {/* Map placeholder (kept lightweight – uses external maps apps) */}
        <View style={styles.mapBox}>
          <Ionicons name="map-outline" size={40} color="#F58220" />
          <Text style={styles.mapText}>
            {arrived
              ? t("booking.arrivedAtDestination")
              : t("booking.navigateToCustomerLocation")}
          </Text>
        </View>

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
