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

import { auth, db } from "../../firebase";
import {
  analyzeIdImage,
  analyzeLicenseImage,
  calculateAgeFromBirthDate,
  compressImageToBase64,
  getLicenseValidity,
  IdAnalysisResult,
  isIdReadable,
  LicenseAnalysisResult,
  pickDocumentImage,
  SPOKEN_LANGUAGE_OPTIONS,
} from "./idVerificationLib";

type Gender = "Male" | "Female" | "Other";

export default function SignUpScreen() {
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

  const derivedAge =
    calculateAgeFromBirthDate(idResult?.birthDate ?? null) ?? idResult?.age ?? null;

  const licenseValidity = getLicenseValidity(licenseResult?.expiryDate ?? null);

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
        setIdError(
          "We couldn't read your ID clearly. Please upload a clearer photo.",
        );
      }
    } catch (error: any) {
      setIdError(error?.message || "Could not read your ID. Please try again.");
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
      setLicenseResult(result);

      if (!result.expiryDate) {
        setLicenseError(
          "Could not read license expiry date. Please upload a clearer photo.",
        );
      }
    } catch (error: any) {
      setLicenseError(
        error?.message || "Could not read your license. Please try again.",
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
        "ID verification required",
        "Please scan a clear photo of your ID before signing up.",
      );
      return;
    }

    if (!email.trim() || !phone.trim() || !password) {
      Alert.alert("Missing details", "Please fill in all required fields.");
      return;
    }

    if (!gender) {
      Alert.alert("Missing gender", "Please select your gender.");
      return;
    }

    if (password.length < 6) {
      Alert.alert("Weak password", "Password must be at least 6 characters.");
      return;
    }

    if (isDriver) {
      if (spokenLanguages.length === 0) {
        Alert.alert(
          "Languages required",
          "Please select at least one language you speak.",
        );
        return;
      }

      if (!licenseImageUri || !licenseResult) {
        Alert.alert(
          "License required",
          "Please upload a clear driving license image.",
        );
        return;
      }

      if (licenseValidity === "unknown") {
        Alert.alert(
          "License required",
          "Please upload a clear driving license image.",
        );
        return;
      }

      if (licenseValidity === "expired") {
        Alert.alert(
          "License expired",
          "Your driving license is expired. You cannot register as a driver.",
        );
        return;
      }
    }

    setSubmitting(true);

    let createdUid: string | null = null;

    try {
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        password,
      );

      createdUid = userCredential.user.uid;

      const fullName =
        idResult.fullName ||
        [idResult.firstName, idResult.lastName].filter(Boolean).join(" ") ||
        "";

      const baseData = {
        name: fullName,
        email: email.trim().toLowerCase(),
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
          driverVerificationStatus: "pending_admin_review",
        });
      } else {
        await setDoc(doc(db, "users", createdUid), {
          ...baseData,
          role: "passenger",
          isDriver: false,
        });
      }

      Alert.alert("Success", "Account created successfully!");
      router.replace("/(tabs)/home" as any);
    } catch (error: any) {
      if (createdUid && auth.currentUser) {
        await deleteUser(auth.currentUser).catch(() => {});
      }

      Alert.alert("Sign up failed", error?.message || "Please try again.");
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
        Image quality: {quality}. For best results use a clear, well-lit photo.
      </Text>
    );
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.title}>Sign Up</Text>
          <Text style={styles.subtitle}>Create your account</Text>

          {/* ---------------------------------------------------------- */}
          {/* Step 1 — Identity card scan                                 */}
          {/* ---------------------------------------------------------- */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="card-outline" size={20} color="#F58220" />
              <Text style={styles.sectionTitle}>Scan your ID</Text>
            </View>

            <Text style={styles.consentText}>
              Your document photo is used only to verify your account details.
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
                {idImageUri ? "Retake / Upload Again" : "Scan your ID"}
              </Text>
            </Pressable>

            {idAnalyzing ? (
              <View style={styles.analyzingRow}>
                <ActivityIndicator color="#F58220" />
                <Text style={styles.analyzingText}>Reading your ID…</Text>
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
                  <Text style={styles.verifiedText}>ID read successfully</Text>
                </View>

                <Text style={styles.readOnlyLabel}>Full Name</Text>
                <TextInput
                  style={styles.readOnlyInput}
                  value={idResult.fullName || ""}
                  editable={false}
                />

                <Text style={styles.readOnlyLabel}>Birth Date</Text>
                <TextInput
                  style={styles.readOnlyInput}
                  value={idResult.birthDate || ""}
                  editable={false}
                />

                <Text style={styles.readOnlyLabel}>Age</Text>
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
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor="#8b7b6b"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />

          <Text style={styles.label}>Phone Number</Text>
          <TextInput
            style={styles.input}
            placeholder="Phone number"
            placeholderTextColor="#8b7b6b"
            keyboardType="phone-pad"
            value={phone}
            onChangeText={(text) => setPhone(getDigitsOnly(text))}
          />

          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={styles.passwordInput}
              placeholder="Password"
              placeholderTextColor="#8b7b6b"
              secureTextEntry={!showPw}
              value={password}
              onChangeText={setPassword}
            />
            <Pressable onPress={() => setShowPw(!showPw)}>
              <Text style={styles.eye}>{showPw ? "Hide" : "Show"}</Text>
            </Pressable>
          </View>

          <Text style={styles.label}>Gender</Text>
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
                  {option === "Other" ? "Other / Prefer not to say" : option}
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
            <Text style={styles.checkText}>Also register as a Driver</Text>
          </Pressable>

          {isDriver ? (
            <>
              {/* ------------------------------------------------------ */}
              {/* Spoken languages                                        */}
              {/* ------------------------------------------------------ */}
              <Text style={styles.label}>Languages you speak</Text>
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
                        {lang}
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
                    Scan your driving license
                  </Text>
                </View>

                <Text style={styles.consentText}>
                  Your document photo is used only to verify your account
                  details.
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
                      ? "Retake / Upload Again"
                      : "Scan your driving license"}
                  </Text>
                </Pressable>

                {licenseAnalyzing ? (
                  <View style={styles.analyzingRow}>
                    <ActivityIndicator color="#F58220" />
                    <Text style={styles.analyzingText}>
                      Reading your license…
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
                    {licenseValidity === "valid" ? (
                      <View style={styles.validBox}>
                        <Ionicons
                          name="checkmark-circle"
                          size={18}
                          color="#166534"
                        />
                        <Text style={styles.validText}>License is valid</Text>
                      </View>
                    ) : licenseValidity === "expired" ? (
                      <View style={styles.expiredBox}>
                        <Ionicons name="close-circle" size={18} color="#B91C1C" />
                        <Text style={styles.expiredText}>
                          License is expired
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
                          Could not read license expiry date. Please upload a
                          clearer photo.
                        </Text>
                      </View>
                    )}

                    <View style={styles.readOnlyBox}>
                      <Text style={styles.readOnlyLabel}>License Number</Text>
                      <TextInput
                        style={styles.readOnlyInput}
                        value={licenseResult.licenseNumber || ""}
                        editable={false}
                      />

                      <Text style={styles.readOnlyLabel}>Expiry Date</Text>
                      <TextInput
                        style={styles.readOnlyInput}
                        value={licenseResult.expiryDate || ""}
                        editable={false}
                      />

                      <Text style={styles.readOnlyLabel}>Categories</Text>
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
              <Text style={styles.signUpText}>Sign Up</Text>
            )}
          </Pressable>

          <Pressable onPress={() => router.replace("/")}>
            <Text style={styles.loginText}>
              Already have an account?{" "}
              <Text style={styles.loginLink}>Login</Text>
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
