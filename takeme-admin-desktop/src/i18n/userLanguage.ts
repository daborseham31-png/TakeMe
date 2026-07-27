// ---------------------------------------------------------------------------
// Looks up another user's display language so a notification meant for THEM
// (e.g. "trip started") can be rendered in their language, not the current
// device's. The in-app language picker only persists locally (see
// LanguageProvider) — this reads the same value mirrored onto the user's own
// Firestore doc by registerForPushNotificationsAsync (app/pushNotifications.ts),
// the one place that already writes there. Falls back to English when the
// field hasn't been mirrored yet (e.g. the user never opened the app since
// push registration was added).
// ---------------------------------------------------------------------------

import { doc, getDoc } from "firebase/firestore";

import { db } from "../../firebase";
import { isSupportedLanguage, SupportedLanguage } from "./languages";

export const getUserLanguage = async (uid: string): Promise<SupportedLanguage> => {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    const value = snap.exists() ? snap.data()?.language : null;
    return isSupportedLanguage(value) ? value : "en";
  } catch {
    return "en";
  }
};
