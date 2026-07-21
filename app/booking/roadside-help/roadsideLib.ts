// ---------------------------------------------------------------------------
// Roadside Help – shared Firestore + geo logic
//
// This module centralises everything the passenger and driver screens need so
// the UI files stay small and consistent. It talks to these collections:
//   - roadsideRequests    (one doc per passenger help request)
//   - driverNotifications (one doc per driver, per new-request event — feeds
//                          the driver's "Help Requests" discovery screen)
//   - roadsideOffers      (one doc per driver offer on a request)
//   - bookings            (one doc per ACCEPTED request — created the moment
//                          the passenger accepts an offer, then updated in
//                          place through "driver on the way" -> "completed"
//                          -> "completed_paid". This is the SAME collection
//                          School/Personal/etc bookings live in, so My
//                          Bookings shows it automatically for both sides.)
//   - notifications        (the single canonical in-app notification feed —
//                          see notify() in workErrandLib.ts)
//
// Status vocabulary (spec):
//   roadsideOffers.status  : "pending" | "accepted" | "not_selected" | "completed"
//   roadsideRequests.status: "pending" | "accepted" | "completed" | "completed_paid"
//   roadsideRequests.paymentStatus: "not_due" | "pending" | "paid"
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
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { auth, db } from "../../../firebase";
import i18n from "../../i18n";
import { notify } from "../work-errand/workErrandLib";

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

// Google Maps turn-by-turn directions link, matching the pattern already
// used in app/driver/ride-navigation.tsx. Includes the driver's current
// location as the origin when it's known (best effort, never blocking).
export const buildDirectionsUrl = (
  destination: LatLng,
  origin?: LatLng | null,
) => {
  const originParam = origin
    ? `&origin=${origin.latitude},${origin.longitude}`
    : "";

  return `https://www.google.com/maps/dir/?api=1${originParam}&destination=${destination.latitude},${destination.longitude}`;
};

