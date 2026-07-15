import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

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

const CATEGORY_OPTIONS: { key: CategoryFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "personal", label: "Personal" },
  { key: "school", label: "School" },
  { key: "work", label: "Work" },
  { key: "errand", label: "Errand" },
];

const STATUS_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All statuses" },
  { key: "upcoming", label: "Upcoming" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "newest", label: "Newest" },
  { key: "oldest", label: "Oldest" },
  { key: "date", label: "Nearest date" },
  { key: "price", label: "Price" },
];

const statusColor = (status: RideStatus) => {
  if (status === "cancelled") return adminColors.danger;
  if (status === "completed") return adminColors.textMuted;
  if (status === "active") return adminColors.success;
  return adminColors.primary;
};

export default function AdminRidesScreen() {
  const { data: rides, loading, error, refresh } = useAdminCollection(subscribeAllRides);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("newest");

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
          <Text style={styles.categoryBadgeText}>{item.category}</Text>
        </View>
        <View style={[styles.statusDot, { backgroundColor: statusColor(item.status) }]} />
        <Text style={styles.statusText}>{item.status}</Text>
      </View>

      <Text style={styles.title} numberOfLines={1}>
        {item.title || (item.from && item.to ? `${item.from} → ${item.to}` : item.from)}
      </Text>

      <Text style={styles.subtitle} numberOfLines={1}>
        {item.driverName} · {item.date || "No date"} {item.time ? `· ${item.time}` : ""}
      </Text>

      <View style={styles.metaRow}>
        {item.price !== null ? <Text style={styles.price}>₪{item.price}</Text> : null}
        {item.seats !== null ? (
          <Text style={styles.metaText}>{item.seats} seats</Text>
        ) : null}
      </View>
    </Pressable>
  );

  return (
    <AdminScreen title="Rides" activeKey="rides">
      <View style={styles.filtersWrap}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search driver, origin, destination" />
        <FilterChips options={CATEGORY_OPTIONS} value={categoryFilter} onChange={setCategoryFilter} />
        <FilterChips options={STATUS_OPTIONS} value={statusFilter} onChange={setStatusFilter} />
        <FilterChips options={SORT_OPTIONS} value={sort} onChange={setSort} />
      </View>

      {loading ? (
        <LoadingState label="Loading rides..." />
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
              title="No rides found"
              subtitle="Try a different search or filter."
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
