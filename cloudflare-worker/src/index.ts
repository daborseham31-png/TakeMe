// ---------------------------------------------------------------------------
// TakeMe backend — Cloudflare Worker.
//
// GET  /health                    -> { ok: true, service: "TakeMe ID reader" }
// POST /analyze-id                -> { imageBase64, mimeType? } -> ID fields
// POST /analyze-license           -> { imageBase64, mimeType? } -> license fields
// POST /school-children/create     -> auth required -> new School Child profile
// POST /school-children/reset-code -> auth required -> regenerated return code
// POST /school-kiosk/lookup        -> PUBLIC, no auth -> today's return-ride info
//
// The first three routes are a 1:1 migration of the local server/index.js +
// server/gemini.js Express backend onto the Workers runtime — unchanged by
// this file's later additions (app/login/idVerificationLib.ts keeps working
// unmodified).
//
// The two /school-children/* routes are createSchoolChildProfile /
// resetSchoolChildReturnCode, moved here from Firebase Callable Functions
// because this project's Firebase plan (Spark) can't deploy Cloud Functions.
// Both require a verified Firebase ID token (see firebaseAuth.ts) — there is
// no unauthenticated path to either. See schoolChildren.ts for the actual
// return-code logic and firestoreRest.ts for how this Worker reaches
// Firestore without the (Workers-incompatible) Admin SDK.
//
// /school-kiosk/lookup (Phase 2 of the School Return Kiosk project — see
// schoolKiosk.ts) is deliberately the ONE public, unauthenticated route in
// this Worker: a child at a school kiosk device has no Firebase account to
// present a token for. It is read-only (never writes to Firestore) and is
// rate-limited far more aggressively than the authenticated routes above
// (see rateLimit.ts's isKioskLookupRateLimited) precisely because it has no
// per-uid identity to key off of.
//
// Privacy: the ID image and any extracted personal information (names,
// birth dates, document numbers, etc.) are never logged or persisted
// anywhere. School Child and School Kiosk requests never log a token, a
// permanent or temporary return code, or a service-account credential —
// only generic error strings/status codes.
// ---------------------------------------------------------------------------

import {
  type Env,
  askGeminiVision,
  asDocumentType,
  asImageQuality,
  asNullableNumber,
  asNullableString,
  asStringArray,
  GeminiApiKeyError,
} from "./gemini";
import { AuthError, verifyFirebaseIdToken } from "./firebaseAuth";
import { isKioskLookupRateLimited, isRateLimited } from "./rateLimit";
import {
  createSchoolChildProfile,
  hashReturnCode,
  resetSchoolChildReturnCode,
  SchoolChildError,
} from "./schoolChildren";
import { lookupSchoolKiosk } from "./schoolKiosk";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10mb, same cap as the old Express server

// The School Child endpoints only ever accept two short strings
// (childName/schoolId) or one id (childId) — a far smaller, stricter cap
// than the image-upload endpoints above.
const MAX_SCHOOL_CHILD_BODY_BYTES = 4 * 1024; // 4kb

const SUPPORTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

const ID_PROMPT = `You are reading an ID document image.
Extract only information that is clearly visible.
Do not guess.
If a field is not visible, return null.
Return strict JSON only, matching exactly this shape:

{
  "firstName": string | null,
  "lastName": string | null,
  "fullName": string | null,
  "birthDate": "YYYY-MM-DD" | null,
  "age": number | null,
  "gender": string | null,
  "idNumber": string | null,
  "documentCountry": string | null,
  "imageQuality": "clear" | "blurry" | "partial" | "unreadable",
  "confidence": number
}`;

