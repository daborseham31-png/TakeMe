import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  BackHandler,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  DashboardStats,
  getDashboardStats,
  getRecentReports,
  getRecentRides,
  getRecentUsers,
  RecentReport,
  RecentRide,
  RecentUser,
} from "./adminDashboardLib";
import { adminColors, adminRadius, adminSpacing } from "./adminTheme";
import AdminScreen from "./components/AdminScreen";
import { ErrorState, LoadingState } from "./components/AdminStates";
import StatCard from "./components/StatCard";

export default function AdminDashboardScreen() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentRides, setRecentRides] = useState<RecentRide[]>([]);
  const [recentUsers, setRecentUsers] = useState<RecentUser[]>([]);
  const [recentReports, setRecentReports] = useState<RecentReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [statsResult, ridesResult, usersResult, reportsResult] = await Promise.all([
        getDashboardStats(),
        getRecentRides(5),
        getRecentUsers(5),
        getRecentReports(5),
      ]);

      setStats(statsResult);
      setRecentRides(ridesResult);
      setRecentUsers(usersResult);
      setRecentReports(reportsResult);
    } catch (err: any) {
      setError(err?.message || "Could not load the dashboard. Please try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The dashboard is reached via router.replace on login (no back history),
  // so the hardware back button would otherwise exit the app entirely —
  // send the admin to the normal Home screen instead.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      router.replace("/(tabs)/home" as any);
      return true;
    });

    return () => subscription.remove();
  }, []);

  return (
    <AdminScreen title="Admin Dashboard" activeKey="dashboard" showBack={false}>
      {loading ? (
        <LoadingState label="Loading dashboard..." />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load()} />
      ) : !stats ? null : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />
          }
        >
          <View style={styles.headerRow}>
            <Text style={styles.sectionTitle}>Quick actions</Text>
            <Pressable style={styles.refreshButton} onPress={() => load(true)}>
              <Ionicons name="refresh" size={16} color={adminColors.primary} />
              <Text style={styles.refreshText}>Refresh</Text>
            </Pressable>
          </View>

          <View style={styles.quickActions}>
            <QuickAction icon="people-outline" label="Users" onPress={() => router.push("/admin/users" as any)} />
            <QuickAction icon="car-outline" label="Drivers" onPress={() => router.push("/admin/drivers" as any)} />
            <QuickAction icon="navigate-outline" label="Rides" onPress={() => router.push("/admin/rides" as any)} />
            <QuickAction icon="book-outline" label="Bookings" onPress={() => router.push("/admin/bookings" as any)} />
            <QuickAction icon="flag-outline" label="Reports" onPress={() => router.push("/admin/reports" as any)} />
            <QuickAction
              icon="notifications-outline"
              label="Notify"
              onPress={() => router.push("/admin/notifications" as any)}
            />
          </View>

          <Text style={styles.sectionTitle}>Overview</Text>
          <View style={styles.statsGrid}>
            <StatCard icon="people-outline" label="Total users" value={stats.totalUsers} />
            <StatCard icon="person-outline" label="Passengers" value={stats.totalPassengers} tint="#EC4899" />
            <StatCard icon="car-outline" label="Drivers" value={stats.totalDrivers} tint="#22C55E" />
            <StatCard
              icon="shield-checkmark-outline"
              label="Pending verification"
              value={stats.pendingDriverVerifications}
              tint="#B86115"
            />
          </View>

          <Text style={styles.sectionTitle}>Rides</Text>
          <View style={styles.statsGrid}>
            <StatCard icon="navigate-outline" label="Active today" value={stats.activeRides} />
            <StatCard icon="calendar-outline" label="Upcoming" value={stats.upcomingRides} tint="#3B82F6" />
            <StatCard icon="checkmark-done-outline" label="Completed" value={stats.completedRides} tint="#22C55E" />
            <StatCard icon="close-circle-outline" label="Cancelled" value={stats.cancelledRides} tint="#DC2626" />
          </View>

          <Text style={styles.sectionTitle}>Bookings</Text>
          <View style={styles.statsGrid}>
            <StatCard icon="book-outline" label="Total bookings" value={stats.totalBookings} />
            <StatCard icon="time-outline" label="Pending" value={stats.pendingBookings} tint="#B86115" />
            <StatCard icon="checkmark-circle-outline" label="Confirmed" value={stats.confirmedBookings} tint="#22C55E" />
            <StatCard icon="close-circle-outline" label="Cancelled" value={stats.cancelledBookings} tint="#DC2626" />
          </View>

          <Text style={styles.sectionTitle}>Today &amp; this week</Text>
          <View style={styles.statsGrid}>
            <StatCard icon="flag-outline" label="Open reports" value={stats.openReports} tint="#DC2626" />
            <StatCard icon="add-circle-outline" label="Rides created today" value={stats.ridesCreatedToday} />
            <StatCard icon="person-add-outline" label="New users this week" value={stats.newUsersThisWeek} />
          </View>

          <Text style={styles.sectionTitle}>Recent rides</Text>
          {recentRides.length === 0 ? (
            <Text style={styles.emptyText}>No rides yet.</Text>
          ) : (
            recentRides.map((ride) => (
              <Pressable
                key={ride.id}
                style={styles.recentRow}
                onPress={() => router.push(`/admin/rides/driverRoutes/${ride.id}` as any)}
              >
                <Ionicons name="navigate-outline" size={16} color={adminColors.textMuted} />
                <Text style={styles.recentText} numberOfLines={1}>
                  {ride.from || "?"} → {ride.to || "?"} · {ride.driverName}
                </Text>
              </Pressable>
            ))
          )}

          <Text style={styles.sectionTitle}>Recent users</Text>
          {recentUsers.length === 0 ? (
            <Text style={styles.emptyText}>No users yet.</Text>
          ) : (
            recentUsers.map((user) => (
              <Pressable
                key={user.id}
                style={styles.recentRow}
                onPress={() => router.push(`/admin/users/${user.id}` as any)}
              >
                <Ionicons name="person-outline" size={16} color={adminColors.textMuted} />
                <Text style={styles.recentText} numberOfLines={1}>
                  {user.name} · {user.role || "unknown"}
                </Text>
              </Pressable>
            ))
          )}

          <Text style={styles.sectionTitle}>Recent reports</Text>
          {recentReports.length === 0 ? (
            <Text style={styles.emptyText}>No reports yet.</Text>
          ) : (
            recentReports.map((reportItem) => (
              <Pressable
                key={reportItem.id}
                style={styles.recentRow}
                onPress={() => router.push(`/admin/reports/${reportItem.id}` as any)}
              >
                <Ionicons name="flag-outline" size={16} color={adminColors.textMuted} />
                <Text style={styles.recentText} numberOfLines={1}>
                  {reportItem.category}: {reportItem.description}
                </Text>
              </Pressable>
            ))
          )}
        </ScrollView>
      )}
    </AdminScreen>
  );
}

