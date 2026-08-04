// ---------------------------------------------------------------------------
// Admin: Violation & Appeal detail — approve/reject a driver's no-show
// appeal (see app/booking/driverNoShowLib.ts's approveAppeal/rejectAppeal,
// which this screen calls directly; Firestore rules are the real enforcement
// boundary, not this UI).
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "../../router/expoRouterShim";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import React, { useEffect, useMemo, useState } from "react";
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { db } from "../../../firebase";
import {
  approveAppeal,
  canConfirmManualRefund,
  confirmManualRefund,
  DriverViolation,
  getViolationHistoryForDriver,
  NO_SHOW_REASON_LABEL_KEY,
  rejectAppeal,
  useDriverDisplayInfo,
  ViolationAppeal,
} from "../adminViolationsLib";
import { adminColors, adminRadius, adminSpacing } from "../adminTheme";
import AdminScreen from "../components/AdminScreen";
import { LoadingState } from "../components/AdminStates";
import ConfirmModal from "../components/ConfirmModal";

const toSeconds = (value: unknown): number => (value as { seconds?: number } | undefined)?.seconds || 0;

const normalizeViolation = (id: string, data: Record<string, any>): DriverViolation => ({
  id,
  driverId: data.driverId || "",
  tripId: data.tripId || "",
  bookingId: data.bookingId || null,
  schoolTripId: data.schoolTripId || null,
  category: data.category || "personal",
  violationType: "driver_no_show",
  scheduledAtSeconds: toSeconds(data.scheduledAt),
  gracePeriodEndedAtSeconds: toSeconds(data.gracePeriodEndedAt),
  routeFrom: data.routeFrom || "",
  routeTo: data.routeTo || "",
  passengerIds: Array.isArray(data.passengerIds) ? data.passengerIds : [],
  passengerCount: typeof data.passengerCount === "number" ? data.passengerCount : 0,
  paymentMethods: Array.isArray(data.paymentMethods) ? data.paymentMethods : [],
  paidAmount: typeof data.paidAmount === "number" ? data.paidAmount : 0,
  currency: data.currency || "ILS",
  refundStatus: data.refundStatus || "manual_refund_pending",
  description: data.description || "",
  active: data.active !== false,
  status: data.status || "open",
  appealId: data.appealId || null,
  createdAtSeconds: toSeconds(data.createdAt),
  updatedAtSeconds: toSeconds(data.updatedAt),
  resolvedAtSeconds: data.resolvedAt ? toSeconds(data.resolvedAt) : null,
  resolvedBy: data.resolvedBy || null,
  resolutionNote: data.resolutionNote || null,
  refundedAtSeconds: data.refundedAt ? toSeconds(data.refundedAt) : null,
  refundedBy: data.refundedBy || null,
  refundReference: data.refundReference || null,
});

const normalizeAppeal = (id: string, data: Record<string, any>): ViolationAppeal => ({
  id,
  violationId: data.violationId || "",
  driverId: data.driverId || "",
  tripId: data.tripId || "",
  reasonCategory: data.reasonCategory || "other",
  explanation: data.explanation || "",
  evidenceUrls: Array.isArray(data.evidenceUrls) ? data.evidenceUrls : [],
  status: data.status || "pending",
  submittedAtSeconds: toSeconds(data.submittedAt),
  reviewedAtSeconds: data.reviewedAt ? toSeconds(data.reviewedAt) : null,
  reviewedBy: data.reviewedBy || null,
  adminDecisionNote: data.adminDecisionNote || null,
  createdAtSeconds: toSeconds(data.createdAt),
  updatedAtSeconds: toSeconds(data.updatedAt),
});

