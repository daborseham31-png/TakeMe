// ---------------------------------------------------------------------------
// School Trip creation — three driver-selectable modes (AGENTS.md #1):
// outbound only, return only, or both together on the same screen. Return
// legs are always saved as fully independent schoolTrips documents —
// linkedTripId (set only in the "outbound and return" case) is purely
// informational and never required (see AGENTS.md #2 and
// createSchoolReturnOnlyTrip's own comment in schoolTripsLib.ts). Publishing
// writes to the schoolTrips collection, independent from the legacy
// driverRoutes-based school flow still reachable via the "Weekly recurring"
// tab on this same route (see app/driver/create/school.tsx) — nothing about
// the existing weekly school flow is changed by this file.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { auth } from "../../../firebase";
import IsraelLocationAutocomplete from "../../booking/IsraelLocationAutocomplete";
import { IsraelLocation } from "../../booking/israelLocations";
import { resolveLocationCoordinates } from "../../booking/locationSearch";
import SchoolAutocomplete from "../../booking/SchoolAutocomplete";
import { getLocalizedSchoolName, SchoolLocation } from "../../booking/schools";
import {
  CreateSchoolTripInput,
  createSchoolOutboundTrip,
  createSchoolReturnOnlyTrip,
  createSchoolRoundTrip,
  DriverSchoolTripMode,
} from "../../booking/schoolTripsLib";
import VehicleDetailsSection from "../../components/VehicleDetailsSection";
import { useLanguage } from "../../i18n/LanguageProvider";
import { fetchDriverEligibility } from "../driverEligibility";
import DateInput, { TimeInput } from "./DateInput";
import {
  getDigitsOnly,
  isValidCarPlate,
  styles,
  useDriverAccount,
  validateAccountInfo,
  validateDateAndTimeNotPassed,
} from "./driverHelpers";
import { recordUsedFormValues, useSavedFormValues } from "./savedFormValuesLib";

const MODE_TABS: { key: DriverSchoolTripMode; labelKey: string }[] = [
  { key: "outbound_only", labelKey: "schoolTrip.outboundOnly" },
  { key: "return_only", labelKey: "schoolTrip.returnOnly" },
  { key: "outbound_and_return", labelKey: "schoolTrip.outboundAndReturn" },
];

