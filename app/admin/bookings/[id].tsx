import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { doc, onSnapshot } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { db } from "../../../firebase";
import { cancelBooking } from "../adminBookingsLib";
import { AdminBookingRow } from "../adminTypes";
import { adminColors, adminRadius, adminSpacing } from "../adminTheme";
import AdminScreen from "../components/AdminScreen";
import { LoadingState } from "../components/AdminStates";
import ConfirmModal from "../components/ConfirmModal";

const toSeconds = (value: unknown): number => {
  const timestamp = value as { seconds?: number } | undefined;
  return timestamp?.seconds || 0;
};

export default function AdminBookingDetailScreen() {
  const params = useLocalSearchParams();
  const bookingId = String(params.id || "");

  const [booking, setBooking] = useState<(AdminBookingRow & { passengerId: string; driverId: string }) | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bookingId) {
      setLoading(false);
      setNotFound(true);
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, "bookings", bookingId),
      (snap) => {
        if (!snap.exists()) {
          setNotFound(true);
          setBooking(null);
        } else {
          const data = snap.data();
          setBooking({
            id: snap.id,
            category: data.category || "",
            passengerId: data.passengerId || "",
            passengerName: data.passengerName || "Passenger",
            driverId: data.driverId || "",
            driverName: data.driverName || "Driver",
            from: data.from || "",
            to: data.to || "",
            date: data.date || "",
            time: data.time || "",
            seats: typeof data.seats === "number" ? data.seats : null,
            price: typeof data.price === "number" ? data.price : null,
            status: data.status || "",
            paymentStatus: data.paymentStatus || "",
            paymentMethod: data.paymentMethod || "",
            routeId: data.routeId || "",
            createdAtSeconds: toSeconds(data.createdAt),
          });
        }
        setLoading(false);
      },
      () => {
        setNotFound(true);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [bookingId]);

  const handleCancel = async (reason: string) => {
    if (busy) return;

    try {
      setBusy(true);
      await cancelBooking(bookingId, reason);
      setConfirmVisible(false);
      Alert.alert("Success", "The booking was cancelled.");
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Could not cancel this booking.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <AdminScreen title="Booking Details">
        <LoadingState label="Loading booking..." />
      </AdminScreen>
    );
  }

  if (notFound || !booking) {
    return (
      <AdminScreen title="Booking Details">
        <View style={styles.center}>
          <Text style={styles.notFoundText}>This booking could not be found.</Text>
        </View>
      </AdminScreen>
    );
  }

  const canCancel = !["cancelled", "completed", "completed_paid"].includes(booking.status);

  return (
    <AdminScreen title="Booking Details">
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerCard}>
          <Text style={styles.title}>
            {booking.from || "?"} {booking.to ? `→ ${booking.to}` : ""}
          </Text>
          <Text style={styles.status}>Status: {booking.status || "—"}</Text>
        </View>

        <View style={styles.section}>
          <Row icon="calendar-outline" label="Date" value={booking.date || "—"} />
          <Row icon="time-outline" label="Time" value={booking.time || "—"} />
          <Row
            icon="people-outline"
            label="Seats"
            value={booking.seats !== null ? String(booking.seats) : "—"}
          />
          <Row
            icon="cash-outline"
            label="Price"
            value={booking.price !== null ? `₪${booking.price}` : "—"}
          />
          <Row
            icon="card-outline"
            label="Payment"
            value={`${booking.paymentStatus || "unpaid"}${
              booking.paymentMethod ? ` (${booking.paymentMethod})` : ""
            }`}
          />
        </View>

        <View style={styles.section}>
          <Pressable
            style={styles.linkRow}
            onPress={() =>
              booking.passengerId && router.push(`/admin/users/${booking.passengerId}` as any)
            }
          >
            <Ionicons name="person-outline" size={16} color={adminColors.textMuted} />
            <Text style={styles.linkLabel}>Passenger</Text>
            <Text style={styles.linkValue}>{booking.passengerName}</Text>
            <Ionicons name="chevron-forward" size={16} color={adminColors.placeholder} />
          </Pressable>

          <Pressable
            style={styles.linkRow}
            onPress={() => booking.driverId && router.push(`/admin/users/${booking.driverId}` as any)}
          >
            <Ionicons name="car-outline" size={16} color={adminColors.textMuted} />
            <Text style={styles.linkLabel}>Driver</Text>
            <Text style={styles.linkValue}>{booking.driverName}</Text>
            <Ionicons name="chevron-forward" size={16} color={adminColors.placeholder} />
          </Pressable>

          {booking.routeId ? (
            <Pressable
              style={styles.linkRow}
              onPress={() => router.push(`/admin/rides/driverRoutes/${booking.routeId}` as any)}
            >
              <Ionicons name="navigate-outline" size={16} color={adminColors.textMuted} />
              <Text style={styles.linkLabel}>Ride listing</Text>
              <Text style={styles.linkValue}>View</Text>
              <Ionicons name="chevron-forward" size={16} color={adminColors.placeholder} />
            </Pressable>
          ) : null}
        </View>

        {canCancel ? (
          <Pressable style={styles.cancelButton} onPress={() => setConfirmVisible(true)}>
            <Ionicons name="close-circle-outline" size={18} color={adminColors.danger} />
            <Text style={styles.cancelText}>Cancel booking</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <ConfirmModal
        visible={confirmVisible}
        title="Cancel this booking?"
        message="Seat availability will be restored and both the passenger and driver will be notified."
        confirmLabel="Cancel booking"
        requireReason
        busy={busy}
        onCancel={() => setConfirmVisible(false)}
        onConfirm={handleCancel}
      />
    </AdminScreen>
  );
}

const Row = ({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) => (
  <View style={styles.row}>
    <Ionicons name={icon} size={16} color={adminColors.textMuted} />
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={styles.rowValue} numberOfLines={1}>
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  scroll: {
    padding: adminSpacing.lg,
    paddingBottom: 60,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: adminSpacing.lg,
  },
  notFoundText: {
    color: adminColors.textMuted,
    fontWeight: "700",
  },
  headerCard: {
    backgroundColor: adminColors.card,
    borderWidth: 1,
    borderColor: adminColors.border,
    borderRadius: adminRadius.lg,
    padding: adminSpacing.lg,
    marginBottom: adminSpacing.md,
  },
  title: {
    fontSize: 18,
    fontWeight: "900",
    color: adminColors.text,
  },
  status: {
    fontSize: 13,
    color: adminColors.textMuted,
    fontWeight: "700",
    marginTop: 4,
    textTransform: "capitalize",
  },
  section: {
    backgroundColor: adminColors.card,
    borderWidth: 1,
    borderColor: adminColors.border,
    borderRadius: adminRadius.lg,
    padding: adminSpacing.md,
    marginBottom: adminSpacing.md,
    gap: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowLabel: {
    color: adminColors.textMuted,
    fontWeight: "700",
    fontSize: 13,
    width: 90,
  },
  rowValue: {
    flex: 1,
    color: adminColors.text,
    fontWeight: "700",
    fontSize: 13,
    textTransform: "capitalize",
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
  },
  linkLabel: {
    color: adminColors.textMuted,
    fontWeight: "700",
    fontSize: 13,
    width: 90,
  },
  linkValue: {
    flex: 1,
    color: adminColors.primary,
    fontWeight: "800",
    fontSize: 13,
  },
  cancelButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: adminColors.dangerBg,
    borderWidth: 1,
    borderColor: adminColors.danger,
    borderRadius: adminRadius.md,
    padding: 14,
  },
  cancelText: {
    color: adminColors.danger,
    fontWeight: "900",
  },
});
