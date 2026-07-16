// ---------------------------------------------------------------------------
// Language detection, text normalization, and search for the Israeli
// locality dataset (israelLocations.ts). Shared by IsraelLocationAutocomplete
// and by anything that needs to resolve a saved location id back to display
// text — never duplicate this logic in a screen.
// ---------------------------------------------------------------------------

import * as Location from "expo-location";

import { SupportedLanguage } from "../i18n/languages";
import { IsraelLocation, ISRAEL_LOCATIONS } from "./israelLocations";

export type InputLanguage = "arabic" | "hebrew" | "english";

// Arabic block first — Arabic text can include Arabic-Indic digits etc, but
// the letter range alone is enough to tell it apart from Hebrew/Latin here.
export function detectInputLanguage(text: string): InputLanguage {
  if (/[؀-ۿ]/.test(text)) return "arabic";
  if (/[֐-׿]/.test(text)) return "hebrew";
  return "english";
}

// Arabic diacritics (tashkeel) + tatweel — stripped so "مُشهد" and "مشهد"
// match the same.
const ARABIC_DIACRITICS = /[ً-ْـ]/g;

// Hebrew niqqud (vowel points) — stripped the same way.
const HEBREW_NIQQUD = /[֑-ׇֽֿׁׂׅׄ]/g;

// Normalizes a string for matching, per language:
//  - English: lowercase + trim + collapse whitespace.
//  - Arabic: strip diacritics/tatweel, normalize alef/ya/ta-marbuta variants,
//    trim + collapse whitespace.
//  - Hebrew: strip niqqud, normalize final letters to their regular form,
//    trim + collapse whitespace.
export function normalizeLocationText(
  text: string,
  language?: InputLanguage,
): string {
  const raw = String(text || "");
  const lang = language || detectInputLanguage(raw);

  if (lang === "arabic") {
    return raw
      .replace(ARABIC_DIACRITICS, "")
      .replace(/[أإآا]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ة/g, "ه")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  if (lang === "hebrew") {
    return raw
      .replace(HEBREW_NIQQUD, "")
      .replace(/ך/g, "כ")
      .replace(/ם/g, "מ")
      .replace(/ן/g, "נ")
      .replace(/ף/g, "פ")
      .replace(/ץ/g, "צ")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

const nameForLanguage = (loc: IsraelLocation, lang: InputLanguage): string => {
  if (lang === "arabic") return loc.arabic;
  if (lang === "hebrew") return loc.hebrew;
  return loc.english;
};

export const MAX_LOCATION_RESULTS = 15;

// Starts-with matches first, then contains-matches, each group alphabetical
// by display name. Returns [] for empty/whitespace-only input rather than
// dumping the whole dataset — the caller decides whether to render "type to
// search" or the empty-state message in that case.
export function searchIsraelLocations(
  query: string,
  language?: InputLanguage,
): IsraelLocation[] {
  const trimmed = String(query || "").trim();
  if (!trimmed) return [];

  const lang = language || detectInputLanguage(trimmed);
  const needle = normalizeLocationText(trimmed, lang);
  if (!needle) return [];

  const starts: IsraelLocation[] = [];
  const contains: IsraelLocation[] = [];

  for (const loc of ISRAEL_LOCATIONS) {
    const name = nameForLanguage(loc, lang);
    const haystack = normalizeLocationText(name, lang);

    if (!haystack) continue;

    if (haystack.startsWith(needle)) {
      starts.push(loc);
    } else if (haystack.includes(needle)) {
      contains.push(loc);
    }
  }

  const byName = (a: IsraelLocation, b: IsraelLocation) =>
    nameForLanguage(a, lang).localeCompare(nameForLanguage(b, lang));

  return [...starts.sort(byName), ...contains.sort(byName)].slice(
    0,
    MAX_LOCATION_RESULTS,
  );
}

// Display name for a location in a given language — used to fill the field
// with a locale-appropriate string once a suggestion is picked, and to
// re-render a saved location back to text (e.g. driver bookings list).
export function getLocationDisplayName(
  loc: IsraelLocation,
  language: InputLanguage,
): string {
  return nameForLanguage(loc, language) || loc.english;
}

const APP_LANGUAGE_TO_INPUT_LANGUAGE: Record<SupportedLanguage, InputLanguage> = {
  ar: "arabic",
  en: "english",
  he: "hebrew",
};

// Same dataset, same stable IDs/coordinates — this only picks which of the
// three names already on IsraelLocation to display, based on the app's
// current UI language. Never creates a second copy of the city list, and
// never affects what gets saved for a ride (that stays the location's id +
// coordinates — see resolveLocationCoordinates below).
export function getLocalizedLocationName(
  loc: IsraelLocation,
  appLanguage: SupportedLanguage,
): string {
  return getLocationDisplayName(loc, APP_LANGUAGE_TO_INPUT_LANGUAGE[appLanguage]);
}

// ---------------------------------------------------------------------------
// Cross-language route matching — the ONE helper every from/to comparison in
// the app must go through (driver search, weekly matching, the Home feed).
// A driver posting "المشهد" and a passenger searching "Mashhad" must match:
// never compare the raw displayed strings directly.
// ---------------------------------------------------------------------------

export type LocationNames = {
  english?: string | null;
  arabic?: string | null;
  hebrew?: string | null;
};

// Stable-id match wins whenever both sides have one (true regardless of
// which language each side is displayed in). Falls back to comparing every
// known multilingual name across both sides for documents saved before
// location ids existed — if neither side has any usable text either, this
// correctly returns false (there's nothing to compare).
export function sameLocation(
  aId: string | null | undefined,
  bId: string | null | undefined,
  aText: string | null | undefined,
  bText: string | null | undefined,
  aNames?: LocationNames | null,
  bNames?: LocationNames | null,
): boolean {
  if (aId && bId) {
    return aId === bId;
  }

  const candidatesA = [aText, aNames?.english, aNames?.arabic, aNames?.hebrew]
    .filter((value): value is string => !!value)
    .map((value) => normalizeLocationText(value));

  const candidatesB = [bText, bNames?.english, bNames?.arabic, bNames?.hebrew]
    .filter((value): value is string => !!value)
    .map((value) => normalizeLocationText(value));

  return candidatesA.some((value) => candidatesB.includes(value));
}

// ---------------------------------------------------------------------------
// Origin coordinates for a ride/job/errand at CREATION time — the ONE place
// every "save the starting-location coordinates" call in the app goes
// through, so a ride is never geocoded more than once (never re-run when
// Home loads).
// ---------------------------------------------------------------------------

export type ResolvedCoords = { latitude: number; longitude: number } | null;

// Prefers the curated dataset's own coordinates for the selected locality
// (instant, free, no network — see israelLocations.ts) and only falls back
// to a live geocode of the typed text when that locality doesn't have them
// yet. Failures (offline, no match) simply return null — the caller must
// still save the ride without coordinates rather than blocking creation.
export async function resolveLocationCoordinates(
  place: IsraelLocation | null,
  fallbackText: string,
): Promise<ResolvedCoords> {
  if (place && typeof place.latitude === "number" && typeof place.longitude === "number") {
    return { latitude: place.latitude, longitude: place.longitude };
  }

  const trimmed = fallbackText.trim();
  if (!trimmed) return null;

  try {
    const [geo] = await Location.geocodeAsync(trimmed);
    if (geo) {
      return { latitude: geo.latitude, longitude: geo.longitude };
    }
  } catch {
    // Offline or no geocoding match — the ride still saves, just without
    // coordinates, and shows up in "All rides" instead of "Nearby".
  }

  return null;
}
