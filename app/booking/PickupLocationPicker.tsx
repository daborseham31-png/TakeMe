// ---------------------------------------------------------------------------
// Shared "Pickup Location" bottom sheet — Use Current Location / Home / a
// saved place / Choose Another Location (searchable map, draggable pin) /
// Add new location. Reused by Personal Ride, School Trips (outbound only),
// and Work/Errand. Roadside Help deliberately does NOT use this component —
// it keeps its own existing auto-GPS + draggable-pin screen unchanged (see
// roadside-help/index.tsx), which this component's map layer is modeled on.
//
// The bottom-sheet Modal/card/handle structure copies the existing pattern
// in DirectionSearchForm.tsx's child-picker modal — this app's one
// established bottom-sheet convention, not a new one.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Alert } from "../AppAlert";
import MapView, { Marker, Region } from "../../components/PlatformMapView";
import { useTranslation } from "react-i18next";

import {
  DirectionalCard,
  DirectionalScreen,
  PhysicalDirectionalBlockText,
} from "../i18n/DirectionalPrimitives";
import { useLanguage } from "../i18n/LanguageProvider";
import { backIconName } from "../i18n/rtl";
import IsraelLocationAutocomplete from "./IsraelLocationAutocomplete";
import { IsraelLocation } from "./israelLocations";
import {
  detectInputLanguage,
  getLocationDisplayName,
  normalizeLocationText,
  resolveLocationCoordinates,
} from "./locationSearch";
import {
  createSavedLocation,
  SavedLocation,
  subscribeMySavedLocations,
} from "./savedLocationsLib";
import { detectCurrentLocation } from "./work-errand/workErrandLib";

export type PickupLocationSource = "current" | "home" | "custom";

export type PickupLocation = {
  latitude: number;
  longitude: number;
  address: string;
  source: PickupLocationSource;
};

// Best-effort reverse-geocoded area/city name for a pickup point — used by
// Personal Ride (ride-payment.tsx) and Work (apply.tsx) to give the driver/
// employer a short "Passenger area: …" label distinct from the full
// address, without exposing anything beyond the ONE point the requester
// already chose (see this feature's own "never expose live location /
// private home address automatically" requirement — this only ever
// resolves the SAME point already selected, never anything else). Reuses
// the exact same reverse-geocoder this file already calls elsewhere
// (resolveAddress/handleUseCurrent) — deliberately never blocks/fails the
// caller: returns "" on any error so a resolution failure never prevents a
// request from being submitted.
export const resolvePickupArea = async (
  latitude: number,
  longitude: number,
): Promise<string> => {
  try {
    const results = await Location.reverseGeocodeAsync({ latitude, longitude });
    const place = results[0];
    if (!place) return "";
    return place.city || place.subregion || place.district || place.region || "";
  } catch {
    return "";
  }
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onSelect: (location: PickupLocation) => void;
};

const DEFAULT_REGION: Region = {
  latitude: 32.7021,
  longitude: 35.2978,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
};

// A loose bounding box around Israel (incl. the West Bank/Gaza — this app's
// whole service area) — used only to REJECT a geocoder match that's
// obviously in the wrong country (see LocationMapModal's street search),
// never to validate/restrict what the curated israelLocations.ts dataset or
// the driver's own current-location fix return.
const ISRAEL_BOUNDS = { minLat: 29.3, maxLat: 33.5, minLng: 34.1, maxLng: 35.9 };

const isWithinIsraelBounds = (latitude: number, longitude: number): boolean =>
  latitude >= ISRAEL_BOUNDS.minLat &&
  latitude <= ISRAEL_BOUNDS.maxLat &&
  longitude >= ISRAEL_BOUNDS.minLng &&
  longitude <= ISRAEL_BOUNDS.maxLng;

const COUNTRY_NAME_BY_INPUT_LANGUAGE: Record<string, string> = {
  arabic: "إسرائيل",
  hebrew: "ישראל",
  english: "Israel",
  russian: "Израиль",
};

