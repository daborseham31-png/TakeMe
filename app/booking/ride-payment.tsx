import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
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
  TextInput,
  View,
} from "react-native";

import { createRideBooking, RidePayment } from "./rideBookingLib";
import { detectCurrentLocation, GeoPoint } from "./work-errand/workErrandLib";

type Method = "cash" | "card" | null;

const num = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const getLast3 = (value: string) => {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 3 ? digits.slice(-3) : digits;
};

export default function RidePaymentScreen() {
  const params = useLocalSearchParams();

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
  const date = String(params.date || "");
  const day = String(params.day || "");
  const time = String(params.time || "");
  const seats = num(params.seats);
  const price = num(params.price);

  const presetLat = num(params.fromLat);
  const presetLng = num(params.fromLng);

  const [method, setMethod] = useState<Method>(null);
  const [processing, setProcessing] = useState(false);

  const [holder, setHolder] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");

  const resolvePickup = async (): Promise<GeoPoint | null> => {
    if (presetLat !== null && presetLng !== null) {
      return { latitude: presetLat, longitude: presetLng, address: from };
    }

    try {
      return await detectCurrentLocation();
    } catch {
      return null;
    }
  };

  const handleContinue = async () => {
    if (!method) {
      Alert.alert("Choose payment", "Please select Cash or Card.");
      return;
    }

    let payment: RidePayment;

    if (method === "cash") {
      payment = { method: "cash" };
    } else {
      const digits = cardNumber.replace(/\D/g, "");

      if (!holder.trim()) {
        Alert.alert("Card details", "Enter the card holder name.");
        return;
      }

      if (digits.length < 12 || digits.length > 19) {
        Alert.alert("Card details", "Enter a valid card number.");
        return;
      }

      if (!/^\d{2}\/\d{2}$/.test(expiry.trim())) {
        Alert.alert("Card details", "Expiry must be in MM/YY format.");
        return;
      }

      if (!/^\d{3,4}$/.test(cvv.trim())) {
        Alert.alert("Card details", "Enter a valid CVV.");
        return;
      }

      payment = { method: "card", cardLast4: digits.slice(-4) };
    }

    try {
      setProcessing(true);

      const pickup = await resolvePickup();

      const bookingId = await createRideBooking({
        driverId,
        driverName,
        driverPhone,

        driverCar,
        driverCarColor,
        driverCarPlateLast3,

        routeId,
        from,
        to,
        date,
        day,
        time,
        seats,
        price,
        pickup,
        payment,
      });

      router.replace({
        pathname: "/booking/ride-success",
        params: { bookingId },
      } as any);
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Could not confirm the booking.");
    } finally {
      setProcessing(false);
    }
  };

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

          <Text style={styles.title}>Payment</Text>
          <Text style={styles.subtitle}>Confirm and pay for your ride</Text>

          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Personal Ride</Text>

            <View style={styles.summaryRow}>
              <Ionicons name="person-outline" size={15} color="#7C5F46" />
              <Text style={styles.summaryText}>Driver: {driverName}</Text>
            </View>

            {driverPhone ? (
              <View style={styles.summaryRow}>
                <Ionicons name="call-outline" size={15} color="#7C5F46" />
                <Text style={styles.summaryText}>{driverPhone}</Text>
              </View>
            ) : null}

            {driverCar ? (
              <View style={styles.summaryRow}>
                <Ionicons name="car-outline" size={15} color="#7C5F46" />
                <Text style={styles.summaryText}>Car: {driverCar}</Text>
              </View>
            ) : null}

            {driverCarColor ? (
              <View style={styles.summaryRow}>
                <Ionicons
                  name="color-palette-outline"
                  size={15}
                  color="#7C5F46"
                />
                <Text style={styles.summaryText}>Color: {driverCarColor}</Text>
              </View>
            ) : null}

            {driverCarPlateLast3 ? (
              <View style={styles.summaryRow}>
                <Ionicons name="barcode-outline" size={15} color="#7C5F46" />
                <Text style={styles.summaryText}>
                  Plate: ***{driverCarPlateLast3}
                </Text>
              </View>
            ) : null}

            <View style={styles.summaryRow}>
              <Ionicons name="location-outline" size={15} color="#7C5F46" />
              <Text style={styles.summaryText}>
                {from || "?"} → {to || "?"}
              </Text>
            </View>

            {date ? (
              <View style={styles.summaryRow}>
                <Ionicons name="calendar-outline" size={15} color="#7C5F46" />
                <Text style={styles.summaryText}>
                  {date}
                  {day ? ` (${day})` : ""}
                </Text>
              </View>
            ) : null}

            {time ? (
              <View style={styles.summaryRow}>
                <Ionicons name="time-outline" size={15} color="#7C5F46" />
                <Text style={styles.summaryText}>{time}</Text>
              </View>
            ) : null}

            {seats !== null ? (
              <View style={styles.summaryRow}>
                <Ionicons name="people-outline" size={15} color="#7C5F46" />
                <Text style={styles.summaryText}>{seats} seats</Text>
              </View>
            ) : null}

            <View style={styles.amountRow}>
              <Text style={styles.amountLabel}>Amount</Text>
              <Text style={styles.amountValue}>
                {price !== null ? `${price} ₪` : "—"}
              </Text>
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
                method === "card" && styles.methodCardActive,
              ]}
              onPress={() => setMethod("card")}
            >
              <Ionicons
                name="card-outline"
                size={26}
                color={method === "card" ? "#F58220" : "#7C5F46"}
              />
              <Text
                style={[
                  styles.methodText,
                  method === "card" && styles.methodTextActive,
                ]}
              >
                Visa / Card
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
                You&apos;ll pay the driver in cash. Press Continue to confirm.
              </Text>
            </View>
          ) : null}

          {method === "card" ? (
            <View style={styles.cardForm}>
              <View style={styles.demoBanner}>
                <Ionicons
                  name="lock-closed-outline"
                  size={15}
                  color="#B86115"
                />
                <Text style={styles.demoText}>
                  Demo only — card details are not charged or stored.
                </Text>
              </View>

              <Text style={styles.label}>Card Holder Name</Text>
              <TextInput
                style={styles.input}
                value={holder}
                onChangeText={setHolder}
                placeholder="Name on card"
                placeholderTextColor="#9B7A68"
              />

              <Text style={styles.label}>Card Number</Text>
              <TextInput
                style={styles.input}
                value={cardNumber}
                onChangeText={(t) =>
                  setCardNumber(t.replace(/\D/g, "").slice(0, 19))
                }
                placeholder="1234 5678 9012 3456"
                placeholderTextColor="#9B7A68"
                keyboardType="number-pad"
              />

              <View style={styles.row}>
                <View style={styles.halfField}>
                  <Text style={styles.label}>Expiry (MM/YY)</Text>
                  <TextInput
                    style={styles.input}
                    value={expiry}
                    onChangeText={setExpiry}
                    placeholder="MM/YY"
                    placeholderTextColor="#9B7A68"
                    maxLength={5}
                  />
                </View>

                <View style={styles.halfField}>
                  <Text style={styles.label}>CVV</Text>
                  <TextInput
                    style={styles.input}
                    value={cvv}
                    onChangeText={(t) =>
                      setCvv(t.replace(/\D/g, "").slice(0, 4))
                    }
                    placeholder="123"
                    placeholderTextColor="#9B7A68"
                    keyboardType="number-pad"
                    secureTextEntry
                  />
                </View>
              </View>
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
  label: {
    fontSize: 14,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 8,
    marginTop: 6,
  },
  input: {
    minHeight: 46,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E4DDD7",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: "#111827",
    marginBottom: 10,
  },
  row: {
    flexDirection: "row",
    gap: 14,
  },
  halfField: {
    flex: 1,
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
});
