import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import MapView, { Marker } from "react-native-maps";

import { useTranslation } from "react-i18next";

import { auth, db } from "../../firebase";
import { canStartTrip, getStartTripBlockedReason } from "../booking/bookingsLib";
import {
  captureDriverLocationOnce,
  startDriverLocationTracking,
  stopDriverLocationTracking,
} from "../driverLocationTask";
import { normalizeRideBooking, RideBooking } from "../booking/rideBookingLib";
import {
  normalizeSchoolBooking,
  normalizeSchoolTrip,
  SCHOOL_BOOKINGS_COLLECTION,
  SCHOOL_TRIPS_COLLECTION,
  SchoolBooking,
  TRIP_LOCATIONS_COLLECTION,
  verifyPassengerCodeAndStartTrip,
} from "../booking/schoolTripsLib";
import { notify } from "../booking/work-errand/workErrandLib";
import i18n from "../i18n";
import { normalizeToWesternDigits } from "../i18n/digits";
import { useLanguage } from "../i18n/LanguageProvider";
import { getUserLanguage } from "../i18n/userLanguage";

type TripStatus =
  | "booked"
  | "driver_on_way"
  | "arrived_pickup"
  | "in_progress"
  | "completed";

const getTripStatus = (booking: any): TripStatus => {
  if (booking?.tripStatus) return booking.tripStatus;
  if (booking?.status === "completed") return "completed";
  if (booking?.status === "arrived") return "arrived_pickup";
  return "booked";
};

// Personal Ride: live tracking starts as soon as the driver arrives for
// pickup (there is no verification-code step for this trip type) and stays
// on until Finish Trip. School Trips uses its own condition instead — see
// anySchoolPassengerInProgress below (only after a passenger's code is
// verified, never merely at arrival).
const shouldTrackDriver = (status: TripStatus) => {
  return status === "arrived_pickup";
};