export default function SchoolTripForm() {
  const { t } = useTranslation();
  const { isRTL, language } = useLanguage();
  const { driverName, phone, driverAge } = useDriverAccount();

  const [mode, setMode] = useState<DriverSchoolTripMode>("outbound_only");
  const [loading, setLoading] = useState(false);

  // Main section — represents the OUTBOUND trip for "outbound_only" and
  // "outbound_and_return", or the RETURN trip itself for "return_only".
  // School, From, and To are three fully independent fields in every mode
  // (AGENTS.md's correction): the school is never used as, and never
  // auto-fills, the From/To area.
  const [schoolQuery, setSchoolQuery] = useState("");
  const [selectedSchool, setSelectedSchool] = useState<SchoolLocation | null>(null);
  const [schoolError, setSchoolError] = useState("");

  const [fromAddress, setFromAddress] = useState("");
  const [fromPlace, setFromPlace] = useState<IsraelLocation | null>(null);
  const [fromError, setFromError] = useState("");

  const [toAddress, setToAddress] = useState("");
  const [toPlace, setToPlace] = useState<IsraelLocation | null>(null);
  const [toError, setToError] = useState("");

  const [tripDate, setTripDate] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [departureTime, setDepartureTime] = useState("");
  const [showTimePicker, setShowTimePicker] = useState(false);

  const [price, setPrice] = useState("");
  const [seats, setSeats] = useState("1");

  // Vehicle — one car for the whole trip (both legs share it when
  // outbound_and_return), so this lives once in the main section rather
  // than being duplicated per leg. Same field names as the legacy
  // driverRoutes-based weekly flow (see RideForm.tsx) — never a second
  // vehicle schema. Prefilled from the driver's own most-recently-used
  // values (see savedFormValuesLib.ts) the first time this form mounts.
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

  // Return section — only rendered for "outbound_and_return", auto-filled
  // from the main (outbound) section per AGENTS.md #1.
  const [returnToAddress, setReturnToAddress] = useState("");
  const [returnToPlace, setReturnToPlace] = useState<IsraelLocation | null>(null);
  const [returnToError, setReturnToError] = useState("");

  const [returnTime, setReturnTime] = useState("");
  const [showReturnTimePicker, setShowReturnTimePicker] = useState(false);

  const [returnPrice, setReturnPrice] = useState("");
  const [returnSeats, setReturnSeats] = useState("");

  const isReturnOnly = mode === "return_only";
  const showReturnSection = mode === "outbound_and_return";

  // School suggestions are scoped to whichever area represents the school's
  // own location — the To area for an outbound-facing main section, the
  // From area when the main section IS the return trip (return_only).
  const schoolAreaLocationId = isReturnOnly ? fromPlace?.id ?? null : toPlace?.id ?? null;

  const handleModeChange = (nextMode: DriverSchoolTripMode) => {
    setMode(nextMode);
    // Each mode's From/To/School have a different meaning (return_only's
    // From is the school's area, everything else's To is) — switching
    // modes clears them so a value picked for one meaning is never
    // silently reused with a different meaning.
    setFromAddress("");
    setFromPlace(null);
    setFromError("");
    setToAddress("");
    setToPlace(null);
    setToError("");
    setSchoolQuery("");
    setSelectedSchool(null);
    setSchoolError("");
    setReturnToAddress("");
    setReturnToPlace(null);
    setReturnToError("");
    setReturnTime("");
    setReturnPrice("");
    setReturnSeats("");
  };

  const handleFromChange = (text: string) => {
    setFromAddress(text);
    setFromPlace(null);
    if (fromError) setFromError("");

    if (isReturnOnly) {
      setSchoolQuery("");
      setSelectedSchool(null);
    }
  };

  const handleToChange = (text: string) => {
    setToAddress(text);
    setToPlace(null);
    if (toError) setToError("");

    if (!isReturnOnly) {
      setSchoolQuery("");
      setSelectedSchool(null);
    }
  };

  const handleSchoolChange = (text: string) => {
    setSchoolQuery(text);
    setSelectedSchool(null);
    if (schoolError) setSchoolError("");
  };

  const handleSelectSchool = (school: SchoolLocation) => {
    setSelectedSchool(school);
    setSchoolError("");
  };

  const handleReturnToChange = (text: string) => {
    setReturnToAddress(text);
    setReturnToPlace(null);
    if (returnToError) setReturnToError("");
  };

  const prefillReturnSection = () => {
    // Defaults copied from the outbound trip, per AGENTS.md #1 — editable
    // afterwards, but never re-copied on every keystroke. The return
    // destination is prefilled with the outbound's own starting area (the
    // common "back home" case) but stays a fully editable field.
    if (!returnPrice) setReturnPrice(price);
    if (!returnSeats) setReturnSeats(seats);
    if (!returnToAddress && fromPlace) {
      setReturnToAddress(fromAddress);
      setReturnToPlace(fromPlace);
    }
  };

  const handleSubmit = async () => {
    const user = auth.currentUser;

    if (!user) {
      Alert.alert(t("auth.loginRequiredTitle"), t("auth.pleaseLoginFirst"));
      router.replace("/");
      return;
    }

    const eligibility = await fetchDriverEligibility(user.uid);

    if (!eligibility.eligible) {
      Alert.alert(t("driver.verificationRequired"), t("driver.mustVerifyLicense"));
      return;
    }

    const accountInfo = validateAccountInfo(driverName, phone, driverAge);
    if (!accountInfo) return;

    if (
      !fromAddress ||
      !toAddress ||
      !schoolQuery ||
      !tripDate ||
      !departureTime ||
      !price ||
      !seats ||
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

    if (!fromPlace) {
      setFromError(t("validation.selectLocationFromList"));
      return;
    }

    if (!toPlace) {
      setToError(t("validation.selectLocationFromList"));
      return;
    }

    if (!selectedSchool) {
      setSchoolError(t("schoolTrip.selectSchoolFromList"));
      return;
    }

    const mainValidation = validateDateAndTimeNotPassed(tripDate, departureTime, {
      dateLabelKey: "driverCreate.travelDate",
      timeLabelKey: isReturnOnly ? "schoolTrip.returnDepartureTime" : "driverCreate.departureTime",
    });
    if (!mainValidation) return;

    const cleanSeats = Number(seats);
    if (Number.isNaN(cleanSeats) || cleanSeats < 1 || cleanSeats > 8) {
      Alert.alert(t("validation.invalidSeatsTitle"), t("validation.invalidSeats"));
      return;
    }

    const cleanPrice = Number(price);
    if (Number.isNaN(cleanPrice) || cleanPrice <= 0) {
      Alert.alert(t("validation.invalidPriceTitle"), t("validation.invalidPrice"));
      return;
    }

    let cleanReturnSeats = 0;
    let cleanReturnPrice = 0;
    let returnValidation: { cleanTime: string } | null = null;

    if (showReturnSection) {
      if (!returnToAddress || !returnTime || !returnPrice || !returnSeats) {
        Alert.alert(t("auth.missingDetails"), t("validation.fillAllFields"));
        return;
      }

      if (!returnToPlace) {
        setReturnToError(t("validation.selectLocationFromList"));
        return;
      }

      const validated = validateDateAndTimeNotPassed(tripDate, returnTime, {
        dateLabelKey: "driverCreate.travelDate",
        timeLabelKey: "schoolTrip.returnDepartureTime",
      });
      if (!validated) return;
      returnValidation = validated;

      cleanReturnSeats = Number(returnSeats);
      if (Number.isNaN(cleanReturnSeats) || cleanReturnSeats < 1 || cleanReturnSeats > 8) {
        Alert.alert(t("validation.invalidSeatsTitle"), t("validation.invalidSeats"));
        return;
      }

      cleanReturnPrice = Number(returnPrice);
      if (Number.isNaN(cleanReturnPrice) || cleanReturnPrice <= 0) {
        Alert.alert(t("validation.invalidPriceTitle"), t("validation.invalidPrice"));
        return;
      }
    }

    try {
      setLoading(true);

      const fromCoords = await resolveLocationCoordinates(fromPlace, fromAddress);
      const toCoords = await resolveLocationCoordinates(toPlace, toAddress);
      const schoolLocation = {
        latitude: selectedSchool.latitude,
        longitude: selectedSchool.longitude,
      };

      const driver = {
        driverId: user.uid,
        driverName,
        driverPhone: accountInfo.cleanPhone,
      };

      const mainInput: CreateSchoolTripInput = {
        fromArea: fromAddress,
        fromAddress,
        fromLocation: fromCoords,
        toArea: toAddress,
        toAddress,
        toLocation: toCoords,
        schoolId: selectedSchool.id,
        schoolName: selectedSchool.name,
        schoolAddress: selectedSchool.city,
        schoolLocation,
        date: mainValidation.cleanDate,
        departureTime: mainValidation.cleanTime,
        pricePerSeat: cleanPrice,
        totalSeats: cleanSeats,
        car,
        carColor,
        carPlate,
      };

      if (isReturnOnly) {
        // "Return only" (AGENTS.md #1): the main section IS the return trip
        // — From is the school area, To is the destination — saved directly
        // as an independent from_school document, no outbound required.
        await createSchoolReturnOnlyTrip(mainInput, driver);
      } else if (showReturnSection && returnValidation) {
        const returnToCoords = await resolveLocationCoordinates(
          returnToPlace,
          returnToAddress,
        );

        const returnInput: CreateSchoolTripInput = {
          // Auto-filled, read-only: the return trip starts from the
          // outbound trip's "To" area (e.g. "Mashhad") — never the school's
          // own name or address. The school itself stays attached below,
          // fully independent of this area label. The real pickup
          // coordinate is still the school building, since that's
          // physically where the return trip departs from.
          fromArea: toAddress,
          fromAddress: toAddress,
          fromLocation: schoolLocation,
          toArea: returnToAddress,
          toAddress: returnToAddress,
          toLocation: returnToCoords,
          schoolId: selectedSchool.id,
          schoolName: selectedSchool.name,
          schoolAddress: selectedSchool.city,
          schoolLocation,
          date: mainValidation.cleanDate,
          departureTime: returnValidation.cleanTime,
          pricePerSeat: cleanReturnPrice,
          totalSeats: cleanReturnSeats,
          car,
          carColor,
          carPlate,
        };

        await createSchoolRoundTrip(mainInput, returnInput, driver);
      } else {
        await createSchoolOutboundTrip(mainInput, driver);
      }

      // Best-effort — only after the trip actually saved, never for a
      // cancelled/failed submission (see savedFormValuesLib.ts).
      recordUsedFormValues({ carModel: car, carColor, plateNumber: carPlate, price: String(cleanPrice) });

      Alert.alert(t("common.success"), t("driver.tripCreated"));
      router.replace("/(tabs)/home" as any);
    } catch (error: any) {
      console.log("CREATE SCHOOL TRIP ERROR:", error);
      Alert.alert(t("common.error"), error.message || t("driver.couldNotCreateTrip"));
    } finally {
      setLoading(false);
    }
  };

  const publishLabel = isReturnOnly
    ? t("schoolTrip.publishReturnTrip")
    : showReturnSection
      ? t("schoolTrip.publishBothTrips")
      : t("schoolTrip.publishOutboundTrip");

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 8 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.label, isRTL && { textAlign: "right" }, { marginTop: 0 }]}>
        {t("schoolTrip.selectTripMode")}
      </Text>
      <View style={localStyles.tabRow}>
        {MODE_TABS.map((tab) => (
          <Pressable
            key={tab.key}
            style={[localStyles.tab, mode === tab.key && localStyles.tabActive]}
            onPress={() => handleModeChange(tab.key)}
          >
            <Text style={[localStyles.tabText, mode === tab.key && localStyles.tabTextActive]}>
              {t(tab.labelKey)}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.card}>
        <View style={localStyles.sectionHeader}>
          <Ionicons
            name={isReturnOnly ? "arrow-down-circle-outline" : "arrow-up-circle-outline"}
            size={20}
            color={isReturnOnly ? "#3B82F6" : "#F58220"}
          />
          <Text style={localStyles.sectionTitle}>
            {isReturnOnly ? t("schoolTrip.returnTrip") : t("schoolTrip.outboundTrip")}
          </Text>
        </View>

        <IsraelLocationAutocomplete
          label={t("booking.from")}
          value={fromAddress}
          onChangeText={handleFromChange}
          onSelectLocation={(location) => {
            setFromPlace(location);
            setFromError("");
          }}
          placeholder={t("booking.enterDepartureCity")}
          error={fromError}
        />

        <IsraelLocationAutocomplete
          label={t("booking.to")}
          value={toAddress}
          onChangeText={handleToChange}
          onSelectLocation={(location) => {
            setToPlace(location);
            setToError("");
            if (mode === "outbound_and_return") prefillReturnSection();
          }}
          placeholder={t("booking.enterDestinationCity")}
          error={toError}
        />

        <SchoolAutocomplete
          label={t("schoolTrip.schoolLabel")}
          value={schoolQuery}
          onChangeText={handleSchoolChange}
          onSelectSchool={handleSelectSchool}
          areaLocationId={schoolAreaLocationId}
          error={schoolError}
        />

        <DateInput
          label={t("driverCreate.travelDate")}
          value={tripDate}
          onChange={setTripDate}
          showPicker={showDatePicker}
          setShowPicker={setShowDatePicker}
        />

        <TimeInput
          label={isReturnOnly ? t("schoolTrip.returnDepartureTime") : t("driverCreate.departureTime")}
          value={departureTime}
          onChange={setDepartureTime}
          showPicker={showTimePicker}
          setShowPicker={setShowTimePicker}
          associatedDate={tripDate}
        />

        <View style={styles.twoColumns}>
          <View style={styles.column}>
            <Text style={styles.label}>{t("booking.price")}</Text>
            <TextInput
              style={styles.input}
              placeholder={t("booking.enterPrice")}
              placeholderTextColor="#8B7B6B"
              keyboardType="numeric"
              value={price}
              onChangeText={(text) => setPrice(getDigitsOnly(text))}
            />
          </View>

          <View style={styles.column}>
            <Text style={styles.label}>{t("driverCreate.availableSeats")}</Text>
            <TextInput
              style={styles.input}
              placeholder={t("driverCreate.enterAvailableSeats")}
              placeholderTextColor="#8B7B6B"
              keyboardType="numeric"
              maxLength={1}
              value={seats}
              onChangeText={(text) => setSeats(getDigitsOnly(text).slice(0, 1))}
            />
          </View>
        </View>
      </View>

      {showReturnSection ? (
        <View style={styles.card}>
          <View style={localStyles.sectionHeader}>
            <Ionicons name="arrow-down-circle-outline" size={20} color="#3B82F6" />
            <Text style={localStyles.sectionTitle}>{t("schoolTrip.returnTrip")}</Text>
          </View>

          <Text style={styles.label}>{t("booking.from")}</Text>
          <View style={[styles.inputRow, localStyles.readOnlyRow]}>
            <Ionicons name="location-outline" size={18} color="#8B7B6B" />
            <Text style={localStyles.readOnlyText}>
              {toAddress || t("schoolTrip.selectAreaFirst")}
            </Text>
            <View style={localStyles.autoPill}>
              <Text style={localStyles.autoPillText}>{t("schoolTrip.automatic")}</Text>
            </View>
          </View>

          <IsraelLocationAutocomplete
            label={t("schoolTrip.returnDestination")}
            value={returnToAddress}
            onChangeText={handleReturnToChange}
            onSelectLocation={(location) => {
              setReturnToPlace(location);
              setReturnToError("");
            }}
            placeholder={t("booking.enterDestinationCity")}
            error={returnToError}
          />

          <Text style={styles.label}>{t("schoolTrip.schoolLabel")}</Text>
          <View style={[styles.inputRow, localStyles.readOnlyRow]}>
            <Ionicons name="school-outline" size={18} color="#8B7B6B" />
            <Text style={localStyles.readOnlyText}>
              {selectedSchool ? getLocalizedSchoolName(selectedSchool, language) : ""}
            </Text>
            <View style={localStyles.autoPill}>
              <Text style={localStyles.autoPillText}>{t("schoolTrip.automatic")}</Text>
            </View>
          </View>

          <TimeInput
            label={t("schoolTrip.returnDepartureTime")}
            value={returnTime}
            onChange={setReturnTime}
            showPicker={showReturnTimePicker}
            setShowPicker={setShowReturnTimePicker}
            associatedDate={tripDate}
          />

          <View style={styles.twoColumns}>
            <View style={styles.column}>
              <Text style={styles.label}>{t("booking.price")}</Text>
              <TextInput
                style={styles.input}
                placeholder={t("booking.enterPrice")}
                placeholderTextColor="#8B7B6B"
                keyboardType="numeric"
                value={returnPrice}
                onChangeText={(text) => setReturnPrice(getDigitsOnly(text))}
              />
            </View>

            <View style={styles.column}>
              <Text style={styles.label}>{t("driverCreate.availableSeats")}</Text>
              <TextInput
                style={styles.input}
                placeholder={t("driverCreate.enterAvailableSeats")}
                placeholderTextColor="#8B7B6B"
                keyboardType="numeric"
                maxLength={1}
                value={returnSeats}
                onChangeText={(text) => setReturnSeats(getDigitsOnly(text).slice(0, 1))}
              />
            </View>
          </View>
        </View>
      ) : null}

      <View style={{ height: 20 }} />

      <VehicleDetailsSection
        car={car}
        onChangeCar={setCar}
        carColor={carColor}
        onChangeCarColor={setCarColor}
        carPlate={carPlate}
        onChangeCarPlate={(text) => setCarPlate(getDigitsOnly(text).slice(0, 9))}
        savedValues={savedValues}
      />

      <Pressable
        style={[
          styles.submitButton,
          localStyles.publishButton,
          loading && styles.submitButtonDisabled,
        ]}
        onPress={handleSubmit}
        disabled={loading}
      >
        <Text style={styles.submitText}>
          {loading ? t("driverCreate.creating") : publishLabel}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const localStyles = {
  tabRow: {
    flexDirection: "row" as const,
    backgroundColor: "#F3ECE3",
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: "center" as const,
  },
  tabActive: {
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 1,
  },
  tabText: {
    fontWeight: "800" as const,
    color: "#7C5F46",
    fontSize: 12,
    textAlign: "center" as const,
  },
  tabTextActive: {
    color: "#3B82F6",
  },
  publishButton: {
    backgroundColor: "#3B82F6",
  },
  sectionHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "900" as const,
    color: "#111827",
  },
  readOnlyRow: {
    backgroundColor: "#F3ECE3",
    marginBottom: 18,
    justifyContent: "space-between" as const,
  },
  readOnlyText: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 8,
    color: "#5B4A3A",
    fontWeight: "700" as const,
  },
  autoPill: {
    backgroundColor: "#E2D8CF",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  autoPillText: {
    fontSize: 10.5,
    fontWeight: "900" as const,
    color: "#5B4A3A",
  },
};
