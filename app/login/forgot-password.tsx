import { router } from "expo-router";
import { sendPasswordResetEmail } from "firebase/auth";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { auth } from "../../firebase";

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
import { auth, firebaseAuthDomain } from "../../firebase";
import { useLanguage } from "../i18n/LanguageProvider";

// The reset link opens a small standalone static page (see
// web-reset-password/reset-password.html, deployed via Firebase Hosting per
// firebase.json) instead of Firebase's generic hosted action page — a real,
// branded HTTPS page whose HTML renders the link/button correctly on every
// mail client, and lets us show translated success/expired/invalid states.
// (It's a plain static page, not part of this Expo app's own web bundle,
// because Expo's static web export currently fails on unrelated
// react-native-maps screens elsewhere in the app — see the reset-password
// deployment notes.) `handleCodeInApp: true` is what makes Firebase append
// mode/oobCode/apiKey/lang directly onto this URL rather than routing
// through its own /__/auth/action handler.
const RESET_PASSWORD_CONTINUE_URL = `https://${firebaseAuthDomain}/reset-password`;

const translateResetError = (
  t: (key: string) => string,
  code: string | undefined,
): string => {
  switch (code) {
    case "auth/invalid-email":
      return t("auth.invalidEmailError");
    case "auth/too-many-requests":
      return t("auth.resetTooManyRequests");
    case "auth/network-request-failed":
      return t("auth.resetNetworkError");
    // auth/user-not-found is deliberately NOT special-cased here — it always
    // shows the same generic "check your email" success message as a real
    // send, so this screen never reveals whether an email is registered.
    default:
      return t("auth.resetGenericError");
  }
};

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const { isRTL, language } = useLanguage();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleReset = async () => {
    if (!email) {
      alert(t("auth.pleaseEnterYourEmail"));
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      Alert.alert(t("common.error"), t("auth.missingEmail"));
      return;
    }

    if (submitting) return;

    try {
      await sendPasswordResetEmail(auth, email.trim());
      alert(t("auth.resetEmailSentMessage"));
      setSubmitting(true);

      // Best-effort — affects which language Firebase's own default email
      // template renders in, if a custom template hasn't been set up yet.
      auth.languageCode = language;

      await sendPasswordResetEmail(auth, trimmedEmail, {
        url: RESET_PASSWORD_CONTINUE_URL,
        handleCodeInApp: true,
      });

      Alert.alert(t("auth.resetEmailSentTitle"), t("auth.resetEmailSentMessage"), [
        { text: t("common.ok"), onPress: () => router.replace("/") },
      ]);
    } catch (error: any) {
      // auth/user-not-found intentionally shows the exact same message as
      // success above — never surfaced as an error, so this screen can't be
      // used to check whether an email is registered.
      if (error?.code === "auth/user-not-found") {
        Alert.alert(t("auth.resetEmailSentTitle"), t("auth.resetEmailSentMessage"), [
          { text: t("common.ok"), onPress: () => router.replace("/") },
        ]);
        return;
      }

      Alert.alert(t("common.error"), translateResetError(t, error?.code));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.card}>
        <Text style={styles.title}>{t("auth.resetPasswordTitle")}</Text>
        <Text style={styles.subtitle}>
          {t("auth.enterEmailToReceiveLink")}
        </Text>

        <Text style={styles.label}>{t("auth.email")}</Text>
        <TextInput
          style={styles.input}
        <Text style={[styles.title, isRTL && styles.textRTL]}>
          {t("auth.forgotPasswordTitle")}
        </Text>
        <Text style={[styles.subtitle, isRTL && styles.textRTL]}>
          {t("auth.forgotPasswordSubtitle")}
        </Text>

        <Text style={[styles.label, isRTL && styles.textRTL]}>
          {t("auth.email")}
        </Text>
        <TextInput
          style={[styles.input, isRTL && styles.textRTL]}
          placeholder={t("auth.emailPlaceholder")}
          placeholderTextColor="#8b7b6b"
          keyboardType="email-address"
          autoCapitalize="none"
          value={email}
          onChangeText={setEmail}
          editable={!submitting}
        />

        <Pressable style={styles.button} onPress={handleReset}>
          <Text style={styles.buttonText}>{t("auth.sendResetLinkButton")}</Text>
        </Pressable>

        <Pressable onPress={() => router.replace("/")}>
          <Text style={styles.backText}>{t("auth.backToLoginButton")}</Text>
        <Pressable
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={handleReset}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>{t("auth.sendResetLink")}</Text>
          )}
        </Pressable>

        <Pressable onPress={() => router.replace("/")}>
          <Text style={styles.backText}>{t("auth.backToLogin")}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#FBF7F1",
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
    marginBottom: 10,
  },
  subtitle: {
    textAlign: "center",
    color: "#7C5F46",
    marginBottom: 28,
    fontSize: 15,
  },
  textRTL: {
    textAlign: "right",
    writingDirection: "rtl",
  },
  label: {
    fontWeight: "800",
    color: "#111827",
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    padding: 14,
    backgroundColor: "#FFFDFC",
    color: "#111827",
    marginBottom: 18,
  },
  button: {
    backgroundColor: "#F58220",
    borderRadius: 12,
    padding: 16,
    marginBottom: 18,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "white",
    textAlign: "center",
    fontSize: 17,
    fontWeight: "900",
  },
  backText: {
    textAlign: "center",
    color: "#F47C20",
    fontWeight: "900",
  },
});
