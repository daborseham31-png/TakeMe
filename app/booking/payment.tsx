import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { doc, getDoc } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Alert } from "../AppAlert";
import { useTranslation } from "react-i18next";

import { db } from "../../firebase";
import { useLanguage } from "../i18n/LanguageProvider";
import BitBadge from "./BitBadge";
import { openBitPayment } from "./bitPayment";
import {
  collectionFor,
  confirmPayment,
  isAwaitingPayment,
  NormalizedApplication,
  normalizeApplication,
  WorkErrandKind,
} from "./work-errand/workErrandLib";

type Method = "cash" | "bit" | null;

export default function PaymentScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const params = useLocalSearchParams();
  const kind = (params.kind === "errand" ? "errand" : "work") as WorkErrandKind;
  const id = typeof params.id === "string" ? params.id : "";

  const [app, setApp] = useState<NormalizedApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [method, setMethod] = useState<Method>(null);
  const [processing, setProcessing] = useState(false);

  // The recipient of this payment: the worker (customerPhone, already on
  // the application doc) for "work", or the service provider for "errand" —
  // whose phone isn't stored on the application doc, so it's looked up from
  // their profile once the application loads.
  const [providerPhone, setProviderPhone] = useState("");

  useEffect(() => {
    let active = true;

    (async () => {
      if (!id) {
        setLoading(false);
        return;
      }

      try {
        const snap = await getDoc(doc(db, collectionFor(kind), id));
        if (active) {
          if (snap.exists()) {
            const normalized = normalizeApplication(snap.id, snap.data(), kind);
            setApp(normalized);

            if (kind === "errand" && normalized.providerId) {
              try {
                const providerSnap = await getDoc(
                  doc(db, "users", normalized.providerId),
                );
                if (active && providerSnap.exists()) {
                  setProviderPhone(providerSnap.data().phone || "");
                }
              } catch {
                // Leave providerPhone empty — the BIT button will explain.
              }
            }
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
  }, [id, kind]);

  const amount = app?.price ?? null;
  const perHour = app?.hourlyPay ?? null;

  const recipientPhone = kind === "work" ? app?.customerPhone || "" : providerPhone;

  const handleSelectBit = () => {
    setMethod("bit");
    openBitPayment(recipientPhone, amount);
  };

  const handleContinue = async () => {
    if (!app) return;
    if (!method) {
      Alert.alert(t("rides.choosePaymentTitle"), t("rides.choosePaymentMessage"));
      return;
    }

    const paymentPayload =
      method === "cash" ? { method: "cash" as const } : { method: "bit" as const };

    try {
      setProcessing(true);
      await confirmPayment(kind, app.id, app, paymentPayload);

      Alert.alert(
        t("rides.bookingConfirmedTitle"),
        method === "cash"
          ? t("rides.cashBookingConfirmed")
          : t("rides.mockPaymentConfirmed"),
        [{ text: t("common.ok"), onPress: () => router.replace("/(tabs)/bookings" as any) }],
      );
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("rides.couldNotConfirmPayment"));
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

  if (!app) {
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

  // Guard: payment is only for a driver-accepted booking that hasn't been paid.
  if (!isAwaitingPayment(app.status)) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Ionicons
            name="checkmark-circle-outline"
            size={54}
            color="#16A34A"
          />
          <Text style={styles.emptyTitle}>{t("rides.nothingToPay")}</Text>
          <Text style={styles.emptyText}>{t("rides.notAwaitingPayment")}</Text>
          <Pressable
            style={styles.backLink}
            onPress={() => router.replace("/(tabs)/bookings" as any)}
          >
            <Text style={styles.backLinkText}>{t("rides.goToMyBookings")}</Text>
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
            <Ionicons
              name={isRTL ? "arrow-forward" : "arrow-back"}
              size={22}
              color="#7C5F46"
            />
            <Text style={styles.backText}>{t("common.back")}</Text>
          </Pressable>

          <Text style={styles.title}>{t("rides.paymentTitle")}</Text>
          <Text style={styles.subtitle}>
            {kind === "work"
              ? t("rides.completePaymentWorker")
              : t("rides.confirmErrandBooking")}
          </Text>

          {/* Booking summary */}
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>{app.title}</Text>
            <View style={styles.summaryRow}>
              <Ionicons name="person-outline" size={15} color="#7C5F46" />
              <Text style={styles.summaryText}>
                {kind === "work"
                  ? t("rides.workerLabel", { name: app.customerName })
                  : t("rides.driverLabel", { name: app.providerName })}
              </Text>
            </View>
            {app.date ? (
              <View style={styles.summaryRow}>
                <Ionicons name="calendar-outline" size={15} color="#7C5F46" />
                <Text style={styles.summaryText}>{app.date}</Text>
              </View>
            ) : null}
            {app.startTime || app.endTime ? (
              <View style={styles.summaryRow}>
                <Ionicons name="time-outline" size={15} color="#7C5F46" />
                <Text style={styles.summaryText}>
                  {app.startTime} - {app.endTime}
                </Text>
              </View>
            ) : null}
            <View style={styles.amountRow}>
              <Text style={styles.amountLabel}>{t("rides.amount")}</Text>
              <Text style={styles.amountValue}>
                {amount !== null
                  ? `${amount} ₪`
                  : perHour !== null
                    ? `${perHour} ₪${t("booking.perHourShort")}`
                    : "—"}
              </Text>
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
              <Ionicons name="information-circle-outline" size={18} color="#B86115" />
              <Text style={styles.infoText}>{t("rides.cashInfoText")}</Text>
            </View>
          ) : null}

          {method === "bit" ? (
            <View style={styles.cardForm}>
              <View style={styles.demoBanner}>
                <Ionicons name="information-circle-outline" size={15} color="#B86115" />
                <Text style={styles.demoText}>
                  {t("rides.bitOpenedBanner", {
                    phone: recipientPhone || t("rides.theRecipientsNumber"),
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
