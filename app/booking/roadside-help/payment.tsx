import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type PaymentMethod = "card" | "cash";

const formatCardNumber = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 16);
  return digits.replace(/(.{4})/g, "$1 ").trim();
};

const formatExpiry = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length > 2) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return digits;
};

export default function RoadsideHelpPaymentScreen() {
  const params = useLocalSearchParams();

  const problemLabel = String(params.problemLabel || "Roadside Help");
  const description = String(params.description || "");
  const address = String(params.address || "");
  const lat = String(params.lat || "");
  const lng = String(params.lng || "");
  const helperName = String(params.helperName || "Your helper");
  const helperSpecialty = String(params.helperSpecialty || "");
  const helperEta = String(params.helperEta || "");
  const helperPrice = Number(params.helperPrice) || 0;

  const [method, setMethod] = useState<PaymentMethod>("card");
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");
  const [processing, setProcessing] = useState(false);

  const cardComplete =
    cardNumber.replace(/\s/g, "").length === 16 &&
    expiry.length === 5 &&
    cvc.length === 3;

  const canPay = method === "cash" || cardComplete;

  const handlePay = () => {
    if (!canPay || processing) return;

    setProcessing(true);

    // Simulate processing the payment, then continue to live tracking.
    setTimeout(() => {
      setProcessing(false);
      router.replace({
        pathname: "/booking/roadside-help/map",
        params: {
          problemLabel,
          address,
          lat,
          lng,
          helperName,
          helperEta,
          paymentMethod: method,
        },
      } as any);
    }, 1500);
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#7C5F46" />
          <Text style={styles.backText}>Back</Text>
        </Pressable>

        <Text style={styles.title}>Payment</Text>

        {/* Trip summary */}
        <View style={styles.card}>
          <View style={styles.cardTitleRow}>
            <Ionicons name="checkmark-circle" size={20} color="#F58220" />
            <Text style={styles.cardTitle}>Trip Summary</Text>
          </View>

          <View style={styles.summaryRow}>
            <Ionicons name="construct-outline" size={16} color="#7C5F46" />
            <Text style={styles.summaryStrong}>{helperName}</Text>
            {helperSpecialty ? (
              <Text style={styles.summaryMuted}>— {helperSpecialty}</Text>
            ) : null}
          </View>

          {address ? (
            <View style={styles.summaryRow}>
              <Ionicons name="location-outline" size={16} color="#7C5F46" />
              <Text style={styles.summaryText}>{address}</Text>
            </View>
          ) : null}

          {helperEta ? (
            <View style={styles.summaryRow}>
              <Ionicons name="time-outline" size={16} color="#7C5F46" />
              <Text style={styles.summaryText}>{helperEta} min</Text>
            </View>
          ) : null}

          <View style={styles.summaryRow}>
            <Ionicons name="build-outline" size={16} color="#7C5F46" />
            <Text style={styles.summaryText}>{problemLabel}</Text>
          </View>

          {description ? (
            <View style={styles.summaryRow}>
              <Text style={styles.noteEmoji}>📝</Text>
              <Text style={styles.summaryMuted}>{description}</Text>
            </View>
          ) : null}

          <View style={styles.divider} />

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{helperPrice} ₪</Text>
          </View>
        </View>

        {/* Payment method */}
        <View style={styles.card}>
          <View style={styles.cardTitleRow}>
            <Ionicons name="card-outline" size={20} color="#F58220" />
            <Text style={styles.cardTitle}>Payment Method</Text>
          </View>

          <View style={styles.methodRow}>
            <Pressable
              style={[
                styles.methodButton,
                method === "card" && styles.methodButtonActive,
              ]}
              onPress={() => setMethod("card")}
            >
              <Ionicons
                name="card"
                size={18}
                color={method === "card" ? "#FFFFFF" : "#7C5F46"}
              />
              <Text
                style={[
                  styles.methodText,
                  method === "card" && styles.methodTextActive,
                ]}
              >
                Credit Card
              </Text>
            </Pressable>

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
          </View>

          {method === "card" && (
            <View style={styles.cardFields}>
              <Text style={styles.fieldLabel}>Card Number</Text>
              <TextInput
                style={styles.input}
                placeholder="1234 5678 9012 3456"
                placeholderTextColor="#8B7B6B"
                keyboardType="number-pad"
                maxLength={19}
                value={cardNumber}
                onChangeText={(text) => setCardNumber(formatCardNumber(text))}
              />

              <View style={styles.twoColumns}>
                <View style={styles.column}>
                  <Text style={styles.fieldLabel}>Expiry</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="MM/YY"
                    placeholderTextColor="#8B7B6B"
                    keyboardType="number-pad"
                    maxLength={5}
                    value={expiry}
                    onChangeText={(text) => setExpiry(formatExpiry(text))}
                  />
                </View>

                <View style={styles.column}>
                  <Text style={styles.fieldLabel}>CVC</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="123"
                    placeholderTextColor="#8B7B6B"
                    keyboardType="number-pad"
                    maxLength={3}
                    secureTextEntry
                    value={cvc}
                    onChangeText={(text) =>
                      setCvc(text.replace(/\D/g, "").slice(0, 3))
                    }
                  />
                </View>
              </View>
            </View>
          )}
        </View>

        <View style={styles.secureRow}>
          <Ionicons name="shield-checkmark-outline" size={16} color="#7C5F46" />
          <Text style={styles.secureText}>
            Your payment is secure and encrypted
          </Text>
        </View>

        <Pressable
          style={[styles.payButton, !canPay && styles.payButtonDisabled]}
          onPress={handlePay}
          disabled={!canPay || processing}
        >
          {processing ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="card-outline" size={20} color="#FFFFFF" />
              <Text style={styles.payText}>Pay {helperPrice} ₪</Text>
            </>
          )}
        </Pressable>
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
    fontSize: 28,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 20,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
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
  },
  summaryText: {
    color: "#111827",
    fontSize: 14,
    fontWeight: "600",
    flexShrink: 1,
  },
  summaryMuted: {
    color: "#7C5F46",
    fontSize: 14,
    flexShrink: 1,
  },
  noteEmoji: {
    fontSize: 14,
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
  cardFields: {
    marginTop: 16,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 8,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    backgroundColor: "#FFFDFC",
    color: "#111827",
    fontWeight: "700",
  },
  twoColumns: {
    flexDirection: "row",
    gap: 12,
  },
  column: {
    flex: 1,
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
