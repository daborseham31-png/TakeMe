import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "../../router/expoRouterShim";
import { doc, onSnapshot } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { db } from "../../../firebase";
import {
  addDriverAdminNote,
  getMissingDriverRequirements,
  setDriverVerification,
} from "../adminDriversLib";
import { normalizeAdminUser } from "../adminUsersLib";
import { AdminUserRow, DriverVerificationStatus } from "../adminTypes";
import { adminColors, adminRadius, adminSpacing } from "../adminTheme";
import AdminScreen from "../components/AdminScreen";
import { LoadingState } from "../components/AdminStates";
import ConfirmModal from "../components/ConfirmModal";
import { translateDriverVerificationStatus } from "../../i18n/formatters";
import {
  DriverCancellationStanding,
  DriverCancellationViolation,
  excuseDriverCancellationViolation,
  liftDriverCancellationSuspension,
  normalizeCancellationStanding,
  subscribeDriverCancellationViolations,
} from "../../booking/driverViolationsLib";

type PendingAction = { type: DriverVerificationStatus } | null;

const SUSPENSION_TIER_LABEL_KEY: Record<number, string> = {
  1: "admin.suspensionTierSeven",
  2: "admin.suspensionTierThirty",
  3: "admin.suspensionTierIndefinite",
};

