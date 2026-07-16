// ---------------------------------------------------------------------------
// The admin's main navigation menu. No drawer package is installed in this
// project and adding one just for 8 links would be overkill, so this is a
// lightweight slide-up modal opened from the hamburger button in
// AdminScreen's header — works identically on iOS/Android without a new
// native dependency.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { signOut } from "firebase/auth";
import React from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { auth } from "../../../firebase";
import { adminColors, adminRadius, adminSpacing } from "../adminTheme";

type MenuItem = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  path: string;
};

const MENU_ITEMS: MenuItem[] = [
  { key: "dashboard", label: "Dashboard", icon: "grid-outline", path: "/admin" },
  {
    key: "reports",
    label: "Reports & Support",
    icon: "flag-outline",
    path: "/admin/reports",
  },
  {
    key: "notifications",
    label: "Notifications",
    icon: "notifications-outline",
    path: "/admin/notifications",
  },
  { key: "settings", label: "Settings", icon: "settings-outline", path: "/admin/settings" },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  activeKey?: string;
};

export default function AdminMenuModal({ visible, onClose, activeKey }: Props) {
  const handleNavigate = (path: string) => {
    onClose();
    router.push(path as any);
  };

  const handleLogout = () => {
    onClose();

    Alert.alert("Log out", "Are you sure you want to log out of the admin panel?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log out",
        style: "destructive",
        onPress: async () => {
          await signOut(auth);
          router.replace("/");
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Admin Menu</Text>

          {MENU_ITEMS.map((item) => (
            <Pressable
              key={item.key}
              style={[styles.row, activeKey === item.key && styles.rowActive]}
              onPress={() => handleNavigate(item.path)}
            >
              <Ionicons
                name={item.icon}
                size={20}
                color={activeKey === item.key ? adminColors.primary : adminColors.textMuted}
              />
              <Text
                style={[styles.rowText, activeKey === item.key && styles.rowTextActive]}
              >
                {item.label}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={adminColors.placeholder} />
            </Pressable>
          ))}

          <Pressable style={styles.logoutRow} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={20} color={adminColors.danger} />
            <Text style={styles.logoutText}>Log Out</Text>
          </Pressable>
        </View>
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
