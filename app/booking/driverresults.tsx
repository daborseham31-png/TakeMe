import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { db } from "../../firebase";
import i18n from "../i18n";
import { useLanguage } from "../i18n/LanguageProvider";
import { translateStoredDayName } from "../i18n/formatters";
import { createPassengerBooking } from "./bookingsLib";
import DriverReviewsSection from "./DriverReviewsSection";
import { getDisplayedDriverId } from "./driverReviewsLib";
import { LocationNames, sameLocation } from "./locationSearch";
import {
  buildBookingDayFromMatch,
  computeWeeklyTotal,
  matchDriverWeeklyDays,
  WeeklyDayMatch,
  WeeklyDriverDay,
  WeeklyRequestDay,
} from "./weeklyBookingLib";

type DriverProfile = {
  name?: string;
  phone?: string;
  age?: number | string;
  driverAge?: number | string;
  gender?: string;
  language?: string;
  languages?: string[];
  spokenLanguages?: string[];
  ratingAverage?: number;
  ratingCount?: number;
};

type DriverRoute = {
  id: string;
  driverId?: string;
  status?: string;
  isBooked?: boolean;
  available?: boolean;
  bookingId?: string | null;
  bookedBy?: string | null;
  driverName?: string;
  phone?: string;
  gender?: "male" | "female";
  languages?: string[];
  profile?: DriverProfile;
  car?: string;
  carColor?: string;
  carPlate?: string;
  allowsPets?: boolean;
  category?: string;
  from?: string;
  to?: string;
  fromNormalized?: string;
  toNormalized?: string;
  // Stable Israeli-locality ids (see israelLocations.ts) — preferred over
  // fromNormalized/toNormalized text matching whenever both sides have one,
  // so a driver in Hebrew and a passenger in Arabic still match the same
  // place. Absent on documents created before this existed.
  fromLocationId?: string;
  toLocationId?: string;
  fromLocationNames?: LocationNames;
  toLocationNames?: LocationNames;
  // School: the exact school/university name (required at creation, so
  // absent only on documents created before this existed). Personal: the
  // exact place within the destination city (optional either way).
  schoolName?: string;
  destinationDetails?: string;
  tripDate?: string;
  day?: string;
  availableDays?: string[];
  time?: string;
  price?: number;
  seats?: number;
  weeklyTrips?: WeeklyDriverDay[];
  rating?: number;
  reviews?: number;
  eta?: number;
  active?: boolean;
};

// Language names are always shown in their own script, regardless of the
// app's current UI language — same convention as TripFeedCard.tsx's
// LANGUAGE_LABELS, never translated.
const LANGUAGES: Record<string, string> = {
  ar: "العربية",
  he: "עברית",
  en: "English",
  ru: "Русский",
};

const MAX_TIME_DIFF_MINUTES = 30;

const normalize = (value: string) => value.trim().toLowerCase();

const locationMatches = (
  driverValue: string,
  userValue: string,
  driverLocationId?: string,
  userLocationId?: string,
  driverNames?: LocationNames,
  userNames?: LocationNames,
) => {
  if (!userValue && !userLocationId) return true;

  // Stable-id match wins whenever both sides picked a suggestion from
  // IsraelLocationAutocomplete — correct even across display languages
  // ("נצרת" vs "الناصرة" vs "Nazareth"). Falls back to comparing every known
  // multilingual name for documents created before location ids existed —
  // see sameLocation in locationSearch.ts.
  if (
    sameLocation(
      driverLocationId,
      userLocationId,
      driverValue,
      userValue,
      driverNames,
      userNames,
    )
  ) {
    return true;
  }

  // Last-resort safety net for the oldest free-text-only documents (no id,
  // no multilingual names at all) — a loose substring match beats hiding
  // the trip outright.
  const driver = normalize(driverValue);
  const user = normalize(userValue);

  return driver.includes(user) || user.includes(driver);
};

const timeToMinutes = (time: string) => {
  if (!time) return null;

  const parts = time.trim().split(":");
  const hours = Number(parts[0]);
  const minutes = Number(parts[1] || 0);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;

  return hours * 60 + minutes;
};

const isTimeClose = (driverTime: string | undefined, passengerTime: string) => {
  if (!passengerTime) return true;
  if (!driverTime) return false;

  const driverMinutes = timeToMinutes(driverTime);
  const passengerMinutes = timeToMinutes(passengerTime);

  if (driverMinutes === null || passengerMinutes === null) return false;

  return Math.abs(driverMinutes - passengerMinutes) <= MAX_TIME_DIFF_MINUTES;
};

