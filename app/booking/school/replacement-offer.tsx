// ---------------------------------------------------------------------------
// Driver-cancellation replacement review — reached either from the
// "school_trip_replacement" notification (params.offerId) or from the
// affected booking's own "Review offers" link in My Bookings
// (params.originalBookingId). Shows the cancelled trip, every still-valid
// alternative (re-read live, never trusting the offer's own stored
// candidate snapshot as booking-eligible truth), and lets the parent
// explicitly accept exactly one — nothing is ever booked automatically.
// Reuses the existing payment page for a price increase; a same/lower price
// confirms directly with the same payment method as the original booking.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { doc, getDoc } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { db } from "../../../firebase";
import { useLanguage } from "../../i18n/LanguageProvider";
import {
  acceptReplacementOffer,
  declineReplacementOffer,
  fetchDriverRating,
  fetchReplacementCandidateTrips,
  fetchReplacementOffer,
  fetchReplacementOfferByBookingId,
  normalizeSchoolBooking,
  ReplacementOffer,
  SCHOOL_BOOKINGS_COLLECTION,
  SchoolBooking,
  SchoolTrip,
} from "../schoolTripsLib";

type DriverInfo = { ratingAverage: number; ratingCount: number };

export default function ReplacementOfferScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const params = useLocalSearchParams<Record<string, string>>();

  const [loading, setLoading] = useState(true);
  const [offer, setOffer] = useState<ReplacementOffer | null>(null);
  const [originalBooking, setOriginalBooking] = useState<SchoolBooking | null>(null);
  const [candidates, setCandidates] = useState<SchoolTrip[]>([]);
  const [driverInfo, setDriverInfo] = useState<Record<string, DriverInfo>>({});
  const [confirmingTripId, setConfirmingTripId] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);

      const resolvedOffer = params.offerId
        ? await fetchReplacementOffer(String(params.offerId))
        : params.originalBookingId
          ? await fetchReplacementOfferByBookingId(String(params.originalBookingId))
          : null;

      if (cancelled) return;

      if (!resolvedOffer) {
        setOffer(null);
        setLoading(false);
        return;
      }

      setOffer(resolvedOffer);

      const [bookingSnap, freshCandidates] = await Promise.all([
        getDoc(doc(db, SCHOOL_BOOKINGS_COLLECTION, resolvedOffer.originalBookingId)),
        fetchReplacementCandidateTrips(resolvedOffer),
      ]);

      if (cancelled) return;

      setOriginalBooking(
        bookingSnap.exists() ? normalizeSchoolBooking(bookingSnap.id, bookingSnap.data()) : null,
      );
      setCandidates(freshCandidates);

      const ids = Array.from(new Set(freshCandidates.map((c) => c.driverId)));
      const entries = await Promise.all(ids.map(async (id) => [id, await fetchDriverRating(id)] as const));
      if (!cancelled) {
        setDriverInfo(Object.fromEntries(entries.map(([id, info]) => [id, info])));
      }

      setLoading(false);
    };

    load();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.offerId, params.originalBookingId]);

  const handleAccept = async (candidate: SchoolTrip) => {
    if (!offer || !originalBooking || confirmingTripId) return;

    const newTotal = candidate.pricePerSeat * offer.seatsNeeded;
    const oldTotal = originalBooking.totalPrice;

    const proceed = async () => {
      setConfirmingTripId(candidate.id);
      try {
        await acceptReplacementOffer(offer.id, candidate.id, originalBooking.paymentMethod);
        Alert.alert(t("common.success"), t("booking.replacementConfirmed"), [
          { text: t("common.ok"), onPress: () => router.replace("/(tabs)/bookings" as any) },
        ]);
      } catch (error: any) {
        Alert.alert(t("common.error"), error?.message || t("errors.generic"));
      } finally {
        setConfirmingTripId(null);
      }
    };

    if (newTotal > oldTotal) {
      // Extra amount owed — route through the existing payment page rather
      // than silently charging more (AGENTS.md: "Navigate to the existing
      // payment page before confirming the replacement").
      router.push({
        pathname: "/booking/ride-payment",
        params: {
          category: "school",
          bookingSource: "schoolTripReplacement",
          replacementOfferId: offer.id,
          schoolTripId: candidate.id,
          direction: candidate.direction,
          driverId: candidate.driverId,
          driverName: candidate.driverName,
          driverPhone: candidate.driverPhone,
          from: candidate.fromAddress,
          to: candidate.toAddress,
          schoolName: candidate.schoolName,
          date: candidate.date,
          time: candidate.departureTime,
          seats: String(offer.seatsNeeded),
          maxSeats: String(offer.seatsNeeded),
          price: String(candidate.pricePerSeat),
          unitPrice: String(candidate.pricePerSeat),
        },
      } as any);
      return;
    }

    Alert.alert(
      t("schoolTrip.confirmBooking"),
      newTotal < oldTotal
        ? t("booking.replacementCheaperNotice", { amount: oldTotal - newTotal })
        : t("booking.replacementSamePriceNotice"),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.ok"), onPress: proceed },
      ],
    );
  };

  const handleDecline = async () => {
    if (!offer || declining) return;

    setDeclining(true);
    try {
      await declineReplacementOffer(offer.id);
      router.replace("/(tabs)/bookings" as any);
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("errors.generic"));
    } finally {
      setDeclining(false);
    }
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

  if (!offer) {
    return (
      <SafeAreaView style={styles.page}>
        <View style={styles.loadingBox}>
          <Ionicons name="alert-circle-outline" size={40} color="#8B7B6B" />
          <Text style={styles.emptyText}>{t("booking.replacementNoLongerAvailable")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const alreadyResolved = offer.status === "accepted" || offer.status === "declined";

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name={isRTL ? "arrow-forward" : "arrow-back"} size={24} color="#7C5F46" />
        </Pressable>

        <Text style={styles.title}>{t("booking.reviewOffers")}</Text>

        {originalBooking ? (
          <View style={styles.oldCard}>
            <Text style={styles.oldCardTitle}>{t("booking.cancelledRideLabel")}</Text>
            <Text style={styles.oldCardText}>
              {originalBooking.fromAddress} → {originalBooking.toAddress}
            </Text>
            <Text style={styles.oldCardMeta}>
              {originalBooking.date} · {originalBooking.departureTime} · {originalBooking.schoolName}
            </Text>
            <Text style={styles.oldCardMeta}>
              {originalBooking.driverName} · {originalBooking.totalPrice} ₪
            </Text>
          </View>
        ) : null}

        {alreadyResolved ? (
          <View style={styles.emptyCard}>
            <Ionicons name="checkmark-circle-outline" size={32} color="#166534" />
            <Text style={styles.emptyTitle}>
              {offer.status === "accepted"
                ? t("booking.replacementAlreadyAccepted")
                : t("booking.replacementDeclinedNotice")}
            </Text>
          </View>
        ) : candidates.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="hourglass-outline" size={32} color="#8B7B6B" />
            <Text style={styles.emptyTitle}>{t("booking.replacementSearching")}</Text>
          </View>
        ) : (
          candidates.map((candidate) => {
            const info = driverInfo[candidate.driverId];
            const newTotal = candidate.pricePerSeat * offer.seatsNeeded;
            const oldTotal = originalBooking?.totalPrice ?? newTotal;
            const diff = newTotal - oldTotal;

            return (
              <View key={candidate.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.driverName}>{candidate.driverName}</Text>
                    <View style={styles.ratingRow}>
                      <Ionicons name="star" size={13} color="#F58220" />
                      <Text style={styles.ratingText}>
                        {info ? info.ratingAverage.toFixed(1) : "—"} ({info?.ratingCount || 0})
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.timeText}>{candidate.departureTime}</Text>
                </View>

                <Text style={styles.routeText}>
                  {candidate.fromAddress} → {candidate.toAddress}
                </Text>

                <View style={styles.footerRow}>
                  <Text style={styles.priceText}>{newTotal} ₪</Text>
                  <Text style={styles.seatsText}>
                    {candidate.availableSeats} {t("schoolTrip.seatsLeft")}
                  </Text>
                </View>

                {diff !== 0 ? (
                  <Text style={diff > 0 ? styles.priceDiffUp : styles.priceDiffDown}>
                    {diff > 0
                      ? t("booking.replacementPriceHigher", { amount: diff })
                      : t("booking.replacementPriceLower", { amount: -diff })}
                  </Text>
                ) : null}

                <Pressable
                  style={[styles.acceptButton, confirmingTripId && { opacity: 0.6 }]}
                  onPress={() => handleAccept(candidate)}
                  disabled={!!confirmingTripId}
                >
                  {confirmingTripId === candidate.id ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.acceptButtonText}>{t("common.ok")}</Text>
                  )}
                </Pressable>
              </View>
            );
          })
        )}

        {!alreadyResolved ? (
          <Pressable
            style={[styles.declineButton, declining && { opacity: 0.6 }]}
            onPress={handleDecline}
            disabled={declining}
          >
            <Text style={styles.declineButtonText}>{t("common.cancel")}</Text>
          </Pressable>
        ) : null}
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
  oldCard: {
    backgroundColor: "#FEE2E2",
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  oldCardTitle: { fontWeight: "900", color: "#B91C1C", fontSize: 13, marginBottom: 6 },
  oldCardText: { fontWeight: "800", color: "#111827", fontSize: 14, marginBottom: 4 },
  oldCardMeta: { color: "#7C5F46", fontWeight: "600", fontSize: 12.5, marginBottom: 2 },
  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E7DCD1",
    padding: 28,
    alignItems: "center",
    gap: 10,
  },
  emptyTitle: { fontSize: 15, fontWeight: "800", color: "#111827", textAlign: "center" },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E7DCD1",
    padding: 16,
    marginBottom: 14,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  driverName: { fontWeight: "900", color: "#111827", fontSize: 15 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  ratingText: { fontSize: 12, color: "#7C5F46", fontWeight: "700" },
  timeText: { fontSize: 18, fontWeight: "900", color: "#F58220" },
  routeText: { color: "#111827", fontWeight: "700", fontSize: 13, marginTop: 12 },
  footerRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 10 },
  priceText: { fontWeight: "900", color: "#111827", fontSize: 15 },
  seatsText: { color: "#7C5F46", fontWeight: "700", fontSize: 13 },
  priceDiffUp: { color: "#B91C1C", fontWeight: "800", fontSize: 12.5, marginTop: 6 },
  priceDiffDown: { color: "#166534", fontWeight: "800", fontSize: 12.5, marginTop: 6 },
  acceptButton: {
    backgroundColor: "#F58220",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 12,
  },
  acceptButtonText: { color: "#FFFFFF", fontWeight: "900" },
  declineButton: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  declineButtonText: { color: "#7C5F46", fontWeight: "800" },
});
