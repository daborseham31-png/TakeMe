import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
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
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { auth, db } from "../../firebase";
import BitBadge from "./BitBadge";
import { openBitPayment } from "./bitPayment";
import { isDateTimeExpired } from "./homeFeedLib";
import { RIDE_CATEGORY, RidePayment } from "./rideBookingLib";
import {
  computeWeeklyTotal,
  createWeeklyBookings,
  WeeklyDriverDay,
  WeeklyRequestDay,
} from "./weeklyBookingLib";
import { GeoPoint, notify } from "./work-errand/workErrandLib";

type Method = "cash" | "bit" | null;

const num = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const getLast3 = (value: string) => {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 3 ? digits.slice(-3) : digits;
};

export default function RidePaymentScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams();

  const category = String(params.category || "personal");
  const isSchool = category === "school";

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
  // The exact place within the destination city (optional, Personal Ride
  // only) — informational for the driver, never used for matching.
  const destinationDetails = String(params.destinationDetails || "");
  // School only — the exact school/university name, required at trip
  // creation (see RideForm.tsx).
  const schoolName = String(params.schoolName || "");
  const date = String(params.date || params.tripDate || "");
  const day = String(params.day || params.tripDay || "");
  const time = String(params.time || "");
  const seats = num(params.seats);
  const price = num(params.price);
  const maxSeatsParam = num(params.maxSeats);
  const unitPriceParam = num(params.unitPrice);

  // "Pickup location for driver navigation" — a SEPARATE, optional GPS point
  // from the booking form. Never used for driver matching (that already
  // happened, using from/to text, before this screen). Only ever used to
  // help the driver navigate to the passenger later.
  const presetPickupLat = num(params.pickupLatitude);
  const presetPickupLng = num(params.pickupLongitude);
  const presetPickupAddress = String(params.pickupAddress || "");

  const presetPickup: GeoPoint | null =
    presetPickupLat !== null && presetPickupLng !== null
      ? {
          latitude: presetPickupLat,
          longitude: presetPickupLng,
          address: presetPickupAddress,
        }
      : null;

  const bookingType = String(params.bookingType || "quick");
  const isWeekly = bookingType === "weekly";

  let selectedWeeklyDays: WeeklyDriverDay[] = [];

  try {
    const parsed = JSON.parse(String(params.selectedWeeklyDays || "[]"));
    selectedWeeklyDays = Array.isArray(parsed) ? parsed : [];
  } catch {
    selectedWeeklyDays = [];
  }

  let remainingWeeklyDays: WeeklyRequestDay[] = [];

  try {
    const parsed = JSON.parse(String(params.remainingWeeklyDays || "[]"));
    remainingWeeklyDays = Array.isArray(parsed) ? parsed : [];
  } catch {
    remainingWeeklyDays = [];
  }

  const weeklyTotal = computeWeeklyTotal(selectedWeeklyDays);

  const resultsPassthrough = {
    category: isSchool ? "school" : "personal",
    schoolName: String(params.schoolName || ""),
    from,
    to,
    genderPref: String(params.genderPref || "any"),
    languages: String(params.languages || ""),
  };

  const [method, setMethod] = useState<Method>(null);
  const [processing, setProcessing] = useState(false);

  // The ride's real remaining capacity (falls back to the old fixed `seats`
  // param for any link built before maxSeats existed) and its per-seat price
  // — the seat stepper below lets the passenger pick how many of those seats
  // to book, up to that capacity. Never used for weekly bookings, which keep
  // their own per-day seat counts from the day picker.
  const maxSeatsValue = Math.max(1, maxSeatsParam ?? seats ?? 1);
  const unitPrice = unitPriceParam ?? price ?? 0;
  const [selectedSeats, setSelectedSeats] = useState(1);

  const decreaseSeats = () =>
    setSelectedSeats((prev) => Math.max(1, prev - 1));

  const increaseSeats = () =>
    setSelectedSeats((prev) => Math.min(maxSeatsValue, prev + 1));

  const totalPrice = isWeekly
    ? weeklyTotal
    : Number.isFinite(unitPrice * selectedSeats)
      ? unitPrice * selectedSeats
      : 0;

  const amountDue = totalPrice;

  const handleSelectBit = () => {
    setMethod("bit");
    openBitPayment(driverPhone, amountDue);
  };

  // Pickup GPS is optional — if the passenger never pressed "Use my current
  // location" on the booking form, there is no preset pickup, and none is
  // silently captured here either. Driver navigation then falls back to the
  // manual From address (see driver/ride-navigation.tsx).
  const resolvePickup = async (): Promise<GeoPoint | null> => presetPickup;

  const getPassengerProfile = async () => {
    const user = auth.currentUser;

    if (!user) {
      throw new Error("Please login first.");
    }

    let passengerName = user.displayName || "Passenger";
    let passengerPhone = "";

    try {
      const userSnap = await getDoc(doc(db, "users", user.uid));

      if (userSnap.exists()) {
        const data = userSnap.data();
        passengerName = data.name || passengerName;
        passengerPhone = data.phone || "";
      }
    } catch {
      // keep auth fallback values
    }

    return { user, passengerName, passengerPhone };
  };

