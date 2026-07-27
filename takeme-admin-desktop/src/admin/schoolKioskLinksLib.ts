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
  // null only when EXPO_PUBLIC_BACKEND_URL isn't configured in this build —
  // never a broken/partial URL (see buildSchoolKioskUrl).
  kioskUrl: string | null;
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
      kioskUrl: buildSchoolKioskUrl(school.id),
    });
  }

  return rows.sort((a, b) => {
    const cityCompare = a.city.localeCompare(b.city, language);
    if (cityCompare !== 0) return cityCompare;
    return a.name.localeCompare(b.name, language);
  });
}

// Case-insensitive match against name, city, or schoolId — schoolId is
// compared as a plain substring (it's numeric-looking but always a string;
// see SchoolLocation.id) rather than lower-cased, since digits have no case,
// but included here for a single obvious search implementation over all
// three fields at once.
export function filterSchoolKioskLinkRows(
  rows: SchoolKioskLinkRow[],
  searchText: string,
): SchoolKioskLinkRow[] {
  const needle = searchText.trim().toLowerCase();
  if (!needle) return rows;

  return rows.filter(
    (row) =>
      row.name.toLowerCase().includes(needle) ||
      row.city.toLowerCase().includes(needle) ||
      row.schoolId.toLowerCase().includes(needle),
  );
}
