import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import React, { useState } from "react";
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { auth, db } from "../../../firebase";
import DateInput, { TimeInput } from "./DateInput";
import {
  getDayFromDateText,
  getDigitsOnly,
  normalize,
  normalizeDateToYMD,
  normalizeTime,
  styles,
  useDriverAccount,
  validateAccountInfo,
} from "./driverHelpers";

type Mode = "" | "person" | "store";

export default function DeliveryScreen() {
  const [mode, setMode] = useState<Mode>("");

  if (mode === "person") {
    return <PersonalDeliverForm onBack={() => setMode("")} />;
  }

  if (mode === "store") {
    return <StoreDeliverForm onBack={() => setMode("")} />;
  }

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#7C5F46" />
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.title}>Item Delivery</Text>
          <Text style={styles.subtitle}>What would you like to offer?</Text>

          <Pressable
            style={styles.licenseButton}
            onPress={() => setMode("person")}
          >
            <View style={[styles.iconBox, { backgroundColor: "#A855F720" }]}>
              <Ionicons name="cube-outline" size={24} color="#A855F7" />
            </View>

            <View style={styles.column}>
              <Text style={styles.licenseButtonText}>Deliver Item</Text>
              <Text style={styles.subtitleSmall}>
                Send an item from one person to another
              </Text>
            </View>
          </Pressable>

          <Pressable
            style={styles.licenseButton}
            onPress={() => setMode("store")}
          >
            <View style={[styles.iconBox, { backgroundColor: "#F5822020" }]}>
              <Ionicons name="storefront-outline" size={24} color="#F58220" />
            </View>

            <View style={styles.column}>
              <Text style={styles.licenseButtonText}>Store Delivery</Text>
              <Text style={styles.subtitleSmall}>
                Bring items from a store or supermarket
              </Text>
            </View>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PersonalDeliverForm({ onBack }: { onBack: () => void }) {
  const { driverName, phone, driverAge, languages } = useDriverAccount();

  const [loading, setLoading] = useState(false);

  const [car, setCar] = useState("");
  const [carColor, setCarColor] = useState("");
  const [carPlate, setCarPlate] = useState("");

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [time, setTime] = useState("");
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [recipientPhone, setRecipientPhone] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [price, setPrice] = useState("");

  const handleSubmit = async () => {
    const user = auth.currentUser;

    if (!user) {
      Alert.alert("Login required", "Please login first.");
      router.replace("/");
      return;
    }

    const accountInfo = validateAccountInfo(driverName, phone, driverAge);

    if (!accountInfo) return;

    if (languages.length === 0) {
      Alert.alert(
        "Missing language",
        "Your language is missing from your account profile.",
      );
      return;
    }

    if (
      !car ||
      !carColor ||
      !carPlate ||
      !from ||
      !to ||
      !time ||
      !recipientPhone ||
      !itemDescription
    ) {
      Alert.alert("Missing details", "Please fill in all fields.");
      return;
    }

    const cleanTime = normalizeTime(time);

    if (!cleanTime) {
      Alert.alert(
        "Invalid time",
        "Please choose a valid time between 00:00 and 23:59.",
      );
      return;
    }

    const cleanRecipientPhone = getDigitsOnly(recipientPhone);

    if (cleanRecipientPhone.length !== 10) {
      Alert.alert(
        "Invalid phone",
        "Recipient phone number must be exactly 10 digits.",
      );
      return;
    }

    const cleanPrice = price ? Number(price) : 0;

    if (price && (Number.isNaN(cleanPrice) || cleanPrice <= 0)) {
      Alert.alert("Invalid price", "Price must be more than 0.");
      return;
    }

    try {
      setLoading(true);

      await addDoc(collection(db, "driverRoutes"), {
        driverId: user.uid,

        // fallback فقط. صفحة المسافر تقرأ الأساسي من users/{driverId}
        driverName,
        phone: accountInfo.cleanPhone,
        driverAge: accountInfo.cleanDriverAge,

        // اللغة جاية لحالها من بروفايل السائق
        languages,

        category: "delivery",
        deliveryType: "personalItem",

        car,
        carColor,
        carPlate,

        from,
        to,
        fromNormalized: normalize(from),
        toNormalized: normalize(to),

        time: cleanTime,
        recipientPhone: cleanRecipientPhone,
        itemDescription,
        price: cleanPrice,

        rating: 4.8,
        reviews: 0,
        eta: 10,
        active: true,

        createdAt: serverTimestamp(),
      });

      Alert.alert("Success", "Your delivery was created successfully.");
      router.replace("/(tabs)/home" as any);
    } catch (error: any) {
      console.log("CREATE PERSONAL DELIVERY ERROR:", error);
      Alert.alert("Error", error.message || "Could not create delivery.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={24} color="#7C5F46" />
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.title}>Deliver Item</Text>
          <Text style={styles.subtitle}>Send an item to someone</Text>

          <Text style={styles.label}>Car Model</Text>
          <View style={styles.inputRow}>
            <Ionicons name="car-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.rowInput}
              placeholder="e.g. Toyota Corolla 2022"
              placeholderTextColor="#8B7B6B"
              value={car}
              onChangeText={setCar}
            />
          </View>

          <Text style={styles.label}>Car Color</Text>
          <View style={styles.inputRow}>
            <Ionicons name="color-palette-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.rowInput}
              placeholder="e.g. White / Black / Silver"
              placeholderTextColor="#8B7B6B"
              value={carColor}
              onChangeText={setCarColor}
            />
          </View>

          <Text style={styles.label}>Car Plate Number</Text>
          <View style={styles.inputRow}>
            <Ionicons name="barcode-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.rowInput}
              placeholder="e.g. 1234567"
              placeholderTextColor="#8B7B6B"
              value={carPlate}
              onChangeText={setCarPlate}
            />
          </View>

          <Text style={styles.label}>From</Text>
          <View style={styles.inputRow}>
            <Ionicons name="location-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.rowInput}
              placeholder="e.g. Nazareth"
              placeholderTextColor="#8B7B6B"
              value={from}
              onChangeText={setFrom}
            />
          </View>

          <Text style={styles.label}>To</Text>
          <View style={styles.inputRow}>
            <Ionicons name="location-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.rowInput}
              placeholder="e.g. Mashhad"
              placeholderTextColor="#8B7B6B"
              value={to}
              onChangeText={setTo}
            />
          </View>

          <TimeInput
            label="Arrival Time to the Area"
            value={time}
            onChange={setTime}
            showPicker={showTimePicker}
            setShowPicker={setShowTimePicker}
          />

          <Text style={styles.label}>Recipient Phone Number</Text>
          <View style={styles.inputRow}>
            <Ionicons name="call-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.rowInput}
              placeholder="05XXXXXXXX"
              placeholderTextColor="#8B7B6B"
              keyboardType="numeric"
              maxLength={10}
              value={recipientPhone}
              onChangeText={(text) => setRecipientPhone(getDigitsOnly(text))}
            />
          </View>

          <Text style={styles.label}>Item Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Describe the item to deliver"
            placeholderTextColor="#8B7B6B"
            value={itemDescription}
            onChangeText={setItemDescription}
            multiline
          />

          <Text style={styles.label}>Price (₪)</Text>
          <View style={styles.inputRow}>
            <Ionicons name="cash-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.rowInput}
              placeholder="₪"
              placeholderTextColor="#8B7B6B"
              keyboardType="numeric"
              value={price}
              onChangeText={(text) => setPrice(getDigitsOnly(text))}
            />
          </View>

          <Pressable
            style={[
              styles.submitButton,
              loading && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={loading}
          >
            <Text style={styles.submitText}>
              {loading ? "Creating..." : "Create Delivery"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StoreDeliverForm({ onBack }: { onBack: () => void }) {
  const { driverName, phone, driverAge, languages } = useDriverAccount();

  const [loading, setLoading] = useState(false);

  const [car, setCar] = useState("");
  const [carColor, setCarColor] = useState("");
  const [carPlate, setCarPlate] = useState("");

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [storeName, setStoreName] = useState("");

  const [deliveryDate, setDeliveryDate] = useState("");
  const [showDeliveryDatePicker, setShowDeliveryDatePicker] = useState(false);

  const [time, setTime] = useState("");
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [price, setPrice] = useState("");

  const handleSubmit = async () => {
    const user = auth.currentUser;

    if (!user) {
      Alert.alert("Login required", "Please login first.");
      router.replace("/");
      return;
    }

    const accountInfo = validateAccountInfo(driverName, phone, driverAge);

    if (!accountInfo) return;

    if (languages.length === 0) {
      Alert.alert(
        "Missing language",
        "Your language is missing from your account profile.",
      );
      return;
    }

    if (
      !car ||
      !carColor ||
      !carPlate ||
      !from ||
      !to ||
      !storeName ||
      !deliveryDate ||
      !time
    ) {
      Alert.alert("Missing details", "Please fill in all fields.");
      return;
    }

    const cleanDeliveryDate = normalizeDateToYMD(deliveryDate);

    if (!cleanDeliveryDate) {
      Alert.alert(
        "Invalid date",
        "Delivery date must be today or a future date.",
      );
      return;
    }

    const deliveryDay = getDayFromDateText(cleanDeliveryDate);

    const cleanTime = normalizeTime(time);

    if (!cleanTime) {
      Alert.alert(
        "Invalid time",
        "Please choose a valid time between 00:00 and 23:59.",
      );
      return;
    }

    const cleanPrice = price ? Number(price) : 0;

    if (price && (Number.isNaN(cleanPrice) || cleanPrice <= 0)) {
      Alert.alert("Invalid price", "Price must be more than 0.");
      return;
    }

    try {
      setLoading(true);

      await addDoc(collection(db, "driverRoutes"), {
        driverId: user.uid,

        // fallback فقط. صفحة المسافر تقرأ الأساسي من users/{driverId}
        driverName,
        phone: accountInfo.cleanPhone,
        driverAge: accountInfo.cleanDriverAge,

        // اللغة جاية لحالها من بروفايل السائق
        languages,

        category: "delivery",
        deliveryType: "storeDelivery",

        car,
        carColor,
        carPlate,

        from,
        to,
        fromNormalized: normalize(from),
        toNormalized: normalize(to),

        storeName,

        // تاريخ التوصيل مثل باقي صفحات السائق
        tripDate: cleanDeliveryDate,
        deliveryDate: cleanDeliveryDate,
        day: deliveryDay,
        availableDays: [deliveryDay],

        time: cleanTime,
        price: cleanPrice,

        rating: 4.8,
        reviews: 0,
        eta: 10,
        active: true,

        createdAt: serverTimestamp(),
      });

      Alert.alert("Success", "Your delivery was created successfully.");
      router.replace("/(tabs)/home" as any);
    } catch (error: any) {
      console.log("CREATE DELIVERY ERROR:", error);
      Alert.alert("Error", error.message || "Could not create delivery.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={24} color="#7C5F46" />
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.title}>Store Delivery</Text>
          <Text style={styles.subtitle}>
            Set your car, pickup, drop-off, store, date, and arrival time
          </Text>

          <Text style={styles.label}>Car Model</Text>
          <View style={styles.inputRow}>
            <Ionicons name="car-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.rowInput}
              placeholder="e.g. Toyota Corolla 2022"
              placeholderTextColor="#8B7B6B"
              value={car}
              onChangeText={setCar}
            />
          </View>

          <Text style={styles.label}>Car Color</Text>
          <View style={styles.inputRow}>
            <Ionicons name="color-palette-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.rowInput}
              placeholder="e.g. White / Black / Silver"
              placeholderTextColor="#8B7B6B"
              value={carColor}
              onChangeText={setCarColor}
            />
          </View>

          <Text style={styles.label}>Car Plate Number</Text>
          <View style={styles.inputRow}>
            <Ionicons name="barcode-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.rowInput}
              placeholder="e.g. 1234567"
              placeholderTextColor="#8B7B6B"
              value={carPlate}
              onChangeText={setCarPlate}
            />
          </View>

          <Text style={styles.label}>From</Text>
          <View style={styles.inputRow}>
            <Ionicons name="location-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.rowInput}
              placeholder="e.g. Nazareth"
              placeholderTextColor="#8B7B6B"
              value={from}
              onChangeText={setFrom}
            />
          </View>

          <Text style={styles.label}>To</Text>
          <View style={styles.inputRow}>
            <Ionicons name="location-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.rowInput}
              placeholder="e.g. Mashhad"
              placeholderTextColor="#8B7B6B"
              value={to}
              onChangeText={setTo}
            />
          </View>

          <Text style={styles.label}>Store Name</Text>
          <View style={styles.inputRow}>
            <Ionicons name="storefront-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.rowInput}
              placeholder="e.g. Big Mall"
              placeholderTextColor="#8B7B6B"
              value={storeName}
              onChangeText={setStoreName}
            />
          </View>

          <DateInput
            label="Delivery Date"
            value={deliveryDate}
            onChange={setDeliveryDate}
            showPicker={showDeliveryDatePicker}
            setShowPicker={setShowDeliveryDatePicker}
          />

          <TimeInput
            label="Expected Arrival Time"
            value={time}
            onChange={setTime}
            showPicker={showTimePicker}
            setShowPicker={setShowTimePicker}
          />

          <Text style={styles.label}>Price (₪) </Text>
          <View style={styles.inputRow}>
            <Ionicons name="cash-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.rowInput}
              placeholder="₪"
              placeholderTextColor="#8B7B6B"
              keyboardType="numeric"
              value={price}
              onChangeText={(text) => setPrice(getDigitsOnly(text))}
            />
          </View>

          <Pressable
            style={[
              styles.submitButton,
              loading && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={loading}
          >
            <Text style={styles.submitText}>
              {loading ? "Creating..." : "Create Delivery"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
