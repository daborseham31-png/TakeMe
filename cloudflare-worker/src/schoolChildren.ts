// ---------------------------------------------------------------------------
// School Child return-code business logic — createSchoolChildProfile /
// resetSchoolChildReturnCode, moved here from Firebase Callable Functions
// (see functions/index.js's header comment) because the Firebase project is
// on the Spark plan and callable Cloud Functions require Blaze. Same
// security model as before, just reached over HTTPS instead of the callable
// SDK: caller identity comes ONLY from a verified Firebase ID token (see
// index.ts, which calls verifyFirebaseIdToken before either function below
// ever runs), never from the request body.
//
// Firestore access goes through firestoreRest.ts (service-account REST
// calls, Admin-equivalent trust — bypasses firestore.rules the same way the
// Admin SDK would). This file never receives a client-supplied parentId.
// ---------------------------------------------------------------------------

import {
  buildCreateWrite,
  buildDeleteWrite,
  buildUpdateWrite,
  commitFirestoreWrites,
  getFirestoreDocument,
} from "./firestoreRest";
import type { Env } from "./env";

// Exported for schoolKiosk.ts, which reads both these exact collections
// (never a third, separate lookup collection — see that file's header).
export const SCHOOL_CHILDREN_COLLECTION = "schoolChildren";
export const SCHOOL_CHILD_CODES_COLLECTION = "schoolChildCodes";

export const RETURN_CODE_LENGTH = 6;
const RETURN_CODE_RANGE = 10 ** RETURN_CODE_LENGTH; // 1,000,000 possible codes
const MAX_CODE_GENERATION_ATTEMPTS = 25;
const MAX_CHILD_NAME_LENGTH = 80;
export const MAX_SCHOOL_ID_LENGTH = 100;
// Stable-data snapshot fields (schoolName/schoolCityId/schoolCityName/
// schoolAddress) — plain descriptive text, not identity/security fields, so
// a generous shared length cap is enough validation for all four.
const MAX_SNAPSHOT_FIELD_LENGTH = 200;

export type SchoolChildErrorCode =
  | "invalid-argument"
  | "not-found"
  | "permission-denied"
  | "internal"
  | "resource-exhausted";

export class SchoolChildError extends Error {
  code: SchoolChildErrorCode;

  constructor(code: SchoolChildErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function normalizeChildName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_CHILD_NAME_LENGTH) return null;
  return trimmed;
}

function normalizeSchoolId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_SCHOOL_ID_LENGTH) return null;
  return trimmed;
}

// Optional stable-data snapshot fields — unlike childName/schoolId, absence
// is fine (an older caller, or the rare case a city/school text field was
// left blank client-side); only length is capped. Returns undefined (never
// written to Firestore — see buildCreateWrite's fields object below) for
// anything absent, non-string, or over length.
function normalizeOptionalSnapshotField(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_SNAPSHOT_FIELD_LENGTH) return undefined;
  return trimmed;
}

// crypto.getRandomValues is the Web Crypto CSPRNG the Workers runtime
// exposes natively (no Node `crypto` module, no nodejs_compat needed).
// Rejection sampling over a full 32-bit unsigned range keeps the
// 0-999,999 result uniform (no modulo bias) — same guarantee as the
// Node crypto.randomInt version this replaces. Never Math.random(), never
// derived from any name/phone/id/date/counter. Always zero-padded to 6
// digits and returned as a STRING ("004821" stays valid).
function generateSecureReturnCode(): string {
  const RANDOM_SPACE = 0x100000000; // 2^32
  const MAX_UNBIASED = RANDOM_SPACE - (RANDOM_SPACE % RETURN_CODE_RANGE);

  const buffer = new Uint32Array(1);
  let value = MAX_UNBIASED;
  while (value >= MAX_UNBIASED) {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  }

  return String(value % RETURN_CODE_RANGE).padStart(RETURN_CODE_LENGTH, "0");
}

