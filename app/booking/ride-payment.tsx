import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { auth, db } from "../../firebase";
import { DirectionalScreen } from "../i18n/DirectionalPrimitives";
import { useLanguage } from "../i18n/LanguageProvider";
import { translateStoredDayName } from "../i18n/formatters";
import { ltrContentStyle } from "../i18n/rtl";
import BitBadge from "./BitBadge";
import { openBitPayment } from "./bitPayment";
import { isDateTimeExpired } from "./homeFeedLib";
import { resolvePickupArea } from "./PickupLocationPicker";
import { RIDE_CATEGORY, RidePayment } from "./rideBookingLib";
import {
  acceptReplacementOffer,
  bookOutboundForChildren,
  bookReturnForChild,
  bookSchoolTripSingle,
  deepRemoveUndefined,
  generateBookingGroupId,
  SchoolBookingChildEntry,
  SchoolBookingPaymentMethod,
  SchoolTripDirection,
} from "./schoolTripsLib";
import {
  computeWeeklyTotal,
  createWeeklyBookings,
  WeeklyDriverDay,
  WeeklyRequestDay,
} from "./weeklyBookingLib";
import { notify } from "./work-errand/workErrandLib";

type Method = "cash" | "bit" | null;

const num = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const getLast3 = (value: string) => {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 3 ? digits.slice(-3) : digits;
};

