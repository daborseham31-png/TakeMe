// ---------------------------------------------------------------------------
// Admin: Violations & Appeals list — driver NO-SHOW violations (see
// app/booking/driverNoShowLib.ts). Completely separate from the driver
// cancellation-violation history shown on app/admin/drivers/[id].tsx.
// ---------------------------------------------------------------------------

import { router } from "../router/expoRouterShim";
import React, { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  DriverViolation,
  subscribeAllViolations,
  useDriverDisplayInfo,
} from "./adminViolationsLib";
import { adminColors, adminRadius, adminSpacing } from "./adminTheme";
import AdminScreen from "./components/AdminScreen";
import { EmptyState, ErrorState, LoadingState } from "./components/AdminStates";
import FilterChips from "./components/FilterChips";
import { useAdminCollection } from "./useAdminCollection";
import { useLanguage } from "../i18n/LanguageProvider";
import { pushToEnd } from "../i18n/rtl";

type StatusFilter = "all" | "open" | "appeal_pending" | "appeal_approved" | "appeal_rejected";

const STATUS_OPTION_KEYS: { key: StatusFilter; labelKey: string }[] = [
  { key: "all", labelKey: "admin.allFilter" },
  { key: "open", labelKey: "driverNoShow.statusViolationRecorded" },
  { key: "appeal_pending", labelKey: "driverNoShow.statusAppealUnderReview" },
  { key: "appeal_approved", labelKey: "driverNoShow.statusAppealApprovedRemoved" },
  { key: "appeal_rejected", labelKey: "driverNoShow.statusAppealRejectedActive" },
];

const statusColor = (status: string) => {
  if (status === "open") return adminColors.danger;
  if (status === "appeal_pending") return adminColors.warning;
  if (status === "appeal_approved") return adminColors.success;
  if (status === "appeal_rejected") return adminColors.danger;
  return adminColors.textMuted;
};

export default function AdminViolationsScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const { data: violations, loading, error, refresh } = useAdminCollection(subscribeAllViolations);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const statusOptions = useMemo(
    () => STATUS_OPTION_KEYS.map((o) => ({ key: o.key, label: t(o.labelKey) })),
    [t],
  );

  const filtered = useMemo(() => {
    if (statusFilter === "all") return violations;
    return violations.filter((v) => v.status === statusFilter);
  }, [violations, statusFilter]);

  const driverIds = useMemo(() => filtered.map((v) => v.driverId), [filtered]);
  const driverInfo = useDriverDisplayInfo(driverIds);

  const renderViolation = ({ item }: { item: DriverViolation }) => (
    <Pressable style={styles.card} onPress={() => router.push(`/admin/violations/${item.id}` as any)}>
      <View style={styles.cardTop}>
        <Text style={styles.category}>{t(`driverNoShow.category.${item.category}`, { defaultValue: item.category })}</Text>
        <View style={[styles.statusDot, pushToEnd(isRTL), { backgroundColor: statusColor(item.status) }]} />
        <Text style={styles.statusText}>
          {t(`driverNoShow.statusShort.${item.status}`, { defaultValue: item.status })}
        </Text>
      </View>

      <Text style={styles.route} numberOfLines={1}>
        {item.routeFrom} → {item.routeTo}
      </Text>

      <Text style={styles.driver}>
        {t("admin.byReporter", { name: driverInfo[item.driverId]?.name || item.driverId })}
      </Text>

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>
          {t("driverNoShow.affectedPassengers", { count: item.passengerCount })}
        </Text>
        <Text style={styles.metaText}>{t(`driverNoShow.refundStatus.${item.refundStatus}`)}</Text>
      </View>
    </Pressable>
  );

  return (
    <AdminScreen title={t("driverNoShow.violationsAndAppeals")} activeKey="violations">
      <View style={styles.filtersWrap}>
        <FilterChips options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
      </View>

      {loading ? (
        <LoadingState label={t("driverNoShow.loadingViolations")} />
      ) : error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderViolation}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}
          ListEmptyComponent={
            <EmptyState
              icon="warning-outline"
              title={t("driverNoShow.noViolationsTitle")}
              subtitle={t("driverNoShow.noViolationsHint")}
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
  },
  route: {
    fontSize: 13.5,
    color: adminColors.text,
    fontWeight: "700",
    marginBottom: 4,
  },
  driver: {
    fontSize: 12,
    color: adminColors.textMuted,
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: "row",
    gap: 12,
  },
  metaText: {
    fontSize: 11.5,
    color: adminColors.textMuted,
    fontWeight: "600",
  },
});
