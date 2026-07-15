import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  cancelRide,
  ConnectedBookingRow,
  getConnectedBookings,
  getRideById,
  removeRide,
  restoreRide,
} from "../../adminRidesLib";
import { AdminRideRow } from "../../adminTypes";
import { adminColors, adminRadius, adminSpacing } from "../../adminTheme";
import AdminScreen from "../../components/AdminScreen";
import { LoadingState } from "../../components/AdminStates";
import ConfirmModal from "../../components/ConfirmModal";

type PendingAction = "cancel" | "remove" | "restore" | null;

export default function AdminRideDetailScreen() {
  const params = useLocalSearchParams();
  const source = String(params.source || "driverRoutes") as AdminRideRow["source"];
  const id = String(params.id || "");

  const [ride, setRide] = useState<AdminRideRow | null>(null);
  const [bookings, setBookings] = useState<ConnectedBookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const rideData = await getRideById(source, id);
      setRide(rideData);

      if (rideData) {
        const connected = await getConnectedBookings(rideData);
        setBookings(connected);
      }
    } finally {
      setLoading(false);
    }
  }, [source, id]);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async (reason: string) => {
    if (!ride || !pendingAction || busy) return;

    try {
      setBusy(true);

      if (pendingAction === "cancel") {
        await cancelRide(ride, reason);
      } else if (pendingAction === "remove") {
        await removeRide(ride, reason);
      } else {
        await restoreRide(ride);
      }

      setPendingAction(null);
      await load();
      Alert.alert("Success", "The ride was updated.");
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Could not update this ride.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <AdminScreen title="Ride Details">
        <LoadingState label="Loading ride..." />
      </AdminScreen>
    );
  }

  if (!ride) {
    return (
      <AdminScreen title="Ride Details">
        <View style={styles.center}>
          <Text style={styles.notFoundText}>This ride could not be found.</Text>
        </View>
      </AdminScreen>
    );
  }

  return (
    <AdminScreen title="Ride Details">
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerCard}>
          <View style={styles.pill}>
            <Text style={styles.pillText}>{ride.category}</Text>
          </View>
          <Text style={styles.title}>
            {ride.title || `${ride.from} → ${ride.to}`}
          </Text>
          <Text style={styles.status}>Status: {ride.status}</Text>
        </View>

        <View style={styles.section}>
          <Row icon="person-outline" label="Driver" value={ride.driverName} />
          {ride.from ? <Row icon="navigate-outline" label="From" value={ride.from} /> : null}
          {ride.to ? <Row icon="flag-outline" label="To" value={ride.to} /> : null}
          <Row icon="calendar-outline" label="Date" value={ride.date || "—"} />
          <Row icon="time-outline" label="Time" value={ride.time || "—"} />
          <Row
            icon="cash-outline"
            label="Price"
            value={ride.price !== null ? `₪${ride.price}` : "—"}
          />
          <Row
            icon="people-outline"
            label="Seats"
            value={
              ride.seats !== null
                ? `${ride.seats}${ride.totalSeats !== null ? ` / ${ride.totalSeats}` : ""}`
                : "—"
            }
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Connected bookings ({bookings.length})
          </Text>

          {bookings.length === 0 ? (
            <Text style={styles.emptyConnected}>No one has booked this yet.</Text>
          ) : (
            bookings.map((booking) => (
              <View key={booking.id} style={styles.bookingRow}>
                <Ionicons name="person-circle-outline" size={18} color={adminColors.textMuted} />
                <Text style={styles.bookingName}>{booking.personName}</Text>
                <Text style={styles.bookingStatus}>{booking.status}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.actions}>
          {ride.status !== "cancelled" ? (
            <ActionButton
              icon="close-circle-outline"
              label="Cancel ride"
              tone="danger"
              onPress={() => setPendingAction("cancel")}
            />
          ) : null}

          {!ride.removed ? (
            <ActionButton
              icon="trash-outline"
              label="Remove inappropriate ride"
              tone="danger"
              onPress={() => setPendingAction("remove")}
            />
          ) : (
            <ActionButton
              icon="refresh-outline"
              label="Restore ride"
              tone="success"
              onPress={() => setPendingAction("restore")}
            />
          )}
        </View>
      </ScrollView>

      <ConfirmModal
        visible={!!pendingAction}
        title={
          pendingAction === "cancel"
            ? "Cancel this ride?"
            : pendingAction === "remove"
              ? "Remove this ride?"
              : "Restore this ride?"
        }
        message={
          pendingAction === "cancel"
            ? "The driver and every affected passenger/applicant will be notified."
            : pendingAction === "remove"
              ? "This hides the listing from everyone. You can restore it later."
              : "This makes the listing visible and bookable again."
        }
        confirmLabel={pendingAction === "restore" ? "Restore" : "Confirm"}
        destructive={pendingAction !== "restore"}
        requireReason={pendingAction === "cancel" || pendingAction === "remove"}
        busy={busy}
        onCancel={() => setPendingAction(null)}
        onConfirm={runAction}
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

const ActionButton = ({
  icon,
  label,
  tone,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tone: "danger" | "success";
  onPress: () => void;
}) => (
  <Pressable
    style={[styles.actionButton, tone === "danger" ? styles.actionDanger : styles.actionSuccess]}
    onPress={onPress}
  >
    <Ionicons name={icon} size={18} color={tone === "danger" ? adminColors.danger : adminColors.success} />
    <Text style={[styles.actionText, { color: tone === "danger" ? adminColors.danger : adminColors.success }]}>
      {label}
    </Text>
  </Pressable>
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
  pill: {
    alignSelf: "flex-start",
    backgroundColor: adminColors.warningBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: adminRadius.pill,
    marginBottom: 8,
  },
  pillText: {
    fontSize: 11.5,
    fontWeight: "800",
    color: adminColors.primaryDark,
    textTransform: "capitalize",
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
  sectionTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: adminColors.text,
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
  },
  emptyConnected: {
    color: adminColors.textMuted,
    fontSize: 13,
  },
  bookingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
  },
  bookingName: {
    flex: 1,
    color: adminColors.text,
    fontWeight: "700",
    fontSize: 13,
  },
  bookingStatus: {
    color: adminColors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  actions: {
    gap: 10,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: adminColors.card,
    borderWidth: 1,
    borderColor: adminColors.border,
    borderRadius: adminRadius.md,
    padding: 14,
  },
  actionDanger: {
    borderColor: adminColors.danger,
    backgroundColor: adminColors.dangerBg,
  },
  actionSuccess: {
    borderColor: adminColors.success,
    backgroundColor: adminColors.successBg,
  },
  actionText: {
    fontSize: 14,
    fontWeight: "800",
  },
});
