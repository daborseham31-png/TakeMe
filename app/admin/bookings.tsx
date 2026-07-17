import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { subscribeAllBookings } from "./adminBookingsLib";
import { AdminBookingRow } from "./adminTypes";
import { adminColors, adminRadius, adminSpacing } from "./adminTheme";
import AdminScreen from "./components/AdminScreen";
import { EmptyState, ErrorState, LoadingState } from "./components/AdminStates";
import FilterChips from "./components/FilterChips";
import SearchBar from "./components/SearchBar";
import { useAdminCollection } from "./useAdminCollection";
import { translateCategoryLabel } from "../i18n/formatters";

type StatusFilter = "all" | "booked" | "ongoing" | "on_the_way" | "arrived" | "completed" | "cancelled";
type PaymentFilter = "all" | "paid" | "unpaid" | "cash";

const STATUS_OPTION_KEYS: { key: StatusFilter; labelKey: string }[] = [
  { key: "all", labelKey: "admin.allStatuses" },
  { key: "booked", labelKey: "admin.bookingStatusLabel.booked" },
  { key: "ongoing", labelKey: "admin.bookingStatusLabel.ongoing" },
  { key: "on_the_way", labelKey: "admin.bookingStatusLabel.on_the_way" },
  { key: "arrived", labelKey: "admin.bookingStatusLabel.arrived" },
  { key: "completed", labelKey: "admin.bookingStatusLabel.completed" },
  { key: "cancelled", labelKey: "admin.bookingStatusLabel.cancelled" },
];

const PAYMENT_OPTION_KEYS: { key: PaymentFilter; labelKey: string }[] = [
  { key: "all", labelKey: "admin.allPayments" },
  { key: "paid", labelKey: "admin.paid" },
  { key: "unpaid", labelKey: "admin.unpaid" },
  { key: "cash", labelKey: "common.cash" },
];

const statusColor = (status: string) => {
  if (status === "cancelled") return adminColors.danger;
  if (status === "completed" || status === "completed_paid") return adminColors.success;
  return adminColors.primary;
};

export default function AdminBookingsScreen() {
  const { t } = useTranslation();
  const { data: bookings, loading, error, refresh } = useAdminCollection(subscribeAllBookings);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");

  const statusOptions = useMemo(
    () => STATUS_OPTION_KEYS.map((o) => ({ key: o.key, label: t(o.labelKey) })),
    [t],
  );
  const paymentOptions = useMemo(
    () => PAYMENT_OPTION_KEYS.map((o) => ({ key: o.key, label: t(o.labelKey) })),
    [t],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return bookings.filter((booking) => {
      const statusMatches = statusFilter === "all" || booking.status === statusFilter;

      const paymentMatches =
        paymentFilter === "all" ||
        (paymentFilter === "paid" &&
          (booking.paymentStatus === "paid" || booking.paymentStatus === "mock_paid")) ||
        (paymentFilter === "unpaid" &&
          !["paid", "mock_paid"].includes(booking.paymentStatus)) ||
        (paymentFilter === "cash" && booking.paymentMethod === "cash");

      const searchMatches =
        !needle ||
        booking.passengerName.toLowerCase().includes(needle) ||
        booking.driverName.toLowerCase().includes(needle) ||
        booking.from.toLowerCase().includes(needle) ||
        booking.to.toLowerCase().includes(needle);

      return statusMatches && paymentMatches && searchMatches;
    });
  }, [bookings, search, statusFilter, paymentFilter]);

  const renderBooking = ({ item }: { item: AdminBookingRow }) => (
    <Pressable style={styles.card} onPress={() => router.push(`/admin/bookings/${item.id}` as any)}>
      <View style={styles.cardTop}>
        <Text style={styles.category}>
          {item.category ? translateCategoryLabel(item.category, item.category, t) : t("admin.bookingFallback")}
        </Text>
        <View style={[styles.statusDot, { backgroundColor: statusColor(item.status) }]} />
        <Text style={styles.statusText}>
          {item.status
            ? t(`admin.bookingStatusLabel.${item.status}`, { defaultValue: item.status })
            : "—"}
        </Text>
      </View>

      <Text style={styles.title} numberOfLines={1}>
        {item.passengerName} → {item.driverName}
      </Text>

      {item.from || item.to ? (
        <Text style={styles.subtitle} numberOfLines={1}>
          {item.from || "?"} → {item.to || "?"}
        </Text>
      ) : null}

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>{item.date || t("admin.noDateFallback")}</Text>
        {item.price !== null ? <Text style={styles.price}>₪{item.price}</Text> : null}
        <Text style={styles.metaText}>
          {item.paymentStatus === "paid" ? t("admin.paid") : t("admin.unpaid")}
        </Text>
      </View>
    </Pressable>
  );

  return (
    <AdminScreen title={t("admin.bookings")} activeKey="bookings">
      <View style={styles.filtersWrap}>
        <SearchBar value={search} onChangeText={setSearch} placeholder={t("admin.searchPassengerDriverPlace")} />
        <FilterChips options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
        <FilterChips options={paymentOptions} value={paymentFilter} onChange={setPaymentFilter} />
      </View>

      {loading ? (
        <LoadingState label={t("admin.loadingBookings")} />
      ) : error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderBooking}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}
          ListEmptyComponent={
            <EmptyState
              icon="book-outline"
              title={t("admin.noBookingsFound")}
              subtitle={t("admin.tryDifferentSearchFilter")}
            />
          }
        />
      )}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  filtersWrap: {
    paddingHorizontal: adminSpacing.lg,
    gap: 10,
    marginBottom: 6,
  },
  list: {
    paddingHorizontal: adminSpacing.lg,
    paddingBottom: 40,
    gap: 10,
  },
  card: {
    backgroundColor: adminColors.card,
    borderWidth: 1,
    borderColor: adminColors.border,
    borderRadius: adminRadius.lg,
    padding: 14,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  category: {
    fontSize: 11.5,
    fontWeight: "800",
    color: adminColors.primaryDark,
    backgroundColor: adminColors.warningBg,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: adminRadius.pill,
    textTransform: "capitalize",
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginLeft: "auto",
  },
  statusText: {
    fontSize: 11.5,
    color: adminColors.textMuted,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  title: {
    fontSize: 14.5,
    fontWeight: "900",
    color: adminColors.text,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 12.5,
    color: adminColors.textMuted,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: "row",
    gap: 12,
  },
  metaText: {
    fontSize: 12,
    color: adminColors.textMuted,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  price: {
    fontSize: 12.5,
    fontWeight: "900",
    color: adminColors.primary,
  },
});
