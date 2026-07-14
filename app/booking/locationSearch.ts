// ---------------------------------------------------------------------------
// Language detection, text normalization, and search for the Israeli
// locality dataset (israelLocations.ts). Shared by IsraelLocationAutocomplete
// and by anything that needs to resolve a saved location id back to display
// text — never duplicate this logic in a screen.
// ---------------------------------------------------------------------------

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