export default function AdminDriverDetailScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams();
  const driverId = String(params.id || "");

  const [driver, setDriver] = useState<AdminUserRow | null>(null);
  const [standing, setStanding] = useState<DriverCancellationStanding | null>(null);
  const [violations, setViolations] = useState<DriverCancellationViolation[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [liftSuspensionModalOpen, setLiftSuspensionModalOpen] = useState(false);
  const [liftingSuspension, setLiftingSuspension] = useState(false);
  const [excusingViolationId, setExcusingViolationId] = useState<string | null>(null);
  const [excuseBusy, setExcuseBusy] = useState(false);

  useEffect(() => {
    if (!driverId) {
      setLoading(false);
      setNotFound(true);
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, "users", driverId),
      (snap) => {
        if (!snap.exists()) {
          setNotFound(true);
          setDriver(null);
          setStanding(null);
        } else {
          setDriver(normalizeAdminUser(snap.id, snap.data()));
          setStanding(normalizeCancellationStanding(snap.data()));
        }
        setLoading(false);
      },
      () => {
        setNotFound(true);
        setLoading(false);
      },
    );

    const unsubscribeViolations = subscribeDriverCancellationViolations(
      driverId,
      setViolations,
      () => setViolations([]),
    );

    return () => {
      unsubscribe();
      unsubscribeViolations();
    };
  }, [driverId]);

  const missingRequirements = driver ? getMissingDriverRequirements(driver) : [];

  const openAction = (type: DriverVerificationStatus) => {
    if (type === "approved" && missingRequirements.length > 0) {
      Alert.alert(
        t("admin.cannotApproveYetTitle"),
        t("admin.driverMissingMessage", { list: missingRequirements.join(", ") }),
      );
      return;
    }

    setPendingAction({ type });
  };

  const runAction = async (reason: string) => {
    if (!pendingAction || busy) return;

    try {
      setBusy(true);
      await setDriverVerification(driverId, pendingAction.type, reason);
      setPendingAction(null);
      Alert.alert(t("admin.successTitle"), t("admin.driverUpdatedNotifiedMessage"));
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("admin.couldNotUpdateDriver"));
    } finally {
      setBusy(false);
    }
  };

  const canLiftSuspension =
    !!standing?.suspensionActive &&
    (!standing.suspensionMinEndAt || standing.suspensionMinEndAt.toMillis() <= Date.now());

  const runLiftSuspension = async (reason: string) => {
    if (liftingSuspension) return;

    try {
      setLiftingSuspension(true);
      await liftDriverCancellationSuspension(driverId, reason);
      setLiftSuspensionModalOpen(false);
      Alert.alert(t("admin.savedTitle"), t("admin.suspensionLiftedMessage"));
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("admin.couldNotUpdateDriver"));
    } finally {
      setLiftingSuspension(false);
    }
  };

  const runExcuseViolation = async (reason: string) => {
    if (!excusingViolationId || excuseBusy) return;

    try {
      setExcuseBusy(true);
      await excuseDriverCancellationViolation(driverId, excusingViolationId, reason);
      setExcusingViolationId(null);
      Alert.alert(t("admin.savedTitle"), t("admin.violationExcusedMessage"));
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("admin.couldNotUpdateDriver"));
    } finally {
      setExcuseBusy(false);
    }
  };

  const handleSaveNote = async () => {
    if (!note.trim() || savingNote) return;

    try {
      setSavingNote(true);
      await addDriverAdminNote(driverId, note.trim());
      setNote("");
      Alert.alert(t("admin.savedTitle"), t("admin.internalNoteAddedMessage"));
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("admin.couldNotSaveNote"));
    } finally {
      setSavingNote(false);
    }
  };

  if (loading) {
    return (
      <AdminScreen title={t("admin.driverDetailsTitle")}>
        <LoadingState label={t("admin.loadingDriverLabel")} />
      </AdminScreen>
    );
  }

  if (notFound || !driver) {
    return (
      <AdminScreen title={t("admin.driverDetailsTitle")}>
        <View style={styles.center}>
          <Text style={styles.notFoundText}>{t("admin.driverNotFound")}</Text>
        </View>
      </AdminScreen>
    );
  }

  return (
    <AdminScreen title={t("admin.driverDetailsTitle")}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.headerCard}>
            {driver.photo ? (
              <Image source={{ uri: driver.photo }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Ionicons name="car" size={28} color={adminColors.primary} />
              </View>
            )}
            <Text style={styles.name}>{driver.name}</Text>
            <View style={styles.pill}>
              <Text style={styles.pillText}>{translateDriverVerificationStatus(driver.driverVerificationStatus, t)}</Text>
            </View>
          </View>

          {missingRequirements.length > 0 ? (
            <View style={styles.missingBox}>
              <Ionicons name="warning-outline" size={18} color={adminColors.warning} />
              <Text style={styles.missingText}>
                {t("admin.missingBeforeApproval", { list: missingRequirements.join(", ") })}
              </Text>
            </View>
          ) : null}

          {driver.licenseNeedsManualDocumentReview ? (
            <View style={styles.missingBox}>
              <Ionicons name="eye-outline" size={18} color={adminColors.warning} />
              <Text style={styles.missingText}>
                The system could not confidently confirm the uploaded document
                is a driving license — please review the document manually
                before approving.
              </Text>
            </View>
          ) : null}

          <View style={styles.section}>
            <Row icon="call-outline" label={t("admin.phoneLabel")} value={driver.phone || "—"} />
            <Row icon="mail-outline" label={t("admin.emailLabel")} value={driver.email || "—"} />
            <Row icon="barcode-outline" label={t("admin.plateLabel")} value={driver.carPlate || "—"} />
            <Row
              icon="document-text-outline"
              label={t("admin.licenseExpiryLabel")}
              value={driver.licenseExpiryDate || "—"}
            />
            <Row
              icon="scan-outline"
              label="License document check"
              value={
                driver.licenseDocumentType
                  ? `${driver.licenseDocumentType} (${Math.round(
                      driver.licenseDocumentTypeConfidence * 100,
                    )}% confidence)`
                  : "—"
              }
            />
            <Row
              icon="language-outline"
              label={t("admin.languagesLabel")}
              value={driver.spokenLanguages.join(", ") || "—"}
            />
            <Row
              icon="star-outline"
              label={t("admin.ratingLabel")}
              value={t("admin.ratingReviewsValue", { avg: driver.ratingAverage.toFixed(1), count: driver.ratingCount })}
            />
            <Row
              icon="calendar-outline"
              label={t("admin.joinedLabel")}
              value={
                driver.createdAtSeconds
                  ? new Date(driver.createdAtSeconds * 1000).toLocaleDateString()
                  : "—"
              }
            />
          </View>

          <View style={styles.actions}>
            {driver.driverVerificationStatus === "pending_admin_review" ? (
              <>
                <ActionButton
                  icon="checkmark-circle-outline"
                  label={t("admin.approveDriver")}
                  tone="success"
                  onPress={() => openAction("approved")}
                />
                <ActionButton
                  icon="close-circle-outline"
                  label={t("admin.rejectDriver")}
                  tone="danger"
                  onPress={() => openAction("rejected")}
                />
              </>
            ) : driver.driverVerificationStatus === "approved" ? (
              <ActionButton
                icon="pause-circle-outline"
                label={t("admin.suspendDriver")}
                tone="warning"
                onPress={() => openAction("suspended")}
              />
            ) : (
              <ActionButton
                icon="refresh-circle-outline"
                label={t("admin.reactivateReapproveDriver")}
                tone="success"
                onPress={() => openAction("approved")}
              />
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("admin.cancellationStandingTitle")}</Text>

            {standing?.suspensionActive ? (
              <>
                <Row
                  icon="ban-outline"
                  label={t("admin.suspensionTierLabel")}
                  value={t(SUSPENSION_TIER_LABEL_KEY[standing.suspensionTier] || "admin.suspensionTierSeven")}
                />
                <Row
                  icon="calendar-outline"
                  label={t("admin.suspensionStartLabel")}
                  value={
                    standing.suspensionStartAt
                      ? standing.suspensionStartAt.toDate().toLocaleDateString()
                      : "—"
                  }
                />
                {standing.suspensionMinEndAt ? (
                  <Row
                    icon="time-outline"
                    label={t("admin.suspensionMinEndLabel")}
                    value={standing.suspensionMinEndAt.toDate().toLocaleDateString()}
                  />
                ) : null}
                <Row
                  icon="document-text-outline"
                  label={t("admin.suspensionReasonLabel")}
                  value={standing.suspensionReason || "—"}
                />

                {!canLiftSuspension ? (
                  <Text style={styles.missingText}>{t("admin.liftSuspensionTooEarlyMessage")}</Text>
                ) : null}

                <ActionButton
                  icon="play-circle-outline"
                  label={t("admin.liftSuspensionButton")}
                  tone="success"
                  onPress={() => setLiftSuspensionModalOpen(true)}
                  disabled={!canLiftSuspension}
                />
              </>
            ) : (
              <Text style={styles.rowValue}>{t("admin.noActiveSuspensionLabel")}</Text>
            )}

            {standing && standing.suspensionCount > 0 ? (
              <Row
                icon="repeat-outline"
                label={t("admin.suspensionCountLabel")}
                value={String(standing.suspensionCount)}
              />
            ) : null}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("admin.suspensionHistoryTitle")}</Text>

            {violations.length === 0 ? (
              <Text style={styles.rowValue}>{t("admin.noViolationsYetLabel")}</Text>
            ) : (
              violations.map((violation) => (
                <View key={violation.id} style={styles.violationRow}>
                  <View style={styles.violationHeader}>
                    <Text style={styles.violationDate}>
                      {violation.createdAtSeconds
                        ? new Date(violation.createdAtSeconds * 1000).toLocaleDateString()
                        : "—"}
                    </Text>
                    <Text style={styles.violationCategory}>{violation.sourceCategory}</Text>
                  </View>

                  <View style={styles.violationBadgeRow}>
                    {violation.lateCancellation ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{t("admin.lateCancellationBadge")}</Text>
                      </View>
                    ) : null}
                    {violation.adminExcused ? (
                      <View style={[styles.badge, styles.badgeExcused]}>
                        <Text style={styles.badgeText}>{t("admin.adminExcusedBadge")}</Text>
                      </View>
                    ) : null}
                  </View>

                  {!violation.adminExcused ? (
                    <Pressable
                      style={styles.excuseButton}
                      onPress={() => setExcusingViolationId(violation.id)}
                    >
                      <Text style={styles.excuseButtonText}>{t("admin.excuseViolationButton")}</Text>
                    </Pressable>
                  ) : violation.excuseReason ? (
                    <Text style={styles.violationExcuseReason}>{violation.excuseReason}</Text>
                  ) : null}
                </View>
              ))
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("admin.internalAdminNoteTitle")}</Text>
            <TextInput
              style={styles.noteInput}
              placeholder={t("admin.addPrivateNotePlaceholder")}
              placeholderTextColor={adminColors.placeholder}
              value={note}
              onChangeText={setNote}
              multiline
            />
            <Pressable
              style={[styles.saveNoteButton, (!note.trim() || savingNote) && styles.saveNoteDisabled]}
              onPress={handleSaveNote}
              disabled={!note.trim() || savingNote}
            >
              <Text style={styles.saveNoteText}>{savingNote ? t("admin.savingButton") : t("admin.saveNoteButton")}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmModal
        visible={!!pendingAction}
        title={
          pendingAction?.type === "approved"
            ? t("admin.approveThisDriverQ")
            : pendingAction?.type === "rejected"
              ? t("admin.rejectThisDriverQ")
              : t("admin.suspendThisDriverQ")
        }
        message={t("admin.driverNotifiedImmediately")}
        confirmLabel={t("admin.confirmButton")}
        destructive={pendingAction?.type !== "approved"}
        requireReason={pendingAction?.type === "rejected" || pendingAction?.type === "suspended"}
        reasonPlaceholder={t("admin.reasonShownToDriverPlaceholder")}
        busy={busy}
        onCancel={() => setPendingAction(null)}
        onConfirm={runAction}
      />

      <ConfirmModal
        visible={liftSuspensionModalOpen}
        title={t("admin.liftSuspensionThisDriverQ")}
        message={t("admin.driverNotifiedImmediately")}
        confirmLabel={t("admin.confirmButton")}
        destructive={false}
        requireReason
        reasonPlaceholder={t("admin.reasonShownToDriverPlaceholder")}
        busy={liftingSuspension}
        onCancel={() => setLiftSuspensionModalOpen(false)}
        onConfirm={runLiftSuspension}
      />

      <ConfirmModal
        visible={!!excusingViolationId}
        title={t("admin.excuseViolationButton")}
        message={t("admin.excuseViolationReasonPlaceholder")}
        confirmLabel={t("admin.confirmButton")}
        destructive={false}
        requireReason
        reasonPlaceholder={t("admin.excuseViolationReasonPlaceholder")}
        busy={excuseBusy}
        onCancel={() => setExcusingViolationId(null)}
        onConfirm={runExcuseViolation}
      />
    </AdminScreen>
  );
}

