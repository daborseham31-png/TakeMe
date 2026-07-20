// ---------------------------------------------------------------------------
// Push notification token registration (Expo SDK 54 — see
// https://docs.expo.dev/versions/v54.0.0/sdk/notifications/). This is the
// ONE place a push token is ever requested/stored — every "notify a user"
// call site in the app (see workErrandLib.ts's notify()) stays exactly as
// it was, writing a plain `notifications` Firestore doc; the actual push
// delivery is a separate concern handled entirely by
// functions/index.js's sendPushForNotification, which reads the token(s)
// this file stores on the user's own doc.
//
// Requires a real EAS project id in app.json (extra.eas.projectId) — this
// project doesn't have one checked in yet, so until `eas init` (or `eas
// build:configure`) is run once, registration below no-ops with a console
// warning instead of throwing. Push notifications on Android also require a
// development build — Expo Go does not support remote push there from
// SDK 53 onward.
// ---------------------------------------------------------------------------

import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { arrayUnion, doc, setDoc } from "firebase/firestore";
import { Platform } from "react-native";

import { db } from "../firebase";
import { SupportedLanguage } from "./i18n/languages";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const getProjectId = (): string | null => {
  return (
    (Constants?.expoConfig?.extra as any)?.eas?.projectId ??
    (Constants as any)?.easConfig?.projectId ??
    null
  );
};

// Called once per app session after the user is signed in (see
// app/_layout.tsx). Best-effort throughout — a user who denies the
// permission, or a build with no EAS project id yet, simply never gets a
// token stored, and never receives a push; the in-app notification (which
// this never touches) still works either way.
export const registerForPushNotificationsAsync = async (
  uid: string,
  language: SupportedLanguage,
): Promise<void> => {
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Default notifications",
        importance: Notifications.AndroidImportance.MAX,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;

    if (status !== "granted") {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }

    if (status !== "granted") return;

    const projectId = getProjectId();
    if (!projectId) {
      console.warn(
        "Push notifications: no EAS project id configured (app.json extra.eas.projectId) — skipping token registration. Run `eas init` to enable push.",
      );
      return;
    }

    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token?.data) return;

    // arrayUnion so a user signed in on several devices keeps every token —
    // the send-push Cloud Function fans out to all of them. Mirrors the
    // current UI language onto the user's own doc too, since that's the
    // only server-readable signal of which language a notification meant
    // for this user should be rendered in (the in-app language picker only
    // ever persists locally — see LanguageProvider).
    await setDoc(
      doc(db, "users", uid),
      { expoPushTokens: arrayUnion(token.data), language },
      { merge: true },
    );
  } catch (error) {
    console.warn("Push notifications: registration failed", error);
  }
};
