// ---------------------------------------------------------------------------
// The ONE shared "remember what I typed last time" system for driver trip
// creation forms — car model, car color, plate number, price. Used by every
// screen under app/driver/create/ (RideForm.tsx for Personal Ride + weekly
// School, SchoolTripForm.tsx for one-time School, delivery.tsx, work.tsx,
// errand.tsx) instead of each screen inventing its own suggestion list.
//
// Storage: one doc per driver, users/{uid}/savedFormValues/profile — a
// single small document (never a subcollection with one doc per value) so
// reading suggestions is one doc read/listener, not a query, and writing a
// newly-used value is one merge write. Private to the driver by construction
// (path is keyed by their own uid) — see firestore.rules.
// ---------------------------------------------------------------------------

import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";

import { auth, db } from "../../../firebase";
import { normalizeToWesternDigits } from "../../i18n/digits";

export type SavedFormValues = {
  carModels: string[];
  carColors: string[];
  plateNumbers: string[];
  prices: string[];
};

const EMPTY_VALUES: SavedFormValues = {
  carModels: [],
  carColors: [],
  plateNumbers: [],
  prices: [],
};

const MAX_SAVED_PER_FIELD = 10;

const savedFormValuesRef = (uid: string) => doc(db, "users", uid, "savedFormValues", "profile");

// Collapses whitespace/case differences ("Kia" / "kia" / " KIA ") to the same
// key, without touching what actually gets displayed/stored — see
// upsertMostRecent below, which keeps the NEWEST typed display form.
const dedupeKey = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

// Normalizes a raw field value into the canonical, storable form: Western
// digits (never Arabic-Indic — see app/i18n/digits.ts), trimmed, internal
// whitespace collapsed to single spaces. Used for both vehicle text fields
// and plate/price numeric fields — a plate number may contain both letters
// and digits, so this only ever touches digit characters, never strips
// letters.
export const normalizeSavedFieldValue = (value: string): string =>
  normalizeToWesternDigits(value).trim().replace(/\s+/g, " ");

// Moves `newValue` to the front of `list` (most-recently-used first),
// removing any existing entry that's the same value modulo case/whitespace,
// keeping the NEW value's display form (rule: "preserve the most recently
// used display format"). Empty input is a no-op. Capped at maxEntries.
export const upsertMostRecent = (
  list: string[],
  newValue: string,
  maxEntries: number = MAX_SAVED_PER_FIELD,
): string[] => {
  const clean = normalizeSavedFieldValue(newValue);
  if (!clean) return list;

  const key = dedupeKey(clean);
  const withoutDuplicate = list.filter((existing) => dedupeKey(existing) !== key);

  return [clean, ...withoutDuplicate].slice(0, maxEntries);
};

// Live suggestions for the signed-in driver — never another driver's values
// (the doc path itself is scoped to auth.currentUser.uid; see
// firestore.rules for the server-side guarantee). Returns empty arrays
// (never throws into the UI) while signed out or before the first value is
// ever saved.
export const useSavedFormValues = (): SavedFormValues => {
  const [values, setValues] = useState<SavedFormValues>(EMPTY_VALUES);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setValues(EMPTY_VALUES);
      return;
    }

    const unsub = onSnapshot(
      savedFormValuesRef(uid),
      (snap) => {
        const data = snap.data();
        setValues({
          carModels: Array.isArray(data?.carModels) ? data.carModels : [],
          carColors: Array.isArray(data?.carColors) ? data.carColors : [],
          plateNumbers: Array.isArray(data?.plateNumbers) ? data.plateNumbers : [],
          prices: Array.isArray(data?.prices) ? data.prices : [],
        });
      },
      (error) => {
        console.log("Listener failed:", {
          feature: "useSavedFormValues",
          collection: "savedFormValues",
          userId: uid,
          code: error.code,
          message: error.message,
        });
        setValues(EMPTY_VALUES);
      },
    );

    return unsub;
  }, []);

  return values;
};

export type UsedFormValuesInput = {
  carModel?: string;
  carColor?: string;
  plateNumber?: string;
  price?: string;
};

// Call ONLY after a trip/route/job/errand is successfully created — never on
// every keystroke, and never for a form the driver cancelled out of (rule:
// "save it only after the trip is successfully created"). Best-effort: a
// failure here never blocks or surfaces an error for the action that just
// succeeded.
export const recordUsedFormValues = async (input: UsedFormValuesInput): Promise<void> => {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  const hasAnyValue =
    !!input.carModel?.trim() ||
    !!input.carColor?.trim() ||
    !!input.plateNumber?.trim() ||
    !!input.price?.trim();
  if (!hasAnyValue) return;

  try {
    const ref = savedFormValuesRef(uid);
    const snap = await getDoc(ref);
    const existing = snap.exists() ? snap.data() : {};

    const next: Record<string, unknown> = { updatedAt: serverTimestamp() };

    if (input.carModel?.trim()) {
      next.carModels = upsertMostRecent(existing.carModels || [], input.carModel);
    }
    if (input.carColor?.trim()) {
      next.carColors = upsertMostRecent(existing.carColors || [], input.carColor);
    }
    if (input.plateNumber?.trim()) {
      next.plateNumbers = upsertMostRecent(existing.plateNumbers || [], input.plateNumber);
    }
    if (input.price?.trim()) {
      next.prices = upsertMostRecent(existing.prices || [], input.price);
    }

    await setDoc(ref, next, { merge: true });
  } catch (error) {
    console.log("recordUsedFormValues failed", error);
  }
};
