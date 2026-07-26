// ---------------------------------------------------------------------------
// The ONE global language provider for the whole app. Mounted once in
// app/_layout.tsx, above everything else — screens must never call initI18n
// or resolveInitialLanguage themselves, only useLanguage()/useTranslation().
// ---------------------------------------------------------------------------

import Constants, { ExecutionEnvironment } from "expo-constants";
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

// Expo Go hosts the JS runtime inside a persistent shared native container
// (see this project's own RTL runtime diagnosis) — no JS-callable reload can
// recreate it, so I18nManager.forceRTL's native mirroring never actually
// applies there no matter what. A development build or standalone build has
// its own dedicated native root instead, where a reload has a real chance of
// fully applying it. Constants.executionEnvironment (not the deprecated
// Constants.appOwnership) is the current, non-deprecated way to tell these
// apart — already available via expo-constants, no new dependency.
function isRunningInExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

// "applied": the visible direction is already fully correct via the
// JS-controlled architecture (DirectionalScreen/DirectionalCard/etc. — see
// i18n/rtl.ts) — never prompt for anything, in Expo Go or otherwise.
// "restart-available": Expo Go was NOT detected (a dev/standalone build),
// so restarting MAY additionally sync a few native-only primitives — this
// is always an optional offer, never mandatory, since the UI is already
// visually correct either way.
type SetLanguageResult = "applied" | "restart-available";

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

      // Dev-safe diagnostic ONLY: language code + two booleans. Never a
      // user id, token, booking value, or any other private data. This is
      // the one log that shows, on a real device, whether the NATIVE
      // I18nManager.isRTL flag a previous session already forced actually
      // survived into this fresh JS/native process — the key question when
      // "the direction still looks wrong after reloading".
      console.log("RTL_STARTUP_STATE", {
        language: resolved,
        requestedIsRTL: shouldBeRTL,
        isRTLNow: I18nManager.isRTL,
      });

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

      // Dev-safe diagnostics ONLY, throughout this function: a language
      // code and plain booleans. Never a user id, token, booking value,
      // phone number, or any code.
      console.log("RTL_LANGUAGE_SELECTED", { language: next });

      const wasRTL = I18nManager.isRTL;
      const nextIsRTL = isRTLLanguage(next);

      console.log("RTL_BEFORE_CHANGE", {
        language: next,
        isRTLNow: wasRTL,
        requestedIsRTL: nextIsRTL,
      });

      // i18n.changeLanguage is only ever called here, once per explicit user
      // action — never in a render or effect that could loop.
      await i18n.changeLanguage(next);
      const persisted = await persistLanguage(next);
      setLanguageState(next);

      if (wasRTL === nextIsRTL) {
        console.log("RTL_RELOAD_REQUESTED", {
          language: next,
          persistenceCompleted: persisted,
          reloadRequested: false,
        });
        return "applied";
      }

      // Still keep the native flag eventually-consistent — harmless, and
      // it's the "optional enhancement" a future dev/standalone build can
      // benefit from (see this file's header) — but NEVER what visible
      // correctness depends on: every DirectionalScreen/DirectionalCard/etc.
      // already reacts to `isRTL` immediately, with no restart of any kind.
      I18nManager.allowRTL(nextIsRTL);
      I18nManager.forceRTL(nextIsRTL);

      console.log("RTL_FORCE_REQUESTED", {
        language: next,
        requestedIsRTL: nextIsRTL,
        isRTLNow: I18nManager.isRTL,
      });

      // Expo Go: never offer a restart at all — reloadAppAsync() cannot
      // recreate Expo Go's shared native container (see this project's own
      // RTL diagnosis), so it would accomplish nothing for native mirroring
      // while the JS-controlled UI is already fully correct without it.
      // Only a genuine dev/standalone build ever gets offered the OPTIONAL
      // restart below.
      const offerRestart = !isRunningInExpoGo();

      console.log("RTL_RELOAD_REQUESTED", {
        language: next,
        persistenceCompleted: persisted,
        reloadRequested: offerRestart,
      });

      return offerRestart ? "restart-available" : "applied";
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

  // Dev-safe diagnostic ONLY — the exact isRTL value every screen's
  // useLanguage() call actually receives, logged once per real change. This
  // is deliberately a separate effect (not inline in the useMemo above) so
  // it only ever runs after commit, never twice for the same value under
  // React's render-phase double-invocation.
  useEffect(() => {
    if (!ready) return;
    console.log("RTL_PROVIDER_STATE", { language, isRTL: isRTLLanguage(language) });
  }, [language, ready]);

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
