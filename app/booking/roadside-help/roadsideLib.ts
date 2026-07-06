// ---------------------------------------------------------------------------
// Roadside Help – shared Firestore + geo logic
//
// This module centralises everything the passenger and driver screens need so
// the UI files stay small and consistent. It talks to these collections:
//   - roadsideRequests    (one doc per passenger help request)
//   - driverNotifications (one doc per driver, per event)
//   - roadsideOffers      (one doc per driver offer on a request)
//
// Matching a passenger to nearby drivers uses driver route coordinates when
// they exist (fromLat/fromLng/toLat/toLng), and falls back to geocoding the
// driver's from/to city text when they don't – so it works with the routes
// that already exist in the database.
// ---------------------------------------------------------------------------

import * as Location from "expo-location";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { auth, db } from "../../../firebase";

export type LatLng = { latitude: number; longitude: number };

// Problem key -> readable title. Keys must match the passenger page (index.tsx).
export const PROBLEM_LABELS: Record<string, string> = {
  flat: "Flat Tire",
  battery: "Dead Battery",
  fuel: "Out of Fuel",
  towing: "Towing",
  other: "Other",
};

// A passenger is treated as "near" a driver route when they are within this
// many km of the route corridor (or of a single known endpoint).
export const MATCH_RADIUS_KM = 20;

// ---------------------------------------------------------------------------
// Geo helpers
// ---------------------------------------------------------------------------

const toRad = (value: number) => (value * Math.PI) / 180;

// Haversine distance in km between two coordinates.
export const distanceKm = (a: LatLng, b: LatLng) => {
  const R = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
};

// Shortest distance (km) from point P to the segment A-B, using a local
// equirectangular projection (accurate enough at city / route scale).
export const distanceToSegmentKm = (p: LatLng, a: LatLng, b: LatLng) => {
  const R = 6371;
  const lat0 = toRad((a.latitude + b.latitude) / 2);

  const project = (c: LatLng) => ({
    x: R * toRad(c.longitude) * Math.cos(lat0),
    y: R * toRad(c.latitude),
  });

  const P = project(p);
  const A = project(a);
  const B = project(b);

  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) return distanceKm(p, a);

  let t = ((P.x - A.x) * dx + (P.y - A.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = A.x + t * dx;
  const projY = A.y + t * dy;

  return Math.hypot(P.x - projX, P.y - projY);
};

// Geocode a place name to coordinates (best effort, cached for this session).
const geocodeCache: Record<string, LatLng | null> = {};

export const geocodePlace = async (place?: string): Promise<LatLng | null> => {
  const key = String(place || "")
    .trim()
    .toLowerCase();

  if (!key) return null;
  if (key in geocodeCache) return geocodeCache[key];

  try {
    const results = await Location.geocodeAsync(key);
    const first = results[0];
    const coord = first
      ? { latitude: first.latitude, longitude: first.longitude }
      : null;

    geocodeCache[key] = coord;
    return coord;
  } catch {
    geocodeCache[key] = null;
    return null;
  }
};

// ---------------------------------------------------------------------------
// Current user helpers
// ---------------------------------------------------------------------------

export type PassengerInfo = {
  id: string;
  name: string;
  phone: string;
};

export const getCurrentPassenger = async (): Promise<PassengerInfo | null> => {
  const user = auth.currentUser;
  if (!user) return null;

  let name = user.displayName || "Passenger";
  let phone = "";

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      const data = snap.data();
      name = data.name || name;
      phone = data.phone || "";
    }
  } catch {
    // Fall back to the auth profile values.
  }

  return { id: user.uid, name, phone };
};

// ---------------------------------------------------------------------------
// Driver matching
// ---------------------------------------------------------------------------

type DriverRouteData = {
  driverId?: string;
  from?: string;
  to?: string;
  fromLat?: number;
  fromLng?: number;
  toLat?: number;
  toLng?: number;
  active?: boolean;
};

export type MatchedDriver = { driverId: string; distanceKm: number };