const createBookingAfterPayment = async (
  pickup: GeoPoint | null,
  payment: RidePayment,
) => {
  const { user, passengerName, passengerPhone } = await getPassengerProfile();

  if (!routeId) {
    throw new Error(
      "Missing trip id. Please go back and choose the driver again.",
    );
  }

  if (!isWeekly && isDateTimeExpired(date, time)) {
    throw new Error(t("rides.rideExpired"));
  }

  const bookingRef = doc(collection(db, "bookings"));
  const routeRef = doc(db, "driverRoutes", routeId);

  const paymentFields =
    payment.method === "cash"
      ? {
          paymentMethod: "cash",
          paymentStatus: "cash_selected",
          cardLast4: null,
        }
      : payment.method === "bit"
        ? {
            paymentMethod: "bit",
            paymentStatus: "mock_paid",
            cardLast4: null,
          }
        : {
            paymentMethod: "card",
            paymentStatus: "mock_paid",
            cardLast4: payment.cardLast4.slice(-4),
          };

  const cleanPickup =
    pickup &&
    typeof pickup.latitude === "number" &&
    typeof pickup.longitude === "number"
      ? {
          latitude: pickup.latitude,
          longitude: pickup.longitude,
          address: pickup.address || "",
        }
      : null;

  await runTransaction(db, async (transaction) => {
    const routeSnap = await transaction.get(routeRef);

    if (!routeSnap.exists()) {
      throw new Error("This trip is no longer available.");
    }

    const routeData = routeSnap.data();

    const alreadyBooked =
      routeData.status === "booked" ||
      routeData.status === "completed" ||
      routeData.tripStatus === "completed" ||
      routeData.isBooked === true ||
      routeData.available === false ||
      !!routeData.bookingId ||
      !!routeData.bookedBy;

    if (alreadyBooked) {
      throw new Error(t("rides.seatAvailabilityChanged"));
    }

    // Re-check the freshest seat capacity read inside this very transaction
    // — a driver could have reduced the route's declared seats between when
    // this screen loaded and when Continue was pressed.
    if (
      typeof routeData.seats === "number" &&
      selectedSeats > routeData.seats
    ) {
      throw new Error(t("rides.notEnoughSeats"));
    }

    transaction.set(bookingRef, {
      category: isSchool ? "school" : RIDE_CATEGORY,

      passengerId: user.uid,
      passengerName,
      passengerPhone,
      passengerEmail: user.email || "",

      driverId: driverId || null,
      driverName: driverName || "Driver",
      driverPhone: driverPhone || "",

      driverCar,
      driverCarColor,
      driverCarPlateLast3,

      routeId,
      from,
      to,
      schoolName: schoolName || null,
      destinationDetails: destinationDetails || null,
      date,
      day,
      time,

      // This function only ever runs for the non-weekly path (weekly bookings
      // go through createWeeklyBookings instead) — always the passenger's own
      // stepper selection / calculated total, never the old fixed params.
      seats: selectedSeats,
      price: totalPrice,
      pricePerSeat: unitPrice,

      // Existing fields — already read by driver navigation / live tracking
      // (app/driver/ride-navigation.tsx, app/booking/live-tracking.tsx).
      pickup: cleanPickup,
      pickupCoords: cleanPickup
        ? {
            latitude: cleanPickup.latitude,
            longitude: cleanPickup.longitude,
          }
        : null,
      passengerPickupLocation: cleanPickup,

      // Same data, explicit field names. This is the SEPARATE navigation
      // pickup point — never defaulted to `from` (the matching field): when
      // no GPS pickup was captured, these simply stay null and driver
      // navigation falls back to the manual From address itself.
      pickupAddress: cleanPickup?.address || null,
      pickupLatitude: cleanPickup?.latitude ?? null,
      pickupLongitude: cleanPickup?.longitude ?? null,
      pickupLocation: cleanPickup
        ? { latitude: cleanPickup.latitude, longitude: cleanPickup.longitude }
        : null,

      ...paymentFields,

      // مهم جدًا:
      // بعد الدفع الرحلة تكون محجوزة فقط، مش منتهية.
      status: isSchool ? "ongoing" : "booked",
      tripStatus: "booked",
      trackingEnabled: false,

      driverLocation: null,
      driverLocationUpdatedAt: null,

      // مهم جدًا:
      // التقييم ممنوع يطلع بعد الدفع.
      // يصير true فقط لما السائق يكبس End Trip.
      needsPassengerRating: false,
      ratingSubmitted: false,
      rating: null,
      reviewComment: "",
      ratedAt: null,

      finishedByDriver: false,

      roleType: "passenger_booking",
      deletedForPassenger: false,
      deletedForDriver: false,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),

      startedAt: null,
      arrivedAt: null,
      completedAt: null,
    });

    transaction.update(routeRef, {
      status: "booked",
      tripStatus: "booked",
      isBooked: true,
      available: false,
      bookingId: bookingRef.id,
      bookedBy: user.uid,
      bookedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  if (driverId) {
    await notify({
      receiverId: driverId,
      senderId: user.uid,
      type: isSchool ? "school_ride_booking" : "personal_ride_booking",
      title: "New ride booking",
      message: `${passengerName} booked a ride with you (${selectedSeats} seat${
        selectedSeats > 1 ? "s" : ""
      }, ₪${totalPrice})`,
      applicationId: bookingRef.id,
      bookingId: bookingRef.id,
      category: isSchool ? "school" : RIDE_CATEGORY,
      status: "booked",
      targetTab: "driver",
    });
  }

  return bookingRef.id;
};

  const handleContinue = async () => {
    if (!method) {
      Alert.alert("Choose payment", "Please select Cash or Pay with BIT.");
      return;
    }

    const payment: RidePayment =
      method === "cash" ? { method: "cash" } : { method: "bit" };

    if (isWeekly) {
      try {
        setProcessing(true);

        await createWeeklyBookings({
          category: isSchool ? "school" : "personal",

          driverId,
          driverName,
          driverPhone,

          driverCar,
          driverCarColor,
          driverCarPlateLast3,

          routeId,
          from,
          to,
          schoolName,
          destinationDetails,
          pickup: presetPickup,

          selectedDays: selectedWeeklyDays,
          payment,
        });

        if (remainingWeeklyDays.length > 0) {
          Alert.alert(
            "Some days still need a driver",
            "Please choose another driver for the remaining days.",
            [
              {
                text: "OK",
                onPress: () =>
                  router.replace({
                    pathname: "/booking/driverresults",
                    params: {
                      ...resultsPassthrough,
                      bookingType: "weekly",
                      weeklyDays: JSON.stringify(remainingWeeklyDays),
                    },
                  } as any),
              },
            ],
          );
          return;
        }

        router.replace({
          pathname: "/(tabs)/bookings",
          params: { tab: "passenger" },
        } as any);
      } catch (error: any) {
        Alert.alert(
          "Error",
          error?.message || "Could not confirm the booking.",
        );
      } finally {
        setProcessing(false);
      }

      return;
    }

    try {
      setProcessing(true);
      const pickup = await resolvePickup();
      await createBookingAfterPayment(pickup, payment);

      router.replace({
        pathname: "/(tabs)/bookings",
        params: { tab: "passenger" },
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
            <Text style={styles.summaryTitle}>
              {isSchool ? "School Ride" : "Personal Ride"}
            </Text>

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

            {schoolName ? (
              <View style={styles.summaryRow}>
                <Ionicons name="school-outline" size={15} color="#7C5F46" />
                <Text style={styles.summaryText}>{schoolName}</Text>
              </View>
            ) : null}

            {destinationDetails ? (
              <View style={styles.summaryRow}>
                <Ionicons name="flag-outline" size={15} color="#7C5F46" />
                <Text style={styles.summaryText}>{destinationDetails}</Text>
              </View>
            ) : null}

            {!isWeekly && date ? (
              <View style={styles.summaryRow}>
                <Ionicons name="calendar-outline" size={15} color="#7C5F46" />
                <Text style={styles.summaryText}>
                  {date}
                  {day ? ` (${day})` : ""}
                </Text>
              </View>
            ) : null}

            {!isWeekly && time ? (
              <View style={styles.summaryRow}>
                <Ionicons name="time-outline" size={15} color="#7C5F46" />
                <Text style={styles.summaryText}>{time}</Text>
              </View>
            ) : null}

            {isWeekly ? (
              <View style={styles.weeklyDaysBox}>
                <Text style={styles.weeklyDaysTitle}>Selected days</Text>

                {selectedWeeklyDays.map((dayItem) => (
                  <View key={dayItem.date} style={styles.weeklyDayRow}>
                    <Ionicons
                      name="calendar-outline"
                      size={15}
                      color="#7C5F46"
                    />
                    <Text style={styles.summaryText}>
                      {dayItem.dayName} — {dayItem.date} · {dayItem.time} ·{" "}
                      {dayItem.seats} seats · {dayItem.price} ₪
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.amountRow}>
              <Text style={styles.amountLabel}>Amount</Text>
              <Text style={styles.amountValue}>
                {isWeekly ? `${weeklyTotal} ₪` : `${totalPrice} ₪`}
              </Text>
            </View>

            {isWeekly ? (
              <Text style={styles.weeklyHint}>
                Card total = price × seats, summed across selected days. For
                cash, pay each day directly to the driver.
              </Text>
            ) : null}
          </View>

          {!isWeekly ? (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>{t("rides.numberOfSeats")}</Text>

              <View style={styles.seatStepperRow}>
                <Pressable
                  style={[
                    styles.seatButton,
                    selectedSeats <= 1 && styles.seatButtonDisabled,
                  ]}
                  onPress={decreaseSeats}
                  disabled={selectedSeats <= 1}
                  hitSlop={8}
                >
                  <Ionicons
                    name="remove"
                    size={20}
                    color={selectedSeats <= 1 ? "#C9BBAE" : "#111827"}
                  />
                </Pressable>

                <Text style={styles.seatCountText}>{selectedSeats}</Text>

                <Pressable
                  style={[
                    styles.seatButton,
                    selectedSeats >= maxSeatsValue && styles.seatButtonDisabled,
                  ]}
                  onPress={increaseSeats}
                  disabled={selectedSeats >= maxSeatsValue}
                  hitSlop={8}
                >
                  <Ionicons
                    name="add"
                    size={20}
                    color={selectedSeats >= maxSeatsValue ? "#C9BBAE" : "#111827"}
                  />
                </Pressable>
              </View>

              <Text style={styles.seatAvailableHint}>
                {t("rides.seatsAvailableCount", { count: maxSeatsValue })}
              </Text>

              <View style={styles.priceSummaryBox}>
                <Text style={styles.priceSummaryTitle}>
                  {t("rides.paymentSummary")}
                </Text>

                <View style={styles.priceSummaryRow}>
                  <Text style={styles.priceSummaryLabel}>
                    {t("rides.pricePerSeat")}
                  </Text>
                  <Text style={styles.priceSummaryValue}>₪{unitPrice}</Text>
                </View>

                <View style={styles.priceSummaryRow}>
                  <Text style={styles.priceSummaryLabel}>
                    {t("rides.numberOfSeats")}
                  </Text>
                  <Text style={styles.priceSummaryValue}>{selectedSeats}</Text>
                </View>

                <View style={[styles.priceSummaryRow, styles.priceSummaryTotalRow]}>
                  <Text style={styles.priceSummaryTotalLabel}>
                    {t("rides.totalPrice")}
                  </Text>
                  <Text style={styles.priceSummaryTotalValue}>
                    ₪{totalPrice}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

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
                You&apos;ll pay the driver in cash. Press Continue to confirm.
              </Text>
            </View>
          ) : null}

          {method === "bit" ? (
            <View style={styles.cardForm}>
              <View style={styles.demoBanner}>
                <Ionicons
                  name="information-circle-outline"
                  size={15}
                  color="#B86115"
                />
                <Text style={styles.demoText}>
                  BIT was opened with {driverPhone || "the driver's number"}{" "}
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
  weeklyDaysBox: {
    marginTop: 4,
    marginBottom: 4,
    gap: 6,
  },
  weeklyDaysTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 2,
  },
  weeklyDayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  weeklyHint: {
    color: "#7C5F46",
    fontSize: 12,
    marginTop: 8,
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
  seatStepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
    marginTop: 4,
    marginBottom: 10,
  },
  seatButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    backgroundColor: "#FFFDFC",
    alignItems: "center",
    justifyContent: "center",
  },
  seatButtonDisabled: {
    opacity: 0.5,
  },
  seatCountText: {
    fontSize: 26,
    fontWeight: "900",
    color: "#111827",
    minWidth: 40,
    textAlign: "center",
  },
  seatAvailableHint: {
    textAlign: "center",
    color: "#7C5F46",
    fontSize: 12.5,
    fontWeight: "700",
    marginBottom: 16,
  },
  priceSummaryBox: {
    backgroundColor: "#FFF8F2",
    borderWidth: 1,
    borderColor: "#F0DFC8",
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  priceSummaryTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 4,
  },
  priceSummaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  priceSummaryLabel: {
    color: "#7C5F46",
    fontSize: 13.5,
    fontWeight: "700",
  },
  priceSummaryValue: {
    color: "#111827",
    fontSize: 13.5,
    fontWeight: "900",
  },
  priceSummaryTotalRow: {
    borderTopWidth: 1,
    borderTopColor: "#F0DFC8",
    paddingTop: 8,
    marginTop: 2,
  },
  priceSummaryTotalLabel: {
    color: "#111827",
    fontSize: 15,
    fontWeight: "900",
  },
  priceSummaryTotalValue: {
    color: "#F58220",
    fontSize: 17,
    fontWeight: "900",
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
});
