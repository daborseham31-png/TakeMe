import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { adminColors, adminRadius, adminSpacing } from "./adminTheme";
import { subscribeAllUsers } from "./adminUsersLib";
import { AdminUserRow } from "./adminTypes";
import AdminScreen from "./components/AdminScreen";
import { EmptyState, ErrorState, LoadingState } from "./components/AdminStates";
import FilterChips from "./components/FilterChips";
import SearchBar from "./components/SearchBar";
import { useAdminCollection } from "./useAdminCollection";
import { translateAccountStatus, translateUserRole } from "../i18n/formatters";

type RoleFilter = "all" | "passenger" | "driver" | "admin";
type StatusFilter = "all" | "active" | "blocked" | "suspended";

const ROLE_OPTION_KEYS: { key: RoleFilter; labelKey: string }[] = [
  { key: "all", labelKey: "admin.allRoles" },
  { key: "passenger", labelKey: "common.passenger" },
  { key: "driver", labelKey: "common.driver" },
  { key: "admin", labelKey: "admin.admins" },
];

const STATUS_OPTION_KEYS: { key: StatusFilter; labelKey: string }[] = [
  { key: "all", labelKey: "admin.allStatuses" },
  { key: "active", labelKey: "admin.active" },
  { key: "blocked", labelKey: "admin.blocked" },
  { key: "suspended", labelKey: "admin.suspended" },
];

const statusColor = (status: string) => {
  if (status === "blocked") return adminColors.danger;
  if (status === "suspended") return adminColors.warning;
  return adminColors.success;
};

export default function AdminUsersScreen() {
  const { t } = useTranslation();
  const { data: users, loading, error, refresh } = useAdminCollection(subscribeAllUsers);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const roleOptions = useMemo(
    () => ROLE_OPTION_KEYS.map((o) => ({ key: o.key, label: t(o.labelKey) })),
    [t],
  );

  const statusOptions = useMemo(
    () => STATUS_OPTION_KEYS.map((o) => ({ key: o.key, label: t(o.labelKey) })),
    [t],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return users.filter((user) => {
      const roleMatches = roleFilter === "all" || user.role === roleFilter;
      const statusMatches = statusFilter === "all" || user.accountStatus === statusFilter;

      const searchMatches =
        !needle ||
        user.name.toLowerCase().includes(needle) ||
        user.email.toLowerCase().includes(needle) ||
        user.phone.toLowerCase().includes(needle);

      return roleMatches && statusMatches && searchMatches;
    });
  }, [users, search, roleFilter, statusFilter]);

  const renderUser = ({ item }: { item: AdminUserRow }) => (
    <Pressable
      style={styles.card}
      onPress={() => router.push(`/admin/users/${item.id}` as any)}
    >
      {item.photo ? (
        <Image source={{ uri: item.photo }} style={styles.avatarImage} />
      ) : (
        <View style={styles.avatarPlaceholder}>
          <Ionicons name="person" size={20} color={adminColors.primary} />
        </View>
      )}

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.detail} numberOfLines={1}>
          {item.email || item.phone || t("admin.noContactInfo")}
        </Text>
        <View style={styles.badgeRow}>
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>{translateUserRole(item.role, t)}</Text>
          </View>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: statusColor(item.accountStatus) },
            ]}
          />
          <Text style={styles.statusText}>{translateAccountStatus(item.accountStatus, t)}</Text>
        </View>
      </View>

      <Ionicons name="chevron-forward" size={18} color={adminColors.placeholder} />
    </Pressable>
  );

  return (
    <AdminScreen title={t("admin.users")} activeKey="users">
      <View style={styles.filtersWrap}>
        <SearchBar value={search} onChangeText={setSearch} placeholder={t("admin.searchByNameEmailPhone")} />
        <FilterChips options={roleOptions} value={roleFilter} onChange={setRoleFilter} />
        <FilterChips options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
      </View>

      {loading ? (
        <LoadingState label={t("admin.loadingUsers")} />
      ) : error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderUser}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title={t("admin.noUsersFound")}
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
    gap: 6,
    marginTop: 6,
  },
  roleBadge: {
    backgroundColor: adminColors.warningBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: adminRadius.pill,
  },
  roleBadgeText: {
    color: adminColors.primaryDark,
    fontWeight: "800",
    fontSize: 11,
    textTransform: "capitalize",
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
});
