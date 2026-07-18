import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
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
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { Marker } from "react-native-maps";

import { useTranslation } from "react-i18next";

import { db } from "../../firebase";
import { canStartTrip, getStartTripBlockedReason } from "../booking/bookingsLib";
import { normalizeRideBooking, RideBooking } from "../booking/rideBookingLib";
import {
  normalizeSchoolBooking,
  normalizeSchoolTrip,
  SCHOOL_BOOKINGS_COLLECTION,
  SCHOOL_TRIPS_COLLECTION,
} from "../booking/schoolTripsLib";
import { notify } from "../booking/work-errand/workErrandLib";
import { useLanguage } from "../i18n/LanguageProvider";

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

// Live tracking starts as soon as the driver arrives for pickup (there is no
// separate "Start Trip" step) and stays on until Finish Trip.
const shouldTrackDriver = (status: TripStatus) => {
  return status === "arrived_pickup";
};

const getDriverLocation = (booking: any) => {
  const lat = Number(booking?.driverLocation?.latitude);
  const lng = Number(booking?.driverLocation?.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return { latitude: lat, longitude: lng };
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

  const updateDriverLocationOnce = async () => {
    if (!id) return;

    const permission = await Location.requestForegroundPermissionsAsync();

    if (permission.status !== "granted") {
      Alert.alert(
        t("booking.locationPermissionTitle"),
        t("booking.allowLocationForTracking"),
      );
      return;
    }

    const current = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    await updateDoc(doc(db, bookingCollection, id), {
      driverLocation: {
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
        accuracy: current.coords.accuracy ?? null,
        heading: current.coords.heading ?? null,
        speed: current.coords.speed ?? null,
      },
      driverLocationUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  };

useEffect(() => {
  if (!booking || !id) return;

  const tripStatus = getTripStatus(booking);

  // Live location updates run while the driver has arrived for pickup, up
  // until Finish Trip.
  if (tripStatus !== "arrived_pickup") return;

  let subscription: Location.LocationSubscription | null = null;
  let cancelled = false;

  const startLiveTracking = async () => {
    const permission = await Location.requestForegroundPermissionsAsync();

    if (permission.status !== "granted") {
      Alert.alert(
        t("booking.locationPermissionTitle"),
        t("booking.allowLocationForTracking"),
      );
      return;
    }

    subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 3000,
        distanceInterval: 5,
      },
      async (location) => {
        if (cancelled) return;

        try {
          await updateDoc(doc(db, bookingCollection, id), {
            driverLocation: {
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
              accuracy: location.coords.accuracy ?? null,
              heading: location.coords.heading ?? null,
              speed: location.coords.speed ?? null,
            },
            driverLocationUpdatedAt: serverTimestamp(),
            trackingEnabled: true,
            updatedAt: serverTimestamp(),
          });
        } catch (error) {
          console.log("Could not update driver location", error);
        }
      },
    );
  };

  startLiveTracking();

  return () => {
    cancelled = true;

    if (subscription) {
      subscription.remove();
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [id, booking]);

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

    if (nextStatus === "arrived_pickup") {
      await updateDriverLocationOnce();
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
      tripPayload.trackingEnabled = true;
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

    if (nextStatus === "arrived_pickup") {
      await updateDriverLocationOnce();
    }

    const bookingsSnap = await getDocs(
      query(
        collection(db, SCHOOL_BOOKINGS_COLLECTION),
        where("tripId", "==", id),
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
  const driverLocation = getDriverLocation(booking);
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

            {tripStatus === "arrived_pickup" ? (
              <Pressable
                style={[styles.endButton, busy && styles.disabled]}
                onPress={handleFinishTrip}
                disabled={busy}
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
            ) : null}

            {shouldTrackDriver(tripStatus) ? (
              <Text style={styles.trackingHint}>
                {t("booking.liveTrackingActiveHint")}
              </Text>
            ) : null}
          </View>
        )}
      </ScrollView>
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
