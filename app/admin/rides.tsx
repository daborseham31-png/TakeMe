import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { subscribeAllRides } from "./adminRidesLib";
import { AdminRideRow, RideCategory, RideStatus } from "./adminTypes";
import { adminColors, adminRadius, adminSpacing } from "./adminTheme";
import AdminScreen from "./components/AdminScreen";
import { EmptyState, ErrorState, LoadingState } from "./components/AdminStates";
import FilterChips from "./components/FilterChips";
import SearchBar from "./components/SearchBar";
import { useAdminCollection } from "./useAdminCollection";

type CategoryFilter = "all" | RideCategory;
type StatusFilter = "all" | RideStatus;
type SortKey = "newest" | "oldest" | "date" | "price";

const CATEGORY_OPTION_KEYS: { key: CategoryFilter; labelKey: string }[] = [
  { key: "all", labelKey: "admin.allFilter" },
  { key: "personal", labelKey: "admin.rideCategoryLabel.personal" },
  { key: "school", labelKey: "admin.rideCategoryLabel.school" },
  { key: "work", labelKey: "admin.rideCategoryLabel.work" },
  { key: "errand", labelKey: "admin.rideCategoryLabel.errand" },
];

const STATUS_OPTION_KEYS: { key: StatusFilter; labelKey: string }[] = [
  { key: "all", labelKey: "admin.allStatuses" },
  { key: "upcoming", labelKey: "admin.rideStatusLabel.upcoming" },
  { key: "active", labelKey: "admin.rideStatusLabel.active" },
  { key: "completed", labelKey: "admin.rideStatusLabel.completed" },
  { key: "cancelled", labelKey: "admin.rideStatusLabel.cancelled" },
];

const SORT_OPTION_KEYS: { key: SortKey; labelKey: string }[] = [
  { key: "newest", labelKey: "admin.sortLabel.newest" },
  { key: "oldest", labelKey: "admin.sortLabel.oldest" },
  { key: "date", labelKey: "admin.sortLabel.nearestDate" },
  { key: "price", labelKey: "admin.sortLabel.price" },
];

const statusColor = (status: RideStatus) => {
  if (status === "cancelled") return adminColors.danger;
  if (status === "completed") return adminColors.textMuted;
  if (status === "active") return adminColors.success;
  return adminColors.primary;
};

export default function AdminRidesScreen() {
  const { t } = useTranslation();
  const { data: rides, loading, error, refresh } = useAdminCollection(subscribeAllRides);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("newest");

  const categoryOptions = useMemo(
    () => CATEGORY_OPTION_KEYS.map((o) => ({ key: o.key, label: t(o.labelKey) })),
    [t],
  );
  const statusOptions = useMemo(
    () => STATUS_OPTION_KEYS.map((o) => ({ key: o.key, label: t(o.labelKey) })),
    [t],
  );
  const sortOptions = useMemo(
    () => SORT_OPTION_KEYS.map((o) => ({ key: o.key, label: t(o.labelKey) })),
    [t],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();

    const list = rides.filter((ride) => {
      const categoryMatches = categoryFilter === "all" || ride.category === categoryFilter;
      const statusMatches = statusFilter === "all" || ride.status === statusFilter;

      const searchMatches =
        !needle ||
        ride.driverName.toLowerCase().includes(needle) ||
        ride.from.toLowerCase().includes(needle) ||
        ride.to.toLowerCase().includes(needle) ||
        ride.title.toLowerCase().includes(needle);

      return categoryMatches && statusMatches && searchMatches && !ride.removed;
    });

    return [...list].sort((a, b) => {
      if (sort === "newest") return b.createdAtSeconds - a.createdAtSeconds;
      if (sort === "oldest") return a.createdAtSeconds - b.createdAtSeconds;
      if (sort === "price") return (b.price ?? 0) - (a.price ?? 0);
      return (a.date || "9999").localeCompare(b.date || "9999");
    });
  }, [rides, search, categoryFilter, statusFilter, sort]);

  const renderRide = ({ item }: { item: AdminRideRow }) => (
    <Pressable
      style={styles.card}
      onPress={() => router.push(`/admin/rides/${item.source}/${item.id}` as any)}
    >
      <View style={styles.cardTop}>
        <View style={styles.categoryBadge}>
          <Text style={styles.categoryBadgeText}>
            {t(`admin.rideCategoryLabel.${item.category}`, { defaultValue: item.category })}
          </Text>
        </View>
        <View style={[styles.statusDot, { backgroundColor: statusColor(item.status) }]} />
        <Text style={styles.statusText}>
          {t(`admin.rideStatusLabel.${item.status}`, { defaultValue: item.status })}
        </Text>
      </View>

      <Text style={styles.title} numberOfLines={1}>
        {item.title || (item.from && item.to ? `${item.from} → ${item.to}` : item.from)}
      </Text>

      <Text style={styles.subtitle} numberOfLines={1}>
        {item.driverName} · {item.date || t("admin.noDateFallback")} {item.time ? `· ${item.time}` : ""}
      </Text>

      <View style={styles.metaRow}>
        {item.price !== null ? <Text style={styles.price}>₪{item.price}</Text> : null}
        {item.seats !== null ? (
          <Text style={styles.metaText}>{t("admin.ridesSeatsCount", { count: item.seats })}</Text>
        ) : null}
      </View>
    </Pressable>
  );

  return (
    <AdminScreen title={t("admin.rides")} activeKey="rides">
      <View style={styles.filtersWrap}>
        <SearchBar value={search} onChangeText={setSearch} placeholder={t("admin.searchDriverOriginDest")} />
        <FilterChips options={categoryOptions} value={categoryFilter} onChange={setCategoryFilter} />
        <FilterChips options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
        <FilterChips options={sortOptions} value={sort} onChange={setSort} />
      </View>

      {loading ? (
        <LoadingState label={t("admin.loadingRides")} />
      ) : error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => `${item.source}-${item.id}`}
          renderItem={renderRide}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}
          ListEmptyComponent={
            <EmptyState
              icon="navigate-outline"
              title={t("admin.noRidesFound")}
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
  categoryBadge: {
    backgroundColor: adminColors.warningBg,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: adminRadius.pill,
  },
  categoryBadgeText: {
    color: adminColors.primaryDark,
    fontWeight: "800",
    fontSize: 11,
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
    fontSize: 15,
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
    gap: 14,
  },
  price: {
    fontSize: 13,
    fontWeight: "900",
    color: adminColors.primary,
  },
  metaText: {
    fontSize: 12.5,
    color: adminColors.textMuted,
    fontWeight: "700",
  },
});