const LICENSE_PROMPT = `You are looking at a photo that is supposed to be a driving license.

First, classify what the document in the image ACTUALLY is, based only on its
real visual layout, printed labels, and content — never based on a filename
or file type, which you don't have access to anyway. A driving license
typically has a licensing-authority header, a license/permit number, issue
and expiry dates, and vehicle category/class codes. A national ID card or
passport looks different (different header, a national ID number instead of
a license number, no vehicle categories, often a passport's photo page
layout). If the image is a random photo, a screenshot, a blank/unrelated
picture, or any other non-license document, say so honestly.

documentType must be one of:
- "driver_license"  — this is clearly a driving license/permit.
- "id_card"          — this is clearly a national ID card.
- "passport"         — this is clearly a passport.
- "other_document"   — some other real document, not a license.
- "random_photo"     — not an official document at all (a person, object, screenshot, scenery, etc).
- "unclear"          — you cannot confidently tell what this document is (too blurry, cropped, obscured, or ambiguous).

documentTypeConfidence is a number from 0 to 1 for how sure you are about
documentType. Be conservative: only use a high number (0.8+) when the
license-specific markers above are clearly visible. If you are not sure,
use "unclear" with a low confidence rather than guessing "driver_license".

Only extract the license fields below if documentType is "driver_license".
For any other documentType, every one of those fields must be null/empty —
never invent license data from an ID card or passport just because some
fields (like a name or birth date) happen to look similar.

Do not guess. If a field is not visible, return null.
Return strict JSON only, matching exactly this shape:

{
  "documentType": "driver_license" | "id_card" | "passport" | "other_document" | "random_photo" | "unclear",
  "documentTypeConfidence": number,
  "licenseNumber": string | null,
  "fullName": string | null,
  "birthDate": "YYYY-MM-DD" | null,
  "expiryDate": "YYYY-MM-DD" | null,
  "licenseCategories": string[],
  "documentCountry": string | null,
  "imageQuality": "clear" | "blurry" | "partial" | "unreadable",
  "confidence": number,
  "isExpired": boolean | null
}`;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });

const isValidBase64 = (value: string): boolean => {
  if (!value || value.length % 4 !== 0 || !BASE64_PATTERN.test(value)) return false;

  try {
    atob(value);
    return true;
  } catch {
    return false;
  }
};

type AnalyzeKind = "id" | "license";

const handleAnalyze = async (request: Request, env: Env, kind: AnalyzeKind): Promise<Response> => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonResponse({ error: "Content-Type must be application/json." }, 415);
  }

  const contentLength = Number(request.headers.get("Content-Length") || "0");
  if (contentLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: "Request body is too large." }, 413);
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return jsonResponse({ error: "Request body is too large." }, 413);
  }

  let body: any;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON." }, 400);
  }

  const { imageBase64, mimeType } = body || {};

  if (!imageBase64 || typeof imageBase64 !== "string") {
    return jsonResponse({ error: "imageBase64 is required." }, 400);
  }

  const resolvedMimeType = mimeType || "image/jpeg";
  if (typeof resolvedMimeType !== "string" || !SUPPORTED_MIME_TYPES.has(resolvedMimeType)) {
    return jsonResponse({ error: "Unsupported image MIME type." }, 400);
  }

  if (!isValidBase64(imageBase64)) {
    return jsonResponse({ error: "imageBase64 is not valid Base64." }, 400);
  }

  const prompt = kind === "id" ? ID_PROMPT : LICENSE_PROMPT;
  const logTag = kind === "id" ? "/analyze-id" : "/analyze-license";
  const fallbackErrorMessage =
    kind === "id"
      ? "Could not read the ID image. Please try again."
      : "Could not read the driving license image. Please try again.";

  let raw: any;
  try {
    raw = await askGeminiVision(env, prompt, imageBase64, resolvedMimeType);
  } catch (error) {
    // Log only generic, non-personal diagnostic info — never the image
    // Base64 or any extracted field.
    console.error(`[${logTag}] Gemini request failed:`, error instanceof Error ? error.name : "unknown");

    if (error instanceof GeminiApiKeyError) {
      return jsonResponse(
        { error: "Server misconfiguration: GEMINI_API_KEY is missing or invalid." },
        500,
      );
    }

    return jsonResponse({ error: fallbackErrorMessage }, 500);
  }

  if (kind === "id") {
    return jsonResponse({
      firstName: asNullableString(raw?.firstName),
      lastName: asNullableString(raw?.lastName),
      fullName: asNullableString(raw?.fullName),
      birthDate: asNullableString(raw?.birthDate),
      age: asNullableNumber(raw?.age),
      gender: asNullableString(raw?.gender),
      idNumber: asNullableString(raw?.idNumber),
      documentCountry: asNullableString(raw?.documentCountry),
      imageQuality: asImageQuality(raw?.imageQuality),
      confidence: asNullableNumber(raw?.confidence) ?? 0,
    });
  }

  return jsonResponse({
    documentType: asDocumentType(raw?.documentType),
    documentTypeConfidence: asNullableNumber(raw?.documentTypeConfidence) ?? 0,
    licenseNumber: asNullableString(raw?.licenseNumber),
    fullName: asNullableString(raw?.fullName),
    birthDate: asNullableString(raw?.birthDate),
    expiryDate: asNullableString(raw?.expiryDate),
    licenseCategories: asStringArray(raw?.licenseCategories),
    documentCountry: asNullableString(raw?.documentCountry),
    imageQuality: asImageQuality(raw?.imageQuality),
    confidence: asNullableNumber(raw?.confidence) ?? 0,
    isExpired: typeof raw?.isExpired === "boolean" ? raw.isExpired : null,
  });
};

