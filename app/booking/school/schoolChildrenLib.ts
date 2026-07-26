// ---------------------------------------------------------------------------
// School Child profiles — Phase 1 of the School Return Kiosk project (see
// AGENTS.md's kiosk audit). A durable, per-child identity that survives
// across bookings, dates, driver replacements, and parent-pickup decisions —
// something the existing schoolTripsLib.ts booking system never had (every
// "child" there is a session-scoped localId/name typed fresh each search).
//
// Deliberately its OWN file, not folded into the already-large
// schoolTripsLib.ts: this collection/lifecycle has nothing to do with trips,
// seats, or the driver-verification-code system, and reuses none of that
// file's transactions.
//
// IMPORTANT — two different codes, two different purposes, never shared:
//   - schoolTripsLib.ts's `verificationCode` belongs to one booking, is
//     checked by the DRIVER to start a trip, and can expire/change.
//   - This file's `returnCode` belongs permanently to the CHILD, is never
//     read by a driver or used to start a trip, and will only ever be read
//     by the future School Kiosk (a later phase — not built yet).
//
// SECURITY — permanent-code generation is SERVER-ONLY: a 6-digit code space
// (1,000,000 values) is small enough that an authenticated attacker could
// precompute the SHA-256 hash of every possible code offline, so a
// client-readable/writable uniqueness ledger would let them test which
// codes are already taken. Generating the code, hashing it, and reserving/
// releasing its ledger doc (schoolChildCodes) happens ONLY in the Cloudflare
// Worker's /school-children/create and /school-children/reset-code routes
// (cloudflare-worker/src/schoolChildren.ts), using a service account over
// the Firestore REST API — never in this file, and never in a Firebase
// Cloud Function (this project's Firebase plan is Spark, which cannot
// deploy Cloud Functions at all). This file never generates a code, never
// hashes one, and never reads/writes schoolChildCodes — see
// firestore.rules, which denies every client read/write on that collection
// outright.
// ---------------------------------------------------------------------------

import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { auth, db } from "../../../firebase";
import i18n from "../../i18n";

export const SCHOOL_CHILDREN_COLLECTION = "schoolChildren";

export interface SchoolChild {
  id: string;
  parentId: string;
  schoolId: string;
  // Stable-data snapshot taken at the moment the school/city was picked
  // (see SchoolAutocomplete.tsx/IsraelLocationAutocomplete.tsx) — never
  // re-derived from a localized display string. All four are OPTIONAL: a
  // profile created before this snapshot existed has only `schoolId` (see
  // this file's backward-compatibility notes in my-children.tsx, which
  // falls back to the current school dataset's own `areaLocationId` for
  // those older profiles).
  schoolName?: string;
  schoolCityId?: string;
  schoolCityName?: string;
  schoolAddress?: string;
  childName: string;
  // Plaintext — safe here ONLY because firestore.rules restricts reading this
  // document to `resource.data.parentId == request.auth.uid` (see
  // firestore.rules). Never copied onto any publicly/broadly-readable
  // document. Always written by the Cloudflare Worker (see this file's
  // header) — this file never sets it directly.
  returnCode: string;
  returnCodeHash: string;
  active: boolean;
  createdAtSeconds: number;
  updatedAtSeconds: number;
}

export const normalizeSchoolChild = (id: string, data: any): SchoolChild => ({
  id,
  parentId: data.parentId || "",
  schoolId: data.schoolId || "",
  schoolName: typeof data.schoolName === "string" && data.schoolName ? data.schoolName : undefined,
  schoolCityId: typeof data.schoolCityId === "string" && data.schoolCityId ? data.schoolCityId : undefined,
  schoolCityName:
    typeof data.schoolCityName === "string" && data.schoolCityName ? data.schoolCityName : undefined,
  schoolAddress:
    typeof data.schoolAddress === "string" && data.schoolAddress ? data.schoolAddress : undefined,
  childName: data.childName || "",
  returnCode: typeof data.returnCode === "string" ? data.returnCode : "",
  returnCodeHash: typeof data.returnCodeHash === "string" ? data.returnCodeHash : "",
  active: data.active !== false,
  createdAtSeconds: data.createdAt?.seconds || 0,
  updatedAtSeconds: data.updatedAt?.seconds || 0,
});

const schoolChildRef = (childId: string) => doc(db, SCHOOL_CHILDREN_COLLECTION, childId);

