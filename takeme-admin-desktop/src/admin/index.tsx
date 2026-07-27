import { Ionicons } from "@expo/vector-icons";
import { router } from "../router/expoRouterShim";
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
import { useTranslation } from "react-i18next";

import {
  DashboardStats,
  getDashboardStats,
  getRecentReports,
  getRecentRides,
  RecentReport,
  RecentRide,
} from "./adminDashboardLib";
import { translateReportCategory } from "../i18n/formatters";
import { useLanguage } from "../i18n/LanguageProvider";
import { chevronForwardIconName, positionEnd } from "../i18n/rtl";
import { adminColors, adminRadius, adminSpacing } from "./adminTheme";
import AdminScreen from "./components/AdminScreen";
import { ErrorState, LoadingState } from "./components/AdminStates";
import StatCard from "./components/StatCard";

export default function AdminDashboardScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentRides, setRecentRides] = useState<RecentRide[]>([]);
  const [recentReports, setRecentReports] = useState<RecentReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [statsResult, ridesResult, reportsResult] = await Promise.all([
        getDashboardStats(),
        getRecentRides(3),
        getRecentReports(3),
      ]);

      setStats(statsResult);
      setRecentRides(ridesResult);
      setRecentReports(reportsResult);
    } catch (err: any) {
      setError(err?.message || t("admin.couldNotLoadDashboard"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <AdminScreen title={t("admin.dashboardTitle")} activeKey="dashboard" showBack={false}>
      {loading ? (
        <LoadingState label={t("admin.loadingDashboard")} />
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
            <Text style={styles.sectionTitle}>{t("admin.quickActions")}</Text>
            <Pressable style={styles.refreshButton} onPress={() => load(true)}>
              <Ionicons name="refresh" size={16} color={adminColors.primary} />
              <Text style={styles.refreshText}>{t("admin.refresh")}</Text>
            </Pressable>
          </View>

          <View style={styles.quickActions}>
            <QuickAction icon="people-outline" label={t("admin.users")} onPress={() => router.push("/admin/users" as any)} isRTL={isRTL} />
            <QuickAction icon="car-outline" label={t("admin.drivers")} onPress={() => router.push("/admin/drivers" as any)} isRTL={isRTL} />
            <QuickAction icon="navigate-outline" label={t("admin.rides")} onPress={() => router.push("/admin/rides" as any)} isRTL={isRTL} />
            <QuickAction icon="book-outline" label={t("admin.bookings")} onPress={() => router.push("/admin/bookings" as any)} isRTL={isRTL} />
            <QuickAction
              icon="flag-outline"
              label={t("admin.reports")}
              badge={stats.openReports}
              onPress={() => router.push("/admin/reports" as any)}
              isRTL={isRTL}
            />
            <QuickAction
              icon="notifications-outline"
              label={t("admin.notifyAction")}
              onPress={() => router.push("/admin/notifications" as any)}
              isRTL={isRTL}
            />
            <QuickAction
              icon="school-outline"
              label={t("admin.schoolKioskLinks")}
              onPress={() => router.push("/admin/school-kiosk-links" as any)}
              isRTL={isRTL}
            />
          </View>

          <Text style={styles.sectionTitle}>{t("admin.overview")}</Text>
          <View style={styles.statsGrid}>
            <StatCard icon="people-outline" label={t("admin.totalUsers")} value={stats.totalUsers} />
            <StatCard icon="person-outline" label={t("admin.passengers")} value={stats.totalPassengers} tint="#EC4899" />
            <StatCard icon="car-outline" label={t("admin.drivers")} value={stats.totalDrivers} tint="#22C55E" />
            <StatCard
              icon="shield-checkmark-outline"
              label={t("admin.pendingVerification")}
              value={stats.pendingDriverVerifications}
              tint="#B86115"
            />
          </View>

          <Text style={styles.sectionTitle}>{t("admin.rides")}</Text>
          <View style={styles.statsGrid}>
            <StatCard icon="navigate-outline" label={t("admin.activeToday")} value={stats.activeRides} />
            <StatCard icon="calendar-outline" label={t("admin.upcoming")} value={stats.upcomingRides} tint="#3B82F6" />
            <StatCard icon="checkmark-done-outline" label={t("common.completed")} value={stats.completedRides} tint="#22C55E" />
            <StatCard icon="close-circle-outline" label={t("bookings.status.cancelled")} value={stats.cancelledRides} tint="#DC2626" />
          </View>

          <Text style={styles.sectionTitle}>{t("admin.bookings")}</Text>
          <View style={styles.statsGrid}>
            <StatCard icon="book-outline" label={t("admin.totalBookings")} value={stats.totalBookings} />
            <StatCard icon="time-outline" label={t("bookings.status.pending")} value={stats.pendingBookings} tint="#B86115" />
            <StatCard icon="checkmark-circle-outline" label={t("bookings.status.confirmed")} value={stats.confirmedBookings} tint="#22C55E" />
            <StatCard icon="close-circle-outline" label={t("bookings.status.cancelled")} value={stats.cancelledBookings} tint="#DC2626" />
          </View>

          <Text style={styles.sectionTitle}>{t("admin.todayAndThisWeek")}</Text>
          <View style={styles.statsGrid}>
            <StatCard icon="flag-outline" label={t("admin.openReports")} value={stats.openReports} tint="#DC2626" />
            <StatCard icon="add-circle-outline" label={t("admin.ridesCreatedToday")} value={stats.ridesCreatedToday} />
            <StatCard icon="person-add-outline" label={t("admin.newUsersThisWeek")} value={stats.newUsersThisWeek} />
          </View>

          <View style={styles.headerRow}>
            <Text style={styles.sectionTitle}>{t("admin.recentRides")}</Text>
            <Pressable
              style={styles.viewAllButton}
              onPress={() => router.push("/admin/rides" as any)}
            >
              <Text style={styles.viewAllText}>{t("admin.viewAll")}</Text>
              <Ionicons name={chevronForwardIconName(isRTL)} size={14} color={adminColors.primary} />
            </Pressable>
          </View>
          {recentRides.length === 0 ? (
            <Text style={styles.emptyText}>{t("admin.noRidesYet")}</Text>
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

          <View style={styles.headerRow}>
            <Text style={styles.sectionTitle}>{t("admin.recentReports")}</Text>
            <Pressable
              style={styles.viewAllButton}
              onPress={() => router.push("/admin/reports" as any)}
            >
              <Text style={styles.viewAllText}>{t("admin.viewAll")}</Text>
              <Ionicons name={chevronForwardIconName(isRTL)} size={14} color={adminColors.primary} />
            </Pressable>
          </View>
          {recentReports.length === 0 ? (
            <Text style={styles.emptyText}>{t("admin.noReportsYet")}</Text>
          ) : (
            recentReports.map((reportItem) => (
              <Pressable
                key={reportItem.id}
                style={styles.recentRow}
                onPress={() => router.push(`/admin/reports/${reportItem.id}` as any)}
              >
                <Ionicons name="flag-outline" size={16} color={adminColors.textMuted} />
                <Text style={styles.recentText} numberOfLines={1}>
                  {translateReportCategory(reportItem.category, t)}: {reportItem.description}
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
  badge,
  onPress,
  isRTL,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  badge?: number;
  onPress: () => void;
  isRTL: boolean;
}) => (
  <Pressable style={styles.quickActionButton} onPress={onPress}>
    {!!badge && badge > 0 ? (
      <View style={[styles.quickActionBadge, positionEnd(8, isRTL)]}>
        <Text style={styles.quickActionBadgeText}>
          {badge > 99 ? "99+" : badge}
        </Text>
      </View>
    ) : null}
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
  viewAllButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  viewAllText: {
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
  quickActionBadge: {
    position: "absolute",
    top: 8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  quickActionBadgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "900",
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