const routeEndpoints = async (route: DriverRouteData) => {
  const from: LatLng | null =
    typeof route.fromLat === "number" && typeof route.fromLng === "number"
      ? { latitude: route.fromLat, longitude: route.fromLng }
      : await geocodePlace(route.from);

  const to: LatLng | null =
    typeof route.toLat === "number" && typeof route.toLng === "number"
      ? { latitude: route.toLat, longitude: route.toLng }
      : await geocodePlace(route.to);

  return { from, to };
};

// Returns one entry per matching driver, with the closest distance (km) from
// the passenger to any of that driver's routes.
export const findMatchingDrivers = async (
  passenger: LatLng,
  passengerId: string,
): Promise<MatchedDriver[]> => {
  const snapshot = await getDocs(collection(db, "driverRoutes"));

  const best: Record<string, number> = {};

  for (const docSnap of snapshot.docs) {
    const route = docSnap.data() as DriverRouteData;

    if (route.active === false) continue;
    if (!route.driverId) continue;
    if (route.driverId === passengerId) continue; // never notify yourself

    const { from, to } = await routeEndpoints(route);

    let dist: number | null = null;

    if (from && to) {
      dist = distanceToSegmentKm(passenger, from, to);
    } else if (from) {
      dist = distanceKm(passenger, from);
    } else if (to) {
      dist = distanceKm(passenger, to);
    }

    if (dist === null || dist > MATCH_RADIUS_KM) continue;

    if (best[route.driverId] === undefined || dist < best[route.driverId]) {
      best[route.driverId] = dist;
    }
  }

  return Object.entries(best).map(([driverId, d]) => ({
    driverId,
    distanceKm: Math.round(d * 10) / 10,
  }));
};

// ---------------------------------------------------------------------------
// Passenger: create a request + notify nearby drivers
// ---------------------------------------------------------------------------

export type RoadsideLocation = LatLng & { address?: string };

export type CreateRequestInput = {
  problemKeys: string[];
  problemTitles: string[];
  description: string;
  location: RoadsideLocation;
};

export const createRoadsideRequest = async (
  input: CreateRequestInput,
): Promise<{ requestId: string; matchedCount: number }> => {
  const passenger = await getCurrentPassenger();
  if (!passenger) throw new Error("You must be logged in to request help.");

  const location = {
    latitude: input.location.latitude,
    longitude: input.location.longitude,
    address: input.location.address || "",
  };

  const requestRef = await addDoc(collection(db, "roadsideRequests"), {
    passengerId: passenger.id,
    passengerName: passenger.name,
    passengerPhone: passenger.phone,
    problemTypes: input.problemTitles,
    problemKeys: input.problemKeys,
    description: input.description,
    location,
    status: "pending",
    selectedDriverId: null,
    selectedOfferId: null,
    createdAt: serverTimestamp(),
  });

  const matches = await findMatchingDrivers(
    { latitude: location.latitude, longitude: location.longitude },
    passenger.id,
  );

  // Privacy: the initial notification never carries the passenger phone
  // (or name). Those are only revealed once the passenger accepts an offer.
  await Promise.all(
    matches.map((match) =>
      addDoc(collection(db, "driverNotifications"), {
        driverId: match.driverId,
        requestId: requestRef.id,
        type: "roadside_help",
        title: "Roadside help nearby",
        message: "A passenger near your route needs help",
        problemTypes: input.problemTitles,
        description: input.description,
        passengerLocation: location,
        distanceKm: match.distanceKm,
        status: "new",
        read: false,
        createdAt: serverTimestamp(),
      }),
    ),
  );

  return { requestId: requestRef.id, matchedCount: matches.length };
};

// ---------------------------------------------------------------------------
// Driver: send an offer / reject a request
// ---------------------------------------------------------------------------

export type SendOfferInput = {
  requestId: string;
  notificationId: string;
  price: number;
  etaMinutes: number;
};