// ---------------------------------------------------------------------------
// School Child endpoints — shared plumbing (auth, rate limiting, body-size
// limit, safe structured errors). The actual return-code logic lives in
// schoolChildren.ts; this is only the HTTP boundary around it.
// ---------------------------------------------------------------------------

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const SCHOOL_CHILD_ERROR_STATUS: Record<string, number> = {
  "invalid-argument": 400,
  "not-found": 404,
  "permission-denied": 403,
  "resource-exhausted": 429,
  internal: 500,
};

// "Bearer <token>" only — anything else (missing header, wrong scheme, extra
// whitespace) is treated as no token at all, never partially parsed.
const getBearerToken = (request: Request): string | null => {
  const header = request.headers.get("Authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
};

const parseJsonBody = async (request: Request, maxBytes: number): Promise<any> => {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json.");
  }

  const contentLength = Number(request.headers.get("Content-Length") || "0");
  if (contentLength > maxBytes) {
    throw new HttpError(413, "Request body is too large.");
  }

  const rawBody = await request.text();
  if (rawBody.length > maxBytes) {
    throw new HttpError(413, "Request body is too large.");
  }

  try {
    return rawBody ? JSON.parse(rawBody) : {};
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
};

type SchoolChildRequestKind = "create" | "reset";

// One handler for both routes (mirrors handleAnalyze's kind-based shape
// above) — verifies the bearer token BEFORE touching the body or Firestore,
// rate-limits per authenticated uid, then delegates to schoolChildren.ts.
// Every failure path returns a short, safe, generic message — never a raw
// error object, a stack trace, or a Firestore/Google API response body.
const handleSchoolChildrenRequest = async (
  request: Request,
  env: Env,
  kind: SchoolChildRequestKind,
): Promise<Response> => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const logTag = kind === "create" ? "/school-children/create" : "/school-children/reset-code";

  try {
    const token = getBearerToken(request);
    if (!token) {
      return jsonResponse({ error: "Missing or malformed Authorization header." }, 401);
    }

    let user;
    try {
      user = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    } catch (error) {
      // Never forward WHY verification failed (expired vs. malformed vs.
      // wrong project, etc.) — that's internal detail an attacker could use
      // to fine-tune a forged token. Logged generically, never the token
      // itself.
      console.error(`[${logTag}] token verification failed`, error instanceof AuthError ? error.message : "unknown");
      return jsonResponse({ error: "Unauthenticated." }, 401);
    }

    // Keyed by kind + uid — a parent's create attempts and reset attempts
    // are tracked independently, and never affected by any OTHER parent's
    // activity (see rateLimit.ts for this counter's per-isolate scope).
    if (isRateLimited(`${kind}:${user.uid}`)) {
      return jsonResponse({ error: "Too many requests. Please try again shortly." }, 429);
    }

    const body = await parseJsonBody(request, MAX_SCHOOL_CHILD_BODY_BYTES);

    const result =
      kind === "create"
        ? await createSchoolChildProfile(env, user.uid, body)
        : await resetSchoolChildReturnCode(env, user.uid, body);

    return jsonResponse(result);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse({ error: error.message }, error.status);
    }

    if (error instanceof SchoolChildError) {
      return jsonResponse({ error: error.message }, SCHOOL_CHILD_ERROR_STATUS[error.code] || 500);
    }

    // Never the raw error/stack — only its name, and only to the Worker's
    // own logs.
    console.error(`[${logTag}] unexpected error`, error instanceof Error ? error.name : "unknown");
    return jsonResponse({ error: "Something went wrong. Please try again." }, 500);
  }
};

