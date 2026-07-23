// ---------------------------------------------------------------------------
// TakeMe ID reader — Cloudflare Worker.
//
// GET  /health           -> { ok: true, service: "TakeMe ID reader" }
// POST /analyze-id       -> { imageBase64, mimeType? } -> ID fields
// POST /analyze-license  -> { imageBase64, mimeType? } -> license fields
//
// This is a 1:1 migration of the local server/index.js + server/gemini.js
// Express backend onto the Workers runtime. Request/response shapes are
// unchanged so the Expo app (app/login/idVerificationLib.ts) keeps working
// unmodified — only EXPO_PUBLIC_BACKEND_URL changes.
//
// Privacy: the ID image and any extracted personal information (names,
// birth dates, document numbers, etc.) are never logged or persisted
// anywhere. Only generic error strings are logged.
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

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10mb, same cap as the old Express server

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

    return jsonResponse({ error: "Not found." }, 404);
  },
};