export const getCurrentPositionBestEffort = async (): Promise<LatLng | null> => {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return null;

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch {
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
  if (!passenger) throw new Error(i18n.t("roadsideHelp.mustBeLoggedInToRequestHelp"));

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
    // Top-level lat/lng too (in addition to location.latitude/longitude) so
    // "Go help passenger" can read either shape directly off the request.
    latitude: location.latitude,
    longitude: location.longitude,
    status: "pending",
    selectedOfferId: null,
    selectedDriverId: null,
    selectedDriverName: null,
    agreedPrice: null,
    etaMinutes: null,
    paymentStatus: "not_due",
    helpCompleted: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
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
//
// Sending an offer notifies the passenger through the shared notifications
// feed (roadside_offer_received), so tapping it opens Finding Help with this
// exact offer highlighted — see notifications.tsx / waiting.tsx.
// ---------------------------------------------------------------------------

export type SendOfferInput = {
  requestId: string;
  notificationId: string;
  price: number;
  etaMinutes: number;
};

export const sendDriverOffer = async (input: SendOfferInput) => {
  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t("roadsideHelp.mustBeLoggedIn"));

  let driverName = user.displayName || "Driver";
  let driverGender = "";
  let driverPhone = "";

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

  const reqSnap = await getDoc(doc(db, "roadsideRequests", input.requestId));
  const req: any = reqSnap.exists() ? reqSnap.data() : null;
  const passengerId = req?.passengerId || null;
  const passengerName = req?.passengerName || "Passenger";

  // The driver phone is stored on the offer so the passenger can see/contact
  // the driver as soon as the offer arrives.
  const offerRef = await addDoc(collection(db, "roadsideOffers"), {
    requestId: input.requestId,
    passengerId,
    passengerName,
    driverId: user.uid,
    driverName,
    driverGender,
    driverPhone,
    offeredPrice: input.price,
    estimatedArrivalMinutes: input.etaMinutes,
    status: "pending",
    paymentStatus: "unpaid",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // This driver's notification becomes "offered" (removes it from the
  // pending list in the Help Requests discovery screen).
  await updateDoc(doc(db, "driverNotifications", input.notificationId), {
    status: "offered",
    read: true,
    offerId: offerRef.id,
  });

  if (passengerId) {
    await notify({
      receiverId: passengerId,
      senderId: user.uid,
      type: "roadside_offer_received",
      title: "New help offer",
      message: `${driverName} offered to help you.`,
      category: "roadside",
      requestId: input.requestId,
      offerId: offerRef.id,
      driverId: user.uid,
      targetPage: "finding-help",
    });
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
//
// Accepting creates the ONE `bookings` document that represents this
// accepted roadside help for the rest of its life (accepted -> completed ->
// completed_paid). Both the passenger (passengerId) and the driver
// (driverId) read it via the exact same "bookings" listeners School/
// Personal/Work/Errand already use in My Bookings, so no separate roadside
// listener is needed there.
// ---------------------------------------------------------------------------

export type AcceptableOffer = {
  id: string;
  driverId: string;
  driverName?: string;
  driverPhone?: string;
  price?: number;
  etaMinutes?: number;
};

// Accepting is a single Firestore transaction across every sibling offer +
// the request + the new booking doc, so it's never possible for one
// document to say "accepted" while another still says "pending" (spec #9).
// The sibling offer ids are looked up with a plain query first (Firestore
// transactions can't run queries), then every actual read/write for those
// specific doc refs happens inside the transaction.
export const acceptOffer = async (
  requestId: string,
  offer: AcceptableOffer,
): Promise<string> => {
  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t("roadsideHelp.mustBeLoggedIn"));

  const reqRef = doc(db, "roadsideRequests", requestId);

  const offersSnap = await getDocs(
    query(collection(db, "roadsideOffers"), where("requestId", "==", requestId)),
  );
  const offerRefs = offersSnap.docs.map((d) => doc(db, "roadsideOffers", d.id));

  const bookingRef = doc(collection(db, "bookings"));
  let passengerName = "The passenger";

  await runTransaction(db, async (transaction) => {
    const reqSnap = await transaction.get(reqRef);

    if (!reqSnap.exists()) throw new Error(i18n.t("roadsideHelp.requestNoLongerExists"));

    const req: any = reqSnap.data();
    passengerName = req.passengerName || passengerName;

    if (req.passengerId !== user.uid) {
      throw new Error(i18n.t("roadsideHelp.onlyPassengerCanAccept"));
    }

    if (req.status && req.status !== "pending") {
      throw new Error(i18n.t("workErrand.requestAlreadyHandled"));
    }

    offerRefs.forEach((ref) => {
      if (ref.id === offer.id) {
        transaction.update(ref, {
          status: "accepted",
          acceptedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        transaction.update(ref, {
          status: "not_selected",
          updatedAt: serverTimestamp(),
        });
      }
    });

    const price = offer.price ?? null;
    const etaMinutes = offer.etaMinutes ?? null;
    const location = req.location || null;
    const address = location?.address || req.address || "";
    const latitude =
      typeof req.latitude === "number" ? req.latitude : (location?.latitude ?? null);
    const longitude =
      typeof req.longitude === "number" ? req.longitude : (location?.longitude ?? null);
    const serviceType =
      req.serviceType ||
      (Array.isArray(req.problemTypes) ? req.problemTypes.join(", ") : "") ||
      "Roadside Help";

    transaction.update(reqRef, {
      status: "accepted",
      selectedOfferId: offer.id,
      selectedDriverId: offer.driverId,
      selectedDriverName: offer.driverName || "Driver",
      selectedDriverPhone: offer.driverPhone || "",
      passengerId: req.passengerId,
      passengerName: req.passengerName || "Passenger",
      passengerPhone: req.passengerPhone || "",
      serviceType,
      address,
      latitude,
      longitude,
      agreedPrice: price,
      etaMinutes,
      estimatedArrivalMinutes: etaMinutes,
      paymentStatus: "not_due",
      bookingId: bookingRef.id,
      acceptedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    transaction.set(bookingRef, {
      type: "roadside_help",
      category: "roadside",

      passengerId: req.passengerId || null,
      passengerName: req.passengerName || "Passenger",
      passengerPhone: req.passengerPhone || "",

      driverId: offer.driverId,
      driverName: offer.driverName || "Driver",
      driverPhone: offer.driverPhone || "",

      problemTypes: req.problemTypes || [],
      description: req.description || "",
      location,
      address,
      latitude,
      longitude,

      price,
      etaMinutes,

      status: "ongoing",
      tripStatus: "booked",
      roleType: "roadside_accepted",
      requestId,
      offerId: offer.id,
      paymentStatus: "not_due",
      helpCompleted: false,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  await notify({
    receiverId: offer.driverId,
    senderId: user.uid,
    type: "roadside_offer_accepted",
    title: "Passenger accepted your offer",
    message: `${passengerName} accepted your Roadside Help offer.`,
    category: "roadside",
    requestId,
    offerId: offer.id,
    bookingId: bookingRef.id,
    passengerId: user.uid,
    targetTab: "driver",
  });

  return bookingRef.id;
};

export const rejectOffer = async (offerId: string) => {
  await updateDoc(doc(db, "roadsideOffers", offerId), {
    status: "not_selected",
    updatedAt: serverTimestamp(),
  });
};

// ---------------------------------------------------------------------------
// Driver-facing "accepted request" record — the single source of truth read
// by BOTH the Help Requests screen and My Bookings -> Driver tab (shared
// RoadsideAcceptedCard component). Both screens subscribe to
// `roadsideRequests` where selectedDriverId == me with their own onSnapshot
// listener, normalize with this same function, and render with the same
// component, so there is exactly one status/action code path regardless of
// which screen the driver is on.
// ---------------------------------------------------------------------------

export type RoadsideRequestRecord = {
  id: string; // requestId
  bookingId: string;
  selectedOfferId: string;
  passengerId: string;
  passengerName: string;
  passengerPhone: string;
  serviceType: string;
  problemTypes: string[];
  address: string;
  latitude: number | null;
  longitude: number | null;
  agreedPrice: number | null;
  estimatedArrivalMinutes: number | null;
  // "accepted" | "driver_on_the_way" | "completed" | "completed_paid"
  status: string;
  // "not_due" | "pending" | "paid"
  paymentStatus: string;
  helpCompleted: boolean;
  paidAmount: number | null;
};

export const normalizeRoadsideRequest = (
  id: string,
  data: any,
): RoadsideRequestRecord => ({
  id,
  bookingId: data.bookingId || "",
  selectedOfferId: data.selectedOfferId || "",
  passengerId: data.passengerId || "",
  passengerName: data.passengerName || "Passenger",
  passengerPhone: data.passengerPhone || "",
  serviceType:
    data.serviceType ||
    (Array.isArray(data.problemTypes) ? data.problemTypes.join(", ") : "") ||
    "Roadside Help",
  problemTypes: Array.isArray(data.problemTypes) ? data.problemTypes : [],
  address: data.address || data.location?.address || "",
  latitude:
    typeof data.latitude === "number"
      ? data.latitude
      : (data.location?.latitude ?? null),
  longitude:
    typeof data.longitude === "number"
      ? data.longitude
      : (data.location?.longitude ?? null),
  agreedPrice: typeof data.agreedPrice === "number" ? data.agreedPrice : null,
  estimatedArrivalMinutes:
    typeof data.estimatedArrivalMinutes === "number"
      ? data.estimatedArrivalMinutes
      : typeof data.etaMinutes === "number"
        ? data.etaMinutes
        : null,
  status: data.status || "pending",
  paymentStatus: data.paymentStatus || "not_due",
  helpCompleted: data.helpCompleted === true,
  paidAmount: typeof data.paidAmount === "number" ? data.paidAmount : null,
});

// ---------------------------------------------------------------------------
// Driver: "Go help passenger" — opens turn-by-turn directions and (best
// effort) tells the passenger the driver is on the way.
// ---------------------------------------------------------------------------

export const markDriverOnTheWay = async (params: {
  bookingId: string;
  requestId: string;
}) => {
  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t("roadsideHelp.mustBeLoggedIn"));

  const reqRef = doc(db, "roadsideRequests", params.requestId);
  const reqSnap = await getDoc(reqRef);

  if (!reqSnap.exists()) throw new Error(i18n.t("roadsideHelp.requestNoLongerExists"));

  const req: any = reqSnap.data();

  if (req.selectedDriverId !== user.uid) {
    throw new Error(i18n.t("roadsideHelp.onlyAcceptedDriverCanDoThis"));
  }

  const driverName = req.selectedDriverName || "The driver";

  await updateDoc(reqRef, {
    status: "driver_on_the_way",
    driverOnTheWayAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (req.passengerId) {
    await notify({
      receiverId: req.passengerId,
      senderId: user.uid,
      type: "roadside_driver_on_way",
      title: "Driver is on the way",
      message: `${driverName} is on the way to help you.`,
      category: "roadside",
      requestId: params.requestId,
      bookingId: params.bookingId,
      driverId: user.uid,
      targetTab: "passenger",
    });
  }
};

// ---------------------------------------------------------------------------
// Driver: mark an accepted roadside help as completed ("Finished Help").
//
// Sets status "completed" on the request, offer and booking, opens the
// passenger's payment gate, and notifies them to pay. Guarded so the same
// help can never be completed twice.
// ---------------------------------------------------------------------------

export const finishRoadsideHelp = async (bookingId: string) => {
  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t("roadsideHelp.mustBeLoggedIn"));

  const bookingRef = doc(db, "bookings", bookingId);

  let requestId = "";
  let offerId = "";
  let passengerId = "";
  let driverName = "The driver";
  let agreedPrice: number | null = null;

  await runTransaction(db, async (transaction) => {
    const bookingSnap = await transaction.get(bookingRef);

    if (!bookingSnap.exists()) {
      throw new Error(i18n.t("rides.bookingNotFound"));
    }

    const booking: any = bookingSnap.data();

    if (booking.driverId !== user.uid) {
      throw new Error(i18n.t("roadsideHelp.onlyAcceptedDriverCanFinish"));
    }

    if (booking.helpCompleted === true || booking.status === "completed") {
      throw new Error(i18n.t("roadsideHelp.helpAlreadyFinished"));
    }

    requestId = booking.requestId || "";
    offerId = booking.offerId || "";
    driverName = booking.driverName || driverName;
    agreedPrice = typeof booking.price === "number" ? booking.price : null;

    const reqRef = doc(db, "roadsideRequests", requestId);
    const reqSnap = await transaction.get(reqRef);
    const req: any = reqSnap.exists() ? reqSnap.data() : {};
    passengerId = req.passengerId || booking.passengerId || "";

    if (reqSnap.exists()) {
      transaction.update(reqRef, {
        status: "completed",
        helpCompleted: true,
        paymentStatus: "pending",
        needsPassengerRating: true,
        ratingSubmitted: false,
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    if (offerId) {
      transaction.update(doc(db, "roadsideOffers", offerId), {
        status: "completed",
        paymentStatus: "pending",
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    transaction.update(bookingRef, {
      status: "completed",
      tripStatus: "completed",
      helpCompleted: true,
      paymentStatus: "pending",
      needsPassengerRating: true,
      ratingSubmitted: false,
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  if (passengerId) {
    await notify({
      receiverId: passengerId,
      senderId: user.uid,
      type: "roadside_payment_required",
      title: "Roadside Help completed",
      message: `${driverName} finished helping you. Please complete payment and rate your helper.`,
      category: "roadside",
      requestId,
      offerId,
      bookingId,
      driverId: user.uid,
      amount: agreedPrice ?? undefined,
      targetPage: "roadside-payment",
    });
  }
};

// ---------------------------------------------------------------------------
// Passenger: pay for completed roadside help.
//
// The amount is always read from the live `roadsideRequests.agreedPrice`
// field inside the transaction — never trusted purely from route params.
// Blocked unless request.status === "completed" && paymentStatus === "pending".
// ---------------------------------------------------------------------------

export type RoadsidePaymentMethod = "cash" | "card" | "bit";

export const payRoadsideHelp = async (
  bookingId: string,
  method: RoadsidePaymentMethod,
): Promise<{ amount: number; driverId: string }> => {
  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t("roadsideHelp.mustBeLoggedIn"));

  const bookingRef = doc(db, "bookings", bookingId);

  let requestId = "";
  let offerId = "";
  let driverId = "";
  let driverName = "your helper";
  let passengerName = "The passenger";
  let amount = 0;
  let needsRating = false;

  await runTransaction(db, async (transaction) => {
    const bookingSnap = await transaction.get(bookingRef);

    if (!bookingSnap.exists()) {
      throw new Error(i18n.t("rides.bookingNotFound"));
    }

    const booking: any = bookingSnap.data();

    if (booking.passengerId !== user.uid) {
      throw new Error(i18n.t("roadsideHelp.onlyPassengerCanPay"));
    }

    requestId = booking.requestId || "";
    offerId = booking.offerId || "";
    driverId = booking.driverId || "";
    driverName = booking.driverName || driverName;
    passengerName = booking.passengerName || passengerName;
    needsRating =
      booking.needsPassengerRating === true &&
      booking.ratingSubmitted !== true;

    const reqRef = doc(db, "roadsideRequests", requestId);
    const reqSnap = await transaction.get(reqRef);

    if (!reqSnap.exists()) {
      throw new Error(i18n.t("roadsideHelp.requestNoLongerExists"));
    }

    const req: any = reqSnap.data();

    if (req.status !== "completed" || req.paymentStatus !== "pending") {
      throw new Error(i18n.t("roadsideHelp.helpNotReadyForPayment"));
    }

    amount = typeof req.agreedPrice === "number" ? req.agreedPrice : 0;

    transaction.update(reqRef, {
      status: "completed_paid",
      paymentStatus: "paid",
      paidBy: user.uid,
      paidTo: driverId,
      paidAmount: amount,
      paidAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (offerId) {
      transaction.update(doc(db, "roadsideOffers", offerId), {
        paymentStatus: "paid",
        paidAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    transaction.update(bookingRef, {
      paymentStatus: "paid",
      paymentMethod: method,
      paidAmount: amount,
      paidAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  if (driverId) {
    await notify({
      receiverId: driverId,
      senderId: user.uid,
      type: "roadside_payment_received",
      title: "Payment received",
      message: `${passengerName} paid ₪${amount} for the Roadside Help service.`,
      category: "roadside",
      requestId,
      offerId,
      bookingId,
      passengerId: user.uid,
      amount,
      targetTab: "driver",
    });
  }

  // Payment just gated the rating modal open — if it's still pending, tell
  // the passenger it's time to rate their helper.
  if (needsRating) {
    await notify({
      receiverId: user.uid,
      senderId: driverId || undefined,
      type: "roadside_rating_required",
      title: "Rate your helper",
      message: `Please rate your Roadside Help experience with ${driverName}.`,
      category: "roadside",
      requestId,
      offerId,
      bookingId,
      driverId,
      targetTab: "passenger",
    });
  }

  return { amount, driverId };
};

// ---------------------------------------------------------------------------
// Passenger: rate the helper after a completed (and paid) Roadside Help.
//
// Mirrors submitRideRating (rideBookingLib.ts) / submitApplicationRating
// (workErrandLib.ts) — same driverReviews + users/{driverId} rating-average
// transaction pattern — but also mirrors the rating onto the linked
// roadsideOffers doc, since Roadside (unlike Ride/Work/Errand) has one.
// Guarded so the same request can never be rated twice.
// ---------------------------------------------------------------------------

export type RatableRoadsideBooking = {
  driverId: string;
  driverName?: string;
  requestId?: string;
  offerId?: string;
};

export const submitRoadsideRating = async (
  bookingId: string,
  booking: RatableRoadsideBooking,
  rating: number,
  comment: string,
) => {
  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t("auth.pleaseLoginFirst"));

  if (!booking.driverId || booking.driverId === user.uid) {
    throw new Error(i18n.t("roadsideHelp.missingDriverIdField"));
  }

  const cleanRating = Math.round(rating);
  if (!Number.isInteger(cleanRating) || cleanRating < 1 || cleanRating > 5) {
    throw new Error(i18n.t("validation.invalidRating"));
  }

  const cleanComment = comment.trim();

  const bookingRef = doc(db, "bookings", bookingId);
  const driverRef = doc(db, "users", booking.driverId);
  // bookingId AS the review doc id — see firestore.rules' driverReviews
  // `allow create`, which requires this to match and rejects a second
  // rating attempt for the same booking outright.
  const reviewRef = doc(db, "driverReviews", bookingId);
  const offerRef = booking.offerId
    ? doc(db, "roadsideOffers", booking.offerId)
    : null;

  const ratingWritePaths = {
    review: `driverReviews/${bookingId}`,
    booking: `bookings/${bookingId}`,
    driver: `users/${booking.driverId}`,
  };
  console.log("[rating] transaction started", ratingWritePaths);

  try {
  await runTransaction(db, async (transaction) => {
    const bookingSnap = await transaction.get(bookingRef);

    if (!bookingSnap.exists()) {
      throw new Error(i18n.t("rides.bookingNotFound"));
    }

    const bookingData: any = bookingSnap.data();

    // Never trust the already-loaded `booking` object — re-verify ownership
    // + real completion against the current server state.
    if (bookingData.passengerId !== user.uid) {
      throw new Error(i18n.t("workErrand.mustBeLoggedIn"));
    }
    if (bookingData.tripStatus !== "completed" || bookingData.status !== "completed") {
      throw new Error(i18n.t("booking.tripNotCompletedYet"));
    }

    // Prevent duplicate ratings — each Roadside Help request can be rated
    // only once.
    if (bookingData.ratingSubmitted === true) {
      return;
    }

    const reviewSnap = await transaction.get(reviewRef);
    if (reviewSnap.exists()) {
      return;
    }

    const driverSnap = await transaction.get(driverRef);
    const driverData: any = driverSnap.exists() ? driverSnap.data() : {};

    const requestId = booking.requestId || bookingData.requestId || "";
    const reqRef = requestId ? doc(db, "roadsideRequests", requestId) : null;
    const reqSnap = reqRef ? await transaction.get(reqRef) : null;

    const oldCount = Number(driverData.ratingCount) || 0;
    const oldSum = Number(driverData.ratingSum) || 0;

    const newCount = oldCount + 1;
    const newSum = oldSum + cleanRating;
    // Stored RAW (never toFixed()'d) — firestore.rules checks
    // ratingAverage == ratingSum / ratingCount for exact equality.
    const newAverage = newSum / newCount;

    transaction.set(reviewRef, {
      bookingId,
      requestId: booking.requestId || "",
      offerId: booking.offerId || "",
      category: "roadside",

      driverId: booking.driverId,
      driverName: booking.driverName || "Driver",

      passengerId: user.uid,
      passengerName: bookingData.passengerName || user.displayName || "Passenger",

      rating: cleanRating,
      comment: cleanComment,
      reviewComment: cleanComment,

      from: "",
      to: "",
      date: "",
      time: "",

      createdAt: serverTimestamp(),
    });

    transaction.update(bookingRef, {
      rating: cleanRating,
      reviewComment: cleanComment,
      ratingSubmitted: true,
      needsPassengerRating: false,
      ratedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (offerRef) {
      transaction.update(offerRef, {
        rating: cleanRating,
        reviewComment: cleanComment,
        ratingSubmitted: true,
        ratedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    // Keeps Help Requests (which reads roadsideRequests, not bookings) in
    // sync with My Bookings so both screens agree the rating is done.
    if (reqSnap && reqSnap.exists()) {
      transaction.update(reqRef!, {
        rating: cleanRating,
        reviewComment: cleanComment,
        ratingSubmitted: true,
        needsPassengerRating: false,
        ratedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    transaction.set(
      driverRef,
      {
        ratingCount: newCount,
        ratingSum: newSum,
        ratingAverage: newAverage,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  });

    console.log("[rating] transaction succeeded", { bookingId });
  } catch (error) {
    console.log("[rating] transaction failed", { ...ratingWritePaths, error });
    throw error;
  }
};
