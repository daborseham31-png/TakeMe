// ---------------------------------------------------------------------------
// The ONE guard every admin route passes through. Client-side route
// protection alone is never sufficient — real enforcement also lives in
// firestore.rules (see that file's comments) — but this stops a non-admin
// from ever rendering an admin screen in the first place, and redirects
// them straight back to Home.
// ---------------------------------------------------------------------------

import { Stack, router } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { auth } from "../../firebase";
import { isUserAdmin } from "./adminAuthLib";
import { adminColors } from "./adminTheme";
import { LoadingState } from "./components/AdminStates";

export default function AdminLayout() {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let active = true;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        if (active) {
          setChecking(false);
          setAllowed(false);
        }
        router.replace("/");
        return;
      }

      const admin = await isUserAdmin(user);
      if (!active) return;

      if (!admin) {
        setChecking(false);
        setAllowed(false);
        router.replace("/(tabs)/home" as any);
        return;
      }

      setAllowed(true);
      setChecking(false);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (checking) {
    return (
      <View style={{ flex: 1, backgroundColor: adminColors.page, justifyContent: "center" }}>
        <LoadingState label={t("admin.checkingAdminAccess")} />
      </View>
    );
  }

  // Redirect already triggered above — render nothing while it takes effect.
  if (!allowed) {
    return <View style={{ flex: 1, backgroundColor: adminColors.page }} />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
