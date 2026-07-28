import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "../../../router/expoRouterShim";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

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
import { translateCategoryLabel, translateStatus } from "../../../i18n/formatters";

type PendingAction = "cancel" | "remove" | "restore" | null;

export default function AdminRideDetailScreen() {
  const { t } = useTranslation();
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
      Alert.alert(t("admin.successTitle"), t("admin.rideUpdatedMessage"));
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("admin.couldNotUpdateRide"));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <AdminScreen title={t("admin.rideDetailsTitle")}>
        <LoadingState label={t("admin.loadingRideLabel")} />
      </AdminScreen>
    );
  }

  if (!ride) {
    return (
      <AdminScreen title={t("admin.rideDetailsTitle")}>
        <View style={styles.center}>
          <Text style={styles.notFoundText}>{t("admin.rideNotFound")}</Text>
        </View>
      </AdminScreen>
    );
  }

  return (
    <AdminScreen title={t("admin.rideDetailsTitle")}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerCard}>
          <View style={styles.pill}>
            <Text style={styles.pillText}>{translateCategoryLabel(ride.category, ride.category, t)}</Text>
          </View>
          <Text style={styles.title}>
            {ride.title || `${ride.from} → ${ride.to}`}
          </Text>
          <Text style={styles.status}>
            {t("admin.statusColonValue", {
              status: t(`admin.rideStatusLabel.${ride.status}`, { defaultValue: ride.status }),
            })}
          </Text>
        </View>

        <View style={styles.section}>
          <Row icon="person-outline" label={t("admin.driverLabel")} value={ride.driverName} />
          {ride.from ? <Row icon="navigate-outline" label={t("admin.fromLabel")} value={ride.from} /> : null}
          {ride.to ? <Row icon="flag-outline" label={t("admin.toLabel")} value={ride.to} /> : null}
          <Row icon="calendar-outline" label={t("admin.dateLabel")} value={ride.date || "—"} />
          <Row icon="time-outline" label={t("admin.timeLabel")} value={ride.time || "—"} />
          <Row
            icon="cash-outline"
            label={t("admin.priceLabel")}
            value={ride.price !== null ? `₪${ride.price}` : "—"}
          />
          <Row
            icon="people-outline"
            label={t("admin.seatsLabel")}
            value={
              ride.seats !== null
                ? `${ride.seats}${ride.totalSeats !== null ? ` / ${ride.totalSeats}` : ""}`
                : "—"
            }
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t("admin.connectedBookingsCount", { count: bookings.length })}
          </Text>

          {bookings.length === 0 ? (
            <Text style={styles.emptyConnected}>{t("admin.noOneBookedYet")}</Text>
          ) : (
            bookings.map((booking) => (
              <View key={booking.id} style={styles.bookingRow}>
                <Ionicons name="person-circle-outline" size={18} color={adminColors.textMuted} />
                <Text style={styles.bookingName}>{booking.personName}</Text>
                <Text style={styles.bookingStatus}>{translateStatus(t, "bookings", booking.status) || booking.status}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.actions}>
          {ride.status !== "cancelled" ? (
            <ActionButton
              icon="close-circle-outline"
              label={t("admin.cancelRide")}
              tone="danger"
              onPress={() => setPendingAction("cancel")}
            />
          ) : null}

          {!ride.removed ? (
            <ActionButton
              icon="trash-outline"
              label={t("admin.removeInappropriateRide")}
              tone="danger"
              onPress={() => setPendingAction("remove")}
            />
          ) : (
            <ActionButton
              icon="refresh-outline"
              label={t("admin.restoreRide")}
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
            ? t("admin.cancelThisRideQ")
            : pendingAction === "remove"
              ? t("admin.removeThisRideQ")
              : t("admin.restoreThisRideQ")
        }
        message={
          pendingAction === "cancel"
            ? t("admin.cancelRideNotifyMessage")
            : pendingAction === "remove"
              ? t("admin.removeRideHidesMessage")
              : t("admin.restoreRideVisibleMessage")
        }
        confirmLabel={pendingAction === "restore" ? t("admin.restoreButton") : t("admin.confirmButton")}
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
