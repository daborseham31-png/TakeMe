import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Alert } from "../AppAlert";
import { useTranslation } from "react-i18next";

import { db } from "../../firebase";
import i18n from "../i18n";
import {
  DirectionalCard,
  DirectionalRow,
  DirectionalScreen,
  DirectionalText,
} from "../i18n/DirectionalPrimitives";
import { useLanguage } from "../i18n/LanguageProvider";
import { translateStoredDayName } from "../i18n/formatters";
import { marginEnd } from "../i18n/rtl";
import { createPassengerBooking } from "./bookingsLib";
import { isCancelledTripStatus } from "./driverViolationCore";
import { formatDateToYMD } from "../driver/create/driverHelpers";
import DriverReviewsSection from "./DriverReviewsSection";
import { getDisplayedDriverId } from "./driverReviewsLib";
import { LocationNames, sameLocation } from "./locationSearch";
import {
  DriverRouteInput,
  getRouteMatchesForCandidates,
  isEffectivelySameLocation,
  LatLng,
  projectOntoCorridor,
  RouteMatchResult,
  toFiniteCoordinate,
} from "./routeMatchLib";
import {
  buildBookingDayFromMatch,
  computeWeeklyTotal,
  getLocalNowInIsrael,
  matchDriverWeeklyDays,
  WeeklyDayMatch,
  WeeklyDriverDay,
  WeeklyRequestDay,
} from "./weeklyBookingLib";
import { dedupeSortFutureDates, groupMatchesByDate } from "./weeklyBookingCore";

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
  deletedForDriver?: boolean;
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
  // Origin/destination coordinates (A/C — see routeMatchLib.ts), written at
  // creation by RideForm.tsx. Typed loosely since some legacy Firestore
  // documents may store these as numeric strings — always read through
  // toFiniteCoordinate below, never compared/used directly.
  fromLat?: number | string;
  fromLng?: number | string;
  toLat?: number | string;
  toLng?: number | string;
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

// ---------------------------------------------------------------------------
// Temporary development-only diagnostics for the local route-matching
// integration below — covers both Personal Ride and the legacy weekly
// School Ride path (category "school", via driver.fromLat/fromLng/toLat/
// toLng — see the shared `routeMatchInputs` gate below), helps verify
// real-world rejections (like the Kafr Kanna -> Afula / Mashhad -> Afula
// regression this was built for) without guessing. __DEV__-gated only:
// never runs, never logs anything, in a production build. Reuses
// routeMatchLib.ts's own exported projectOntoCorridor/
// isEffectivelySameLocation rather than reimplementing the projection math
// here, purely to surface the progress values the shared RouteMatchResult
// type doesn't itself carry. Deliberately excludes raw coordinates and any
// driver/passenger contact info — only derived matching metrics and the
// same from/to text already shown on the card.
// ---------------------------------------------------------------------------