export const sendDriverOffer = async (input: SendOfferInput) => {
  const user = auth.currentUser;
  if (!user) throw new Error("You must be logged in.");

  let driverName = user.displayName || "Driver";
  let driverGender = "";
  let driverPhone = "";
  const driverRating = 4.8;

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      const data = snap.data();
      driverName = data.name || driverName;
      driverGender = data.gender || "";
      driverPhone = data.phone || "";
    }
  } catch {
    // Use the fallbacks above.
  }

  // The driver phone is stored on the offer so the passenger can see/contact
  // the driver as soon as the offer arrives.
  const offerRef = await addDoc(collection(db, "roadsideOffers"), {
    requestId: input.requestId,
    driverId: user.uid,
    driverName,
    driverGender,
    driverPhone,
    driverRating,
    price: input.price,
    etaMinutes: input.etaMinutes,
    status: "sent",
    createdAt: serverTimestamp(),
  });

  // This driver's notification becomes "offered".
  await updateDoc(doc(db, "driverNotifications", input.notificationId), {
    status: "offered",
    read: true,
    offerId: offerRef.id,
  });

  // Move the request forward (best effort – it may already be further along).
  try {
    await updateDoc(doc(db, "roadsideRequests", input.requestId), {
      status: "offer_received",
    });
  } catch {
    // Non-fatal.
  }

  return offerRef.id;
};

export const rejectNotification = async (notificationId: string) => {
  await updateDoc(doc(db, "driverNotifications", notificationId), {
    status: "rejected",
    read: true,
  });
};

export const markNotificationRead = async (notificationId: string) => {
  await updateDoc(doc(db, "driverNotifications", notificationId), {
    read: true,
  });
};

// ---------------------------------------------------------------------------
// Passenger: accept / reject an offer
// ---------------------------------------------------------------------------

export type AcceptableOffer = {
  id: string;
  driverId: string;
  driverName?: string;
  price?: number;
  etaMinutes?: number;
};

export const acceptOffer = async (
  requestId: string,
  offer: AcceptableOffer,
) => {
  const reqRef = doc(db, "roadsideRequests", requestId);
  const reqSnap = await getDoc(reqRef);
  const req: any = reqSnap.exists() ? reqSnap.data() : {};

  // Accept the chosen offer.
  await updateDoc(doc(db, "roadsideOffers", offer.id), {
    status: "accepted_by_passenger",
  });

  // Reject every other offer on this request.
  const offersSnap = await getDocs(
    query(collection(db, "roadsideOffers"), where("requestId", "==", requestId)),
  );

  await Promise.all(
    offersSnap.docs
      .filter((d) => d.id !== offer.id)
      .map((d) =>
        updateDoc(doc(db, "roadsideOffers", d.id), {
          status: "rejected_by_passenger",
        }),
      ),
  );

  // Update the request with the selected driver / offer.
  await updateDoc(reqRef, {
    status: "driver_selected",
    selectedDriverId: offer.driverId,
    selectedOfferId: offer.id,
  });

  // Reveal the passenger contact details + final offer terms on the driver's
  // notification. These fields are the same on both the update and create paths.
  const acceptedFields = {
    type: "roadside_help",
    status: "accepted",
    title: "Passenger accepted your help",
    message: "The passenger accepted your offer. Go help them.",
    problemTypes: req.problemTypes || [],
    description: req.description || "",
    passengerName: req.passengerName || "Passenger",
    passengerPhone: req.passengerPhone || "",
    passengerLocation: req.location || null,
    price: offer.price ?? null,
    etaMinutes: offer.etaMinutes ?? null,
    offerId: offer.id,
    read: false,
  };

  // Update the SAME notification the driver already has for this request, so
  // its card just changes status to "accepted" instead of a duplicate appearing.
  const notifsSnap = await getDocs(
    query(
      collection(db, "driverNotifications"),
      where("requestId", "==", requestId),
    ),
  );

  const existing = notifsSnap.docs.find(
    (d) => d.data().driverId === offer.driverId,
  );

  if (existing) {
    await updateDoc(doc(db, "driverNotifications", existing.id), acceptedFields);
  } else {
    // Fallback only (e.g. the original notification was deleted): create one so
    // the acceptance is never lost.
    await addDoc(collection(db, "driverNotifications"), {
      driverId: offer.driverId,
      requestId,
      ...acceptedFields,
      createdAt: serverTimestamp(),
    });
  }
};