// Exported for schoolKiosk.ts — the kiosk lookup must hash a SUBMITTED code
// with this exact same algorithm to find the matching schoolChildCodes/{hash}
// ledger entry (see that file's header for why the ledger is looked up by
// hash, never by scanning schoolChildren for a plaintext match).
export async function hashReturnCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// A code-ledger create fails with ALREADY_EXISTS (HTTP 409) when the hash is
// already reserved, and a precondition-guarded update fails with
// FAILED_PRECONDITION (HTTP 400, message containing "FAILED_PRECONDITION")
// when the target document changed since it was last read. Both are
// legitimate "retry from scratch" conditions — collisions and races, not
// real errors — see createSchoolChildProfile/resetSchoolChildReturnCode
// below for where each applies.
function isRetryableCommitFailure(result: { status: number; message: string }): boolean {
  return result.status === 409 || (result.status === 400 && /FAILED_PRECONDITION/i.test(result.message));
}

// ---------------------------------------------------------------------------
// createSchoolChildProfile
// ---------------------------------------------------------------------------

export type CreateSchoolChildProfileResult = {
  id: string;
  parentId: string;
  schoolId: string;
  schoolName?: string;
  schoolCityId?: string;
  schoolCityName?: string;
  schoolAddress?: string;
  childName: string;
  returnCode: string;
  active: true;
};

export async function createSchoolChildProfile(
  env: Env,
  uid: string,
  input: {
    childName?: unknown;
    schoolId?: unknown;
    schoolName?: unknown;
    schoolCityId?: unknown;
    schoolCityName?: unknown;
    schoolAddress?: unknown;
  },
): Promise<CreateSchoolChildProfileResult> {
  const childName = normalizeChildName(input?.childName);
  if (!childName) {
    throw new SchoolChildError("invalid-argument", "A valid child name is required.");
  }

  const schoolId = normalizeSchoolId(input?.schoolId);
  if (!schoolId) {
    throw new SchoolChildError("invalid-argument", "A valid school is required.");
  }

  // Optional stable-data snapshot (see this file's header + schoolChildrenLib.ts
  // for why these travel alongside schoolId instead of only a bare id) —
  // absent entirely for a caller that doesn't supply them, never blocking
  // creation on their own.
  const schoolName = normalizeOptionalSnapshotField(input?.schoolName);
  const schoolCityId = normalizeOptionalSnapshotField(input?.schoolCityId);
  const schoolCityName = normalizeOptionalSnapshotField(input?.schoolCityName);
  const schoolAddress = normalizeOptionalSnapshotField(input?.schoolAddress);

  // Generated once per profile — a plain random id is fine (Firestore
  // itself would generate an equally random one via its own auto-id path;
  // this Worker just has to pick the id itself since the atomic dual-write
  // below needs both document names up front — see firestoreRest.ts's
  // `:commit` header comment for why auto-id generation can't be used
  // inside a batched commit).
  const childId = crypto.randomUUID().replace(/-/g, "");

  for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt += 1) {
    const code = generateSecureReturnCode();
    // eslint-disable-next-line no-await-in-loop
    const hash = await hashReturnCode(code);
    const now = new Date();

    const writes = [
      buildCreateWrite(
        env.FIREBASE_PROJECT_ID,
        SCHOOL_CHILD_CODES_COLLECTION,
        hash,
        { parentId: uid, childId, createdAt: now },
        { requireAbsent: true },
      ),
      buildCreateWrite(env.FIREBASE_PROJECT_ID, SCHOOL_CHILDREN_COLLECTION, childId, {
        parentId: uid,
        schoolId,
        ...(schoolName ? { schoolName } : {}),
        ...(schoolCityId ? { schoolCityId } : {}),
        ...(schoolCityName ? { schoolCityName } : {}),
        ...(schoolAddress ? { schoolAddress } : {}),
        childName,
        returnCode: code,
        returnCodeHash: hash,
        active: true,
        createdAt: now,
        updatedAt: now,
      }),
    ];

    // eslint-disable-next-line no-await-in-loop
    const result = await commitFirestoreWrites(env, writes);

    if (result.ok) {
      return {
        id: childId,
        parentId: uid,
        schoolId,
        schoolName,
        schoolCityId,
        schoolCityName,
        schoolAddress,
        childName,
        returnCode: code,
        active: true,
      };
    }

    if (isRetryableCommitFailure(result) && attempt < MAX_CODE_GENERATION_ATTEMPTS - 1) {
      continue; // eslint-disable-line no-continue
    }

    console.error("createSchoolChildProfile: commit failed", { status: result.status });
    throw new SchoolChildError("internal", "Could not create the child profile. Please try again.");
  }

  throw new SchoolChildError(
    "resource-exhausted",
    "Could not generate a unique return code. Please try again.",
  );
}

