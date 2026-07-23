// ---------------------------------------------------------------------------
// Sign up: AI-assisted ID + driver-license reading via the local Node/
// Express backend (server/), which is the only thing that talks to Gemini.
//
// Flow per document:
//   1. pickDocumentImage()        -> local photo URI (camera or library),
//                                    used only for the on-screen preview.
//   2. compressImageToBase64(uri) -> resized (~800px wide) + JPEG-compressed
//                                    copy, converted to Base64.
//   3. analyzeIdImage / analyzeLicenseImage(base64)
//                                    -> POSTs the compressed Base64 to the
//                                       backend, which calls Gemini and
//                                       returns strict JSON.
//
// Nothing is uploaded to Firebase Storage and no full-size image is ever
// saved to Firestore — only the small, local, compressed copy is sent to
// our own backend for reading, and only the extracted text fields are kept.
// ---------------------------------------------------------------------------

import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Alert } from "react-native";

import i18n from "../i18n";

export type ImageQuality = "clear" | "blurry" | "partial" | "unreadable";

export type IdAnalysisResult = {
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  birthDate: string | null;
  age: number | null;
  gender: string | null;
  idNumber: string | null;
  documentCountry: string | null;
  imageQuality: ImageQuality;
  confidence: number;
};

// What the uploaded image actually shows, per the backend's real Gemini
// Vision classification — never inferred from filename/file extension, which
// can't tell a license from an ID card. See checkLicenseDocumentType below
// for how this gates sign up.
export type LicenseDocumentType =
  | "driver_license"
  | "id_card"
  | "passport"
  | "other_document"
  | "random_photo"
  | "unclear";

export type LicenseAnalysisResult = {
  documentType: LicenseDocumentType;
  documentTypeConfidence: number;
  licenseNumber: string | null;
  fullName: string | null;
  birthDate: string | null;
  expiryDate: string | null;
  licenseCategories: string[];
  documentCountry: string | null;
  imageQuality: ImageQuality;
  confidence: number;
  isExpired: boolean | null;
};

export const SPOKEN_LANGUAGE_OPTIONS = ["Arabic", "Hebrew", "English", "Russian"];

// Always read from EXPO_PUBLIC_BACKEND_URL — set it in the .env file at the
// PROJECT ROOT (copy .env.example to .env there). Points at the deployed
// Cloudflare Worker (cloudflare-worker/), so it works the same on a real
// phone, an emulator/simulator, or the web build.
export const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";

// ---------------------------------------------------------------------------
// Picking a photo (local preview only)
// ---------------------------------------------------------------------------

const requestCameraPermission = async () => {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  return status === "granted";
};

const requestLibraryPermission = async () => {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return status === "granted";
};

export const pickDocumentImage = (): Promise<string | null> => {
  return new Promise((resolve) => {
    Alert.alert(i18n.t("auth.uploadDocumentTitle"), i18n.t("auth.uploadDocumentMessage"), [
      {
        text: i18n.t("common.takePhoto"),
        onPress: async () => {
          const granted = await requestCameraPermission();

          if (!granted) {
            Alert.alert(
              i18n.t("auth.cameraPermissionNeededTitle"),
              i18n.t("auth.cameraPermissionNeededMessage"),
            );
            resolve(null);
            return;
          }

          const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.8,
          });

          resolve(result.canceled ? null : result.assets[0].uri);
        },
      },
      {
        text: i18n.t("common.chooseFromGallery"),
        onPress: async () => {
          const granted = await requestLibraryPermission();

          if (!granted) {
            Alert.alert(
              i18n.t("auth.photoLibraryPermissionNeededTitle"),
              i18n.t("auth.photoLibraryPermissionNeededMessage"),
            );
            resolve(null);
            return;
          }

          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.8,
          });

          resolve(result.canceled ? null : result.assets[0].uri);
        },
      },
      { text: i18n.t("common.cancel"), style: "cancel", onPress: () => resolve(null) },
    ]);
  });
};

