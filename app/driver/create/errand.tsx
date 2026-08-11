import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { auth, db } from "../../../firebase";
import { getCategoryMeta } from "../../booking/bookingsLib";
import { DirectionalScreen } from "../../i18n/DirectionalPrimitives";
import IsraelLocationAutocomplete from "../../booking/IsraelLocationAutocomplete";
import { IsraelLocation } from "../../booking/israelLocations";
import { resolveLocationCoordinates } from "../../booking/locationSearch";
import AutocompleteTextField from "../../components/AutocompleteTextField";
import KeyboardAvoidingWrapper from "../../components/KeyboardAvoidingWrapper";
import VehicleDetailsSection from "../../components/VehicleDetailsSection";
import { fetchDriverEligibility, getDriverEligibilityAlertCopy } from "../driverEligibility";
import { getDriverSuspensionBlockedReason } from "../../booking/driverViolationsLib";
import { translateCategoryLabel } from "../../i18n/formatters";
import { useLanguage } from "../../i18n/LanguageProvider";
import { backIconName } from "../../i18n/rtl";
import DateInput, { TimeInput } from "./DateInput";
import { recordUsedFormValues, useSavedFormValues } from "./savedFormValuesLib";
import YesNoField from "./YesNoField";
import {
  getDigitsOnly,
  isValidCarPlate,
  normalize,
  normalizeTime,
  styles,
  timeToMinutes,
  useDriverAccount,
  validateAccountInfo,
  validateDateAndTimeNotPassed,
} from "./driverHelpers";

const errandCategoryMeta = getCategoryMeta("errands");