export default function RidePaymentScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const params = useLocalSearchParams();

  const category = String(params.category || "personal");
  const isSchool = category === "school";

  const driverId = String(params.driverId || "");
  const driverName = String(params.driverName || "Driver");
  const driverPhone = String(params.driverPhone || "");

  const driverCar = String(params.driverCar || params.car || "");
  const driverCarColor = String(params.driverCarColor || params.carColor || "");
  const driverCarPlateLast3 = getLast3(
    String(params.driverCarPlateLast3 || params.carPlate || ""),
  );

  const routeId = String(params.routeId || "");
  const from = String(params.from || "");
  const to = String(params.to || "");
  // The exact place within the destination city (optional, Personal Ride
  // only) — informational for the driver, never used for matching.
  const destinationDetails = String(params.destinationDetails || "");
  // The passenger's chosen pickup point (see PickupLocationPicker.tsx) —
  // threaded through from personal-ride/index.tsx or the School Trips
  // outbound search form via driverresults.tsx/trip-confirm.tsx.
  const pickupLat = params.pickupLat ? Number(params.pickupLat) : null;
  const pickupLng = params.pickupLng ? Number(params.pickupLng) : null;
  const pickupAddress = String(params.pickupAddress || "");
  const pickupSource = String(params.pickupSource || "custom") as "current" | "home" | "custom";
  const pickupLocation =
    pickupLat != null && pickupLng != null && Number.isFinite(pickupLat) && Number.isFinite(pickupLng)
      ? { latitude: pickupLat, longitude: pickupLng, address: pickupAddress, source: pickupSource }
      : null;
  // Best-effort area/city name for the SAME point above — resolved once in
  // the background (see the useEffect below), never blocking Continue if it
  // hasn't resolved yet or fails; the coordinates/address are the
  // authoritative required data (see handleContinue's own validation),
  // `pickupArea` is purely a display convenience for the driver's incoming-
  // request card.
  const [pickupArea, setPickupArea] = useState("");
  // The driver's own route origin (see driverresults.tsx's handleBookDriver)
  // — snapshotted so the driver's incoming-request card can show an
  // approximate distance to the passenger's pickup point without a second
  // Firestore read per card. Absent/null on routes that never had these
  // (legacy documents, or a route without saved coordinates) — never
  // required.
  const driverFromLat = params.driverFromLat ? Number(params.driverFromLat) : null;
  const driverFromLng = params.driverFromLng ? Number(params.driverFromLng) : null;

  useEffect(() => {
    if (!pickupLocation) return;
    let cancelled = false;

    resolvePickupArea(pickupLocation.latitude, pickupLocation.longitude)
      .then((area) => {
        if (!cancelled) setPickupArea(area);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Written onto the booking doc instead of the bare `pickupLocation` above
  // — adds `area` (resolved in the background, may still be "" if the
  // driver taps Continue before it resolves — never blocks submission) and
  // never adds the field at all when there's no pickup point to begin with.
  const pickupLocationForWrite = pickupLocation ? { ...pickupLocation, area: pickupArea } : null;
  const driverOriginFields =
    driverFromLat !== null && driverFromLng !== null && Number.isFinite(driverFromLat) && Number.isFinite(driverFromLng)
      ? { driverFromLat, driverFromLng }
      : {};
  // School only — the exact school/university name, required at trip
  // creation (see RideForm.tsx).
  const schoolName = String(params.schoolName || "");
  const date = String(params.date || params.tripDate || "");
  const day = String(params.day || params.tripDay || "");
  const time = String(params.time || "");
  const seats = num(params.seats);
  const price = num(params.price);
  const maxSeatsParam = num(params.maxSeats);
  const unitPriceParam = num(params.unitPrice);

  // School Trips booking (AGENTS.md's dedicated schoolTrips/schoolBookings
  // system — separate from the legacy driverRoutes/bookings path this
  // screen already serves for Personal Ride and old-style School rides
  // below). isSchoolTripsSource routes payment straight into
  // schoolTripsLib's own atomic per-seat transaction instead of writing to
  // driverRoutes/bookings; every other booking source on this screen is
  // completely unaffected by everything in this block.
  const isSchoolTripsSource = String(params.bookingSource || "") === "schoolTrips";
  const schoolTripId = String(params.schoolTripId || "");
  const schoolDirection = (
    params.direction === "from_school" ? "from_school" : "to_school"
  ) as SchoolTripDirection;
  const schoolBookingGroupIdParam = String(params.bookingGroupId || "");
  const schoolRoundTrip = params.roundTrip === "true";

  // Driver-cancellation replacement (AGENTS.md's replacement-offer feature)
  // — the parent already picked ONE specific replacement trip on
  // app/booking/school/replacement-offer.tsx; this screen only collects
  // payment for the (higher) price difference before acceptReplacementOffer
  // actually creates the replacement booking. Treated as its own booking
  // source (not "schoolTrips") since it calls a different function on
  // continue, but shares every bit of UI/seat-locking with it below.
  const isReplacementSource = String(params.bookingSource || "") === "schoolTripReplacement";
  const replacementOfferId = String(params.replacementOfferId || "");
  const isAnySchoolTripsSource = isSchoolTripsSource || isReplacementSource;

  // One entry per child riding this trip (AGENTS.md #3) — set by
  // trip-confirm.tsx. Empty for any booking with no per-child data (legacy
  // bookings, or a plain seats-only school booking), which keeps that path
  // fully intact below.
  const schoolChildEntries = useMemo<SchoolBookingChildEntry[]>(() => {
    const raw = String(params.childEntries || "");
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // deepRemoveUndefined here (not just at the eventual write) means
      // every consumer of this memo — the schoolTrips path below AND the
      // legacy bookings/createWeeklyBookings writes this screen also
      // feeds — already gets a Firestore-safe array, never one with a
      // literal `undefined` field Firestore would reject.
      return deepRemoveUndefined(
        parsed
          .filter((entry: any) => entry && typeof entry.localId === "string")
          .map((entry: any) => ({
            localId: entry.localId,
            childId: entry.childId || undefined,
            childName: entry.childName || undefined,
            sourceRideRequestId: entry.sourceRideRequestId || undefined,
          })),
      );
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.childEntries]);

  const [schoolAskReturn, setSchoolAskReturn] = useState(false);
  const [schoolBookedGroupId, setSchoolBookedGroupId] = useState<string | null>(null);

  const bookingType = String(params.bookingType || "quick");
  const isWeekly = bookingType === "weekly";

  let selectedWeeklyDays: WeeklyDriverDay[] = [];

  try {
    const parsed = JSON.parse(String(params.selectedWeeklyDays || "[]"));
    selectedWeeklyDays = Array.isArray(parsed) ? parsed : [];
  } catch {
    selectedWeeklyDays = [];
  }

  let remainingWeeklyDays: WeeklyRequestDay[] = [];

  try {
    const parsed = JSON.parse(String(params.remainingWeeklyDays || "[]"));
    remainingWeeklyDays = Array.isArray(parsed) ? parsed : [];
  } catch {
    remainingWeeklyDays = [];
  }

  const weeklyTotal = computeWeeklyTotal(selectedWeeklyDays);

  const resultsPassthrough = {
    category: isSchool ? "school" : "personal",
    schoolName: String(params.schoolName || ""),
    from,
    to,
    genderPref: String(params.genderPref || "any"),
    languages: String(params.languages || ""),
  };

  const [method, setMethod] = useState<Method>(null);
  const [processing, setProcessing] = useState(false);

  // The ride's real remaining capacity (falls back to the old fixed `seats`
  // param for any link built before maxSeats existed) and its per-seat price
  // — the seat stepper below lets the passenger pick how many of those seats
  // to book, up to that capacity. Never used for weekly bookings, which keep
  // their own per-day seat counts from the day picker.
  const maxSeatsValue = Math.max(1, maxSeatsParam ?? seats ?? 1);
  const unitPrice = unitPriceParam ?? price ?? 0;
  // A schoolTrips booking's seat count was already fixed on trip-confirm.tsx
  // (the child roster's size, or the passenger's own stepper choice there —
  // AGENTS.md's "one seat = one child") BEFORE reaching this screen, so it
  // starts (and, since the stepper card below is hidden for this source,
  // stays) at that exact count rather than the generic default of 1.
  const [selectedSeats, setSelectedSeats] = useState(
    isAnySchoolTripsSource ? maxSeatsValue : 1,
  );

  const decreaseSeats = () =>
    setSelectedSeats((prev) => Math.max(1, prev - 1));

  const increaseSeats = () =>
    setSelectedSeats((prev) => Math.min(maxSeatsValue, prev + 1));

  const totalPrice = isWeekly
    ? weeklyTotal
    : Number.isFinite(unitPrice * selectedSeats)
      ? unitPrice * selectedSeats
      : 0;

  const amountDue = totalPrice;

  // Selecting the BIT method card only reveals the receiver info + action
  // buttons below — it never copies anything or opens BIT by itself. The
  // actual clipboard copy / app launch only happens when the passenger
  // presses one of the two explicit buttons in that section.
  const handleSelectBit = () => {
    setMethod("bit");
  };

  const handleOpenBitAndCopy = () => {
    openBitPayment(driverPhone, amountDue);
  };

  // Books a schoolTrips/schoolBookings trip AFTER the passenger has chosen a
  // payment method on this screen — reusing the exact same atomic booking
  // primitives already used everywhere else in the school-ride system
  // (bookOutboundForChildren/bookReturnForChild/bookSchoolTripSingle, all of
  // which funnel into one shared, seat-decrementing Firestore transaction —
  // never a second booking system). Which one runs depends only on whether
  // a child roster is known and which direction this trip is:
  //   - outbound + a known roster → one multi-seat booking tagging every
  //     child riding together (AGENTS.md #3's childEntries array).
  //   - return + one or more known children → one INDEPENDENT booking PER
  //     child (childEntryId/childId/childName — the same shape every other
  //     return booking uses). Every entry gets its own bookReturnForChild
  //     call; this must never collapse to a single combined booking — a
  //     return leg is never shared between children (AGENTS.md's per-child
  //     return system), unlike an outbound leg.
  //   - anything else (no child data at all) → the original plain
  //     seats-only booking, unchanged.
  //
  // BUG FIX: this used to require `schoolChildEntries.length === 1` for the
  // return branch, silently falling through to the untagged
  // bookSchoolTripSingle() below for ANY other count — including the common
  // 2+-child round-trip case. That produced exactly one plain, untagged
  // return booking with no childEntryId/childId at all, which
  // useMySchoolRows.tsx's "no return ride needed" check (matched by
  // childId/childEntryId) could never associate with ANY child — so every
  // child appeared to have no return booked, regardless of what was
  // actually selected/entered. Looping over every entry here closes that
  // gap for good, independent of which screen happened to reach this
  // function.
  const createSchoolTripsBookingAfterPayment = async (
    paymentMethod: SchoolBookingPaymentMethod,
  ): Promise<{ bookingGroupId: string }> => {
    if (!schoolTripId) {
      throw new Error(t("rides.missingTripId"));
    }

    const groupId = schoolBookingGroupIdParam || generateBookingGroupId();

    if (schoolChildEntries.length > 0 && schoolDirection === "to_school") {
      await bookOutboundForChildren(
        schoolTripId,
        schoolChildEntries,
        paymentMethod,
        groupId,
        pickupLocation || undefined,
      );
    } else if (schoolChildEntries.length > 0 && schoolDirection === "from_school") {
      for (const entry of schoolChildEntries) {
        // eslint-disable-next-line no-await-in-loop
        await bookReturnForChild(schoolTripId, entry, paymentMethod, groupId);
      }
    } else {
      // pickupLocation is only ever populated (non-null) for the outbound
      // direction — DirectionSearchForm.tsx never sets the pickup params for
      // a standalone return search, so this is a no-op for return bookings.
      await bookSchoolTripSingle(
        schoolTripId,
        selectedSeats,
        paymentMethod,
        groupId,
        undefined,
        pickupLocation || undefined,
      );
    }

    return { bookingGroupId: groupId };
  };

  // Mirrors trip-confirm.tsx's former "book a return too?" prompt — now
  // shown here since it only makes sense once the outbound leg is actually
  // booked, which now happens on THIS screen (AGENTS.md: do not create the
  // booking before payment).
  const handleContinueToSchoolReturn = () => {
    setSchoolAskReturn(false);

    router.push({
      pathname: "/booking/school/trip-results",
      params: {
        direction: "from_school",
        schoolId: String(params.schoolId || ""),
        schoolName,
        schoolAddress: String(params.schoolAddress || ""),
        schoolLat: String(params.schoolLat || ""),
        schoolLng: String(params.schoolLng || ""),
        // Return "From" = the just-booked outbound trip's own "To" area,
        // with the real pickup point being the school itself (AGENTS.md:
        // "Return From area = outbound To area", "... location =
        // schoolLocation").
        fromArea: String(params.outboundToArea || to || ""),
        fromLat: String(params.schoolLat || ""),
        fromLng: String(params.schoolLng || ""),
        toArea: String(params.returnToArea || ""),
        toLat: String(params.returnToLat || ""),
        toLng: String(params.returnToLng || ""),
        date,
        requestedTime: String(params.returnRequestedTime || ""),
        seats: String(selectedSeats),
        roundTrip: "false",
        bookingGroupId: schoolBookedGroupId || "",
        childEntries: String(params.returnChildEntries || ""),
      },
    } as any);
  };

  const handleSkipSchoolReturn = () => {
    setSchoolAskReturn(false);
    Alert.alert(t("common.success"), t("validation.bookingCompleted"));
    router.replace("/(tabs)/bookings" as any);
  };

  const getPassengerProfile = async () => {
    const user = auth.currentUser;

    if (!user) {
      throw new Error(t("auth.pleaseLoginFirst"));
    }

    let passengerName = user.displayName || "Passenger";
    let passengerPhone = "";

    try {
      const userSnap = await getDoc(doc(db, "users", user.uid));

      if (userSnap.exists()) {
        const data = userSnap.data();
        passengerName = data.name || passengerName;
        passengerPhone = data.phone || "";
      }
    } catch {
      // keep auth fallback values
    }

    return { user, passengerName, passengerPhone };
  };

const createBookingAfterPayment = async (
  payment: RidePayment,
) => {
  const { user, passengerName, passengerPhone } = await getPassengerProfile();

  if (!routeId) {
    throw new Error(t("rides.missingTripId"));
  }

  if (!isWeekly && isDateTimeExpired(date, time)) {
    throw new Error(t("rides.rideExpired"));
  }

  const bookingRef = doc(collection(db, "bookings"));
  const routeRef = doc(db, "driverRoutes", routeId);

  const paymentFields =
    payment.method === "cash"
      ? {
          paymentMethod: "cash",
          paymentStatus: "cash_selected",
          cardLast4: null,
        }
      : payment.method === "bit"
        ? {
            paymentMethod: "bit",
            paymentStatus: "mock_paid",
            cardLast4: null,
          }
        : {
            paymentMethod: "card",
            paymentStatus: "mock_paid",
            cardLast4: payment.cardLast4.slice(-4),
          };

  await runTransaction(db, async (transaction) => {
    const routeSnap = await transaction.get(routeRef);

    if (!routeSnap.exists()) {
      throw new Error(t("rides.tripNoLongerAvailable"));
    }

    const routeData = routeSnap.data();

    const alreadyBooked =
      routeData.status === "booked" ||
      routeData.status === "completed" ||
      routeData.tripStatus === "completed" ||
      routeData.isBooked === true ||
      routeData.available === false ||
      !!routeData.bookingId ||
      !!routeData.bookedBy;

    if (alreadyBooked) {
      throw new Error(t("rides.seatAvailabilityChanged"));
    }

    // Re-check the freshest seat capacity read inside this very transaction
    // — a driver could have reduced the route's declared seats between when
    // this screen loaded and when Continue was pressed.
    if (
      typeof routeData.seats === "number" &&
      selectedSeats > routeData.seats
    ) {
      throw new Error(t("rides.notEnoughSeats"));
    }

    transaction.set(bookingRef, {
      category: isSchool ? "school" : RIDE_CATEGORY,

      passengerId: user.uid,
      passengerName,
      passengerPhone,
      passengerEmail: user.email || "",

      driverId: driverId || null,
      driverName: driverName || "Driver",
      driverPhone: driverPhone || "",

      driverCar,
      driverCarColor,
      driverCarPlateLast3,

      routeId,
      from,
      to,
      schoolName: schoolName || null,
      destinationDetails: destinationDetails || null,
      pickupLocation: pickupLocationForWrite,
      ...driverOriginFields,
      date,
      day,
      time,

      // School only — the child(ren) this booking is for, selected up front
      // on select-child.tsx (Home → School Ride) and carried through
      // LegacySchoolSearchForm.tsx/DirectionSearchForm.tsx →
      // driverresults.tsx/trip-confirm.tsx → this screen's own
      // schoolChildEntries (parsed above). Empty/null for Personal Ride and
      // any School booking made before this existed.
      ...(isSchool
        ? {
            childId: schoolChildEntries[0]?.childId || null,
            childName: schoolChildEntries[0]?.childName || null,
            childEntries: schoolChildEntries.length > 0 ? schoolChildEntries : null,
          }
        : {}),

      // This function only ever runs for the non-weekly path (weekly bookings
      // go through createWeeklyBookings instead) — always the passenger's own
      // stepper selection / calculated total, never the old fixed params.
      seats: selectedSeats,
      price: totalPrice,
      pricePerSeat: unitPrice,

      ...paymentFields,

      // مهم جدًا:
      // بعد الدفع الرحلة تكون محجوزة فقط، مش منتهية.
      status: isSchool ? "ongoing" : "booked",
      tripStatus: "booked",
      trackingEnabled: false,

      driverLocation: null,
      driverLocationUpdatedAt: null,

      // مهم جدًا:
      // التقييم ممنوع يطلع بعد الدفع.
      // يصير true فقط لما السائق يكبس End Trip.
      needsPassengerRating: false,
      ratingSubmitted: false,
      rating: null,
      reviewComment: "",
      ratedAt: null,

      finishedByDriver: false,

      roleType: "passenger_booking",
      deletedForPassenger: false,
      deletedForDriver: false,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),

      startedAt: null,
      arrivedAt: null,
      completedAt: null,
    });

    transaction.update(routeRef, {
      status: "booked",
      tripStatus: "booked",
      isBooked: true,
      available: false,
      bookingId: bookingRef.id,
      bookedBy: user.uid,
      bookedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  if (driverId) {
    await notify({
      receiverId: driverId,
      senderId: user.uid,
      type: isSchool ? "school_ride_booking" : "personal_ride_booking",
      title: "New ride booking",
      message: `${passengerName} booked a ride with you (${selectedSeats} seat${
        selectedSeats > 1 ? "s" : ""
      }, ₪${totalPrice})`,
      applicationId: bookingRef.id,
      bookingId: bookingRef.id,
      category: isSchool ? "school" : RIDE_CATEGORY,
      status: "booked",
      targetTab: "driver",
    });
  }

  return bookingRef.id;
};

  const handleContinue = async () => {
    if (!method) {
      Alert.alert(t("rides.choosePaymentTitle"), t("rides.choosePaymentMessage"));
      return;
    }

    // Personal Ride only (never School's own three separate paths, which
    // this same screen also handles below and which this fix doesn't
    // touch) — the driver needs to know where the passenger actually wants
    // to be picked up before this request can go through at all. Defensive:
    // personal-ride/index.tsx's own search form already requires this
    // upstream, but a request reaching this screen without it (a stale deep
    // link, a lost/malformed param) must still be blocked here, not
    // silently booked with no pickup point.
    if (!isSchool && !isReplacementSource && !isSchoolTripsSource && !pickupLocation) {
      Alert.alert(t("auth.missingDetails"), t("pickupLocation.pickupLocationRequired"));
      return;
    }

    const payment: RidePayment =
      method === "cash" ? { method: "cash" } : { method: "bit" };

    if (isReplacementSource) {
      if (!replacementOfferId || !schoolTripId) {
        Alert.alert(t("common.error"), t("rides.missingTripId"));
        return;
      }

      try {
        setProcessing(true);
        await acceptReplacementOffer(replacementOfferId, schoolTripId, method === "bit" ? "bit" : "cash");
        Alert.alert(t("common.success"), t("booking.replacementConfirmed"), [
          { text: t("common.ok"), onPress: () => router.replace("/(tabs)/bookings" as any) },
        ]);
      } catch (error: any) {
        Alert.alert(t("common.error"), error?.message || t("rides.couldNotConfirmBooking"));
      } finally {
        setProcessing(false);
      }

      return;
    }

    if (isSchoolTripsSource) {
      try {
        setProcessing(true);

        const { bookingGroupId: newGroupId } = await createSchoolTripsBookingAfterPayment(
          method === "bit" ? "bit" : "cash",
        );

        if (schoolBookingGroupIdParam) {
          // This WAS the return leg of a round trip already in progress.
          Alert.alert(t("common.success"), t("schoolTrip.roundTripBookedMessage"));
          router.replace("/(tabs)/bookings" as any);
          return;
        }

        if (schoolRoundTrip && schoolDirection === "to_school") {
          setSchoolBookedGroupId(newGroupId);
          setSchoolAskReturn(true);
          return;
        }

        Alert.alert(t("common.success"), t("validation.bookingCompleted"));
        router.replace("/(tabs)/bookings" as any);
      } catch (error: any) {
        // AGENTS.md #9's exact scenario: outbound already booked, and THIS
        // (return-leg) booking just failed — never hide that the outbound
        // booking still went through.
        if (schoolBookingGroupIdParam) {
          Alert.alert(t("common.error"), t("schoolTrip.outboundBookedReturnUnavailable"));
          router.replace("/(tabs)/bookings" as any);
          return;
        }

        Alert.alert(t("common.error"), error?.message || t("rides.couldNotConfirmBooking"));
      } finally {
        setProcessing(false);
      }

      return;
    }

    if (isWeekly) {
      try {
        setProcessing(true);

        await createWeeklyBookings({
          category: isSchool ? "school" : "personal",

          driverId,
          driverName,
          driverPhone,

          driverCar,
          driverCarColor,
          driverCarPlateLast3,

          routeId,
          from,
          to,
          schoolName,
          destinationDetails,
          pickupLocation: pickupLocationForWrite,
          ...driverOriginFields,

          // Same School-only child passthrough as createBookingAfterPayment
          // above — see schoolChildEntries's own comment.
          ...(isSchool
            ? {
                childId: schoolChildEntries[0]?.childId,
                childName: schoolChildEntries[0]?.childName,
                childEntries:
                  schoolChildEntries.length > 0 ? schoolChildEntries : undefined,
              }
            : {}),

          selectedDays: selectedWeeklyDays,
          payment,
        });

        if (remainingWeeklyDays.length > 0) {
          Alert.alert(
            t("rides.someDaysNeedDriverTitle"),
            t("rides.someDaysNeedDriverMessage"),
            [
              {
                text: t("common.ok"),
                onPress: () =>
                  router.replace({
                    pathname: "/booking/driverresults",
                    params: {
                      ...resultsPassthrough,
                      bookingType: "weekly",
                      weeklyDays: JSON.stringify(remainingWeeklyDays),
                    },
                  } as any),
              },
            ],
          );
          return;
        }

        router.replace({
          pathname: "/(tabs)/bookings",
          params: { tab: "passenger" },
        } as any);
      } catch (error: any) {
        Alert.alert(
          t("common.error"),
          error?.message || t("rides.couldNotConfirmBooking"),
        );
      } finally {
        setProcessing(false);
      }

      return;
    }

    try {
      setProcessing(true);
      await createBookingAfterPayment(payment);

      router.replace({
        pathname: "/(tabs)/bookings",
        params: { tab: "passenger" },
      } as any);
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("rides.couldNotConfirmBooking"));
    } finally {
      setProcessing(false);
    }
  };

  if (schoolAskReturn) {
    return (
      <DirectionalScreen style={styles.safe}>
        <View style={styles.askReturnBox}>
          <Ionicons name="help-circle-outline" size={48} color="#F58220" />
          <Text style={styles.askReturnTitle}>{t("schoolTrip.bookReturnQuestion")}</Text>
          <Text style={styles.askReturnSubtitle}>{t("schoolTrip.bookReturnQuestionHint")}</Text>

          <Pressable style={styles.askReturnPrimaryButton} onPress={handleContinueToSchoolReturn}>
            <Text style={styles.askReturnPrimaryText} numberOfLines={1}>
              {t("schoolTrip.bookReturn")}
            </Text>
          </Pressable>

          <Pressable style={styles.askReturnSkipButton} onPress={handleSkipSchoolReturn}>
            <Text style={styles.askReturnSkipText} numberOfLines={1}>
              {t("common.no")}
            </Text>
          </Pressable>
        </View>
      </DirectionalScreen>
    );
  }

  return (
    <DirectionalScreen style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.container}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Ionicons
              name={isRTL ? "arrow-forward" : "arrow-back"}
              size={22}
              color="#7C5F46"
            />
            <Text style={styles.backText}>{t("common.back")}</Text>
          </Pressable>

          <Text style={styles.title}>{t("rides.paymentTitle")}</Text>
          <Text style={styles.subtitle}>{t("rides.paymentSubtitle")}</Text>

          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>
              {isSchool ? t("rides.schoolRide") : t("rides.personalRide")}
            </Text>

            <View style={styles.summaryRow}>
              <Ionicons name="person-outline" size={15} color="#7C5F46" />
              <Text style={styles.summaryText}>
                {t("rides.driverLabel", { name: driverName })}
              </Text>
            </View>

            {driverPhone ? (
              <View style={styles.summaryRow}>
                <Ionicons name="call-outline" size={15} color="#7C5F46" />
                <Text style={[styles.summaryText, ltrContentStyle]}>{driverPhone}</Text>
              </View>
            ) : null}

            {driverCar ? (
              <View style={styles.summaryRow}>
                <Ionicons name="car-outline" size={15} color="#7C5F46" />
                <Text style={styles.summaryText}>
                  {t("rides.carLabel", { car: driverCar })}
                </Text>
              </View>
            ) : null}

            {driverCarColor ? (
              <View style={styles.summaryRow}>
                <Ionicons
                  name="color-palette-outline"
                  size={15}
                  color="#7C5F46"
                />
                <Text style={styles.summaryText}>
                  {t("rides.colorLabel", { color: driverCarColor })}
                </Text>
              </View>
            ) : null}

            {driverCarPlateLast3 ? (
              <View style={styles.summaryRow}>
                <Ionicons name="barcode-outline" size={15} color="#7C5F46" />
                <Text style={styles.summaryText}>
                  {t("rides.plateLabel", { last3: driverCarPlateLast3 })}
                </Text>
              </View>
            ) : null}

            <View style={styles.summaryRow}>
              <Ionicons name="location-outline" size={15} color="#7C5F46" />
              <Text style={styles.summaryText}>
                {from || "?"} → {to || "?"}
              </Text>
            </View>

            {schoolName ? (
              <View style={styles.summaryRow}>
                <Ionicons name="school-outline" size={15} color="#7C5F46" />
                <Text style={styles.summaryText}>{schoolName}</Text>
              </View>
            ) : null}

            {destinationDetails ? (
              <View style={styles.summaryRow}>
                <Ionicons name="flag-outline" size={15} color="#7C5F46" />
                <Text style={styles.summaryText}>{destinationDetails}</Text>
              </View>
            ) : null}

            {!isWeekly && date ? (
              <View style={styles.summaryRow}>
                <Ionicons name="calendar-outline" size={15} color="#7C5F46" />
                <Text style={styles.summaryText}>
                  {date}
                  {day ? ` (${day})` : ""}
                </Text>
              </View>
            ) : null}

            {!isWeekly && time ? (
              <View style={styles.summaryRow}>
                <Ionicons name="time-outline" size={15} color="#7C5F46" />
                <Text style={styles.summaryText}>{time}</Text>
              </View>
            ) : null}

            {isWeekly ? (
              <View style={styles.weeklyDaysBox}>
                <Text style={styles.weeklyDaysTitle}>{t("rides.selectedDays")}</Text>

                {selectedWeeklyDays.map((dayItem) => (
                  <View key={dayItem.date} style={styles.weeklyDayRow}>
                    <Ionicons
                      name="calendar-outline"
                      size={15}
                      color="#7C5F46"
                    />
                    <Text style={styles.summaryText}>
                      {translateStoredDayName(dayItem.dayName, t)} —{" "}
                      {dayItem.date} · {dayItem.time} ·{" "}
                      {t("booking.seatsCount", { count: dayItem.seats })} ·{" "}
                      {dayItem.price} ₪
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.amountRow}>
              <Text style={styles.amountLabel}>{t("rides.amount")}</Text>
              <Text style={styles.amountValue}>
                {isWeekly ? `${weeklyTotal} ₪` : `${totalPrice} ₪`}
              </Text>
            </View>

            {isWeekly ? (
              <Text style={styles.weeklyHint}>{t("rides.weeklyCardHint")}</Text>
            ) : null}
          </View>

          {!isWeekly ? (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>{t("rides.numberOfSeats")}</Text>

              {isAnySchoolTripsSource ? (
                // Locked — this count was already fixed on trip-confirm.tsx
                // (the child roster's size, or the passenger's own choice
                // there — AGENTS.md's "one seat = one child" invariant must
                // never be broken by a second, independent stepper here).
                <Text style={styles.seatAvailableHint}>
                  {t("schoolTrip.oneSeatPerChild", { count: selectedSeats })}
                </Text>
              ) : (
                <>
                  <View style={styles.seatStepperRow}>
                    <Pressable
                      style={[
                        styles.seatButton,
                        selectedSeats <= 1 && styles.seatButtonDisabled,
                      ]}
                      onPress={decreaseSeats}
                      disabled={selectedSeats <= 1}
                      hitSlop={8}
                    >
                      <Ionicons
                        name="remove"
                        size={20}
                        color={selectedSeats <= 1 ? "#C9BBAE" : "#111827"}
                      />
                    </Pressable>

                    <Text style={styles.seatCountText}>{selectedSeats}</Text>

                    <Pressable
                      style={[
                        styles.seatButton,
                        selectedSeats >= maxSeatsValue && styles.seatButtonDisabled,
                      ]}
                      onPress={increaseSeats}
                      disabled={selectedSeats >= maxSeatsValue}
                      hitSlop={8}
                    >
                      <Ionicons
                        name="add"
                        size={20}
                        color={selectedSeats >= maxSeatsValue ? "#C9BBAE" : "#111827"}
                      />
                    </Pressable>
                  </View>

                  <Text style={styles.seatAvailableHint}>
                    {t("rides.seatsAvailableCount", { count: maxSeatsValue })}
                  </Text>
                </>
              )}

              <View style={styles.priceSummaryBox}>
                <Text style={styles.priceSummaryTitle}>
                  {t("rides.paymentSummary")}
                </Text>

                <View style={styles.priceSummaryRow}>
                  <Text style={styles.priceSummaryLabel}>
                    {t("rides.pricePerSeat")}
                  </Text>
                  <Text style={styles.priceSummaryValue}>₪{unitPrice}</Text>
                </View>

                <View style={styles.priceSummaryRow}>
                  <Text style={styles.priceSummaryLabel}>
                    {t("rides.numberOfSeats")}
                  </Text>
                  <Text style={styles.priceSummaryValue}>{selectedSeats}</Text>
                </View>

                <View style={[styles.priceSummaryRow, styles.priceSummaryTotalRow]}>
                  <Text style={styles.priceSummaryTotalLabel}>
                    {t("rides.totalPrice")}
                  </Text>
                  <Text style={styles.priceSummaryTotalValue}>
                    ₪{totalPrice}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>Payment Method</Text>

          <View style={styles.methodRow}>
            <Pressable
              style={[
                styles.methodCard,
                method === "cash" && styles.methodCardActive,
              ]}
              onPress={() => setMethod("cash")}
            >
              <Ionicons
                name="cash-outline"
                size={26}
                color={method === "cash" ? "#F58220" : "#7C5F46"}
              />
              <Text
                style={[
                  styles.methodText,
                  method === "cash" && styles.methodTextActive,
                ]}
              >
                {t("common.cash")}
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.methodCard,
                method === "bit" && styles.methodCardActive,
              ]}
              onPress={handleSelectBit}
            >
              <BitBadge size={26} />
              <Text
                style={[
                  styles.methodText,
                  method === "bit" && styles.methodTextActive,
                ]}
              >
                {t("rides.payWithBit")}
              </Text>
            </Pressable>
          </View>

          {method === "cash" ? (
            <View style={styles.infoBox}>
              <Ionicons
                name="information-circle-outline"
                size={18}
                color="#B86115"
              />
              <Text style={styles.infoText}>{t("rides.cashInfoText")}</Text>
            </View>
          ) : null}

          {method === "bit" ? (
            <View style={styles.cardForm}>
              {/* Receiver info — who you're paying, their number, and how
                  much — shown above the action button. */}
              <View style={styles.bitReceiverBox}>
                <View style={styles.summaryRow}>
                  <Ionicons name="person-outline" size={15} color="#7C5F46" />
                  <Text style={styles.summaryText}>{driverName}</Text>
                </View>

                {driverPhone ? (
                  <View style={styles.summaryRow}>
                    <Ionicons name="call-outline" size={15} color="#7C5F46" />
                    <Text style={[styles.summaryText, ltrContentStyle]}>{driverPhone}</Text>
                  </View>
                ) : null}

                <View style={styles.summaryRow}>
                  <Ionicons name="cash-outline" size={15} color="#7C5F46" />
                  <Text style={styles.summaryText}>
                    {isWeekly
                      ? `${weeklyTotal} ₪`
                      : price !== null
                        ? `${price} ₪`
                        : "—"}
                  </Text>
                </View>
              </View>

              <Pressable
                style={styles.openBitButton}
                onPress={handleOpenBitAndCopy}
              >
                <Ionicons name="open-outline" size={16} color="#FFFFFF" />
                <Text style={styles.openBitButtonText}>
                  {t("bitPayment.openBitAndCopy")}
                </Text>
              </Pressable>
            </View>
          ) : null}

          <Pressable
            style={[
              styles.continueButton,
              (!method || processing) && styles.continueDisabled,
            ]}
            onPress={handleContinue}
            disabled={!method || processing}
          >
            {processing ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.continueText}>{t("common.continue")}</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </DirectionalScreen>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  container: {
    padding: 20,
    paddingTop: 50,
    paddingBottom: 40,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 16,
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
  },
  subtitle: {
    color: "#7C5F46",
    fontSize: 14,
    marginTop: 6,
    marginBottom: 22,
  },
  summaryCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 18,
    padding: 18,
    marginBottom: 22,
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  summaryText: {
    color: "#3C2319",
    fontSize: 14,
    fontWeight: "700",
    flexShrink: 1,
  },
  weeklyDaysBox: {
    marginTop: 4,
    marginBottom: 4,
    gap: 6,
  },
  weeklyDaysTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 2,
  },
  weeklyDayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  weeklyHint: {
    color: "#7C5F46",
    fontSize: 12,
    marginTop: 8,
  },
  amountRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#F0E5DC",
  },
  amountLabel: {
    color: "#7C5F46",
    fontWeight: "800",
    fontSize: 15,
  },
  amountValue: {
    color: "#F58220",
    fontWeight: "900",
    fontSize: 20,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 12,
  },
  seatStepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
    marginTop: 4,
    marginBottom: 10,
  },
  seatButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    backgroundColor: "#FFFDFC",
    alignItems: "center",
    justifyContent: "center",
  },
  seatButtonDisabled: {
    opacity: 0.5,
  },
  seatCountText: {
    fontSize: 26,
    fontWeight: "900",
    color: "#111827",
    minWidth: 40,
    textAlign: "center",
  },
  seatAvailableHint: {
    textAlign: "center",
    color: "#7C5F46",
    fontSize: 12.5,
    fontWeight: "700",
    marginBottom: 16,
  },
  priceSummaryBox: {
    backgroundColor: "#FFF8F2",
    borderWidth: 1,
    borderColor: "#F0DFC8",
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  priceSummaryTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 4,
  },
  priceSummaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  priceSummaryLabel: {
    color: "#7C5F46",
    fontSize: 13.5,
    fontWeight: "700",
  },
  priceSummaryValue: {
    color: "#111827",
    fontSize: 13.5,
    fontWeight: "900",
  },
  priceSummaryTotalRow: {
    borderTopWidth: 1,
    borderTopColor: "#F0DFC8",
    paddingTop: 8,
    marginTop: 2,
  },
  priceSummaryTotalLabel: {
    color: "#111827",
    fontSize: 15,
    fontWeight: "900",
  },
  priceSummaryTotalValue: {
    color: "#F58220",
    fontSize: 17,
    fontWeight: "900",
  },
  methodRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  methodCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "#E7DCD1",
    borderRadius: 16,
    paddingVertical: 22,
    alignItems: "center",
    gap: 8,
  },
  methodCardActive: {
    borderColor: "#F58220",
    backgroundColor: "#FFF8F2",
  },
  methodText: {
    fontWeight: "900",
    color: "#7C5F46",
    fontSize: 15,
  },
  methodTextActive: {
    color: "#F58220",
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFF2E8",
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  infoText: {
    color: "#B86115",
    fontWeight: "700",
    fontSize: 13,
    flexShrink: 1,
  },
  cardForm: {
    marginBottom: 8,
  },
  bitReceiverBox: {
    backgroundColor: "#FFFDFC",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  openBitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    // BIT's own brand teal (matches BitBadge) — kept visually distinct from
    // the orange Continue button below so the two actions aren't confused.
    backgroundColor: "#00B2A9",
    borderRadius: 10,
    paddingVertical: 14,
    marginBottom: 10,
  },
  openBitButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
  },
  continueButton: {
    backgroundColor: "#F58220",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 14,
  },
  continueDisabled: {
    opacity: 0.5,
  },
  continueText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 16,
  },
  askReturnBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 30,
    gap: 8,
  },
  askReturnTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: "#111827",
    textAlign: "center",
    marginTop: 8,
  },
  askReturnSubtitle: {
    fontSize: 14,
    color: "#7C5F46",
    textAlign: "center",
    marginBottom: 18,
  },
  // Both buttons deliberately stretch to the full width of askReturnBox
  // (which supplies the outer 30px horizontal margin) — askReturnBox's own
  // `alignItems: "center"` would otherwise shrink-wrap each button to its
  // own text, which is what made "Book a return ride" look cramped (no
  // horizontal padding + no explicit width to center that padding within).
  askReturnPrimaryButton: {
    alignSelf: "stretch",
    backgroundColor: "#F58220",
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  askReturnPrimaryText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 16,
    textAlign: "center",
  },
  askReturnSkipButton: {
    alignSelf: "stretch",
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  askReturnSkipText: {
    color: "#7C5F46",
    fontWeight: "800",
    fontSize: 15,
    textAlign: "center",
  },
});