const Row = ({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) => (
  <View style={styles.row}>
    <Ionicons name={icon} size={16} color={adminColors.textMuted} />
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={styles.rowValue} numberOfLines={1}>
      {value}
    </Text>
  </View>
);

const ActionButton = ({
  icon,
  label,
  tone,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tone: "danger" | "warning" | "success";
  onPress: () => void;
  disabled?: boolean;
}) => (
  <Pressable
    style={[
      styles.actionButton,
      tone === "danger" && styles.actionDanger,
      tone === "warning" && styles.actionWarning,
      tone === "success" && styles.actionSuccess,
      disabled && styles.actionDisabled,
    ]}
    onPress={onPress}
    disabled={disabled}
  >
    <Ionicons
      name={icon}
      size={18}
      color={
        tone === "danger"
          ? adminColors.danger
          : tone === "warning"
            ? adminColors.warning
            : adminColors.success
      }
    />
    <Text
      style={[
        styles.actionText,
        tone === "danger" && { color: adminColors.danger },
        tone === "warning" && { color: adminColors.warning },
        tone === "success" && { color: adminColors.success },
      ]}
    >
      {label}
    </Text>
  </Pressable>
);

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
    alignItems: "center",
    backgroundColor: adminColors.card,
    borderWidth: 1,
    borderColor: adminColors.border,
    borderRadius: adminRadius.lg,
    padding: adminSpacing.lg,
    marginBottom: adminSpacing.md,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: 10,
  },
  avatarPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: adminColors.warningBg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  name: {
    fontSize: 18,
    fontWeight: "900",
    color: adminColors.text,
  },
  pill: {
    backgroundColor: adminColors.warningBg,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: adminRadius.pill,
    marginTop: 8,
  },
  pillText: {
    fontSize: 12,
    fontWeight: "800",
    color: adminColors.text,
    textTransform: "capitalize",
  },
  missingBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: adminColors.warningBg,
    borderRadius: adminRadius.sm,
    padding: 12,
    marginBottom: adminSpacing.md,
  },
  missingText: {
    flex: 1,
    color: adminColors.warning,
    fontWeight: "700",
    fontSize: 12.5,
  },
  section: {
    backgroundColor: adminColors.card,
    borderWidth: 1,
    borderColor: adminColors.border,
    borderRadius: adminRadius.lg,
    padding: adminSpacing.md,
    marginBottom: adminSpacing.md,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: adminColors.text,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowLabel: {
    color: adminColors.textMuted,
    fontWeight: "700",
    fontSize: 13,
    width: 110,
  },
  rowValue: {
    flex: 1,
    color: adminColors.text,
    fontWeight: "700",
    fontSize: 13,
  },
  actions: {
    gap: 10,
    marginBottom: adminSpacing.md,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: adminColors.card,
    borderWidth: 1,
    borderColor: adminColors.border,
    borderRadius: adminRadius.md,
    padding: 14,
  },
  actionDanger: {
    borderColor: adminColors.danger,
    backgroundColor: adminColors.dangerBg,
  },
  actionWarning: {
    borderColor: adminColors.warning,
    backgroundColor: adminColors.warningBg,
  },
  actionSuccess: {
    borderColor: adminColors.success,
    backgroundColor: adminColors.successBg,
  },
  actionDisabled: {
    opacity: 0.5,
  },
  actionText: {
    fontSize: 14,
    fontWeight: "800",
    color: adminColors.text,
  },
  violationRow: {
    borderWidth: 1,
    borderColor: adminColors.border,
    borderRadius: adminRadius.sm,
    padding: 10,
    gap: 6,
  },
  violationHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  violationDate: {
    color: adminColors.text,
    fontWeight: "800",
    fontSize: 12.5,
  },
  violationCategory: {
    color: adminColors.textMuted,
    fontWeight: "700",
    fontSize: 12.5,
    textTransform: "capitalize",
  },
  violationBadgeRow: {
    flexDirection: "row",
    gap: 6,
  },
  badge: {
    backgroundColor: adminColors.warningBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: adminRadius.pill,
  },
  badgeExcused: {
    backgroundColor: adminColors.successBg,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: adminColors.text,
  },
  excuseButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: adminColors.borderStrong,
    borderRadius: adminRadius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  excuseButtonText: {
    fontSize: 12,
    fontWeight: "800",
    color: adminColors.text,
  },
  violationExcuseReason: {
    fontSize: 12,
    fontStyle: "italic",
    color: adminColors.textMuted,
  },
  noteInput: {
    borderWidth: 1,
    borderColor: adminColors.borderStrong,
    borderRadius: adminRadius.sm,
    padding: 12,
    minHeight: 70,
    textAlignVertical: "top",
    color: adminColors.text,
  },
  saveNoteButton: {
    backgroundColor: adminColors.primary,
    borderRadius: adminRadius.sm,
    paddingVertical: 12,
    alignItems: "center",
  },
  saveNoteDisabled: {
    opacity: 0.5,
  },
  saveNoteText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
});