// ---------------------------------------------------------------------------
// School Kiosk lookup — PUBLIC (no Authorization header at all; see
// schoolKiosk.ts's header for why). Same body-size cap as the other School
// Child routes (a returnCode + schoolId pair is even smaller than
// childName+schoolId, so the existing 4kb ceiling is already generous), but
// its own, much stricter rate limiter keyed by IP + the submitted code's own
// hash (see rateLimit.ts's isKioskLookupRateLimited) since there is no
// authenticated uid here to key off of at all.
// ---------------------------------------------------------------------------

const handleSchoolKioskLookup = async (request: Request, env: Env): Promise<Response> => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  // Cloudflare sets this at the edge from the real TCP connection — a client
  // cannot override it by sending its own header of the same name.
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  try {
    const body = await parseJsonBody(request, MAX_SCHOOL_CHILD_BODY_BYTES);

    // The rate-limit key is the SUBMITTED code's hash, never the plaintext
    // code itself (matches schoolKiosk.ts's own lookup-by-hash approach) —
    // an invalid/non-string value still hashes to SOME stable bucket rather
    // than skipping the per-code limiter entirely.
    const rawReturnCode = typeof body?.returnCode === "string" ? body.returnCode.trim() : "";
    const codeHashForRateLimit = await hashReturnCode(rawReturnCode || "invalid");

    if (await isKioskLookupRateLimited(env.SCHOOL_KIOSK_RATE_LIMIT, ip, codeHashForRateLimit)) {
      return jsonResponse({ error: "Too many requests. Please try again shortly." }, 429);
    }

    const result = await lookupSchoolKiosk(env, body);
    return jsonResponse(result);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse({ error: error.message }, error.status);
    }

    // Never the raw error/stack, never anything from the request body
    // (which may still contain the plaintext code at this point) — only the
    // error's own name, and only to the Worker's own logs.
    console.error("[/school-kiosk/lookup] unexpected error", error instanceof Error ? error.name : "unknown");
    return jsonResponse({ error: "Something went wrong. Please try again." }, 500);
  }
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({ ok: true, service: "TakeMe ID reader" });
    }

    if (url.pathname === "/analyze-id") {
      return handleAnalyze(request, env, "id");
    }

    if (url.pathname === "/analyze-license") {
      return handleAnalyze(request, env, "license");
    }

    if (url.pathname === "/school-children/create") {
      return handleSchoolChildrenRequest(request, env, "create");
    }

    if (url.pathname === "/school-children/reset-code") {
      return handleSchoolChildrenRequest(request, env, "reset");
    }

    if (url.pathname === "/school-kiosk/lookup") {
      return handleSchoolKioskLookup(request, env);
    }

    return jsonResponse({ error: "Not found." }, 404);
  },
};
