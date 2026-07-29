// ---------------------------------------------------------------------------
// Desktop-only compatibility shims for the two native-module calls
// i18n/index.ts makes (@react-native-async-storage/async-storage's
// getItem/setItem, and expo-localization's getLocales()). Both packages are
// built around Expo's native module system, which needs the Expo/Metro
// toolchain to resolve their web builds correctly — outside that toolchain
// (a plain Vite + Electron renderer), they don't reliably resolve. Since the
// only two things i18n/index.ts actually needs are "read/write one string
// key" and "read the OS/browser's preferred language", both are trivial to
// implement directly against the standard Web APIs Electron's renderer
// already provides (localStorage, navigator.language) — no other logic in
// i18n/index.ts changes.
// ---------------------------------------------------------------------------

export const webAsyncStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Best-effort, matches the original module's swallow-on-failure contract.
    }
  },
};

export const getWebLocales = (): { languageCode: string | null }[] => {
  const lang = typeof navigator !== "undefined" ? navigator.language : "";
  const code = (lang || "").split("-")[0] || null;
  return [{ languageCode: code }];
};