// ---------------------------------------------------------------------------
// Cloudflare Worker calls — createSchoolChildProfile / resetSchoolChildReturnCode.
// Same Worker (and same EXPO_PUBLIC_BACKEND_URL) as app/login/idVerificationLib.ts's
// ID-verification calls — see that file's header for how/where this env var
// is set. Both routes require a Firebase ID token; neither is reachable
// unauthenticated (see cloudflare-worker/src/index.ts).
// ---------------------------------------------------------------------------

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";

type CreateSchoolChildProfileResponse = {
  id: string;
  parentId: string;
  schoolId: string;
  schoolName?: string;
  schoolCityId?: string;
  schoolCityName?: string;
  schoolAddress?: string;
  childName: string;
  returnCode: string;
  active: boolean;
};

type ResetSchoolChildReturnCodeResponse = {
  id: string;
  returnCode: string;
};

// Maps the Worker's HTTP status back to a safe, translated, generic message
// — never the raw response body. The Worker's own error strings are already
// generic/safe (see cloudflare-worker/src/index.ts's structured errors), but
// this is a second, independent layer that never depends on that holding
// true, and keeps every message in the user's own language.
const ERROR_STATUS_KEYS: Record<number, string> = {
  400: "schoolChildren.invalidInput",
  401: "auth.pleaseLoginFirst",
  403: "schoolChildren.permissionDenied",
  404: "schoolChildren.childNotFound",
  429: "schoolChildren.genericError",
};

