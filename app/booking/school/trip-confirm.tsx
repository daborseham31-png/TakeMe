// ---------------------------------------------------------------------------
// School trip details + review — the pre-payment step. This is also the
// screen a "Suitable ride found" push/in-app notification opens (AGENTS.md
// #8) — tapping it passes tripId (+ rideRequestId).
//
// This screen never books directly: it only lets the parent review the trip
// and the (fixed, per-child, or manually chosen) seat count, then hands off
// to the app's existing payment page (app/booking/ride-payment.tsx — the
// SAME screen Personal Ride already uses) for payment-method selection and
// the actual booking write. The "book a return too?" round-trip prompt and
// the return-leg-of-an-in-progress-round-trip continuation both now live on
// that payment screen, since they only make sense AFTER a booking exists.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { useLanguage } from "../../i18n/LanguageProvider";
import {
  fetchDriverRating,
  SchoolBookingChildEntry,
  SchoolTrip,
  subscribeSchoolTrip,
} from "../schoolTripsLib";

export default function SchoolTripConfirmScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const params = useLocalSearchParams<Record<string, string>>();

  const tripId = String(params.tripId || "");
  const requestedSeats = Math.max(1, Number(params.seats) || 1);
  const roundTrip = params.roundTrip === "true";
  const bookingGroupId = params.bookingGroupId ? String(params.bookingGroupId) : undefined;

  // One entry per child riding this outbound trip together (AGENTS.md #3's
  // "one multi-seat booking with a childEntries array") — set by
  // DirectionSearchForm's search and carried through trip-results.tsx's
  // goToConfirm. Empty for any booking with no per-child data (legacy
  // bookings, or entry points that never collected children), which keeps
  // the original seats-only booking path fully intact below.
  const outboundChildEntries = useMemo<SchoolBookingChildEntry[]>(() => {
    const raw = String(params.childEntries || "");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const entries = parsed
            .filter((entry) => entry && typeof entry.localId === "string")
            .map((entry) => ({ localId: entry.localId, childName: entry.childName || undefined }));
          if (entries.length > 0) return entries;
        }
      } catch {
        // fall through to the single childEntryId param below
      }
    }

    // A "suitable ride found for Child N" notification tap (AGENTS.md #8)
    // carries the single child directly as childEntryId/childName rather
    // than a JSON childEntries array — treated the same as a one-child
    // roster so that booking still tags the right child.
    const soloChildEntryId = String(params.childEntryId || "");
    if (soloChildEntryId) {
      return [{ localId: soloChildEntryId, childName: params.childName ? String(params.childName) : undefined }];
    }

    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.childEntries, params.childEntryId, params.childName]);

  const hasChildRoster = outboundChildEntries.length > 0;

  const [trip, setTrip] = useState<SchoolTrip | null>(null);
  const [loading, setLoading] = useState(true);
  const [seats, setSeats] = useState(requestedSeats);
  const [driverRating, setDriverRating] = useState<{ ratingAverage: number; ratingCount: number } | null>(null);

  useEffect(() => {
    if (!tripId) return;
    setLoading(true);
    const unsub = subscribeSchoolTrip(tripId, (nextTrip) => {
      setTrip(nextTrip);
      setLoading(false);
    });
    return unsub;
  }, [tripId]);

  useEffect(() => {
    if (!trip?.driverId) return;
    fetchDriverRating(trip.driverId).then(setDriverRating);
  }, [trip?.driverId]);

  const decreaseSeats = () => {
    if (hasChildRoster) return;
    setSeats((prev) => Math.max(1, prev - 1));
  };
  const increaseSeats = () => {
    if (hasChildRoster) return;
    setSeats((prev) => Math.min(trip?.availableSeats || 1, prev + 1));
  };

  // Hands off to the app's existing payment page (Personal Ride's own
  // screen — AGENTS.md's "reuse the same payment page, do not create a new
  // payment screen") with everything it needs to create the booking AFTER
  // the passenger actually chooses/confirms a payment method there: the
  // trip identity, the locked (roster or manually chosen) seat count, and —
  // only for a round trip's outbound leg — the return-search continuation
  // params ride-payment.tsx's own "book a return too?" prompt needs.
  const handleContinueToPayment = () => {
    if (!trip) return;

    const effectiveSeats = hasChildRoster ? outboundChildEntries.length : seats;

    router.push({
      pathname: "/booking/ride-payment",
      params: {
        category: "school",
        bookingSource: "schoolTrips",
        schoolTripId: trip.id,
        direction: trip.direction,

        driverId: trip.driverId,
        driverName: trip.driverName,
        driverPhone: trip.driverPhone,

        from: trip.fromAddress,
        to: trip.toAddress,
        schoolName: trip.schoolName,
        date: trip.date,
        time: trip.departureTime,

        seats: String(effectiveSeats),
        maxSeats: String(effectiveSeats),
        price: String(trip.pricePerSeat),
        unitPrice: String(trip.pricePerSeat),

        bookingGroupId: bookingGroupId || "",
        childEntries: hasChildRoster ? JSON.stringify(outboundChildEntries) : "",
        roundTrip: roundTrip ? "true" : "false",

        // Round-trip continuation passthrough — only read by ride-payment's
        // "book a return too?" prompt when this booking is a fresh outbound
        // leg (roundTrip === "true" && direction === "to_school").
        schoolId: String(params.schoolId || trip.schoolId || ""),
        schoolAddress: String(params.schoolAddress || trip.schoolAddress || ""),
        schoolLat: String(params.schoolLat || trip.schoolLocation?.latitude || ""),
        schoolLng: String(params.schoolLng || trip.schoolLocation?.longitude || ""),
        // Return "From" = this outbound trip's own "To" area, with the real
        // pickup point being the school itself (AGENTS.md: "Return From
        // area = outbound To area", "Return From location = schoolLocation").
        outboundToArea: trip.toArea,
        returnToArea: String(params.returnToArea || ""),
        returnToLat: String(params.returnToLat || ""),
        returnToLng: String(params.returnToLng || ""),
        returnRequestedTime: String(params.returnRequestedTime || ""),
        // Per-child return search (AGENTS.md #3) — each child's own return
        // finishing time, collected on the original round-trip search form.
        returnChildEntries: String(params.returnChildEntries || ""),
      },
    } as any);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.page}>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#F58220" />
        </View>
      </SafeAreaView>
    );
  }

  if (!trip) {
    return (
      <SafeAreaView style={styles.page}>
        <View style={styles.loadingBox}>
          <Ionicons name="alert-circle-outline" size={40} color="#8B7B6B" />
          <Text style={styles.emptyText}>{t("rides.tripNoLongerAvailable")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isFull = trip.status !== "active" || trip.availableSeats <= 0;

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name={isRTL ? "arrow-forward" : "arrow-back"} size={24} color="#7C5F46" />
        </Pressable>

        <Text style={styles.title}>
          {trip.direction === "to_school" ? t("schoolTrip.bookOutbound") : t("schoolTrip.bookReturn")}
        </Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <Ionicons name="person-circle-outline" size={24} color="#F58220" />
            <View style={{ flex: 1 }}>
              <Text style={styles.driverName}>{trip.driverName}</Text>
              <Text style={styles.ratingText}>
                {!driverRating
                  ? "—"
                  : driverRating.ratingCount > 0
                    ? `★ ${driverRating.ratingAverage.toFixed(1)} (${driverRating.ratingCount})`
                    : t("roadsideHelp.newDriverLabel")}
              </Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <Ionicons name="location-outline" size={16} color="#7C5F46" />
            <Text style={styles.detailText}>{trip.fromAddress} → {trip.toAddress}</Text>
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="school-outline" size={16} color="#7C5F46" />
            <Text style={styles.detailText}>{trip.schoolName}</Text>
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="calendar-outline" size={16} color="#7C5F46" />
            <Text style={styles.detailText}>{trip.date} · {trip.departureTime}</Text>
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="cash-outline" size={16} color="#7C5F46" />
            <Text style={styles.detailText}>{trip.pricePerSeat} ₪ / {t("schoolTrip.seatWord")}</Text>
          </View>
          {trip.car || trip.carColor || trip.carPlate ? (
            <View style={styles.detailRow}>
              <Ionicons name="car-outline" size={16} color="#7C5F46" />
              <Text style={styles.detailText}>
                {[trip.car, trip.carColor].filter(Boolean).join(" · ")}
                {trip.carPlate ? <Text style={{ writingDirection: "ltr" }}> · {trip.carPlate}</Text> : null}
              </Text>
            </View>
          ) : null}

          {isFull ? (
            <View style={styles.fullBanner}>
              <Text style={styles.fullBannerText}>{t("rides.seatAvailabilityChanged")}</Text>
            </View>
          ) : (
            <>
              <View style={styles.seatsSection}>
                <Text style={styles.label}>{t("booking.seats")}</Text>
                <View style={styles.seatsRow}>
                  <Pressable
                    style={[styles.seatButton, hasChildRoster && { opacity: 0.4 }]}
                    onPress={decreaseSeats}
                    disabled={hasChildRoster}
                  >
                    <Ionicons name="remove" size={20} color="#111827" />
                  </Pressable>
                  <Text style={styles.seatsNumber}>{hasChildRoster ? outboundChildEntries.length : seats}</Text>
                  <Pressable
                    style={[styles.seatButton, hasChildRoster && { opacity: 0.4 }]}
                    onPress={increaseSeats}
                    disabled={hasChildRoster}
                  >
                    <Ionicons name="add" size={20} color="#111827" />
                  </Pressable>
                </View>
                <Text style={styles.seatsHint}>
                  {hasChildRoster
                    ? t("schoolTrip.oneSeatPerChild", { count: outboundChildEntries.length })
                    : `${trip.availableSeats} ${t("schoolTrip.seatsLeft")}`}
                </Text>
              </View>

              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>{t("booking.price")}</Text>
                <Text style={styles.totalValue}>
                  {trip.pricePerSeat * (hasChildRoster ? outboundChildEntries.length : seats)} ₪
                </Text>
              </View>
            </>
          )}
        </View>

        <Pressable
          style={[styles.primaryButton, isFull && { opacity: 0.6 }]}
          onPress={handleContinueToPayment}
          disabled={isFull}
        >
          <Text style={styles.primaryButtonText}>{t("schoolTrip.continueToPayment")}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#FBF7F1" },
  scroll: { padding: 20, paddingTop: 50, paddingBottom: 40 },
  loadingBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  emptyText: { color: "#7C5F46", fontWeight: "700" },
  backButton: { width: 40, height: 40, justifyContent: "center", marginBottom: 4 },
  title: { fontSize: 24, fontWeight: "900", color: "#111827", marginBottom: 16 },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E7DCD1",
    padding: 18,
    marginBottom: 20,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  driverName: { fontWeight: "900", fontSize: 16, color: "#111827" },
  ratingText: { color: "#7C5F46", fontWeight: "700", fontSize: 13, marginTop: 2 },
  divider: { height: 1, backgroundColor: "#F0E5DC", marginVertical: 14 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  detailText: { color: "#111827", fontWeight: "700", fontSize: 14, flex: 1 },
  fullBanner: {
    backgroundColor: "#FEE2E2",
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
  },
  fullBannerText: { color: "#B91C1C", fontWeight: "800", textAlign: "center" },
  seatsSection: { marginTop: 14, marginBottom: 6 },
  label: { fontSize: 14, fontWeight: "900", color: "#111827", marginBottom: 8, marginTop: 10 },
  seatsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  seatButton: {
    width: 36,
    height: 36,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  seatsNumber: { fontSize: 20, fontWeight: "900", color: "#111827" },
  seatsHint: { color: "#7C5F46", fontSize: 12, fontWeight: "700", marginTop: 6 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#F0E5DC",
  },
  totalLabel: { fontWeight: "800", color: "#7C5F46" },
  totalValue: { fontWeight: "900", color: "#111827", fontSize: 18 },
  primaryButton: {
    backgroundColor: "#F58220",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "900", fontSize: 16 },
});