const logRejectedRouteMatchCandidate = (
  driver: DriverRoute,
  match: RouteMatchResult,
  driverInput: DriverRouteInput,
  pickup: LatLng,
  destination: LatLng | null,
) => {
  const origin = driverInput.origin!;
  const driverDestination = driverInput.destination!;

  const destinationTarget: LatLng =
    destination && !isEffectivelySameLocation(destination, driverDestination)
      ? destination
      : driverDestination;

  const pickupProjection = projectOntoCorridor(origin, driverDestination, pickup);
  const destinationProjection = projectOntoCorridor(origin, driverDestination, destinationTarget);

  // eslint-disable-next-line no-console
  console.log("[routeMatch] rejected candidate", {
    tripId: driver.id,
    category: driver.category || "",
    schoolName: driver.category === "school" ? driver.schoolName || "" : undefined,
    driverFrom: driver.from || driver.fromNormalized || "",
    driverTo: driver.to || driver.toNormalized || "",
    rejectionReason: match.reason,
    corridorDistanceKm: match.pickupDistanceFromRouteKm,
    approximateDetourKm: match.approximateDetourKm,
    detourRatio: match.detourRatio,
    pickupProgress: pickupProjection.progress,
    destinationProgress: destinationProjection.progress,
  });
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
  // A failed search query is a genuine error, never "no trips found" — see
  // this screen's own bug report. Kept separate from `drivers` staying `[]`
  // so the UI can tell the two apart.
  const [loadError, setLoadError] = useState(false);
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
  // The passenger's chosen pickup point (B — see PickupLocationPicker.tsx).
  // Passed through to ride-payment as before, and (Personal Ride + legacy
  // weekly School Ride — see ROUTE_MATCH_CATEGORIES below) also fed into
  // the local route-matching algorithm below (routeMatchLib.ts).
  const pickupLat = String(params.pickupLat || "");
  const pickupLng = String(params.pickupLng || "");
  const pickupAddress = String(params.pickupAddress || "");
  const pickupSource = String(params.pickupSource || "");
  // The passenger's destination (D — see personal-ride/index.tsx, which
  // resolves this from the typed "to" city). Personal Ride only, only used
  // for route-matching below; absent/invalid is treated as "D is genuinely
  // missing" (falls back to the driver's own destination C internally —
  // see routeMatchLib.ts's PassengerRouteQuery).
  const toLat = String(params.toLat || "");
  const toLng = String(params.toLng || "");
  // Passenger's own typed school name from the search form — only ever a
  // fallback for routes created before the driver's own School Name field
  // existed; the driver's own driverRoutes.schoolName wins whenever set
  // (see commonFiltered/handleBookDriver below).
  const searchedSchoolName = String(params.schoolName || "");
  const category = String(params.category || "");
  const genderPref = String(params.genderPref || "any");
  const seats = Number(params.seats || 1);

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

  // The one shared source of truth every selected date is read from below —
  // deduplicated, sorted chronologically, and floored to today-or-future
  // using ISRAEL-local "now" (never the device's own timezone — see this
  // fix's own Israel-timezone requirement), so a stale/duplicate/expired
  // date passed in from the search form can never produce a duplicate or
  // impossible result group. Used for BOTH the actual matching below and
  // the results grouping further down, so the two can never disagree about
  // which dates are being searched. See weeklyBookingCore.ts's own header
  // for why this is the shared, unit-tested implementation rather than one
  // written inline here.
  const sortedRequestedDates: WeeklyRequestDay[] = dedupeSortFutureDates(
    requestedWeeklyDays,
    formatDateToYMD(getLocalNowInIsrael()),
  );

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
      setLoadError(false);

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

      // -----------------------------------------------------------------
      // Personal Ride + (legacy weekly) School Ride only: local route-based/
      // detour-aware matching (see routeMatchLib.ts) — a driver whose ORIGIN
      // city text differs from the passenger's typed pickup city (e.g.
      // driver published "Kafr Kanna -> Afula", passenger typed pickup city
      // "Mashhad") can still match here as long as the passenger's actual
      // GPS pickup point (pickupLat/pickupLng — already collected by
      // PickupLocationPicker, previously only passed through to
      // ride-payment) is close to the driver's A->C corridor and the
      // resulting approximate detour is small. Fully local/free — no
      // network call, the exact same shared algorithm Home's nearby feed
      // uses. No other category (Work/Errand/Roadside/...) is ever included
      // here.
      //
      // A driver only enters this path when BOTH the driver's own saved
      // origin/destination coordinates AND the passenger's GPS pickup
      // point are valid numbers (see toFiniteCoordinate — handles legacy
      // Firestore documents that may have saved these as numeric strings).
      // Anything missing/invalid falls back to the existing from/to text
      // matching below, unchanged — never a hard rejection just because a
      // coordinate happens to be absent. In practice this means: School
      // route-matching only activates once a search screen actually
      // collects a real GPS pickup point for School (LegacySchoolSearchForm
      // does not today) — until then, School searches keep using the
      // existing text-based matching exactly as before, safely.
      // -----------------------------------------------------------------

      const ROUTE_MATCH_CATEGORIES = new Set(["personal", "school"]);

      const passengerPickup: LatLng | null = (() => {
        const latitude = toFiniteCoordinate(pickupLat);
        const longitude = toFiniteCoordinate(pickupLng);
        return latitude !== null && longitude !== null ? { latitude, longitude } : null;
      })();

      // D — genuinely optional (see PassengerRouteQuery in routeMatchLib.ts,
      // which already treats an omitted/invalid destination as "same as C").
      const passengerDestination: LatLng | null = (() => {
        const latitude = toFiniteCoordinate(toLat);
        const longitude = toFiniteCoordinate(toLng);
        return latitude !== null && longitude !== null ? { latitude, longitude } : null;
      })();

      const routeMatchInputs = new Map<string, DriverRouteInput>();

      if (ROUTE_MATCH_CATEGORIES.has(category) && passengerPickup) {
        routesWithProfiles.forEach((driver) => {
          const driverCategoryMatches =
            category === "personal"
              ? driver.category === "personal" || driver.category === "personal_ride"
              : driver.category === "school";

          if (!driverCategoryMatches) return;

          const originLat = toFiniteCoordinate(driver.fromLat);
          const originLng = toFiniteCoordinate(driver.fromLng);
          const destLat = toFiniteCoordinate(driver.toLat);
          const destLng = toFiniteCoordinate(driver.toLng);

          if (originLat === null || originLng === null || destLat === null || destLng === null) {
            return; // legacy fallback for this specific driver
          }

          routeMatchInputs.set(driver.id, {
            tripId: driver.id,
            origin: { latitude: originLat, longitude: originLng },
            destination: { latitude: destLat, longitude: destLng },
          });
        });
      }

      const routeMatchResults: Map<string, RouteMatchResult> =
        routeMatchInputs.size > 0 && passengerPickup
          ? new Map(
              getRouteMatchesForCandidates(Array.from(routeMatchInputs.values()), {
                pickup: passengerPickup,
                destination: passengerDestination,
              }).map((result) => [result.tripId, result]),
            )
          : new Map();

      const commonFiltered = routesWithProfiles.filter((driver) => {
        // A trip the driver explicitly cancelled (or hid from their own
        // list) must never resurface here for a different passenger to book
        // — see driverViolationCore.ts's isCancelledTripStatus, the one
        // shared policy every public/search query should use.
        const activeMatches =
          driver.active !== false &&
          !isCancelledTripStatus(driver.status) &&
          driver.deletedForDriver !== true;
        const categoryMatches = !category || driver.category === category;

        const driverGender = getDriverGender(driver);
        const driverLanguages = getDriverLanguages(driver);

        const genderMatches =
          genderPref === "any" || driverGender === genderPref;

        const languageMatches =
          selectedLanguages.length === 0 ||
          selectedLanguages.some((lang) => driverLanguages.includes(lang));

        const routeMatch =
          ROUTE_MATCH_CATEGORIES.has(category) ? routeMatchResults.get(driver.id) : undefined;

        let locationCompatible: boolean;

        if (routeMatch) {
          locationCompatible = routeMatch.eligible;

          if (__DEV__ && !routeMatch.eligible) {
            logRejectedRouteMatchCandidate(
              driver,
              routeMatch,
              routeMatchInputs.get(driver.id)!,
              passengerPickup!,
              passengerDestination,
            );
          }
        } else {
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

          locationCompatible = fromMatches && toMatches;
        }

        return (
          activeMatches &&
          categoryMatches &&
          locationCompatible &&
          genderMatches &&
          languageMatches
        );
      });

      if (isWeekly) {
        const matchesMap: Record<string, WeeklyDayMatch[]> = {};

        // Each selected date is matched INDEPENDENTLY (OR logic) —
        // matchDriverWeeklyDays already checks every requested date
        // separately and returns whichever ones this driver actually
        // covers; a driver is kept as long as it covers AT LEAST ONE, never
        // required to cover every selected date. See this fix's own bug
        // report ("Search each selected date independently... OR logic").
        const matchedDrivers = commonFiltered.filter((driver) => {
          const matches = matchDriverWeeklyDays(
            driver,
            sortedRequestedDates,
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
      // A failed query is a real error state, never silently rendered as
      // "no trips found" — see loadError's own declaration above.
      setLoadError(true);
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
        // The child(ren) originally selected on select-child.tsx (Home →
        // School Ride), carried through unchanged from this screen's own
        // incoming route params — see LegacySchoolSearchForm.tsx, which is
        // the only sender for the Weekly/classic School flow this screen
        // also serves. Empty/absent for Personal Ride.
        ...(isSchool ? { childEntries: String(params.childEntries || "") } : {}),

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

        pickupLat,
        pickupLng,
        pickupAddress,
        pickupSource,

        // The driver's own route origin — snapshotted onto the booking (see
        // ride-payment.tsx) so the driver's incoming-request card can show
        // an approximate distance to the passenger's pickup point without a
        // second Firestore read per card. Same toFiniteCoordinate-safe
        // handling as this screen's own route-matching above (legacy
        // documents may have these as numeric strings, or missing).
        ...(toFiniteCoordinate(driver.fromLat) !== null
          ? { driverFromLat: String(toFiniteCoordinate(driver.fromLat)) }
          : {}),
        ...(toFiniteCoordinate(driver.fromLng) !== null
          ? { driverFromLng: String(toFiniteCoordinate(driver.fromLng)) }
          : {}),
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
        ? {
            schoolName: driver.schoolName || searchedSchoolName,
            // Same passthrough as the quick-booking path above.
            childEntries: String(params.childEntries || ""),
          }
        : { destinationDetails: driver.destinationDetails || destinationDetails || "" }),

      driverCar: driver.car || "",
      driverCarColor: driver.carColor || "",
      driverCarPlateLast3: (driver.carPlate || "").replace(/\D/g, "").slice(-3),

      selectedWeeklyDays: JSON.stringify(selectedDaysForBooking),
      remainingWeeklyDays: JSON.stringify(remainingDays),

      // Passthrough so ride-payment can rebuild this results search if
      // some requested days still need a driver after this booking.
      genderPref,
      languages: String(params.languages || ""),

      pickupLat,
      pickupLng,
      pickupAddress,
      pickupSource,
    },
  } as any);
};

  if (loading) {
    return (
      <DirectionalScreen style={styles.page}>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#F58220" />
          <Text style={styles.loadingText}>{t("rides.loadingDrivers")}</Text>
        </View>
      </DirectionalScreen>
    );
  }
