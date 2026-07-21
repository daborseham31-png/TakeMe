import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
    Alert,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import MapView, { Marker, Region } from "react-native-maps";
import { useTranslation } from "react-i18next";
import { useLanguage } from "../i18n/LanguageProvider";

// Default map region (Nazareth area) used until the user moves the pin.
const DEFAULT_REGION: Region = {
  latitude: 32.7021,
  longitude: 35.2978,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
};

type StoreEntry = {
  id: string;
  name: string;
  items: string;
};

const cleanTimeInput = (value: string) => {
  return value.replace(/[^\d:]/g, "").slice(0, 5);
};

const normalizeTime = (value: string) => {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);

  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours < 0 || hours > 23) return null;
  if (minutes < 0 || minutes > 59) return null;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0",
  )}`;
};

let storeCounter = 1;

const makeStore = (): StoreEntry => {
  storeCounter += 1;
  return { id: `store-${storeCounter}`, name: "", items: "" };
};

export default function StoreDeliveryScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [marker, setMarker] = useState({
    latitude: DEFAULT_REGION.latitude,
    longitude: DEFAULT_REGION.longitude,
  });

  const [stores, setStores] = useState<StoreEntry[]>([
    { id: "store-1", name: "", items: "" },
  ]);

  const [fromTime, setFromTime] = useState("");
  const [toTime, setToTime] = useState("");

  const addressLabel = `${marker.latitude.toFixed(5)}, ${marker.longitude.toFixed(
    5,
  )}`;

  const updateStore = (id: string, field: "name" | "items", value: string) => {
    setStores((prev) =>
      prev.map((store) =>
        store.id === id ? { ...store, [field]: value } : store,
      ),
    );
  };

  const addStore = () => {
    setStores((prev) => [...prev, makeStore()]);
  };

  const removeStore = (id: string) => {
    setStores((prev) =>
      prev.length === 1 ? prev : prev.filter((store) => store.id !== id),
    );
  };

  const handleFindDrivers = () => {
    const filledStores = stores.filter(
      (store) => store.name.trim() && store.items.trim(),
    );

    if (filledStores.length === 0) {
      Alert.alert(
        t("validation.missingStoreDetailsTitle"),
        t("validation.addAtLeastOneStore"),
      );
      return;
    }

    const cleanFrom = normalizeTime(fromTime);
    const cleanTo = normalizeTime(toTime);

    if (!cleanFrom || !cleanTo) {
      Alert.alert(
        t("validation.invalidTimeWindowTitle"),
        t("validation.enterValidFromToTimes"),
      );
      return;
    }

    const storeNames = filledStores.map((store) => store.name.trim()).join(", ");

    router.push({
      pathname: "/booking/driverresults",
      params: {
        category: "delivery",
        from: storeNames,
        to: addressLabel,
        genderPref: "any",
        languages: "",
        seats: "1",
        time: cleanFrom,
        timeWindowTo: cleanTo,
        deliveryLat: String(marker.latitude),
        deliveryLng: String(marker.longitude),
        stores: JSON.stringify(
          filledStores.map((store) => ({
            name: store.name.trim(),
            items: store.items.trim(),
          })),
        ),
        deliveryType: "store",
        bookingType: "delivery",
      },
    } as any);
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name={isRTL ? "arrow-forward" : "arrow-back"} size={24} color="#7C5F46" />
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.headerEmoji}>📦</Text>
          <Text style={styles.title}>{t("driverCreate.storeDeliveryTitle")}</Text>
        </View>
        <Text style={styles.subtitle}>{t("driverCreate.storeDeliveryDesc")}</Text>

        {/* Delivery location + map */}
        <View style={styles.card}>
          <View style={styles.locationTitleRow}>
            <Ionicons name="location-outline" size={18} color="#F58220" />
            <Text style={styles.sectionTitle}>
              {t("booking.yourLocationDeliveryAddress")}
            </Text>
          </View>

          <View style={styles.addressRow}>
            <Ionicons name="location" size={16} color="#EC4899" />
            <Text style={styles.addressText}>{addressLabel}</Text>
          </View>

          <Text style={styles.hintText}>
            {t("booking.dragPinHint")}
          </Text>

          <View style={styles.mapWrapper}>
            <MapView
              style={styles.map}
              initialRegion={DEFAULT_REGION}
              onRegionChangeComplete={setRegion}
              onPress={(event) => setMarker(event.nativeEvent.coordinate)}
            >
              <Marker
                draggable
                coordinate={marker}
                onDragEnd={(event) => setMarker(event.nativeEvent.coordinate)}
              />
            </MapView>

            <Pressable
              style={styles.recenterButton}
              onPress={() => {
                setMarker({
                  latitude: region.latitude,
                  longitude: region.longitude,
                });
              }}
            >
              <Ionicons name="locate" size={20} color="#F58220" />
            </Pressable>
          </View>
        </View>

        {/* Stores */}
        {stores.map((store, index) => (
          <View key={store.id} style={styles.card}>
            <View style={styles.storeHeaderRow}>
              <View style={styles.labelRow}>
                <Ionicons name="storefront-outline" size={18} color="#F58220" />
                <Text style={styles.label}>
                  {t("booking.storeName")}{stores.length > 1 ? ` ${index + 1}` : ""}
                </Text>
              </View>

              {stores.length > 1 && (
                <Pressable onPress={() => removeStore(store.id)}>
                  <Ionicons name="trash-outline" size={18} color="#B86115" />
                </Pressable>
              )}
            </View>

            <TextInput
              style={styles.input}
              placeholder={t("booking.enterStoreName")}
              placeholderTextColor="#8B7B6B"
              value={store.name}
              onChangeText={(text) => updateStore(store.id, "name", text)}
            />

            <View style={styles.labelRow}>
              <Ionicons name="bag-handle-outline" size={18} color="#F58220" />
              <Text style={styles.label}>{t("booking.whatDoYouNeed")}</Text>
            </View>

            <TextInput
              style={styles.textArea}
              placeholder={t("booking.listItemsNeeded")}
              placeholderTextColor="#8B7B6B"
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              value={store.items}
              onChangeText={(text) => updateStore(store.id, "items", text)}
            />
          </View>
        ))}

        <Pressable style={styles.addStoreButton} onPress={addStore}>
          <Ionicons name="add" size={20} color="#111827" />
          <Text style={styles.addStoreText}>{t("booking.addStore")}</Text>
        </Pressable>

        {/* Delivery time window */}
        <View style={styles.card}>
          <View style={styles.locationTitleRow}>
            <Ionicons name="time-outline" size={18} color="#F58220" />
            <Text style={styles.sectionTitle}>{t("booking.deliveryTimeWindow")}</Text>
          </View>

          <View style={styles.twoColumns}>
            <View style={styles.column}>
              <Text style={styles.label}>{t("booking.from")}</Text>
              <View style={styles.timeRow}>
                <TextInput
                  style={styles.timeInput}
                  placeholder="--:--"
                  placeholderTextColor="#8B7B6B"
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                  value={fromTime}
                  onChangeText={(text) => setFromTime(cleanTimeInput(text))}
                />
                <Ionicons name="time-outline" size={18} color="#111827" />
              </View>
            </View>

            <View style={styles.column}>
              <Text style={styles.label}>{t("booking.to")}</Text>
              <View style={styles.timeRow}>
                <TextInput
                  style={styles.timeInput}
                  placeholder="--:--"
                  placeholderTextColor="#8B7B6B"
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                  value={toTime}
                  onChangeText={(text) => setToTime(cleanTimeInput(text))}
                />
                <Ionicons name="time-outline" size={18} color="#111827" />
              </View>
            </View>
          </View>
        </View>

        <Pressable style={styles.searchButton} onPress={handleFindDrivers}>
          <Ionicons name="search-outline" size={20} color="#FFFFFF" />
          <Text style={styles.searchText}>{t("booking.findDrivers")}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
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
  storeHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
  },
  label: {
    fontSize: 14,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 8,
    marginTop: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
    backgroundColor: "#FFFDFC",
    color: "#111827",
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
  addStoreButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1.5,
    borderColor: "#D9CDBE",
    borderStyle: "dashed",
    borderRadius: 12,
    paddingVertical: 15,
    marginBottom: 16,
    backgroundColor: "#FFFFFF",
  },
  addStoreText: {
    fontWeight: "900",
    color: "#111827",
    fontSize: 15,
  },
  twoColumns: {
    flexDirection: "row",
    gap: 12,
  },
  column: {
    flex: 1,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: "#FFFDFC",
  },
  timeInput: {
    flex: 1,
    paddingVertical: 12,
    color: "#111827",
    fontWeight: "700",
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
  searchText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 16,
  },
});
