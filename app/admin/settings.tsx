// ---------------------------------------------------------------------------
// Admin Settings. Deliberately does NOT include a support email/phone or
// privacy/terms links — none exist anywhere in this project yet (verified
// by search), and the brief explicitly says not to add settings that have
// no real effect. Ride-category management is also omitted: categories are
// hardcoded across the booking screens today, not driven by a Firestore
// config doc, so a toggle here would not actually change anything.
// ---------------------------------------------------------------------------

import * as ImagePicker from "expo-image-picker";
import Constants from "expo-constants";
import { router } from "expo-router";
import { signOut } from "firebase/auth";
import { doc, updateDoc } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { auth, db } from "../../firebase";
import { getAdminProfile } from "./adminAuthLib";
import { adminColors, adminRadius, adminSpacing } from "./adminTheme";
import AdminScreen from "./components/AdminScreen";
import { LoadingState } from "./components/AdminStates";

export default function AdminSettingsScreen() {
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
      Alert.alert("Saved", "Your admin profile was updated.");
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    Alert.alert("Log out", "Are you sure you want to log out?", [
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

  if (loading) {
    return (
      <AdminScreen title="Settings" activeKey="settings">
        <LoadingState label="Loading settings..." />
      </AdminScreen>
    );
  }

  return (
    <AdminScreen title="Settings" activeKey="settings">
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
            <Text style={styles.changePhotoText}>Change photo</Text>
          </Pressable>

          <Text style={styles.label}>Name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} />

          <Text style={styles.label}>Email</Text>
          <TextInput style={[styles.input, styles.inputDisabled]} value={email} editable={false} />

          <Pressable
            style={[styles.saveButton, saving && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.saveText}>Save Changes</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.rowLabel}>App version</Text>
          <Text style={styles.rowValue}>
            {Constants.expoConfig?.version || "1.0.0"}
          </Text>
        </View>

        <Pressable style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>Log Out</Text>
        </Pressable>
      </ScrollView>
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
