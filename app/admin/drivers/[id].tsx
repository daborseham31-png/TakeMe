import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import React, { useEffect, useMemo, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Alert } from "../../AppAlert";
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
  ADMIN_EXCUSE_REASON_LABEL_KEY,
  ADMIN_EXCUSE_REASONS,
  AdminExcuseReasonKey,
  approveCancellationViolationAppeal,
  DriverCancellationStanding,
  DriverCancellationViolation,
  excuseDriverCancellationViolation,
  liftDriverCancellationSuspension,
  normalizeCancellationStanding,
  rejectCancellationViolationAppeal,
  ROLLING_WINDOW_DAYS,
  subscribeDriverCancellationViolations,
} from "../../booking/driverViolationsLib";
import { NO_SHOW_REASON_LABEL_KEY, normalizeAppeal, ViolationAppeal } from "../../booking/driverNoShowLib";

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
  const [excuseReasonKey, setExcuseReasonKey] = useState<AdminExcuseReasonKey | null>(null);
  const [excuseNote, setExcuseNote] = useState("");
  const [excuseBusy, setExcuseBusy] = useState(false);
  // Appeals for THIS driver's cancellation violations — one query covers
  // every violation on the screen (never a per-row subscription). Matched to
  // its violation client-side via appealsByViolationId below.
  const [appeals, setAppeals] = useState<ViolationAppeal[]>([]);
  const [appealAction, setAppealAction] = useState<{
    violationId: string;
    appealId: string;
    type: "approve" | "reject";
  } | null>(null);
  const [appealBusy, setAppealBusy] = useState(false);

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

    // Admin can read across drivers (isAdmin() in firestore.rules), so this
    // is a normal query, not the driver-scoped subscribeAppealForViolation
    // helper — that one is per-violation and would mean one listener per
    // row here instead of one for the whole screen. Covers both violation
    // systems' appeals for this driver (violationSource distinguishes them
    // — see driverNoShowLib.ts); only cancellation-source appeals are
    // actually rendered below, since no-show appeals are reviewed from
    // app/admin/violations/[id].tsx instead.
    const unsubscribeAppeals = onSnapshot(
      query(collection(db, "violationAppeals"), where("driverId", "==", driverId)),
      (snap) => setAppeals(snap.docs.map((d) => normalizeAppeal(d.id, d.data()))),
      () => setAppeals([]),
    );

    return () => {
      unsubscribe();
      unsubscribeViolations();
      unsubscribeAppeals();
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

  // An admin may lift a cancellation suspension at ANY time — including
  // before suspensionMinEndAt/"Earliest Lift Date" — see
  // liftDriverCancellationSuspension's own comment (driverViolationsLib.ts)
  // for why that date is informational only, never a block on this button.
  const canLiftSuspension = !!standing?.suspensionActive;

  // Derived live from the same onSnapshot-subscribed violations list (never
  // a second, separate Firestore fetch) — this is what makes excusing a
  // violation immediately recalculate BOTH counts on this screen without a
  // reload (item 8/9): filtering out the just-excused doc updates
  // `violations` via the live listener, which this useMemo re-derives from.
  const currentValidCount = useMemo(() => {
    const windowStartSeconds = Date.now() / 1000 - ROLLING_WINDOW_DAYS * 24 * 60 * 60;
    return violations.filter((v) => !v.adminExcused && v.createdAtSeconds >= windowStartSeconds)
      .length;
  }, [violations]);

  const countSinceReinstatement = useMemo(() => {
    const reinstatedAtSeconds = standing?.reinstatedAt ? standing.reinstatedAt.seconds : null;
    return violations.filter(
      (v) => !v.adminExcused && (!reinstatedAtSeconds || v.createdAtSeconds >= reinstatedAtSeconds),
    ).length;
  }, [violations, standing]);

  // One appeal per violation, ever (see submitViolationAppeal's deterministic
  // appeal id) — this map lets each violation row below look its own appeal
  // up in O(1) without a second Firestore read per row.
  const appealsByViolationId = useMemo(() => {
    const map = new Map<string, ViolationAppeal>();
    appeals
      .filter((a) => a.violationSource === "cancellationViolations")
      .forEach((a) => map.set(a.violationId, a));
    return map;
  }, [appeals]);

  const closeAppealAction = () => setAppealAction(null);

  const runAppealDecision = async (reason: string) => {
    if (!appealAction || appealBusy) return;

    if (appealAction.type === "reject" && !reason.trim()) {
      Alert.alert(t("common.error"), t("driverNoShow.errorRejectionNoteRequired"));
      return;
    }

    setAppealBusy(true);
    try {
      if (appealAction.type === "approve") {
        await approveCancellationViolationAppeal(driverId, appealAction.violationId, appealAction.appealId, reason.trim());
      } else {
        await rejectCancellationViolationAppeal(driverId, appealAction.violationId, appealAction.appealId, reason.trim());
      }
      closeAppealAction();
      Alert.alert(t("admin.savedTitle"), t("driverNoShow.decisionSavedMessage"));
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("driverNoShow.errorSubmitFailed"));
    } finally {
      setAppealBusy(false);
    }
  };

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

  const closeExcuseModal = () => {
    setExcusingViolationId(null);
    setExcuseReasonKey(null);
    setExcuseNote("");
  };

  const runExcuseViolation = async () => {
    if (!excusingViolationId || !excuseReasonKey || excuseBusy) return;

    try {
      setExcuseBusy(true);
      await excuseDriverCancellationViolation(
        driverId,
        excusingViolationId,
        excuseReasonKey,
        excuseNote.trim(),
      );
      closeExcuseModal();
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
                <Row
                  icon="infinite-outline"
                  label={t("admin.suspensionIndefiniteLabel")}
                  value={standing.indefinite ? t("common.yes") : t("common.no")}
                />

                {/* Admin may lift this suspension at any time — the
                    Earliest Lift Date above is informational only (what the
                    automatic system would otherwise wait for), never a
                    restriction on this button. */}
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

            <Row
              icon="calendar-number-outline"
              label={t("admin.currentValidCountLabel")}
              value={String(currentValidCount)}
            />
            <Row
              icon="refresh-outline"
              label={t("admin.countSinceReinstatementLabel")}
              value={String(countSinceReinstatement)}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("admin.suspensionHistoryTitle")}</Text>

            {violations.length === 0 ? (
              <Text style={styles.rowValue}>{t("admin.noViolationsYetLabel")}</Text>
            ) : (
              violations.map((violation) => {
                // At most one appeal per violation, ever (deterministic
                // appeal id — see submitViolationAppeal). null when the
                // driver never appealed this one.
                const appeal = appealsByViolationId.get(violation.id) || null;

                return (
                  <View key={violation.id} style={styles.violationRow}>
                    <View style={styles.violationHeader}>
                      <Text style={styles.violationDate}>
                        {violation.createdAtSeconds
                          ? new Date(violation.createdAtSeconds * 1000).toLocaleDateString()
                          : "—"}
                      </Text>
                      <Text style={styles.violationCategory}>{violation.sourceCategory}</Text>
                    </View>

                    <Text style={styles.violationMeta}>
                      {t("admin.violationBookingIdLabel")}: {violation.sourceId || "—"}
                    </Text>
                    <Text style={styles.violationMeta}>
                      {t("admin.violationScheduledLabel")}:{" "}
                      {violation.scheduledDepartureSeconds
                        ? new Date(violation.scheduledDepartureSeconds * 1000).toLocaleString()
                        : "—"}
                    </Text>
                    <Text style={styles.violationMeta}>
                      {t("admin.violationPassengerCountLabel")}: {violation.passengerBookingCount}
                    </Text>

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

                    {/* The direct-Excuse shortcut stays available regardless
                        of appeal state (an admin can still excuse outright
                        without waiting for/reviewing an appeal) — only
                        hidden once already excused. The excuse-reason
                        summary line is skipped for an appeal-approved
                        excuse, since the appeal box below already explains
                        it (excuseReason there is the literal
                        "appeal_approved" marker, not a real preset reason). */}
                    {!violation.adminExcused ? (
                      <Pressable
                        style={styles.excuseButton}
                        onPress={() => setExcusingViolationId(violation.id)}
                      >
                        <Text style={styles.excuseButtonText}>{t("admin.excuseViolationButton")}</Text>
                      </Pressable>
                    ) : violation.excuseReason && violation.excuseReason !== "appeal_approved" ? (
                      <Text style={styles.violationExcuseReason}>
                        {t(
                          ADMIN_EXCUSE_REASON_LABEL_KEY[violation.excuseReason as AdminExcuseReasonKey] ||
                            "admin.excuseReasonOther",
                        )}
                        {violation.excuseNote ? ` — ${violation.excuseNote}` : ""}
                      </Text>
                    ) : null}

                    {appeal ? (
                      <View style={styles.appealBox}>
                        <Text style={styles.appealBoxTitle}>{t("driverNoShow.submitAppeal")}</Text>
                        <Text style={styles.violationMeta}>
                          {t("driverNoShow.appealReason")}: {t(NO_SHOW_REASON_LABEL_KEY[appeal.reasonCategory])}
                        </Text>
                        <Text style={styles.appealBoxExplanation}>{appeal.explanation}</Text>

                        {appeal.status === "pending" ? (
                          <View style={styles.appealButtonsRow}>
                            <Pressable
                              style={[styles.appealDecisionButton, styles.appealRejectButton]}
                              onPress={() =>
                                setAppealAction({ violationId: violation.id, appealId: appeal.id, type: "reject" })
                              }
                            >
                              <Text style={styles.appealRejectButtonText}>{t("driverNoShow.rejectAppealButton")}</Text>
                            </Pressable>
                            <Pressable
                              style={[styles.appealDecisionButton, styles.appealApproveButton]}
                              onPress={() =>
                                setAppealAction({ violationId: violation.id, appealId: appeal.id, type: "approve" })
                              }
                            >
                              <Text style={styles.appealApproveButtonText}>{t("driverNoShow.approveAppealButton")}</Text>
                            </Pressable>
                          </View>
                        ) : appeal.status === "approved" ? (
                          <View style={[styles.badge, styles.badgeExcused]}>
                            <Text style={styles.badgeText}>{t("driverNoShow.statusAppealApprovedRemoved")}</Text>
                          </View>
                        ) : (
                          <View style={styles.badge}>
                            <Text style={styles.badgeText}>{t("driverNoShow.statusAppealRejectedActive")}</Text>
                          </View>
                        )}
                      </View>
                    ) : null}
                  </View>
                );
              })
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

      {/* Approve/reject a driver-cancellation appeal — mirrors
          app/admin/violations/[id].tsx's own no-show approve/reject modal
          exactly (same ConfirmModal, same requireReason-only-for-reject
          shape), just targeting approveCancellationViolationAppeal/
          rejectCancellationViolationAppeal instead. */}
      <ConfirmModal
        visible={!!appealAction}
        title={
          appealAction?.type === "approve" ? t("driverNoShow.approveAppealButton") : t("driverNoShow.rejectAppealButton")
        }
        message={t("admin.reasonShownToDriverPlaceholder")}
        confirmLabel={t("admin.confirmButton")}
        destructive={appealAction?.type === "reject"}
        requireReason={appealAction?.type === "reject"}
        reasonPlaceholder={t("admin.reasonShownToDriverPlaceholder")}
        busy={appealBusy}
        onCancel={closeAppealAction}
        onConfirm={runAppealDecision}
      />

      {/* A plain ConfirmModal only ever collects one free-text reason — this
          needs a fixed, translated PRESET list (item 8) plus an optional
          note, so it's its own small modal instead. */}
      <Modal
        visible={!!excusingViolationId}
        transparent
        animationType="fade"
        onRequestClose={excuseBusy ? () => {} : closeExcuseModal}
      >
        <View style={styles.excuseBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={excuseBusy ? undefined : closeExcuseModal}
          />

          <View style={styles.excuseCard}>
            <Text style={styles.excuseTitle}>{t("admin.excuseViolationButton")}</Text>
            <Text style={styles.excuseSubtitle}>{t("admin.excuseReasonPickerHint")}</Text>

            {ADMIN_EXCUSE_REASONS.map((reasonKey) => (
              <Pressable
                key={reasonKey}
                style={[
                  styles.excuseReasonOption,
                  excuseReasonKey === reasonKey && styles.excuseReasonOptionActive,
                ]}
                onPress={() => setExcuseReasonKey(reasonKey)}
              >
                <Ionicons
                  name={excuseReasonKey === reasonKey ? "radio-button-on" : "radio-button-off"}
                  size={18}
                  color={excuseReasonKey === reasonKey ? adminColors.primary : adminColors.textMuted}
                />
                <Text style={styles.excuseReasonOptionText}>
                  {t(ADMIN_EXCUSE_REASON_LABEL_KEY[reasonKey])}
                </Text>
              </Pressable>
            ))}

            <TextInput
              style={styles.excuseNoteInput}
              placeholder={t("admin.excuseNotePlaceholder")}
              placeholderTextColor={adminColors.placeholder}
              value={excuseNote}
              onChangeText={setExcuseNote}
              multiline
            />

            <View style={styles.excuseButtonsRow}>
              <Pressable
                style={styles.excuseCancelButton}
                onPress={closeExcuseModal}
                disabled={excuseBusy}
              >
                <Text style={styles.excuseCancelButtonText}>{t("common.cancel")}</Text>
              </Pressable>

              <Pressable
                style={[
                  styles.excuseConfirmButton,
                  (!excuseReasonKey || excuseBusy) && styles.excuseConfirmButtonDisabled,
                ]}
                onPress={runExcuseViolation}
                disabled={!excuseReasonKey || excuseBusy}
              >
                <Text style={styles.excuseConfirmButtonText}>
                  {excuseBusy ? t("admin.savingButton") : t("admin.confirmButton")}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  violationMeta: {
    color: adminColors.textMuted,
    fontSize: 12,
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
  appealBox: {
    marginTop: 6,
    padding: 10,
    borderRadius: adminRadius.sm,
    borderWidth: 1,
    borderColor: adminColors.borderStrong,
    backgroundColor: adminColors.page,
    gap: 4,
  },
  appealBoxTitle: {
    fontSize: 12,
    fontWeight: "900",
    color: adminColors.text,
  },
  appealBoxExplanation: {
    fontSize: 12,
    color: adminColors.text,
  },
  appealButtonsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  appealDecisionButton: {
    flex: 1,
    borderRadius: adminRadius.sm,
    paddingVertical: 8,
    alignItems: "center",
  },
  appealApproveButton: {
    backgroundColor: adminColors.primary,
  },
  appealApproveButtonText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  appealRejectButton: {
    borderWidth: 1,
    borderColor: adminColors.danger,
  },
  appealRejectButtonText: {
    fontSize: 12,
    fontWeight: "900",
    color: adminColors.danger,
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
  excuseBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: adminSpacing.lg,
  },
  excuseCard: {
    backgroundColor: adminColors.card,
    borderRadius: adminRadius.lg,
    padding: adminSpacing.lg,
  },
  excuseTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: adminColors.text,
    marginBottom: 4,
  },
  excuseSubtitle: {
    fontSize: 13,
    color: adminColors.textMuted,
    marginBottom: 12,
  },
  excuseReasonOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: adminColors.border,
  },
  excuseReasonOptionActive: {
    // The radio icon itself already shows the selected state — this just
    // keeps the row from looking identical to an unselected one.
    opacity: 1,
  },
  excuseReasonOptionText: {
    fontSize: 14,
    fontWeight: "700",
    color: adminColors.text,
  },
  excuseNoteInput: {
    borderWidth: 1,
    borderColor: adminColors.borderStrong,
    borderRadius: adminRadius.sm,
    padding: 12,
    minHeight: 60,
    textAlignVertical: "top",
    color: adminColors.text,
    marginTop: 12,
    marginBottom: 6,
  },
  excuseButtonsRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 10,
  },
  excuseCancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: adminColors.borderStrong,
    borderRadius: adminRadius.sm,
    paddingVertical: 13,
    alignItems: "center",
  },
  excuseCancelButtonText: {
    color: adminColors.textMuted,
    fontWeight: "900",
  },
  excuseConfirmButton: {
    flex: 1,
    backgroundColor: adminColors.primary,
    borderRadius: adminRadius.sm,
    paddingVertical: 13,
    alignItems: "center",
  },
  excuseConfirmButtonDisabled: {
    opacity: 0.5,
  },
  excuseConfirmButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
});