const availableDrivers = drivers.filter((driver: any) => {
  return (
    driver.status !== "booked" &&
    !isCancelledTripStatus(driver.status) &&
    driver.deletedForDriver !== true &&
    driver.isBooked !== true &&
    driver.available !== false &&
    !driver.bookingId &&
    !driver.bookedBy
  );
});

// Regroups the already-computed per-driver matches (weeklyMatches, from
// matchDriverWeeklyDays — unchanged) BY DATE instead of by driver, so the
// results screen can show "which trips exist for THIS date" independently
// per selected date (see this fix's own bug report). See
// weeklyBookingCore.ts's own header for why this is the shared, unit-tested
// implementation rather than one written inline here.
const resultsByDate = isWeekly
  ? groupMatchesByDate(sortedRequestedDates, availableDrivers, weeklyMatches)
  : new Map<string, { driver: DriverRoute; match: WeeklyDayMatch }[]>();

  // Renders one driver's result card. `onlyDate`, when provided, scopes the
  // weekly "Available for" list to that ONE date — used when this card is
  // rendered inside a per-date results group (see resultsByDate above), so
  // the same driver appearing under several date headings never repeats
  // another date's info under the wrong heading. The Book button is
  // unaffected either way: it always opens the day-picker against the
  // driver's FULL match set (weeklyMatches[driver.id]) — booking is a
  // driver-level action, never scoped to a single date.
  const renderDriverCard = (driver: DriverRoute, onlyDate?: string) => {
    const totalPrice = Number(driver.price || 0) * seats;

    const driverLanguages = getDriverLanguages(driver);
    const dateText = getDateText(driver);
    const daysText = getDaysText(driver);
    const driverGender = getDriverGender(driver);
    const rating = getDriverRating(driver);
    const displayedDriverId = getDisplayedDriverId(driver);

    const weeklyMatchesForCard = onlyDate
      ? (weeklyMatches[driver.id] || []).filter((match) => match.requested.date === onlyDate)
      : weeklyMatches[driver.id] || [];

    return (
      <View key={onlyDate ? `${driver.id}-${onlyDate}` : driver.id} style={styles.card}>
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

            {weeklyMatchesForCard.map((match) => (
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
                  weeklyMatchesForCard.map((match) => ({
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
                  <View style={[styles.iconCircle, marginEnd(10, isRTL)]}>
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
  };

  return (
    <DirectionalScreen style={styles.page}>
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
              days: sortedRequestedDates
                .map((day) => `${translateStoredDayName(day.dayName, t)} ${day.date}`)
                .join(", "),
            })}
          </Text>
        ) : null}

        {loadError ? (
          <View style={styles.emptyCard}>
            <Ionicons name="alert-circle-outline" size={42} color="#B91C1C" />
            <Text style={styles.emptyTitle}>{t("common.error")}</Text>
            <Text style={styles.emptyText}>{t("rides.couldNotLoadDrivers")}</Text>
          </View>
        ) : isWeekly ? (
          <View style={styles.list}>
            {/* Grouped BY DATE, never by driver — each selected date gets its
                own heading and either its matching trips or a clear
                "no trips for this date" message (see resultsByDate above).
                A general empty message is shown ABOVE the groups when
                nothing matched anywhere, but the per-date breakdown below it
                is never hidden/replaced — see this fix's own bug report. */}
            {availableDrivers.length === 0 ? (
              <Text style={styles.weeklyOverallEmptyText}>{t("rides.noDriversFound")}</Text>
            ) : null}

            {sortedRequestedDates.map((day) => {
              const dateResults = resultsByDate.get(day.date) || [];

              return (
                <View key={day.date} style={styles.dateGroup}>
                  <Text style={styles.dateGroupHeading}>
                    {translateStoredDayName(day.dayName, t)} {day.date}
                  </Text>

                  {dateResults.length === 0 ? (
                    <Text style={styles.dateGroupEmptyText}>
                      {t("rides.noTripsForThisDate")}
                    </Text>
                  ) : (
                    dateResults.map(({ driver }) => renderDriverCard(driver, day.date))
                  )}
                </View>
              );
            })}
          </View>
        ) : availableDrivers.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="car-outline" size={42} color="#8B7B6B" />
            <Text style={styles.emptyTitle}>{t("rides.noDriversFound")}</Text>
            <Text style={styles.emptyText}>{t("rides.noDriversHint")}</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {availableDrivers.map((driver) => renderDriverCard(driver))}
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

          <DirectionalCard style={styles.modalSheet}>
            <View style={styles.modalHandle} />

            <DirectionalText style={styles.modalTitle}>
              {t("rides.chooseDaysModalTitle")}
            </DirectionalText>

            {dayPickerDriver ? (
              <DirectionalText style={styles.modalSubtitle}>
                {getDriverName(dayPickerDriver)}
              </DirectionalText>
            ) : null}

            <ScrollView style={styles.modalList}>
              {dayPickerDriver &&
                (weeklyMatches[dayPickerDriver.id] || []).map((match) => {
                  const checked = dayPickerSelected.has(match.requested.date);

                  return (
                    <Pressable
                      key={match.requested.date}
                      onPress={() => toggleWeeklyDaySelection(match.requested.date)}
                    >
                      <DirectionalRow style={styles.modalDayRow}>
                        <Ionicons
                          name={checked ? "checkbox" : "square-outline"}
                          size={22}
                          color={checked ? "#F58220" : "#8B7B6B"}
                        />

                        <View style={styles.modalDayTextBox}>
                          <DirectionalText style={styles.modalDayTitle}>
                            {translateStoredDayName(match.driverDay.dayName, t)} —{" "}
                            {match.driverDay.date}
                          </DirectionalText>
                          <DirectionalText style={styles.modalDaySubtitle}>
                            {match.driverDay.time} ·{" "}
                            {t("booking.seatsCount", { count: match.requested.seats })} ·{" "}
                            {match.driverDay.price} ₪
                          </DirectionalText>
                        </View>
                      </DirectionalRow>
                    </Pressable>
                  );
                })}
            </ScrollView>

            <DirectionalRow style={styles.modalButtonsRow}>
              <Pressable style={styles.modalSecondaryButton} onPress={selectAllWeeklyDays}>
                <DirectionalText style={styles.modalSecondaryButtonText}>
                  {t("common.selectAll")}
                </DirectionalText>
              </Pressable>

              <Pressable style={styles.modalSecondaryButton} onPress={closeWeeklyDayPicker}>
                <DirectionalText style={styles.modalSecondaryButtonText}>
                  {t("common.cancel")}
                </DirectionalText>
              </Pressable>
            </DirectionalRow>

            <Pressable style={styles.modalPrimaryButton} onPress={confirmWeeklyDayPicker}>
              <DirectionalText style={styles.modalPrimaryButtonText}>
                {t("rides.continueToPayment")}
              </DirectionalText>
            </Pressable>
          </DirectionalCard>
        </View>
      </Modal>
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
  dateGroup: {
    marginBottom: 6,
  },
  dateGroupHeading: {
    fontSize: 16,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 10,
  },
  dateGroupEmptyText: {
    color: "#7C5F46",
    fontSize: 13,
    backgroundColor: "#FFFDFC",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 14,
    padding: 14,
    marginBottom: 18,
  },
  weeklyOverallEmptyText: {
    color: "#7C5F46",
    fontWeight: "700",
    fontSize: 14,
    marginBottom: 8,
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
