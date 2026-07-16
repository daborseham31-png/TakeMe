// ---------------------------------------------------------------------------
// Reusable date/time/status display helpers. These only ever change how a
// value is DISPLAYED — the underlying Firestore timestamp/YYYY-MM-DD string
// and the stable status value ("pending", "cancelled", ...) are never
// touched. Do not save a formatted/translated string back to Firestore.
// ---------------------------------------------------------------------------

import type { TFunction } from "i18next";

import { SupportedLanguage } from "./languages";

const INTL_LOCALE: Record<SupportedLanguage, string> = {
  ar: "ar",
  en: "en-US",
  he: "he-IL",
};

// Forces the Gregorian calendar regardless of language — some ICU builds
// default "ar" to an Islamic calendar, but every date this app stores
// (tripDate, createdAt, ...) is already Gregorian; only the digits/month
// names/word order should localize, never the calendar system.
export function formatLocalizedDate(
  date: Date,
  language: SupportedLanguage,
): string {
  try {
    return new Intl.DateTimeFormat(INTL_LOCALE[language], {
      day: "numeric",
      month: "long",
      year: "numeric",
      calendar: "gregory",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function formatLocalizedTime(
  date: Date,
  language: SupportedLanguage,
): string {
  try {
    return new Intl.DateTimeFormat(INTL_LOCALE[language], {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

// Most screens store dates as a stable "YYYY-MM-DD" string (see
// normalizeDateToYMD in driver/create/driverHelpers.ts) rather than a Date —
// this formats that string for display without changing what's saved.
export function formatLocalizedDateFromYMD(
  ymd: string,
  language: SupportedLanguage,
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return ymd;

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return formatLocalizedDate(date, language);
}

// Translates a stable database status ("pending", "cancelled", "approved",
// ...) for DISPLAY only — the value saved to Firestore must always stay the
// English status string. Falls back to the raw status if a key is somehow
// missing, rather than showing a raw "namespace.status.key" string.
export function translateStatus(
  t: TFunction,
  namespace: "rides" | "bookings" | "driver",
  status: string | null | undefined,
): string {
  if (!status) return "";

  const key = `${namespace}.status.${status}`;
  const translated = t(key);
  return translated === key ? status : translated;
}
