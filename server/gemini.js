// ---------------------------------------------------------------------------
// Gemini Vision helpers shared by the /analyze-id and /analyze-license
// routes. This is the only file that talks to Google's Generative AI API —
// the API key lives only in this process's environment (.env), never in the
// React Native app.
// ---------------------------------------------------------------------------

const { GoogleGenerativeAI } = require("@google/generative-ai");

// "gemini-2.5-flash" was retired by Google (confirmed via a live 404 from
// the API: "This model models/gemini-2.5-flash is no longer available").
// "gemini-flash-lite-latest" is Google's self-updating alias for their
// current lightweight multimodal model (resolved to gemini-3.1-flash-lite
// as of this writing) and is what's actually free-tier-eligible on this
// key — gemini-flash-latest / gemini-*-pro hit quota limit:0 or 503s.
const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";

let cachedClient = null;

const getClient = () => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set. Copy .env.example to .env and fill it in.");
  }

  if (!cachedClient) {
    cachedClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }

  return cachedClient;
};

// Pulls the first {...} block out of the model's text, in case it wrapped
// the JSON in prose or a markdown fence despite instructions not to.
const extractJsonObject = (raw) => {
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

const askGeminiVision = async (prompt, imageBase64, mimeType) => {
  const genAI = getClient();

  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
    },
  });

  const result = await model.generateContent([
    { text: prompt },
    {
      inlineData: {
        mimeType: mimeType || "image/jpeg",
        data: imageBase64,
      },
    },
  ]);

  const text = result.response.text();

  if (!text) {
    throw new Error("The AI returned an empty response.");
  }

  return extractJsonObject(text);
};

// ---------------------------------------------------------------------------
// Defensive re-shaping — never trust the model's output shape blindly.
// ---------------------------------------------------------------------------

const asNullableString = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const asNullableNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const asStringArray = (value) =>
  Array.isArray(value) ? value.filter((v) => typeof v === "string" && v.trim()) : [];

const asImageQuality = (value) => {
  if (["clear", "blurry", "partial", "unreadable"].includes(value)) return value;
  return "unreadable";
};

// Distinguishes "server is misconfigured" (missing/invalid Gemini key) from
// "the model genuinely couldn't read this image" — the two need very
// different messages so setup mistakes aren't mistaken for photo quality.
const isApiKeyError = (error) => {
  const message = String(error?.message || "");
  return (
    message.includes("GEMINI_API_KEY is not set") ||
    message.includes("API_KEY_INVALID") ||
    message.includes("API key not valid")
  );
};

module.exports = {
  askGeminiVision,
  asNullableString,
  asNullableNumber,
  asStringArray,
  asImageQuality,
  isApiKeyError,
};
