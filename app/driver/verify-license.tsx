import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useTranslation } from "react-i18next";

import { auth, db } from "../../firebase";
import KeyboardAvoidingWrapper from "../components/KeyboardAvoidingWrapper";
import { DirectionalScreen } from "../i18n/DirectionalPrimitives";
import { useLanguage } from "../i18n/LanguageProvider";
import { ltrContentStyle } from "../i18n/rtl";
import {
  analyzeLicenseImage,
  compressImageToBase64,
  getLicenseValidity,
  LicenseAnalysisResult,
  pickDocumentImage,
  SPOKEN_LANGUAGE_OPTIONS,
} from "../login/idVerificationLib";

// Native-script display only — the value saved to Firestore (spokenLanguages)
// always stays one of SPOKEN_LANGUAGE_OPTIONS' English words.
const SPOKEN_LANGUAGE_DISPLAY: Record<string, string> = {
  Arabic: "العربية",
  Hebrew: "עברית",
  English: "English",
  Russian: "Русский",
};

export default function VerifyLicenseScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [licenseImageUri, setLicenseImageUri] = useState<string | null>(null);
  const [licenseAnalyzing, setLicenseAnalyzing] = useState(false);
  const [licenseResult, setLicenseResult] = useState<LicenseAnalysisResult | null>(
    null,
  );
  const [licenseError, setLicenseError] = useState<string | null>(null);

  const [spokenLanguages, setSpokenLanguages] = useState<string[]>([]);

  const licenseValidity = getLicenseValidity(licenseResult?.expiryDate ?? null);

  // Require a logged-in user, and pre-fill any languages already saved on
  // the account (e.g. a driver whose license just expired and is
  // re-verifying — no reason to make them re-pick languages).
  useEffect(() => {
    const user = auth.currentUser;

    if (!user) {
      Alert.alert(t("validation.loginRequiredTitle"), t("auth.pleaseLoginFirst"));
      router.replace("/");
      return;
    }

    (async () => {
      try {
        const snap = await getDoc(doc(db, "users", user.uid));

        if (snap.exists()) {
          const data = snap.data();

          if (Array.isArray(data.spokenLanguages)) {
            setSpokenLanguages(data.spokenLanguages);
          }
        }
      } finally {
        setCheckingAuth(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePickLicense = async () => {
    const uri = await pickDocumentImage();
    if (!uri) return;

    setLicenseImageUri(uri);
    setLicenseResult(null);
    setLicenseError(null);
    setLicenseAnalyzing(true);

    try {
      const base64 = await compressImageToBase64(uri);
      const result = await analyzeLicenseImage(base64);
      setLicenseResult(result);

      if (!result.expiryDate) {
        setLicenseError(t("validation.couldNotReadLicenseExpiry"));
      }
    } catch (error: any) {
      setLicenseError(
        error?.message || t("validation.couldNotReadLicenseTryAgain"),
      );
    } finally {
      setLicenseAnalyzing(false);
    }
  };

  const toggleLanguage = (lang: string) => {
    setSpokenLanguages((prev) =>
      prev.includes(lang) ? prev.filter((item) => item !== lang) : [...prev, lang],
    );
  };

  const handleVerify = async () => {
    const user = auth.currentUser;

    if (!user) {
      Alert.alert(t("validation.loginRequiredTitle"), t("auth.pleaseLoginFirst"));
      router.replace("/");
      return;
    }

    if (!licenseImageUri || !licenseResult) {
      Alert.alert(
        t("validation.licenseRequiredTitle"),
        t("validation.uploadClearLicenseMessage"),
      );
      return;
    }

    if (licenseValidity === "unknown") {
      Alert.alert(
        t("validation.licenseRequiredTitle"),
        t("validation.uploadClearLicenseMessage"),
      );
      return;
    }

    if (licenseValidity === "expired") {
      Alert.alert(
        t("validation.licenseExpiredTitle"),
        t("validation.licenseExpiredMessage"),
      );
      return;
    }

    if (spokenLanguages.length === 0) {
      Alert.alert(
        t("validation.languagesRequiredTitle"),
        t("validation.selectAtLeastOneLanguage"),
      );
      return;
    }

    setSubmitting(true);

    // Collection path, doc id, and payload are all fixed up front so the
    // catch block below can log EXACTLY what was attempted — never just the
    // fact that it failed.
    const collectionPath = "users";
    const docId = user.uid;
    const writeData = {
      isDriver: true,
      licenseIsValid: true,
      licenseNumber: licenseResult.licenseNumber,
      licenseExpiryDate: licenseResult.expiryDate,
      licenseCategories: licenseResult.licenseCategories,
      spokenLanguages,
      driverVerificationStatus: "ai_verified",
      updatedAt: serverTimestamp(),
    };

    try {
      await setDoc(doc(db, collectionPath, docId), writeData, { merge: true });

      router.replace("/driver/add-route" as any);
    } catch (error: any) {
      // Never swallow the original Firebase error — log everything needed
      // to debug a "Missing or insufficient permissions" write: the exact
      // path/doc/uid, the data that was attempted, and the SDK's own error
      // code (e.g. "permission-denied"), not just error.message.
      console.log("verify-license write failed", {
        feature: "verify-license.handleVerify",
        collectionPath,
        docId,
        authUid: auth.currentUser?.uid,
        data: writeData,
        code: error?.code,
        message: error?.message,
      });

      Alert.alert(t("common.error"), error?.message || t("validation.couldNotSaveLicense"));
    } finally {
      setSubmitting(false);
    }
  };

  const renderQualityNote = (
    quality: LicenseAnalysisResult["imageQuality"] | undefined,
  ) => {
    if (!quality || quality === "clear") return null;

    return (
      <Text style={styles.qualityNote}>
        {t("driverCreate.imageQualityNote", { quality })}
      </Text>
    );
  };

  if (checkingAuth) {
    return (
      <DirectionalScreen style={styles.page}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#F58220" />
        </View>
      </DirectionalScreen>
    );
  }

  return (
    <DirectionalScreen style={styles.page}>
      <KeyboardAvoidingWrapper>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name={isRTL ? "arrow-forward" : "arrow-back"} size={24} color="#7C5F46" />
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.title}>{t("driverCreate.becomeDriverTitle")}</Text>
          <Text style={styles.subtitle}>
            {t("driverCreate.becomeDriverSubtitle")}
          </Text>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="car-outline" size={20} color="#F58220" />
              <Text style={styles.sectionTitle}>{t("driverCreate.scanLicenseTitle")}</Text>
            </View>

            <Text style={styles.consentText}>
              {t("driverCreate.licenseConsentText")}
            </Text>

            {licenseImageUri ? (
              <Image source={{ uri: licenseImageUri }} style={styles.preview} />
            ) : null}

            <Pressable
              style={styles.scanButton}
              onPress={handlePickLicense}
              disabled={licenseAnalyzing}
            >
              <Ionicons name="camera-outline" size={18} color="#FFFFFF" />
              <Text style={styles.scanButtonText}>
                {licenseImageUri ? t("driverCreate.retakeUploadAgain") : t("driverCreate.scanYourLicense")}
              </Text>
            </Pressable>

            {licenseAnalyzing ? (
              <View style={styles.analyzingRow}>
                <ActivityIndicator color="#F58220" />
                <Text style={styles.analyzingText}>{t("driverCreate.readingLicense")}</Text>
              </View>
            ) : null}

            {!licenseAnalyzing && licenseError ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={18} color="#B91C1C" />
                <Text style={styles.errorText}>{licenseError}</Text>
              </View>
            ) : null}

            {!licenseAnalyzing && licenseResult ? (
              <>
                {licenseValidity === "valid" ? (
                  <View style={styles.validBox}>
                    <Ionicons name="checkmark-circle" size={18} color="#166534" />
                    <Text style={styles.validText}>{t("driverCreate.licenseIsValid")}</Text>
                  </View>
                ) : licenseValidity === "expired" ? (
                  <View style={styles.expiredBox}>
                    <Ionicons name="close-circle" size={18} color="#B91C1C" />
                    <Text style={styles.expiredText}>{t("driverCreate.licenseIsExpired")}</Text>
                  </View>
                ) : (
                  <View style={styles.unknownBox}>
                    <Ionicons name="warning-outline" size={18} color="#B86115" />
                    <Text style={styles.unknownText}>
                      {t("driverCreate.couldNotReadExpiryShort")}
                    </Text>
                  </View>
                )}

                <View style={styles.readOnlyBox}>
                  <Text style={styles.readOnlyLabel}>{t("driverCreate.licenseNumberLabel")}</Text>
                  <TextInput
                    style={[styles.readOnlyInput, ltrContentStyle]}
                    value={licenseResult.licenseNumber || ""}
                    editable={false}
                  />

                  <Text style={styles.readOnlyLabel}>{t("driverCreate.expiryDateLabel")}</Text>
                  <TextInput
                    style={[styles.readOnlyInput, ltrContentStyle]}
                    value={licenseResult.expiryDate || ""}
                    editable={false}
                  />

                  <Text style={styles.readOnlyLabel}>{t("driverCreate.categoriesLabel")}</Text>
                  <TextInput
                    style={styles.readOnlyInput}
                    value={licenseResult.licenseCategories.join(", ")}
                    editable={false}
                  />

                  {renderQualityNote(licenseResult.imageQuality)}
                </View>
              </>
            ) : null}
          </View>

          <Text style={styles.label}>{t("driverCreate.languagesYouSpeak")}</Text>
          <View style={styles.languageRow}>
            {SPOKEN_LANGUAGE_OPTIONS.map((lang) => {
              const active = spokenLanguages.includes(lang);

              return (
                <Pressable
                  key={lang}
                  style={[
                    styles.languageButton,
                    active && styles.languageButtonActive,
                  ]}
                  onPress={() => toggleLanguage(lang)}
                >
                  <Text
                    style={[
                      styles.languageText,
                      active && styles.languageTextActive,
                    ]}
                  >
                    {SPOKEN_LANGUAGE_DISPLAY[lang] || lang}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            style={[
              styles.verifyButton,
              submitting && styles.verifyButtonDisabled,
            ]}
            onPress={handleVerify}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.verifyText}>{t("driverCreate.verifyAndContinue")}</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
      </KeyboardAvoidingWrapper>
    </DirectionalScreen>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
    padding: 20,
    paddingTop: 48,
    paddingBottom: 40,
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
    marginBottom: 8,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: "#E7DCD1",
  },
  title: {
    fontSize: 26,
    fontWeight: "900",
    textAlign: "center",
    color: "#111827",
    marginBottom: 8,
  },
  subtitle: {
    textAlign: "center",
    color: "#7C5F46",
    marginBottom: 20,
    fontSize: 14,
  },
  sectionCard: {
    backgroundColor: "#FFF8F2",
    borderWidth: 1,
    borderColor: "#F0DFC8",
    borderRadius: 16,
    padding: 16,
    marginBottom: 6,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: "#111827",
  },
  consentText: {
    color: "#7C5F46",
    fontSize: 12.5,
    lineHeight: 17,
    marginBottom: 12,
  },
  preview: {
    width: "100%",
    height: 170,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: "#EFE6DD",
  },
  scanButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#F58220",
    borderRadius: 12,
    paddingVertical: 13,
  },
  scanButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 14,
  },
  analyzingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  analyzingText: {
    color: "#7C5F46",
    fontWeight: "700",
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FDECEC",
    borderWidth: 1,
    borderColor: "#F5C2C2",
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  errorText: {
    color: "#B91C1C",
    fontWeight: "700",
    fontSize: 13,
    flexShrink: 1,
  },
  validBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#E7F7EC",
    borderWidth: 1,
    borderColor: "#BBE7C6",
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  validText: {
    color: "#166534",
    fontWeight: "900",
    fontSize: 14,
  },
  expiredBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FDECEC",
    borderWidth: 1,
    borderColor: "#F5C2C2",
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  expiredText: {
    color: "#B91C1C",
    fontWeight: "900",
    fontSize: 14,
  },
  unknownBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFF2E8",
    borderWidth: 1,
    borderColor: "#F7D3B4",
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  unknownText: {
    color: "#B86115",
    fontWeight: "800",
    fontSize: 13,
    flexShrink: 1,
  },
  readOnlyBox: {
    marginTop: 12,
  },
  readOnlyLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: "#7C5F46",
    marginBottom: 4,
    marginTop: 8,
  },
  readOnlyInput: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    padding: 12,
    backgroundColor: "#F1EAE1",
    color: "#4B4038",
    fontWeight: "700",
  },
  qualityNote: {
    marginTop: 10,
    color: "#B86115",
    fontSize: 12,
    fontWeight: "700",
  },
  label: {
    fontWeight: "800",
    color: "#111827",
    marginBottom: 10,
    marginTop: 18,
  },
  languageRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  languageButton: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#FFFFFF",
  },
  languageButtonActive: {
    backgroundColor: "#F58220",
    borderColor: "#F58220",
  },
  languageText: {
    color: "#7C5F46",
    fontWeight: "700",
  },
  languageTextActive: {
    color: "#FFFFFF",
  },
  verifyButton: {
    backgroundColor: "#F58220",
    borderRadius: 12,
    padding: 16,
    marginTop: 26,
  },
  verifyButtonDisabled: {
    opacity: 0.6,
  },
  verifyText: {
    color: "#FFFFFF",
    textAlign: "center",
    fontSize: 17,
    fontWeight: "900",
  },
});
