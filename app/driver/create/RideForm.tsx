import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { auth, db } from "../../../firebase";
import { DirectionalScreen } from "../../i18n/DirectionalPrimitives";
import { getCategoryMeta } from "../../booking/bookingsLib";
import IsraelLocationAutocomplete from "../../booking/IsraelLocationAutocomplete";
import { IsraelLocation } from "../../booking/israelLocations";
import { resolveLocationCoordinates } from "../../booking/locationSearch";
import {
  validateWeeklyRows,
  WeekDayRow,
  WeeklyDriverDay,
} from "../../booking/weeklyBookingLib";
import { translateCategoryLabel } from "../../i18n/formatters";
import { useLanguage } from "../../i18n/LanguageProvider";
import { backIconName } from "../../i18n/rtl";
import AutocompleteTextField from "../../components/AutocompleteTextField";
import KeyboardAvoidingWrapper from "../../components/KeyboardAvoidingWrapper";
import VehicleDetailsSection from "../../components/VehicleDetailsSection";
import { fetchDriverEligibility } from "../driverEligibility";
import { getDriverSuspensionBlockedReason } from "../../booking/driverViolationsLib";
import DateInput, { TimeInput } from "./DateInput";
import WeeklyDaysCard from "./WeeklyDaysCard";
import YesNoField from "./YesNoField";
import {
  getDayFromDateText,
  getDigitsOnly,
  isValidCarPlate,
  normalize,
  normalizeDateToYMD,
  styles,
  useDriverAccount,
  validateAccountInfo,
  validateDateAndTimeNotPassed,
} from "./driverHelpers";
import { recordUsedFormValues, useSavedFormValues } from "./savedFormValuesLib";

type RideCategory = "school" | "personal";

type Props = {
  category: RideCategory;
  showPets?: boolean;
  onBack?: () => void;
  // Rendered inline below another screen's own header/selector (see
  // app/driver/create/school.tsx's "Weekly recurring" mode) instead of as a
  // full standalone screen — skips this form's own SafeAreaView/back
  // button/title so the two never visually stack.
  embedded?: boolean;
  // The embedding screen's own selector already means "weekly recurring" —
  // skips this form's internal repeat-toggle and always shows the weekly
  // days card, never the one-time date/time/price/seats fields.
  forceRecurring?: boolean;
  // Embedded mode only: renders the embedding screen's own title/subtitle
  // (centered) at the top of THIS form's card, above the category badge,
  // instead of the embedding screen showing them in a separate card of its
  // own above the mode selector — see app/driver/create/school.tsx.
  headerTitle?: string;
  headerSubtitle?: string;
};

