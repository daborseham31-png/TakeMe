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
import { getDriverSuspensionBlockedReason } from "../driverViolationsLib";
import { notify, NotifyInput } from "../work-errand/workErrandLib";

// ---------------------------------------------------------------------------
// Roadside Help notifications — EVERY external (OneSignal/Cloudflare Worker)
// push for Roadside Help goes through the shared notify() (workErrandLib.ts)
// via this one thin wrapper, never a second implementation of the
// Worker/OneSignal call in this file. The wrapper only adds temporary
// diagnostic logging (event/senderId/receiverId/requestId/offerId/
// notificationId/push result) on top of notify()'s own result — safe to
// delete later without touching notify() itself.
// ---------------------------------------------------------------------------
const notifyRoadside = async (input: NotifyInput): Promise<void> => {
  const result = await notify(input);

  console.log("[RoadsideNotify]", {
    event: input.type,
    senderId: input.senderId || auth.currentUser?.uid || null,
    receiverId: input.receiverId,
    requestId: input.requestId || null,
    offerId: input.offerId || null,
    notificationId: result.notificationId,
    push: result.push,
  });
};

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
    // The unified pickupLocation shape (see PickupLocationPicker.tsx) —
    // written alongside the legacy fields above, never replacing them.
    // Always "current": this screen auto-captures GPS on open and only
    // ever lets the passenger fine-tune that same point (drag/tap), it has
    // no "search a different address" capability, so there's no real
    // "custom" pick to distinguish here.
    pickupLocation: { ...location, source: "current" as const },
    status: "open",
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

  // Same eligible-driver list as the driverNotifications writes above (the
  // Help Requests discovery screen's own eligibility/filter logic —
  // findMatchingDrivers), so the shared in-app + external push pipeline
  // reaches exactly the same drivers as the in-app list does, never more,
  // never fewer. driverNotifications above still exists separately — it
  // feeds the Help Requests LIST itself; this is what actually gets an
  // external OneSignal push to a driver who isn't already looking at that
  // screen.
  await Promise.all(
    matches.map((match) =>
      notifyRoadside({
        receiverId: match.driverId,
        senderId: passenger.id,
        type: "roadside_help_requested",
        title: i18n.t("roadsideHelp.newRequestNotifTitle"),
        message: i18n.t("roadsideHelp.newRequestNotifMessage"),
        category: "roadside",
        status: "open",
        requestId: requestRef.id,
        driverId: match.driverId,
        passengerId: passenger.id,
        targetPage: "help-requests",
        targetTab: "driver",
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

  // A suspended driver may not send/accept Roadside Help offers — same
  // cancellation-standing check every other "creates/accepts driver work"
  // action in this app already runs (see driverViolationsLib.ts).
  const suspended = await getDriverSuspensionBlockedReason(user.uid);
  if (suspended) throw new Error(suspended);

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
    await notifyRoadside({
      receiverId: passengerId,
      senderId: user.uid,
      type: "roadside_offer_received",
      title: "New help offer",
      message: `${driverName} offered to help you.`,
      category: "roadside",
      status: "pending",
      requestId: input.requestId,
      offerId: offerRef.id,
      driverId: user.uid,
      passengerId,
      targetPage: "finding-help",
      targetTab: "passenger",
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
//
// `paymentMethod` is chosen by the passenger in the accept-offer
// confirmation modal (see waiting.tsx) and is written here, once, alongside
// the acceptance itself — firestore.rules then freezes selectedDriverId,
// agreedPrice, and paymentMethod together so none of the three can be
// changed by a later client write.
export const acceptOffer = async (
  requestId: string,
  offer: AcceptableOffer,
  paymentMethod: RoadsidePaymentMethod,
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

    if (req.status && req.status !== "open") {
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
    // req.pickupLocation always exists for a request created after this
    // field was added — synthesized here only for a request that predates
    // it, from the same legacy fields already being read above.
    const pickupLocation =
      req.pickupLocation ||
      (latitude != null && longitude != null
        ? { latitude, longitude, address, source: "current" as const }
        : null);

    transaction.update(reqRef, {
      status: "helper_assigned",
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
      paymentMethod,
      paymentStatus: "selected",
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
      pickupLocation,

      price,
      etaMinutes,

      status: "ongoing",
      tripStatus: "booked",
      trackingEnabled: false,
      roleType: "roadside_accepted",
      requestId,
      offerId: offer.id,
      paymentMethod,
      paymentStatus: "selected",
      helpCompleted: false,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  await notifyRoadside({
    receiverId: offer.driverId,
    senderId: user.uid,
    type: "roadside_offer_accepted",
    title: "Passenger accepted your offer",
    message: `${passengerName} accepted your Roadside Help offer.`,
    category: "roadside",
    status: "helper_assigned",
    requestId,
    offerId: offer.id,
    bookingId: bookingRef.id,
    driverId: offer.driverId,
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

// Request-level status vocabulary (the passenger/helper-facing stage
// machine — kept deliberately separate from the `bookings` doc's own
// ride-compatible `tripStatus`, which exists purely so this feature can
// reuse the SAME live-tracking screen / cancellation-eligibility logic
// every other category already uses; see acceptOffer/startDriving/etc.
// below, which always write both in the same transaction).
export type RoadsideRequestStatus =
  | "open"
  | "helper_assigned"
  | "helper_on_way"
  | "arrived"
  | "in_progress"
  | "completion_pending"
  | "completed"
  | "cancelled";

// Older documents (written before this stage machine existed) used a
// smaller vocabulary — mapped forward so an in-flight request from before
// this change still renders sensibly instead of falling through to "open".
const LEGACY_STATUS_MAP: Record<string, RoadsideRequestStatus> = {
  pending: "open",
  accepted: "helper_assigned",
  driver_on_the_way: "helper_on_way",
  completed_paid: "completed",
};

const normalizeRequestStatus = (value: any): RoadsideRequestStatus => {
  if (
    value === "open" ||
    value === "helper_assigned" ||
    value === "helper_on_way" ||
    value === "arrived" ||
    value === "in_progress" ||
    value === "completion_pending" ||
    value === "completed" ||
    value === "cancelled"
  ) {
    return value;
  }

  return LEGACY_STATUS_MAP[value] || "open";
};

export type RoadsidePaymentMethod = "cash" | "bit";

export type RoadsideRequestRecord = {
  id: string; // requestId
  bookingId: string;
  selectedOfferId: string;
  selectedDriverId: string;
  passengerId: string;
  passengerName: string;
  passengerPhone: string;
  serviceType: string;
  problemTypes: string[];
  description: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  agreedPrice: number | null;
  estimatedArrivalMinutes: number | null;
  status: RoadsideRequestStatus;
  // Chosen once at acceptance, never changed afterward.
  paymentMethod: RoadsidePaymentMethod | null;
  // "not_due" | "selected" | "pending" | "paid" | "failed"
  paymentStatus: string;
  helpCompleted: boolean;
  paidAmount: number | null;
  // Used only for sort ordering (Help Requests / My Bookings) — "most
  // recent activity first" within a stage group. Never displayed raw.
  updatedAtSeconds: number;
  createdAtSeconds: number;
};

export const normalizeRoadsideRequest = (
  id: string,
  data: any,
): RoadsideRequestRecord => ({
  id,
  bookingId: data.bookingId || "",
  selectedOfferId: data.selectedOfferId || "",
  selectedDriverId: data.selectedDriverId || "",
  passengerId: data.passengerId || "",
  passengerName: data.passengerName || "Passenger",
  passengerPhone: data.passengerPhone || "",
  serviceType:
    data.serviceType ||
    (Array.isArray(data.problemTypes) ? data.problemTypes.join(", ") : "") ||
    "Roadside Help",
  problemTypes: Array.isArray(data.problemTypes) ? data.problemTypes : [],
  description: data.description || "",
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
  status: normalizeRequestStatus(data.status),
  paymentMethod: data.paymentMethod === "cash" || data.paymentMethod === "bit" ? data.paymentMethod : null,
  paymentStatus: data.paymentStatus || "not_due",
  helpCompleted: data.helpCompleted === true,
  paidAmount: typeof data.paidAmount === "number" ? data.paidAmount : null,
  updatedAtSeconds: data.updatedAt?.seconds || 0,
  createdAtSeconds: data.createdAt?.seconds || 0,
});

// ---------------------------------------------------------------------------
// Driver's OWN sent offers (roadsideOffers where driverId == me) — the
// Help Requests screen merges this alongside RoadsideRequestRecord above so
// the "Offer Sent" stage can show the price/ETA the driver actually
// offered, and so a sibling offer that lost to another driver
// ("not_selected") can be told apart from one still awaiting a response.
// ---------------------------------------------------------------------------

export type MyOfferRecord = {
  id: string;
  requestId: string;
  offeredPrice: number | null;
  estimatedArrivalMinutes: number | null;
  // "pending" | "accepted" | "not_selected" | "completed"
  status: string;
  updatedAtSeconds: number;
  createdAtSeconds: number;
};

export const normalizeMyOffer = (id: string, data: any): MyOfferRecord => ({
  id,
  requestId: data.requestId || "",
  offeredPrice: typeof data.offeredPrice === "number" ? data.offeredPrice : null,
  estimatedArrivalMinutes:
    typeof data.estimatedArrivalMinutes === "number" ? data.estimatedArrivalMinutes : null,
  status: data.status || "pending",
  updatedAtSeconds: data.updatedAt?.seconds || 0,
  createdAtSeconds: data.createdAt?.seconds || 0,
});

// ---------------------------------------------------------------------------
// Helper stage machine — Start Driving -> I've Arrived -> Start Help ->
// Finish Help -> (customer) Confirm Completion -> (cash only) Confirm Cash
// Received. Every step here writes BOTH `roadsideRequests` (the
// request-level RoadsideRequestStatus vocabulary) and `bookings`
// (tripStatus, in the SAME ride-compatible vocabulary live-tracking.tsx and
// cancelGeneralBooking's cancel-eligibility check already understand) in one
// transaction, re-validating the accepted helper's identity and the current
// status against the server's own copy every time — never the caller's
// possibly-stale in-memory copy.
// ---------------------------------------------------------------------------

type StageParams = { bookingId: string; requestId: string };

// Driver: "Start Driving" — begins the trip toward the passenger. The
// caller (RoadsideAcceptedCard) starts the actual `watchPositionAsync`
// foreground tracking right after this resolves; only the Firestore status
// transition + notification happen here.
export const startDriving = async ({ bookingId, requestId }: StageParams) => {
  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t("roadsideHelp.mustBeLoggedIn"));

  const reqRef = doc(db, "roadsideRequests", requestId);
  const bookingRef = doc(db, "bookings", bookingId);
  let passengerId = "";
  let driverName = "The helper";

  await runTransaction(db, async (transaction) => {
    const reqSnap = await transaction.get(reqRef);
    if (!reqSnap.exists()) throw new Error(i18n.t("roadsideHelp.requestNoLongerExists"));

    const req: any = reqSnap.data();
    if (req.selectedDriverId !== user.uid) {
      throw new Error(i18n.t("roadsideHelp.onlyAcceptedDriverCanDoThis"));
    }
    if (req.status !== "helper_assigned") {
      throw new Error(i18n.t("roadsideHelp.actionNotAvailableNow"));
    }

    passengerId = req.passengerId || "";
    driverName = req.selectedDriverName || driverName;

    transaction.update(reqRef, {
      status: "helper_on_way",
      driverOnTheWayAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    transaction.update(bookingRef, {
      tripStatus: "driver_on_way",
      trackingEnabled: true,
      updatedAt: serverTimestamp(),
    });
  });

  if (passengerId) {
    await notifyRoadside({
      receiverId: passengerId,
      senderId: user.uid,
      type: "roadside_driver_on_way",
      title: i18n.t("roadsideHelp.helperOnTheWayNotifTitle"),
      message: i18n.t("roadsideHelp.helperOnTheWayNotifMessage", { name: driverName }),
      category: "roadside",
      status: "helper_on_way",
      requestId,
      bookingId,
      driverId: user.uid,
      passengerId,
      targetTab: "passenger",
    });
  }
};

// Driver: "I've Arrived" — stops live tracking (caller-side) and notifies
// the passenger. The final location fix stays in `tripLocations` untouched
// (only the watcher itself is removed), so the passenger's map keeps
// showing exactly where the helper stopped.
export const markHelperArrived = async ({ bookingId, requestId }: StageParams) => {
  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t("roadsideHelp.mustBeLoggedIn"));

  const reqRef = doc(db, "roadsideRequests", requestId);
  const bookingRef = doc(db, "bookings", bookingId);
  let passengerId = "";
  let driverName = "The helper";

  await runTransaction(db, async (transaction) => {
    const reqSnap = await transaction.get(reqRef);
    if (!reqSnap.exists()) throw new Error(i18n.t("roadsideHelp.requestNoLongerExists"));

    const req: any = reqSnap.data();
    if (req.selectedDriverId !== user.uid) {
      throw new Error(i18n.t("roadsideHelp.onlyAcceptedDriverCanDoThis"));
    }
    if (req.status !== "helper_on_way") {
      throw new Error(i18n.t("roadsideHelp.actionNotAvailableNow"));
    }

    passengerId = req.passengerId || "";
    driverName = req.selectedDriverName || driverName;

    transaction.update(reqRef, {
      status: "arrived",
      arrivedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    transaction.update(bookingRef, {
      tripStatus: "arrived_pickup",
      trackingEnabled: false,
      updatedAt: serverTimestamp(),
    });
  });

  if (passengerId) {
    await notifyRoadside({
      receiverId: passengerId,
      senderId: user.uid,
      type: "roadside_helper_arrived",
      title: i18n.t("roadsideHelp.helperArrivedNotifTitle"),
      message: i18n.t("roadsideHelp.helperArrivedNotifMessage", { name: driverName }),
      category: "roadside",
      status: "arrived",
      requestId,
      bookingId,
      driverId: user.uid,
      passengerId,
      targetTab: "passenger",
    });
  }
};

// Driver: "Start Help" — the helper is now actively working on the problem.
export const startHelp = async ({ bookingId, requestId }: StageParams) => {
  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t("roadsideHelp.mustBeLoggedIn"));

  const reqRef = doc(db, "roadsideRequests", requestId);
  const bookingRef = doc(db, "bookings", bookingId);
  let passengerId = "";

  await runTransaction(db, async (transaction) => {
    const reqSnap = await transaction.get(reqRef);
    if (!reqSnap.exists()) throw new Error(i18n.t("roadsideHelp.requestNoLongerExists"));

    const req: any = reqSnap.data();
    if (req.selectedDriverId !== user.uid) {
      throw new Error(i18n.t("roadsideHelp.onlyAcceptedDriverCanDoThis"));
    }
    if (req.status !== "arrived") {
      throw new Error(i18n.t("roadsideHelp.actionNotAvailableNow"));
    }

    passengerId = req.passengerId || "";

    transaction.update(reqRef, {
      status: "in_progress",
      helpStartedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    transaction.update(bookingRef, {
      tripStatus: "in_progress",
      updatedAt: serverTimestamp(),
    });
  });

  if (passengerId) {
    await notifyRoadside({
      receiverId: passengerId,
      senderId: user.uid,
      type: "roadside_help_in_progress",
      title: i18n.t("roadsideHelp.helpInProgressNotifTitle"),
      message: i18n.t("roadsideHelp.helpInProgressNotifMessage"),
      category: "roadside",
      status: "in_progress",
      requestId,
      bookingId,
      driverId: user.uid,
      passengerId,
      targetTab: "passenger",
    });
  }
};

// Driver: "Finish Help" — moves the request into completion_pending and
// waits for the CUSTOMER to confirm the problem is actually resolved (see
// confirmCompletion below) — the helper can never self-confirm completion.
// Payment stays "selected" (not yet due) until that confirmation happens.
export const finishRoadsideHelp = async (bookingId: string) => {
  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t("roadsideHelp.mustBeLoggedIn"));

  const bookingRef = doc(db, "bookings", bookingId);

  let requestId = "";
  let passengerId = "";
  let driverName = "The helper";

  await runTransaction(db, async (transaction) => {
    const bookingSnap = await transaction.get(bookingRef);
    if (!bookingSnap.exists()) throw new Error(i18n.t("rides.bookingNotFound"));

    const booking: any = bookingSnap.data();
    if (booking.driverId !== user.uid) {
      throw new Error(i18n.t("roadsideHelp.onlyAcceptedDriverCanFinish"));
    }
    if (booking.tripStatus !== "in_progress") {
      throw new Error(i18n.t("roadsideHelp.actionNotAvailableNow"));
    }

    requestId = booking.requestId || "";
    driverName = booking.driverName || driverName;
    passengerId = booking.passengerId || "";

    const reqRef = doc(db, "roadsideRequests", requestId);
    const reqSnap = await transaction.get(reqRef);

    if (reqSnap.exists()) {
      const req: any = reqSnap.data();
      if (req.selectedDriverId !== user.uid) {
        throw new Error(i18n.t("roadsideHelp.onlyAcceptedDriverCanFinish"));
      }
      if (req.status !== "in_progress") {
        throw new Error(i18n.t("roadsideHelp.actionNotAvailableNow"));
      }

      passengerId = req.passengerId || passengerId;

      transaction.update(reqRef, {
        status: "completion_pending",
        finishedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    transaction.update(bookingRef, {
      tripStatus: "completion_pending",
      updatedAt: serverTimestamp(),
    });
  });

  if (passengerId) {
    await notifyRoadside({
      receiverId: passengerId,
      senderId: user.uid,
      type: "roadside_completion_pending",
      title: i18n.t("roadsideHelp.completionPendingNotifTitle"),
      message: i18n.t("roadsideHelp.completionPendingNotifMessage", { name: driverName }),
      category: "roadside",
      status: "completion_pending",
      requestId,
      bookingId,
      driverId: user.uid,
      passengerId,
      targetTab: "passenger",
    });
  }
};

// ---------------------------------------------------------------------------
// Customer: confirm the problem was actually resolved. This is the ONLY
// path that reaches "completed" — the helper's own "Finish Help" only ever
// reaches completion_pending (see finishRoadsideHelp above). Rating and
// payment both unlock here, never before. paymentStatus becomes "pending"
// (payment is now actually due) — separate from the service status, per
// spec: cash is settled by the accepted helper's own confirmCashReceived
// below, bit is never auto-marked paid by opening the Bit app (see
// bitPayment.ts's own module note).
// ---------------------------------------------------------------------------

export const confirmCompletion = async (bookingId: string) => {
  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t("roadsideHelp.mustBeLoggedIn"));

  const bookingRef = doc(db, "bookings", bookingId);

  let requestId = "";
  let driverId = "";
  let passengerName = "The customer";

  await runTransaction(db, async (transaction) => {
    const bookingSnap = await transaction.get(bookingRef);
    if (!bookingSnap.exists()) throw new Error(i18n.t("rides.bookingNotFound"));

    const booking: any = bookingSnap.data();
    if (booking.passengerId !== user.uid) {
      throw new Error(i18n.t("roadsideHelp.onlyPassengerCanConfirmCompletion"));
    }
    if (booking.tripStatus !== "completion_pending") {
      throw new Error(i18n.t("roadsideHelp.helpNotReadyForConfirmation"));
    }

    requestId = booking.requestId || "";
    driverId = booking.driverId || "";
    passengerName = booking.passengerName || passengerName;

    const reqRef = doc(db, "roadsideRequests", requestId);
    const reqSnap = await transaction.get(reqRef);

    if (reqSnap.exists()) {
      const req: any = reqSnap.data();
      if (req.passengerId !== user.uid) {
        throw new Error(i18n.t("roadsideHelp.onlyPassengerCanConfirmCompletion"));
      }
      if (req.status !== "completion_pending") {
        throw new Error(i18n.t("roadsideHelp.helpNotReadyForConfirmation"));
      }

      transaction.update(reqRef, {
        status: "completed",
        paymentStatus: "pending",
        helpCompleted: true,
        needsPassengerRating: true,
        ratingSubmitted: false,
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    if (booking.offerId) {
      transaction.update(doc(db, "roadsideOffers", booking.offerId), {
        status: "completed",
        paymentStatus: "pending",
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    transaction.update(bookingRef, {
      status: "completed",
      tripStatus: "completed",
      paymentStatus: "pending",
      helpCompleted: true,
      needsPassengerRating: true,
      ratingSubmitted: false,
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  if (driverId) {
    await notifyRoadside({
      receiverId: driverId,
      senderId: user.uid,
      type: "roadside_completion_confirmed",
      title: i18n.t("roadsideHelp.completionConfirmedNotifTitle"),
      message: i18n.t("roadsideHelp.completionConfirmedNotifMessage", { name: passengerName }),
      category: "roadside",
      status: "completed",
      requestId,
      bookingId,
      driverId,
      passengerId: user.uid,
      targetTab: "driver",
    });
  }
};

// ---------------------------------------------------------------------------
// Driver: "Confirm Cash Received" — the ONLY path that ever marks a cash
// Roadside Help payment "paid". Never callable by the passenger, never
// callable before the customer has confirmed completion, never usable for
// the Bit method (see confirmCompletion's own comment on why Bit can never
// be auto-marked paid here).
// ---------------------------------------------------------------------------

export const confirmCashReceived = async (
  bookingId: string,
): Promise<{ amount: number; passengerId: string }> => {
  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t("roadsideHelp.mustBeLoggedIn"));

  const bookingRef = doc(db, "bookings", bookingId);

  let requestId = "";
  let passengerId = "";
  let driverName = "your helper";
  let amount = 0;

  await runTransaction(db, async (transaction) => {
    const bookingSnap = await transaction.get(bookingRef);
    if (!bookingSnap.exists()) throw new Error(i18n.t("rides.bookingNotFound"));

    const booking: any = bookingSnap.data();
    if (booking.driverId !== user.uid) {
      throw new Error(i18n.t("roadsideHelp.onlyAcceptedDriverCanConfirmCash"));
    }
    if (booking.paymentMethod !== "cash") {
      throw new Error(i18n.t("roadsideHelp.notACashPayment"));
    }
    if (booking.status !== "completed" || booking.paymentStatus !== "pending") {
      throw new Error(i18n.t("roadsideHelp.helpNotReadyForPayment"));
    }

    requestId = booking.requestId || "";
    passengerId = booking.passengerId || "";
    driverName = booking.driverName || driverName;
    amount = typeof booking.price === "number" ? booking.price : 0;

    const reqRef = doc(db, "roadsideRequests", requestId);
    const reqSnap = await transaction.get(reqRef);

    if (reqSnap.exists()) {
      const req: any = reqSnap.data();
      if (req.selectedDriverId !== user.uid) {
        throw new Error(i18n.t("roadsideHelp.onlyAcceptedDriverCanConfirmCash"));
      }

      transaction.update(reqRef, {
        paymentStatus: "paid",
        paidBy: passengerId,
        paidTo: user.uid,
        paidAmount: amount,
        paidAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    if (booking.offerId) {
      transaction.update(doc(db, "roadsideOffers", booking.offerId), {
        paymentStatus: "paid",
        paidAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    transaction.update(bookingRef, {
      paymentStatus: "paid",
      paidAmount: amount,
      paidAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  if (passengerId) {
    await notifyRoadside({
      receiverId: passengerId,
      senderId: user.uid,
      type: "roadside_payment_received",
      title: i18n.t("roadsideHelp.cashConfirmedNotifTitle"),
      message: i18n.t("roadsideHelp.cashConfirmedNotifMessage", { amount, name: driverName }),
      category: "roadside",
      status: "paid",
      requestId,
      bookingId,
      driverId: user.uid,
      passengerId,
      amount,
      targetTab: "passenger",
    });
  }

  return { amount, passengerId };
};

// ---------------------------------------------------------------------------
// Keeps the driver-facing `roadsideRequests` record (Help Requests screen,
// RoadsideAcceptedCard) in sync the moment either side cancels the shared
// `bookings` doc through the generic cancelGeneralBooking flow — that
// function only ever touches the `bookings` collection (it's shared by
// every category), so nothing else marks this request cancelled otherwise.
// Best-effort: never blocks/undoes a cancellation that already succeeded.
// ---------------------------------------------------------------------------

export const syncCancelledRoadsideRequest = async (requestId: string) => {
  if (!requestId) return;

  try {
    await updateDoc(doc(db, "roadsideRequests", requestId), {
      status: "cancelled",
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    console.log("syncCancelledRoadsideRequest failed", error);
  }
};

// ---------------------------------------------------------------------------
// Passenger: cancel a Roadside Help request — but ONLY while the accepted
// helper hasn't pressed "Start Driving" yet (status "open" or
// "helper_assigned" / tripStatus still "booked"). Once the helper is on the
// way, tracking may already be live and the helper is committed to the
// trip, so cancellation is refused here AND by firestore.rules (never just
// the UI) — see isValidRoadsideRequestUpdate / isValidRoadsideBookingUpdate.
//
// One transaction closes out every linked document together: the request
// itself, its booking (if one already exists — it does from
// "helper_assigned" onward), and the accepted offer (moved to
// "not_selected", the same terminal value a losing sibling offer gets, so
// no new offer-status vocabulary is needed). The accepted helper is
// notified after the transaction commits. There is nothing to "stop
// tracking" for — live GPS sharing only ever starts once the helper
// presses Start Driving (see RoadsideAcceptedCard.tsx), which is exactly
// the point this function refuses to cancel past, so a cancellable request
// never has an active tracking watcher in the first place.
// ---------------------------------------------------------------------------

export const cancelRoadsideRequestByPassenger = async (requestId: string): Promise<void> => {
  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t("roadsideHelp.mustBeLoggedIn"));

  const reqRef = doc(db, "roadsideRequests", requestId);

  let driverId = "";
  let passengerName = "";

  await runTransaction(db, async (transaction) => {
    const reqSnap = await transaction.get(reqRef);
    if (!reqSnap.exists()) throw new Error(i18n.t("roadsideHelp.requestNoLongerExists"));

    const req: any = reqSnap.data();

    if (req.passengerId !== user.uid) {
      throw new Error(i18n.t("roadsideHelp.onlyPassengerCanCancelRoadside"));
    }
    if (req.status !== "open" && req.status !== "helper_assigned") {
      throw new Error(i18n.t("roadsideHelp.cannotCancelAfterStartDriving"));
    }

    driverId = req.selectedDriverId || "";
    passengerName = req.passengerName || "";

    transaction.update(reqRef, {
      status: "cancelled",
      cancelledBy: "passenger",
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (req.bookingId) {
      transaction.update(doc(db, "bookings", req.bookingId), {
        status: "cancelled",
        updatedAt: serverTimestamp(),
      });
    }

    if (req.selectedOfferId) {
      transaction.update(doc(db, "roadsideOffers", req.selectedOfferId), {
        status: "not_selected",
        updatedAt: serverTimestamp(),
      });
    }
  });

  if (driverId) {
    await notifyRoadside({
      receiverId: driverId,
      senderId: user.uid,
      type: "roadside_cancelled_by_passenger",
      title: i18n.t("roadsideHelp.cancelledByPassengerNotifTitle"),
      message: i18n.t("roadsideHelp.cancelledByPassengerNotifMessage", {
        name: passengerName || i18n.t("common.user"),
      }),
      category: "roadside",
      status: "cancelled",
      requestId,
      driverId,
      passengerId: user.uid,
      targetTab: "driver",
    });
  }
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
