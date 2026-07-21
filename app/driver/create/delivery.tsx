import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { auth, db } from "../../../firebase";
import IsraelLocationAutocomplete from "../../booking/IsraelLocationAutocomplete";
import { IsraelLocation } from "../../booking/israelLocations";
import AutocompleteTextField from "../../components/AutocompleteTextField";
import VehicleDetailsSection from "../../components/VehicleDetailsSection";
import { fetchDriverEligibility } from "../driverEligibility";
import DateInput, { TimeInput } from "./DateInput";
import {
  getDigitsOnly,
  isValidCarPlate,
  normalize,
  styles,
  useDriverAccount,
  validateAccountInfo,
  validateDateAndTimeNotPassed,
} from "./driverHelpers";
import { recordUsedFormValues, useSavedFormValues } from "./savedFormValuesLib";

type Mode = "" | "person" | "store";

export default function DeliveryScreen() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("");

  if (mode === "person") {
    return <PersonalDeliverForm onBack={() => setMode("")} />;
  }

  if (mode === "store") {
    return <StoreDeliverForm onBack={() => setMode("")} />;
  }

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#7C5F46" />
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.title}>{t("driverCreate.itemDeliveryTitle")}</Text>
          <Text style={styles.subtitle}>{t("driverCreate.whatToOffer")}</Text>

          <Pressable
            style={styles.licenseButton}
            onPress={() => setMode("person")}
          >
            <View style={[styles.iconBox, { backgroundColor: "#A855F720" }]}>
              <Ionicons name="cube-outline" size={24} color="#A855F7" />
            </View>

            <View style={styles.column}>
              <Text style={styles.licenseButtonText}>
                {t("driverCreate.deliverItemTitle")}
              </Text>
              <Text style={styles.subtitleSmall}>
                {t("driverCreate.deliverItemDesc")}
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
              <Text style={styles.licenseButtonText}>
                {t("driverCreate.storeDeliveryTitle")}
              </Text>
              <Text style={styles.subtitleSmall}>
                {t("driverCreate.storeDeliveryDesc")}
              </Text>
            </View>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PersonalDeliverForm({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const { driverName, phone, driverAge, languages } = useDriverAccount();

  const [loading, setLoading] = useState(false);

  const [car, setCar] = useState("");
  const [carColor, setCarColor] = useState("");
  const [carPlate, setCarPlate] = useState("");
  const savedValues = useSavedFormValues();
  const [prefilledVehicle, setPrefilledVehicle] = useState(false);
  useEffect(() => {
    if (prefilledVehicle) return;
    if (!savedValues.carModels.length && !savedValues.carColors.length && !savedValues.plateNumbers.length) {
      return;
    }

    setCar((current) => current || savedValues.carModels[0] || "");
    setCarColor((current) => current || savedValues.carColors[0] || "");
    setCarPlate((current) => current || savedValues.plateNumbers[0] || "");
    setPrefilledVehicle(true);
  }, [savedValues, prefilledVehicle]);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [fromLocation, setFromLocation] = useState<IsraelLocation | null>(
    null,
  );
  const [toLocation, setToLocation] = useState<IsraelLocation | null>(null);
  const [fromError, setFromError] = useState("");
  const [toError, setToError] = useState("");

  const handleFromChange = (text: string) => {
    setFrom(text);
    setFromLocation(null);
    if (fromError) setFromError("");
  };

  const handleToChange = (text: string) => {
    setTo(text);
    setToLocation(null);
    if (toError) setToError("");
  };

  const [deliveryDate, setDeliveryDate] = useState("");
  const [showDeliveryDatePicker, setShowDeliveryDatePicker] = useState(false);

  const [time, setTime] = useState("");
  const [showTimePicker, setShowTimePicker] = useState(false);

  const [recipientPhone, setRecipientPhone] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [price, setPrice] = useState("");

  const handleSubmit = async () => {
    const user = auth.currentUser;

    if (!user) {
      Alert.alert(t("auth.loginRequiredTitle"), t("auth.pleaseLoginFirst"));
      router.replace("/");
      return;
    }

    const eligibility = await fetchDriverEligibility(user.uid);

    if (!eligibility.eligible) {
      Alert.alert(
        t("driver.verificationRequired"),
        t("driver.mustVerifyLicense"),
      );
      return;
    }

    const accountInfo = validateAccountInfo(driverName, phone, driverAge);

    if (!accountInfo) return;

    if (languages.length === 0) {
      Alert.alert(
        t("driver.missingLanguageTitle"),
        t("driver.missingLanguageMessage"),
      );
      return;
    }

    if (
      !car ||
      !carColor ||
      !carPlate ||
      !from ||
      !to ||
      !deliveryDate ||
      !time ||
      !recipientPhone ||
      !itemDescription
    ) {
      Alert.alert(t("auth.missingDetails"), t("validation.fillAllFields"));
      return;
    }

    if (!isValidCarPlate(carPlate)) {
      Alert.alert(
        t("validation.invalidVehicleNumberTitle"),
        t("validation.invalidVehicleNumber"),
      );
      return;
    }

    if (!fromLocation) {
      setFromError(t("validation.selectLocationFromList"));
      return;
    }

    if (!toLocation) {
      setToError(t("validation.selectLocationFromList"));
      return;
    }

    const dateTimeValidation = validateDateAndTimeNotPassed(
      deliveryDate,
      time,
      {
        dateLabelKey: "driverCreate.deliveryDate",
        timeLabelKey: "driverCreate.arrivalTimeToArea",
      },
    );

    if (!dateTimeValidation) return;

    const cleanDeliveryDate = dateTimeValidation.cleanDate;
    const cleanTime = dateTimeValidation.cleanTime;
    const deliveryDay = dateTimeValidation.day;

    const cleanRecipientPhone = getDigitsOnly(recipientPhone);

    if (cleanRecipientPhone.length !== 10) {
      Alert.alert(
        t("validation.invalidPhoneTitle"),
        t("validation.recipientPhoneDigits"),
      );
      return;
    }

    const cleanPrice = price ? Number(price) : 0;

    if (price && (Number.isNaN(cleanPrice) || cleanPrice <= 0)) {
      Alert.alert(t("validation.invalidPriceTitle"), t("validation.invalidPrice"));
      return;
    }

    try {
      setLoading(true);

      await addDoc(collection(db, "driverRoutes"), {
        driverId: user.uid,

        driverName,
        phone: accountInfo.cleanPhone,
        driverAge: accountInfo.cleanDriverAge,

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
        // Stable ids for cross-language matching — see israelLocations.ts.
        fromLocationId: fromLocation.id,
        toLocationId: toLocation.id,
        fromLocationNames: {
          english: fromLocation.english,
          arabic: fromLocation.arabic,
          hebrew: fromLocation.hebrew,
        },
        toLocationNames: {
          english: toLocation.english,
          arabic: toLocation.arabic,
          hebrew: toLocation.hebrew,
        },

        tripDate: cleanDeliveryDate,
        deliveryDate: cleanDeliveryDate,
        day: deliveryDay,
        availableDays: [deliveryDay],

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

      recordUsedFormValues({ carModel: car, carColor, plateNumber: carPlate, price: String(cleanPrice) });

      Alert.alert(t("common.success"), t("driver.deliveryCreated"));
      router.replace("/(tabs)/home" as any);
    } catch (error: any) {
      console.log("CREATE PERSONAL DELIVERY ERROR:", error);
      Alert.alert(t("common.error"), error.message || t("driver.couldNotCreateDelivery"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={24} color="#7C5F46" />
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.title}>{t("driverCreate.deliverItemTitle")}</Text>
          <Text style={styles.subtitle}>{t("driverCreate.sendItemSubtitle")}</Text>


          <IsraelLocationAutocomplete
            label={t("booking.from")}
            value={from}
            onChangeText={handleFromChange}
            onSelectLocation={(location) => {
              setFromLocation(location);
              setFromError("");
            }}
            placeholder={t("booking.enterDepartureCity")}
            error={fromError}
          />

          <IsraelLocationAutocomplete
            label={t("booking.to")}
            value={to}
            onChangeText={handleToChange}
            onSelectLocation={(location) => {
              setToLocation(location);
              setToError("");
            }}
            placeholder={t("booking.enterDestinationCity")}
            error={toError}
          />

          <DateInput
            label={t("driverCreate.deliveryDate")}
            value={deliveryDate}
            onChange={setDeliveryDate}
            showPicker={showDeliveryDatePicker}
            setShowPicker={setShowDeliveryDatePicker}
          />

          <TimeInput
            label={t("driverCreate.arrivalTimeToArea")}
            value={time}
            onChange={setTime}
            showPicker={showTimePicker}
            setShowPicker={setShowTimePicker}
          />

          <Text style={styles.label}>{t("driverCreate.recipientPhoneLabel")}</Text>
          <View style={styles.inputRow}>
            <Ionicons name="call-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.rowInput}
              placeholder={t("driverCreate.enterRecipientPhone")}
              placeholderTextColor="#8B7B6B"
              keyboardType="numeric"
              maxLength={10}
              value={recipientPhone}
              onChangeText={(text) => setRecipientPhone(getDigitsOnly(text))}
            />
          </View>

          <Text style={styles.label}>{t("driverCreate.itemDescriptionLabel")}</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder={t("driverCreate.describeItemToDeliver")}
            placeholderTextColor="#8B7B6B"
            value={itemDescription}
            onChangeText={setItemDescription}
            multiline
          />

          <AutocompleteTextField
            label={t("booking.price")}
            value={price}
            onChangeText={(text) => setPrice(getDigitsOnly(text))}
            suggestions={savedValues.prices}
            placeholder={t("booking.enterPrice")}
            icon="cash-outline"
            keyboardType="numeric"
            formatSuggestion={(v) => `${v} ₪`}
          />

          <VehicleDetailsSection
            car={car}
            onChangeCar={setCar}
            carColor={carColor}
            onChangeCarColor={setCarColor}
            carPlate={carPlate}
            onChangeCarPlate={(value) => setCarPlate(getDigitsOnly(value).slice(0, 9))}
            savedValues={savedValues}
          />

          <Pressable
            style={[
              styles.submitButton,
              loading && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={loading}
          >
            <Text style={styles.submitText}>
              {loading ? t("driverCreate.creating") : t("driverCreate.createDelivery")}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StoreDeliverForm({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const { driverName, phone, driverAge, languages } = useDriverAccount();

  const [loading, setLoading] = useState(false);

  const [car, setCar] = useState("");
  const [carColor, setCarColor] = useState("");
  const [carPlate, setCarPlate] = useState("");
  const savedValues = useSavedFormValues();
  const [prefilledVehicle, setPrefilledVehicle] = useState(false);
  useEffect(() => {
    if (prefilledVehicle) return;
    if (!savedValues.carModels.length && !savedValues.carColors.length && !savedValues.plateNumbers.length) {
      return;
    }

    setCar((current) => current || savedValues.carModels[0] || "");
    setCarColor((current) => current || savedValues.carColors[0] || "");
    setCarPlate((current) => current || savedValues.plateNumbers[0] || "");
    setPrefilledVehicle(true);
  }, [savedValues, prefilledVehicle]);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [fromLocation, setFromLocation] = useState<IsraelLocation | null>(
    null,
  );
  const [toLocation, setToLocation] = useState<IsraelLocation | null>(null);
  const [fromError, setFromError] = useState("");
  const [toError, setToError] = useState("");

  const handleFromChange = (text: string) => {
    setFrom(text);
    setFromLocation(null);
    if (fromError) setFromError("");
  };

  const handleToChange = (text: string) => {
    setTo(text);
    setToLocation(null);
    if (toError) setToError("");
  };

  const [storeName, setStoreName] = useState("");

  const [deliveryDate, setDeliveryDate] = useState("");
  const [showDeliveryDatePicker, setShowDeliveryDatePicker] = useState(false);

  const [time, setTime] = useState("");
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [price, setPrice] = useState("");

  const handleSubmit = async () => {
    const user = auth.currentUser;

    if (!user) {
      Alert.alert(t("auth.loginRequiredTitle"), t("auth.pleaseLoginFirst"));
      router.replace("/");
      return;
    }

    const eligibility = await fetchDriverEligibility(user.uid);

    if (!eligibility.eligible) {
      Alert.alert(
        t("driver.verificationRequired"),
        t("driver.mustVerifyLicense"),
      );
      return;
    }

    const accountInfo = validateAccountInfo(driverName, phone, driverAge);

    if (!accountInfo) return;

    if (languages.length === 0) {
      Alert.alert(
        t("driver.missingLanguageTitle"),
        t("driver.missingLanguageMessage"),
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
      Alert.alert(t("auth.missingDetails"), t("validation.fillAllFields"));
      return;
    }

    if (!isValidCarPlate(carPlate)) {
      Alert.alert(
        t("validation.invalidVehicleNumberTitle"),
        t("validation.invalidVehicleNumber"),
      );
      return;
    }

    if (!fromLocation) {
      setFromError(t("validation.selectLocationFromList"));
      return;
    }

    if (!toLocation) {
      setToError(t("validation.selectLocationFromList"));
      return;
    }

    const dateTimeValidation = validateDateAndTimeNotPassed(
      deliveryDate,
      time,
      {
        dateLabelKey: "driverCreate.deliveryDate",
        timeLabelKey: "driverCreate.expectedArrivalTime",
      },
    );

    if (!dateTimeValidation) return;

    const cleanDeliveryDate = dateTimeValidation.cleanDate;
    const cleanTime = dateTimeValidation.cleanTime;
    const deliveryDay = dateTimeValidation.day;

    const cleanPrice = price ? Number(price) : 0;

    if (price && (Number.isNaN(cleanPrice) || cleanPrice <= 0)) {
      Alert.alert(t("validation.invalidPriceTitle"), t("validation.invalidPrice"));
      return;
    }

    try {
      setLoading(true);

      await addDoc(collection(db, "driverRoutes"), {
        driverId: user.uid,

        driverName,
        phone: accountInfo.cleanPhone,
        driverAge: accountInfo.cleanDriverAge,

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
        // Stable ids for cross-language matching — see israelLocations.ts.
        fromLocationId: fromLocation.id,
        toLocationId: toLocation.id,
        fromLocationNames: {
          english: fromLocation.english,
          arabic: fromLocation.arabic,
          hebrew: fromLocation.hebrew,
        },
        toLocationNames: {
          english: toLocation.english,
          arabic: toLocation.arabic,
          hebrew: toLocation.hebrew,
        },

        storeName,

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

      recordUsedFormValues({ carModel: car, carColor, plateNumber: carPlate, price: String(cleanPrice) });

      Alert.alert(t("common.success"), t("driver.deliveryCreated"));
      router.replace("/(tabs)/home" as any);
    } catch (error: any) {
      console.log("CREATE DELIVERY ERROR:", error);
      Alert.alert(t("common.error"), error.message || t("driver.couldNotCreateDelivery"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={24} color="#7C5F46" />
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.title}>{t("driverCreate.storeDeliveryTitle")}</Text>
          <Text style={styles.subtitle}>
            {t("driverCreate.storeDeliverySubtitle")}
          </Text>


          <IsraelLocationAutocomplete
            label={t("booking.from")}
            value={from}
            onChangeText={handleFromChange}
            onSelectLocation={(location) => {
              setFromLocation(location);
              setFromError("");
            }}
            placeholder={t("booking.enterDepartureCity")}
            error={fromError}
          />

          <IsraelLocationAutocomplete
            label={t("booking.to")}
            value={to}
            onChangeText={handleToChange}
            onSelectLocation={(location) => {
              setToLocation(location);
              setToError("");
            }}
            placeholder={t("booking.enterDestinationCity")}
            error={toError}
          />

          <Text style={styles.label}>{t("driverCreate.storeNameLabel")}</Text>
          <View style={styles.inputRow}>
            <Ionicons name="storefront-outline" size={18} color="#8B7B6B" />
            <TextInput
              style={styles.rowInput}
              placeholder={t("driverCreate.enterStoreName")}
              placeholderTextColor="#8B7B6B"
              value={storeName}
              onChangeText={setStoreName}
            />
          </View>

          <DateInput
            label={t("driverCreate.deliveryDate")}
            value={deliveryDate}
            onChange={setDeliveryDate}
            showPicker={showDeliveryDatePicker}
            setShowPicker={setShowDeliveryDatePicker}
          />

          <TimeInput
            label={t("driverCreate.expectedArrivalTime")}
            value={time}
            onChange={setTime}
            showPicker={showTimePicker}
            setShowPicker={setShowTimePicker}
          />

          <AutocompleteTextField
            label={t("booking.price")}
            value={price}
            onChangeText={(text) => setPrice(getDigitsOnly(text))}
            suggestions={savedValues.prices}
            placeholder={t("booking.enterPrice")}
            icon="cash-outline"
            keyboardType="numeric"
            formatSuggestion={(v) => `${v} ₪`}
          />

          <VehicleDetailsSection
            car={car}
            onChangeCar={setCar}
            carColor={carColor}
            onChangeCarColor={setCarColor}
            carPlate={carPlate}
            onChangeCarPlate={(value) => setCarPlate(getDigitsOnly(value).slice(0, 9))}
            savedValues={savedValues}
          />

          <Pressable
            style={[
              styles.submitButton,
              loading && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={loading}
          >
            <Text style={styles.submitText}>
              {loading ? t("driverCreate.creating") : t("driverCreate.createDelivery")}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
