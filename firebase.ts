import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCbOSLRMCO_d8X2jOO3o5DP4QPZ5fvVe2I",
  authDomain: "take-me-cc3de.firebaseapp.com",
  projectId: "take-me-cc3de",
  storageBucket: "take-me-cc3de.firebasestorage.app",
  messagingSenderId: "68698161381",
  appId: "1:68698161381:web:4ffe5172999d8698f7140c",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
// NOTE: no `functions` export here. This project's Firebase plan (Spark)
// cannot deploy Cloud Functions — callable or otherwise — so the app never
// calls Firebase Functions directly. The School Child return-code endpoints
// that would have used a callable instead run on the existing Cloudflare
// Worker (see app/booking/school/schoolChildrenLib.ts, which calls it over
// plain HTTPS with a Firebase ID token, not the firebase/functions SDK).
// Same reason there's no Storage export: Firebase Storage needs the Blaze
// plan, so report photos are compressed to a small Base64 data URI and
// stored directly on the Firestore document instead (see
// compressReportImage in app/admin/adminReportsLib.ts).

// Reused wherever a Firebase Auth action link needs to point back at a real
// page of this app's own web build (e.g. the password-reset continue URL) —
// never hardcode the auth domain a second time elsewhere.
export const firebaseAuthDomain = firebaseConfig.authDomain;