// ---------------------------------------------------------------------------
// resetSchoolChildReturnCode
// ---------------------------------------------------------------------------

export type ResetSchoolChildReturnCodeResult = {
  id: string;
  returnCode: string;
};

export async function resetSchoolChildReturnCode(
  env: Env,
  uid: string,
  input: { childId?: unknown },
): Promise<ResetSchoolChildReturnCodeResult> {
  const childId = typeof input?.childId === "string" ? input.childId.trim() : "";
  if (!childId) {
    throw new SchoolChildError("invalid-argument", "A valid childId is required.");
  }

  for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt += 1) {
    // Re-read the child at the TOP of every attempt, not just once before
    // the loop — this is what makes a concurrent reset/edit safe: the
    // update write below carries THIS read's updateTime as a precondition,
    // so if another request already changed the document in between, the
    // commit fails atomically (FAILED_PRECONDITION) and the next iteration
    // starts over from a fresh read, never overwriting a change it didn't
    // see.
    // eslint-disable-next-line no-await-in-loop
    const child = await getFirestoreDocument(env, SCHOOL_CHILDREN_COLLECTION, childId);
    if (!child) {
      throw new SchoolChildError("not-found", "Child profile not found.");
    }

    // The ONLY ownership check that matters — `uid` comes exclusively from
    // the verified Firebase ID token (see index.ts), never from the
    // request body, so a parent can never pass another parent's (or their
    // own other) childId and reset a code that isn't theirs.
    if (child.data.parentId !== uid) {
      throw new SchoolChildError("permission-denied", "You do not have access to this child profile.");
    }

    const oldHash = typeof child.data.returnCodeHash === "string" ? child.data.returnCodeHash : null;

    const code = generateSecureReturnCode();
    // eslint-disable-next-line no-await-in-loop
    const hash = await hashReturnCode(code);

    if (hash === oldHash) {
      // Astronomically unlikely — never treat "generated the same code
      // again" as a real reset; just draw a fresh candidate.
      continue; // eslint-disable-line no-continue
    }

    const now = new Date();

    const writes = [
      buildCreateWrite(
        env.FIREBASE_PROJECT_ID,
        SCHOOL_CHILD_CODES_COLLECTION,
        hash,
        { parentId: uid, childId, createdAt: now },
        { requireAbsent: true },
      ),
      buildUpdateWrite(
        env.FIREBASE_PROJECT_ID,
        SCHOOL_CHILDREN_COLLECTION,
        childId,
        { returnCode: code, returnCodeHash: hash, updatedAt: now },
        ["returnCode", "returnCodeHash", "updatedAt"],
        { updateTime: child.updateTime },
      ),
      // Release the OLD reservation in the SAME atomic commit as the new
      // one being created — the child is never left holding two active
      // reservations, and (since this only ever runs after the new
      // create-write above succeeded within the same commit) never zero
      // either. A delete on an already-gone document is a no-op, never an
      // error, so this stays safe even if cleanup partially ran before on
      // a prior failed attempt.
      ...(oldHash ? [buildDeleteWrite(env.FIREBASE_PROJECT_ID, SCHOOL_CHILD_CODES_COLLECTION, oldHash)] : []),
    ];

    // eslint-disable-next-line no-await-in-loop
    const result = await commitFirestoreWrites(env, writes);

    if (result.ok) {
      return { id: childId, returnCode: code };
    }

    if (isRetryableCommitFailure(result) && attempt < MAX_CODE_GENERATION_ATTEMPTS - 1) {
      continue; // eslint-disable-line no-continue
    }

    console.error("resetSchoolChildReturnCode: commit failed", { status: result.status });
    throw new SchoolChildError("internal", "Could not reset the return code. Please try again.");
  }

  throw new SchoolChildError(
    "resource-exhausted",
    "Could not generate a unique return code. Please try again.",
  );
}
