import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { adminColors, adminRadius, adminSpacing } from "./adminTheme";
import { subscribeDrivers } from "./adminDriversLib";
import { AdminUserRow } from "./adminTypes";
import AdminScreen from "./components/AdminScreen";
import { EmptyState, ErrorState, LoadingState } from "./components/AdminStates";
import FilterChips from "./components/FilterChips";
import SearchBar from "./components/SearchBar";
import { useAdminCollection } from "./useAdminCollection";
import { translateDriverVerificationStatus } from "../i18n/formatters";

type StatusFilter = "all" | "pending_admin_review" | "approved" | "rejected" | "suspended";

const STATUS_OPTION_KEYS: { key: StatusFilter; labelKey: string }[] = [
  { key: "all", labelKey: "admin.allFilter" },
  { key: "pending_admin_review", labelKey: "admin.pendingFilter" },
  { key: "approved", labelKey: "admin.approvedFilter" },
  { key: "rejected", labelKey: "admin.rejectedFilter" },
  { key: "suspended", labelKey: "admin.suspended" },
];

const statusColor = (status: string) => {
  if (status === "approved") return adminColors.success;
  if (status === "rejected" || status === "suspended") return adminColors.danger;
  return adminColors.warning;
};

export default function AdminDriversScreen() {
  const { t } = useTranslation();
  const { data: drivers, loading, error, refresh } = useAdminCollection(subscribeDrivers);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const statusOptions = useMemo(
    () => STATUS_OPTION_KEYS.map((o) => ({ key: o.key, label: t(o.labelKey) })),
    [t],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return drivers.filter((driver) => {
      const statusMatches =
        statusFilter === "all" || driver.driverVerificationStatus === statusFilter;

      const searchMatches =
        !needle ||
        driver.name.toLowerCase().includes(needle) ||
        driver.email.toLowerCase().includes(needle) ||
        driver.phone.toLowerCase().includes(needle);

      return statusMatches && searchMatches;
    });
  }, [drivers, search, statusFilter]);

  const renderDriver = ({ item }: { item: AdminUserRow }) => (
    <Pressable
      style={styles.card}
      onPress={() => router.push(`/admin/drivers/${item.id}` as any)}
    >
      {item.photo ? (
        <Image source={{ uri: item.photo }} style={styles.avatarImage} />
      ) : (
        <View style={styles.avatarPlaceholder}>
          <Ionicons name="car" size={20} color={adminColors.primary} />
        </View>
      )}

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.detail} numberOfLines={1}>
          {item.phone || item.email || t("admin.noContactInfo")}
        </Text>
        <View style={styles.badgeRow}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: statusColor(item.driverVerificationStatus) },
            ]}
          />
          <Text style={styles.statusText}>
            {translateDriverVerificationStatus(item.driverVerificationStatus, t)}
          </Text>
          {item.ratingCount > 0 ? (
            <>
              <Text style={styles.dot}>•</Text>
              <Ionicons name="star" size={12} color={adminColors.primary} />
              <Text style={styles.statusText}>{item.ratingAverage.toFixed(1)}</Text>
            </>
          ) : null}
        </View>
      </View>

      <Ionicons name="chevron-forward" size={18} color={adminColors.placeholder} />
    </Pressable>
  );

  return (
    <AdminScreen title={t("admin.drivers")} activeKey="drivers">
      <View style={styles.filtersWrap}>
        <SearchBar value={search} onChangeText={setSearch} placeholder={t("admin.searchByNameEmailPhone")} />
        <FilterChips options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
      </View>

      {loading ? (
        <LoadingState label={t("admin.loadingDrivers")} />
      ) : error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderDriver}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}
          ListEmptyComponent={
            <EmptyState
              icon="car-outline"
              title={t("admin.noDriversFound")}
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
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: adminColors.card,
    borderWidth: 1,
    borderColor: adminColors.border,
    borderRadius: adminRadius.lg,
    padding: 14,
  },
  avatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: adminColors.warningBg,
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 14.5,
    fontWeight: "900",
    color: adminColors.text,
  },
  detail: {
    fontSize: 12.5,
    color: adminColors.textMuted,
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 11.5,
    color: adminColors.textMuted,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  dot: {
    color: adminColors.placeholder,
    fontSize: 11,
  },
});