const languageToCode = (value: any) => {
  const clean = String(value || "")
    .trim()
    .toLowerCase();

  if (
    clean === "ar" ||
    clean === "arabic" ||
    clean === "عربي" ||
    clean === "العربية"
  ) {
    return "ar";
  }

  if (clean === "he" || clean === "hebrew" || clean === "עברית") {
    return "he";
  }

  if (clean === "en" || clean === "english") {
    return "en";
  }

  if (clean === "ru" || clean === "russian" || clean === "русский") {
    return "ru";
  }

  return "";
};

const getProfileLanguages = (profile?: DriverProfile) => {
  if (!profile) return [];

  // spokenLanguages (full words, e.g. "Arabic") comes from the sign up
  // flow's driver language picker; languages (codes, e.g. "ar") comes from
  // the older per-route language picker. languageToCode understands both.
  const combined = [
    ...(Array.isArray(profile.spokenLanguages) ? profile.spokenLanguages : []),
    ...(Array.isArray(profile.languages) ? profile.languages : []),
  ];

  if (combined.length > 0) {
    return combined
      .map(languageToCode)
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index);
  }

  const singleLanguage = languageToCode(profile.language);

  return singleLanguage ? [singleLanguage] : [];
};

const getDriverLanguages = (driver: DriverRoute) => {
  const profileLanguages = getProfileLanguages(driver.profile);

  if (profileLanguages.length > 0) {
    return profileLanguages;
  }

  if (Array.isArray(driver.languages)) {
    return driver.languages
      .map(languageToCode)
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index);
  }

  return [];
};

const normalizeGender = (value?: string) => {
  const gender = String(value || "").toLowerCase();

  if (gender === "female") return "female";
  if (gender === "male") return "male";

  return "";
};

const getDriverGender = (driver: DriverRoute) => {
  return (
    normalizeGender(driver.profile?.gender) || normalizeGender(driver.gender)
  );
};

const getDriverName = (driver: DriverRoute) => {
  return driver.profile?.name || driver.driverName || i18n.t("rides.driverFallback");
};

const getDriverPhone = (driver: DriverRoute) => {
  return driver.profile?.phone || driver.phone || "";
};

// The driver's overall saved rating — always from users/{driverId}, never
// computed client-side from whatever reviews happen to be loaded for this
// card. Reviews themselves are lazy-loaded by DriverReviewsSection.
const getDriverRating = (
  driver: DriverRoute,
): { average: number; count: number } | null => {
  const profileCount = Number(driver.profile?.ratingCount) || 0;
  const profileAverage = Number(driver.profile?.ratingAverage) || 0;

  if (profileCount > 0 && profileAverage > 0) {
    return { average: profileAverage, count: profileCount };
  }

  return null;
};

const getDateText = (driver: DriverRoute) => {
  return driver.tripDate || "";
};

const getDaysText = (driver: DriverRoute) => {
  if (Array.isArray(driver.availableDays) && driver.availableDays.length > 0) {
    return driver.availableDays.join(", ");
  }

  return driver.day || "";
};

