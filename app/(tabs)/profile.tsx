import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { auth, db } from "../../firebase";
import { compressReportImage, createReport } from "../admin/adminReportsLib";
import { ReportCategory } from "../admin/adminTypes";
import { signOutAndRedirectToLogin } from "../authLib";
import {
  DirectionalCard,
  DirectionalScreen,
  PhysicalDirectionalBlockText,
} from "../i18n/DirectionalPrimitives";
import { useLanguage } from "../i18n/LanguageProvider";
import LanguageSelectorModal from "../i18n/LanguageSelectorModal";
import { SUPPORTED_LANGUAGES } from "../i18n/languages";
import { marginStart } from "../i18n/rtl";

// The Firestore `gender` field keeps storing these exact English strings
// (existing data shape — never changed here); only the label shown for each
// is translated.
const GENDER_VALUES = ["Male", "Female", "No Preference"] as const;
const GENDER_LABEL_KEY: Record<(typeof GENDER_VALUES)[number], string> = {
  Male: "common.male",
  Female: "common.female",
  "No Preference": "common.noPreference",
};

const REPORT_CATEGORIES: { key: ReportCategory; labelKey: string }[] = [
  { key: "user", labelKey: "profile.reportCategories.user" },
  { key: "driver", labelKey: "profile.reportCategories.driver" },
  { key: "ride", labelKey: "profile.reportCategories.ride" },
  { key: "booking", labelKey: "profile.reportCategories.booking" },
  { key: "payment", labelKey: "profile.reportCategories.payment" },
  { key: "other", labelKey: "profile.reportCategories.other" },
];

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { isRTL, language } = useLanguage();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState("No Preference");
  const [photo, setPhoto] = useState<string | null>(null);

  const [reportVisible, setReportVisible] = useState(false);
  const [reportCategory, setReportCategory] = useState<ReportCategory>("other");
  const [reportDescription, setReportDescription] = useState("");
  const [reportImage, setReportImage] = useState<string | null>(null);
  const [submittingReport, setSubmittingReport] = useState(false);
  const [languageModalVisible, setLanguageModalVisible] = useState(false);

  const currentLanguageName =
    SUPPORTED_LANGUAGES.find((lang) => lang.code === language)?.nativeName ??
    language;

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

    Alert.alert(t("common.success"), t("profile.profileUpdated"));
  };

  const handleLogout = async () => {
    await signOutAndRedirectToLogin();
  };

  const pickReportPhoto = () => {
    Alert.alert(t("profile.addPhotoTitle"), t("profile.addPhotoMessage"), [
      {
        text: t("common.takePhoto"),
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== "granted") {
            Alert.alert(
              t("auth.cameraPermissionNeededTitle"),
              t("profile.cameraPermissionMessage"),
            );
            return;
          }
          const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.7,
          });
          if (!result.canceled) {
            setReportImage(result.assets[0].uri);
          }
        },
      },
      {
        text: t("common.chooseFromGallery"),
        onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== "granted") {
            Alert.alert(
              t("auth.photoLibraryPermissionNeededTitle"),
              t("profile.libraryPermissionMessage"),
            );
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.7,
          });
          if (!result.canceled) {
            setReportImage(result.assets[0].uri);
          }
        },
      },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  };

  const submitReport = async () => {
    if (!reportDescription.trim() || submittingReport) return;

    try {
      setSubmittingReport(true);
      let imageUrl: string | undefined;
      if (reportImage) {
        imageUrl = await compressReportImage(reportImage);
      }
      await createReport({
        category: reportCategory,
        description: reportDescription,
        imageUrl,
      });
      setReportVisible(false);
      setReportDescription("");
      setReportCategory("other");
      setReportImage(null);
      Alert.alert(t("profile.reportSentTitle"), t("profile.reportSent"));
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("profile.couldNotSendReport"));
    } finally {
      setSubmittingReport(false);
    }
  };

  const openGenderPicker = () => {
    Alert.alert(
      t("profile.chooseDriverGender"),
      "",
      [
        ...GENDER_VALUES.map((value) => ({
          text: t(GENDER_LABEL_KEY[value]),
          onPress: () => setGender(value),
        })),
        { text: t("common.cancel"), style: "cancel" as const },
      ],
    );
  };

  const genderLabel =
    t(GENDER_LABEL_KEY[gender as (typeof GENDER_VALUES)[number]]) ||
    t("common.noPreference");

  return (
    <DirectionalScreen style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <View style={styles.avatarWrapper}>
            {photo ? (
              <Image source={{ uri: photo }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarIcon}>👤</Text>
              </View>
            )}

            <Pressable style={[styles.cameraButton, marginStart(80, isRTL)]} onPress={pickImage}>
              <Text style={styles.cameraText}>📷</Text>
            </Pressable>
          </View>

          <PhysicalDirectionalBlockText style={styles.label}>
            {t("profile.fullName")}
          </PhysicalDirectionalBlockText>
          <TextInput
            style={[styles.input, isRTL && styles.textRTL]}
            value={name}
            onChangeText={setName}
          />

          <PhysicalDirectionalBlockText style={styles.label}>
            {t("profile.email")}
          </PhysicalDirectionalBlockText>
          <TextInput
            style={styles.inputDisabled}
            value={email}
            editable={false}
            // Email must stay readable regardless of app language.
            textAlign="left"
          />

          <PhysicalDirectionalBlockText style={styles.label}>
            {t("profile.phoneNumber")}
          </PhysicalDirectionalBlockText>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            // Phone numbers must stay readable regardless of app language.
            textAlign="left"
          />

          <PhysicalDirectionalBlockText style={styles.label}>
            {t("profile.preferredDriverGender")}
          </PhysicalDirectionalBlockText>
          <Pressable style={styles.selectBox} onPress={openGenderPicker}>
            <Text>{genderLabel}</Text>
            <Text>⌄</Text>
          </Pressable>

          <Pressable style={styles.saveButton} onPress={saveChanges}>
            <Text style={styles.saveText}>{t("profile.saveChanges")}</Text>
          </Pressable>

          <Pressable
            style={styles.settingsRow}
            onPress={() => setLanguageModalVisible(true)}
          >
            <View style={styles.settingsRowLeft}>
              <Ionicons name="globe-outline" size={20} color="#7C5F46" />
              <Text style={styles.settingsRowLabel}>{t("settings.language")}</Text>
            </View>
            <View style={styles.settingsRowRight}>
              <Text style={styles.settingsRowValue}>{currentLanguageName}</Text>
              <Ionicons
                name={isRTL ? "chevron-back" : "chevron-forward"}
                size={18}
                color="#C7B9AC"
              />
            </View>
          </Pressable>

          <Pressable
            style={styles.settingsRow}
            onPress={() => router.push("/saved-locations" as any)}
          >
            <View style={styles.settingsRowLeft}>
              <Ionicons name="location-outline" size={20} color="#7C5F46" />
              <Text style={styles.settingsRowLabel}>{t("savedLocations.screenTitle")}</Text>
            </View>
            <Ionicons
              name={isRTL ? "chevron-back" : "chevron-forward"}
              size={18}
              color="#C7B9AC"
            />
          </Pressable>

          <Pressable style={styles.reportButton} onPress={() => setReportVisible(true)}>
            <Text style={styles.reportText}>{t("profile.reportProblem")}</Text>
          </Pressable>

          <Pressable style={styles.logoutButton} onPress={handleLogout}>
            <Text style={styles.logoutText}>{t("profile.logOut")}</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal
        visible={reportVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setReportVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalBackdropFill}>
              <DirectionalCard style={styles.modalCard}>
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  <Text style={[styles.modalTitle, isRTL && styles.textRTL]}>
                    {t("profile.reportProblem")}
                  </Text>

                  <Text style={[styles.label, isRTL && styles.textRTL]}>
                    {t("profile.reportSubject")}
                  </Text>
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
                          {t(option.labelKey)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={[styles.label, isRTL && styles.textRTL]}>
                    {t("profile.reportDescription")}
                  </Text>
                  <TextInput
                    style={[styles.input, styles.reportInput, isRTL && styles.textRTL]}
                    value={reportDescription}
                    onChangeText={setReportDescription}
                    placeholder={t("profile.reportDescriptionPlaceholder")}
                    placeholderTextColor="#8B7B6B"
                    multiline
                    returnKeyType="done"
                    submitBehavior="blurAndSubmit"
                    onSubmitEditing={Keyboard.dismiss}
                  />

                  <Text style={[styles.label, isRTL && styles.textRTL]}>
                    {t("profile.reportPhotoLabel")}
                  </Text>
                  {reportImage ? (
                    <View style={styles.reportPhotoPreviewWrapper}>
                      <Image source={{ uri: reportImage }} style={styles.reportPhotoPreview} />
                      <Pressable
                        style={styles.reportPhotoRemoveButton}
                        onPress={() => setReportImage(null)}
                      >
                        <Ionicons name="close" size={16} color="#FFFFFF" />
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable style={styles.addPhotoButton} onPress={pickReportPhoto}>
                      <Ionicons name="add-circle-outline" size={22} color="#F58220" />
                      <Text style={styles.addPhotoText}>{t("profile.addPhoto")}</Text>
                    </Pressable>
                  )}

                  <View style={styles.modalButtonsRow}>
                    <Pressable
                      style={styles.modalCancelButton}
                      onPress={() => setReportVisible(false)}
                      disabled={submittingReport}
                    >
                      <Text style={styles.modalCancelText}>{t("common.cancel")}</Text>
                    </Pressable>

                    <Pressable
                      style={[
                        styles.modalSubmitButton,
                        (!reportDescription.trim() || submittingReport) &&
                          styles.modalSubmitDisabled,
                      ]}
                      onPress={submitReport}
                      disabled={!reportDescription.trim() || submittingReport}
                    >
                      {submittingReport ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Text style={styles.modalSubmitText}>{t("common.submit")}</Text>
                      )}
                    </Pressable>
                  </View>
                </ScrollView>
              </DirectionalCard>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      <LanguageSelectorModal
        visible={languageModalVisible}
        onClose={() => setLanguageModalVisible(false)}
      />
    </DirectionalScreen>
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
  textRTL: {
    textAlign: "right",
    writingDirection: "rtl",
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
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 14,
    backgroundColor: "#FFFDFC",
  },
  settingsRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  settingsRowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  settingsRowLabel: {
    fontWeight: "800",
    color: "#111827",
    fontSize: 15,
  },
  settingsRowValue: {
    color: "#7C5F46",
    fontWeight: "700",
    fontSize: 14,
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
  modalBackdropFill: {
    flex: 1,
    justifyContent: "center",
  },
  modalCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 20,
    maxHeight: "85%",
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
  addPhotoButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#E2D8CF",
    borderRadius: 12,
    paddingVertical: 14,
    backgroundColor: "#FFFDFC",
  },
  addPhotoText: {
    color: "#7C5F46",
    fontWeight: "800",
    fontSize: 14,
  },
  reportPhotoPreviewWrapper: {
    alignSelf: "flex-start",
  },
  reportPhotoPreview: {
    width: 84,
    height: 84,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2D8CF",
  },
  reportPhotoRemoveButton: {
    position: "absolute",
    top: -8,
    right: -8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#DC2626",
    justifyContent: "center",
    alignItems: "center",
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
