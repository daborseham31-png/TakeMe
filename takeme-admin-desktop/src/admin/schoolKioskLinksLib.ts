// ---------------------------------------------------------------------------
// School Kiosk Links — admin data layer. Reads ONLY the app's existing
// static, real school dataset (app/booking/schools.ts — Ministry of
// Education data, the same source the booking flow's school pickers already
// use) to build one row per school with its kiosk link. Never reads
// schoolChildren, rideRequests, schoolBookings, or any user/parent/driver
// collection — this is a pure, local, read-only mapping over already-loaded
// static data, so it needs no Firestore listener/subscription at all.
// ---------------------------------------------------------------------------

import { SupportedLanguage } from "../i18n/languages";
import {
  getLocalizedSchoolCity,
  getLocalizedSchoolName,
  SCHOOLS,
  SchoolLocation,
} from "../booking/schools";
import { buildSchoolKioskUrl } from "../booking/school/schoolKioskLinks";

export type SchoolKioskLinkRow = {
  // The school's own stable, real schoolId (SchoolLocation.id) — always a
  // string, so a value with leading zeroes is never silently coerced to a
  // number and truncated.
  schoolId: string;
  name: string;
  city: string;
  // The school's own area/locality id (SchoolLocation.areaLocationId) — the
  // real grouping key for the "School Area" filter below; `city` is only
  // ever that area's own localized DISPLAY text, never compared directly
  // (two differently-spelled/localized areas must never collide).
  areaLocationId: string;
  // null only when EXPO_PUBLIC_BACKEND_URL isn't configured in this build —
  // never a broken/partial URL (see buildSchoolKioskUrl).
  kioskUrl: string | null;
};

// One option per distinct area that actually has at least one school in the
// dataset (never every locality in israelLocations.ts — only ones real
// schools exist in), labeled with that area's own localized display text.
export type SchoolAreaOption = {
  areaLocationId: string;
  label: string;
};

// Deduplicates by schoolId (SCHOOLS is real Ministry-of-Education data and
// should not contain duplicate institution codes, but this is a cheap,
// explicit guarantee rather than an assumption — see the task's own
// requirement that duplicate schoolIds must never produce duplicate rows),
// then sorts by city, then by school name — both using the SAME localized
// display text this function returns, so the on-screen order always matches
// what's actually rendered in the currently active language.
export function getSchoolKioskLinkRows(language: SupportedLanguage): SchoolKioskLinkRow[] {
  const seenSchoolIds = new Set<string>();
  const rows: SchoolKioskLinkRow[] = [];

  for (const school of SCHOOLS as SchoolLocation[]) {
    if (seenSchoolIds.has(school.id)) continue;
    seenSchoolIds.add(school.id);

    rows.push({
      schoolId: school.id,
      name: getLocalizedSchoolName(school, language),
      city: getLocalizedSchoolCity(school, language),
      areaLocationId: school.areaLocationId,
      kioskUrl: buildSchoolKioskUrl(school.id),
    });
  }

  return rows.sort((a, b) => {
    const cityCompare = a.city.localeCompare(b.city, language);
    if (cityCompare !== 0) return cityCompare;
    return a.name.localeCompare(b.name, language);
  });
}

// Distinct areas present in `rows` (already built by getSchoolKioskLinkRows
// above, so this never re-reads the raw SCHOOLS dataset itself), sorted by
// each area's own localized label. First-seen label per areaLocationId wins
// — every row for the same area already carries the identical localized
// city text, so there is nothing to disambiguate.
export function getSchoolAreaOptions(rows: SchoolKioskLinkRow[]): SchoolAreaOption[] {
  const labelByAreaId = new Map<string, string>();

  for (const row of rows) {
    if (!labelByAreaId.has(row.areaLocationId)) {
      labelByAreaId.set(row.areaLocationId, row.city);
    }
  }

  return Array.from(labelByAreaId.entries())
    .map(([areaLocationId, label]) => ({ areaLocationId, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// Capped so a single typed prefix (e.g. one letter) never dumps dozens of
// matches into the School Area autocomplete's dropdown at once — the caller
// still wraps the result in a scrollable container, but there is no reason
// to ever hand it more than a small, reasonable page of matches. Returns
// nothing at all for blank input: this is only ever called once the admin
// has actually started typing (see school-kiosk-links.tsx's showAreaDropdown
// gate) — the full area list must never render on its own.
const MAX_AREA_SUGGESTIONS = 8;

export function filterSchoolAreaOptions(
  options: SchoolAreaOption[],
  searchText: string,
): SchoolAreaOption[] {
  const needle = searchText.trim().toLowerCase();
  if (!needle) return [];

  return options
    .filter((option) => option.label.toLowerCase().includes(needle))
    .slice(0, MAX_AREA_SUGGESTIONS);
}

// The two-field filter (School Area select + School Name search) — area is
// an exact match against areaLocationId (never the display text, which can
// legitimately repeat/collide across locales); name is a case-insensitive
// PARTIAL match against the school's own localized name only (never city or
// schoolId — those are no longer text-search targets now that area has its
// own dedicated selector). `areaLocationId: null` (or omitted) means "All
// Areas" — every row is eligible before the name filter narrows it further.
export function filterSchoolKioskLinkRows(
  rows: SchoolKioskLinkRow[],
  filters: { areaLocationId?: string | null; searchText?: string },
): SchoolKioskLinkRow[] {
  const areaId = filters.areaLocationId || null;
  const needle = (filters.searchText || "").trim().toLowerCase();

  return rows.filter((row) => {
    if (areaId && row.areaLocationId !== areaId) return false;
    if (needle && !row.name.toLowerCase().includes(needle)) return false;
    return true;
  });
}
