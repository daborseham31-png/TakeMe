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
