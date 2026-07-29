// ---------------------------------------------------------------------------
// New file — top-level app shell. Mirrors app/_layout.tsx's LanguageGate
// pattern (block first render until the saved/detected language is ready,
// apply the JS-controlled RTL direction root) verbatim, just swapping
// expo-router's <Stack> for the new AppRouter (src/router/AppRouter.tsx).
// ---------------------------------------------------------------------------

import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { LanguageProvider, useLanguage } from "./i18n/LanguageProvider";
import AppRouter from "./router/AppRouter";

function LanguageGate({ children }: { children: React.ReactNode }) {
  const { ready, isRTL } = useLanguage();

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    );
  }

  return <View style={[styles.root, { direction: isRTL ? "rtl" : "ltr" }]}>{children}</View>;
}

export default function App() {
  return (
    <LanguageProvider>
      <LanguageGate>
        <AppRouter />
      </LanguageGate>
    </LanguageProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    minHeight: "100vh" as any,
    backgroundColor: "#F28C28",
    alignItems: "center",
    justifyContent: "center",
  },
  root: {
    flex: 1,
    minHeight: "100vh" as any,
  },
});