export const rejectOffer = async (offerId: string) => {
  await updateDoc(doc(db, "roadsideOffers", offerId), {
    status: "rejected_by_passenger",
  });
};

// ---------------------------------------------------------------------------
// Driver: mark an accepted roadside help as completed
//
// Sets status "completed" on the request, offer and notification, then writes a
// single completed `bookings` document that is visible to BOTH the passenger
// (passengerId) and the driver (driverId) under My Bookings. The completed
// notification is filtered out of the driver's active Help Requests list.
// ---------------------------------------------------------------------------

export const completeRoadsideHelp = async (params: {
  requestId: string;
  notificationId: string;
  offerId?: string | null;
}) => {
  const user = auth.currentUser;
  if (!user) throw new Error("You must be logged in.");

  const reqRef = doc(db, "roadsideRequests", params.requestId);
  const reqSnap = await getDoc(reqRef);
  const req: any = reqSnap.exists() ? reqSnap.data() : {};

  // Guard against creating a duplicate booking if it was already completed.
  if (req.status === "completed") {
    await updateDoc(doc(db, "driverNotifications", params.notificationId), {
      status: "completed",
      read: true,
    });
    return;
  }

  // Resolve the accepted offer (prefer the id we already have).
  let offerId = params.offerId || req.selectedOfferId || null;
  let offer: any = {};

  if (offerId) {
    const offerSnap = await getDoc(doc(db, "roadsideOffers", offerId));
    if (offerSnap.exists()) offer = offerSnap.data();
  } else {
    const offersSnap = await getDocs(
      query(
        collection(db, "roadsideOffers"),
        where("requestId", "==", params.requestId),
      ),
    );
    const mine =
      offersSnap.docs.find(
        (d) =>
          d.data().driverId === user.uid &&
          d.data().status === "accepted_by_passenger",
      ) || offersSnap.docs.find((d) => d.data().driverId === user.uid);

    if (mine) {
      offerId = mine.id;
      offer = mine.data();
    }
  }

  // Driver identity for the booking (offer values first, users doc as backup).
  let driverName = offer.driverName || user.displayName || "Driver";
  let driverPhone = offer.driverPhone || "";

  if (!driverPhone) {
    try {
      const us = await getDoc(doc(db, "users", user.uid));
      if (us.exists()) {
        const d = us.data();
        driverName = offer.driverName || d.name || driverName;
        driverPhone = d.phone || "";
      }
    } catch {
      // Keep fallbacks.
    }
  }

  // 1) request -> completed
  await updateDoc(reqRef, {
    status: "completed",
    completedAt: serverTimestamp(),
  });

  // 2) offer -> completed
  if (offerId) {
    await updateDoc(doc(db, "roadsideOffers", offerId), {
      status: "completed",
      completedAt: serverTimestamp(),
    });
  }

  // 3) notification -> completed (removes it from the active list)
  await updateDoc(doc(db, "driverNotifications", params.notificationId), {
    status: "completed",
    read: true,
    completedAt: serverTimestamp(),
  });

  // 4) create the completed booking (shared by passenger + driver tabs)
  const location = req.location || null;

  await addDoc(collection(db, "bookings"), {
    type: "roadside_help",
    category: "roadside",

    passengerId: req.passengerId || null,
    passengerName: req.passengerName || "Passenger",
    passengerPhone: req.passengerPhone || "",

    driverId: user.uid,
    driverName,
    driverPhone,

    problemTypes: req.problemTypes || [],
    description: req.description || "",
    location,
    address: location?.address || "",

    price: offer.price ?? null,
    etaMinutes: offer.etaMinutes ?? null,

    status: "completed",
    roleType: "roadside_completed",
    requestId: params.requestId,

    createdAt: serverTimestamp(),
    completedAt: serverTimestamp(),
  });
};
