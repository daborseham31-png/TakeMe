import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { createUserWithEmailAndPassword, deleteUser } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useTranslation } from "react-i18next";

import { auth, db } from "../../firebase";
import {
  analyzeIdImage,
  analyzeLicenseImage,
  calculateAgeFromBirthDate,
  checkLicenseDocumentType,
  compressImageToBase64,
  getLicenseValidity,
  IdAnalysisResult,
  isIdReadable,
  LicenseAnalysisResult,
  pickDocumentImage,
  SPOKEN_LANGUAGE_OPTIONS,
} from "./idVerificationLib";

type Gender = "Male" | "Female" | "Other";

// Native-script display only — the value saved to Firestore (spokenLanguages)
// always stays one of SPOKEN_LANGUAGE_OPTIONS' English words.
const SPOKEN_LANGUAGE_DISPLAY: Record<string, string> = {
  Arabic: "العربية",
  Hebrew: "עברית",
  English: "English",
  Russian: "Русский",
};

export default function SignUpScreen() {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [isDriver, setIsDriver] = useState(false);

  // --- ID scan --------------------------------------------------------------
  const [idImageUri, setIdImageUri] = useState<string | null>(null);
  const [idAnalyzing, setIdAnalyzing] = useState(false);
  const [idResult, setIdResult] = useState<IdAnalysisResult | null>(null);
  const [idError, setIdError] = useState<string | null>(null);

  // --- Manual fields ----------------------------------------------------------
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [gender, setGender] = useState<Gender | "">("");

  // --- Driver: spoken languages -----------------------------------------------
  const [spokenLanguages, setSpokenLanguages] = useState<string[]>([]);

  // --- Driver: license scan -----------------------------------------------------
  const [licenseImageUri, setLicenseImageUri] = useState<string | null>(null);
  const [licenseAnalyzing, setLicenseAnalyzing] = useState(false);
  const [licenseResult, setLicenseResult] = useState<LicenseAnalysisResult | null>(
    null,
  );
  const [licenseError, setLicenseError] = useState<string | null>(null);

  const getDigitsOnly = (value: string) => value.replace(/\D/g, "");

  // --- Validation -----------------------------------------------------------
  const normalizedEmail = email.trim().toLowerCase();
  const isValidEmail = /^[^\s@]+@(gmail\.com|hotmail\.com)$/.test(normalizedEmail);
  const emailError =
    email.trim().length > 0 && !isValidEmail
      ? t("auth.emailMustBeGmailHotmail")
      : "";

  const derivedAge =
    calculateAgeFromBirthDate(idResult?.birthDate ?? null) ?? idResult?.age ?? null;

  const licenseValidity = getLicenseValidity(licenseResult?.expiryDate ?? null);
  const licenseDocCheck = checkLicenseDocumentType(licenseResult);

  // ---------------------------------------------------------------------
  // ID scan
  // ---------------------------------------------------------------------

  const handlePickId = async () => {
    const uri = await pickDocumentImage();
    if (!uri) return;

    setIdImageUri(uri);
    setIdResult(null);
    setIdError(null);
    setIdAnalyzing(true);

    try {
      const base64 = await compressImageToBase64(uri);
      const result = await analyzeIdImage(base64);
      setIdResult(result);

      if (!isIdReadable(result)) {
        setIdError(t("auth.couldNotReadIdClear"));
      }
    } catch (error: any) {
      setIdError(error?.message || t("auth.couldNotReadIdTryAgain"));
    } finally {
      setIdAnalyzing(false);
    }
  };

  // ---------------------------------------------------------------------
  // Driver license scan
  // ---------------------------------------------------------------------

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

      const docCheck = checkLicenseDocumentType(result);

      if (docCheck === "wrong_document") {
        // Confidently NOT a license (ID card / passport / other document /
        // random photo) — never store fields extracted from the wrong
        // document, and block here rather than only at submit time.
        setLicenseResult(null);
        setLicenseError(
          "This doesn't look like a driving license. Please upload a clear photo of your actual driving license.",
        );
        return;
      }

      setLicenseResult(result);

      if (!result.expiryDate) {
        setLicenseError(t("driverCreate.couldNotReadExpiryShort"));
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

  // ---------------------------------------------------------------------
  // Sign up
  // ---------------------------------------------------------------------

  const handleSignUp = async () => {
    if (!idResult || !isIdReadable(idResult) || !idImageUri) {
      Alert.alert(
        t("auth.idVerificationRequiredTitle"),
        t("auth.scanClearIdMessage"),
      );
      return;
    }

    if (!email.trim() || !phone.trim() || !password) {
      Alert.alert(t("auth.missingDetails"), t("auth.fillAllRequiredFields"));
      return;
    }

    if (!isValidEmail) {
      Alert.alert(t("auth.invalidEmailTitle"), t("auth.emailMustBeGmailHotmail"));
      return;
    }

    if (!gender) {
      Alert.alert(t("auth.missingGenderTitle"), t("auth.selectYourGender"));
      return;
    }

    if (password.length < 6) {
      Alert.alert(t("auth.weakPasswordTitle"), t("auth.passwordMinLength"));
      return;
    }

    if (isDriver) {
      if (spokenLanguages.length === 0) {
        Alert.alert(
          t("validation.languagesRequiredTitle"),
          t("validation.selectAtLeastOneLanguage"),
        );
        return;
      }

      if (!licenseImageUri || !licenseResult) {
        Alert.alert(
          t("validation.licenseRequiredTitle"),
          t("validation.uploadClearLicenseMessage"),
        );
        return;
      }

      // Defense in depth — handlePickLicense already blocks/clears the
      // result for a confidently-wrong document, so this only matters if
      // that state somehow went stale.
      if (licenseDocCheck === "wrong_document") {
        Alert.alert(
          "Wrong document",
          "The uploaded image doesn't look like a driving license. Please upload your actual driving license.",
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
          t("auth.driverLicenseExpiredCannotRegister"),
        );
        return;
      }
    }

    setSubmitting(true);

    let createdUid: string | null = null;

    try {
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        normalizedEmail,
        password,
      );

      createdUid = userCredential.user.uid;

      const fullName =
        idResult.fullName ||
        [idResult.firstName, idResult.lastName].filter(Boolean).join(" ") ||
        "";

      const baseData = {
        name: fullName,
        email: normalizedEmail,
        phone: getDigitsOnly(phone),
        birthDate: idResult.birthDate,
        age: derivedAge,
        gender,
        idVerificationStatus: "verified_by_ai",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      if (isDriver && licenseResult) {
        await setDoc(doc(db, "users", createdUid), {
          ...baseData,
          role: "driver",
          isDriver: true,
          licenseExpiryDate: licenseResult.expiryDate,
          licenseIsValid: true,
          spokenLanguages,
          // Real Gemini Vision document classification — never approved
          // automatically either way; this only tells the admin whether the
          // system was confident it's a real license (see
          // checkLicenseDocumentType) or whether the document itself needs a
          // closer manual look.
          licenseDocumentType: licenseResult.documentType,
          licenseDocumentTypeConfidence: licenseResult.documentTypeConfidence,
          licenseNeedsManualDocumentReview: licenseDocCheck === "needs_manual_review",
          driverVerificationStatus: "pending_admin_review",
        });
      } else {
        await setDoc(doc(db, "users", createdUid), {
          ...baseData,
          role: "passenger",
          isDriver: false,
        });
      }

      Alert.alert(t("admin.successTitle"), t("auth.accountCreatedSuccessMessage"));
      router.replace("/(tabs)/home" as any);
    } catch (error: any) {
      if (createdUid && auth.currentUser) {
        await deleteUser(auth.currentUser).catch(() => {});
      }

      Alert.alert(t("auth.signUpFailedTitle"), error?.message || t("validation.pleaseTryAgain"));
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------

  const renderQualityNote = (quality: IdAnalysisResult["imageQuality"] | undefined) => {
    if (!quality || quality === "clear") return null;

    return (
      <Text style={styles.qualityNote}>
        {t("driverCreate.imageQualityNote", { quality })}
      </Text>
    );
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.title}>{t("auth.signUp")}</Text>
          <Text style={styles.subtitle}>{t("auth.createYourAccount")}</Text>

          {/* ---------------------------------------------------------- */}
          {/* Step 1 — Identity card scan                                 */}
          {/* ---------------------------------------------------------- */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="card-outline" size={20} color="#F58220" />
              <Text style={styles.sectionTitle}>{t("auth.scanYourIdTitle")}</Text>
            </View>

            <Text style={styles.consentText}>
              {t("driverCreate.licenseConsentText")}
            </Text>

            {idImageUri ? (
              <Image source={{ uri: idImageUri }} style={styles.preview} />
            ) : null}

            <Pressable
              style={styles.scanButton}
              onPress={handlePickId}
              disabled={idAnalyzing}
            >
              <Ionicons name="camera-outline" size={18} color="#FFFFFF" />
              <Text style={styles.scanButtonText}>
                {idImageUri ? t("driverCreate.retakeUploadAgain") : t("auth.scanYourIdButton")}
              </Text>
            </Pressable>

            {idAnalyzing ? (
              <View style={styles.analyzingRow}>
                <ActivityIndicator color="#F58220" />
                <Text style={styles.analyzingText}>{t("auth.readingYourId")}</Text>
              </View>
            ) : null}

            {!idAnalyzing && idError ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={18} color="#B91C1C" />
                <Text style={styles.errorText}>{idError}</Text>
              </View>
            ) : null}

            {!idAnalyzing && idResult && isIdReadable(idResult) ? (
              <View style={styles.readOnlyBox}>
                <View style={styles.verifiedRow}>
                  <Ionicons name="checkmark-circle" size={16} color="#166534" />
                  <Text style={styles.verifiedText}>{t("auth.idReadSuccessfully")}</Text>
                </View>

                <Text style={styles.readOnlyLabel}>{t("auth.fullNameLabel")}</Text>
                <TextInput
                  style={styles.readOnlyInput}
                  value={idResult.fullName || ""}
                  editable={false}
                />

                <Text style={styles.readOnlyLabel}>{t("auth.birthDateLabel")}</Text>
                <TextInput
                  style={styles.readOnlyInput}
                  value={idResult.birthDate || ""}
                  editable={false}
                />

                <Text style={styles.readOnlyLabel}>{t("auth.ageLabelShort")}</Text>
                <TextInput
                  style={styles.readOnlyInput}
                  value={derivedAge !== null ? String(derivedAge) : ""}
                  editable={false}
                />

                {renderQualityNote(idResult.imageQuality)}
              </View>
            ) : null}
          </View>

          {/* ---------------------------------------------------------- */}
          {/* Step 2 — Manual fields                                      */}
          {/* ---------------------------------------------------------- */}
          <Text style={styles.label}>{t("auth.email")}</Text>
          <TextInput
            style={styles.input}
            placeholder={t("auth.emailPlaceholder")}
            placeholderTextColor="#8b7b6b"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />
          {emailError ? <Text style={styles.fieldError}>{emailError}</Text> : null}

          <Text style={styles.label}>{t("auth.phoneNumberLabel")}</Text>
          <TextInput
            style={styles.input}
            placeholder={t("auth.phoneNumberPlaceholder")}
            placeholderTextColor="#8b7b6b"
            keyboardType="phone-pad"
            value={phone}
            onChangeText={(text) => setPhone(getDigitsOnly(text))}
          />

          <Text style={styles.label}>{t("auth.password")}</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={styles.passwordInput}
              placeholder={t("auth.passwordPlaceholder")}
              placeholderTextColor="#8b7b6b"
              secureTextEntry={!showPw}
              value={password}
              onChangeText={setPassword}
            />
            <Pressable onPress={() => setShowPw(!showPw)}>
              <Text style={styles.eye}>{showPw ? t("auth.hide") : t("auth.show")}</Text>
            </Pressable>
          </View>

          <Text style={styles.label}>{t("auth.genderLabel")}</Text>
          <View style={styles.optionRow}>
            {(["Male", "Female", "Other"] as Gender[]).map((option) => (
              <Pressable
                key={option}
                style={[
                  styles.optionButton,
                  gender === option && styles.optionButtonActive,
                ]}
                onPress={() => setGender(option)}
              >
                <Text
                  style={[
                    styles.optionText,
                    gender === option && styles.optionTextActive,
                  ]}
                >
                  {option === "Male"
                    ? t("common.male")
                    : option === "Female"
                      ? t("common.female")
                      : t("auth.otherPreferNotToSay")}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* ---------------------------------------------------------- */}
          {/* Driver toggle                                               */}
          {/* ---------------------------------------------------------- */}
          <Pressable
            style={styles.checkRow}
            onPress={() => setIsDriver(!isDriver)}
          >
            <View style={[styles.circle, isDriver && styles.circleActive]} />
            <Text style={styles.checkText}>{t("auth.alsoRegisterAsDriver")}</Text>
          </Pressable>

          {isDriver ? (
            <>
              {/* ------------------------------------------------------ */}
              {/* Spoken languages                                        */}
              {/* ------------------------------------------------------ */}
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

              {/* ------------------------------------------------------ */}
              {/* Driver license scan                                     */}
              {/* ------------------------------------------------------ */}
              <View style={styles.sectionCard}>
                <View style={styles.sectionHeaderRow}>
                  <Ionicons name="car-outline" size={20} color="#F58220" />
                  <Text style={styles.sectionTitle}>
                    {t("driverCreate.scanLicenseTitle")}
                  </Text>
                </View>

                <Text style={styles.consentText}>
                  {t("driverCreate.licenseConsentText")}
                </Text>

                {licenseImageUri ? (
                  <Image
                    source={{ uri: licenseImageUri }}
                    style={styles.preview}
                  />
                ) : null}

                <Pressable
                  style={styles.scanButton}
                  onPress={handlePickLicense}
                  disabled={licenseAnalyzing}
                >
                  <Ionicons name="camera-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.scanButtonText}>
                    {licenseImageUri
                      ? t("driverCreate.retakeUploadAgain")
                      : t("driverCreate.scanLicenseTitle")}
                  </Text>
                </Pressable>

                {licenseAnalyzing ? (
                  <View style={styles.analyzingRow}>
                    <ActivityIndicator color="#F58220" />
                    <Text style={styles.analyzingText}>
                      {t("driverCreate.readingLicense")}
                    </Text>
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
                    {licenseDocCheck === "needs_manual_review" ? (
                      <View style={styles.unknownBox}>
                        <Ionicons
                          name="information-circle-outline"
                          size={18}
                          color="#B86115"
                        />
                        <Text style={styles.unknownText}>
                          We couldn&apos;t confidently confirm this is a
                          driving license. You can still submit — an admin
                          will review the document manually.
                        </Text>
                      </View>
                    ) : null}

                    {licenseValidity === "valid" ? (
                      <View style={styles.validBox}>
                        <Ionicons
                          name="checkmark-circle"
                          size={18}
                          color="#166534"
                        />
                        <Text style={styles.validText}>{t("driverCreate.licenseIsValid")}</Text>
                      </View>
                    ) : licenseValidity === "expired" ? (
                      <View style={styles.expiredBox}>
                        <Ionicons name="close-circle" size={18} color="#B91C1C" />
                        <Text style={styles.expiredText}>
                          {t("driverCreate.licenseIsExpired")}
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.unknownBox}>
                        <Ionicons
                          name="warning-outline"
                          size={18}
                          color="#B86115"
                        />
                        <Text style={styles.unknownText}>
                          {t("driverCreate.couldNotReadExpiryShort")}
                        </Text>
                      </View>
                    )}

                    <View style={styles.readOnlyBox}>
                      <Text style={styles.readOnlyLabel}>{t("driverCreate.licenseNumberLabel")}</Text>
                      <TextInput
                        style={styles.readOnlyInput}
                        value={licenseResult.licenseNumber || ""}
                        editable={false}
                      />

                      <Text style={styles.readOnlyLabel}>{t("driverCreate.expiryDateLabel")}</Text>
                      <TextInput
                        style={styles.readOnlyInput}
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
            </>
          ) : null}

          <Pressable
            style={[
              styles.signUpButton,
              submitting && styles.signUpButtonDisabled,
            ]}
            onPress={handleSignUp}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.signUpText}>{t("auth.signUp")}</Text>
            )}
          </Pressable>

          <Pressable onPress={() => router.replace("/")}>
            <Text style={styles.loginText}>
              {t("auth.alreadyHaveAccount")}
              <Text style={styles.loginLink}>{t("auth.loginButton")}</Text>
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 20,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: "#E7DCD1",
  },
  title: {
    fontSize: 28,
    fontWeight: "900",
    textAlign: "center",
    color: "#111827",
    marginBottom: 8,
  },
  subtitle: {
    textAlign: "center",
    color: "#7C5F46",
    marginBottom: 20,
    fontSize: 15,
  },
  sectionCard: {
    backgroundColor: "#FFF8F2",
    borderWidth: 1,
    borderColor: "#F0DFC8",
    borderRadius: 16,
    padding: 16,
    marginTop: 14,
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
  verifiedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
  },
  verifiedText: {
    color: "#166534",
    fontWeight: "900",
    fontSize: 13,
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
  label: {
    fontWeight: "800",
    color: "#111827",
    marginBottom: 10,
    marginTop: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    padding: 14,
    backgroundColor: "#FFFDFC",
    color: "#111827",
  },
  fieldError: {
    color: "#B91C1C",
    fontWeight: "700",
    fontSize: 12.5,
    marginTop: 6,
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: "#FFFDFC",
  },
  passwordInput: {
    flex: 1,
    paddingVertical: 14,
    color: "#111827",
  },
  eye: {
    color: "#8B7B6B",
    fontWeight: "700",
  },
  optionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optionButton: {
    flexGrow: 1,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  optionButtonActive: {
    backgroundColor: "#F58220",
    borderColor: "#F58220",
  },
  optionText: {
    color: "#7C5F46",
    fontWeight: "800",
    fontSize: 12.5,
    textAlign: "center",
  },
  optionTextActive: {
    color: "#FFFFFF",
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 20,
    marginBottom: 6,
    gap: 10,
  },
  circle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: "#F47C20",
  },
  circleActive: {
    backgroundColor: "#F47C20",
  },
  checkText: {
    fontWeight: "700",
    color: "#111827",
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
  signUpButton: {
    backgroundColor: "#F58220",
    borderRadius: 12,
    padding: 16,
    marginTop: 26,
  },
  signUpButtonDisabled: {
    opacity: 0.6,
  },
  signUpText: {
    color: "white",
    textAlign: "center",
    fontSize: 17,
    fontWeight: "900",
  },
  loginText: {
    textAlign: "center",
    marginTop: 20,
    color: "#7C5F46",
  },
  loginLink: {
    color: "#F47C20",
    fontWeight: "900",
  },
});