const QuickAction = ({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) => (
  <Pressable style={styles.quickActionButton} onPress={onPress}>
    <Ionicons name={icon} size={20} color={adminColors.primary} />
    <Text style={styles.quickActionText}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  scroll: {
    padding: adminSpacing.lg,
    paddingBottom: 60,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: adminColors.text,
    marginTop: 20,
    marginBottom: 10,
  },
  refreshButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: adminColors.warningBg,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: adminRadius.pill,
  },
  refreshText: {
    color: adminColors.primary,
    fontWeight: "800",
    fontSize: 12.5,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  quickActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  quickActionButton: {
    flexBasis: "30%",
    flexGrow: 1,
    alignItems: "center",
    gap: 6,
    backgroundColor: adminColors.card,
    borderWidth: 1,
    borderColor: adminColors.border,
    borderRadius: adminRadius.lg,
    paddingVertical: 16,
  },
  quickActionText: {
    fontSize: 12,
    fontWeight: "800",
    color: adminColors.text,
  },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: adminColors.card,
    borderWidth: 1,
    borderColor: adminColors.border,
    borderRadius: adminRadius.md,
    padding: 12,
    marginBottom: 8,
  },
  recentText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: adminColors.text,
  },
  emptyText: {
    color: adminColors.textMuted,
    fontSize: 13,
    marginBottom: 8,
  },
});
