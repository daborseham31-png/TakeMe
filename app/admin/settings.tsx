// ---------------------------------------------------------------------------
// Admin Settings. Deliberately does NOT include a support email/phone or
// privacy/terms links — none exist anywhere in this project yet (verified
// by search), and the brief explicitly says not to add settings that have
// no real effect. Ride-category management is also omitted: categories are
// hardcoded across the booking screens today, not driven by a Firestore
// config doc, so a toggle here would not actually change anything.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import Constants from "expo-constants";
import { doc, updateDoc } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { auth, db } from "../../firebase";
import { signOutAndRedirectToLogin } from "../authLib";
import { useLanguage } from "../i18n/LanguageProvider";
import LanguageSelectorModal from "../i18n/LanguageSelectorModal";
import { SUPPORTED_LANGUAGES } from "../i18n/languages";
import { chevronForwardIconName } from "../i18n/rtl";
import { getAdminProfile } from "./adminAuthLib";
import { adminColors, adminRadius, adminSpacing } from "./adminTheme";
import AdminScreen from "./components/AdminScreen";
import { LoadingState } from "./components/AdminStates";

export default function AdminSettingsScreen() {
  const { t } = useTranslation();
  const { language, isRTL } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [languageModalVisible, setLanguageModalVisible] = useState(false);

  const currentLanguageName =
    SUPPORTED_LANGUAGES.find((lang) => lang.code === language)?.nativeName ??
    language;

  useEffect(() => {
    (async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        setLoading(false);
        return;
      }

      const profile = await getAdminProfile(uid);
      if (profile) {
        setName(profile.name);
        setEmail(profile.email);
        setPhoto(profile.photo);
      }
      setLoading(false);
    })();
  }, []);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (!result.canceled) {
      setPhoto(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || saving) return;

    try {
      setSaving(true);
      await updateDoc(doc(db, "users", uid), { name, photo });
      Alert.alert(t("common.success"), t("profile.profileUpdated"));
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("errors.couldNotSave"));
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(t("common.logOut"), t("common.areYouSure"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.logOut"),
        style: "destructive",
        onPress: async () => {
          await signOutAndRedirectToLogin();
        },
      },
    ]);
  };

  if (loading) {
    return (
      <AdminScreen title={t("admin.settings")} activeKey="settings">
        <LoadingState label={t("common.loading")} />
      </AdminScreen>
    );
  }

  return (
    <AdminScreen title={t("admin.settings")} activeKey="settings">
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Pressable style={styles.avatarWrapper} onPress={pickImage}>
            {photo ? (
              <Image source={{ uri: photo }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarIcon}>👤</Text>
              </View>
            )}
            <Text style={styles.changePhotoText}>{t("admin.changePhoto")}</Text>
          </Pressable>

          <Text style={styles.label}>{t("admin.name")}</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} />

          <Text style={styles.label}>{t("profile.email")}</Text>
          <TextInput
            style={[styles.input, styles.inputDisabled]}
            value={email}
            editable={false}
            textAlign="left"
          />

          <Pressable
            style={[styles.saveButton, saving && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.saveText}>{t("profile.saveChanges")}</Text>
            )}
          </Pressable>
        </View>

        <Pressable
          style={styles.card}
          onPress={() => setLanguageModalVisible(true)}
        >
          <View style={styles.languageRow}>
            <View style={styles.languageRowLeft}>
              <Ionicons name="globe-outline" size={20} color={adminColors.textMuted} />
              <Text style={styles.rowLabel}>{t("settings.language")}</Text>
            </View>
            <View style={styles.languageRowRight}>
              <Text style={styles.rowValue}>{currentLanguageName}</Text>
              <Ionicons name={chevronForwardIconName(isRTL)} size={18} color={adminColors.placeholder} />
            </View>
          </View>
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.rowLabel}>{t("admin.appVersion")}</Text>
          <Text style={styles.rowValue}>
            {Constants.expoConfig?.version || "1.0.0"}
          </Text>
        </View>

        <Pressable style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>{t("common.logOut")}</Text>
        </Pressable>
      </ScrollView>

      <LanguageSelectorModal
        visible={languageModalVisible}
        onClose={() => setLanguageModalVisible(false)}
      />
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: adminSpacing.lg,
    paddingBottom: 60,
  },
  card: {
    backgroundColor: adminColors.card,
    borderWidth: 1,
    borderColor: adminColors.border,
    borderRadius: adminRadius.lg,
    padding: adminSpacing.lg,
    marginBottom: adminSpacing.md,
  },
  avatarWrapper: {
    alignItems: "center",
    marginBottom: 20,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    marginBottom: 8,
  },
  avatarPlaceholder: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: adminColors.warningBg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  avatarIcon: {
    fontSize: 34,
  },
  changePhotoText: {
    color: adminColors.primary,
    fontWeight: "800",
    fontSize: 13,
  },
  label: {
    fontWeight: "800",
    color: adminColors.text,
    marginBottom: 8,
    marginTop: 10,
  },
  languageRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  languageRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  languageRowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: adminColors.borderStrong,
    borderRadius: adminRadius.sm,
    padding: 14,
    backgroundColor: "#FFFDFC",
    color: adminColors.text,
  },
  inputDisabled: {
    backgroundColor: "#F7F3EF",
    color: adminColors.placeholder,
  },
  saveButton: {
    backgroundColor: adminColors.primary,
    borderRadius: adminRadius.sm,
    padding: 15,
    alignItems: "center",
    marginTop: 20,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
  },
  rowLabel: {
    color: adminColors.textMuted,
    fontWeight: "700",
    fontSize: 12.5,
  },
  rowValue: {
    color: adminColors.text,
    fontWeight: "900",
    fontSize: 16,
    marginTop: 4,
  },
  logoutButton: {
    borderWidth: 1.5,
    borderColor: adminColors.danger,
    borderRadius: adminRadius.sm,
    padding: 16,
  },
  logoutText: {
    color: adminColors.danger,
    textAlign: "center",
    fontWeight: "900",
    fontSize: 16,
  },
});
