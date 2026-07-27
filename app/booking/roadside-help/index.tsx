import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import MapView, { Marker, Region } from "react-native-maps";
import { useTranslation } from "react-i18next";

import KeyboardSafeScreen from "../../components/KeyboardSafeScreen";
import {
  DirectionalScreen,
  PhysicalDirectionalBlockText,
} from "../../i18n/DirectionalPrimitives";
import { translateProblemType } from "../../i18n/formatters";
import { useLanguage } from "../../i18n/LanguageProvider";
import { positionEnd } from "../../i18n/rtl";
import { createRoadsideRequest } from "./roadsideLib";

// Default map region (Nazareth area) used until the user moves the pin.
const DEFAULT_REGION: Region = {
  latitude: 32.7021,
  longitude: 35.2978,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
};

type IconLib = "ion" | "mci";

type Problem = {
  key: string;
  title: string;
  lib: IconLib;
  icon: string;
};

const PROBLEMS: Problem[] = [
  { key: "flat", title: "Flat Tire", lib: "ion", icon: "car-outline" },
  { key: "battery", title: "Dead Battery", lib: "ion", icon: "battery-dead-outline" },
  { key: "fuel", title: "Out of Fuel", lib: "mci", icon: "gas-station-outline" },
  { key: "towing", title: "Towing", lib: "ion", icon: "warning-outline" },
  { key: "other", title: "Other", lib: "ion", icon: "construct-outline" },
];

const ProblemIcon: React.FC<{
  problem: Problem;
  color: string;
  size: number;
}> = ({ problem, color, size }) => {
  if (problem.lib === "mci") {
    return (
      <MaterialCommunityIcons name={problem.icon as any} size={size} color={color} />
    );
  }

  return <Ionicons name={problem.icon as any} size={size} color={color} />;
};

