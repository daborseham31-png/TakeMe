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
  ru: "ru-RU",
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

// Deliberately NOT Intl.DateTimeFormat — some ICU builds render "ar" hour/
// minute digits as Arabic-Indic (٠١٢...), which this app must never show or
// save (see app/i18n/digits.ts). Manual padStart formatting always produces
// plain Western digits regardless of `language`, exactly like every other
// time value in the app (see InfiniteTimeWheelPicker / TimeInput).
export function formatLocalizedTime(
  date: Date,
  _language: SupportedLanguage,
): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
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

// Weekly bookings store a resolved English day name ("Sunday", ...) on the
// record itself (see DAY_KEY_LABEL in weeklyBookingLib.ts) — that stored
// value is never touched (same "translate only at display" rule as status
// values), this only maps it to the matching translated word for display.
const FULL_DAY_NAME_TO_SHORT_KEY: Record<string, string> = {
  Sunday: "Sun",
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
};

export function translateStoredDayName(
  name: string | null | undefined,
  t: TFunction,
): string {
  if (!name) return "";

  const shortKey = FULL_DAY_NAME_TO_SHORT_KEY[name];
  if (!shortKey) return name;

  return t(`booking.days.${shortKey}`, { defaultValue: name });
}

// Roadside Help stores the passenger-picked problem titles as stable English
// text (see PROBLEM_LABELS in roadside-help/roadsideLib.ts) — that stored
// value is never touched, this only maps each title to its translated word
// for display.
const PROBLEM_TITLE_TO_KEY: Record<string, string> = {
  "Flat Tire": "flat",
  "Dead Battery": "battery",
  "Out of Fuel": "fuel",
  Towing: "towing",
  Other: "other",
};

export function translateProblemType(
  title: string | null | undefined,
  t: TFunction,
): string {
  if (!title) return "";

  const key = PROBLEM_TITLE_TO_KEY[title];
  if (!key) return title;

  return t(`roadsideHelp.problems.${key}`, { defaultValue: title });
}

export function translateProblemTypesList(
  titles: string[] | null | undefined,
  t: TFunction,
): string {
  if (!titles || titles.length === 0) return "";

  return titles.map((title) => translateProblemType(title, t)).join(", ");
}

// Category metadata (CATEGORY_META in bookingsLib.ts) stores its English
// label alongside icon/color — that object is a display-only constant, not
// stored data, but is shared by several screens so the mapping lives here
// once. Falls back to the fixed English label from CATEGORY_META for any
// category without a dedicated translation key.
const CATEGORY_LABEL_KEY: Record<string, string> = {
  school: "rideCategory.categories.school.title",
  personal: "rideCategory.categories.personal.title",
  personal_ride: "rideCategory.categories.personal.title",
  delivery: "booking.categoryLabels.delivery",
  errands: "booking.categoryLabels.errands",
  workErrands: "booking.categoryLabels.workErrands",
  roadside: "booking.categoryLabels.roadside",
};

export function translateCategoryLabel(
  category: string | null | undefined,
  fallbackLabel: string,
  t: TFunction,
): string {
  const key = CATEGORY_LABEL_KEY[category || ""];
  if (!key) return fallbackLabel;

  return t(key, { defaultValue: fallbackLabel });
}

// Admin reports store a stable English category ("user", "driver", "ride",
// "booking", "payment", "other") — display-only translation, never saved back.
export function translateReportCategory(
  category: string | null | undefined,
  t: TFunction,
): string {
  if (!category) return "";

  return t(`admin.reportCategory.${category}`, { defaultValue: category });
}

// Admin-only display helpers — the underlying accountStatus/
// driverVerificationStatus/role fields stored on users/{uid} are never
// touched, only how they're shown in the Admin screens.
export function translateAccountStatus(
  status: string | null | undefined,
  t: TFunction,
): string {
  if (!status) return "";

  return t(`admin.accountStatus.${status}`, { defaultValue: status });
}

export function translateDriverVerificationStatus(
  status: string | null | undefined,
  t: TFunction,
): string {
  if (!status) return t("admin.driverVerificationStatus.unknown");

  return t(`admin.driverVerificationStatus.${status}`, { defaultValue: status });
}

export function translateUserRole(
  role: string | null | undefined,
  t: TFunction,
): string {
  if (!role) return t("admin.userRole.unknown");

  return t(`admin.userRole.${role}`, { defaultValue: role });
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
