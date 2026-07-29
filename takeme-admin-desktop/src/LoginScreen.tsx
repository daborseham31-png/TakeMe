// ---------------------------------------------------------------------------
// New file — the mobile app's login screen (app/index.tsx) is a shared
// passenger/driver/admin screen with a role toggle, sign-up link, language
// picker, etc.; this desktop app only ever needs the admin path, so this is
// a minimal admin-only login screen instead of copying and stripping down
// that shared screen. The actual sign-in logic below (sign in -> check
// account restriction -> check isUserAdmin -> route) is copied verbatim from
// app/index.tsx's handleLogin, reusing the exact same adminAuthLib
// functions and auth.* translation keys — no new behavior invented.
// ---------------------------------------------------------------------------

import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { auth } from "../firebase";
import { getAccountRestriction, isUserAdmin } from "./admin/adminAuthLib";
import { adminColors, adminRadius, adminSpacing } from "./admin/adminTheme";
import { router } from "./router/expoRouterShim";

export default function LoginScreen() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      setError(t("auth.enterEmailPassword"));
      return;
    }

    setError("");
    setBusy(true);

    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);

      const restriction = await getAccountRestriction(credential.user.uid);
      if (restriction) {
        await signOut(auth);
        const statusWord =
          restriction.status === "blocked" ? t("auth.statusWordBlocked") : t("auth.statusWordSuspended");
        setError(
          restriction.reason
            ? t("auth.blockedByAdmin", { status: statusWord, reason: restriction.reason })
            : t("auth.blockedByAdminNoReason", { status: statusWord }),
        );
        return;
      }

      const admin = await isUserAdmin(credential.user);
      if (!admin) {
        await signOut(auth);
        setError(t("auth.notAdmin"));
        return;
      }

      router.replace("/admin");
    } catch {
      setError(t("auth.invalidCredentials"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.page}>
      <View style={styles.card}>
        <Text style={styles.title}>{t("common.appName")}</Text>
        <Text style={styles.subtitle}>{t("auth.loginTitle")}</Text>

        <Text style={styles.label}>{t("auth.email")}</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder={t("auth.emailPlaceholder")}
          placeholderTextColor={adminColors.placeholder}
          autoCapitalize="none"
          keyboardType="email-address"
          onSubmitEditing={handleLogin}
        />

        <Text style={styles.label}>{t("auth.password")}</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder={t("auth.passwordPlaceholder")}
          placeholderTextColor={adminColors.placeholder}
          secureTextEntry
          onSubmitEditing={handleLogin}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable style={[styles.button, busy && styles.buttonDisabled]} onPress={handleLogin} disabled={busy}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>{t("auth.loginButton")}</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    minHeight: "100vh" as any,
    backgroundColor: adminColors.page,
    alignItems: "center",
    justifyContent: "center",
    padding: adminSpacing.lg,
  },
  card: {
    width: 360,
    maxWidth: "100%",
    backgroundColor: adminColors.card,
    borderRadius: adminRadius.lg,
    borderWidth: 1,
    borderColor: adminColors.border,
    padding: adminSpacing.lg,
  },
  title: {
    fontSize: 22,
    fontWeight: "900",
    color: adminColors.text,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: adminColors.textMuted,
    textAlign: "center",
    marginTop: 4,
    marginBottom: adminSpacing.md,
  },
  label: {
    fontWeight: "800",
    color: adminColors.text,
    marginTop: 12,
    marginBottom: 6,
    fontSize: 13,
  },
  input: {
    borderWidth: 1,
    borderColor: adminColors.borderStrong,
    borderRadius: adminRadius.sm,
    padding: 12,
    color: adminColors.text,
  },
  error: {
    color: adminColors.danger,
    fontWeight: "700",
    fontSize: 12.5,
    marginTop: 12,
  },
  button: {
    backgroundColor: adminColors.primary,
    borderRadius: adminRadius.sm,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 20,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
  },
});
