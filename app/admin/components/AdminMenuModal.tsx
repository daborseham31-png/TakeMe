// ---------------------------------------------------------------------------
// The admin's main navigation menu. No drawer package is installed in this
// project and adding one just for 8 links would be overkill, so this is a
// lightweight slide-up modal opened from the hamburger button in
// AdminScreen's header — works identically on iOS/Android without a new
// native dependency.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Alert, Modal, Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { signOutAndRedirectToLogin } from "../../authLib";
import {
  DirectionalCard,
  DirectionalRow,
  DirectionalText,
} from "../../i18n/DirectionalPrimitives";
import { useLanguage } from "../../i18n/LanguageProvider";
import { chevronForwardIconName } from "../../i18n/rtl";
import { adminColors, adminRadius, adminSpacing } from "../adminTheme";

type MenuItem = {
  key: string;
  labelKey: string;
  icon: keyof typeof Ionicons.glyphMap;
  path: string;
};

const MENU_ITEMS: MenuItem[] = [
  { key: "dashboard", labelKey: "admin.dashboard", icon: "grid-outline", path: "/admin" },
  {
    key: "reports",
    labelKey: "admin.reportsAndSupport",
    icon: "flag-outline",
    path: "/admin/reports",
  },
  {
    key: "notifications",
    labelKey: "admin.notifications",
    icon: "notifications-outline",
    path: "/admin/notifications",
  },
  {
    key: "schoolKioskLinks",
    labelKey: "admin.schoolKioskLinks",
    icon: "school-outline",
    path: "/admin/school-kiosk-links",
  },
  { key: "settings", labelKey: "admin.settings", icon: "settings-outline", path: "/admin/settings" },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  activeKey?: string;
};

export default function AdminMenuModal({ visible, onClose, activeKey }: Props) {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();

  const handleNavigate = (path: string) => {
    onClose();
    router.push(path as any);
  };

  const handleLogout = () => {
    onClose();

    Alert.alert(t("admin.logOutConfirmTitle"), t("admin.logOutConfirmMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("admin.logOutConfirmTitle"),
        style: "destructive",
        onPress: async () => {
          await signOutAndRedirectToLogin();
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <DirectionalCard style={styles.sheet}>
          <View style={styles.handle} />
          <DirectionalText style={styles.title}>{t("admin.menuTitle")}</DirectionalText>

          {MENU_ITEMS.map((item) => (
            <Pressable key={item.key} onPress={() => handleNavigate(item.path)}>
              <DirectionalRow style={[styles.row, activeKey === item.key && styles.rowActive]}>
                <Ionicons
                  name={item.icon}
                  size={20}
                  color={activeKey === item.key ? adminColors.primary : adminColors.textMuted}
                />
                <DirectionalText
                  style={[styles.rowText, activeKey === item.key && styles.rowTextActive]}
                >
                  {t(item.labelKey)}
                </DirectionalText>
                <Ionicons name={chevronForwardIconName(isRTL)} size={16} color={adminColors.placeholder} />
              </DirectionalRow>
            </Pressable>
          ))}

          <Pressable onPress={handleLogout}>
            <DirectionalRow style={styles.logoutRow}>
              <Ionicons name="log-out-outline" size={20} color={adminColors.danger} />
              <DirectionalText style={styles.logoutText}>{t("admin.logOut")}</DirectionalText>
            </DirectionalRow>
          </Pressable>
        </DirectionalCard>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: adminColors.card,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: adminSpacing.lg,
    paddingTop: 14,
    paddingBottom: 34,
    maxHeight: "85%",
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: adminColors.border,
    alignSelf: "center",
    marginBottom: 14,
  },
  title: {
    fontSize: 20,
    fontWeight: "900",
    color: adminColors.text,
    marginBottom: 14,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: adminColors.divider,
  },
  rowActive: {
    backgroundColor: adminColors.warningBg,
    borderRadius: adminRadius.sm,
    paddingHorizontal: 8,
  },
  rowText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
    color: adminColors.text,
  },
  rowTextActive: {
    color: adminColors.primary,
  },
  logoutRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 16,
    marginTop: 6,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: "900",
    color: adminColors.danger,
  },
});