export default function PickupLocationPicker({ visible, onClose, onSelect }: Props) {
  const { t } = useTranslation();
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [mapMode, setMapMode] = useState<"choose" | "add" | null>(null);

  useEffect(() => {
    if (!visible) {
      setMapMode(null);
      return;
    }
    return subscribeMySavedLocations(setSavedLocations);
  }, [visible]);

  const home = savedLocations.find((l) => l.isHome) || null;
  const others = savedLocations.filter((l) => !l.isHome);

  const handleUseCurrent = async () => {
    if (detecting) return;

    try {
      setDetecting(true);
      const loc = await detectCurrentLocation();

      if (typeof loc.latitude !== "number" || typeof loc.longitude !== "number") {
        throw new Error(t("pickupLocation.couldNotDetect"));
      }

      onSelect({ latitude: loc.latitude, longitude: loc.longitude, address: loc.address, source: "current" });
      onClose();
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("pickupLocation.couldNotDetect"));
    } finally {
      setDetecting(false);
    }
  };

  const handleSelectSaved = (loc: SavedLocation) => {
    onSelect({
      latitude: loc.latitude,
      longitude: loc.longitude,
      address: loc.address,
      source: loc.isHome ? "home" : "custom",
    });
    onClose();
  };

  const handleMapConfirm = async (result: MapConfirmResult) => {
    if (mapMode === "add") {
      try {
        await createSavedLocation({
          label: result.label || "",
          latitude: result.latitude,
          longitude: result.longitude,
          address: result.address,
        });
      } catch (error: any) {
        Alert.alert(t("common.error"), error?.message || t("savedLocations.couldNotSave"));
        return;
      }
    }

    setMapMode(null);
    onSelect({
      latitude: result.latitude,
      longitude: result.longitude,
      address: result.address,
      source: "custom",
    });
    onClose();
  };

  // Only one native Modal is ever presented at a time — trying to present
  // the map Modal (below) while this sheet's own Modal is still visible
  // silently fails to show it on iOS (two simultaneously-presented RN
  // Modals from sibling components, not one nested in the other, is a
  // known RN limitation). The sheet hides itself the instant a map mode is
  // picked, and reappears if the map is closed without confirming.
  const sheetVisible = visible && mapMode === null;

  return (
    <>
      <Modal visible={sheetVisible} animationType="slide" transparent onRequestClose={onClose}>
        <View style={styles.overlay}>
          <Pressable style={styles.backdrop} onPress={onClose} />

          <DirectionalCard style={styles.card}>
            <View style={styles.handle} />
            <PhysicalDirectionalBlockText style={styles.title}>
              {t("pickupLocation.sheetTitle")}
            </PhysicalDirectionalBlockText>

            <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
              <Pressable style={styles.row} onPress={handleUseCurrent} disabled={detecting}>
                <View style={styles.rowIcon}>
                  <Ionicons name="navigate" size={18} color="#F58220" />
                </View>
                <View style={styles.rowTextBox}>
                  <Text style={styles.rowLabel}>{t("pickupLocation.useCurrentLocation")}</Text>
                </View>
                {detecting ? <ActivityIndicator color="#F58220" /> : null}
              </Pressable>

              <Pressable
                style={styles.row}
                onPress={() => (home ? handleSelectSaved(home) : setMapMode("add"))}
              >
                <View style={styles.rowIcon}>
                  <Ionicons name="home" size={18} color="#F58220" />
                </View>
                <View style={styles.rowTextBox}>
                  <Text style={styles.rowLabel}>{t("pickupLocation.home")}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {home ? home.address : t("pickupLocation.addHomeAddress")}
                  </Text>
                </View>
              </Pressable>

              {others.map((loc) => (
                <Pressable key={loc.id} style={styles.row} onPress={() => handleSelectSaved(loc)}>
                  <View style={styles.rowIcon}>
                    <Ionicons name="location" size={18} color="#F58220" />
                  </View>
                  <View style={styles.rowTextBox}>
                    <Text style={styles.rowLabel}>{loc.label}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {loc.address}
                    </Text>
                  </View>
                </Pressable>
              ))}

              <Pressable style={styles.row} onPress={() => setMapMode("choose")}>
                <View style={styles.rowIcon}>
                  <Ionicons name="map" size={18} color="#F58220" />
                </View>
                <View style={styles.rowTextBox}>
                  <Text style={styles.rowLabel}>{t("pickupLocation.chooseAnotherLocation")}</Text>
                </View>
              </Pressable>

              <Pressable style={styles.addRow} onPress={() => setMapMode("add")}>
                <Ionicons name="add-circle-outline" size={18} color="#F58220" />
                <Text style={styles.addRowText}>{t("pickupLocation.addNewLocation")}</Text>
              </Pressable>
            </ScrollView>

            <Pressable style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelText}>{t("common.cancel")}</Text>
            </Pressable>
          </DirectionalCard>
        </View>
      </Modal>

      <LocationMapModal
        visible={mapMode !== null}
        variant={mapMode || "choose"}
        onClose={() => setMapMode(null)}
        onConfirm={handleMapConfirm}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Map layer — "Choose Another Location" and "+ Add new location" share this
