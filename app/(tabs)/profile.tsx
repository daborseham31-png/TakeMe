import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { signOut } from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { auth, db } from "../../firebase";
import { createReport } from "../admin/adminReportsLib";
import { ReportCategory } from "../admin/adminTypes";

const REPORT_CATEGORIES: { key: ReportCategory; label: string }[] = [
  { key: "user", label: "A user" },
  { key: "driver", label: "A driver" },
  { key: "ride", label: "A ride" },
  { key: "booking", label: "A booking" },
  { key: "payment", label: "Payment" },
  { key: "other", label: "Other" },
];

export default function ProfileScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState("No Preference");
  const [photo, setPhoto] = useState<string | null>(null);

  const [reportVisible, setReportVisible] = useState(false);
  const [reportCategory, setReportCategory] = useState<ReportCategory>("other");
  const [reportDescription, setReportDescription] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    const user = auth.currentUser;

    if (!user) {
      router.replace("/");
      return;
    }

    const snap = await getDoc(doc(db, "users", user.uid));

    if (snap.exists()) {
      const data = snap.data();
      setName(data.name || "");
      setEmail(data.email || user.email || "");
      setPhone(data.phone || "");
      setGender(data.gender || "No Preference");
      setPhoto(data.photo || null);
    } else {
      setEmail(user.email || "");
    }
  };

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

  const saveChanges = async () => {
    const user = auth.currentUser;

    if (!user) return;

    await updateDoc(doc(db, "users", user.uid), {
      name,
      phone,
      gender,
      photo,
    });

    Alert.alert("Saved", "Profile updated successfully.");
  };

  const handleLogout = async () => {
    await signOut(auth);
    router.replace("/");
  };

  const submitReport = async () => {
    if (!reportDescription.trim() || submittingReport) return;

    try {
      setSubmittingReport(true);
      await createReport({ category: reportCategory, description: reportDescription });
      setReportVisible(false);
      setReportDescription("");
      setReportCategory("other");
      Alert.alert("Report sent", "Thank you — our team will review it shortly.");
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Could not send your report.");
    } finally {
      setSubmittingReport(false);
    }
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <View style={styles.avatarWrapper}>
            {photo ? (
              <Image source={{ uri: photo }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarIcon}>👤</Text>
              </View>
            )}

            <Pressable style={styles.cameraButton} onPress={pickImage}>
              <Text style={styles.cameraText}>📷</Text>
            </Pressable>
          </View>

          <Text style={styles.label}>Full Name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} />

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.inputDisabled}
            value={email}
            editable={false}
          />

          <Text style={styles.label}>Phone Number</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />

          <Text style={styles.label}>Preferred Driver Gender</Text>
          <Pressable
            style={styles.selectBox}
            onPress={() =>
              Alert.alert("Choose driver gender", "", [
                { text: "Male", onPress: () => setGender("Male") },
                { text: "Female", onPress: () => setGender("Female") },
                {
                  text: "No Preference",
                  onPress: () => setGender("No Preference"),
                },
                { text: "Cancel", style: "cancel" },
              ])
            }
          >
            <Text>{gender}</Text>
            <Text>⌄</Text>
          </Pressable>

          <Pressable style={styles.saveButton} onPress={saveChanges}>
            <Text style={styles.saveText}>Save Changes</Text>
          </Pressable>

          <Pressable style={styles.reportButton} onPress={() => setReportVisible(true)}>
            <Text style={styles.reportText}>Report a Problem</Text>
          </Pressable>

          <Pressable style={styles.logoutButton} onPress={handleLogout}>
            <Text style={styles.logoutText}>Log Out</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal
        visible={reportVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setReportVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Report a Problem</Text>

            <Text style={styles.label}>What is this about?</Text>
            <View style={styles.categoryRow}>
              {REPORT_CATEGORIES.map((option) => (
                <Pressable
                  key={option.key}
                  style={[
                    styles.categoryChip,
                    reportCategory === option.key && styles.categoryChipActive,
                  ]}
                  onPress={() => setReportCategory(option.key)}
                >
                  <Text
                    style={[
                      styles.categoryChipText,
                      reportCategory === option.key && styles.categoryChipTextActive,
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.reportInput]}
              value={reportDescription}
              onChangeText={setReportDescription}
              placeholder="Describe what happened"
              placeholderTextColor="#8B7B6B"
              multiline
            />

            <View style={styles.modalButtonsRow}>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => setReportVisible(false)}
                disabled={submittingReport}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>

              <Pressable
                style={[
                  styles.modalSubmitButton,
                  (!reportDescription.trim() || submittingReport) && styles.modalSubmitDisabled,
                ]}
                onPress={submitReport}
                disabled={!reportDescription.trim() || submittingReport}
              >
                {submittingReport ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalSubmitText}>Submit</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  scroll: {
    padding: 20,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: "#E7DCD1",
  },
  avatarWrapper: {
    alignItems: "center",
    marginBottom: 24,
  },
  avatar: {
    width: 110,
    height: 110,
    borderRadius: 55,
  },
  avatarPlaceholder: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "#EFEAE4",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarIcon: {
    fontSize: 44,
  },
  cameraButton: {
    marginTop: -28,
    marginLeft: 80,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F58220",
    justifyContent: "center",
    alignItems: "center",
  },
  cameraText: {
    color: "white",
  },
  label: {
    fontWeight: "800",
    marginTop: 14,
    marginBottom: 10,
    color: "#111827",
  },
  input: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    padding: 14,
    backgroundColor: "#FFFDFC",
  },
  inputDisabled: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    padding: 14,
    backgroundColor: "#F7F3EF",
    color: "#8B7B6B",
  },
  selectBox: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    padding: 14,
    backgroundColor: "#FFFDFC",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  saveButton: {
    backgroundColor: "#F58220",
    borderRadius: 12,
    padding: 16,
    marginTop: 26,
  },
  saveText: {
    color: "white",
    textAlign: "center",
    fontWeight: "900",
    fontSize: 16,
  },
  logoutButton: {
    borderWidth: 1.5,
    borderColor: "#DC2626",
    borderRadius: 12,
    padding: 16,
    marginTop: 14,
  },
  logoutText: {
    color: "#DC2626",
    textAlign: "center",
    fontWeight: "900",
    fontSize: 16,
  },
  reportButton: {
    borderWidth: 1.5,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    padding: 16,
    marginTop: 14,
    backgroundColor: "#FFFDFC",
  },
  reportText: {
    color: "#7C5F46",
    textAlign: "center",
    fontWeight: "900",
    fontSize: 16,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 6,
  },
  categoryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  categoryChip: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    backgroundColor: "#FFFDFC",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  categoryChipActive: {
    backgroundColor: "#F58220",
    borderColor: "#F58220",
  },
  categoryChipText: {
    color: "#7C5F46",
    fontWeight: "800",
    fontSize: 12.5,
  },
  categoryChipTextActive: {
    color: "#FFFFFF",
  },
  reportInput: {
    minHeight: 90,
    textAlignVertical: "top",
  },
  modalButtonsRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  modalCancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  modalCancelText: {
    color: "#7C5F46",
    fontWeight: "900",
  },
  modalSubmitButton: {
    flex: 1,
    backgroundColor: "#F58220",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  modalSubmitDisabled: {
    opacity: 0.5,
  },
  modalSubmitText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
});
