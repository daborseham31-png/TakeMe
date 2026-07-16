import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { doc, onSnapshot } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { db } from "../../../firebase";
import {
  deleteUserAccount,
  normalizeAdminUser,
  setUserAccountStatus,
  setUserRole,
} from "../adminUsersLib";
import { AdminUserRow } from "../adminTypes";
import AdminScreen from "../components/AdminScreen";
import { LoadingState } from "../components/AdminStates";
import ConfirmModal from "../components/ConfirmModal";
import { adminColors, adminRadius, adminSpacing } from "../adminTheme";
import {
  translateAccountStatus,
  translateDriverVerificationStatus,
  translateUserRole,
} from "../../i18n/formatters";

type PendingAction =
  | { type: "block" | "suspend" | "delete" }
  | { type: "unblock" | "reactivate" | "role"; role?: "passenger" | "driver" }
  | null;

export default function AdminUserDetailScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams();
  const userId = String(params.id || "");

  const [user, setUser] = useState<AdminUserRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      setNotFound(true);
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, "users", userId),
      (snap) => {
        if (!snap.exists()) {
          setNotFound(true);
          setUser(null);
        } else {
          setUser(normalizeAdminUser(snap.id, snap.data()));
        }
        setLoading(false);
      },
      () => {
        setNotFound(true);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [userId]);

  const runAction = async (reason: string) => {
    if (!pendingAction || busy) return;

    try {
      setBusy(true);

      if (pendingAction.type === "block") {
        await setUserAccountStatus(userId, "blocked", reason);
      } else if (pendingAction.type === "suspend") {
        await setUserAccountStatus(userId, "suspended", reason);
      } else if (pendingAction.type === "unblock" || pendingAction.type === "reactivate") {
        await setUserAccountStatus(userId, "active", "");
      } else if (pendingAction.type === "role" && pendingAction.role) {
        await setUserRole(userId, pendingAction.role);
      } else if (pendingAction.type === "delete") {
        await deleteUserAccount(userId, reason);
        setPendingAction(null);
        Alert.alert(t("admin.userDeletedTitle"), t("admin.userDeletedMessage"));
        router.back();
        return;
      }

      setPendingAction(null);
      Alert.alert(t("admin.successTitle"), t("admin.userUpdatedMessage"));
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("admin.couldNotUpdateUser"));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <AdminScreen title={t("admin.userDetailsTitle")}>
        <LoadingState label={t("admin.loadingUser")} />
      </AdminScreen>
    );
  }

  if (notFound || !user) {
    return (
      <AdminScreen title={t("admin.userDetailsTitle")}>
        <View style={styles.center}>
          <Text style={styles.notFoundText}>{t("admin.userNotFound")}</Text>
        </View>
      </AdminScreen>
    );
  }

  return (
    <AdminScreen title={t("admin.userDetailsTitle")}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerCard}>
          {user.photo ? (
            <Image source={{ uri: user.photo }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Ionicons name="person" size={28} color={adminColors.primary} />
            </View>
          )}
          <Text style={styles.name}>{user.name}</Text>
          <View style={styles.pillRow}>
            <View style={styles.pill}>
              <Text style={styles.pillText}>{translateUserRole(user.role, t)}</Text>
            </View>
            <View
              style={[
                styles.pill,
                user.accountStatus === "active"
                  ? styles.pillActive
                  : user.accountStatus === "blocked"
                    ? styles.pillDanger
                    : styles.pillWarning,
              ]}
            >
              <Text style={styles.pillText}>{translateAccountStatus(user.accountStatus, t)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Row icon="mail-outline" label={t("admin.emailLabel")} value={user.email || "—"} />
          <Row icon="call-outline" label={t("admin.phoneLabel")} value={user.phone || "—"} />
          <Row icon="male-female-outline" label={t("admin.genderLabel")} value={user.gender || "—"} />
          <Row
            icon="calendar-outline"
            label={t("admin.registeredLabel")}
            value={
              user.createdAtSeconds
                ? new Date(user.createdAtSeconds * 1000).toLocaleDateString()
                : "—"
            }
          />
          {user.statusReason ? (
            <Row icon="alert-circle-outline" label={t("admin.statusReasonLabel")} value={user.statusReason} />
          ) : null}
        </View>

        {user.isDriver ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("admin.driverInfoTitle")}</Text>
            <Row
              icon="shield-checkmark-outline"
              label={t("admin.verificationLabel")}
              value={translateDriverVerificationStatus(user.driverVerificationStatus, t)}
            />
            <Row icon="star-outline" label={t("admin.ratingLabel")} value={`${user.ratingAverage.toFixed(1)} (${user.ratingCount})`} />
            <Row icon="barcode-outline" label={t("admin.plateLabel")} value={user.carPlate || "—"} />
            <Row icon="document-text-outline" label={t("admin.licenseExpiryLabel")} value={user.licenseExpiryDate || "—"} />
            <Row
              icon="language-outline"
              label={t("admin.languagesLabel")}
              value={user.spokenLanguages.join(", ") || "—"}
            />
          </View>
        ) : null}

        <View style={styles.actions}>
          {user.accountStatus === "active" ? (
            <>
              <ActionButton
                icon="lock-closed-outline"
                label={t("admin.blockUser")}
                tone="danger"
                onPress={() => setPendingAction({ type: "block" })}
              />
              <ActionButton
                icon="pause-circle-outline"
                label={t("admin.suspendUser")}
                tone="warning"
                onPress={() => setPendingAction({ type: "suspend" })}
              />
            </>
          ) : (
            <ActionButton
              icon="checkmark-circle-outline"
              label={user.accountStatus === "blocked" ? t("admin.unblockUser") : t("admin.reactivateUser")}
              tone="success"
              onPress={() =>
                setPendingAction({
                  type: user.accountStatus === "blocked" ? "unblock" : "reactivate",
                })
              }
            />
          )}

          {user.role === "passenger" || user.role === "driver" ? (
            <ActionButton
              icon="swap-horizontal-outline"
              label={user.role === "passenger" ? t("admin.changeRoleToDriver") : t("admin.changeRoleToPassenger")}
              tone="neutral"
              onPress={() =>
                setPendingAction({
                  type: "role",
                  role: user.role === "passenger" ? "driver" : "passenger",
                })
              }
            />
          ) : null}

          <ActionButton
            icon="trash-outline"
            label={t("admin.deleteUser")}
            tone="danger"
            onPress={() => setPendingAction({ type: "delete" })}
          />
        </View>
      </ScrollView>

      <ConfirmModal
        visible={!!pendingAction}
        title={
          pendingAction?.type === "delete"
            ? t("admin.deleteThisUserQ")
            : pendingAction?.type === "block"
              ? t("admin.blockThisUserQ")
              : pendingAction?.type === "suspend"
                ? t("admin.suspendThisUserQ")
                : pendingAction?.type === "role"
                  ? t("admin.changeRoleQ")
                  : t("admin.confirmActionTitle")
        }
        message={
          pendingAction?.type === "delete"
            ? t("admin.deletePermanentMessage")
            : pendingAction?.type === "role"
              ? t("admin.userWillBecome", {
                  role: pendingAction.role === "driver" ? t("common.driver") : t("common.passenger"),
                })
              : t("admin.willChangeAccess")
        }
        confirmLabel={pendingAction?.type === "delete" ? t("common.delete") : t("admin.confirmButton")}
        destructive={pendingAction?.type === "delete" || pendingAction?.type === "block"}
        requireReason={
          pendingAction?.type === "block" ||
          pendingAction?.type === "suspend" ||
          pendingAction?.type === "delete"
        }
        busy={busy}
        onCancel={() => setPendingAction(null)}
        onConfirm={runAction}
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
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tone: "danger" | "warning" | "success" | "neutral";
  onPress: () => void;
}) => (
  <Pressable
    style={[
      styles.actionButton,
      tone === "danger" && styles.actionDanger,
      tone === "warning" && styles.actionWarning,
      tone === "success" && styles.actionSuccess,
    ]}
    onPress={onPress}
  >
    <Ionicons
      name={icon}
      size={18}
      color={
        tone === "danger"
          ? adminColors.danger
          : tone === "warning"
            ? adminColors.warning
            : tone === "success"
              ? adminColors.success
              : adminColors.textMuted
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
    paddingBottom: 40,
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
  pillRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  pill: {
    backgroundColor: adminColors.warningBg,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: adminRadius.pill,
  },
  pillActive: {
    backgroundColor: adminColors.successBg,
  },
  pillDanger: {
    backgroundColor: adminColors.dangerBg,
  },
  pillWarning: {
    backgroundColor: adminColors.warningBg,
  },
  pillText: {
    fontSize: 12,
    fontWeight: "800",
    color: adminColors.text,
    textTransform: "capitalize",
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
    marginBottom: 2,
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
    width: 100,
  },
  rowValue: {
    flex: 1,
    color: adminColors.text,
    fontWeight: "700",
    fontSize: 13,
  },
  actions: {
    gap: 10,
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
  actionText: {
    fontSize: 14,
    fontWeight: "800",
    color: adminColors.text,
  },
});
