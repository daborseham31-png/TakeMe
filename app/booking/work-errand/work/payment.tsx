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
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { db } from "../../../../firebase";
import { DirectionalScreen } from "../../../i18n/DirectionalPrimitives";
import { useLanguage } from "../../../i18n/LanguageProvider";
import BitBadge from "../../BitBadge";
import { openBitPayment } from "../../bitPayment";
import { payCompletedWork, WorkPaymentInput } from "../workErrandLib";

type Method = "cash" | "bit" | null;

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export default function WorkPaymentScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
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
      Alert.alert(t("rides.choosePaymentTitle"), t("rides.choosePaymentMessage"));
      return;
    }

    const payment: WorkPaymentInput =
      method === "cash" ? { method: "cash" } : { method: "bit" };

    try {
      setProcessing(true);
      await payCompletedWork(bookingId, amount, payment);

      Alert.alert(
        t("workErrand.paymentSentTitle"),
        t("workErrand.paidAmountMessage", { name: payeeName, amount }),
        [
          {
            text: t("common.ok"),
            onPress: () =>
              router.replace({
                pathname: "/(tabs)/bookings",
                params: { tab: "driver" },
              } as any),
          },
        ],
      );
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("rides.couldNotConfirmPayment"));
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <DirectionalScreen style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#F58220" />
        </View>
      </DirectionalScreen>
    );
  }

  if (notFound) {
    return (
      <DirectionalScreen style={styles.safe}>
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={44} color="#8B7B6B" />
          <Text style={styles.emptyTitle}>{t("rides.bookingNotFound")}</Text>
          <Pressable style={styles.backLink} onPress={() => router.back()}>
            <Text style={styles.backLinkText}>{t("common.goBack")}</Text>
          </Pressable>
        </View>
      </DirectionalScreen>
    );
  }

  if (alreadyPaid) {
    return (
      <DirectionalScreen style={styles.safe}>
        <View style={styles.center}>
          <Ionicons name="checkmark-circle-outline" size={54} color="#16A34A" />
          <Text style={styles.emptyTitle}>{t("workErrand.alreadyPaidTitle")}</Text>
          <Text style={styles.emptyText}>
            {t("workErrand.alreadyPaidMessage", { name: payeeName })}
          </Text>
          <Pressable
            style={styles.backLink}
            onPress={() => router.replace("/(tabs)/bookings" as any)}
          >
            <Text style={styles.backLinkText}>{t("rides.goToMyBookings")}</Text>
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

          <Text style={styles.title}>{t("workErrand.payWorkerTitle")}</Text>
          <Text style={styles.subtitle}>
            {t("workErrand.payWorkerSubtitle", { name: payeeName })}
          </Text>

          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Ionicons name="person-outline" size={15} color="#7C5F46" />
              <Text style={styles.summaryText}>
                {t("workErrand.paymentToLabel", { name: payeeName })}
              </Text>
            </View>

            <View style={styles.summaryRow}>
              <Ionicons name="wallet-outline" size={15} color="#7C5F46" />
              <Text style={styles.summaryText}>
                {t("workErrand.paidByLabel", { name: payerName })}
              </Text>
            </View>

            <View style={styles.amountRow}>
              <Text style={styles.amountLabel}>{t("rides.amount")}</Text>
              <Text style={styles.amountValue}>₪{amount}</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>{t("rides.paymentMethod")}</Text>

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
              <Text style={styles.infoText}>
                {t("workErrand.cashInfoTextNamed", { name: payeeName })}
              </Text>
            </View>
          ) : null}

          {method === "bit" ? (
            <View style={styles.cardForm}>
              <View style={styles.demoBanner}>
                <Ionicons name="information-circle-outline" size={15} color="#B86115" />
                <Text style={styles.demoText}>
                  {t("rides.bitOpenedBanner", {
                    phone: payeePhone || t("workErrand.theirNumber", { name: payeeName }),
                  })}
                </Text>
              </View>

              <Pressable style={styles.reopenBitButton} onPress={handleSelectBit}>
                <Ionicons name="open-outline" size={16} color="#F58220" />
                <Text style={styles.reopenBitText}>{t("rides.reopenBit")}</Text>
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
