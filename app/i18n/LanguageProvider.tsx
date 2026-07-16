// ---------------------------------------------------------------------------
// The ONE global language provider for the whole app. Mounted once in
// app/_layout.tsx, above everything else — screens must never call initI18n
// or resolveInitialLanguage themselves, only useLanguage()/useTranslation().
// ---------------------------------------------------------------------------

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { I18nManager } from "react-native";
import { useTranslation } from "react-i18next";

import {
  initI18n,
  persistLanguage,
  resolveInitialLanguage,
} from "./index";
import { isRTLLanguage, SupportedLanguage } from "./languages";

type SetLanguageResult = "applied" | "restart-required";

type LanguageContextValue = {
  language: SupportedLanguage;
  isRTL: boolean;
  ready: boolean;
  setLanguage: (language: SupportedLanguage) => Promise<SetLanguageResult>;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [language, setLanguageState] = useState<SupportedLanguage>("en");
  const { i18n } = useTranslation();

  // Runs exactly once, before anything else renders — this is the "small
  // initialization/loading state" that prevents English text from flashing
  // before the saved/detected Arabic or Hebrew loads.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const resolved = await resolveInitialLanguage();
      await initI18n(resolved);

      // First-run native RTL alignment — silent (no restart prompt): from
      // the user's perspective nothing is "changing" yet, this is just the
      // app starting up in the language it already resolved to.
      const shouldBeRTL = isRTLLanguage(resolved);
      if (I18nManager.isRTL !== shouldBeRTL) {
        I18nManager.allowRTL(shouldBeRTL);
        I18nManager.forceRTL(shouldBeRTL);
      }

      if (!cancelled) {
        setLanguageState(resolved);
        setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const setLanguage = useCallback(
    async (next: SupportedLanguage): Promise<SetLanguageResult> => {
      if (next === language) return "applied";

      const wasRTL = I18nManager.isRTL;
      const nextIsRTL = isRTLLanguage(next);

      // i18n.changeLanguage is only ever called here, once per explicit user
      // action — never in a render or effect that could loop.
      await i18n.changeLanguage(next);
      await persistLanguage(next);
      setLanguageState(next);

      if (wasRTL === nextIsRTL) {
        return "applied";
      }

      // Native primitives (system-level default text alignment, row
      // mirroring baked into some native components) only fully apply after
      // the app restarts. Every screen's own layout already reacts to
      // `isRTL` immediately below — only this OS-level mirroring needs the
      // caller to show a translated restart confirmation.
      I18nManager.allowRTL(nextIsRTL);
      I18nManager.forceRTL(nextIsRTL);
      return "restart-required";
    },
    [language, i18n],
  );

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      isRTL: isRTLLanguage(language),
      ready,
      setLanguage,
    }),
    [language, ready, setLanguage],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return ctx;
}
