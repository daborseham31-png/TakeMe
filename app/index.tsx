import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { auth } from "../firebase";
import KeyboardSafeScreen from "./components/KeyboardSafeScreen";
import {
  DirectionalRow,
  DirectionalScreen,
  PhysicalDirectionalBlockText,
} from "./i18n/DirectionalPrimitives";
import { useLanguage } from "./i18n/LanguageProvider";
import LanguageSelectorModal from "./i18n/LanguageSelectorModal";
import { positionEnd } from "./i18n/rtl";
import { getAccountRestriction, isUserAdmin } from "./admin/adminAuthLib";

export default function AppStartScreen() {
  const { t } = useTranslation();
  const { isRTL, language } = useLanguage();
  const { width: windowWidth } = useWindowDimensions();

  const [loading, setLoading] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [role, setRole] = useState<"user" | "admin">("user");
  const [languageModalVisible, setLanguageModalVisible] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Emails/passwords are always LTR content once something is actually
  // typed — only the empty-field PLACEHOLDER should follow the app's own
  // language direction (an Arabic placeholder must read right-to-left; the
  // entered value itself never should, unlike a natural-language field such
  // as IsraelLocationAutocomplete's content-language detection).
  const emailFieldIsRTL = email.length === 0 && isRTL;
  const passwordFieldIsRTL = password.length === 0 && isRTL;

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 2500);
    return () => clearTimeout(timer);
  }, []);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert(t("auth.missingDetails"), t("auth.enterEmailPassword"));
      return;
    }

    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);

      // A blocked/suspended account must never reach any screen, even
      // though Firebase Auth itself just accepted the password — sign them
      // straight back out and tell them why.
      const restriction = await getAccountRestriction(credential.user.uid);

      if (restriction) {
        await signOut(auth);

        const statusWord =
          restriction.status === "blocked"
            ? t("auth.statusWordBlocked")
            : t("auth.statusWordSuspended");

        Alert.alert(
          restriction.status === "blocked"
            ? t("auth.accountBlocked")
            : t("auth.accountSuspended"),
          restriction.reason
            ? t("auth.blockedByAdmin", {
                status: statusWord,
                reason: restriction.reason,
              })
            : t("auth.blockedByAdminNoReason", { status: statusWord }),
        );
        return;
      }

      // Never trust the role toggled in the UI as a PERMISSION — always read
      // the SIGNED-IN user's own users/{uid} doc and check its real `role`
      // field before allowing entry to admin pages. The toggle only ever
      // expresses which experience the user wants to log into.
      const admin = await isUserAdmin(credential.user);

      if (role === "admin") {
        if (!admin) {
          Alert.alert(t("auth.accessDenied"), t("auth.notAdmin"));
          return;
        }

        router.replace("/admin" as any);
      } else {
        router.replace("/(tabs)/home" as any);
      }
    } catch (error: any) {
      Alert.alert(t("auth.loginFailed"), t("auth.invalidCredentials"));
    }
  };

  if (loading) {
    // Responsive, proportion-based sizing (capped so it doesn't get huge on
    // tablets) instead of one fixed pixel size for every screen width.
    const logoSize = Math.min(220, windowWidth * 0.5);
    // Source wordmark art is 300x107 — derive height from width so it's
    // never stretched/distorted at any screen size.
    const wordmarkWidth = Math.min(190, windowWidth * 0.42);
    const wordmarkHeight = wordmarkWidth * (107 / 300);

    return (
      <DirectionalScreen style={styles.splash}>
        <Image
          source={require("../assets/images/map-pin-icon.png")}
          style={{ width: logoSize, height: logoSize, marginBottom: 12 }}
          resizeMode="contain"
        />
        <Image
          source={require("../assets/images/takeme-wordmark.png")}
          style={{ width: wordmarkWidth, height: wordmarkHeight, marginBottom: 4 }}
          resizeMode="contain"
        />
        <Text style={styles.tagline}>{t("auth.tagline")}</Text>
        <ActivityIndicator size="large" color="#F58220" style={styles.loader} />
      </DirectionalScreen>
    );
  }

  return (
    <DirectionalScreen style={styles.pageSafe}>
      <Pressable
        style={[styles.languagePill, positionEnd(20, isRTL)]}
        onPress={() => setLanguageModalVisible(true)}
        hitSlop={8}
      >
        <Ionicons name="globe-outline" size={16} color="#7C5F46" />
        <Text style={styles.languagePillText}>{language.toUpperCase()}</Text>
      </Pressable>

      <KeyboardSafeScreen contentContainerStyle={styles.page}>
      <View style={styles.card}>
        <Text style={styles.title}>{t("auth.loginTitle")}</Text>
        <Text style={styles.subtitle}>{t("auth.welcomeBack")}</Text>

        <PhysicalDirectionalBlockText style={styles.label}>
          {t("auth.loginAs")}
        </PhysicalDirectionalBlockText>

        <View style={styles.roleRow}>
          <Pressable
            onPress={() => setRole("user")}
            style={[styles.roleBox, role === "user" && styles.activeRole]}
          >
            <Text
              style={[styles.roleIcon, role === "user" && styles.activeText]}
            >
              ♙
            </Text>
            <Text
              style={[styles.roleText, role === "user" && styles.activeText]}
            >
              {t("auth.user")}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setRole("admin")}
            style={[styles.roleBox, role === "admin" && styles.activeRole]}
          >
            <Text
              style={[styles.roleIcon, role === "admin" && styles.activeText]}
            >
              ♜
            </Text>
            <Text
              style={[styles.roleText, role === "admin" && styles.activeText]}
            >
              {t("auth.admin")}
            </Text>
          </Pressable>
        </View>

        <PhysicalDirectionalBlockText style={styles.label}>
          {t("auth.email")}
        </PhysicalDirectionalBlockText>
        <TextInput
          style={[
            styles.input,
            {
              textAlign: emailFieldIsRTL ? "right" : "left",
              writingDirection: emailFieldIsRTL ? "rtl" : "ltr",
            },
          ]}
          placeholder={t("auth.emailPlaceholder")}
          placeholderTextColor="#8b7b6b"
          keyboardType="email-address"
          autoCapitalize="none"
          value={email}
          onChangeText={setEmail}
        />

        <PhysicalDirectionalBlockText style={styles.label}>
          {t("auth.password")}
        </PhysicalDirectionalBlockText>
        <DirectionalRow style={styles.passwordRow}>
          <TextInput
            style={[
              styles.passwordInput,
              {
                textAlign: passwordFieldIsRTL ? "right" : "left",
                writingDirection: passwordFieldIsRTL ? "rtl" : "ltr",
              },
            ]}
            placeholder={t("auth.passwordPlaceholder")}
            placeholderTextColor="#8b7b6b"
            secureTextEntry={!showPw}
            value={password}
            onChangeText={setPassword}
          />
          <Pressable onPress={() => setShowPw(!showPw)}>
            <Text style={styles.eye}>
              {showPw ? t("auth.hide") : t("auth.show")}
            </Text>
          </Pressable>
        </DirectionalRow>

        <Pressable onPress={() => router.push("/login/forgot-password" as any)}>
          <PhysicalDirectionalBlockText style={styles.forgot}>
            {t("auth.forgotPassword")}
          </PhysicalDirectionalBlockText>
        </Pressable>

        <Pressable style={styles.loginButton} onPress={handleLogin}>
          <Text style={styles.loginText}>{t("auth.loginButton")}</Text>
        </Pressable>

        <Pressable onPress={() => router.push("/login/signup" as any)}>
          <Text style={styles.signupText}>
            {t("auth.noAccount")}{" "}
            <Text style={styles.signupLink}>{t("auth.signUp")}</Text>
          </Text>
        </Pressable>
      </View>
      </KeyboardSafeScreen>

      <LanguageSelectorModal
        visible={languageModalVisible}
        onClose={() => setLanguageModalVisible(false)}
      />
    </DirectionalScreen>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    // Very light beige/off-white — covers the full screen including the
    // safe-area insets, since SafeAreaView paints its own background there.
    backgroundColor: "#FFF9F2",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  // No frame/card/shadow prop here on purpose — RN's shadow* props on an
  // Image commonly render as a rectangular halo behind transparent PNGs,
  // which is exactly the "pasted/boxed" look to avoid. The map+pin artwork
  // already has its own soft ground shadow baked into the art.
  tagline: {
    color: "#8A6F58",
    marginTop: 10,
    fontSize: 16,
    fontWeight: "400",
    textAlign: "center",
  },
  loader: {
    marginTop: 30,
  },
  pageSafe: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  page: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 20,
  },
  languagePill: {
    position: "absolute",
    top: 55,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  languagePillText: {
    color: "#7C5F46",
    fontWeight: "800",
    fontSize: 12,
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
    marginBottom: 28,
    fontSize: 15,
  },
  label: {
    fontWeight: "800",
    color: "#111827",
    marginBottom: 10,
    marginTop: 14,
  },
  textRTL: {
    textAlign: "right",
    writingDirection: "rtl",
  },
  roleRow: {
    flexDirection: "row",
    gap: 14,
  },
  roleBox: {
    flex: 1,
    height: 98,
    borderWidth: 1.5,
    borderColor: "#E2D8CF",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  activeRole: {
    borderColor: "#F47C20",
    backgroundColor: "#FFF8F2",
  },
  roleIcon: {
    fontSize: 25,
    color: "#8B7B6B",
    marginBottom: 6,
  },
  roleText: {
    fontWeight: "900",
    color: "#111827",
  },
  activeText: {
    color: "#F47C20",
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
    // Passwords are opaque (secureTextEntry) but keep LTR entry — matches
    // the email field and avoids caret-direction weirdness while typing.
    textAlign: "left",
  },
  eye: {
    color: "#8B7B6B",
    fontWeight: "700",
  },
  forgot: {
    textAlign: "right",
    color: "#F47C20",
    marginTop: 14,
    fontWeight: "700",
  },
  loginButton: {
    backgroundColor: "#F58220",
    borderRadius: 12,
    padding: 16,
    marginTop: 22,
  },
  loginText: {
    color: "white",
    textAlign: "center",
    fontSize: 17,
    fontWeight: "900",
  },
  signupText: {
    textAlign: "center",
    marginTop: 20,
    color: "#7C5F46",
  },
  signupLink: {
    color: "#F47C20",
    fontWeight: "900",
  },
});
