import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { ActivityIndicator, I18nManager, StyleSheet, View } from "react-native";

import { LanguageProvider, useLanguage } from "./i18n/LanguageProvider";
import { useGlobalNotificationRouting } from "./useGlobalNotificationRouting";

// Blocks the very first render until the saved/detected app language has
// finished loading — this is what prevents English text from flashing
// before Arabic or Hebrew is ready.
function LanguageGate({ children }: { children: React.ReactNode }) {
  const { ready, isRTL, language } = useLanguage();

  // Dev-safe diagnostic ONLY: language code + two booleans + one enum
  // string. Never private application data. Logged once per real direction
  // change (not every render) — this is the one log that directly answers
  // "what does the app actually look like right now", independent of
  // whatever I18nManager.isRTL happens to report.
  useEffect(() => {
    if (!ready) return;
    console.log("RTL_VISUAL_DIRECTION", {
      language,
      jsIsRTL: isRTL,
      nativeIsRTL: I18nManager.isRTL,
      visualDirection: isRTL ? "rtl" : "ltr",
    });
  }, [ready, isRTL, language]);

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    );
  }

  // The app-wide JS-controlled direction root (see i18n/rtl.ts's own header
  // comment on why this — not I18nManager — is what every screen's layout
  // now actually depends on). Per-screen containers (DirectionalScreen) and
  // every <Modal> still reassert this themselves, since neither an
  // expo-router native-stack screen boundary nor a Modal's separate native
  // surface reliably inherits a `direction` style set only here.
  //
  // IMPORTANT: this root direction CAN cascade into ordinary nested Views.
  // Anything that explicitly controls its own row order (DirectionalRow/
  // DirectionalHeader/directionalRowStyle) NEUTRALIZES this by resetting
  // `direction: "ltr"` on itself before applying its own explicit
  // flexDirection — never assume this root wrapper alone is "one more
  // mirroring layer" to stack an explicit reverse on top of; see those
  // components' own comments for why that double-applies and cancels out.
  return <View style={[styles.root, { direction: isRTL ? "rtl" : "ltr" }]}>{children}</View>;
}

// Registered once, for the whole app's process lifetime, at this root level
// — never per-screen — so a push tap routes correctly no matter which
// screen happens to be mounted when the app was foregrounded/backgrounded/
// launched. See useGlobalNotificationRouting.ts's own header.
function GlobalNotificationRouting() {
  useGlobalNotificationRouting();
  return null;
}

export default function RootLayout() {
  return (
    <LanguageProvider>
      <LanguageGate>
        <GlobalNotificationRouting />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="admin" />
          <Stack.Screen name="modal" />
        </Stack>

        <StatusBar style="auto" />
      </LanguageGate>
    </LanguageProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: "#F28C28",
    alignItems: "center",
    justifyContent: "center",
  },
  root: {
    flex: 1,
  },
});