export default function ErrandJobScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const { driverName, phone, driverAge, languages } = useDriverAccount();

  const [loading, setLoading] = useState(false);

  const [canTakeKids, setCanTakeKids] = useState(false);
  const [allowsPets, setAllowsPets] = useState(false);
  const [errandTitle, setErrandTitle] = useState("");
  const [errandDescription, setErrandDescription] = useState("");
  const [errandLocation, setErrandLocation] = useState("");
  const [errandLocationPlace, setErrandLocationPlace] =
    useState<IsraelLocation | null>(null);
  const [errandLocationError, setErrandLocationError] = useState("");

  const handleErrandLocationChange = (text: string) => {
    setErrandLocation(text);
    setErrandLocationPlace(null);
    if (errandLocationError) setErrandLocationError("");
  };
  const [errandDate, setErrandDate] = useState("");
  const [showErrandDatePicker, setShowErrandDatePicker] = useState(false);
  const [errandStartTime, setErrandStartTime] = useState("");
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);
  const [errandEndTime, setErrandEndTime] = useState("");
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);
  const [errandPrice, setErrandPrice] = useState("");
  const savedValues = useSavedFormValues();
  const [errandSeats, setErrandSeats] = useState("1");

  const [car, setCar] = useState("");
  const [carColor, setCarColor] = useState("");
  const [carPlate, setCarPlate] = useState("");

  // Prefill from the driver's own most-recently-used vehicle, same as
  // RideForm.tsx/work.tsx — only into fields still empty at that point.
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

  const handleSubmit = async () => {
    const user = auth.currentUser;

    if (!user) {
      Alert.alert(t("auth.loginRequiredTitle"), t("auth.pleaseLoginFirst"));
      router.replace("/");
      return;
    }

    const eligibility = await fetchDriverEligibility(user.uid);

    if (!eligibility.eligible) {
      const copy = getDriverEligibilityAlertCopy(eligibility.status, t);
      Alert.alert(copy.title, copy.message);
      return;
    }

    const suspensionBlocked = await getDriverSuspensionBlockedReason(user.uid);
    if (suspensionBlocked) {
      Alert.alert(t("driver.accountSuspendedTitle"), suspensionBlocked);
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
      !errandTitle ||
      !errandDescription ||
      !errandLocation ||
      !errandDate ||
      !errandStartTime ||
      !errandEndTime ||
      !errandPrice ||
      !errandSeats ||
      !car ||
      !carColor ||
      !carPlate
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

    if (!errandLocationPlace) {
      setErrandLocationError(t("validation.selectLocationFromList"));
      return;
    }

    const dateTimeValidation = validateDateAndTimeNotPassed(
      errandDate,
      errandStartTime,
      {
        dateLabelKey: "driverCreate.errandDate",
        timeLabelKey: "driverCreate.startTime",
      },
    );

    if (!dateTimeValidation) return;

    const cleanErrandDate = dateTimeValidation.cleanDate;
    const cleanStartTime = dateTimeValidation.cleanTime;
    const errandDay = dateTimeValidation.day;

    const cleanEndTime = normalizeTime(errandEndTime);

    if (!cleanEndTime) {
      Alert.alert(t("validation.invalidTimeTitle"), t("validation.invalidTime"));
      return;
    }

    const startMinutes = timeToMinutes(cleanStartTime);
    const endMinutes = timeToMinutes(cleanEndTime);

    if (
      startMinutes === null ||
      endMinutes === null ||
      endMinutes <= startMinutes
    ) {
      Alert.alert(t("validation.invalidTimeTitle"), t("validation.endTimeAfterStart"));
      return;
    }

    const cleanPrice = Number(errandPrice);
    const cleanSeats = Number(errandSeats);

    if (Number.isNaN(cleanPrice) || cleanPrice <= 0) {
      Alert.alert(t("validation.invalidPriceTitle"), t("validation.invalidPrice"));
      return;
    }

    if (Number.isNaN(cleanSeats) || cleanSeats < 1 || cleanSeats > 8) {
      Alert.alert(t("validation.invalidSeatsTitle"), t("validation.invalidSeats"));
      return;
    }

    try {
      setLoading(true);

      // Resolved ONCE here at creation time (never re-geocoded when Home
      // loads) — see resolveLocationCoordinates in locationSearch.ts.
      const locationCoords = await resolveLocationCoordinates(
        errandLocationPlace,
        errandLocation,
      );

      await addDoc(collection(db, "errandJobs"), {
        ownerId: user.uid,

        ownerName: driverName,
        phone: accountInfo.cleanPhone,
        driverAge: accountInfo.cleanDriverAge,

        languages,

        car,
        carColor,
        carPlate,

        canTakeKids,
        allowsPets,

        errandTitle,
        errandTitleNormalized: normalize(errandTitle),
        description: errandDescription,

        location: errandLocation,
        locationNormalized: normalize(errandLocation),
        // Stable id for cross-language matching — see israelLocations.ts.
        locationId: errandLocationPlace.id,
        locationNames: {
          english: errandLocationPlace.english,
          arabic: errandLocationPlace.arabic,
          hebrew: errandLocationPlace.hebrew,
        },
        locationLat: locationCoords?.latitude ?? null,
        locationLng: locationCoords?.longitude ?? null,

        date: cleanErrandDate,
        day: errandDay,
        startTime: cleanStartTime,
        endTime: cleanEndTime,

        price: cleanPrice,
        seats: cleanSeats,

        rating: 4.8,
        reviews: 0,
        active: true,
        category: "errands",

        createdAt: serverTimestamp(),
      });

      recordUsedFormValues({ carModel: car, carColor, plateNumber: carPlate, price: String(cleanPrice) });

      Alert.alert(t("common.success"), t("driver.errandCreated"));
      router.replace("/(tabs)/home" as any);
    } catch (error: any) {
      console.log("CREATE ERRAND ERROR:", error);
      Alert.alert(t("common.error"), error.message || t("driver.couldNotCreateErrand"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <DirectionalScreen style={styles.page}>
      <KeyboardAvoidingWrapper>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={localStyles.topRow}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name={backIconName(isRTL)} size={24} color="#7C5F46" />
          </Pressable>

          <View
            style={[
              localStyles.categoryBadge,
              { backgroundColor: `${errandCategoryMeta.color}18` },
            ]}
          >
            <Ionicons name={errandCategoryMeta.icon} size={18} color={errandCategoryMeta.color} />
            <Text style={[localStyles.categoryBadgeText, { color: errandCategoryMeta.color }]}>
              {translateCategoryLabel("errands", errandCategoryMeta.label, t)}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>{t("driverCreate.newErrandTitle")}</Text>
          <Text style={styles.subtitle}>
            {t("driverCreate.newErrandSubtitle")}
          </Text>

          <Text style={styles.label}>{t("driverCreate.errandTitleLabel")}</Text>
          <TextInput
            style={styles.input}
            placeholder={t("driverCreate.enterErrandTitle")}
            placeholderTextColor="#8B7B6B"
            value={errandTitle}
            onChangeText={setErrandTitle}
          />

          <Text style={styles.label}>{t("driverCreate.errandDescriptionLabel")}</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder={t("driverCreate.describeErrand")}
            placeholderTextColor="#8B7B6B"
            value={errandDescription}
            onChangeText={setErrandDescription}
            multiline
          />

          <IsraelLocationAutocomplete
            label={t("driverCreate.errandLocationLabel")}
            value={errandLocation}
            onChangeText={handleErrandLocationChange}
            onSelectLocation={(location) => {
              setErrandLocationPlace(location);
              setErrandLocationError("");
            }}
            placeholder={t("driverCreate.enterErrandLocation")}
            error={errandLocationError}
          />

          <DateInput
            label={t("driverCreate.errandDate")}
            value={errandDate}
            onChange={setErrandDate}
            showPicker={showErrandDatePicker}
            setShowPicker={setShowErrandDatePicker}
          />

          <View style={styles.twoColumns}>
            <View style={styles.column}>
              <TimeInput
                label={t("driverCreate.startTime")}
                value={errandStartTime}
                onChange={setErrandStartTime}
                showPicker={showStartTimePicker}
                setShowPicker={(value) => {
                  setShowStartTimePicker(value);

                  if (value) {
                    setShowEndTimePicker(false);
                  }
                }}
              />
            </View>

            <View style={styles.column}>
              <TimeInput
                label={t("driverCreate.endTime")}
                value={errandEndTime}
                onChange={setErrandEndTime}
                showPicker={showEndTimePicker}
                setShowPicker={(value) => {
                  setShowEndTimePicker(value);

                  if (value) {
                    setShowStartTimePicker(false);
                  }
                }}
              />
            </View>
          </View>

          <View style={styles.twoColumns}>
            <View style={styles.column}>
              <AutocompleteTextField
                label={t("booking.price")}
                value={errandPrice}
                onChangeText={(text) => setErrandPrice(getDigitsOnly(text))}
                suggestions={savedValues.prices}
                placeholder={t("booking.enterPrice")}
                icon="cash-outline"
                keyboardType="numeric"
                formatSuggestion={(v) => `${v} ₪`}
                ltr
              />
            </View>

            <View style={styles.column}>
              <Text style={styles.label}>{t("driverCreate.availableSeats")}</Text>
              <View style={styles.inputRow}>
                <Ionicons name="people-outline" size={18} color="#8B7B6B" />
                <TextInput
                  style={styles.rowInput}
                  placeholder={t("driverCreate.enterAvailableSeats")}
                  placeholderTextColor="#8B7B6B"
                  keyboardType="numeric"
                  maxLength={1}
                  value={errandSeats}
                  onChangeText={(text) =>
                    setErrandSeats(getDigitsOnly(text).slice(0, 1))
                  }
                />
              </View>
            </View>
          </View>

          <YesNoField
            label={t("driverCreate.canTakeKids")}
            value={canTakeKids}
            onValueChange={setCanTakeKids}
          />

          <YesNoField
            label={t("driverCreate.allowsPets")}
            value={allowsPets}
            onValueChange={setAllowsPets}
          />

          <View style={{ height: 20 }} />

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
              // Was previously relying on styles.submitButton's own
              // hardcoded default (#F58220), which only coincidentally
              // matched errands' actual category color — now explicit, so
              // it can never silently drift from CATEGORY_META again.
              { backgroundColor: errandCategoryMeta.color },
              loading && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={loading}
          >
            <Text style={styles.submitText}>
              {loading ? t("driverCreate.creating") : t("driverCreate.createErrand")}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
      </KeyboardAvoidingWrapper>
    </DirectionalScreen>
  );
}

// Same shape/values as RideForm.tsx's categoryStyles (topRow/categoryBadge/
// categoryBadgeText) — this screen only ever posts one category ("errands"),
// so the badge is fixed rather than driven by a prop, but it should still
// look identical to every other create-trip screen's badge.
const localStyles = StyleSheet.create({
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  categoryBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  categoryBadgeText: {
    fontWeight: "900",
    fontSize: 15,
  },
});
