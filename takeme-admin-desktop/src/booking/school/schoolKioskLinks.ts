// ---------------------------------------------------------------------------
// School Kiosk URL builder — the ONE place in the app that turns a school's
// stable schoolId into a full kiosk link. Reuses the SAME
// EXPO_PUBLIC_BACKEND_URL env var already used by app/login/idVerificationLib.ts
// and app/booking/school/schoolChildrenLib.ts for calls to this exact deployed
// Cloudflare Worker — never a second, hardcoded copy of that URL anywhere else
// (see cloudflare-worker/public/school-kiosk/ for the page itself, and
// cloudflare-worker/src/schoolKiosk.ts for the backend it calls).
// ---------------------------------------------------------------------------

const RAW_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";

// Trailing slash(es) stripped once, here, so every caller can safely do
// `${KIOSK_BACKEND_URL}/path` without ever risking a doubled "//".
const KIOSK_BACKEND_URL = RAW_BACKEND_URL.replace(/\/+$/, "");

export const SCHOOL_KIOSK_PATH = "/school-kiosk/";

// Builds `{workerBaseUrl}/school-kiosk/?schoolId={encodedSchoolId}` for a
// real, stable schoolId (see app/booking/schools.ts's SchoolLocation.id).
// Returns null when either input is unusable — never a broken/partial URL —
// so every call site can render an explicit "not configured" state instead
// of a dead link.
export function buildSchoolKioskUrl(schoolId: string): string | null {
  const trimmedSchoolId = schoolId.trim();
  if (!KIOSK_BACKEND_URL || !trimmedSchoolId) return null;

  return `${KIOSK_BACKEND_URL}${SCHOOL_KIOSK_PATH}?schoolId=${encodeURIComponent(trimmedSchoolId)}`;
}

// Whether the backend URL needed to build any kiosk link is configured at
// all — lets a caller show one clear "not configured" state up front instead
// of a null link per row.
export function isSchoolKioskBackendConfigured(): boolean {
  return !!KIOSK_BACKEND_URL;
}

// Safety gate for "Open Kiosk": only ever open an https:// URL with no
// whitespace/control characters — this always passes for a URL this file
// itself generated, and exists so a future change to this file (or a bad
// value slipping in some other way) can never result in opening a
// malformed or non-HTTPS URL.
export function isSafeHttpsKioskUrl(url: string): boolean {
  return /^https:\/\/\S+$/.test(url);
}
