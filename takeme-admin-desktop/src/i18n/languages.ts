// ---------------------------------------------------------------------------
// The ONE place the app's supported UI languages are defined. Every other
// file (i18n init, the language selector, RTL helpers, city-name display)
// imports from here — never redeclare this list elsewhere.
// ---------------------------------------------------------------------------

export type SupportedLanguage = "ar" | "en" | "he" | "ru";

export type LanguageDirection = "rtl" | "ltr";

export type LanguageDefinition = {
  code: SupportedLanguage;
  nativeName: string;
  direction: LanguageDirection;
};

export const SUPPORTED_LANGUAGES: LanguageDefinition[] = [
  { code: "ar", nativeName: "العربية", direction: "rtl" },
  { code: "en", nativeName: "English", direction: "ltr" },
  { code: "he", nativeName: "עברית", direction: "rtl" },
  { code: "ru", nativeName: "Русский", direction: "ltr" },
];

export const DEFAULT_LANGUAGE: SupportedLanguage = "en";

export const isSupportedLanguage = (
  value: string | null | undefined,
): value is SupportedLanguage =>
  SUPPORTED_LANGUAGES.some((lang) => lang.code === value);

export const getLanguageDefinition = (
  code: SupportedLanguage,
): LanguageDefinition =>
  SUPPORTED_LANGUAGES.find((lang) => lang.code === code) ??
  SUPPORTED_LANGUAGES[1];

export const isRTLLanguage = (code: SupportedLanguage): boolean =>
  getLanguageDefinition(code).direction === "rtl";
