import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import React, { useEffect, useRef, useState } from "react";
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
import KeyboardAvoidingWrapper from "../../components/KeyboardAvoidingWrapper";
import VehicleDetailsSection from "../../components/VehicleDetailsSection";
import { fetchDriverEligibility } from "../driverEligibility";
import { getDriverSuspensionBlockedReason } from "../../booking/driverViolationsLib";
import { translateCategoryLabel } from "../../i18n/formatters";
import { useLanguage } from "../../i18n/LanguageProvider";
import { backIconName } from "../../i18n/rtl";
import DateInput, { TimeInput } from "./DateInput";
import { recordUsedFormValues, useSavedFormValues } from "./savedFormValuesLib";

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

// Same "Work Helper" category everywhere else (My Bookings' catChip, the
// passenger side, ...) reads from — CATEGORY_META's "workErrands" entry is
// already green (#22C55E), so the badge matches automatically rather than
// hardcoding a color here.
const workCategoryMeta = getCategoryMeta("workErrands");

export default function WorkJobScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const { driverName, phone, driverAge, languages } = useDriverAccount();

  const [loading, setLoading] = useState(false);
  // Synchronous re-entrancy lock — the eligibility/suspension checks below
  // are awaited BEFORE setLoading(true) ever runs, so the submit button's
  // own disabled={loading} isn't enough to stop a fast double-tap from
  // starting handleSubmit twice and creating two identical workJobs docs.
  // A ref updates immediately (no render/batching delay), unlike state.
  const submittingRef = useRef(false);

  const [jobTitle, setJobTitle] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [jobLocation, setJobLocation] = useState("");
  const [jobLocationPlace, setJobLocationPlace] =
    useState<IsraelLocation | null>(null);
  const [jobLocationError, setJobLocationError] = useState("");

  const handleJobLocationChange = (text: string) => {
    setJobLocation(text);
    setJobLocationPlace(null);
    if (jobLocationError) setJobLocationError("");
  };

  const [jobDate, setJobDate] = useState("");
  const [showJobDatePicker, setShowJobDatePicker] = useState(false);

  const [startTime, setStartTime] = useState("");
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);

  const [endTime, setEndTime] = useState("");
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);

  const [hourlyPay, setHourlyPay] = useState("");
  const [workersNeeded, setWorkersNeeded] = useState("1");

  const [car, setCar] = useState("");
  const [carColor, setCarColor] = useState("");
  const [carPlate, setCarPlate] = useState("");
  const savedValues = useSavedFormValues();

  // Prefill from the driver's own most-recently-used vehicle, same as
  // RideForm.tsx/errand.tsx — only into fields still empty at that point.
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
    if (submittingRef.current) return;
    submittingRef.current = true;

    try {
      await submitWorkJob();
    } finally {
      submittingRef.current = false;
    }
  };

  const submitWorkJob = async () => {
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
      !jobTitle ||
      !jobDescription ||
      !jobLocation ||
      !jobDate ||
      !startTime ||
      !endTime ||
      !hourlyPay ||
      !workersNeeded ||
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

    if (!jobLocationPlace) {
      setJobLocationError(t("validation.selectLocationFromList"));
      return;
    }

    const dateTimeValidation = validateDateAndTimeNotPassed(
      jobDate,
      startTime,
      {
        dateLabelKey: "driverCreate.workDate",
        timeLabelKey: "driverCreate.startTime",
      },
    );

    if (!dateTimeValidation) return;

    const cleanJobDate = dateTimeValidation.cleanDate;
    const cleanStartTime = dateTimeValidation.cleanTime;
    const jobDay = dateTimeValidation.day;

    const cleanEndTime = normalizeTime(endTime);

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

    const cleanHourlyPay = Number(hourlyPay);
    const cleanWorkersNeeded = Number(workersNeeded);

    if (Number.isNaN(cleanHourlyPay) || cleanHourlyPay <= 0) {
      Alert.alert(t("validation.invalidPayTitle"), t("validation.invalidPay"));
      return;
    }

    if (
      Number.isNaN(cleanWorkersNeeded) ||
      cleanWorkersNeeded < 1 ||
      cleanWorkersNeeded > 20
    ) {
      Alert.alert(
        t("validation.invalidWorkersTitle"),
        t("validation.invalidWorkers"),
      );
      return;
    }

    try {
      setLoading(true);

      // Resolved ONCE here at creation time (never re-geocoded when Home
      // loads) — see resolveLocationCoordinates in locationSearch.ts.
      const locationCoords = await resolveLocationCoordinates(
        jobLocationPlace,
        jobLocation,
      );

      await addDoc(collection(db, "workJobs"), {
        employerId: user.uid,

        employerName: driverName,
        phone: accountInfo.cleanPhone,
        driverAge: accountInfo.cleanDriverAge,

        languages,

        car,
        carColor,
        carPlate,

        jobTitle,
        jobTitleNormalized: normalize(jobTitle),

        description: jobDescription,

        location: jobLocation,
        locationNormalized: normalize(jobLocation),
        // Stable id for cross-language matching — see israelLocations.ts.
        locationId: jobLocationPlace.id,
        locationNames: {
          english: jobLocationPlace.english,
          arabic: jobLocationPlace.arabic,
          hebrew: jobLocationPlace.hebrew,
        },
        locationLat: locationCoords?.latitude ?? null,
        locationLng: locationCoords?.longitude ?? null,

        date: cleanJobDate,
        day: jobDay,

        startTime: cleanStartTime,
        endTime: cleanEndTime,

        hourlyPay: cleanHourlyPay,

        // "workersNeeded" is kept for existing readers; seats/totalSeats are
        // aliases of the same number. remainingSeats is the only one that
        // ever changes after creation — see acceptRequest/cancelApplication
        // in workErrandLib.ts. A pending request never touches this; only
        // an accepted worker (or a later cancellation) does.
        workersNeeded: cleanWorkersNeeded,
        seats: cleanWorkersNeeded,
        totalSeats: cleanWorkersNeeded,
        remainingSeats: cleanWorkersNeeded,
        acceptedWorkersCount: 0,

        status: "available",
        available: true,
        isFull: false,

        rating: 4.8,
        reviews: 0,

        active: true,
        category: "workErrands",

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      recordUsedFormValues({ carModel: car, carColor, plateNumber: carPlate });

      Alert.alert(t("common.success"), t("driver.workJobCreated"));
      router.replace("/(tabs)/home" as any);
    } catch (error: any) {
      console.log("CREATE WORK JOB ERROR:", error);
      Alert.alert(t("common.error"), error.message || t("driver.couldNotCreateWorkJob"));
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
              { backgroundColor: `${workCategoryMeta.color}18` },
            ]}
          >
            <Ionicons name={workCategoryMeta.icon} size={18} color={workCategoryMeta.color} />
            <Text style={[localStyles.categoryBadgeText, { color: workCategoryMeta.color }]}>
              {translateCategoryLabel("workErrands", workCategoryMeta.label, t)}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>{t("driverCreate.newWorkJobTitle")}</Text>

          <Text style={styles.subtitle}>
            {t("driverCreate.newWorkJobSubtitle")}
          </Text>

          <Text style={styles.label}>{t("driverCreate.jobTitleLabel")}</Text>
          <TextInput
            style={styles.input}
            placeholder={t("driverCreate.enterJobTitle")}
            placeholderTextColor="#8B7B6B"
            value={jobTitle}
            onChangeText={setJobTitle}
          />

          <Text style={styles.label}>{t("driverCreate.jobDescriptionLabel")}</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder={t("driverCreate.describeWorkNeeded")}
            placeholderTextColor="#8B7B6B"
            value={jobDescription}
            onChangeText={setJobDescription}
            multiline
          />

          <IsraelLocationAutocomplete
            label={t("driverCreate.workLocationLabel")}
            value={jobLocation}
            onChangeText={handleJobLocationChange}
            onSelectLocation={(location) => {
              setJobLocationPlace(location);
              setJobLocationError("");
            }}
            placeholder={t("driverCreate.enterWorkLocation")}
            error={jobLocationError}
          />

          <DateInput
            label={t("driverCreate.workDate")}
            value={jobDate}
            onChange={setJobDate}
            showPicker={showJobDatePicker}
            setShowPicker={setShowJobDatePicker}
          />

          <View style={styles.twoColumns}>
            <View style={styles.column}>
              <TimeInput
                label={t("driverCreate.startTime")}
                value={startTime}
                onChange={setStartTime}
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
                value={endTime}
                onChange={setEndTime}
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
              <Text style={styles.label}>{t("driverCreate.hourlyPay")}</Text>

              <View style={styles.inputRow}>
                <Ionicons name="cash-outline" size={18} color="#8B7B6B" />
                <TextInput
                  style={styles.rowInput}
                  placeholder={t("driverCreate.enterHourlyPay")}
                  placeholderTextColor="#8B7B6B"
                  keyboardType="numeric"
                  value={hourlyPay}
                  onChangeText={(text) => setHourlyPay(getDigitsOnly(text))}
                />
              </View>
            </View>

            <View style={styles.column}>
              <Text style={styles.label}>{t("driverCreate.workersNeededLabel")}</Text>

              <View style={styles.inputRow}>
                <Ionicons name="people-outline" size={18} color="#8B7B6B" />
                <TextInput
                  style={styles.rowInput}
                  placeholder={t("driverCreate.enterWorkersNeeded")}
                  placeholderTextColor="#8B7B6B"
                  keyboardType="numeric"
                  maxLength={2}
                  value={workersNeeded}
                  onChangeText={(text) =>
                    setWorkersNeeded(getDigitsOnly(text).slice(0, 2))
                  }
                />
              </View>
            </View>
          </View>

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
              { backgroundColor: workCategoryMeta.color },
              loading && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={loading}
          >
            <Text style={styles.submitText}>
              {loading ? t("driverCreate.creating") : t("driverCreate.createWorkJob")}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
      </KeyboardAvoidingWrapper>
    </DirectionalScreen>
  );
}

// Same shape/values as RideForm.tsx's categoryStyles / errand.tsx's
// localStyles (topRow/categoryBadge/categoryBadgeText) — this screen only
// ever posts one category ("workErrands"), so the badge is fixed rather
// than driven by a prop, but it should still look identical to every other
// create-trip screen's badge.
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