// Attaches the signed-in parent's own Firebase ID token as a Bearer header —
// the Worker derives `parentId` ONLY from this verified token server-side
// (see cloudflare-worker/src/firebaseAuth.ts), never from anything sent in
// the JSON body, so this file never sends its own uid as data either.
const postToSchoolChildrenEndpoint = async <T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> => {
  if (!BACKEND_URL) {
    throw new Error(i18n.t("errors.backendUrlNotSet"));
  }

  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t("auth.pleaseLoginFirst"));

  let idToken: string;
  try {
    idToken = await user.getIdToken();
  } catch {
    throw new Error(i18n.t("auth.pleaseLoginFirst"));
  }

  let response: Response;
  try {
    response = await fetch(`${BACKEND_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(i18n.t("errors.generic"));
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const key = ERROR_STATUS_KEYS[response.status];
    throw new Error(key ? i18n.t(key) : i18n.t("schoolChildren.genericError"));
  }

  return data as T;
};

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type CreateSchoolChildInput = {
  schoolId: string;
  childName: string;
  // Stable-data snapshot (see SchoolChild's own comment) — all optional so
  // an older caller sending only schoolId/childName keeps working; the
  // current my-children.tsx form always supplies all four once a real
  // city+school selection was made.
  schoolName?: string;
  schoolCityId?: string;
  schoolCityName?: string;
  schoolAddress?: string;
};

// Creates a School Child profile via the Worker's /school-children/create
// route — the client sends childName/schoolId (+ the optional stable-data
// snapshot) and never generates, sees a candidate, or writes the return
// code itself; the response carries back the server-generated code purely
// so THIS parent's own UI can display it once, immediately after creation
// (nothing else ever re-sends it — every later read comes from the
// parent's own subscribeMyChildren snapshot below, gated by
// firestore.rules).
export const createSchoolChild = async (
  input: CreateSchoolChildInput,
): Promise<string> => {
  const cleanName = input.childName.trim();
  if (!cleanName) throw new Error(i18n.t("schoolChildren.childNameRequired"));

  const cleanSchoolId = input.schoolId.trim();
  if (!cleanSchoolId) throw new Error(i18n.t("schoolChildren.schoolRequired"));

  const result = await postToSchoolChildrenEndpoint<CreateSchoolChildProfileResponse>(
    "/school-children/create",
    {
      childName: cleanName,
      schoolId: cleanSchoolId,
      schoolName: input.schoolName?.trim() || undefined,
      schoolCityId: input.schoolCityId?.trim() || undefined,
      schoolCityName: input.schoolCityName?.trim() || undefined,
      schoolAddress: input.schoolAddress?.trim() || undefined,
    },
  );

  return result.id;
};

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

// Every child profile owned by the signed-in parent — active AND inactive
// (the management screen needs both, to offer "restore"). Booking forms that
// only want bookable children should filter `.active` themselves (see
// DirectionSearchForm.tsx). This is a direct, owner-only Firestore read
// (firestore.rules: `resource.data.parentId == request.auth.uid`) — no
// Worker round trip needed for reads.
export const subscribeMyChildren = (
  onUpdate: (children: SchoolChild[]) => void,
): (() => void) => {
  const user = auth.currentUser;
  if (!user) {
    onUpdate([]);
    return () => {};
  }

  return onSnapshot(
    query(collection(db, SCHOOL_CHILDREN_COLLECTION), where("parentId", "==", user.uid)),
    (snap) => {
      onUpdate(snap.docs.map((d) => normalizeSchoolChild(d.id, d.data())));
    },
    (error) => {
      console.log("Listener failed:", {
        feature: "subscribeMyChildren",
        collection: SCHOOL_CHILDREN_COLLECTION,
        code: error.code,
        message: error.message,
      });
      onUpdate([]);
    },
  );
};

// ---------------------------------------------------------------------------
// Update — name/school edits and the active toggle stay plain, owner-only
// client writes (firestore.rules validates both shapes and never allows
// returnCode/returnCodeHash/parentId/createdAt to move through either one —
// see firestore.rules' schoolChildren update rule). Only the return code
// itself requires the Worker (see resetSchoolChildReturnCode below).
// ---------------------------------------------------------------------------

export type UpdateSchoolChildInput = {
  childName?: string;
  schoolId?: string;
  // Stable-data snapshot — set together with schoolId whenever the parent
  // re-picks a school in the Edit Child form (see my-children.tsx); never
  // sent without schoolId also present.
  schoolName?: string;
  schoolCityId?: string;
  schoolCityName?: string;
  schoolAddress?: string;
};

// Edits name and/or school (+ its stable-data snapshot) — never
// parentId/returnCode/returnCodeHash/createdAt (see firestore.rules' update
// shapes, which only allow this exact field set together, deliberately
// separate from the active-toggle shape below and the Worker-only
// code-reset path).
export const updateSchoolChildProfile = async (
  childId: string,
  updates: UpdateSchoolChildInput,
): Promise<void> => {
  if (!auth.currentUser) throw new Error(i18n.t("auth.pleaseLoginFirst"));

  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };

  if (updates.childName !== undefined) {
    const clean = updates.childName.trim();
    if (!clean) throw new Error(i18n.t("schoolChildren.childNameRequired"));
    payload.childName = clean;
  }

  if (updates.schoolId !== undefined) {
    const clean = updates.schoolId.trim();
    if (!clean) throw new Error(i18n.t("schoolChildren.schoolRequired"));
    payload.schoolId = clean;
    payload.schoolName = updates.schoolName?.trim() || "";
    payload.schoolCityId = updates.schoolCityId?.trim() || "";
    payload.schoolCityName = updates.schoolCityName?.trim() || "";
    payload.schoolAddress = updates.schoolAddress?.trim() || "";
  }

  await updateDoc(schoolChildRef(childId), payload);
};

// Deactivate ("remove") or restore a child profile. Never a hard delete —
// historical bookings may already reference this childId (see
// schoolTripsLib.ts's childId field), so the profile itself must keep
// existing; `active: false` just hides it from booking-form pickers (see
// DirectionSearchForm.tsx).
export const setSchoolChildActive = async (
  childId: string,
  active: boolean,
): Promise<void> => {
  if (!auth.currentUser) throw new Error(i18n.t("auth.pleaseLoginFirst"));

  await updateDoc(schoolChildRef(childId), {
    active,
    updatedAt: serverTimestamp(),
  });
};

// Regenerates this child's return code via the Worker's
// /school-children/reset-code route — the client never generates the new
// code, never computes its hash, and never touches schoolChildCodes; the
// Worker re-verifies `childId` belongs to the CALLING parent (from their
// verified ID token, not a client-sent field) before it ever reserves
// anything, so a parent can never reset another parent's — or another of
// their own children's — code by passing the wrong id. The OLD code stops
// working the instant this resolves (the child doc's own returnCode/
// returnCodeHash move to the new value, and the old ledger reservation is
// released in the same server-side atomic write).
export const resetSchoolChildReturnCode = async (childId: string): Promise<string> => {
  const result = await postToSchoolChildrenEndpoint<ResetSchoolChildReturnCodeResponse>(
    "/school-children/reset-code",
    { childId },
  );

  return result.returnCode;
};