export default function RideNavigationScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const params = useLocalSearchParams();
  const id = typeof params.id === "string" ? params.id : "";

  // A school trip (AGENTS.md's trip-lifecycle feature) is one car shared by
  // several independent SchoolBooking docs, so this screen operates on the
  // schoolTrips/{id} doc itself here (id = tripId, not a booking id) rather
  // than a single passenger's booking — see updateTripStatus's batch sync
  // below for how each passenger's own booking stays in step.
  const source = String(params.source || "");
  const isSchoolTripsSource = source === "schoolTrips";
  const bookingCollection = isSchoolTripsSource ? SCHOOL_TRIPS_COLLECTION : "bookings";

  const [booking, setBooking] = useState<RideBooking | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Every still-booked passenger on this trip (AGENTS.md's passenger
  // verification feature) — one schoolTrips doc can carry several
  // independent SchoolBooking docs, so this is its own subscription rather
  // than a field on `booking` itself.
  const [schoolPassengerBookings, setSchoolPassengerBookings] = useState<SchoolBooking[]>([]);
  const [verifyModalBooking, setVerifyModalBooking] = useState<SchoolBooking | null>(null);
  const [verifyCodeInput, setVerifyCodeInput] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }

    const unsub = onSnapshot(
      doc(db, bookingCollection, id),
      (snap) => {
        if (snap.exists()) {
          const rawData = snap.data();

          const normalized = isSchoolTripsSource
            ? {
                ...(normalizeSchoolTrip(snap.id, rawData) as any),
                // Field-name aliases so every generic (booking as any).xxx
                // read below (from/to/time, shared with Personal Ride)
                // resolves correctly against a SchoolTrip's own field names.
                from: rawData.fromAddress,
                to: rawData.toAddress,
                time: rawData.departureTime,
              }
            : (normalizeRideBooking(snap.id, rawData) as any);

          setBooking({
            ...normalized,
            ...rawData,
            id: snap.id,
          } as RideBooking);
        }

        setLoading(false);
      },
      () => setLoading(false),
    );

    return unsub;
  }, [id]);

  // The driver's own live location, read back from the SAME tripLocations
  // doc driverLocationTask.ts writes to — confirms the round-trip actually
  // worked and drives this screen's own map marker, instead of a second,
  // separate device-local coordinate source.
  const [liveDriverLocation, setLiveDriverLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  useEffect(() => {
    if (!id) {
      setLiveDriverLocation(null);
      return;
    }

    const unsub = onSnapshot(
      doc(db, TRIP_LOCATIONS_COLLECTION, id),
      (snap) => {
        const data = snap.data();
        const lat = Number(data?.latitude);
        const lng = Number(data?.longitude);

        setLiveDriverLocation(Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : null);
      },
      (error) => {
        console.log("Listener failed:", {
          feature: "ride-navigation.tripLocations",
          collection: TRIP_LOCATIONS_COLLECTION,
          docId: id,
          code: error.code,
          message: error.message,
        });
        setLiveDriverLocation(null);
      },
    );

    return unsub;
  }, [id]);

  useEffect(() => {
    if (!id || !isSchoolTripsSource || !auth.currentUser) {
      setSchoolPassengerBookings([]);
      return;
    }

    // The schoolBookings read rule only allows resource.data.driverId ==
    // request.auth.uid (or passengerId) — a query can only be granted if
    // its OWN where() filters prove every possible result satisfies that,
    // so this must filter by driverId itself, not just tripId/status
    // (Firestore statically rejects a query it can't prove safe, even when
    // every actual result would have passed the rule at read time).
    const unsub = onSnapshot(
      query(
        collection(db, SCHOOL_BOOKINGS_COLLECTION),
        where("tripId", "==", id),
        where("driverId", "==", auth.currentUser.uid),
        where("status", "==", "booked"),
      ),
      (snap) => {
        setSchoolPassengerBookings(snap.docs.map((d) => normalizeSchoolBooking(d.id, d.data())));
      },
      (error) => {
        console.log("Listener failed:", {
          feature: "ride-navigation.schoolPassengerBookings",
          collection: SCHOOL_BOOKINGS_COLLECTION,
          tripId: id,
          code: error.code,
          message: error.message,
        });
        setSchoolPassengerBookings([]);
      },
    );

    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isSchoolTripsSource]);

  // Passengers still waiting on their own verify-and-start step — this is
  // what gates Finish Trip (never the old "verificationStatus" alone, since
  // a booking can only be considered actually picked up once its own
  // tripStatus has reached "in_progress").
  const unstartedPassengerCount = schoolPassengerBookings.filter(
    (b) => b.tripStatus !== "in_progress",
  ).length;

  // At least one passenger has been verified and their own trip started —
  // this (never "arrived_pickup" alone) is what's allowed to turn on the
  // driver's live location broadcast, per AGENTS.md.
  const anySchoolPassengerInProgress = schoolPassengerBookings.some(
    (b) => b.tripStatus === "in_progress",
  );

  const openVerifyModal = (passengerBooking: SchoolBooking) => {
    setVerifyModalBooking(passengerBooking);
    setVerifyCodeInput("");
  };

  const closeVerifyModal = () => {
    setVerifyModalBooking(null);
    setVerifyCodeInput("");
  };

  const handleSubmitVerification = async () => {
    if (!verifyModalBooking || verifying) return;

    setVerifying(true);
    try {
      const { started, booking: startedBooking } = await verifyPassengerCodeAndStartTrip(
        verifyModalBooking.id,
        verifyCodeInput.trim(),
      );

      Alert.alert(t("common.success"), t("booking.verificationSuccessful"));
      closeVerifyModal();

      if (!started) return;

      // The tracking effect below picks this up automatically as soon as
      // schoolPassengerBookings reflects the now-"in_progress" booking (its
      // own onSnapshot fires right after this transaction commits) — never
      // at "I arrived" itself, only from here on.

      if (startedBooking.passengerId) {
        const passengerLanguage = await getUserLanguage(startedBooking.passengerId);
        const tPassenger = i18n.getFixedT(passengerLanguage);

        await notify({
          receiverId: startedBooking.passengerId,
          type: "trip_started",
          title: tPassenger("notifications.tripStartedTitle"),
          message: tPassenger("notifications.tripStartedMessage"),
          // Mirrors the "school_trip_match" convention (bookingId holds the
          // TRIP id) so tapping this notification can open Live Tracking
          // directly via source=schoolTrips — see notifications.tsx.
          applicationId: startedBooking.tripId,
          bookingId: startedBooking.tripId,
          category: "school",
          status: "in_progress",
          targetTab: "passenger",
        });
      }
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("booking.invalidVerificationCode"));
    } finally {
      setVerifying(false);
    }
  };

  // Exact GPS pickup point, if the passenger captured one — checked across
  // every field name this has ever been saved under. This is completely
  // separate from booking.from/to (the manual matching fields).
  const coords = (b: any) => {
    const lat =
      b?.pickupLatitude ??
      b?.pickup?.latitude ??
      b?.pickupCoords?.latitude ??
      b?.pickupLocation?.latitude ??
      b?.passengerPickupLocation?.latitude ??
      // A school trip's own "From" GPS point — the pickup spot for this
      // trip (child's home for an outbound trip, the school itself for a
      // return trip — see SchoolTrip.fromLocation's own comment).
      b?.fromLocation?.latitude;
    const lng =
      b?.pickupLongitude ??
      b?.pickup?.longitude ??
      b?.pickupCoords?.longitude ??
      b?.pickupLocation?.longitude ??
      b?.passengerPickupLocation?.longitude ??
      b?.fromLocation?.longitude;

    if (typeof lat !== "number" || typeof lng !== "number") return null;

    return { lat, lng };
  };

  // The exact readable address, if one was captured (independent of the
  // coordinates above — used only as a last-resort navigation target).
  const pickupAddressText = (b: any): string =>
    b?.pickupAddress || b?.pickup?.address || b?.passengerPickupLocation?.address || "";

  // Navigation destination with the exact fallback chain: precise
  // coordinates -> exact pickup address text -> manual From address. This
  // is ONLY for guiding the driver to the passenger — never used to decide
  // which drivers a passenger sees (that's from/to matching, elsewhere).
  type NavTarget =
    | { kind: "coords"; lat: number; lng: number }
    | { kind: "text"; text: string }
    | null;

  const getNavTarget = (b: any): NavTarget => {
    const c = coords(b);
    if (c) return { kind: "coords", lat: c.lat, lng: c.lng };

    const address = pickupAddressText(b);
    if (address) return { kind: "text", text: address };

    if (b?.from) return { kind: "text", text: b.from };

    return null;
  };

  // Which tripLocations/{targetId} doc this device should be writing to —
  // tripId (School Trips, one shared car) or bookingId (Personal Ride, 1:1)
  // — see driverLocationTask.ts / firestore.rules for why this is its own
  // collection rather than a field on this trip/booking doc.
  const getTrackingTarget = () => {
    const driverId = (booking as any)?.driverId;
    if (!id || !driverId) return null;

    return isSchoolTripsSource
      ? { targetId: id, driverId }
      : { targetId: id, driverId, passengerId: (booking as any)?.passengerId };
  };

  useEffect(() => {
    if (!booking || !id) return;

    const tripStatus = getTripStatus(booking);

    // Personal Ride: live location updates run while the driver has arrived
    // for pickup, up until Finish Trip (unchanged — there is no passenger
    // verification step for Personal Ride).
    //
    // School Trips: must NOT start merely because the driver pressed "I
    // arrived" — only once at least one passenger's code has been verified
    // and their own booking has actually reached "in_progress" (see
    // verifyPassengerCodeAndStartTrip in schoolTripsLib.ts).
    const shouldTrack = isSchoolTripsSource
      ? anySchoolPassengerInProgress
      : tripStatus === "arrived_pickup";

    if (!shouldTrack) return;

    const target = getTrackingTarget();
    if (!target) return;

    // startDriverLocationTracking is idempotent for the same target (and
    // internally guarantees only one background registration ever exists),
    // so re-running this on every relevant state change — including this
    // screen simply remounting after the app was relaunched mid-trip — is
    // always safe. Deliberately NO cleanup/stop here: background tracking
    // must keep running even if this screen unmounts (driver navigates
    // away, backgrounds the app, locks the phone) — only an explicit status
    // transition (Finish Trip below) or sign-out stops it.
    captureDriverLocationOnce(target);
    startDriverLocationTracking(target).then((result) => {
      if (!result.started) {
        Alert.alert(t("booking.locationPermissionTitle"), t("booking.allowLocationForTracking"));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, booking, isSchoolTripsSource, anySchoolPassengerInProgress]);

  const updateTripStatus = async (nextStatus: TripStatus) => {
    if (!id || !booking) return;

    // Guard the actual write, not just the button — this is the one place
    // that flips tripStatus to driver_on_way for school + weekly bookings
    // reached through this screen, so it must never allow starting a trip
    // outside its own trip date even if this gets called some other way.
    if (nextStatus === "driver_on_way" && !canStartTrip(booking)) {
      Alert.alert(
        t("booking.notAvailableYetTitle"),
        getStartTripBlockedReason(booking) ||
          t("booking.startTripOnlyOnTripDate"),
      );
      return;
    }

    if (isSchoolTripsSource) {
      await updateSchoolTripStatus(nextStatus);
      return;
    }

    const payload: any = {
      tripStatus: nextStatus,
      updatedAt: serverTimestamp(),
    };

    if (nextStatus === "driver_on_way") {
      payload.status = "on_the_way";
      payload.trackingEnabled = false;
      payload.needsPassengerRating = false;
      payload.driverOnWayAt = serverTimestamp();
    }

    if (nextStatus === "arrived_pickup") {
      payload.status = "arrived";
      payload.trackingEnabled = true;
      payload.needsPassengerRating = false;
      payload.arrivedPickupAt = serverTimestamp();
    }

    if (nextStatus === "completed") {
      payload.status = "completed";
      payload.tripStatus = "completed";
      payload.trackingEnabled = false;
      payload.completedAt = serverTimestamp();
      payload.finishedByDriver = true;

      // The rating popup only appears for the passenger after Finish Trip.
      payload.needsPassengerRating = true;
      payload.ratingSubmitted = false;
      payload.rating = null;
      payload.reviewComment = "";
    }

    await updateDoc(doc(db, "bookings", id), payload);

    if (nextStatus === "completed" && (booking as any)?.routeId) {
      await updateDoc(doc(db, "driverRoutes", (booking as any).routeId), {
        status: "completed",
        tripStatus: "completed",
        available: false,
        isBooked: true,
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    if (nextStatus === "completed") {
      await stopDriverLocationTracking();
    }

    const passengerId = (booking as any).passengerId;
    const category = (booking as any).category || "personal_ride";

    if (passengerId && nextStatus === "driver_on_way") {
      await notify({
        receiverId: passengerId,
        type: "ride_on_the_way",
        title: "Driver on the way",
        message: "Your driver is on the way",
        applicationId: id,
        bookingId: id,
        category,
        status: "on_the_way",
        targetTab: "passenger",
      });
    }

    if (passengerId && nextStatus === "arrived_pickup") {
      await notify({
        receiverId: passengerId,
        type: "ride_arrived",
        title: "Driver arrived",
        message: "Your driver has arrived",
        applicationId: id,
        bookingId: id,
        category,
        status: "arrived",
        targetTab: "passenger",
      });
    }

    if (passengerId && nextStatus === "completed") {
      await notify({
        receiverId: passengerId,
        type: "ride_trip_completed",
        title: "Trip completed",
        message: "Your trip is completed. Please rate your driver.",
        applicationId: id,
        bookingId: id,
        category,
        status: "completed",
        targetTab: "passenger",
      });
    }
  };

  // A school trip's own tripStatus/trackingEnabled/driverLocation live on
  // the schoolTrips/{id} doc (see the top-of-file comment — one car, shared
  // by several independent SchoolBooking docs), so this both (a) writes the
  // trip doc itself and (b) batch-syncs every still-booked schoolBookings
  // doc for this trip so each passenger's own card reflects the same
  // progress from a single subscription, without a second live read. Never
  // a second start/arrive/finish implementation — same transitions,
  // same notify() calls, just fanned out to N passengers instead of 1.
  const updateSchoolTripStatus = async (nextStatus: TripStatus) => {
    const tripPayload: any = {
      tripStatus: nextStatus,
      updatedAt: serverTimestamp(),
    };

    if (nextStatus === "driver_on_way") {
      tripPayload.trackingEnabled = false;
      tripPayload.driverOnWayAt = serverTimestamp();
    }

    if (nextStatus === "arrived_pickup") {
      // Arriving only unlocks the per-passenger verify-and-start step below
      // (see the passengersBox UI) — it must NOT switch on location
      // broadcasting by itself. trackingEnabled only flips true once
      // driverLocationTask.ts actually starts sending updates, which only
      // happens after a passenger is verified.
      tripPayload.trackingEnabled = false;
      tripPayload.arrivedPickupAt = serverTimestamp();
    }

    if (nextStatus === "completed") {
      tripPayload.trackingEnabled = false;
      tripPayload.finishedByDriver = true;
      tripPayload.completedAt = serverTimestamp();
      // Hides it from future searches/matching the same way a driver's own
      // Cancel does (findMatchingSchoolTrips filters status=="active").
      tripPayload.status = "completed";
    }

    await updateDoc(doc(db, SCHOOL_TRIPS_COLLECTION, id), tripPayload);

    if (nextStatus === "completed") {
      await stopDriverLocationTracking();
    }

    // Same driverId-filter requirement as the schoolPassengerBookings
    // subscription above — see its comment.
    const bookingsSnap = await getDocs(
      query(
        collection(db, SCHOOL_BOOKINGS_COLLECTION),
        where("tripId", "==", id),
        where("driverId", "==", auth.currentUser?.uid || ""),
        where("status", "==", "booked"),
      ),
    );

    if (!bookingsSnap.empty) {
      const batch = writeBatch(db);

      bookingsSnap.docs.forEach((bookingSnap) => {
        const bookingPayload: any = {
          tripStatus: nextStatus,
          updatedAt: serverTimestamp(),
        };

        if (nextStatus === "completed") {
          bookingPayload.status = "completed";
          bookingPayload.finishedByDriver = true;
          bookingPayload.needsPassengerRating = true;
          bookingPayload.ratingSubmitted = false;
          bookingPayload.rating = null;
        }

        batch.update(bookingSnap.ref, bookingPayload);
      });

      await batch.commit();
    }

    // One notification per BOOKING (not per unique passenger) — a parent
    // with several children on this trip gets one message per child, each
    // naming that child, exactly like every other school notification in
    // this app (see schoolTripsLib.ts's tripMatchFoundForChildMessage).
    const notifyType =
      nextStatus === "driver_on_way"
        ? "ride_on_the_way"
        : nextStatus === "arrived_pickup"
          ? "ride_arrived"
          : nextStatus === "completed"
            ? "ride_trip_completed"
            : null;

    if (!notifyType) return;

    await Promise.all(
      bookingsSnap.docs.map(async (bookingSnap) => {
        const passengerBooking = normalizeSchoolBooking(bookingSnap.id, bookingSnap.data());
        if (!passengerBooking.passengerId) return;

        const childSuffix = passengerBooking.childName ? ` (${passengerBooking.childName})` : "";
        const message =
          nextStatus === "driver_on_way"
            ? `Your driver is on the way${childSuffix}`
            : nextStatus === "arrived_pickup"
              ? `Your driver has arrived${childSuffix}`
              : `Your trip is completed. Please rate your driver.${childSuffix}`;

        await notify({
          receiverId: passengerBooking.passengerId,
          type: notifyType,
          title:
            nextStatus === "driver_on_way"
              ? "Driver on the way"
              : nextStatus === "arrived_pickup"
                ? "Driver arrived"
                : "Trip completed",
          message,
          applicationId: id,
          bookingId: bookingSnap.id,
          category: "school",
          status:
            nextStatus === "driver_on_way"
              ? "on_the_way"
              : nextStatus === "arrived_pickup"
                ? "arrived"
                : "completed",
          targetTab: "passenger",
        });
      }),
    );
  };

  const openMaps = (b: RideBooking) => {
    const target = getNavTarget(b);

    if (!target) {
      Alert.alert(t("booking.locationLabel"), t("booking.pickupLocationNotAvailable"));
      return;
    }

    const url =
      target.kind === "coords"
        ? `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}`
        : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(target.text)}`;

    Linking.openURL(url).catch(() =>
      Alert.alert(t("common.error"), t("booking.couldNotOpenMaps")),
    );
  };

  const openWaze = (b: RideBooking) => {
    const target = getNavTarget(b);

    if (!target) {
      Alert.alert(t("booking.locationLabel"), t("booking.pickupLocationNotAvailable"));
      return;
    }

    const url =
      target.kind === "coords"
        ? `https://waze.com/ul?ll=${target.lat},${target.lng}&navigate=yes`
        : `https://waze.com/ul?q=${encodeURIComponent(target.text)}&navigate=yes`;

    Linking.openURL(url).catch(() =>
      Alert.alert(t("common.error"), t("booking.couldNotOpenWaze")),
    );
  };

  const handleStartDriving = () => {
    if (!booking || !canStartTrip(booking)) {
      Alert.alert(
        t("booking.notAvailableYetTitle"),
        getStartTripBlockedReason(booking) ||
          t("booking.startTripOnlyOnTripDate"),
      );
      return;
    }

    Alert.alert(t("booking.startDrivingTitle"), t("booking.startDrivingToPickupConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("booking.startButton"),
        onPress: async () => {
          try {
            setBusy(true);
            await updateTripStatus("driver_on_way");
          } catch (error: any) {
            Alert.alert(t("common.error"), error?.message || t("booking.couldNotUpdate"));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const handleArrived = () => {
    Alert.alert(t("booking.confirmArrivalTitle"), t("booking.confirmArrivalMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("booking.iArrivedButton"),
        onPress: async () => {
          try {
            setBusy(true);
            await updateTripStatus("arrived_pickup");
          } catch (error: any) {
            Alert.alert(t("common.error"), error?.message || t("booking.couldNotUpdate"));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const handleFinishTrip = () => {
    // Every still-booked passenger must have been verified and actually
    // started (tripStatus "in_progress") before the trip can finish — no
    // manual override exists in this app today, so this is a hard block
    // rather than a warning.
    if (isSchoolTripsSource && unstartedPassengerCount > 0) {
      Alert.alert(t("common.error"), t("booking.verificationRequiredBeforeStart"));
      return;
    }

    Alert.alert(
      t("booking.finishTripTitle"),
      t("booking.finishTripConfirmMessage"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("booking.finishTripTitle"),
          style: "destructive",
          onPress: async () => {
            try {
              setBusy(true);
              await updateTripStatus("completed");
            } catch (error: any) {
              Alert.alert(t("common.error"), error?.message || t("booking.couldNotUpdate"));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#F58220" />
        </View>
      </SafeAreaView>
    );
  }

  if (!booking) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={44} color="#8B7B6B" />
          <Text style={styles.emptyTitle}>{t("rides.bookingNotFound")}</Text>
          <Pressable style={styles.backLink} onPress={() => router.back()}>
            <Text style={styles.backLinkText}>{t("common.goBack")}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const c = coords(booking);
  const driverLocation = liveDriverLocation;
  const tripStatus = getTripStatus(booking);
  const completed = tripStatus === "completed";
  const canStart = canStartTrip(booking);
  const blockedReason = getStartTripBlockedReason(booking);

  const mapCenter = driverLocation
    ? {
        latitude: driverLocation.latitude,
        longitude: driverLocation.longitude,
      }
    : c
      ? {
          latitude: c.lat,
          longitude: c.lng,
        }
      : null;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name={isRTL ? "arrow-forward" : "arrow-back"} size={22} color="#7C5F46" />
          <Text style={styles.backText}>{t("common.back")}</Text>
        </Pressable>

        <View style={styles.header}>
          <Ionicons name="navigate" size={26} color="#F58220" />
          <Text style={styles.title}>{t("booking.rideNavigationTitle")}</Text>
        </View>

        <View style={styles.statusBox}>
          <Ionicons name="radio-outline" size={18} color="#F58220" />
          <Text style={styles.statusText}>
            {tripStatus === "booked" && t("booking.statusBookedNotStarted")}
            {tripStatus === "driver_on_way" && t("booking.statusDriverOnWayToPickup")}
            {tripStatus === "arrived_pickup" && t("booking.statusArrivedAtPickup")}
            {tripStatus === "completed" && t("booking.statusTripCompleted")}
          </Text>
        </View>

        {mapCenter ? (
          <View style={styles.mapWrapper}>
            <MapView
              style={styles.map}
              region={{
                latitude: mapCenter.latitude,
                longitude: mapCenter.longitude,
                latitudeDelta: 0.02,
                longitudeDelta: 0.02,
              }}
            >
              {c ? (
                <Marker
                  coordinate={{ latitude: c.lat, longitude: c.lng }}
                  title={
                    isSchoolTripsSource
                      ? (booking as any).schoolName
                      : (booking as any).passengerName
                  }
                  description={t("booking.pickupLocationLabel")}
                  pinColor="#F58220"
                />
              ) : null}

              {driverLocation ? (
                <Marker
                  coordinate={driverLocation}
                  title={t("booking.yourLocationLabel")}
                  description={t("booking.liveDriverLocation")}
                >
                  <View style={styles.driverMarker}>
                    <Ionicons name="car" size={18} color="#FFFFFF" />
                  </View>
                </Marker>
              ) : null}
            </MapView>
          </View>
        ) : (
          <View style={styles.mapBox}>
            <Ionicons name="map-outline" size={40} color="#F58220" />
            <Text style={styles.mapText}>
              {t("booking.exactPickupNotAvailableForRide")}
            </Text>
          </View>
        )}

        <View style={styles.card}>
          {isSchoolTripsSource ? (
            // A school trip is shared by several independent passengers
            // (see the top-of-file comment) — showing one passenger's name
            // here would be misleading, so this shows the school instead.
            (booking as any).schoolName ? (
              <View style={styles.infoRow}>
                <Ionicons name="school-outline" size={16} color="#7C5F46" />
                <Text style={styles.infoText}>{(booking as any).schoolName}</Text>
              </View>
            ) : null
          ) : (
            <>
              <View style={styles.infoRow}>
                <Ionicons name="person-outline" size={16} color="#7C5F46" />
                <Text style={styles.infoText}>{(booking as any).passengerName}</Text>
              </View>

              {(booking as any).passengerPhone ? (
                <Pressable
                  style={styles.infoRow}
                  onPress={() =>
                    Linking.openURL(`tel:${(booking as any).passengerPhone}`).catch(
                      () => {},
                    )
                  }
                >
                  <Ionicons name="call-outline" size={16} color="#F58220" />
                  <Text style={[styles.infoText, styles.phone]}>
                    {(booking as any).passengerPhone}
                  </Text>
                </Pressable>
              ) : null}
            </>
          )}

          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={16} color="#7C5F46" />
            <Text style={styles.infoText}>
              {(booking as any).from || "?"} → {(booking as any).to || "?"}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="navigate-circle-outline" size={16} color="#7C5F46" />
            <Text style={styles.infoText}>
              {c
                ? pickupAddressText(booking) ||
                  `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`
                : pickupAddressText(booking) || t("booking.exactPickupNotAvailable")}
            </Text>
          </View>

          {(booking as any).date ? (
            <View style={styles.infoRow}>
              <Ionicons name="calendar-outline" size={16} color="#7C5F46" />
              <Text style={styles.infoText}>
                {(booking as any).date}
                {(booking as any).day ? ` (${(booking as any).day})` : ""}
              </Text>
            </View>
          ) : null}

          {(booking as any).time ? (
            <View style={styles.infoRow}>
              <Ionicons name="time-outline" size={16} color="#7C5F46" />
              <Text style={styles.infoText}>{(booking as any).time}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.navRow}>
          <Pressable style={styles.navButton} onPress={() => openMaps(booking)}>
            <Ionicons name="map" size={18} color="#FFFFFF" />
            <Text style={styles.navButtonText}>{t("booking.googleMaps")}</Text>
          </Pressable>

          <Pressable
            style={[styles.navButton, styles.wazeButton]}
            onPress={() => openWaze(booking)}
          >
            <Ionicons name="navigate-circle" size={18} color="#FFFFFF" />
            <Text style={styles.navButtonText}>{t("booking.waze")}</Text>
          </Pressable>
        </View>

        {completed ? (
          <View style={styles.doneBanner}>
            <Ionicons name="checkmark-circle" size={20} color="#166534" />
            <Text style={styles.doneText}>{t("booking.rideCompleted")}</Text>
          </View>
        ) : (
          <View style={styles.actionsCard}>
            {tripStatus === "booked" ? (
              <>
                <Pressable
                  style={[
                    styles.actionButton,
                    (busy || !canStart) && styles.disabled,
                  ]}
                  onPress={handleStartDriving}
                  disabled={busy || !canStart}
                >
                  {busy ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="car-outline" size={19} color="#FFFFFF" />
                      <Text style={styles.actionText}>
                        {t("booking.startDrivingToPickup")}
                      </Text>
                    </>
                  )}
                </Pressable>

                {!canStart && blockedReason ? (
                  <Text style={styles.gateHint}>{blockedReason}</Text>
                ) : null}
              </>
            ) : null}

            {tripStatus === "driver_on_way" ? (
              <Pressable
                style={[styles.actionButton, busy && styles.disabled]}
                onPress={handleArrived}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="flag" size={19} color="#FFFFFF" />
                    <Text style={styles.actionText}>{t("booking.iArrivedAtPickup")}</Text>
                  </>
                )}
              </Pressable>
            ) : null}

            {isSchoolTripsSource && schoolPassengerBookings.length > 0 && tripStatus === "arrived_pickup" ? (
              <View style={styles.passengersBox}>
                <Text style={styles.passengersTitle}>{t("booking.verifyAndStartTrip")}</Text>

                {schoolPassengerBookings.map((passengerBooking) => (
                  <View key={passengerBooking.id} style={styles.passengerRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.passengerName}>
                        {passengerBooking.childName || passengerBooking.passengerName}
                      </Text>
                      <Text
                        style={[
                          styles.passengerStatus,
                          passengerBooking.tripStatus === "in_progress" && styles.passengerVerified,
                        ]}
                      >
                        {passengerBooking.tripStatus === "in_progress"
                          ? t("booking.verificationSuccessful")
                          : t("booking.enterVerificationCode")}
                      </Text>
                    </View>

                    {passengerBooking.tripStatus === "in_progress" ? (
                      <Ionicons name="checkmark-circle" size={22} color="#166534" />
                    ) : (
                      <Pressable
                        style={styles.verifyButton}
                        onPress={() => openVerifyModal(passengerBooking)}
                      >
                        <Text style={styles.verifyButtonText}>{t("booking.verifyAndStartTrip")}</Text>
                      </Pressable>
                    )}
                  </View>
                ))}
              </View>
            ) : null}

            {tripStatus === "arrived_pickup" ? (
              <>
                <Pressable
                  style={[
                    styles.endButton,
                    (busy || (isSchoolTripsSource && unstartedPassengerCount > 0)) && styles.disabled,
                  ]}
                  onPress={handleFinishTrip}
                  disabled={busy || (isSchoolTripsSource && unstartedPassengerCount > 0)}
                >
                  {busy ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons
                        name="checkmark-circle-outline"
                        size={20}
                        color="#FFFFFF"
                      />
                      <Text style={styles.actionText}>{t("booking.finishTripButton")}</Text>
                    </>
                  )}
                </Pressable>

                {isSchoolTripsSource && unstartedPassengerCount > 0 ? (
                  <Text style={styles.gateHint}>{t("booking.verificationRequiredBeforeStart")}</Text>
                ) : null}
              </>
            ) : null}

            {shouldTrackDriver(tripStatus) ? (
              <Text style={styles.trackingHint}>
                {t("booking.liveTrackingActiveHint")}
              </Text>
            ) : null}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={!!verifyModalBooking}
        animationType="fade"
        transparent
        onRequestClose={closeVerifyModal}
      >
        <View style={styles.verifyOverlay}>
          <View style={styles.verifySheet}>
            <Text style={styles.verifySheetTitle}>{t("booking.verifyAndStartTrip")}</Text>
            <Text style={styles.verifySheetSubtitle}>
              {verifyModalBooking?.childName || verifyModalBooking?.passengerName}
            </Text>

            <TextInput
              style={styles.verifyInput}
              value={verifyCodeInput}
              // Never rely on keyboardType alone — an RTL/Arabic keyboard can
              // still hand back Arabic-Indic digits regardless of it, so the
              // typed value is always normalized to Western digits first.
              onChangeText={(text) =>
                setVerifyCodeInput(normalizeToWesternDigits(text).replace(/[^0-9]/g, "").slice(0, 4))
              }
              placeholder={t("booking.enterVerificationCode")}
              placeholderTextColor="#8B7B6B"
              keyboardType="number-pad"
              maxLength={4}
              editable={!verifying}
            />

            <Pressable
              style={[
                styles.verifySubmitButton,
                (verifyCodeInput.length !== 4 || verifying) && styles.disabled,
              ]}
              onPress={handleSubmitVerification}
              disabled={verifyCodeInput.length !== 4 || verifying}
            >
              {verifying ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.actionText}>{t("booking.verifyAndStartTrip")}</Text>
              )}
            </Pressable>

            <Pressable style={styles.verifyCancelButton} onPress={closeVerifyModal}>
              <Text style={styles.backText}>{t("common.cancel")}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 30,
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 18,
  },
  title: {
    fontSize: 26,
    fontWeight: "900",
    color: "#111827",
  },
  statusBox: {
    backgroundColor: "#FFF8F2",
    borderWidth: 1,
    borderColor: "#FFE2C5",
    borderRadius: 14,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  statusText: {
    color: "#B86115",
    fontWeight: "900",
    fontSize: 14,
    flexShrink: 1,
  },
  mapWrapper: {
    height: 260,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    marginBottom: 18,
  },
  map: {
    width: "100%",
    height: "100%",
  },
  driverMarker: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F58220",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#FFFFFF",
  },
  mapBox: {
    backgroundColor: "#FFF8F2",
    borderWidth: 1.5,
    borderColor: "#FFE2C5",
    borderRadius: 18,
    paddingVertical: 40,
    alignItems: "center",
    gap: 10,
    marginBottom: 18,
  },
  mapText: {
    color: "#B86115",
    fontWeight: "800",
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  infoText: {
    color: "#3C2319",
    fontSize: 14,
    fontWeight: "700",
    flexShrink: 1,
  },
  phone: {
    color: "#F58220",
  },
  navRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 18,
  },
  navButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#4285F4",
    borderRadius: 14,
    paddingVertical: 14,
  },
  wazeButton: {
    backgroundColor: "#33CCFF",
  },
  navButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
  },
  actionsCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 18,
    padding: 14,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#F58220",
    borderRadius: 14,
    paddingVertical: 16,
  },
  endButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#166534",
    borderRadius: 14,
    paddingVertical: 16,
  },
  actionText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 16,
  },
  trackingHint: {
    marginTop: 12,
    color: "#7C5F46",
    fontWeight: "800",
    fontSize: 13,
    textAlign: "center",
  },
  gateHint: {
    marginTop: 10,
    color: "#B86115",
    fontWeight: "800",
    fontSize: 13,
    textAlign: "center",
  },
  disabled: {
    opacity: 0.6,
  },
  passengersBox: {
    marginBottom: 14,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F0E5DC",
  },
  passengersTitle: {
    fontWeight: "900",
    fontSize: 14,
    color: "#111827",
    marginBottom: 10,
  },
  passengerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  passengerName: {
    fontWeight: "800",
    fontSize: 14,
    color: "#111827",
  },
  passengerStatus: {
    fontSize: 12,
    color: "#B86115",
    fontWeight: "700",
    marginTop: 2,
  },
  passengerVerified: {
    color: "#166534",
  },
  verifyButton: {
    backgroundColor: "#F58220",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  verifyButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 12.5,
  },
  verifyOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  verifySheet: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 22,
    alignItems: "center",
  },
  verifySheetTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
  },
  verifySheetSubtitle: {
    fontSize: 13,
    color: "#7C5F46",
    fontWeight: "700",
    marginTop: 4,
    marginBottom: 18,
  },
  verifyInput: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    padding: 14,
    fontSize: 24,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: 8,
    color: "#111827",
    marginBottom: 18,
  },
  verifySubmitButton: {
    width: "100%",
    backgroundColor: "#F58220",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  verifyCancelButton: {
    marginTop: 12,
    paddingVertical: 8,
  },
  doneBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#E7F7EC",
    borderRadius: 14,
    paddingVertical: 16,
  },
  doneText: {
    color: "#166534",
    fontWeight: "900",
    fontSize: 16,
  },
  emptyTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: "#111827",
    marginTop: 12,
    marginBottom: 6,
  },
  backLink: {
    marginTop: 16,
  },
  backLinkText: {
    color: "#F58220",
    fontWeight: "900",
    fontSize: 15,
  },
});
