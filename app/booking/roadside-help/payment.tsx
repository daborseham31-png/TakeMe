// ---------------------------------------------------------------------------
// Roadside Help – passenger payment screen.
//
// Reached either from "Finished Help" -> the roadside_payment_required
// notification (requestId/offerId/driverId/driverName/amount/bookingId
// params), or directly from My Bookings. The amount shown is a preview only
// — the real charge always comes from the live `bookings`/`roadsideRequests`
// documents inside payRoadsideHelp's transaction, never from route params.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
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

import { db } from "../../../firebase";
import BitBadge from "../BitBadge";
import { openBitPayment } from "../bitPayment";
import { payRoadsideHelp, RoadsidePaymentMethod } from "./roadsideLib";

type BookingDoc = {
  id: string;
  driverName: string;
  driverPhone: string;
  problemTypes: string[];
  address: string;
  etaMinutes: number | null;
  price: number | null;
  status: string;
  paymentStatus: string;
  paidAmount: number | null;
};

const normalize = (id: string, data: any): BookingDoc => ({
  id,
  driverName: data.driverName || "Driver",
  driverPhone: data.driverPhone || "",
  problemTypes: Array.isArray(data.problemTypes) ? data.problemTypes : [],
  address: data.address || data.location?.address || "",
  etaMinutes: typeof data.etaMinutes === "number" ? data.etaMinutes : null,
  price: typeof data.price === "number" ? data.price : null,
  status: data.status || "",
  paymentStatus: data.paymentStatus || "",
  paidAmount: typeof data.paidAmount === "number" ? data.paidAmount : null,
});

