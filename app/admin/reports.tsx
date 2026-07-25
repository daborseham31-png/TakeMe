import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { subscribeAllReports } from "./adminReportsLib";
import { AdminReportRow, ReportStatus } from "./adminTypes";
import { adminColors, adminRadius, adminSpacing } from "./adminTheme";
import AdminScreen from "./components/AdminScreen";
import { EmptyState, ErrorState, LoadingState } from "./components/AdminStates";
import FilterChips from "./components/FilterChips";
import { useAdminCollection } from "./useAdminCollection";
import { translateReportCategory } from "../i18n/formatters";
import { useLanguage } from "../i18n/LanguageProvider";
import { pushToEnd } from "../i18n/rtl";

type StatusFilter = "all" | ReportStatus;

const STATUS_OPTION_KEYS: { key: StatusFilter; labelKey: string }[] = [
  { key: "all", labelKey: "admin.allFilter" },
  { key: "open", labelKey: "admin.reportStatusLabel.open" },
  { key: "under_review", labelKey: "admin.reportStatusLabel.under_review" },
  { key: "resolved", labelKey: "admin.reportStatusLabel.resolved" },
  { key: "rejected", labelKey: "admin.reportStatusLabel.rejected" },
];

const statusColor = (status: ReportStatus) => {
  if (status === "open") return adminColors.danger;
  if (status === "under_review") return adminColors.warning;
  if (status === "resolved") return adminColors.success;
  return adminColors.textMuted;
};

export default function AdminReportsScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const { data: reports, loading, error, refresh } = useAdminCollection(subscribeAllReports);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const statusOptions = useMemo(
    () => STATUS_OPTION_KEYS.map((o) => ({ key: o.key, label: t(o.labelKey) })),
    [t],
  );

  const filtered = useMemo(() => {
    const list =
      statusFilter === "all" ? reports : reports.filter((r) => r.status === statusFilter);

    return [...list].sort((a, b) => b.createdAtSeconds - a.createdAtSeconds);
  }, [reports, statusFilter]);

  const renderReport = ({ item }: { item: AdminReportRow }) => (
    <Pressable style={styles.card} onPress={() => router.push(`/admin/reports/${item.id}` as any)}>
      <View style={styles.cardTop}>
        <Text style={styles.category}>{translateReportCategory(item.category, t)}</Text>
        <View style={[styles.statusDot, pushToEnd(isRTL), { backgroundColor: statusColor(item.status) }]} />
        <Text style={styles.statusText}>
          {t(`admin.reportStatusLabel.${item.status}`, { defaultValue: item.status })}
        </Text>
      </View>

      <Text style={styles.description} numberOfLines={2}>
        {item.description}
      </Text>

      <Text style={styles.reporter}>{t("admin.byReporter", { name: item.reporterName })}</Text>
    </Pressable>
  );

  return (
    <AdminScreen title={t("admin.reportsAndSupport")} activeKey="reports">
      <View style={styles.filtersWrap}>
        <FilterChips options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
      </View>

      {loading ? (
        <LoadingState label={t("admin.loadingReports")} />
      ) : error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderReport}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}
          ListEmptyComponent={
            <EmptyState
              icon="flag-outline"
              title={t("admin.noReportsTitle")}
              subtitle={t("admin.noReportsHint")}
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
  },
  statusText: {
    fontSize: 11.5,
    color: adminColors.textMuted,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  description: {
    fontSize: 13.5,
    color: adminColors.text,
    fontWeight: "700",
    marginBottom: 6,
  },
  reporter: {
    fontSize: 12,
    color: adminColors.textMuted,
  },
});
