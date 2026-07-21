import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

// Registers the background location TaskManager task (TaskManager.defineTask
// must run at module/top-level scope) — imported once here purely for its
// side effect, regardless of which screen is currently mounted. See
// app/driverLocationTask.ts.
import "./driverLocationTask";
import { LanguageProvider, useLanguage } from "./i18n/LanguageProvider";

// Blocks the very first render until the saved/detected app language has
// finished loading — this is what prevents English text from flashing
// before Arabic or Hebrew is ready.
function LanguageGate({ children }: { children: React.ReactNode }) {
  const { ready } = useLanguage();

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <LanguageProvider>
      <LanguageGate>
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
});