export default function AdminViolationDetailScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams();
  const violationId = String(params.id || "");

  const [violation, setViolation] = useState<DriverViolation | null>(null);
  const [appeal, setAppeal] = useState<ViolationAppeal | null>(null);
  const [history, setHistory] = useState<DriverViolation[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"approve" | "reject" | "confirmRefund" | null>(null);
  const [busy, setBusy] = useState(false);
  const [imageViewerUri, setImageViewerUri] = useState<string | null>(null);

  useEffect(() => {
    if (!violationId) {
      setLoading(false);
      setNotFound(true);
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, "driverViolations", violationId),
      (snap) => {
        if (!snap.exists()) {
          setNotFound(true);
          setViolation(null);
        } else {
          setViolation(normalizeViolation(snap.id, snap.data()));
        }
        setLoading(false);
      },
      () => {
        setNotFound(true);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [violationId]);

  useEffect(() => {
    if (!violationId) return;
    return onSnapshot(
      query(collection(db, "violationAppeals"), where("violationId", "==", violationId)),
      (snap) => setAppeal(snap.empty ? null : normalizeAppeal(snap.docs[0].id, snap.docs[0].data())),
    );
  }, [violationId]);

  useEffect(() => {
    if (!violation?.driverId) return;
    getViolationHistoryForDriver(violation.driverId, violationId)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [violation?.driverId, violationId]);

  const driverInfo = useDriverDisplayInfo(useMemo(() => (violation ? [violation.driverId] : []), [violation]));

  const handleDecision = async (reason: string) => {
    if (!violation || !appeal || busy) return;

    if (confirmAction === "reject" && !reason.trim()) {
      Alert.alert(t("common.error"), t("driverNoShow.errorRejectionNoteRequired"));
      return;
    }

    setBusy(true);
    try {
      if (confirmAction === "approve") {
        await approveAppeal(violation.id, appeal.id, reason.trim());
      } else if (confirmAction === "reject") {
        await rejectAppeal(violation.id, appeal.id, reason.trim());
      }
      setConfirmAction(null);
      Alert.alert(t("admin.savedTitle"), t("driverNoShow.decisionSavedMessage"));
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("driverNoShow.errorSubmitFailed"));
    } finally {
      setBusy(false);
    }
  };

  // Confirming a manual refund is a completely SEPARATE action from
  // approving/rejecting the driver's appeal (see confirmManualRefund's own
  // header in driverNoShowLib.ts) — it never runs through handleDecision
  // above, and requires its own non-empty reference/note as the one real
  // record that a human actually verified a real refund happened.
  const handleConfirmRefund = async (reference: string) => {
    if (!violation || busy) return;

    if (!reference.trim()) {
      Alert.alert(t("common.error"), t("driverNoShow.errorRefundReferenceRequired"));
      return;
    }

    setBusy(true);
    try {
      await confirmManualRefund(violation.id, reference.trim());
      setConfirmAction(null);
      Alert.alert(t("admin.savedTitle"), t("driverNoShow.refundConfirmedMessage"));
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("driverNoShow.errorSubmitFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmModalConfirm = (reason: string) =>
    confirmAction === "confirmRefund" ? handleConfirmRefund(reason) : handleDecision(reason);

  if (loading) {
    return (
      <AdminScreen title={t("driverNoShow.violationDetailsTitle")}>
        <LoadingState label={t("driverNoShow.loadingViolations")} />
      </AdminScreen>
    );
  }

  if (notFound || !violation) {
    return (
      <AdminScreen title={t("driverNoShow.violationDetailsTitle")}>
        <View style={styles.center}>
          <Text style={styles.notFoundText}>{t("driverNoShow.violationNotFound")}</Text>
        </View>
      </AdminScreen>
    );
  }

  const canDecide = appeal && appeal.status === "pending";

  return (
    <AdminScreen title={t("driverNoShow.violationDetailsTitle")}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerCard}>
          <View style={styles.pill}>
            <Text style={styles.pillText}>
              {t(`driverNoShow.category.${violation.category}`, { defaultValue: violation.category })}
            </Text>
          </View>

          <Text style={styles.route}>
            {violation.routeFrom} → {violation.routeTo}
          </Text>

          <Text style={styles.driverName}>
            {t("admin.reportedByLabel", { name: driverInfo[violation.driverId]?.name || violation.driverId })}
          </Text>
          {driverInfo[violation.driverId]?.email || driverInfo[violation.driverId]?.phone ? (
            <Text style={styles.driverContact}>
              {[driverInfo[violation.driverId]?.email, driverInfo[violation.driverId]?.phone]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          ) : null}

          <View style={styles.infoGrid}>
            <View style={styles.infoRow}>
              <Ionicons name="people-outline" size={15} color={adminColors.textMuted} />
              <Text style={styles.infoText}>
                {t("driverNoShow.affectedPassengers", { count: violation.passengerCount })}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="card-outline" size={15} color={adminColors.textMuted} />
              <Text style={styles.infoText}>
                {violation.paymentMethods.join(", ") || "—"} · {violation.paidAmount} {violation.currency}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="return-down-back-outline" size={15} color={adminColors.textMuted} />
              <Text style={styles.infoText}>{t(`driverNoShow.refundStatus.${violation.refundStatus}`)}</Text>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="alert-circle-outline" size={15} color={adminColors.textMuted} />
              <Text style={styles.infoText}>
                {t(`driverNoShow.statusShort.${violation.status}`, { defaultValue: violation.status })}
              </Text>
            </View>
          </View>

          {violation.refundStatus === "refunded" && violation.refundReference ? (
            <View style={styles.decisionNoteBox}>
              <Text style={styles.decisionNoteLabel}>{t("driverNoShow.refundReferenceLabel")}</Text>
              <Text style={styles.decisionNoteText}>{violation.refundReference}</Text>
            </View>
          ) : null}

          {canConfirmManualRefund(violation.refundStatus) ? (
            <Pressable
              style={styles.confirmRefundButton}
              onPress={() => setConfirmAction("confirmRefund")}
            >
              <Ionicons name="checkmark-done-outline" size={16} color="#FFFFFF" />
              <Text style={styles.confirmRefundButtonText}>{t("driverNoShow.confirmRefundButton")}</Text>
            </Pressable>
          ) : null}
        </View>

        {appeal ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("driverNoShow.appealDetailsTitle")}</Text>
            <View style={styles.infoRow}>
              <Ionicons name="pricetag-outline" size={15} color={adminColors.textMuted} />
              <Text style={styles.infoText}>
                {t(NO_SHOW_REASON_LABEL_KEY[appeal.reasonCategory], { defaultValue: appeal.reasonCategory })}
              </Text>
            </View>
            <Text style={styles.explanation}>{appeal.explanation}</Text>

            {appeal.evidenceUrls.length > 0 ? (
              <Pressable onPress={() => setImageViewerUri(appeal.evidenceUrls[0])}>
                <Image source={{ uri: appeal.evidenceUrls[0] }} style={styles.evidenceThumb} />
              </Pressable>
            ) : null}

            {appeal.adminDecisionNote ? (
              <View style={styles.decisionNoteBox}>
                <Text style={styles.decisionNoteLabel}>{t("driverNoShow.adminDecision")}</Text>
                <Text style={styles.decisionNoteText}>{appeal.adminDecisionNote}</Text>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.noAppealText}>{t("driverNoShow.noAppealYet")}</Text>
          </View>
        )}

        {history.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {t("driverNoShow.previousViolations", { count: history.length })}
            </Text>
            {history.slice(0, 5).map((h) => (
              <Text key={h.id} style={styles.historyRow}>
                {h.routeFrom} → {h.routeTo} — {t(`driverNoShow.statusShort.${h.status}`, { defaultValue: h.status })}
              </Text>
            ))}
          </View>
        ) : null}

        {canDecide ? (
          <View style={styles.decisionButtonsRow}>
            <Pressable
              style={[styles.decisionButton, styles.rejectButton]}
              onPress={() => setConfirmAction("reject")}
            >
              <Text style={styles.rejectButtonText}>{t("driverNoShow.rejectAppealButton")}</Text>
            </Pressable>
            <Pressable
              style={[styles.decisionButton, styles.approveButton]}
              onPress={() => setConfirmAction("approve")}
            >
              <Text style={styles.approveButtonText}>{t("driverNoShow.approveAppealButton")}</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      <ConfirmModal
        visible={!!confirmAction}
        title={
          confirmAction === "approve"
            ? t("driverNoShow.approveAppealButton")
            : confirmAction === "reject"
              ? t("driverNoShow.rejectAppealButton")
              : t("driverNoShow.confirmRefundButton")
        }
        message={
          confirmAction === "approve"
            ? t("driverNoShow.confirmApproveMessage")
            : confirmAction === "reject"
              ? t("driverNoShow.confirmRejectMessage")
              : t("driverNoShow.confirmRefundMessage")
        }
        confirmLabel={
          confirmAction === "approve"
            ? t("driverNoShow.approveAppealButton")
            : confirmAction === "reject"
              ? t("driverNoShow.rejectAppealButton")
              : t("driverNoShow.confirmRefundButton")
        }
        destructive={confirmAction === "reject"}
        requireReason={confirmAction === "reject" || confirmAction === "confirmRefund"}
        reasonPlaceholder={
          confirmAction === "confirmRefund"
            ? t("driverNoShow.refundReferencePlaceholder")
            : t("driverNoShow.adminNotePlaceholder")
        }
        busy={busy}
        onCancel={() => setConfirmAction(null)}
        onConfirm={handleConfirmModalConfirm}
      />

      <Modal
        visible={!!imageViewerUri}
        transparent
        animationType="fade"
        onRequestClose={() => setImageViewerUri(null)}
      >
        <Pressable style={styles.imageViewerBackdrop} onPress={() => setImageViewerUri(null)}>
          {imageViewerUri ? (
            <Image source={{ uri: imageViewerUri }} style={styles.imageViewerPhoto} resizeMode="contain" />
          ) : null}
        </Pressable>
      </Modal>
    </AdminScreen>
  );
}

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
  route: {
    fontSize: 16,
    fontWeight: "800",
    color: adminColors.text,
  },
  driverName: {
    fontSize: 13,
    color: adminColors.text,
    fontWeight: "700",
    marginTop: 8,
  },
  driverContact: {
    fontSize: 12,
    color: adminColors.textMuted,
    marginTop: 2,
  },
  infoGrid: {
    marginTop: 12,
    gap: 8,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  infoText: {
    fontSize: 13,
    color: adminColors.text,
  },
  confirmRefundButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: adminRadius.md,
    backgroundColor: adminColors.primaryDark,
  },
  confirmRefundButtonText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 13,
  },
  section: {
    backgroundColor: adminColors.card,
    borderWidth: 1,
    borderColor: adminColors.border,
    borderRadius: adminRadius.lg,
    padding: adminSpacing.md,
    marginBottom: adminSpacing.md,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: adminColors.text,
  },
  explanation: {
    fontSize: 13.5,
    color: adminColors.text,
    lineHeight: 19,
  },
  evidenceThumb: {
    width: 110,
    height: 110,
    borderRadius: adminRadius.md,
    marginTop: 4,
  },
  decisionNoteBox: {
    backgroundColor: adminColors.warningBg,
    borderRadius: adminRadius.md,
    padding: 10,
    marginTop: 6,
  },
  decisionNoteLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: adminColors.primaryDark,
    marginBottom: 4,
  },
  decisionNoteText: {
    fontSize: 12.5,
    color: adminColors.text,
  },
  noAppealText: {
    fontSize: 13,
    color: adminColors.textMuted,
  },
  historyRow: {
    fontSize: 12.5,
    color: adminColors.textMuted,
  },
  decisionButtonsRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 6,
  },
  decisionButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: adminRadius.md,
    alignItems: "center",
  },
  approveButton: {
    backgroundColor: adminColors.success,
  },
  approveButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  rejectButton: {
    backgroundColor: adminColors.danger,
  },
  rejectButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  imageViewerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  imageViewerPhoto: {
    width: "100%",
    height: "80%",
  },
});