// ---------------------------------------------------------------------------
// Resize + compress + Base64 — keeps the request tiny. The local `uri` used
// for the on-screen <Image> preview is the ORIGINAL picked photo; only this
// smaller copy is turned into Base64 and sent to the backend.
// ---------------------------------------------------------------------------

export const compressImageToBase64 = async (uri: string): Promise<string> => {
  const context = ImageManipulator.ImageManipulator.manipulate(uri);
  context.resize({ width: 800 });
  const image = await context.renderAsync();

  const result = await image.saveAsync({
    compress: 0.5,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });

  if (!result.base64) {
    throw new Error(i18n.t("errors.couldNotProcessImage"));
  }

  return result.base64;
};

// ---------------------------------------------------------------------------
// Calling the backend
// ---------------------------------------------------------------------------

const postForAnalysis = async <T>(path: string, imageBase64: string): Promise<T> => {
  if (!BACKEND_URL) {
    throw new Error(i18n.t("errors.backendUrlNotSet"));
  }

  let response: Response;

  try {
    response = await fetch(`${BACKEND_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64, mimeType: "image/jpeg" }),
    });
  } catch {
    throw new Error(i18n.t("errors.couldNotReachVerificationServer"));
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error || i18n.t("errors.verificationServerError"));
  }

  return data as T;
};

export const analyzeIdImage = (imageBase64: string) =>
  postForAnalysis<IdAnalysisResult>("/analyze-id", imageBase64);

export const analyzeLicenseImage = (imageBase64: string) =>
  postForAnalysis<LicenseAnalysisResult>("/analyze-license", imageBase64);

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export const isIdReadable = (result: IdAnalysisResult | null) => {
  if (!result) return false;
  if (result.imageQuality === "unreadable") return false;
  return !!result.fullName && !!result.birthDate;
};

export const isValidYMD = (value: string | null | undefined): boolean => {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
};

export const calculateAgeFromBirthDate = (birthDate: string | null): number | null => {
  if (!isValidYMD(birthDate)) return null;

  const [yearStr, monthStr, dayStr] = (birthDate as string).split("-");
  const birth = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));

  if (Number.isNaN(birth.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const hasHadBirthdayThisYear =
    today.getMonth() > birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());

  if (!hasHadBirthdayThisYear) age -= 1;

  return age >= 0 && age < 130 ? age : null;
};

// Real document-type check — never based on file type/extension, which
// can't distinguish a license from an ID card/passport/random photo.
//
// - "valid"               — confidently a driving license. Submission may
//                            proceed (the driver still stays pending_admin_review).
// - "wrong_document"      — confidently something else (ID/passport/other
//                            document/random photo). Submission is blocked.
// - "needs_manual_review" — the model couldn't confidently tell. Never
//                            auto-approved: submission may proceed, but the
//                            account is flagged so admin review looks at the
//                            document itself, not just the extracted fields.
export type LicenseDocumentCheck = "valid" | "wrong_document" | "needs_manual_review";

const CONFIDENT_THRESHOLD = 0.6;

export const checkLicenseDocumentType = (
  result: LicenseAnalysisResult | null,
): LicenseDocumentCheck => {
  if (!result) return "needs_manual_review";

  const confidence = Number(result.documentTypeConfidence) || 0;

  if (result.documentType === "driver_license" && confidence >= CONFIDENT_THRESHOLD) {
    return "valid";
  }

  const confidentlyWrong =
    confidence >= CONFIDENT_THRESHOLD &&
    (result.documentType === "id_card" ||
      result.documentType === "passport" ||
      result.documentType === "other_document" ||
      result.documentType === "random_photo");

  if (confidentlyWrong) return "wrong_document";

  return "needs_manual_review";
};

export type LicenseValidity = "valid" | "expired" | "unknown";

export const getLicenseValidity = (expiryDate: string | null): LicenseValidity => {
  if (!isValidYMD(expiryDate)) return "unknown";

  const [yearStr, monthStr, dayStr] = (expiryDate as string).split("-");
  const expiry = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));

  if (Number.isNaN(expiry.getTime())) return "unknown";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  expiry.setHours(0, 0, 0, 0);

  return expiry.getTime() > today.getTime() ? "valid" : "expired";
};
