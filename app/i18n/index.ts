// ---------------------------------------------------------------------------
// i18next is initialized exactly ONCE here, with the fully-resolved language
// already known (see resolveInitialLanguage) — never inside an individual
// screen, and never with a placeholder language that would flash before the
// real one loads. The only caller of initI18n/resolveInitialLanguage is
// LanguageProvider (./LanguageProvider.tsx).
// ---------------------------------------------------------------------------

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import {
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  SupportedLanguage,
} from "./languages";
import ar from "./locales/ar.json";
import en from "./locales/en.json";
import he from "./locales/he.json";
import ru from "./locales/ru.json";

// Local-only preference. Deliberately NOT sensitive information (just a
// 2-letter language code) — safe to keep in plain AsyncStorage.
export const LANGUAGE_STORAGE_KEY = "takeMe.appLanguage";

const resources = {
  ar: { translation: ar },
  en: { translation: en },
  he: { translation: he },
  ru: { translation: ru },
};

// Any phone language TakeMe doesn't ship a translation for falls back to
// English, per spec. "iw" is the legacy ISO 639-1 code some platforms still
// report for Hebrew instead of "he".
function detectPhoneLanguage(): SupportedLanguage {
  try {
    const code = Localization.getLocales()?.[0]?.languageCode;
    if (code === "ar") return "ar";
    if (code === "he" || code === "iw") return "he";
    if (code === "en") return "en";
    if (code === "ru") return "ru";
    return DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

// Resolution priority: language explicitly saved on this device > detected
// phone language > English fallback. (Firebase preferredLanguage is
// intentionally not part of this chain — see LanguageProvider for why.)
export async function resolveInitialLanguage(): Promise<SupportedLanguage> {
  try {
    const saved = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isSupportedLanguage(saved)) {
      return saved;
    }
  } catch {
    // AsyncStorage unavailable for some reason — fall through to detection.
  }

  const detected = detectPhoneLanguage();

  try {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, detected);
  } catch {
    // Non-fatal — the resolved language still applies for this session even
    // if it can't be persisted (e.g. storage full).
  }

  return detected;
}

let initialized = false;

export async function initI18n(language: SupportedLanguage): Promise<void> {
  if (initialized) {
    if (i18next.language !== language) {
      await i18next.changeLanguage(language);
    }
    return;
  }

  initialized = true;

  await i18next.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: DEFAULT_LANGUAGE,
    interpolation: { escapeValue: false },
    returnEmptyString: false,
  });
}

// Returns whether the write actually completed — used only for the
// RTL_RELOAD_REQUESTED diagnostic in LanguageProvider.tsx so a real device
// log can distinguish "direction change requested after a confirmed save"
// from "requested even though persistence silently failed" (still safe
// either way for the CURRENT session — see the catch below — but worth
// seeing on a real device while diagnosing a report that RTL isn't sticking).
export async function persistLanguage(
  language: SupportedLanguage,
): Promise<boolean> {
  try {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    return true;
  } catch {
    // Best-effort — the change still applies for the current session.
    return false;
  }
}

export default i18next;