export default function RideForm({
  category,
  showPets,
  onBack,
  embedded,
  forceRecurring,
  headerTitle,
  headerSubtitle,
}: Props) {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const { driverName, phone, driverAge, languages } = useDriverAccount();
  const meta = getCategoryMeta(category);

  const canRepeat = category === "school" || category === "personal";

  const [loading, setLoading] = useState(false);

  const [car, setCar] = useState("");
  const [carColor, setCarColor] = useState("");
  const [carPlate, setCarPlate] = useState("");
  const savedValues = useSavedFormValues();

  // Prefill from the driver's own most-recently-used vehicle (never price —
  // it varies by route) the first time suggestions arrive, only into fields
  // still empty at that point (never overwrites something already typed).
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

  const [allowsPets, setAllowsPets] = useState(false);

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

  // School: the exact school/university name, so passengers don't need
  // GPS/Waze just to know which school this route serves — required.
  const [schoolName, setSchoolName] = useState("");

  // Personal: the exact place within the destination city (a building,
  // landmark, ...) — free text, optional, never used for driver matching
  // (that's from/to above). Shown to passengers before they book, and on
  // the booking itself.
  const [destinationDetails, setDestinationDetails] = useState("");

  const [tripDate, setTripDate] = useState("");
  const [showTripDatePicker, setShowTripDatePicker] = useState(false);

  const [isRecurring, setIsRecurring] = useState(!!forceRecurring);
  const [weeklyRows, setWeeklyRows] = useState<WeekDayRow[]>([]);

  const [time, setTime] = useState("");
  const [showTimePicker, setShowTimePicker] = useState(false);

  const [price, setPrice] = useState("");
  const [seats, setSeats] = useState("1");

  const toggleRecurring = (value: boolean) => {
    setIsRecurring(value);

    if (!value) {
      setWeeklyRows([]);
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

    const recurring = canRepeat && isRecurring;

    if (
      !car ||
      !carColor ||
      !carPlate ||
      !from ||
      !to ||
      (category === "school" && !schoolName.trim()) ||
      (!recurring && (!tripDate || !price || !time || !seats))
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

    let weeklyTrips: WeeklyDriverDay[] = [];
    let cleanTripDate = "";
    let tripDay = "";
    let cleanTime = "";
    let cleanSeats = 0;
    let cleanPrice = 0;

    if (recurring) {
      const cleanedDays = validateWeeklyRows(weeklyRows, {
        requirePrice: true,
      });

      if (!cleanedDays) return;

      weeklyTrips = cleanedDays;
      cleanTripDate = weeklyTrips[0].date;
      tripDay = weeklyTrips[0].dayName;
      cleanTime = weeklyTrips[0].time;
      cleanSeats = Math.max(...weeklyTrips.map((day) => day.seats));
      cleanPrice = weeklyTrips[0].price;
    } else {
      const cleanedDate = normalizeDateToYMD(tripDate);

      if (!cleanedDate) {
        Alert.alert(
          t("validation.invalidDateTitle"),
          t("validation.invalidDateFuture"),
        );
        return;
      }

      cleanTripDate = cleanedDate;
      tripDay = getDayFromDateText(cleanTripDate);

      const validation = validateDateAndTimeNotPassed(tripDate, time, {
        dateLabelKey: "driverCreate.travelDate",
        timeLabelKey: "driverCreate.departureTime",
      });

      if (!validation) return;

      cleanTime = validation.cleanTime;
      cleanSeats = Number(seats);

      if (Number.isNaN(cleanSeats) || cleanSeats < 1 || cleanSeats > 8) {
        Alert.alert(t("validation.invalidSeatsTitle"), t("validation.invalidSeats"));
        return;
      }

      cleanPrice = Number(price);

      if (Number.isNaN(cleanPrice) || cleanPrice <= 0) {
        Alert.alert(t("validation.invalidPriceTitle"), t("validation.invalidPrice"));
        return;
      }
    }

    const finalAvailableDays = recurring
      ? weeklyTrips.map((day) => day.dayName)
      : [tripDay];

    try {
      setLoading(true);

      // Origin/destination coordinates — resolved ONCE here at creation time
      // (never re-geocoded when Home loads). Prefers the autocomplete's own
      // dataset coordinates, falling back to a live geocode of the typed
      // text only when the locality doesn't have them yet.
      const routeCoords: Record<string, number> = {};

      const fromCoords = await resolveLocationCoordinates(fromLocation, from);
      if (fromCoords) {
        routeCoords.fromLat = fromCoords.latitude;
        routeCoords.fromLng = fromCoords.longitude;
      }

      const toCoords = await resolveLocationCoordinates(toLocation, to);
      if (toCoords) {
        routeCoords.toLat = toCoords.latitude;
        routeCoords.toLng = toCoords.longitude;
      }

      await addDoc(collection(db, "driverRoutes"), {
        driverId: user.uid,

        driverName,
        phone: accountInfo.cleanPhone,
        driverAge: accountInfo.cleanDriverAge,

        languages,

        category,

        car,
        carColor,
        carPlate,

        allowsPets: showPets ? allowsPets : false,

        from,
        to,
        schoolName: category === "school" ? schoolName.trim() : null,
        destinationDetails:
          category === "personal" ? destinationDetails.trim() || null : null,
        fromNormalized: normalize(from),
        toNormalized: normalize(to),
        // Stable IDs so a driver in Hebrew and a passenger in Arabic still
        // match the same locality — see israelLocations.ts/locationSearch.ts.
        // fromNormalized/toNormalized above remain as the fallback for old
        // documents that predate this.
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
        ...routeCoords,

        tripDate: cleanTripDate,
        startDate: cleanTripDate,
        day: tripDay,

        isRecurring: recurring,
        bookingType: recurring ? "weekly" : "quick",
        repeatDays: finalAvailableDays,
        availableDays: finalAvailableDays,
        weeklyTrips: recurring ? weeklyTrips : [],

        time: cleanTime,

        price: cleanPrice,
        seats: cleanSeats,

        rating: 4.8,
        reviews: 0,
        eta: 10,
        active: true,

        createdAt: serverTimestamp(),
      });

      recordUsedFormValues({ carModel: car, carColor, plateNumber: carPlate, price: String(cleanPrice) });

      Alert.alert(t("common.success"), t("driver.tripCreated"));
      router.replace("/(tabs)/home" as any);
    } catch (error: any) {
      console.log("CREATE RIDE ERROR:", error);
      Alert.alert(t("common.error"), error.message || t("driver.couldNotCreateTrip"));
    } finally {
      setLoading(false);
    }
  };

  const categoryBadge = (
    <View style={[categoryStyles.categoryBadge, { backgroundColor: `${meta.color}18` }]}>
      <Ionicons name={meta.icon} size={18} color={meta.color} />
      <Text style={[categoryStyles.categoryBadgeText, { color: meta.color }]}>
        {translateCategoryLabel(category, meta.label, t)}
      </Text>
    </View>
  );

  const content = (
    <>
      <View style={styles.card}>
      {embedded && headerTitle ? (
        <>
          <Text style={[styles.title, categoryStyles.smallerTitle]}>
            {headerTitle}
          </Text>
          {headerSubtitle ? (
            <Text style={styles.subtitle}>{headerSubtitle}</Text>
          ) : null}
        </>
      ) : null}

      {!embedded ? (
        <>
          <Text style={[styles.title, categoryStyles.smallerTitle]}>
            {t("driverCreate.newTripTitle")}
          </Text>
          <Text style={styles.subtitle}>{t("driverCreate.newTripSubtitle")}</Text>
        </>
      ) : null}

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

          {category === "school" ? (
            <>
              <Text style={styles.label}>{t("driverCreate.schoolName")}</Text>
              <View style={styles.inputRow}>
                <Ionicons name="school-outline" size={18} color="#8B7B6B" />
                <TextInput
                  style={styles.rowInput}
                  placeholder={t("driverCreate.enterSchoolName")}
                  placeholderTextColor="#8B7B6B"
                  value={schoolName}
                  onChangeText={setSchoolName}
                />
              </View>
            </>
          ) : null}

          {category === "personal" ? (
            <>
              <Text style={styles.label}>
                {t("driverCreate.exactDestination")}
              </Text>
              <View style={styles.inputRow}>
                <Ionicons name="flag-outline" size={18} color="#8B7B6B" />
                <TextInput
                  style={styles.rowInput}
                  placeholder={t("driverCreate.enterExactDestination")}
                  placeholderTextColor="#8B7B6B"
                  value={destinationDetails}
                  onChangeText={setDestinationDetails}
                />
              </View>
            </>
          ) : null}

          {canRepeat && !forceRecurring && (
            <YesNoField
              label={t("driverCreate.repeatMultipleDays")}
              value={isRecurring}
              onValueChange={toggleRecurring}
              activeColor={meta.color}
            />
          )}

          {!(canRepeat && isRecurring) ? (
            <>
              <DateInput
                label={t("driverCreate.travelDate")}
                value={tripDate}
                onChange={setTripDate}
                showPicker={showTripDatePicker}
                setShowPicker={setShowTripDatePicker}
              />

              <TimeInput
                label={t("driverCreate.departureTime")}
                value={time}
                onChange={setTime}
                showPicker={showTimePicker}
                setShowPicker={setShowTimePicker}
                associatedDate={tripDate}
              />

              <View style={styles.twoColumns}>
                <View style={styles.column}>
                  <AutocompleteTextField
                    label={t("booking.price")}
                    value={price}
                    onChangeText={(text) => setPrice(getDigitsOnly(text))}
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
                      value={seats}
                      onChangeText={(text) =>
                        setSeats(getDigitsOnly(text).slice(0, 1))
                      }
                    />
                  </View>
                </View>
              </View>
            </>
          ) : (
            <WeeklyDaysCard
              rows={weeklyRows}
              onChange={setWeeklyRows}
              defaultTime="09:00"
              mode="driver"
            />
          )}

          {showPets && (
            <YesNoField
              label={t("driverCreate.allowsPets")}
              value={allowsPets}
              onValueChange={setAllowsPets}
              activeColor={meta.color}
            />
          )}

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
              { backgroundColor: meta.color },
              loading && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={loading}
          >
            <Text style={styles.submitText}>
              {loading ? t("driverCreate.creating") : t("driverCreate.createTrip")}
            </Text>
          </Pressable>
      </View>
    </>
  );

  if (embedded) {
    return (
      <KeyboardAvoidingWrapper>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 8 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        >
          {content}
        </ScrollView>
      </KeyboardAvoidingWrapper>
    );
  }

  return (
    <DirectionalScreen style={styles.page}>
      <KeyboardAvoidingWrapper>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        >
          <View style={categoryStyles.topRow}>
            <Pressable
              style={styles.backButton}
              onPress={() => (onBack ? onBack() : router.back())}
            >
              <Ionicons name={backIconName(isRTL)} size={24} color="#7C5F46" />
            </Pressable>

            {categoryBadge}
          </View>

          {content}
        </ScrollView>
      </KeyboardAvoidingWrapper>
    </DirectionalScreen>
  );
}

const categoryStyles = StyleSheet.create({
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
  // Overrides shared driverHelpers.ts styles.title (fontSize 28) just here —
  // that style is reused by every other create-trip screen, so shrinking it
  // globally would resize titles nobody asked to change.
  smallerTitle: {
    fontSize: 22,
  },
});
