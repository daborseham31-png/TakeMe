// ---------------------------------------------------------------------------
// The ONE guard every admin route passes through. Client-side route
// protection alone is never sufficient — real enforcement also lives in
// firestore.rules (see that file's comments) — but this stops a non-admin
// from ever rendering an admin screen in the first place, and redirects
// them straight back to Home.
// ---------------------------------------------------------------------------

import { onAuthStateChanged, signOut } from "firebase/auth";
import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Outlet } from "react-router-dom";

import { auth } from "../../firebase";
import { isUserAdmin } from "./adminAuthLib";
import { adminColors, adminRadius, adminSpacing } from "./adminTheme";
import { LoadingState } from "./components/AdminStates";
import { router } from "../router/expoRouterShim";

// Desktop note: the mobile app's non-admin branch redirects to the
// passenger/driver home tabs — a route that doesn't exist in this
// admin-only desktop app. There is nowhere else for a signed-in non-admin
// to go here, so this renders an inline access-denied message (reusing the
// same auth.accessDenied/auth.notAdmin copy the mobile login screen already
// shows) and signs them out, instead of routing to a screen that isn't built.
export default function AdminLayout() {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [denied, setDenied] = useState(false);

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
        await signOut(auth);
        if (active) {
          setChecking(false);
          setAllowed(false);
          setDenied(true);
        }
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

  if (denied) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: adminColors.page,
          alignItems: "center",
          justifyContent: "center",
          padding: adminSpacing.lg,
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: "900", color: adminColors.danger, marginBottom: 8 }}>
          {t("auth.accessDenied")}
        </Text>
        <Text style={{ color: adminColors.textMuted, marginBottom: adminSpacing.lg, textAlign: "center" }}>
          {t("auth.notAdmin")}
        </Text>
        <Pressable
          style={{
            backgroundColor: adminColors.primary,
            borderRadius: adminRadius.sm,
            paddingVertical: 12,
            paddingHorizontal: 24,
          }}
          onPress={() => router.replace("/")}
        >
          <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>{t("auth.backToLoginButton")}</Text>
        </Pressable>
      </View>
    );
  }

  // Redirect already triggered above (not signed in) — render nothing while it takes effect.
  if (!allowed) {
    return <View style={{ flex: 1, backgroundColor: adminColors.page }} />;
  }

  return <Outlet />;
}