// exact screen; "add" just also asks for a label and saves it. Modeled on
// roadside-help/index.tsx's own map card (search box added on top, via
// IsraelLocationAutocomplete + resolveLocationCoordinates, the same
// geocoding fallback DirectionSearchForm.tsx already uses).
// ---------------------------------------------------------------------------

export type MapConfirmResult = { latitude: number; longitude: number; address: string; label?: string };

export function LocationMapModal({
  visible,
  variant,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  variant: "choose" | "add";
  onClose: () => void;
  onConfirm: (result: MapConfirmResult) => void;
}) {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const mapRef = useRef<MapView | null>(null);

  const [marker, setMarker] = useState({
    latitude: DEFAULT_REGION.latitude,
    longitude: DEFAULT_REGION.longitude,
  });
  const [address, setAddress] = useState("");
  const [locating, setLocating] = useState(true);
  const [searchText, setSearchText] = useState("");
  // The selected city (from the curated israelLocations.ts dataset) — kept
  // separately from `searchText` so the street search below always has a
  // real city name to anchor its query to, per this screen's own spec:
  // never geocode a bare street name alone. cityCoords is that city's own
  // center point — the "revert to" target once a street pick is edited away
  // (see handleStreetQueryChange).
  const [cityPlace, setCityPlace] = useState<IsraelLocation | null>(null);
  const [cityCoords, setCityCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [label, setLabel] = useState("");

  // Street-level address search — separate from the city field above.
  // Live geocoding (Location.geocodeAsync, the OS's own geocoder — this
  // project has no paid places/autocomplete API), not the curated city
  // dataset, since a specific street is never in that dataset.
  const [streetQuery, setStreetQuery] = useState("");
  const [streetSuggestions, setStreetSuggestions] = useState<
    { latitude: number; longitude: number; label: string }[]
  >([]);
  const [streetSearching, setStreetSearching] = useState(false);
  const [streetNotFound, setStreetNotFound] = useState(false);
  // Whether the CURRENT pin/address came from picking a street suggestion —
  // set on a successful pick, cleared the instant the street text is edited
  // again (see handleStreetQueryChange) so an edit never leaves a stale
  // street pin/address behind (spec #8).
  const pinFromStreetPickRef = useRef(false);
  // Guards against a slow, stale geocode response overwriting a newer
  // search's results (spec #5) — every search bumps this before its debounce
  // timer starts; a response only applies if it's still the latest.
  const searchTokenRef = useRef(0);
  // Set right before programmatically filling streetQuery with a picked
  // suggestion's own label (see handleSelectStreetSuggestion) — the search
  // effect below skips exactly that one resulting run, so confirming a pick
  // never immediately re-searches (and re-opens a suggestion list) for the
  // text it just filled in.
  const suppressNextSearchRef = useRef(false);

  const formatPlaceLabel = (place: Location.LocationGeocodedAddress) =>
    [place.name, place.city, place.region].filter(Boolean).join(", ");

  // A candidate only counts as being IN the selected city if its own
  // reverse-geocoded city/subregion/district actually matches one of the
  // city's three localized names (spec #3/#4) — never accepted just because
  // it's somewhere inside Israel. Lenient (normalized substring, either
  // direction) since a geocoder's own city text doesn't always exactly
  // match the curated dataset's spelling.
  const matchesSelectedCity = (place: Location.LocationGeocodedAddress, city: IsraelLocation): boolean => {
    const candidateNames = [place.city, place.subregion, place.district].filter(
      (value): value is string => !!value,
    );
    if (candidateNames.length === 0) return false;

    const cityNames = [city.english, city.arabic, city.hebrew].filter(
      (value): value is string => !!value,
    );

    return candidateNames.some((candidateName) => {
      const normCandidate = normalizeLocationText(candidateName);
      return cityNames.some((cityName) => {
        const normCity = normalizeLocationText(cityName);
        return normCandidate.includes(normCity) || normCity.includes(normCandidate);
      });
    });
  };

  const resolveAddress = async (latitude: number, longitude: number) => {
    try {
      const results = await Location.reverseGeocodeAsync({ latitude, longitude });
      const place = results[0];

      if (place) {
        setAddress(formatPlaceLabel(place));
      }
    } catch {
      // Fall back to raw coordinates (see addressLabel below).
    }
  };

  // Moves the map + pin to a resolved point and updates the displayed
  // address — the one place both a street-suggestion tap and (elsewhere) a
  // city pick land on, so they always behave identically.
  const movePinTo = (point: { latitude: number; longitude: number }, addressLabelText?: string) => {
    setMarker(point);
    mapRef.current?.animateToRegion({ ...point, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 500);

    if (addressLabelText) {
      setAddress(addressLabelText);
    } else {
      resolveAddress(point.latitude, point.longitude);
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

      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const next = { latitude: position.coords.latitude, longitude: position.coords.longitude };

      setMarker(next);
      resolveAddress(next.latitude, next.longitude);
      mapRef.current?.animateToRegion({ ...next, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 600);
    } catch {
      // Keep the default region if location can't be resolved.
    } finally {
      setLocating(false);
    }
  };

  useEffect(() => {
    if (!visible) return;
    setSearchText("");
    setCityPlace(null);
    setCityCoords(null);
    setLabel("");
    setAddress("");
    setStreetQuery("");
    setStreetSuggestions([]);
    setStreetNotFound(false);
    pinFromStreetPickRef.current = false;
    goToMyLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleSelectSearchLocation = async (place: IsraelLocation) => {
    const coords = await resolveLocationCoordinates(place, searchText);
    setCityPlace(place);
    setCityCoords(coords);
    // A new city invalidates whatever street search/result was showing for
    // the PREVIOUS city — never leave a stale suggestion/pin mismatch.
    setStreetQuery("");
    setStreetSuggestions([]);
    setStreetNotFound(false);
    pinFromStreetPickRef.current = false;

    if (!coords) return;
    movePinTo(coords);
  };

  // Spec #1/#8: clear suggestions the instant the text changes (never wait
  // for the debounced search below), and if the pin/address currently shown
  // came from a PREVIOUS street pick, revert to the city's own center —
  // an edited query must never leave the old pick's coordinates/address
  // looking like they still apply to the new (not yet searched) text.
  const handleStreetQueryChange = (text: string) => {
    setStreetQuery(text);
    setStreetSuggestions([]);
    setStreetNotFound(false);

    if (pinFromStreetPickRef.current) {
      pinFromStreetPickRef.current = false;
      if (cityCoords) {
        movePinTo(cityCoords);
      } else {
        setAddress("");
      }
    }
  };

  // Street-level search — debounced, and only ever fires once a city is
  // picked (see this component's own header comment: never search a street
  // name alone) and at least 3 meaningful characters have been typed (spec
  // #7). Expo's geocodeAsync (the OS's own geocoder — no paid places/
  // autocomplete API in this project) usually returns very few candidates
  // for one query; each is reverse-geocoded to build a real, readable
  // suggestion label AND to check it's actually inside the selected city
  // (matchesSelectedCity) — a geocoder match in the right country but the
  // wrong city (e.g. "Nazareth Street" in Shefa-Amr, for a Nazareth search)
  // is exactly as wrong as no match, never shown as if it were correct.
  useEffect(() => {
    if (suppressNextSearchRef.current) {
      suppressNextSearchRef.current = false;
      return;
    }

    const query = streetQuery.trim();

    if (!cityPlace || query.length < 3) {
      setStreetSuggestions([]);
      setStreetSearching(false);
      setStreetNotFound(false);
      return;
    }

    const myToken = ++searchTokenRef.current;
    setStreetNotFound(false);

    const timer = setTimeout(async () => {
      setStreetSearching(true);

      try {
        // Match the city name's script to whatever script the street was
        // typed in (rather than the app's own UI language) — a mixed-script
        // query (e.g. an Arabic street with a Latin city name) is what
        // sent the on-device geocoder wildly off (a real match returned a
        // location in Syria for a Nazareth-area address). Same reasoning
        // for the country name.
        const inputLanguage = detectInputLanguage(query);
        const cityName = getLocationDisplayName(cityPlace, inputLanguage);
        const countryName = COUNTRY_NAME_BY_INPUT_LANGUAGE[inputLanguage];
        const fullQuery = `${query}, ${cityName}, ${countryName}`;
        const candidates = await Location.geocodeAsync(fullQuery);

        // A newer search has started since this one was kicked off — never
        // let a slow, stale response overwrite its (possibly already
        // resolved) results (spec #5).
        if (searchTokenRef.current !== myToken) return;

        // Every real address this app ever needs is inside Israel — a
        // geocoder match outside it (like the Syria case above) is exactly
        // as wrong as no match at all, and must never be silently accepted
        // as if it were correct.
        const withinIsrael = candidates.filter((candidate) =>
          isWithinIsraelBounds(candidate.latitude, candidate.longitude),
        );

        const reversed = await Promise.all(
          withinIsrael.slice(0, 8).map(async (candidate) => {
            try {
              const reverse = await Location.reverseGeocodeAsync({
                latitude: candidate.latitude,
                longitude: candidate.longitude,
              });
              return { candidate, place: reverse[0] || null };
            } catch {
              return { candidate, place: null };
            }
          }),
        );

        if (searchTokenRef.current !== myToken) return;

        // Spec #3/#4 — reject anything whose reverse-geocoded city doesn't
        // actually match the one the passenger selected.
        const labeled = reversed
          .filter(({ place }) => place && matchesSelectedCity(place, cityPlace))
          .slice(0, 5)
          .map(({ candidate, place }) => ({
            latitude: candidate.latitude,
            longitude: candidate.longitude,
            label: place ? formatPlaceLabel(place) : fullQuery,
          }));

        setStreetSuggestions(labeled);
        setStreetNotFound(labeled.length === 0);
      } catch {
        if (searchTokenRef.current === myToken) {
          setStreetSuggestions([]);
          setStreetNotFound(true);
        }
      } finally {
        if (searchTokenRef.current === myToken) setStreetSearching(false);
      }
    }, 500);

    return () => {
      clearTimeout(timer);
    };
  }, [streetQuery, cityPlace]);

  const handleSelectStreetSuggestion = (suggestion: { latitude: number; longitude: number; label: string }) => {
    pinFromStreetPickRef.current = true;
    movePinTo({ latitude: suggestion.latitude, longitude: suggestion.longitude }, suggestion.label);
    setStreetSuggestions([]);
    setStreetNotFound(false);
    // Fill the field with what was actually picked (the whole point of an
    // autocomplete suggestion) — suppressed once so this doesn't immediately
    // re-trigger the search effect for the text it just set.
    suppressNextSearchRef.current = true;
    setStreetQuery(suggestion.label);
  };

  const coordsLabel = `${marker.latitude.toFixed(5)}, ${marker.longitude.toFixed(5)}`;
  const addressLabel = address || coordsLabel;

  const handleConfirm = () => {
    if (variant === "add" && !label.trim()) {
      Alert.alert(t("savedLocations.labelRequiredTitle"), t("savedLocations.labelRequired"));
      return;
    }

    onConfirm({
      latitude: marker.latitude,
      longitude: marker.longitude,
      address: addressLabel,
      label: variant === "add" ? label.trim() : undefined,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <DirectionalScreen style={mapStyles.screen}>
        <View style={mapStyles.header}>
          <Pressable style={mapStyles.backButton} onPress={onClose}>
            <Ionicons name={backIconName(isRTL)} size={22} color="#7C5F46" />
          </Pressable>
          <Text style={mapStyles.headerTitle}>
            {variant === "add" ? t("savedLocations.addLocationTitle") : t("pickupLocation.chooseAnotherLocation")}
          </Text>
        </View>

        <View style={mapStyles.searchBox}>
          <IsraelLocationAutocomplete
            value={searchText}
            onChangeText={setSearchText}
            onSelectLocation={handleSelectSearchLocation}
            placeholder={t("pickupLocation.searchPlaceholder")}
          />
        </View>

        <View style={mapStyles.streetBox}>
          <View style={mapStyles.streetInputRow}>
            <TextInput
              style={mapStyles.streetInput}
              placeholder={
                cityPlace
                  ? t("pickupLocation.streetPlaceholder")
                  : t("pickupLocation.selectCityFirstHint")
              }
              placeholderTextColor="#9B7A68"
              value={streetQuery}
              onChangeText={handleStreetQueryChange}
              editable={!!cityPlace}
            />
            {streetSearching ? <ActivityIndicator color="#F58220" /> : null}
          </View>

          {streetSuggestions.length > 0 ? (
            <View style={mapStyles.suggestionsBox}>
              {streetSuggestions.map((suggestion, index) => (
                <Pressable
                  key={`${suggestion.latitude}-${suggestion.longitude}-${index}`}
                  style={mapStyles.suggestionRow}
                  onPress={() => handleSelectStreetSuggestion(suggestion)}
                >
                  <Ionicons name="location-outline" size={16} color="#7C5F46" />
                  <Text style={mapStyles.suggestionText} numberOfLines={1}>
                    {suggestion.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {streetNotFound ? (
            <Text style={mapStyles.streetNotFoundText}>
              {t("pickupLocation.addressNotFound")}
            </Text>
          ) : null}
        </View>

        {variant === "add" ? (
          <View style={mapStyles.labelBox}>
            <TextInput
              style={mapStyles.labelInput}
              placeholder={t("savedLocations.labelPlaceholder")}
              placeholderTextColor="#9B7A68"
              value={label}
              onChangeText={setLabel}
            />
          </View>
        ) : null}

        <View style={mapStyles.mapWrapper}>
          <MapView
            ref={mapRef}
            style={mapStyles.map}
            initialRegion={DEFAULT_REGION}
            onPress={(event) => {
              // A manual tap is now the authoritative position — it
              // supersedes (never gets reverted by) any earlier street pick.
              pinFromStreetPickRef.current = false;
              setMarker(event.nativeEvent.coordinate);
              resolveAddress(event.nativeEvent.coordinate.latitude, event.nativeEvent.coordinate.longitude);
              setStreetSuggestions([]);
              setStreetNotFound(false);
            }}
          >
            <Marker
              draggable
              coordinate={marker}
              onDragEnd={(event) => {
                pinFromStreetPickRef.current = false;
                setMarker(event.nativeEvent.coordinate);
                resolveAddress(event.nativeEvent.coordinate.latitude, event.nativeEvent.coordinate.longitude);
                setStreetSuggestions([]);
                setStreetNotFound(false);
              }}
            />
          </MapView>

          <Pressable style={mapStyles.recenterButton} onPress={goToMyLocation}>
            {locating ? (
              <ActivityIndicator color="#F58220" />
            ) : (
              <Ionicons name="locate" size={20} color="#F58220" />
            )}
          </Pressable>
        </View>

        <View style={mapStyles.footer}>
          <View style={mapStyles.addressRow}>
            <Ionicons name="location" size={16} color="#F58220" />
            <Text style={mapStyles.addressText} numberOfLines={2}>
              {locating ? t("pickupLocation.detectingLocation") : addressLabel}
            </Text>
          </View>

          <Pressable style={mapStyles.confirmButton} onPress={handleConfirm}>
            <Text style={mapStyles.confirmButtonText}>{t("pickupLocation.confirmLocationButton")}</Text>
          </Pressable>
        </View>
      </DirectionalScreen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  card: {
    backgroundColor: "#FBF7F1",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    maxHeight: "85%",
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#E2D8CF",
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 14,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 10,
    backgroundColor: "#FFFFFF",
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#FFF2E8",
    alignItems: "center",
    justifyContent: "center",
  },
  rowTextBox: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: "800",
    color: "#111827",
  },
  rowSub: {
    fontSize: 12.5,
    color: "#7C5F46",
    marginTop: 2,
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  addRowText: {
    color: "#F58220",
    fontWeight: "900",
    fontSize: 14,
  },
  cancelButton: {
    marginTop: 6,
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelText: {
    color: "#7C5F46",
    fontWeight: "800",
  },
});

const mapStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 12,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
  },
  searchBox: {
    paddingHorizontal: 16,
  },
  streetBox: {
    paddingHorizontal: 16,
    marginTop: 8,
  },
  streetInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
  },
  streetInput: {
    flex: 1,
    color: "#111827",
    fontWeight: "700",
    padding: 0,
  },
  suggestionsBox: {
    marginTop: 6,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 12,
    overflow: "hidden",
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F3ECE3",
  },
  suggestionText: {
    flex: 1,
    color: "#111827",
    fontWeight: "700",
    fontSize: 13.5,
  },
  streetNotFoundText: {
    color: "#B91C1C",
    fontWeight: "700",
    fontSize: 12.5,
    marginTop: 6,
  },
  labelBox: {
    paddingHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
  },
  labelInput: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
    color: "#111827",
    fontWeight: "700",
  },
  mapWrapper: {
    flex: 1,
    marginHorizontal: 16,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    marginTop: 8,
  },
  map: {
    width: "100%",
    height: "100%",
  },
  recenterButton: {
    position: "absolute",
    bottom: 12,
    right: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E7DCD1",
  },
  footer: {
    padding: 16,
    gap: 12,
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  addressText: {
    flex: 1,
    color: "#111827",
    fontWeight: "700",
    fontSize: 13.5,
  },
  confirmButton: {
    backgroundColor: "#F58220",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  confirmButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
  },
});
