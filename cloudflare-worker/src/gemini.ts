// ---------------------------------------------------------------------------
// Gemini Vision helpers shared by the /analyze-id and /analyze-license
// routes. This is the only file that talks to Google's Generative Language
// API. The key is read only from env.GEMINI_API_KEY (a Wrangler secret) and
// is never logged or echoed back in a response.
// ---------------------------------------------------------------------------

import type { Env } from "./env";

export type { Env };

// Same default as the local server/gemini.js — Google's self-updating alias
// for their current lightweight multimodal model.
const DEFAULT_MODEL = "gemini-flash-lite-latest";

export class GeminiApiKeyError extends Error {}

// Pulls the first {...} block out of the model's text, in case it wrapped
// the JSON in prose or a markdown fence despite instructions not to.
const extractJsonObject = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);

    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through
      }
    }

    throw new Error("The AI response was not valid JSON.");
  }
};

export const askGeminiVision = async (
  env: Env,
  prompt: string,
  imageBase64: string,
  mimeType: string,
): Promise<any> => {
  if (!env.GEMINI_API_KEY) {
    throw new GeminiApiKeyError("GEMINI_API_KEY is not configured.");
  }

  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: imageBase64 } }],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
    });
  } catch {
    throw new Error("Could not reach the Gemini API.");
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");

    if (
      response.status === 400 &&
      (errorText.includes("API_KEY_INVALID") || errorText.includes("API key not valid"))
    ) {
      throw new GeminiApiKeyError("GEMINI_API_KEY is invalid.");
    }

    if (response.status === 403) {
      throw new GeminiApiKeyError("GEMINI_API_KEY is invalid.");
    }

    throw new Error(`Gemini API request failed with status ${response.status}.`);
  }

  const data = (await response.json()) as any;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text || typeof text !== "string") {
    throw new Error("The AI returned an empty response.");
  }

  return extractJsonObject(text);
};

// ---------------------------------------------------------------------------
// Defensive re-shaping — never trust the model's output shape blindly.
// ---------------------------------------------------------------------------

export const asNullableString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export const asNullableNumber = (value: unknown): number | null => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "") : [];

export type ImageQuality = "clear" | "blurry" | "partial" | "unreadable";

export const asImageQuality = (value: unknown): ImageQuality => {
  if (value === "clear" || value === "blurry" || value === "partial" || value === "unreadable") {
    return value;
  }
  return "unreadable";
};

export type DocumentType =
  | "driver_license"
  | "id_card"
  | "passport"
  | "other_document"
  | "random_photo"
  | "unclear";

const DOCUMENT_TYPES: DocumentType[] = [
  "driver_license",
  "id_card",
  "passport",
  "other_document",
  "random_photo",
  "unclear",
];

export const asDocumentType = (value: unknown): DocumentType =>
  DOCUMENT_TYPES.includes(value as DocumentType) ? (value as DocumentType) : "unclear";