export default function DriverResultsScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const params = useLocalSearchParams();

  const [drivers, setDrivers] = useState<DriverRoute[]>([]);
  const [weeklyMatches, setWeeklyMatches] = useState<
    Record<string, WeeklyDayMatch[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [bookingBusy, setBookingBusy] = useState(false);

  const [dayPickerDriver, setDayPickerDriver] = useState<DriverRoute | null>(
    null,
  );
  const [dayPickerSelected, setDayPickerSelected] = useState<Set<string>>(
    new Set(),
  );

  const parseLocationNames = (value: unknown): LocationNames | undefined => {
    try {
      const parsed = JSON.parse(String(value || ""));
      return parsed && typeof parsed === "object" ? parsed : undefined;
    } catch {
      return undefined;
    }
  };

  const from = String(params.from || "");
  const to = String(params.to || "");
  const fromLocationId = String(params.fromLocationId || "");
  const toLocationId = String(params.toLocationId || "");
  const fromLocationNames = parseLocationNames(params.fromLocationNames);
  const toLocationNames = parseLocationNames(params.toLocationNames);
  // The exact place within the destination city (optional, Personal Ride
  // only) — pure passthrough to ride-payment/the booking doc, never used
  // for matching.
  const destinationDetails = String(params.destinationDetails || "");
  // Passenger's own typed school name from the search form — only ever a
  // fallback for routes created before the driver's own School Name field
  // existed; the driver's own driverRoutes.schoolName wins whenever set
  // (see commonFiltered/handleBookDriver below).
  const searchedSchoolName = String(params.schoolName || "");
  const category = String(params.category || "");
  const genderPref = String(params.genderPref || "any");
  const seats = Number(params.seats || 1);

  // "Pickup location for driver navigation" on the booking form — an
  // optional, SEPARATE GPS point passed straight through to ride-payment
  // (which is the only screen that actually writes the booking document —
  // see handleBookDriver / confirmWeeklyDayPicker below). This is never used
  // for driver matching above (matching only ever compares `from`/`to`
  // text — see commonFiltered below), only for driver navigation later.
  const pickupLatParam =
    params.pickupLatitude !== undefined ? Number(params.pickupLatitude) : null;
  const pickupLngParam =
    params.pickupLongitude !== undefined ? Number(params.pickupLongitude) : null;
  const pickupAddressParam = String(params.pickupAddress || "");
  const pickupCoordsParams =
    pickupLatParam !== null &&
    pickupLngParam !== null &&
    !Number.isNaN(pickupLatParam) &&
    !Number.isNaN(pickupLngParam)
      ? {
          pickupLatitude: String(pickupLatParam),
          pickupLongitude: String(pickupLngParam),
          pickupAddress: pickupAddressParam,
        }
      : {};

  const requestedTime = String(params.time || "");
  const requestedDate = String(params.tripDate || "");
  const requestedDay = String(params.tripDay || "");

  const bookingType = String(params.bookingType || "quick");
  const isWeekly = bookingType === "weekly";

  let requestedWeeklyDays: WeeklyRequestDay[] = [];

  try {
    const parsed = JSON.parse(String(params.weeklyDays || "[]"));
    requestedWeeklyDays = Array.isArray(parsed) ? parsed : [];
  } catch {
    requestedWeeklyDays = [];
  }

  const selectedLanguages = String(params.languages || "")
    .split(",")
    .filter(Boolean);

  useEffect(() => {
    loadDrivers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDrivers = async () => {
    try {
      setLoading(true);

      const snapshot = await getDocs(collection(db, "driverRoutes"));

      const routesWithoutProfiles: DriverRoute[] = snapshot.docs.map(
        (docSnap) => {
          const data = docSnap.data();

          return {
            id: docSnap.id,
            ...(data as Omit<DriverRoute, "id">),
          };
        },
      );

      const routesWithProfiles: DriverRoute[] = await Promise.all(
        routesWithoutProfiles.map(async (driver) => {
          if (!driver.driverId) {
            return driver;
          }

          try {
            const profileSnap = await getDoc(doc(db, "users", driver.driverId));

            return {
              ...driver,
              profile: profileSnap.exists()
                ? (profileSnap.data() as DriverProfile)
                : undefined,
            };
          } catch {
            return driver;
          }
        }),
      );

      const commonFiltered = routesWithProfiles.filter((driver) => {
        const activeMatches = driver.active !== false;
        const categoryMatches = !category || driver.category === category;

        const fromMatches = locationMatches(
          driver.from || driver.fromNormalized || "",
          from,
          driver.fromLocationId,
          fromLocationId,
          driver.fromLocationNames,
          fromLocationNames,
        );
        const toMatches = locationMatches(
          driver.to || driver.toNormalized || "",
          to,
          driver.toLocationId,
          toLocationId,
          driver.toLocationNames,
          toLocationNames,
        );

        const driverGender = getDriverGender(driver);
        const driverLanguages = getDriverLanguages(driver);

        const genderMatches =
          genderPref === "any" || driverGender === genderPref;

        const languageMatches =
          selectedLanguages.length === 0 ||
          selectedLanguages.some((lang) => driverLanguages.includes(lang));

        return (
          activeMatches &&
          categoryMatches &&
          fromMatches &&
          toMatches &&
          genderMatches &&
          languageMatches
        );
      });

      if (isWeekly) {
        const matchesMap: Record<string, WeeklyDayMatch[]> = {};

        const matchedDrivers = commonFiltered.filter((driver) => {
          const matches = matchDriverWeeklyDays(
            driver,
            requestedWeeklyDays,
            { maxTimeDiffMinutes: MAX_TIME_DIFF_MINUTES },
          );

          if (matches.length === 0) return false;

          matchesMap[driver.id] = matches;
          return true;
        });

        setWeeklyMatches(matchesMap);
        setDrivers(matchedDrivers);
        return;
      }

      const filtered = commonFiltered.filter((driver) => {
        const seatsMatches = Number(driver.seats || 0) >= seats;

        const dateMatches =
          !requestedDate || driver.tripDate === requestedDate;

        const timeMatches =
          !requestedTime || isTimeClose(driver.time, requestedTime);

        return seatsMatches && dateMatches && timeMatches;
      });

      setDrivers(filtered);
    } catch (error: any) {
      console.log("Load drivers error:", error.message);
      Alert.alert(t("common.error"), t("rides.couldNotLoadDrivers"));
    } finally {
      setLoading(false);
    }
  };
const handleBookDriver = async (driver: DriverRoute) => {
  if (bookingBusy) return;

  const currentCategory = String(driver.category || category || "");

  const isPersonal =
    currentCategory === "personal" || currentCategory === "personal_ride";
  const isSchool = currentCategory === "school";

  const driverPrice = Number(driver.price || 0);
  const totalPrice = driverPrice * seats;

  const selectedDate = driver.tripDate || requestedDate || "";

  const selectedDay = driver.day || requestedDay || "";

  const selectedTime = driver.time || requestedTime || "";

  // School + Personal يروحوا للدفع أولاً
  // ممنوع نحفظ الحجز من صفحة النتائج
  if (isSchool || isPersonal) {
    router.push({
      pathname: "/booking/ride-payment",
      params: {
        category: isSchool ? "school" : "personal",
        bookingType: "quick",

        driverId: driver.driverId || "",
        driverName: getDriverName(driver),
        driverPhone: getDriverPhone(driver),

        routeId: driver.id,

        from: driver.from || from,
        to: driver.to || to,
        // The driver's own route-level value wins (it's what actually
        // describes this route); the passenger's own typed value is only a
        // fallback for routes created before these fields existed.
        ...(isSchool
          ? { schoolName: driver.schoolName || searchedSchoolName }
          : {}),
        ...(isPersonal
          ? {
              destinationDetails:
                driver.destinationDetails || destinationDetails || "",
            }
          : {}),
        ...pickupCoordsParams,

        date: selectedDate,
        day: selectedDay,
        time: selectedTime,

        seats: String(seats),
        maxSeats: String(driver.seats || seats || 1),
        price: String(totalPrice),
        unitPrice: String(driverPrice),

        driverCar: driver.car || "",
        driverCarColor: driver.carColor || "",
        driverCarPlateLast3: (driver.carPlate || "")
          .replace(/\D/g, "")
          .slice(-3),
      },
    } as any);

    return;
  }

  // باقي الأنواع القديمة نخليها زي ما كانت
  try {
    setBookingBusy(true);

    await createPassengerBooking({
      driverId: driver.driverId,
      driverName: getDriverName(driver),
      routeId: driver.id,
      category: driver.category || category,
      from: driver.from || from,
      to: driver.to || to,
      date: selectedDate,
      time: selectedTime,
      days: driver.availableDays || [],
      seats,
      price: totalPrice,
    });

    Alert.alert(
      t("rides.bookingConfirmedTitle"),
      t("rides.selectedDriverAdded", { name: getDriverName(driver) }),
    );

    router.push("/(tabs)/bookings" as any);
  } catch (error: any) {
    Alert.alert(t("common.error"), error?.message || t("rides.couldNotConfirmBooking"));
  } finally {
    setBookingBusy(false);
  }
};

// ---------------------------------------------------------------------------
// Weekly: "Book This Driver" opens a day-selection modal instead of going
// straight to payment. Matching is day-by-day, so the passenger can split
// their weekly request across multiple drivers.
// ---------------------------------------------------------------------------

const openWeeklyDayPicker = (driver: DriverRoute) => {
  const matches = weeklyMatches[driver.id] || [];
  if (matches.length === 0) return;

  setDayPickerDriver(driver);
  setDayPickerSelected(new Set(matches.map((match) => match.requested.date)));
};

const closeWeeklyDayPicker = () => {
  setDayPickerDriver(null);
  setDayPickerSelected(new Set());
};

const toggleWeeklyDaySelection = (date: string) => {
  setDayPickerSelected((prev) => {
    const next = new Set(prev);

    if (next.has(date)) {
      next.delete(date);
    } else {
      next.add(date);
    }

    return next;
  });
};

const selectAllWeeklyDays = () => {
  if (!dayPickerDriver) return;

  const matches = weeklyMatches[dayPickerDriver.id] || [];
  setDayPickerSelected(new Set(matches.map((match) => match.requested.date)));
};

const confirmWeeklyDayPicker = () => {
  if (!dayPickerDriver) return;

  const matches = weeklyMatches[dayPickerDriver.id] || [];
  const chosen = matches.filter((match) =>
    dayPickerSelected.has(match.requested.date),
  );

  if (chosen.length === 0) {
    Alert.alert(t("rides.chooseDayTitle"), t("rides.chooseDayMessage"));
    return;
  }

  const driver = dayPickerDriver;
  const selectedDaysForBooking = chosen.map(buildBookingDayFromMatch);
  const chosenDates = new Set(chosen.map((match) => match.requested.date));
  const remainingDays = requestedWeeklyDays.filter(
    (day) => !chosenDates.has(day.date),
  );

  closeWeeklyDayPicker();

  router.push({
    pathname: "/booking/ride-payment",
    params: {
      category: category === "school" ? "school" : "personal",
      bookingType: "weekly",

      driverId: driver.driverId || "",
      driverName: getDriverName(driver),
      driverPhone: getDriverPhone(driver),

      routeId: driver.id,

      from: driver.from || from,
      to: driver.to || to,
      // The driver's own route-level value wins; the passenger's own typed
      // value is only a fallback for routes created before these existed.
      ...(category === "school"
        ? { schoolName: driver.schoolName || searchedSchoolName }
        : { destinationDetails: driver.destinationDetails || destinationDetails || "" }),
      ...pickupCoordsParams,

      driverCar: driver.car || "",
      driverCarColor: driver.carColor || "",
      driverCarPlateLast3: (driver.carPlate || "").replace(/\D/g, "").slice(-3),

      selectedWeeklyDays: JSON.stringify(selectedDaysForBooking),
      remainingWeeklyDays: JSON.stringify(remainingDays),

      // Passthrough so ride-payment can rebuild this results search if
      // some requested days still need a driver after this booking.
      genderPref,
      languages: String(params.languages || ""),
    },
  } as any);
};

  if (loading) {
    return (
      <SafeAreaView style={styles.page}>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#F58220" />
          <Text style={styles.loadingText}>{t("rides.loadingDrivers")}</Text>
        </View>
      </SafeAreaView>
    );
  }
const availableDrivers = drivers.filter((driver: any) => {
  return (
    driver.status !== "booked" &&
    driver.isBooked !== true &&
    driver.available !== false &&
    !driver.bookingId &&
    !driver.bookedBy
  );
});
  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons
            name={isRTL ? "arrow-forward" : "arrow-back"}
            size={22}
            color="#7C5F46"
          />
          <Text style={styles.backText}>{t("common.back")}</Text>
        </Pressable>
                <Text style={styles.title}>
          {t("rides.availableDriversCount", { count: availableDrivers.length })}
        </Text>


        <Text style={styles.routeText}>
          {from || t("rides.anyLocation")} → {to || t("rides.anyDestination")}
        </Text>

        {!isWeekly && requestedDate ? (
          <Text style={styles.routeText}>📅 {requestedDate}</Text>
        ) : null}

        {isWeekly ? (
          <Text style={styles.routeText}>
            📅{" "}
            {t("rides.weeklyPrefix", {
              days: requestedWeeklyDays
                .map((day) => `${translateStoredDayName(day.dayName, t)} ${day.date}`)
                .join(", "),
            })}
          </Text>
        ) : null}

        {availableDrivers.length === 0? (
          <View style={styles.emptyCard}>
            <Ionicons name="car-outline" size={42} color="#8B7B6B" />
            <Text style={styles.emptyTitle}>{t("rides.noDriversFound")}</Text>
            <Text style={styles.emptyText}>{t("rides.noDriversHint")}</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {availableDrivers.map((driver) =>  {
              const totalPrice = Number(driver.price || 0) * seats;

              const driverLanguages = getDriverLanguages(driver);
              const dateText = getDateText(driver);
              const daysText = getDaysText(driver);
              const driverGender = getDriverGender(driver);
              const rating = getDriverRating(driver);
              const displayedDriverId = getDisplayedDriverId(driver);

              return (
                <View key={driver.id} style={styles.card}>
                  <View style={styles.topRow}>
                    <View style={styles.driverInfoRow}>
                      <View style={styles.avatar}>
                        <Ionicons
                          name="person-outline"
                          size={29}
                          color="#F58220"
                        />
                      </View>

                      <View style={styles.driverTextBox}>
                        <Text style={styles.driverName}>
                          {getDriverName(driver)}
                        </Text>

                        <View style={styles.driverMetaRow}>
                          {driverGender ? (
                            <>
                              <Text style={styles.genderText}>
                                {driverGender === "female" ? "♀" : "♂"}
                              </Text>
                              <Text style={styles.dot}>•</Text>
                            </>
                          ) : null}

                          <Ionicons
                            name="location-outline"
                            size={15}
                            color="#7C5F46"
                          />

                          <Text style={styles.driverMetaText}>
                            {driver.from || from} → {driver.to || to}
                          </Text>
                        </View>

                        {driver.category === "school" && driver.schoolName ? (
                          <View style={styles.driverMetaRow}>
                            <Ionicons
                              name="school-outline"
                              size={15}
                              color="#7C5F46"
                            />
                            <Text style={styles.driverMetaText}>
                              {driver.schoolName}
                            </Text>
                          </View>
                        ) : null}

                        {driver.category !== "school" &&
                        driver.destinationDetails ? (
                          <View style={styles.driverMetaRow}>
                            <Ionicons
                              name="flag-outline"
                              size={15}
                              color="#7C5F46"
                            />
                            <Text style={styles.driverMetaText}>
                              {driver.destinationDetails}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>

                    <View style={styles.ratingBox}>
                      <Ionicons name="star" size={16} color="#B86115" />
                      {rating ? (
                        <>
                          <Text style={styles.ratingText}>
                            {rating.average.toFixed(1)}
                          </Text>
                          <Text style={styles.reviewCount}>
                            ({rating.count})
                          </Text>
                        </>
                      ) : (
                        <Text style={styles.reviewCount}>{t("roadsideHelp.newDriverLabel")}</Text>
                      )}
                    </View>
                  </View>

                  {isWeekly ? (
                    <View style={styles.weeklyAvailBox}>
                      <Text style={styles.weeklyAvailTitle}>
                        {t("rides.availableFor")}
                      </Text>

                      {(weeklyMatches[driver.id] || []).map((match) => (
                        <View
                          key={match.requested.date}
                          style={styles.weeklyAvailRow}
                        >
                          <Ionicons
                            name="calendar-outline"
                            size={15}
                            color="#F58220"
                          />
                          <Text style={styles.weeklyAvailText}>
                            {translateStoredDayName(match.driverDay.dayName, t)} ·{" "}
                            {match.driverDay.date} · {match.driverDay.time} ·{" "}
                            {match.driverDay.price} ₪
                          </Text>
                        </View>
                      ))}

                      <View style={styles.softLine} />

                      <Text style={styles.priceText}>
                        {t("rides.totalIfAllDaysBooked", {
                          total: computeWeeklyTotal(
                            (weeklyMatches[driver.id] || []).map((match) => ({
                              price: match.driverDay.price,
                              seats: match.requested.seats,
                            })),
                          ),
                        })}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.detailsPanel}>
                      <View style={styles.detailsColumn}>
                        {(dateText || daysText) && (
                          <View style={styles.detailRow}>
                            <View style={styles.iconCircle}>
                              <Ionicons
                                name="calendar-outline"
                                size={17}
                                color="#F58220"
                              />
                            </View>

                            <View style={styles.detailTextBox}>
                              {dateText ? (
                                <Text style={styles.detailMainText}>
                                  {dateText}
                                </Text>
                              ) : null}

                              {daysText ? (
                                <Text style={styles.detailSubText}>
                                  {daysText}
                                </Text>
                              ) : null}
                            </View>
                          </View>
                        )}

                        <View style={styles.softLine} />

                        <View style={styles.detailRow}>
                          <View style={styles.iconCircle}>
                            <Ionicons
                              name="time-outline"
                              size={17}
                              color="#F58220"
                            />
                          </View>

                          <View style={styles.detailTextBox}>
                            <Text style={styles.detailMainText}>
                              {driver.time || "--:--"}
                            </Text>
                            <Text style={styles.detailSubText}>
                              {t("rides.departureTimeLabel")}
                            </Text>
                          </View>
                        </View>
                      </View>

                      <View style={styles.verticalDivider} />

                      <View style={styles.detailsColumn}>
                        <View style={styles.detailRow}>
                          <View style={styles.iconCircle}>
                            <Ionicons
                              name="people-outline"
                              size={17}
                              color="#F58220"
                            />
                          </View>

                          <View style={styles.detailTextBox}>
                            <Text style={styles.detailMainText}>
                              {t("booking.seatsCount", { count: driver.seats || 1 })}
                            </Text>
                            <Text style={styles.detailSubText}>
                              {t("rides.seatsAvailableSub")}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.softLine} />

                        <View style={styles.detailRow}>
                          <View style={styles.iconCircle}>
                            <Ionicons
                              name="bag-outline"
                              size={17}
                              color="#F58220"
                            />
                          </View>

                          <View style={styles.detailTextBox}>
                            <Text style={styles.priceText}>
                              {totalPrice} ₪
                            </Text>
                            <Text style={styles.detailSubText}>{t("rides.priceLabel")}</Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  )}

                  <View style={styles.badgesRow}>
                    {driverLanguages.map((lang) => (
                      <View key={lang} style={styles.languageBadge}>
                        <Ionicons
                          name="language-outline"
                          size={15}
                          color="#178C7B"
                        />
                        <Text style={styles.languageText}>
                          {LANGUAGES[lang] || lang}
                        </Text>
                      </View>
                    ))}

                    {typeof driver.allowsPets === "boolean" && (
                      <View
                        style={[
                          styles.petBadge,
                          driver.allowsPets
                            ? styles.petAllowedBadge
                            : styles.petNotAllowedBadge,
                        ]}
                      >
                        <Ionicons
                          name={
                            driver.allowsPets ? "paw-outline" : "close-outline"
                          }
                          size={15}
                          color={driver.allowsPets ? "#F58220" : "#7C5F46"}
                        />

                        <Text
                          style={[
                            styles.petText,
                            driver.allowsPets
                              ? styles.petAllowedText
                              : styles.petNotAllowedText,
                          ]}
                        >
                          {driver.allowsPets ? t("rides.petsAllowed") : t("rides.noPets")}
                        </Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.divider} />

                  <DriverReviewsSection
                    driverId={displayedDriverId}
                    reviewCountHint={rating?.count ?? null}
                  />

                  <Pressable
                    style={[styles.bookButton, bookingBusy && { opacity: 0.6 }]}
                    onPress={() =>
                      isWeekly
                        ? openWeeklyDayPicker(driver)
                        : handleBookDriver(driver)
                    }
                    disabled={bookingBusy}
                  >
                    <Text style={styles.bookButtonText}>{t("rides.bookThisDriver")}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={!!dayPickerDriver}
        transparent
        animationType="slide"
        onRequestClose={closeWeeklyDayPicker}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closeWeeklyDayPicker} />

          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />

            <Text style={styles.modalTitle}>
              {t("rides.chooseDaysModalTitle")}
            </Text>

            {dayPickerDriver ? (
              <Text style={styles.modalSubtitle}>
                {getDriverName(dayPickerDriver)}
              </Text>
            ) : null}

            <ScrollView style={styles.modalList}>
              {dayPickerDriver &&
                (weeklyMatches[dayPickerDriver.id] || []).map((match) => {
                  const checked = dayPickerSelected.has(match.requested.date);

                  return (
                    <Pressable
                      key={match.requested.date}
                      style={styles.modalDayRow}
                      onPress={() => toggleWeeklyDaySelection(match.requested.date)}
                    >
                      <Ionicons
                        name={checked ? "checkbox" : "square-outline"}
                        size={22}
                        color={checked ? "#F58220" : "#8B7B6B"}
                      />

                      <View style={styles.modalDayTextBox}>
                        <Text style={styles.modalDayTitle}>
                          {translateStoredDayName(match.driverDay.dayName, t)} —{" "}
                          {match.driverDay.date}
                        </Text>
                        <Text style={styles.modalDaySubtitle}>
                          {match.driverDay.time} ·{" "}
                          {t("booking.seatsCount", { count: match.requested.seats })} ·{" "}
                          {match.driverDay.price} ₪
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
            </ScrollView>

            <View style={styles.modalButtonsRow}>
              <Pressable style={styles.modalSecondaryButton} onPress={selectAllWeeklyDays}>
                <Text style={styles.modalSecondaryButtonText}>{t("common.selectAll")}</Text>
              </Pressable>

              <Pressable style={styles.modalSecondaryButton} onPress={closeWeeklyDayPicker}>
                <Text style={styles.modalSecondaryButtonText}>{t("common.cancel")}</Text>
              </Pressable>
            </View>

            <Pressable style={styles.modalPrimaryButton} onPress={confirmWeeklyDayPicker}>
              <Text style={styles.modalPrimaryButtonText}>
                {t("rides.continueToPayment")}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  loadingBox: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    color: "#7C5F46",
    fontWeight: "800",
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 20,
  },
  backText: {
    color: "#7C5F46",
    fontWeight: "800",
    fontSize: 15,
  },
  title: {
    fontSize: 28,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 8,
  },
  routeText: {
    color: "#7C5F46",
    fontWeight: "700",
    marginBottom: 22,
  },
  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#E7DCD1",
    padding: 30,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: "#111827",
    marginTop: 12,
    marginBottom: 6,
  },
  emptyText: {
    color: "#7C5F46",
    textAlign: "center",
    lineHeight: 20,
  },
  list: {
    gap: 18,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 24,
    padding: 18,
    marginBottom: 18,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 2,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 20,
  },
  driverInfoRow: {
    flexDirection: "row",
    flex: 1,
    gap: 12,
    alignItems: "center",
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#FFF2E8",
    alignItems: "center",
    justifyContent: "center",
  },
  driverTextBox: {
    flex: 1,
  },
  driverName: {
    fontSize: 21,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 5,
  },
  driverMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexWrap: "wrap",
  },
  genderText: {
    color: "#7C5F46",
    fontSize: 15,
    fontWeight: "900",
  },
  dot: {
    color: "#7C5F46",
    fontSize: 14,
    fontWeight: "900",
  },
  driverMetaText: {
    color: "#7C5F46",
    fontSize: 14,
    fontWeight: "700",
    flexShrink: 1,
  },
  ratingBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FFF2E8",
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 15,
  },
  ratingText: {
    fontWeight: "900",
    color: "#111827",
    fontSize: 15,
  },
  reviewCount: {
    color: "#7C5F46",
    fontSize: 12,
  },
  detailsPanel: {
    flexDirection: "row",
    backgroundColor: "#FBF7F1",
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
  },
  detailsColumn: {
    flex: 1,
    gap: 10,
  },
  verticalDivider: {
    width: 1,
    backgroundColor: "#E9DCD0",
    marginHorizontal: 14,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 42,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: "#FFF2E8",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  detailTextBox: {
    flex: 1,
  },
  detailMainText: {
    color: "#111827",
    fontSize: 15,
    fontWeight: "900",
  },
  detailSubText: {
    color: "#7C5F46",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  priceText: {
    color: "#111827",
    fontSize: 17,
    fontWeight: "900",
  },
  softLine: {
    height: 1,
    backgroundColor: "#E9DCD0",
  },
  badgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginBottom: 16,
  },
  languageBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#EAF8F5",
    borderWidth: 1,
    borderColor: "#9DDDD2",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
  },
  languageText: {
    color: "#178C7B",
    fontSize: 13,
    fontWeight: "900",
  },
  petBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
  },
  petAllowedBadge: {
    backgroundColor: "#FFF3E6",
    borderColor: "#FDBA74",
  },
  petNotAllowedBadge: {
    backgroundColor: "#F5F1ED",
    borderColor: "#E4DDD7",
  },
  petText: {
    fontSize: 13,
    fontWeight: "900",
  },
  petAllowedText: {
    color: "#F58220",
  },
  petNotAllowedText: {
    color: "#7C5F46",
  },
  divider: {
    height: 1,
    backgroundColor: "#F0E5DC",
    marginBottom: 14,
  },
  bookButton: {
    backgroundColor: "#F58220",
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    position: "relative",
  },
  bookButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
  },
  weeklyAvailBox: {
    backgroundColor: "#FBF7F1",
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
    gap: 8,
  },
  weeklyAvailTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 2,
  },
  weeklyAvailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  weeklyAvailText: {
    color: "#3C2319",
    fontSize: 13,
    fontWeight: "700",
    flexShrink: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    flex: 1,
  },
  modalSheet: {
    backgroundColor: "#FBF7F1",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 34,
    maxHeight: "80%",
  },
  modalHandle: {
    alignSelf: "center",
    width: 46,
    height: 5,
    borderRadius: 20,
    backgroundColor: "#D8C9BC",
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: "#111827",
    textAlign: "center",
  },
  modalSubtitle: {
    fontSize: 14,
    color: "#7C5F46",
    fontWeight: "700",
    textAlign: "center",
    marginTop: 4,
    marginBottom: 12,
  },
  modalList: {
    marginBottom: 12,
  },
  modalDayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  modalDayTextBox: {
    flex: 1,
  },
  modalDayTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: "#111827",
  },
  modalDaySubtitle: {
    fontSize: 12,
    color: "#7C5F46",
    fontWeight: "700",
    marginTop: 2,
  },
  modalButtonsRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 10,
  },
  modalSecondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  modalSecondaryButtonText: {
    fontWeight: "900",
    color: "#7C5F46",
    fontSize: 15,
  },
  modalPrimaryButton: {
    backgroundColor: "#F58220",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  modalPrimaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 16,
  },
});
