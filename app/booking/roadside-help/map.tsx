import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { Marker, Polyline, Region } from "react-native-maps";
import { useTranslation } from "react-i18next";

import { translateProblemTypesList } from "../../i18n/formatters";
import { useLanguage } from "../../i18n/LanguageProvider";
import { positionEnd } from "../../i18n/rtl";

// The passenger only watches the helper come/work. Completing the roadside
// help is the driver's responsibility (from their Help Requests page).
type Phase = "waiting" | "arrived";

type LatLng = { latitude: number; longitude: number };

const FALLBACK: LatLng = { latitude: 32.6996, longitude: 35.3035 };

export default function RoadsideHelpMapScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const params = useLocalSearchParams();

  const rawProblemLabel = String(params.problemLabel || "Roadside Help");
  const problemLabel =
    translateProblemTypesList(rawProblemLabel.split(", "), t) || rawProblemLabel;
  const helperName = String(params.helperName || t("roadsideHelp.yourHelperFallback"));
  const helperEta = Number(params.helperEta) || null;

  const userPos: LatLng = {
    latitude: Number(params.lat) || FALLBACK.latitude,
    longitude: Number(params.lng) || FALLBACK.longitude,
  };

  // Helper starts a bit away from the user, then drives over.
  const helperStart: LatLng = {
    latitude: userPos.latitude + 0.015,
    longitude: userPos.longitude - 0.01,
  };

  const [phase, setPhase] = useState<Phase>("waiting");
  const [helperPos, setHelperPos] = useState<LatLng>(helperStart);
  const [routeCoords, setRouteCoords] = useState<LatLng[]>([
    helperStart,
    userPos,
  ]);
  const [eta, setEta] = useState<{ duration: number; distance: number } | null>(
    null,
  );

  const animationRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const initialRegion: Region = {
    latitude: (userPos.latitude + helperStart.latitude) / 2,
    longitude: (userPos.longitude + helperStart.longitude) / 2,
    latitudeDelta: Math.abs(userPos.latitude - helperStart.latitude) + 0.03,
    longitudeDelta: Math.abs(userPos.longitude - helperStart.longitude) + 0.03,
  };

  // Fetch the real route from OSRM, then animate the helper along it.
  useEffect(() => {
    if (phase !== "waiting") return;

    let cancelled = false;

    fetch(
      `https://router.project-osrm.org/route/v1/driving/${helperStart.longitude},${helperStart.latitude};${userPos.longitude},${userPos.latitude}?overview=full&geometries=geojson`,
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data.routes?.[0]) return;

        const coords: LatLng[] = data.routes[0].geometry.coordinates.map(
          (c: number[]) => ({ latitude: c[1], longitude: c[0] }),
        );

        setRouteCoords(coords);
        setEta({
          duration: data.routes[0].duration,
          distance: data.routes[0].distance,
        });

        // Animate helper movement along the route.
        let idx = 0;
        const step = Math.max(1, Math.floor(coords.length / 20));

        animationRef.current = setInterval(() => {
          if (idx >= coords.length) {
            if (animationRef.current) clearInterval(animationRef.current);
            return;
          }
          setHelperPos(coords[idx]);
          idx += step;
        }, 1000);
      })
      .catch(() => {
        if (!cancelled)
          setEta({ duration: (helperEta || 10) * 60, distance: 3000 });
      });

    return () => {
      cancelled = true;
      if (animationRef.current) clearInterval(animationRef.current);
    };
  }, [phase]);

  const handleShare = () => {
    const mapsUrl = `https://www.google.com/maps?q=${userPos.latitude},${userPos.longitude}`;
    const text = encodeURIComponent(
      `📍 I need roadside help, here is my location:\n${mapsUrl}`,
    );
    Linking.openURL(`https://wa.me/?text=${text}`).catch(() =>
      Alert.alert(t("common.error"), t("roadsideHelp.couldNotOpenWhatsApp")),
    );
  };

  const handleSOS = () => {
    Alert.alert(t("roadsideHelp.emergencyTitle"), t("roadsideHelp.emergencyMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.call"), onPress: () => Linking.openURL("tel:100") },
    ]);
  };

  return (
    <SafeAreaView style={styles.page}>
      {/* Top info bar */}
      <View style={styles.topBar}>
        <Pressable style={styles.topBack} onPress={() => router.back()}>
          <Ionicons name={isRTL ? "arrow-forward" : "arrow-back"} size={22} color="#7C5F46" />
        </Pressable>

        <View style={styles.topInfo}>
          <Ionicons name="construct" size={20} color="#F58220" />
          <View style={{ flex: 1 }}>
            <Text style={styles.topTitle}>
              {phase === "waiting" ? t("roadsideHelp.helperOnTheWay") : t("roadsideHelp.helperIsWorking")}
            </Text>
            <Text style={styles.topSubtitle}>
              {helperName} • {problemLabel}
            </Text>
          </View>
        </View>
      </View>

      {/* Map */}
      <View style={styles.mapContainer}>
        <MapView style={styles.map} initialRegion={initialRegion}>
          <Marker coordinate={userPos} title={t("roadsideHelp.youMapLabel")} pinColor="#EF4444" />
          <Marker
            coordinate={helperPos}
            title={t("roadsideHelp.helperMapLabel")}
            pinColor="#2563EB"
          />
          <Polyline
            coordinates={routeCoords}
            strokeColor="#2563EB"
            strokeWidth={5}
          />
        </MapView>

        {/* Floating helper actions */}
        <View style={[styles.floatingActions, positionEnd(16, isRTL)]}>
          <Pressable style={styles.circleButton} onPress={handleShare}>
            <Ionicons name="share-social-outline" size={22} color="#F58220" />
          </Pressable>
          <Pressable
            style={[styles.circleButton, styles.sosButton]}
            onPress={handleSOS}
          >
            <Ionicons name="alert" size={22} color="#FFFFFF" />
          </Pressable>
        </View>

        {/* Bottom card */}
        <View style={styles.bottomCard}>
          {eta && phase === "waiting" && (
            <View style={styles.etaRow}>
              <View style={styles.etaItem}>
                <Ionicons name="time-outline" size={18} color="#F58220" />
                <Text style={styles.etaText}>
                  {Math.ceil(eta.duration / 60)} min
                </Text>
              </View>
              <View style={styles.etaItem}>
                <Ionicons name="navigate-outline" size={18} color="#F58220" />
                <Text style={styles.etaText}>
                  {(eta.distance / 1000).toFixed(1)} km
                </Text>
              </View>
            </View>
          )}

          {phase === "waiting" ? (
            <Pressable
              style={[styles.primaryButton, styles.greenButton]}
              onPress={() => setPhase("arrived")}
            >
              <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
              <Text style={styles.primaryButtonText}>{t("roadsideHelp.helperArrivedButton")}</Text>
            </Pressable>
          ) : (
            <View style={styles.infoNote}>
              <Ionicons name="construct" size={18} color="#B86115" />
              <Text style={styles.infoNoteText}>
                {t("roadsideHelp.helperAssistingNote")}
              </Text>
            </View>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  topBar: {
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E7DCD1",
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  topBack: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  topInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  topTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: "#111827",
  },
  topSubtitle: {
    fontSize: 13,
    color: "#7C5F46",
    marginTop: 2,
  },
  mapContainer: {
    flex: 1,
    position: "relative",
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  floatingActions: {
    position: "absolute",
    top: 16,
    gap: 12,
  },
  circleButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 3,
  },
  sosButton: {
    backgroundColor: "#EF4444",
    borderColor: "#EF4444",
  },
  bottomCard: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 24,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E7DCD1",
    padding: 16,
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 4,
  },
  etaRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 28,
  },
  etaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  etaText: {
    fontSize: 15,
    fontWeight: "900",
    color: "#111827",
  },
  primaryButton: {
    backgroundColor: "#F58220",
    borderRadius: 12,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  greenButton: {
    backgroundColor: "#16A34A",
  },
  infoNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FFF2E8",
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  infoNoteText: {
    flex: 1,
    color: "#B86115",
    fontWeight: "700",
    fontSize: 13,
    lineHeight: 18,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 16,
  },
  ratingWrapper: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  ratingCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#E7DCD1",
    padding: 26,
    alignItems: "center",
    gap: 16,
  },
  checkCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#FFF2E8",
    alignItems: "center",
    justifyContent: "center",
  },
  ratingTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: "#111827",
  },
  ratingSubtitle: {
    fontSize: 15,
    color: "#7C5F46",
  },
  starsRow: {
    flexDirection: "row",
    gap: 6,
  },
  textArea: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    padding: 14,
    minHeight: 90,
    backgroundColor: "#FFFDFC",
    color: "#111827",
  },
});
