// ---------------------------------------------------------------------------
// Saved pickup locations (Home + named places, e.g. "Office") — feeds the
// shared PickupLocationPicker.tsx bottom sheet and the Profile > Saved
// Locations screen. Flat, owner-only collection (userId field) — matches
// this app's dominant convention (bookings, workApplications,
// roadsideRequests, adminReports, ...), never a Firestore subcollection.
// ---------------------------------------------------------------------------

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { auth, db } from "../../firebase";
import i18n from "../i18n";

export const SAVED_LOCATIONS_COLLECTION = "savedLocations";

export type SavedLocation = {
  id: string;
  userId: string;
  label: string;
  latitude: number;
  longitude: number;
  address: string;
  isHome: boolean;
  createdAtSeconds: number;
};

const normalizeSavedLocation = (id: string, data: any): SavedLocation => ({
  id,
  userId: data.userId || "",
  label: data.label || "",
  latitude: typeof data.latitude === "number" ? data.latitude : 0,
  longitude: typeof data.longitude === "number" ? data.longitude : 0,
  address: data.address || "",
  isHome: data.isHome === true,
  createdAtSeconds: data.createdAt?.seconds || 0,
});

// Home first, then newest-first — sorted client-side so a composite index
// (isHome + createdAt) is never needed.
const sortSavedLocations = (list: SavedLocation[]): SavedLocation[] =>
  [...list].sort((a, b) => {
    if (a.isHome !== b.isHome) return a.isHome ? -1 : 1;
    return b.createdAtSeconds - a.createdAtSeconds;
  });

export const subscribeMySavedLocations = (
  onUpdate: (locations: SavedLocation[]) => void,
): (() => void) => {
  const user = auth.currentUser;
  if (!user) {
    onUpdate([]);
    return () => {};
  }

  return onSnapshot(
    query(collection(db, SAVED_LOCATIONS_COLLECTION), where("userId", "==", user.uid)),
    (snap) => {
      onUpdate(sortSavedLocations(snap.docs.map((d) => normalizeSavedLocation(d.id, d.data()))));
    },
    (error) => {
      console.log("Listener failed:", {
        feature: "subscribeMySavedLocations",
        collection: SAVED_LOCATIONS_COLLECTION,
        code: error.code,
        message: error.message,
      });
      onUpdate([]);
    },
  );
};

export type CreateSavedLocationInput = {
  label: string;
  latitude: number;
  longitude: number;
  address: string;
  isHome?: boolean;
};

// Firestore transactions can't run a `where` query mid-transaction (same
// constraint noted throughout schoolTripsLib.ts) — "at most one Home" is
// enforced with a plain read-then-write sequence instead. A user only ever
// changes their own Home from their own single session, so there's no
// concurrent-write race worth guarding against here.
const clearExistingHome = async (userId: string): Promise<void> => {
  const snap = await getDocs(
    query(
      collection(db, SAVED_LOCATIONS_COLLECTION),
      where("userId", "==", userId),
      where("isHome", "==", true),
    ),
  );

  await Promise.all(
    snap.docs.map((d) => updateDoc(doc(db, SAVED_LOCATIONS_COLLECTION, d.id), { isHome: false })),
  );
};

export const createSavedLocation = async (input: CreateSavedLocationInput): Promise<string> => {
  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t("auth.pleaseLoginFirst"));

  const cleanLabel = input.label.trim();
  if (!cleanLabel) throw new Error(i18n.t("savedLocations.labelRequired"));

  if (input.isHome) {
    await clearExistingHome(user.uid);
  }

  const ref = await addDoc(collection(db, SAVED_LOCATIONS_COLLECTION), {
    userId: user.uid,
    label: cleanLabel,
    latitude: input.latitude,
    longitude: input.longitude,
    address: input.address,
    isHome: input.isHome === true,
    createdAt: serverTimestamp(),
  });

  return ref.id;
};

export type UpdateSavedLocationInput = {
  label?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
};

export const updateSavedLocation = async (
  id: string,
  updates: UpdateSavedLocationInput,
): Promise<void> => {
  if (!auth.currentUser) throw new Error(i18n.t("auth.pleaseLoginFirst"));

  const payload: Record<string, unknown> = {};

  if (updates.label !== undefined) {
    const clean = updates.label.trim();
    if (!clean) throw new Error(i18n.t("savedLocations.labelRequired"));
    payload.label = clean;
  }
  if (updates.latitude !== undefined) payload.latitude = updates.latitude;
  if (updates.longitude !== undefined) payload.longitude = updates.longitude;
  if (updates.address !== undefined) payload.address = updates.address;

  await updateDoc(doc(db, SAVED_LOCATIONS_COLLECTION, id), payload);
};

// See clearExistingHome's own comment on why this is a plain read+write
// sequence, not a transaction.
export const setSavedLocationAsHome = async (id: string): Promise<void> => {
  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t("auth.pleaseLoginFirst"));

  await clearExistingHome(user.uid);
  await updateDoc(doc(db, SAVED_LOCATIONS_COLLECTION, id), { isHome: true });
};

export const deleteSavedLocation = async (id: string): Promise<void> => {
  if (!auth.currentUser) throw new Error(i18n.t("auth.pleaseLoginFirst"));
  await deleteDoc(doc(db, SAVED_LOCATIONS_COLLECTION, id));
};