export default function RoadsideHelpScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const mapRef = useRef<MapView | null>(null);

  const [marker, setMarker] = useState({
    latitude: DEFAULT_REGION.latitude,
    longitude: DEFAULT_REGION.longitude,
  });

  const [problemTypes, setProblemTypes] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [descriptionError, setDescriptionError] = useState("");
  const [locating, setLocating] = useState(true);
  const [address, setAddress] = useState("");
  const [sending, setSending] = useState(false);

  // "Other" is the one problem type that requires a description — every
  // other type keeps it optional.
  const isOther = problemTypes.includes("other");

  const toggleProblem = (key: string) => {
    setProblemTypes((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];

      // Switching away from "Other" means a description is no longer
      // required — clear any leftover error, but keep whatever text the
      // user already typed.
      if (!next.includes("other")) {
        setDescriptionError("");
      }

      return next;
    });
  };

  const coordsLabel = `${marker.latitude.toFixed(5)}, ${marker.longitude.toFixed(
    5,
  )}`;
  const addressLabel = address || coordsLabel;

  // Turn coordinates into a readable place name (best effort).
  const resolveAddress = async (latitude: number, longitude: number) => {
    try {
      const results = await Location.reverseGeocodeAsync({ latitude, longitude });
      const place = results[0];

      if (place) {
        const parts = [place.name, place.city, place.region].filter(Boolean);
        setAddress(parts.join(", "));
      }
    } catch {
      // Fall back to raw coordinates.
    }
  };

  const goToMyLocation = async () => {
    try {
      setLocating(true);

      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        setLocating(false);
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const next = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };

      setMarker(next);
      resolveAddress(next.latitude, next.longitude);
      mapRef.current?.animateToRegion(
        {
          ...next,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        600,
      );
    } catch {
      // Keep the default region if location can't be resolved.
    } finally {
      setLocating(false);
    }
  };

  // Detect the user's location automatically when the screen opens.
  useEffect(() => {
    goToMyLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFindHelp = async () => {
    if (problemTypes.length === 0) {
      Alert.alert(
        t("roadsideHelp.selectProblemTitle"),
        t("roadsideHelp.selectProblemMessage"),
      );
      return;
    }

    const trimmedDescription = description.trim();

    if (isOther && !trimmedDescription) {
      setDescriptionError(t("roadsideHelp.descriptionRequiredMessage"));
      Alert.alert(
        t("roadsideHelp.descriptionRequiredTitle"),
        t("roadsideHelp.descriptionRequiredMessage"),
      );
      return;
    }

    setDescriptionError("");

    if (sending) return;

    const problemTitles = PROBLEMS.filter((p) => problemTypes.includes(p.key)).map(
      (p) => p.title,
    );
    const problemLabel = problemTitles.join(", ");

    try {
      setSending(true);

      // Save the request in Firestore and notify nearby drivers.
      const { requestId, matchedCount } = await createRoadsideRequest({
        problemKeys: problemTypes,
        problemTitles,
        description: trimmedDescription,
        location: {
          latitude: marker.latitude,
          longitude: marker.longitude,
          address: addressLabel,
        },
      });

      // Go to the waiting screen where offers arrive in real time.
      router.push({
        pathname: "/booking/roadside-help/waiting",
        params: {
          requestId,
          matchedCount: String(matchedCount),
          problemLabel,
          address: addressLabel,
          lat: String(marker.latitude),
          lng: String(marker.longitude),
        },
      } as any);
    } catch (error: any) {
      Alert.alert(
        t("roadsideHelp.couldNotSendRequestTitle"),
        error?.message || t("validation.pleaseTryAgain"),
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <DirectionalScreen style={styles.page}>
      <KeyboardSafeScreen contentContainerStyle={styles.scroll}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name={isRTL ? "arrow-forward" : "arrow-back"} size={24} color="#7C5F46" />
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.headerEmoji}>🔧</Text>
          <Text style={styles.title}>{t("rideCategory.categories.help.title")}</Text>
        </View>
        <PhysicalDirectionalBlockText style={styles.subtitle}>
          {t("roadsideHelp.subtitle")}
        </PhysicalDirectionalBlockText>

        {/* Your location + map */}
        <View style={styles.card}>
          <View style={styles.locationTitleRow}>
            <Ionicons name="location-outline" size={18} color="#F58220" />
            <Text style={styles.sectionTitle}>{t("roadsideHelp.yourLocation")}</Text>
          </View>

          <View style={styles.addressRow}>
            <Ionicons name="location" size={16} color="#EC4899" />
            <Text style={styles.addressText}>{addressLabel}</Text>
          </View>

          <PhysicalDirectionalBlockText style={styles.hintText}>
            {locating
              ? t("roadsideHelp.detectingLocation")
              : t("roadsideHelp.dragPinAdjustHint")}
          </PhysicalDirectionalBlockText>

          <View style={styles.mapWrapper}>
            <MapView
              ref={mapRef}
              style={styles.map}
              initialRegion={DEFAULT_REGION}
              onPress={(event) => setMarker(event.nativeEvent.coordinate)}
            >
              <Marker
                draggable
                coordinate={marker}
                onDragEnd={(event) => setMarker(event.nativeEvent.coordinate)}
              />
            </MapView>

            <Pressable style={[styles.recenterButton, positionEnd(12, isRTL)]} onPress={goToMyLocation}>
              <Ionicons name="locate" size={20} color="#F58220" />
            </Pressable>
          </View>
        </View>

        {/* Problem type */}
        <View style={styles.card}>
          <View style={styles.locationTitleRow}>
            <Ionicons name="construct-outline" size={18} color="#F58220" />
            <Text style={styles.sectionTitle}>{t("roadsideHelp.whatsTheProblem")}</Text>
          </View>

          <PhysicalDirectionalBlockText style={styles.problemHint}>
            {t("roadsideHelp.selectAtLeastOneHint")}
          </PhysicalDirectionalBlockText>

          <View style={styles.grid}>
            {PROBLEMS.map((problem) => {
              const selected = problemTypes.includes(problem.key);

              return (
                <Pressable
                  key={problem.key}
                  style={[styles.problemCard, selected && styles.problemCardActive]}
                  onPress={() => toggleProblem(problem.key)}
                >
                  <ProblemIcon
                    problem={problem}
                    size={26}
                    color={selected ? "#F58220" : "#7C5F46"}
                  />
                  <Text
                    style={[
                      styles.problemText,
                      selected && styles.problemTextActive,
                    ]}
                  >
                    {translateProblemType(problem.title, t)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Description */}
        <View style={styles.card}>
          <PhysicalDirectionalBlockText style={styles.label}>
            {t("roadsideHelp.describeProblemLabel")}{isOther ? " *" : ""}
          </PhysicalDirectionalBlockText>
          <TextInput
            style={[
              styles.textArea,
              {
                textAlign: isRTL ? "right" : "left",
                writingDirection: isRTL ? "rtl" : "ltr",
              },
            ]}
            placeholder={
              isOther ? t("roadsideHelp.describeHelpNeededPlaceholder") : t("roadsideHelp.describeProblemPlaceholder")
            }
            placeholderTextColor="#8B7B6B"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            value={description}
            onChangeText={(text) => {
              setDescription(text);
              if (descriptionError && text.trim()) {
                setDescriptionError("");
              }
            }}
          />
          {descriptionError ? (
            <PhysicalDirectionalBlockText style={styles.fieldError}>
              {descriptionError}
            </PhysicalDirectionalBlockText>
          ) : null}
        </View>

        <Pressable
          style={[
            styles.searchButton,
            (problemTypes.length === 0 ||
              sending ||
              (isOther && !description.trim())) &&
              styles.searchButtonDisabled,
          ]}
          onPress={handleFindHelp}
          disabled={problemTypes.length === 0 || sending || (isOther && !description.trim())}
        >
          {sending ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="search-outline" size={20} color="#FFFFFF" />
              <Text style={styles.searchText}>{t("roadsideHelp.findNearbyHelp")}</Text>
            </>
          )}
        </Pressable>
      </KeyboardSafeScreen>
    </DirectionalScreen>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  scroll: {
    padding: 20,
    paddingTop: 50,
    paddingBottom: 40,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    marginBottom: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerEmoji: {
    fontSize: 26,
  },
  title: {
    fontSize: 30,
    fontWeight: "900",
    color: "#111827",
  },
  subtitle: {
    fontSize: 15,
    color: "#7C5F46",
    marginTop: 6,
    marginBottom: 24,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: "#111827",
  },
  locationTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  addressText: {
    color: "#111827",
    fontWeight: "700",
  },
  hintText: {
    color: "#7C5F46",
    fontSize: 13,
    marginBottom: 12,
  },
  mapWrapper: {
    height: 240,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E7DCD1",
  },
  map: {
    width: "100%",
    height: "100%",
  },
  recenterButton: {
    position: "absolute",
    bottom: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E7DCD1",
  },
  problemHint: {
    color: "#7C5F46",
    fontSize: 13,
    marginBottom: 12,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  problemCard: {
    flexGrow: 1,
    flexBasis: "30%",
    minHeight: 92,
    backgroundColor: "#FFFDFC",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    paddingHorizontal: 6,
    gap: 8,
  },
  problemCardActive: {
    borderColor: "#F58220",
    backgroundColor: "#FFF2E8",
  },
  problemText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#7C5F46",
    textAlign: "center",
  },
  problemTextActive: {
    color: "#B86115",
  },
  label: {
    fontSize: 15,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 4,
  },
  fieldError: {
    color: "#B91C1C",
    fontWeight: "700",
    fontSize: 12.5,
    marginTop: 8,
  },
  textArea: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
    minHeight: 110,
    backgroundColor: "#FFFDFC",
    color: "#111827",
  },
  searchButton: {
    backgroundColor: "#F58220",
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  searchButtonDisabled: {
    backgroundColor: "#F3C39A",
  },
  searchText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 16,
  },
});
