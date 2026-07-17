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
  asDocumentType,
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
      documentType: asDocumentType(raw.documentType),
      documentTypeConfidence: asNullableNumber(raw.documentTypeConfidence) ?? 0,
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
