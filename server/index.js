// ---------------------------------------------------------------------------
// TakeMe verification server — small Node/Express backend, run locally.
//
// POST /analyze-id       { imageBase64, mimeType? } -> ID fields
// POST /analyze-license  { imageBase64, mimeType? } -> license fields
//
// The React Native app resizes/compresses the photo and sends only the
// Base64 string here. This server never touches Firebase — it's a plain
// Gemini proxy so the API key never ships inside the app.
//
// This is identity-document *reading*, not official government
// verification. A driver's account should still go through manual/admin
// review before being fully trusted.
// ---------------------------------------------------------------------------

require("dotenv").config();

const cors = require("cors");
const express = require("express");

const {
  askGeminiVision,
  asImageQuality,
  asNullableNumber,
  asNullableString,
  asStringArray,
  isApiKeyError,
} = require("./gemini");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

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

const LICENSE_PROMPT = `You are reading a driving license image.
Extract only information that is clearly visible.
Do not guess.
If a field is not visible, return null.
Return strict JSON only, matching exactly this shape:

{
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

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/analyze-id", async (req, res) => {
  const { imageBase64, mimeType } = req.body || {};

  if (!imageBase64 || typeof imageBase64 !== "string") {
    return res.status(400).json({ error: "imageBase64 is required." });
  }

  try {
    const raw = await askGeminiVision(ID_PROMPT, imageBase64, mimeType);

    res.json({
      firstName: asNullableString(raw.firstName),
      lastName: asNullableString(raw.lastName),
      fullName: asNullableString(raw.fullName),
      birthDate: asNullableString(raw.birthDate),
      age: asNullableNumber(raw.age),
      gender: asNullableString(raw.gender),
      idNumber: asNullableString(raw.idNumber),
      documentCountry: asNullableString(raw.documentCountry),
      imageQuality: asImageQuality(raw.imageQuality),
      confidence: asNullableNumber(raw.confidence) ?? 0,
    });
  } catch (error) {
    console.error("[/analyze-id]", error);

    if (isApiKeyError(error)) {
      return res.status(500).json({
        error:
          "Server misconfiguration: GEMINI_API_KEY is missing or invalid. Check server/.env.",
      });
    }

    res.status(500).json({ error: "Could not read the ID image. Please try again." });
  }
});

app.post("/analyze-license", async (req, res) => {
  const { imageBase64, mimeType } = req.body || {};

  if (!imageBase64 || typeof imageBase64 !== "string") {
    return res.status(400).json({ error: "imageBase64 is required." });
  }

  try {
    const raw = await askGeminiVision(LICENSE_PROMPT, imageBase64, mimeType);

    res.json({
      licenseNumber: asNullableString(raw.licenseNumber),
      fullName: asNullableString(raw.fullName),
      birthDate: asNullableString(raw.birthDate),
      expiryDate: asNullableString(raw.expiryDate),
      licenseCategories: asStringArray(raw.licenseCategories),
      documentCountry: asNullableString(raw.documentCountry),
      imageQuality: asImageQuality(raw.imageQuality),
      confidence: asNullableNumber(raw.confidence) ?? 0,
      isExpired: typeof raw.isExpired === "boolean" ? raw.isExpired : null,
    });
  } catch (error) {
    console.error("[/analyze-license]", error);

    if (isApiKeyError(error)) {
      return res.status(500).json({
        error:
          "Server misconfiguration: GEMINI_API_KEY is missing or invalid. Check server/.env.",
      });
    }

    res
      .status(500)
      .json({ error: "Could not read the driving license image. Please try again." });
  }
});

const PORT = process.env.PORT || 3001;

// Listen on 0.0.0.0 (not just localhost) so a phone on the same Wi-Fi
// network can reach this server at your computer's LAN IP.
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
