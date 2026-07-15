// ---------------------------------------------------------------------------
// Work payment – REVERSED direction: the driver/employer pays the
// passenger/worker AFTER the job is marked completed (see finishJob +
// payCompletedWork in workErrandLib.ts). This screen is only ever reached
// from "Finish Work" or the "Pay Worker" fallback button in My Bookings.
//
// Every other payment screen in the app (School, Personal Ride, Errand) has
// the passenger/customer paying the driver BEFORE the service — this one is
// deliberately the opposite and must not be reused for those flows.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { doc, getDoc } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { db } from "../../../../firebase";
import BitBadge from "../../BitBadge";
import { openBitPayment } from "../../bitPayment";
import { payCompletedWork, WorkPaymentInput } from "../workErrandLib";

type Method = "cash" | "bit" | null;

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export default function WorkPaymentScreen() {
  const params = useLocalSearchParams();

  const bookingId = String(params.bookingId || "");
  const amount = num(params.amount);
  const payerName = String(params.payerName || "You");
  const payeeName = String(params.payeeName || "Worker");
  const payeePhone = String(params.payeePhone || "");

  const [loading, setLoading] = useState(true);
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const [method, setMethod] = useState<Method>(null);
  const [processing, setProcessing] = useState(false);

  const handleSelectBit = () => {
    setMethod("bit");
    openBitPayment(payeePhone, amount);
  };

  useEffect(() => {
    let active = true;

    (async () => {
      if (!bookingId) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      try {
        const snap = await getDoc(doc(db, "workApplications", bookingId));

        if (active) {
          if (!snap.exists()) {
            setNotFound(true);
          } else {
            // Protect against duplicate payments — if this job was already
            // paid (e.g. the driver already paid once and came back), don't
            // let them pay again.
            setAlreadyPaid(snap.data().driverPaymentStatus === "paid");
          }

          setLoading(false);
        }
      } catch {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [bookingId]);

  const handleContinue = async () => {
    if (!bookingId || alreadyPaid) return;

    if (!method) {
      Alert.alert("Choose payment", "Please select Cash or Pay with BIT.");
      return;
    }

    const payment: WorkPaymentInput =
      method === "cash" ? { method: "cash" } : { method: "bit" };

    try {
      setProcessing(true);
      await payCompletedWork(bookingId, amount, payment);

      Alert.alert(
        "Payment sent",
        `You paid ${payeeName} ₪${amount}.`,
        [
          {
            text: "OK",
            onPress: () =>
              router.replace({
                pathname: "/(tabs)/bookings",
                params: { tab: "driver" },
              } as any),
          },
        ],
      );
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Could not confirm payment.");
    } finally {
      setProcessing(false);
    }
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

  if (notFound) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={44} color="#8B7B6B" />
          <Text style={styles.emptyTitle}>Booking not found</Text>
          <Pressable style={styles.backLink} onPress={() => router.back()}>
            <Text style={styles.backLinkText}>Go back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (alreadyPaid) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Ionicons name="checkmark-circle-outline" size={54} color="#16A34A" />
          <Text style={styles.emptyTitle}>Already paid</Text>
          <Text style={styles.emptyText}>
            You already paid {payeeName} for this job.
          </Text>
          <Pressable
            style={styles.backLink}
            onPress={() => router.replace("/(tabs)/bookings" as any)}
          >
            <Text style={styles.backLinkText}>Go to My Bookings</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.container}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#7C5F46" />
            <Text style={styles.backText}>Back</Text>
          </Pressable>

          <Text style={styles.title}>Pay Worker</Text>
          <Text style={styles.subtitle}>
            The job is complete — pay {payeeName} for their work.
          </Text>

          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Ionicons name="person-outline" size={15} color="#7C5F46" />
              <Text style={styles.summaryText}>Payment to: {payeeName}</Text>
            </View>

            <View style={styles.summaryRow}>
              <Ionicons name="wallet-outline" size={15} color="#7C5F46" />
              <Text style={styles.summaryText}>Paid by: {payerName}</Text>
            </View>

            <View style={styles.amountRow}>
              <Text style={styles.amountLabel}>Amount</Text>
              <Text style={styles.amountValue}>₪{amount}</Text>
            </View>
          </View>

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
                Cash
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
                Pay with BIT
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
              <Text style={styles.infoText}>
                You&apos;ll pay {payeeName} in cash. Press Continue to confirm.
              </Text>
            </View>
          ) : null}

          {method === "bit" ? (
            <View style={styles.cardForm}>
              <View style={styles.demoBanner}>
                <Ionicons name="information-circle-outline" size={15} color="#B86115" />
                <Text style={styles.demoText}>
                  BIT was opened with {payeePhone || `${payeeName}'s number`}{" "}
                  copied to your clipboard — paste it into BIT&apos;s &quot;Send
                  money to&quot; field, then press Continue below.
                </Text>
              </View>

              <Pressable style={styles.reopenBitButton} onPress={handleSelectBit}>
                <Ionicons name="open-outline" size={16} color="#F58220" />
                <Text style={styles.reopenBitText}>Reopen BIT</Text>
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
              <Text style={styles.continueText}>Continue</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
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
  demoBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFF2E8",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  demoText: {
    color: "#B86115",
    fontWeight: "700",
    fontSize: 13,
    flexShrink: 1,
  },
  reopenBitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1.5,
    borderColor: "#F58220",
    borderRadius: 10,
    paddingVertical: 10,
  },
  reopenBitText: {
    color: "#F58220",
    fontWeight: "900",
    fontSize: 14,
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
  emptyTitle: {
    fontSize: 19,
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
  backLink: {
    marginTop: 16,
  },
  backLinkText: {
    color: "#F58220",
    fontWeight: "900",
    fontSize: 15,
  },
});