export default function RoadsideHelpPaymentScreen() {
  const params = useLocalSearchParams();

  const bookingIdParam = String(params.bookingId || "");
  const requestId = String(params.requestId || "");
  const driverNameParam = String(params.driverName || "Your helper");
  const amountParam = Number(params.amount) || 0;

  const [booking, setBooking] = useState<BookingDoc | null>(null);
  const [bookingId, setBookingId] = useState(bookingIdParam);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [method, setMethod] = useState<RoadsidePaymentMethod | null>(null);
  const [processing, setProcessing] = useState(false);

  // Resolve the booking id: prefer the one passed in (from the payment
  // notification), otherwise look it up by requestId.
  useEffect(() => {
    if (bookingIdParam) {
      setBookingId(bookingIdParam);
      return;
    }

    if (!requestId) {
      setLoading(false);
      setNotFound(true);
      return;
    }

    (async () => {
      try {
        const snap = await getDoc(doc(db, "roadsideRequests", requestId));
        const selected = snap.exists() ? snap.data().selectedOfferId : null;

        const bookingsSnap = await getDocs(
          query(collection(db, "bookings"), where("requestId", "==", requestId)),
        );

        const match =
          bookingsSnap.docs.find((d) => d.data().offerId === selected) ||
          bookingsSnap.docs[0];

        if (match) {
          setBookingId(match.id);
        } else {
          setNotFound(true);
          setLoading(false);
        }
      } catch {
        setNotFound(true);
        setLoading(false);
      }
    })();
  }, [bookingIdParam, requestId]);

  // Live-subscribe to the booking so "Already paid" / "not ready yet" states
  // update immediately if this screen is left open.
  useEffect(() => {
    if (!bookingId) return;

    const unsubscribe = onSnapshot(
      doc(db, "bookings", bookingId),
      (snap) => {
        if (!snap.exists()) {
          setNotFound(true);
          setBooking(null);
        } else {
          setBooking(normalize(snap.id, snap.data()));
        }
        setLoading(false);
      },
      () => {
        setLoading(false);
        setNotFound(true);
      },
    );

    return unsubscribe;
  }, [bookingId]);

  const handleSelectBit = () => {
    setMethod("bit");
    openBitPayment(booking?.driverPhone || "", booking?.price ?? amountParam);
  };

  const handlePay = async () => {
    if (!bookingId || processing || !method) return;

    try {
      setProcessing(true);
      const result = await payRoadsideHelp(bookingId, method);

      Alert.alert("Payment successful", `You paid ₪${result.amount}.`, [
        {
          text: "OK",
          onPress: () =>
            router.replace({
              pathname: "/(tabs)/bookings",
              params: { tab: "passenger", bookingId },
            } as any),
        },
      ]);
    } catch (error: any) {
      Alert.alert("Payment failed", error?.message || "Please try again.");
    } finally {
      setProcessing(false);
    }
  };

  const driverName = booking?.driverName || driverNameParam;
  const amount = booking?.price ?? amountParam;
  const alreadyPaid = booking?.paymentStatus === "paid";
  const readyForPayment =
    booking?.status === "completed" && booking?.paymentStatus === "pending";

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#7C5F46" />
          <Text style={styles.backText}>Back</Text>
        </Pressable>

        <Text style={styles.title}>Roadside Help Payment</Text>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#F58220" />
          </View>
        ) : notFound || !booking ? (
          <View style={styles.card}>
            <Text style={styles.summaryText}>
              This roadside help booking could not be found.
            </Text>
          </View>
        ) : alreadyPaid ? (
          <View style={styles.card}>
            <View style={styles.paidBox}>
              <Ionicons name="checkmark-circle" size={40} color="#16A34A" />
              <Text style={styles.paidTitle}>Already paid</Text>
              <Text style={styles.summaryText}>
                ₪{booking.paidAmount ?? amount} was paid to {driverName}.
              </Text>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="checkmark-circle" size={20} color="#F58220" />
                <Text style={styles.cardTitle}>Trip Summary</Text>
              </View>

              <View style={styles.summaryRow}>
                <Ionicons name="construct-outline" size={16} color="#7C5F46" />
                <Text style={styles.summaryStrong}>Payment to: {driverName}</Text>
              </View>

              {booking.address ? (
                <View style={styles.summaryRow}>
                  <Ionicons name="location-outline" size={16} color="#7C5F46" />
                  <Text style={styles.summaryText}>{booking.address}</Text>
                </View>
              ) : null}

              {booking.problemTypes.length > 0 ? (
                <View style={styles.summaryRow}>
                  <Ionicons name="build-outline" size={16} color="#7C5F46" />
                  <Text style={styles.summaryText}>
                    {booking.problemTypes.join(", ")}
                  </Text>
                </View>
              ) : null}

              <View style={styles.divider} />

              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Amount</Text>
                <Text style={styles.totalValue}>₪{amount}</Text>
              </View>
            </View>

            {!readyForPayment ? (
              <View style={styles.card}>
                <Text style={styles.summaryText}>
                  This help isn&apos;t ready for payment yet. Please wait for the
                  driver to mark it finished.
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.card}>
                  <View style={styles.cardTitleRow}>
                    <Ionicons name="card-outline" size={20} color="#F58220" />
                    <Text style={styles.cardTitle}>Payment Method</Text>
                  </View>

                  <View style={styles.methodRow}>
                    <Pressable
                      style={[
                        styles.methodButton,
                        method === "cash" && styles.methodButtonActive,
                      ]}
                      onPress={() => setMethod("cash")}
                    >
                      <Text style={styles.cashEmoji}>💵</Text>
                      <Text
                        style={[
                          styles.methodText,
                          method === "cash" && styles.methodTextActive,
                        ]}
                      >
                        Cash
                      </Text>
                    </Pressable>

                    <Pressable
                      style={[
                        styles.methodButton,
                        method === "bit" && styles.methodButtonActive,
                      ]}
                      onPress={handleSelectBit}
                    >
                      <BitBadge size={18} />
                      <Text
                        style={[
                          styles.methodText,
                          method === "bit" && styles.methodTextActive,
                        ]}
                      >
                        Pay with BIT
                      </Text>
                    </Pressable>
                  </View>

                  {method === "bit" ? (
                    <View style={styles.bitInfoBox}>
                      <Ionicons
                        name="information-circle-outline"
                        size={16}
                        color="#B86115"
                      />
                      <Text style={styles.bitInfoText}>
                        BIT was opened with{" "}
                        {booking.driverPhone || "the driver's number"} copied
                        to your clipboard — paste it into BIT&apos;s &quot;Send
                        money to&quot; field, then press Pay below.
                      </Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.secureRow}>
                  <Ionicons
                    name="shield-checkmark-outline"
                    size={16}
                    color="#7C5F46"
                  />
                  <Text style={styles.secureText}>
                    Your payment is secure and encrypted
                  </Text>
                </View>

                <Pressable
                  style={[
                    styles.payButton,
                    (!method || processing) && styles.payButtonDisabled,
                  ]}
                  onPress={handlePay}
                  disabled={!method || processing}
                >
                  {processing ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="card-outline" size={20} color="#FFFFFF" />
                      <Text style={styles.payText}>Pay ₪{amount}</Text>
                    </>
                  )}
                </Pressable>
              </>
            )}
          </>
        )}
      </ScrollView>
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
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
  },
  backText: {
    color: "#7C5F46",
    fontWeight: "800",
    fontSize: 15,
  },
  title: {
    fontSize: 26,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 20,
  },
  loadingBox: {
    paddingVertical: 40,
    alignItems: "center",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
  },
  paidBox: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
  },
  paidTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: "#111827",
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  summaryStrong: {
    color: "#111827",
    fontWeight: "900",
    fontSize: 14,
    flexShrink: 1,
  },
  summaryText: {
    color: "#7C5F46",
    fontSize: 14,
    fontWeight: "600",
    flexShrink: 1,
  },
  divider: {
    height: 1,
    backgroundColor: "#F0E5DC",
    marginTop: 6,
    marginBottom: 14,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalLabel: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
  },
  totalValue: {
    fontSize: 24,
    fontWeight: "900",
    color: "#F58220",
  },
  methodRow: {
    flexDirection: "row",
    gap: 12,
  },
  methodButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E7DCD1",
    backgroundColor: "#FFFDFC",
  },
  methodButtonActive: {
    backgroundColor: "#F58220",
    borderColor: "#F58220",
  },
  methodText: {
    fontSize: 15,
    fontWeight: "900",
    color: "#7C5F46",
  },
  methodTextActive: {
    color: "#FFFFFF",
  },
  cashEmoji: {
    fontSize: 16,
  },
  bitInfoBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFF2E8",
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  bitInfoText: {
    color: "#B86115",
    fontWeight: "700",
    fontSize: 13,
    flexShrink: 1,
  },
  secureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 20,
  },
  secureText: {
    color: "#7C5F46",
    fontSize: 13,
  },
  payButton: {
    backgroundColor: "#F58220",
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    minHeight: 56,
  },
  payButtonDisabled: {
    backgroundColor: "#F3C39A",
  },
  payText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 16,
  },
});
