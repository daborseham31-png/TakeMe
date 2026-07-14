import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { auth, db } from "../../firebase";
import {
  BookingItem,
  canStartTrip,
  DriverCollection,
  DriverTripItem,
  getCategoryMeta,
  getStartTripBlockedReason,
  isCompletedItem,
  markCompleted,
  normalizeBooking,
  normalizeDriverTrip,
  sortMyBookings,
} from "../booking/bookingsLib";
import {
  arriveRide,
  finishRide,
  hideRideBookingForDriver,
  hideRideBookingForPassenger,
  normalizeRideBooking,
  RIDE_CATEGORY,
  RIDE_STATUS_LABEL,
  RideBooking,
  RideStatus,
  startRide,
  submitRideRating,
} from "../booking/rideBookingLib";
import {
  acceptRequest,
  arriveJob,
  cancelApplication,
  cancelBlockedReason,
  enrichApplicationWithCustomerAge,
  finishJob,
  isAwaitingPayment,
  normalizeApplication,
  NormalizedApplication,
  rejectRequest,
  startJob,
  startState,
  STATUS_LABEL,
  submitApplicationRating,
} from "../booking/work-errand/workErrandLib";
import RoadsideAcceptedCard from "../booking/roadside-help/RoadsideAcceptedCard";
import {
  normalizeRoadsideRequest,
  RoadsideRequestRecord,
  submitRoadsideRating,
} from "../booking/roadside-help/roadsideLib";
import DateInput, { TimeInput } from "../driver/create/DateInput";

type Tab = "passenger" | "driver";

const getParamString = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) return value[0];
  return value;
};

const getLast3Digits = (value: string) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 3 ? digits.slice(-3) : digits;
};

const paymentMethodLabel = (method?: string | null) =>
  method === "cash" ? "Cash" : method === "bit" ? "BIT" : "Card";

const formatPhoneForDisplay = (phone?: string | null) => {
  const digits = String(phone || "").replace(/\D/g, "");

  if (!digits) return "";

  if (digits.startsWith("00972")) {
    return "0" + digits.slice(5);
  }

  if (digits.startsWith("9720")) {
    return "0" + digits.slice(4);
  }

  if (digits.startsWith("972")) {
    return "0" + digits.slice(3);
  }

  return digits;
};

const formatPhoneForCall = (phone?: string | null) => {
  const displayPhone = formatPhoneForDisplay(phone);

  if (!displayPhone) return "";

  if (displayPhone.startsWith("0")) {
    return "+972" + displayPhone.slice(1);
  }

  return displayPhone;
};

const enrichRideWithRouteDetails = async (ride: RideBooking) => {
  if (!ride.routeId) return ride;

  const alreadyHasCarDetails =
    !!ride.driverCar && !!ride.driverCarColor && !!ride.driverCarPlateLast3;

  if (alreadyHasCarDetails && !!ride.driverPhone) return ride;

  try {
    const routeSnap = await getDoc(doc(db, "driverRoutes", ride.routeId));

    if (!routeSnap.exists()) return ride;

    const route = routeSnap.data();

    return {
      ...ride,
      driverPhone: ride.driverPhone || route.phone || "",
      driverCar: ride.driverCar || route.car || "",
      driverCarColor: ride.driverCarColor || route.carColor || "",
      driverCarPlateLast3:
        ride.driverCarPlateLast3 ||
        getLast3Digits(route.driverCarPlateLast3 || route.carPlate || ""),
    };
  } catch {
    return ride;
  }
};

// One combined chronological list mixes every category and every source
// (personal_ride live-tracking "rides", general "bookings", driver-owned
// "trip" listings, and Work/Errand "applications") — each variant is tagged
// with its own real object (via `_kind`) plus its ORIGINAL fields, so the
// shared sortMyBookings() helper can read `.date`/`.time`/`.status`/
// `.tripStatus` straight off it with no per-category special-casing.
type TaggedRide = RideBooking & { _kind: "ride" };
type TaggedTrip = DriverTripItem & { _kind: "trip" };
type TaggedBooking = BookingItem & { _kind: "booking" };
// NormalizedApplication has no `.time` field (it uses `.startTime`) — alias
// it here so the generic date/time sort helpers work unchanged.
type TaggedApplication = NormalizedApplication & {
  _kind: "application";
  time: string;
};

type CombinedRow = TaggedRide | TaggedTrip | TaggedBooking | TaggedApplication;

const tagRide = (r: RideBooking): TaggedRide => ({ ...r, _kind: "ride" });
const tagTrip = (t: DriverTripItem): TaggedTrip => ({ ...t, _kind: "trip" });
const tagBooking = (b: BookingItem): TaggedBooking => ({
  ...b,
  _kind: "booking",
});
const tagApplication = (a: NormalizedApplication): TaggedApplication => ({
  ...a,
  _kind: "application",
  time: a.startTime,
});

// ---------------------------------------------------------------------------
// Driver tab ONLY: classifies each row into "Booked & Active" vs
// "Created — Waiting for Booking". The passenger tab is never split — every
// passenger row is a real booking by construction, so this classification
// simply doesn't apply there.
//
// ride/booking/application rows only ever exist because someone actually
// booked or applied for something (there is no "unclaimed" version of any
// of these three) — they always belong in "Booked & Active". Only "trip"
// rows (the driver's own driverRoutes/workJobs/errandJobs listing) can go
// either way.
//
// IMPORTANT: `status` on a normalized DriverTripItem is NEVER usable as
// booking evidence — normalizeDriverTrip (bookingsLib.ts) collapses every
// non-completed driverRoutes/workJobs/errandJobs document to status
// "ongoing" regardless of whether anyone booked/accepted it (a freshly
// created, never-booked route has the exact same "ongoing" status as one
// with a passenger). Classifying on status here previously caused every
// unbooked created listing to show up as "Booked & Active". Real evidence
// only ever comes from a matching document elsewhere:
//   - driverRoutes: a `bookings` doc whose routeId matches (bookedRouteIds)
//   - workJobs: acceptedWorkersCount > 0 on the job itself (kept as ONE
//     card even while still open for more workers — never split/duplicated)
//   - errandJobs: an accepted-or-further workApplications/errandApplications
//     doc whose sourceId matches (bookedJobSourceIds) — errand has no
//     capacity concept, so once accepted the original listing is dropped
//     from `driverTrips` entirely in favor of the application row, and never
//     reaches this classifier as a "trip" row at all.
// By the time a "trip" row reaches this function it is therefore guaranteed
// to have no real booking evidence unless acceptedWorkersCount says so.
// ---------------------------------------------------------------------------
const isTripBookedOrActive = (t: DriverTripItem): boolean => {
  if (isCompletedItem(t)) return true;

  const acceptedWorkersCount =
    typeof t.acceptedWorkersCount === "number" ? t.acceptedWorkersCount : 0;

  return acceptedWorkersCount > 0;
};

const isDriverRowBookedOrActive = (row: CombinedRow): boolean => {
  if (row._kind !== "trip") return true;

  return isTripBookedOrActive(row);
};

export default function BookingsScreen() {
  const params = useLocalSearchParams<{
    tab?: string | string[];
    bookingId?: string | string[];
    applicationId?: string | string[];
    requestId?: string | string[];
    type?: string | string[];
    kind?: string | string[];
  }>();

  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [tab, setTab] = useState<Tab>("passenger");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // Deep-link from a notification ("open the driver tab, find this pending
  // request, scroll to it and flash it briefly").
  const [pendingScrollAppId, setPendingScrollAppId] = useState<string | null>(
    null,
  );
  const [highlightAppId, setHighlightAppId] = useState<string | null>(null);
  const mainScrollRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(0);
  const appCardRefs = useRef<Record<string, View | null>>({});

  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [driverRoadside, setDriverRoadside] = useState<BookingItem[]>([]);
  // Same roadsideRequests/{requestId} source of truth as the driver's Help
  // Requests screen — both subscribe independently, so any change either
  // screen makes shows up on the other in real time (see roadsideLib.ts).
  const [driverRoadsideRequests, setDriverRoadsideRequests] = useState<
    RoadsideRequestRecord[]
  >([]);

  const [passengerRides, setPassengerRides] = useState<RideBooking[]>([]);
  const [driverRides, setDriverRides] = useState<RideBooking[]>([]);

  const [ratingBooking, setRatingBooking] = useState<RideBooking | null>(null);
  const [schoolRatingBooking, setSchoolRatingBooking] =
    useState<BookingItem | null>(null);
  const [appRatingBooking, setAppRatingBooking] =
    useState<NormalizedApplication | null>(null);
  const [roadsideRatingBooking, setRoadsideRatingBooking] =
    useState<BookingItem | null>(null);
  const [ratedSchoolBookingIds, setRatedSchoolBookingIds] = useState<string[]>(
    [],
  );

  const [ratingStars, setRatingStars] = useState(0);
  const [ratingComment, setRatingComment] = useState("");
  const [ratingBusy, setRatingBusy] = useState(false);

  const [routes, setRoutes] = useState<DriverTripItem[]>([]);
  const [workJobs, setWorkJobs] = useState<DriverTripItem[]>([]);
  const [errandJobs, setErrandJobs] = useState<DriverTripItem[]>([]);

  const [myWorkApps, setMyWorkApps] = useState<NormalizedApplication[]>([]);
  const [myErrandApps, setMyErrandApps] = useState<NormalizedApplication[]>([]);
  const [asProviderWork, setAsProviderWork] = useState<NormalizedApplication[]>(
    [],
  );
  const [asProviderErrand, setAsProviderErrand] = useState<
    NormalizedApplication[]
  >([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

  const [rebook, setRebook] = useState<{
    category: string;
    from: string;
    to: string;
    date: string;
    time: string;
    seats: number | null;
  } | null>(null);
  const [rebookDate, setRebookDate] = useState("");
  const [rebookTime, setRebookTime] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setUid(user?.uid ?? null);
      if (!user) setLoading(false);
    });
  }, []);

  useEffect(() => {
    const requestedTab = getParamString(params.tab);

    if (requestedTab === "driver") {
      setTab("driver");
    }

    if (requestedTab === "passenger") {
      setTab("passenger");
    }

    // Roadside notifications route with requestId/offerId (see spec item 8),
    // not always a bookingId — fall back to requestId so the accepted /
    // completed Roadside card can still be found and highlighted.
    const targetId =
      getParamString(params.bookingId) ||
      getParamString(params.applicationId) ||
      getParamString(params.requestId);

    if (targetId) {
      setPendingScrollAppId(targetId);
    }
  }, [params.tab, params.bookingId, params.applicationId, params.requestId]);

  useEffect(() => {
    if (!uid) return;

    setLoading(true);

const subscribe = (
  collectionName: "driverRoutes" | "workJobs" | "errandJobs",
  field: string,
  setter: (items: DriverTripItem[]) => void,
) =>
  onSnapshot(
    query(collection(db, collectionName), where(field, "==", uid)),
    (snap) => {
      setter(
        snap.docs
          .filter((d) => d.data().deletedForDriver !== true)
          .map((d) => normalizeDriverTrip(d.id, d.data(), collectionName)),
      );
      setLoading(false);
    },
    () => setLoading(false),
  );

    const unsubBookings = onSnapshot(
      query(collection(db, "bookings"), where("passengerId", "==", uid)),
      async (snap) => {
        const passengerRideItems = snap.docs
          .filter(
            (d) =>
              d.data().category === RIDE_CATEGORY &&
              d.data().deletedForPassenger !== true,
          )
          .map((d) => normalizeRideBooking(d.id, d.data()));

        const passengerRideItemsWithDetails = await Promise.all(
          passengerRideItems.map(enrichRideWithRouteDetails),
        );

        setPassengerRides(
          snap.docs
            .filter((d) => {
              const data = d.data();

              return (
                data.category === RIDE_CATEGORY &&
                data.deletedForPassenger !== true &&
                data.passengerId === uid
              );
            })
            .map((d) => normalizeRideBooking(d.id, d.data())),
        );

        setBookings(
          snap.docs
            .filter((d) => {
              const data = d.data();

              return (
                data.category !== RIDE_CATEGORY &&
                data.deletedForPassenger !== true &&
                data.passengerId === uid
              );
            })
            .map((d) => normalizeBooking(d.id, d.data())),
        );

        setLoading(false);
      },
      () => setLoading(false),
    );

    const unsubDriverRoadside = onSnapshot(
      query(collection(db, "bookings"), where("driverId", "==", uid)),
      async (snap) => {
        setDriverRoadside(
          snap.docs
            .filter((d) => {
              const data = d.data();

              return (
                data.category !== RIDE_CATEGORY &&
                data.deletedForDriver !== true &&
                data.driverId === uid &&
                data.passengerId !== uid
              );
            })
            .map((d) => normalizeBooking(d.id, d.data())),
        );

        const driverRideItems = snap.docs
          .filter(
            (d) =>
              d.data().category === RIDE_CATEGORY &&
              d.data().deletedForDriver !== true,
          )
          .map((d) => normalizeRideBooking(d.id, d.data()));

        const driverRideItemsWithDetails = await Promise.all(
          driverRideItems.map(enrichRideWithRouteDetails),
        );

        setDriverRides(
          snap.docs
            .filter((d) => {
              const data = d.data();

              return (
                data.category === RIDE_CATEGORY &&
                data.deletedForDriver !== true &&
                data.driverId === uid &&
                data.passengerId !== uid
              );
            })
            .map((d) => normalizeRideBooking(d.id, d.data())),
        );

        setLoading(false);
      },
      () => setLoading(false),
    );

    const unsubDriverRoadsideRequests = onSnapshot(
      query(
        collection(db, "roadsideRequests"),
        where("selectedDriverId", "==", uid),
      ),
      (snap) => {
        setDriverRoadsideRequests(
          snap.docs.map((d) => normalizeRoadsideRequest(d.id, d.data())),
        );
      },
    );

    const unsubRoutes = subscribe("driverRoutes", "driverId", setRoutes);
    const unsubWork = subscribe("workJobs", "employerId", setWorkJobs);
    const unsubErrands = subscribe("errandJobs", "ownerId", setErrandJobs);

    const subscribeApps = (
      collectionName: "workApplications" | "errandApplications",
      field: string,
      kind: "work" | "errand",
      viewer: Tab,
      setter: (items: NormalizedApplication[]) => void,
    ) =>
      onSnapshot(
        query(collection(db, collectionName), where(field, "==", uid)),
        async (snap) => {
          const deleteField =
            viewer === "passenger" ? "deletedForPassenger" : "deletedForDriver";

          const items = snap.docs
            .filter((d) => d.data()[deleteField] !== true)
            .map((d) => normalizeApplication(d.id, d.data(), kind));

          // Only the driver's pending-request card needs the passenger's
          // age, so only bother fetching it for driver-viewed lists (and
          // only for the ones missing it — see enrichApplicationWithCustomerAge).
          setter(
            viewer === "driver"
              ? await Promise.all(items.map(enrichApplicationWithCustomerAge))
              : items,
          );

          setLoading(false);
        },
        () => setLoading(false),
      );

    const unsubMyWork = subscribeApps(
      "workApplications",
      "applicantId",
      "work",
      "passenger",
      setMyWorkApps,
    );

    const unsubMyErrand = subscribeApps(
      "errandApplications",
      "passengerId",
      "errand",
      "passenger",
      setMyErrandApps,
    );

    const unsubProvWork = subscribeApps(
      "workApplications",
      "employerId",
      "work",
      "driver",
      setAsProviderWork,
    );

    const unsubProvErrand = subscribeApps(
      "errandApplications",
      "driverId",
      "errand",
      "driver",
      setAsProviderErrand,
    );

    return () => {
      unsubBookings();
      unsubDriverRoadside();
      unsubDriverRoadsideRequests();
      unsubRoutes();
      unsubWork();
      unsubErrands();
      unsubMyWork();
      unsubMyErrand();
      unsubProvWork();
      unsubProvErrand();
    };
  }, [uid]);

  const passengerApps = useMemo(
    () =>
      [...myWorkApps, ...myErrandApps].sort(
        (a, b) => b.createdAtSeconds - a.createdAtSeconds,
      ),
    [myWorkApps, myErrandApps],
  );

  const driverApps = useMemo(
    () =>
      [...asProviderWork, ...asProviderErrand].sort(
        (a, b) => b.createdAtSeconds - a.createdAtSeconds,
      ),
    [asProviderWork, asProviderErrand],
  );

  const scrollToAppCard = (id: string) => {
    const cardNode = appCardRefs.current[id];
    const scrollNode = mainScrollRef.current;

    if (!cardNode || !scrollNode) return;

    // measure() gives page-absolute coordinates for both the card and the
    // ScrollView, so the target offset can be computed in plain JS without
    // relying on a fragile native-handle relationship between the two.
    // (ScrollView's TS type doesn't declare `measure`, though the
    // underlying native component always supports it — hence the `any`.)
    const scrollNodeAny = scrollNode as any;

    cardNode.measure((
      _x: number,
      _y: number,
      _width: number,
      _height: number,
      pageX: number,
      pageY: number,
    ) => {
      scrollNodeAny.measure((
        _sx: number,
        _sy: number,
        _sw: number,
        _sh: number,
        _spx: number,
        scrollPageY: number,
      ) => {
        const targetY =
          scrollOffsetRef.current + (pageY - scrollPageY) - 16;

        scrollNode.scrollTo({ y: Math.max(targetY, 0), animated: true });
      });
    });
  };

const bookedRouteIds = useMemo(() => {
  const ids = new Set<string>();

  driverRoadside.forEach((b) => {
    if (b.routeId) {
      ids.add(b.routeId);
    }
  });

  driverRides.forEach((r) => {
    if (r.routeId) {
      ids.add(r.routeId);
    }
  });

  return ids;
}, [driverRoadside, driverRides]);

  // Errand has no multi-worker capacity concept (unlike Work) — once a
  // request is accepted (or further along: payment-pending, on the way,
  // arrived, completed...), the job is effectively taken by exactly one
  // customer. The accepted application already renders its own card, so the
  // original errandJobs listing must be dropped here to avoid a duplicate
  // "still waiting" card for a job that's actually in progress.
  const bookedErrandJobIds = useMemo(() => {
    const ids = new Set<string>();

    asProviderErrand.forEach((a) => {
      if (a.sourceId && a.status !== "pending" && a.status !== "rejected") {
        ids.add(a.sourceId);
      }
    });

    return ids;
  }, [asProviderErrand]);

  // Driver-owned listings not yet booked by anyone (school/personal routes,
  // work jobs, errand jobs). Once a route/errand IS booked, its original
  // listing card is hidden here in favor of the actual booking/application
  // card. Work jobs are never excluded this way — they legitimately keep
  // showing while still open for more workers even after some are accepted.
  const driverTrips = useMemo(
    () =>
      [...routes, ...workJobs, ...errandJobs].filter((t) => {
        if (t.collectionName === "driverRoutes" && bookedRouteIds.has(t.id)) {
          return false;
        }

        if (t.collectionName === "errandJobs" && bookedErrandJobIds.has(t.id)) {
          return false;
        }

        return true;
      }),
    [routes, workJobs, errandJobs, bookedRouteIds, bookedErrandJobIds],
  );

  // ONE combined, chronologically sorted list per tab — School, Personal,
  // Work, Errand, Roadside, and driver-listing cards are all mixed together
  // by real trip date/time only (see sortMyBookings in bookingsLib.ts).
  // Never sort each category separately and concatenate the results.
  const combinedPassengerRows = useMemo<CombinedRow[]>(
    () =>
      sortMyBookings([
        ...passengerRides.map(tagRide),
        ...bookings.map(tagBooking),
        ...passengerApps.map(tagApplication),
      ]),
    [passengerRides, bookings, passengerApps],
  );

  const combinedDriverRows = useMemo<CombinedRow[]>(
    () =>
      sortMyBookings([
        ...driverRides.map(tagRide),
        ...driverTrips.map(tagTrip),
        ...driverRoadside.map(tagBooking),
        ...driverApps.map(tagApplication),
      ]),
    [driverRides, driverTrips, driverRoadside, driverApps],
  );

  // requestId -> live roadsideRequests record, so a roadside booking row can
  // render the SAME synchronized RoadsideAcceptedCard used on Help Requests
  // instead of its own status snapshot.
  const driverRoadsideRequestsById = useMemo(() => {
    const map = new Map<string, RoadsideRequestRecord>();
    driverRoadsideRequests.forEach((r) => map.set(r.id, r));
    return map;
  }, [driverRoadsideRequests]);

  const q = search.trim().toLowerCase();

  const filteredPassengerRows = useMemo(
    () =>
      q
        ? combinedPassengerRows.filter((r) => r.searchText.includes(q))
        : combinedPassengerRows,
    [combinedPassengerRows, q],
  );

  const filteredDriverRows = useMemo(
    () =>
      q
        ? combinedDriverRows.filter((r) => r.searchText.includes(q))
        : combinedDriverRows,
    [combinedDriverRows, q],
  );

  // Both lists are simple filters of the already-sorted filteredDriverRows
  // (sortMyBookings already put non-completed first / nearest-date-first /
  // completed-last across the whole list — filtering preserves that
  // relative order, so neither section needs its own separate sort call).
  const driverActiveRows = useMemo(
    () => filteredDriverRows.filter(isDriverRowBookedOrActive),
    [filteredDriverRows],
  );

  const driverCreatedRows = useMemo(
    () => filteredDriverRows.filter((row) => !isDriverRowBookedOrActive(row)),
    [filteredDriverRows],
  );

  // Notification deep link: once the target combined list (whichever tab the
  // notification targeted) contains the target id, scroll to it and flash
  // it briefly. Roadside notifications may only carry a requestId (see spec
  // item 8) rather than the booking's own id, so booking rows also match on
  // their `requestId` — the row's real `.id` is always what gets highlighted
  // (that's what appCardRefs is keyed by).
  useEffect(() => {
    if (!pendingScrollAppId) return;

    const candidates =
      tab === "driver" ? combinedDriverRows : combinedPassengerRows;

    const match = candidates.find(
      (row) =>
        row.id === pendingScrollAppId ||
        (row._kind === "booking" && row.requestId === pendingScrollAppId),
    );
    if (!match) return;

    const id = match.id;
    setPendingScrollAppId(null);
    setHighlightAppId(id);

    // Give the just-switched tab/list a moment to finish laying out before
    // measuring card positions.
    const scrollTimer = setTimeout(() => scrollToAppCard(id), 350);
    const clearTimer = setTimeout(() => {
      setHighlightAppId((prev) => (prev === id ? null : prev));
    }, 2600);

    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(clearTimer);
    };
  }, [pendingScrollAppId, tab, combinedDriverRows, combinedPassengerRows]);

  const runApp = async (id: string, fn: () => Promise<void>) => {
    try {
      setBusyId(id);
      await fn();
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Something went wrong.");
    } finally {
      setBusyId(null);
    }
  };

  const callPhone = (phone?: string | null) => {
    const callNumber = formatPhoneForCall(phone);

    if (!callNumber) {
      Alert.alert("No phone", "No phone number is saved for this driver.");
      return;
    }

    Linking.openURL(`tel:${callNumber}`).catch(() =>
      Alert.alert("Error", "Could not open the phone app."),
    );
  };


  const openLiveTracking = (bookingId: string) => {
    router.push({
      pathname: "/booking/live-tracking",
      params: { id: bookingId },
    } as any);
  };

  const openSchoolRideNavigation = (bookingId: string) => {
    router.push({
      pathname: "/driver/ride-navigation",
      params: { id: bookingId },
    } as any);
  };

  // Live Tracking is a School Ride–only feature. Personal Ride never shows
  // it, for either the passenger or the driver, regardless of trip status.
  const canShowLiveTracking = (item: any) => {
    return (
      item?.category === "school" &&
      item?.trackingEnabled === true &&
      item?.tripStatus === "arrived_pickup"
    );
  };

  const getBookingTripLabel = (b: BookingItem) => {
    const tripStatus = (b as any).tripStatus;

    if (b.status === "completed" || tripStatus === "completed") {
      return "Completed";
    }

    if (tripStatus === "driver_on_way") {
      return "Driver on the way";
    }

    if (tripStatus === "arrived_pickup") {
      return "Driver arrived";
    }

    if (tripStatus === "in_progress") {
      return "In trip";
    }

    return "Ongoing";
  };

  const renderBookingTripStatus = (b: BookingItem) => {
    const tripStatus = (b as any).tripStatus;
    const completed = b.status === "completed" || tripStatus === "completed";

    return (
      <View
        style={[
          styles.statusPill,
          completed ? styles.statusDone : styles.statusOngoing,
        ]}
      >
        <Ionicons
          name={completed ? "checkmark-circle" : "time"}
          size={13}
          color={completed ? "#166534" : "#B86115"}
        />
        <Text
          style={[
            styles.statusText,
            completed ? styles.statusTextDone : styles.statusTextOngoing,
          ]}
        >
          {getBookingTripLabel(b)}
        </Text>
      </View>
    );
  };

  // Deleting a card only ever hides it from the current user's own list — it
  // never cancels/changes the booking itself (status/tripStatus/paymentStatus
  // are untouched). Active/upcoming items get an extra-explicit warning so
  // that's never mistaken for a cancellation.
  const REMOVE_ACTIVE_MESSAGE =
    "Removing this card will only hide it from your list. It will not cancel the booking.";

  const removeConfirmMessage = (item: any, label: string) =>
    isCompletedItem(item)
      ? `Remove this ${label} from your list?`
      : REMOVE_ACTIVE_MESSAGE;

  const confirmHideRideBooking = (ride: RideBooking, viewer: Tab) => {
    Alert.alert("Remove booking", removeConfirmMessage(ride, "booking"), [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () =>
          runApp(ride.id, () => {
            if (viewer === "passenger") {
              setPassengerRides((prev) => prev.filter((r) => r.id !== ride.id));
            } else {
              setDriverRides((prev) => prev.filter((r) => r.id !== ride.id));
            }

            return viewer === "passenger"
              ? hideRideBookingForPassenger(ride.id)
              : hideRideBookingForDriver(ride.id, ride.routeId);
          }),
      },
    ]);
  };

const hideGeneralBooking = async (bookingId: string, viewer: Tab) => {
  const localBooking = driverRoadside.find((b) => b.id === bookingId);

  if (viewer === "passenger") {
    setBookings((prev) => prev.filter((b) => b.id !== bookingId));
  } else {
    setDriverRoadside((prev) => prev.filter((b) => b.id !== bookingId));

    if (localBooking?.routeId) {
      setRoutes((prev) => prev.filter((r) => r.id !== localBooking.routeId));
    }
  }

  const bookingRef = doc(db, "bookings", bookingId);
  const bookingSnap = await getDoc(bookingRef);

  const routeId =
    localBooking?.routeId ||
    (bookingSnap.exists() ? String(bookingSnap.data().routeId || "") : "");

  await updateDoc(bookingRef, {
    [viewer === "passenger" ? "deletedForPassenger" : "deletedForDriver"]: true,
    updatedAt: serverTimestamp(),
  });

  // مهم: إذا السائق حذف كرت حجز مدرسة، نخفي كمان كرت driverRoutes الأصلي
  // عشان ما يرجع يظهر مكانه.
  if (viewer === "driver" && routeId) {
    await updateDoc(doc(db, "driverRoutes", routeId), {
      deletedForDriver: true,
      updatedAt: serverTimestamp(),
    });
  }
};

  const confirmHideGeneralBooking = (
    booking: BookingItem,
    viewer: Tab,
    label = "booking",
  ) => {
    Alert.alert("Remove booking", removeConfirmMessage(booking, label), [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () =>
          runApp(booking.id, () => hideGeneralBooking(booking.id, viewer)),
      },
    ]);
  };

  const hideApplicationFromList = async (
    app: NormalizedApplication,
    viewer: Tab,
  ) => {
    const collectionName =
      app.kind === "work" ? "workApplications" : "errandApplications";

    if (viewer === "passenger") {
      if (app.kind === "work") {
        setMyWorkApps((prev) => prev.filter((a) => a.id !== app.id));
      } else {
        setMyErrandApps((prev) => prev.filter((a) => a.id !== app.id));
      }
    } else if (app.kind === "work") {
      setAsProviderWork((prev) => prev.filter((a) => a.id !== app.id));
    } else {
      setAsProviderErrand((prev) => prev.filter((a) => a.id !== app.id));
    }

    await updateDoc(doc(db, collectionName, app.id), {
      [viewer === "passenger" ? "deletedForPassenger" : "deletedForDriver"]:
        true,
      updatedAt: serverTimestamp(),
    });
  };

  const confirmHideApplication = (app: NormalizedApplication, viewer: Tab) => {
    Alert.alert("Remove booking", removeConfirmMessage(app, "booking"), [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () =>
          runApp(app.id, () => hideApplicationFromList(app, viewer)),
      },
    ]);
  };

  const goToPayment = (a: NormalizedApplication) =>
    router.push({
      pathname: "/booking/payment",
      params: { kind: a.kind, id: a.id },
    } as any);

  // Work only — driver pays the passenger/worker AFTER the job is finished.
  const goToWorkPayment = (a: NormalizedApplication) =>
    router.push({
      pathname: "/booking/work-errand/work/payment",
      params: {
        bookingId: a.id,
        amount: String(a.price ?? a.hourlyPay ?? 0),
        payerId: a.providerId,
        payerName: a.providerName,
        payeeId: a.customerId,
        payeeName: a.customerName,
        payeePhone: a.customerPhone,
        category: "work",
      },
    } as any);

  const openNavigation = (a: NormalizedApplication) =>
    router.push({
      pathname: "/driver/job-navigation",
      params: { kind: a.kind, id: a.id },
    } as any);

  const handleAppStart = (a: NormalizedApplication) => {
    if (startState(a.date) === "future") {
      Alert.alert("Not yet", "Start will be available on the job date.");
      return;
    }

    runApp(a.id, async () => {
      await startJob(a.kind, a.id, a);
      openNavigation(a);
    });
  };

  const handleAppArrive = (a: NormalizedApplication) =>
    runApp(a.id, () => arriveJob(a.kind, a.id, a));

  const handleAppFinish = (a: NormalizedApplication) =>
    Alert.alert(
      a.kind === "work" ? "Finish Work" : "Finish Errand",
      "Mark this as completed?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Yes, finish",
          onPress: () =>
            runApp(a.id, async () => {
              await finishJob(a.kind, a.id, a);

              // Work is paid after completion — send the driver straight to
              // the "pay worker" screen. Errand's payment already happened
              // before the service started, so nothing more to do here.
              if (a.kind === "work") {
                goToWorkPayment(a);
              }
            }),
        },
      ],
    );

  const handleAppCancel = (
    a: NormalizedApplication,
    by: "passenger" | "driver",
  ) => {
    const blocked = cancelBlockedReason(a);

    if (blocked) {
      Alert.alert("Cannot cancel", blocked);
      return;
    }

    Alert.alert("Cancel booking", "Cancel this booking?", [
      { text: "No", style: "cancel" },
      {
        text: "Yes, cancel",
        style: "destructive",
        onPress: () =>
          runApp(a.id, () => cancelApplication(a.kind, a.id, a, by)),
      },
    ]);
  };

  const handleAppAccept = (a: NormalizedApplication) =>
    runApp(a.id, () => acceptRequest(a.kind, a.id, a));

  const handleAppReject = (a: NormalizedApplication) =>
    Alert.alert("Reject request", "Reject this request?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reject",
        style: "destructive",
        onPress: () => runApp(a.id, () => rejectRequest(a.kind, a.id, a)),
      },
    ]);

  const confirmComplete = (
    collectionName: string,
    id: string,
    label: string,
  ) => {
    Alert.alert("Mark as Completed", `Mark this ${label} as completed?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Yes, complete",
        onPress: () =>
          markCompleted(collectionName, id).catch((e) =>
            Alert.alert("Error", e?.message || "Could not update."),
          ),
      },
    ]);
  };

  // A driver-owned listing (driverRoutes/workJobs/errandJobs) belongs only to
  // that driver — deleting it only ever hides it from their own list, the
  // same deletedForDriver convention as every other card.
  const deleteTrip = async (t: DriverTripItem) => {
    if (t.collectionName === "driverRoutes") {
      setRoutes((prev) => prev.filter((r) => r.id !== t.id));
    } else if (t.collectionName === "workJobs") {
      setWorkJobs((prev) => prev.filter((r) => r.id !== t.id));
    } else {
      setErrandJobs((prev) => prev.filter((r) => r.id !== t.id));
    }

    await updateDoc(doc(db, t.collectionName, t.id), {
      deletedForDriver: true,
      updatedAt: serverTimestamp(),
    });
  };

  const confirmDeleteTrip = (t: DriverTripItem) => {
    Alert.alert("Remove listing", removeConfirmMessage(t, "listing"), [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => runApp(t.id, () => deleteTrip(t)),
      },
    ]);
  };

  // "Clear All" hides every card currently shown on this tab for the current
  // user only — it never touches status/tripStatus/paymentStatus, never
  // deletes the shared document, and never affects the other side's list.
  const runClearAllBookings = async (rows: CombinedRow[], viewer: Tab) => {
    setClearingAll(true);

    const field = viewer === "passenger" ? "deletedForPassenger" : "deletedForDriver";

    const rideIds = new Set(
      rows.filter((r) => r._kind === "ride").map((r) => r.id),
    );
    const bookingIds = new Set(
      rows.filter((r) => r._kind === "booking").map((r) => r.id),
    );
    const workAppIds = new Set(
      rows
        .filter((r) => r._kind === "application" && r.kind === "work")
        .map((r) => r.id),
    );
    const errandAppIds = new Set(
      rows
        .filter((r) => r._kind === "application" && r.kind === "errand")
        .map((r) => r.id),
    );
    const tripIdsByCollection: Record<DriverCollection, Set<string>> = {
      driverRoutes: new Set(),
      workJobs: new Set(),
      errandJobs: new Set(),
    };
    rows.forEach((r) => {
      if (r._kind === "trip") tripIdsByCollection[r.collectionName].add(r.id);
    });
    // Booked routes hide their original driverRoutes listing card too, same
    // as the individual delete button does (see hideGeneralBooking above) —
    // otherwise it would reappear once the booking is hidden.
    const routeIdsToHide = new Set(
      rows
        .filter((r): r is TaggedBooking => r._kind === "booking")
        .map((r) => r.routeId)
        .filter((id): id is string => !!id),
    );

    // Optimistic local removal first so the UI updates immediately and
    // never waits on a round trip (or a restart) to reflect the change.
    if (viewer === "passenger") {
      setPassengerRides((prev) => prev.filter((r) => !rideIds.has(r.id)));
      setBookings((prev) => prev.filter((b) => !bookingIds.has(b.id)));
      setMyWorkApps((prev) => prev.filter((a) => !workAppIds.has(a.id)));
      setMyErrandApps((prev) => prev.filter((a) => !errandAppIds.has(a.id)));
    } else {
      setDriverRides((prev) => prev.filter((r) => !rideIds.has(r.id)));
      setDriverRoadside((prev) => prev.filter((b) => !bookingIds.has(b.id)));
      setAsProviderWork((prev) => prev.filter((a) => !workAppIds.has(a.id)));
      setAsProviderErrand((prev) =>
        prev.filter((a) => !errandAppIds.has(a.id)),
      );
      setRoutes((prev) =>
        prev.filter(
          (t) =>
            !tripIdsByCollection.driverRoutes.has(t.id) &&
            !routeIdsToHide.has(t.id),
        ),
      );
      setWorkJobs((prev) =>
        prev.filter((t) => !tripIdsByCollection.workJobs.has(t.id)),
      );
      setErrandJobs((prev) =>
        prev.filter((t) => !tripIdsByCollection.errandJobs.has(t.id)),
      );
    }

    try {
      const ops: { collectionName: string; id: string; field: string }[] = [];

      rows.forEach((row) => {
        if (row._kind === "ride" || row._kind === "booking") {
          ops.push({ collectionName: "bookings", id: row.id, field });
        } else if (row._kind === "application") {
          ops.push({
            collectionName:
              row.kind === "work" ? "workApplications" : "errandApplications",
            id: row.id,
            field,
          });
        } else {
          ops.push({
            collectionName: row.collectionName,
            id: row.id,
            field: "deletedForDriver",
          });
        }
      });

      if (viewer === "driver") {
        routeIdsToHide.forEach((routeId) => {
          ops.push({
            collectionName: "driverRoutes",
            id: routeId,
            field: "deletedForDriver",
          });
        });
      }

      // Firestore batched writes cap at 500 operations — chunk defensively.
      for (let i = 0; i < ops.length; i += 450) {
        const batch = writeBatch(db);

        ops.slice(i, i + 450).forEach((op) => {
          batch.update(doc(db, op.collectionName, op.id), {
            [op.field]: true,
            updatedAt: serverTimestamp(),
          });
        });

        await batch.commit();
      }
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Could not clear all.");
    } finally {
      setClearingAll(false);
    }
  };

  const handleClearAllBookings = () => {
    const rows = tab === "passenger" ? filteredPassengerRows : filteredDriverRows;
    if (rows.length === 0 || clearingAll) return;

    Alert.alert(
      "Clear all",
      "Clear all bookings from your list? Removing these cards will only hide them — it will not cancel any booking.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: () => runClearAllBookings(rows, tab),
        },
      ],
    );
  };

  const openRebook = (booking: BookingItem) => {
    setRebook({
      category: booking.category,
      from: booking.from,
      to: booking.to,
      date: booking.date || "",
      time: booking.time || "",
      seats: booking.seats ?? 1,
    });

    setRebookDate(booking.date || "");
    setRebookTime(booking.time || "");
  };

  const openRideRebook = (ride: RideBooking) => {
    setRebook({
      category: "personal",
      from: ride.from,
      to: ride.to,
      date: ride.date || "",
      time: ride.time || "",
      seats: ride.seats ?? 1,
    });

    setRebookDate(ride.date || "");
    setRebookTime(ride.time || "");
  };

  const submitRebook = () => {
    if (!rebook) return;

    if (!rebookDate || !rebookTime) {
      Alert.alert("Missing details", "Please choose a new date and time.");
      return;
    }

    router.push({
      pathname: "/booking/driverresults",
      params: {
        from: rebook.from,
        to: rebook.to,
        category: rebook.category,
        seats: String(rebook.seats || 1),
        tripDate: rebookDate,
        time: rebookTime,
        bookingType: "quick",
        bookForWholeWeek: "false",
      },
    } as any);

    setRebook(null);
  };

  const handleRideStart = (r: RideBooking) => {
    if (!canStartTrip(r)) {
      Alert.alert(
        "Not available yet",
        getStartTripBlockedReason(r) ||
          "You can start this trip only on the trip date.",
      );
      return;
    }

    runApp(r.id, async () => {
      await startRide(r.id, r);
      router.push({
        pathname: "/driver/ride-navigation",
        params: { id: r.id },
      } as any);
    });
  };

  const handleRideOpenMap = (r: RideBooking) =>
    router.push({
      pathname: "/driver/ride-navigation",
      params: { id: r.id },
    } as any);

  const handleRideArrived = (r: RideBooking) =>
    runApp(r.id, () => arriveRide(r.id, r));

  const handleRideFinish = (r: RideBooking) =>
    runApp(r.id, () => finishRide(r.id, r));
    const bookingNeedsRating = (
    b: BookingItem | RideBooking | NormalizedApplication,
  ) => {
    const item: any = b;

    if (ratedSchoolBookingIds.includes(b.id)) {
      return false;
    }

    return (
      (item.status === "completed" || item.tripStatus === "completed") &&
      item.needsPassengerRating === true &&
      item.ratingSubmitted !== true &&
      typeof item.rating !== "number" &&
      // BookingItem/RideBooking carry driverId; NormalizedApplication
      // (work/errand) carries providerId — the driver/service owner either way.
      !!(item.driverId || item.providerId)
    );
  };

const openSchoolRatingModal = (b: BookingItem) => {
  setSchoolRatingBooking(b);
  setRatingBooking(null);
  setAppRatingBooking(null);
  setRoadsideRatingBooking(null);
  setRatingStars(0);
  setRatingComment("");
};

const openAppRatingModal = (a: NormalizedApplication) => {
  setAppRatingBooking(a);
  setRatingBooking(null);
  setSchoolRatingBooking(null);
  setRoadsideRatingBooking(null);
  setRatingStars(0);
  setRatingComment("");
};

const openRoadsideRatingModal = (b: BookingItem) => {
  setRoadsideRatingBooking(b);
  setRatingBooking(null);
  setSchoolRatingBooking(null);
  setAppRatingBooking(null);
  setRatingStars(0);
  setRatingComment("");
};

const submitSchoolRating = async (
  booking: BookingItem,
  stars: number,
  comment: string,
) => {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Please login first.");
  }

  const item: any = booking;

  // driverId must be the driver's real Firebase UID — never this booking's
  // own id or its routeId — so the rating is never attributed to the wrong
  // profile.
  if (!item.driverId || item.driverId === booking.id || item.driverId === item.routeId) {
    throw new Error("Missing driver id.");
  }

  const bookingRef = doc(db, "bookings", booking.id);
  const driverRef = doc(db, "users", item.driverId);
  const reviewRef = doc(collection(db, "driverReviews"));

  await runTransaction(db, async (transaction) => {
    const bookingSnap = await transaction.get(bookingRef);

    if (!bookingSnap.exists()) {
      throw new Error("Booking not found.");
    }

    const bookingData: any = bookingSnap.data();

    if (bookingData.ratingSubmitted === true) {
      return;
    }

    const driverSnap = await transaction.get(driverRef);
    const driverData: any = driverSnap.exists() ? driverSnap.data() : {};

    const oldCount = Number(driverData.ratingCount || 0);
    const oldSum = Number(driverData.ratingSum || 0);

    const newCount = oldCount + 1;
    const newSum = oldSum + stars;
    const newAverage = Number((newSum / newCount).toFixed(2));

    transaction.set(reviewRef, {
      bookingId: booking.id,
      routeId: item.routeId || "",
      category: item.category || "school",

      driverId: item.driverId,
      driverName: item.driverName || "Driver",

      passengerId: user.uid,
      passengerName: item.passengerName || user.displayName || "Passenger",

      rating: stars,
      comment: comment.trim(),

      from: item.from || "",
      to: item.to || "",
      date: item.date || "",
      time: item.time || "",

      createdAt: serverTimestamp(),
    });

    transaction.update(bookingRef, {
      rating: stars,
      reviewComment: comment.trim(),
      ratingSubmitted: true,
      needsPassengerRating: false,
      ratedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

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
};

  const openRatingModal = (r: RideBooking) => {
    setRatingBooking(r);
    setSchoolRatingBooking(null);
    setAppRatingBooking(null);
    setRoadsideRatingBooking(null);
    setRatingStars(0);
    setRatingComment("");
  };

const submitRating = async () => {
  if (ratingStars < 1 || ratingBusy) return;

  try {
    setRatingBusy(true);

    if (schoolRatingBooking) {
      const bookingToRate = schoolRatingBooking;
      const ratedId = bookingToRate.id;
      const stars = ratingStars;
      const comment = ratingComment.trim();

      // Close the rating popup immediately and block it from reopening
      // while Firestore is saving the rating.
      setRatedSchoolBookingIds((prev) =>
        prev.includes(ratedId) ? prev : [...prev, ratedId],
      );

      setBookings((prev) =>
        prev.map((b) =>
          b.id === ratedId
            ? ({
                ...b,
                rating: stars,
                reviewComment: comment,
                ratingSubmitted: true,
                needsPassengerRating: false,
              } as any)
            : b,
        ),
      );

      setSchoolRatingBooking(null);
      setRatingStars(0);
      setRatingComment("");

      await submitSchoolRating(bookingToRate, stars, comment);
      return;
    }

    if (appRatingBooking) {
      const appToRate = appRatingBooking;
      const ratedId = appToRate.id;
      const stars = ratingStars;
      const comment = ratingComment.trim();

      // Close the rating popup immediately and block it from reopening
      // while Firestore is saving the rating.
      setRatedSchoolBookingIds((prev) =>
        prev.includes(ratedId) ? prev : [...prev, ratedId],
      );

      const patchApp = (list: NormalizedApplication[]) =>
        list.map((a) =>
          a.id === ratedId
            ? {
                ...a,
                rating: stars,
                reviewComment: comment,
                ratingSubmitted: true,
                needsPassengerRating: false,
              }
            : a,
        );

      if (appToRate.kind === "work") {
        setMyWorkApps(patchApp);
      } else {
        setMyErrandApps(patchApp);
      }

      setAppRatingBooking(null);
      setRatingStars(0);
      setRatingComment("");

      await submitApplicationRating(
        appToRate.kind,
        appToRate.id,
        appToRate,
        stars,
        comment,
      );
      return;
    }

    if (roadsideRatingBooking) {
      const bookingToRate = roadsideRatingBooking;
      const ratedId = bookingToRate.id;
      const stars = ratingStars;
      const comment = ratingComment.trim();

      // Close the rating popup immediately and block it from reopening
      // while Firestore is saving the rating.
      setRatedSchoolBookingIds((prev) =>
        prev.includes(ratedId) ? prev : [...prev, ratedId],
      );

      setBookings((prev) =>
        prev.map((b) =>
          b.id === ratedId
            ? {
                ...b,
                rating: stars,
                reviewComment: comment,
                ratingSubmitted: true,
                needsPassengerRating: false,
              }
            : b,
        ),
      );

      setRoadsideRatingBooking(null);
      setRatingStars(0);
      setRatingComment("");

      await submitRoadsideRating(bookingToRate.id, bookingToRate, stars, comment);
      return;
    }

    if (ratingBooking) {
      const bookingToRate = ratingBooking;
      const ratedId = bookingToRate.id;
      const stars = ratingStars;
      const comment = ratingComment.trim();

      // Close the rating popup immediately and block it from reopening
      // while Firestore is saving the rating.
      setRatedSchoolBookingIds((prev) =>
        prev.includes(ratedId) ? prev : [...prev, ratedId],
      );

      setPassengerRides((prev) =>
        prev.map((r) =>
          r.id === ratedId
            ? {
                ...r,
                rating: stars,
                reviewComment: comment,
                ratingSubmitted: true,
                needsPassengerRating: false,
              }
            : r,
        ),
      );

      setRatingBooking(null);
      setRatingStars(0);
      setRatingComment("");

      await submitRideRating(bookingToRate.id, bookingToRate, stars, comment);
    }
  } catch (error: any) {
    Alert.alert("Error", error?.message || "Could not submit your rating.");
  } finally {
    setRatingBusy(false);
  }
};

useEffect(() => {
  if (tab !== "passenger") return;
  if (
    ratingBooking ||
    schoolRatingBooking ||
    appRatingBooking ||
    roadsideRatingBooking ||
    ratingBusy
  ) {
    return;
  }

  const pendingRideRating = passengerRides.find((r) => bookingNeedsRating(r));

  if (pendingRideRating) {
    openRatingModal(pendingRideRating);
    return;
  }

  // Roadside always requires payment before rating opens (see
  // finishRoadsideHelp/payRoadsideHelp in roadsideLib.ts) — every other
  // category here (School) has no such payment gate.
  const pendingSchoolRating = bookings.find(
    (b) => b.category !== "roadside" && bookingNeedsRating(b),
  );

  if (pendingSchoolRating) {
    openSchoolRatingModal(pendingSchoolRating);
    return;
  }

  const pendingRoadsideRating = bookings.find(
    (b) =>
      b.category === "roadside" &&
      bookingNeedsRating(b) &&
      b.paymentStatus === "paid",
  );

  if (pendingRoadsideRating) {
    openRoadsideRatingModal(pendingRoadsideRating);
    return;
  }

  const pendingAppRating = passengerApps.find((a) => bookingNeedsRating(a));

  if (pendingAppRating) {
    openAppRatingModal(pendingAppRating);
  }
}, [
  bookings,
  passengerRides,
  passengerApps,
  tab,
  ratingBooking,
  schoolRatingBooking,
  appRatingBooking,
  roadsideRatingBooking,
  ratingBusy,
  ratedSchoolBookingIds,
]);


  const renderDeleteButton = (onPress: () => void) => (
    <Pressable style={styles.deleteButton} onPress={onPress} hitSlop={8}>
      <Ionicons name="trash-outline" size={18} color="#B91C1C" />
    </Pressable>
  );

  const renderPassengerDriverDetails = (r: RideBooking) => {
    const hasCarDetails =
      !!r.driverCar || !!r.driverCarColor || !!r.driverCarPlateLast3;
    const hasPhone = !!r.driverPhone;

    if (!hasCarDetails && !hasPhone) return null;

    return (
      <View style={styles.driverDetailsBox}>
        <Text style={styles.driverDetailsTitle}>Driver details</Text>

        {r.driverCar ? (
          <View style={styles.infoRow}>
            <Ionicons name="car-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>Car: {r.driverCar}</Text>
          </View>
        ) : null}

        {r.driverCarColor ? (
          <View style={styles.infoRow}>
            <Ionicons name="color-palette-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>Color: {r.driverCarColor}</Text>
          </View>
        ) : null}

        {r.driverCarPlateLast3 ? (
          <View style={styles.infoRow}>
            <Ionicons name="barcode-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>
              Plate: ***{r.driverCarPlateLast3}
            </Text>
          </View>
        ) : null}

        {hasPhone ? (
          <Pressable
            style={styles.phoneRow}
            onPress={() => callPhone(r.driverPhone)}
          >
            <Ionicons name="call-outline" size={15} color="#F58220" />
            <Text style={styles.phoneText}>
              {formatPhoneForDisplay(r.driverPhone)}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  const renderRideStatus = (status: RideStatus) => {
    const done = status === "completed";
    const dead = status === "cancelled";
    const pillStyle = done
      ? styles.statusDone
      : dead
        ? styles.statusDead
        : styles.statusOngoing;
    const textStyle = done
      ? styles.statusTextDone
      : dead
        ? styles.statusTextDead
        : styles.statusTextOngoing;

    return (
      <View style={[styles.statusPill, pillStyle]}>
        <Text style={[styles.statusText, textStyle]}>
          {RIDE_STATUS_LABEL[status]}
        </Text>
      </View>
    );
  };

  const renderRideCard = (r: RideBooking, viewer: Tab) => {
    const meta = getCategoryMeta(RIDE_CATEGORY);
    const otherName = viewer === "passenger" ? r.driverName : r.passengerName;
    const busy = busyId === r.id;
    const rideCanStart = canStartTrip(r);
    const rideBlockedReason = getStartTripBlockedReason(r);

    return (
      <View
        key={`ride-${r.id}`}
        style={[styles.card, r.status === "completed" && styles.cardDone]}
      >
        <View style={styles.cardTop}>
          <View
            style={[styles.catChip, { backgroundColor: `${meta.color}18` }]}
          >
            <Ionicons name={meta.icon} size={15} color={meta.color} />
            <Text style={[styles.catText, { color: meta.color }]}>
              {meta.label}
            </Text>
          </View>

          <View style={styles.cardTopActions}>
            {renderRideStatus(r.status)}
            {renderDeleteButton(() => confirmHideRideBooking(r, viewer))}
          </View>
        </View>

        {renderRouteLine(r.from, r.to, "")}

        {r.date ? (
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>
              {r.date}
              {r.day ? ` (${r.day})` : ""}
            </Text>
          </View>
        ) : null}

        {r.time ? (
          <View style={styles.infoRow}>
            <Ionicons name="time-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>{r.time}</Text>
          </View>
        ) : null}

        <View style={styles.infoRow}>
          <Ionicons name="person-outline" size={15} color="#7C5F46" />
          <Text style={styles.infoText}>{otherName}</Text>
        </View>

        {viewer === "passenger" ? renderPassengerDriverDetails(r) : null}

        <View style={styles.metaRow}>
          {typeof r.price === "number" ? (
            <View style={styles.metaItem}>
              <Ionicons name="cash-outline" size={15} color="#F58220" />
              <Text style={styles.metaText}>{r.price} ₪</Text>
            </View>
          ) : null}

          {typeof r.seats === "number" ? (
            <View style={styles.metaItem}>
              <Ionicons name="people-outline" size={15} color="#F58220" />
              <Text style={styles.metaText}>{r.seats} seats</Text>
            </View>
          ) : null}
        </View>

        {r.paymentMethod ? (
          <View style={styles.payRow}>
            <Ionicons name="card-outline" size={14} color="#7C5F46" />
            <Text style={styles.payText}>
              {paymentMethodLabel(r.paymentMethod)}
              {r.cardLast4 ? ` (•••• ${r.cardLast4})` : ""}
            </Text>
          </View>
        ) : null}

        {r.status === "completed" && typeof r.rating === "number" ? (
          <View style={styles.ratingSummaryRow}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Ionicons
                key={i}
                name={i < (r.rating || 0) ? "star" : "star-outline"}
                size={16}
                color="#F58220"
              />
            ))}

            {r.reviewComment ? (
              <Text style={styles.ratingComment}>“{r.reviewComment}”</Text>
            ) : null}
          </View>
        ) : null}

          {viewer === "passenger" ? (
            <>
              {/* Personal Ride never shows Live Tracking — renderRideCard is
                  exclusively the personal ride pipeline (RIDE_CATEGORY). */}

              {r.status === "completed" && bookingNeedsRating(r) ? (
                <Pressable
                  style={styles.primaryButton}
                  onPress={() => openRatingModal(r)}
                >
                  <Ionicons name="star-outline" size={17} color="#FFFFFF" />
                  <Text style={styles.primaryButtonText}>Rate Driver</Text>
                </Pressable>
              ) : null}

            {r.status === "completed" &&
            !bookingNeedsRating(r) &&
            typeof r.rating === "number" ? (
              <Pressable
                style={styles.primaryButton}
                onPress={() => openRideRebook(r)}
              >
                <Ionicons name="refresh" size={17} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>Book Again</Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <>
            {r.status === "booked" ? (
              <>
                <Pressable
                  style={[
                    styles.startButton,
                    !rideCanStart && styles.startDisabled,
                  ]}
                  onPress={() => handleRideStart(r)}
                  disabled={busy || !rideCanStart}
                >
                  <Ionicons name="play" size={16} color="#FFFFFF" />
                  <Text style={styles.startButtonText}>Start Ride</Text>
                </Pressable>

                {!rideCanStart && rideBlockedReason ? (
                  <Text style={styles.appHint}>{rideBlockedReason}</Text>
                ) : null}
              </>
            ) : null}

            {r.status === "on_the_way" ? (
              <View style={styles.appActionsRow}>
                <Pressable
                  style={styles.completeButton}
                  onPress={() => handleRideOpenMap(r)}
                >
                  <Ionicons name="navigate-outline" size={16} color="#166534" />
                  <Text style={styles.completeButtonText}>Open Map</Text>
                </Pressable>

                <Pressable
                  style={styles.startButton}
                  onPress={() => handleRideArrived(r)}
                  disabled={busy}
                >
                  <Text style={styles.startButtonText}>I arrived</Text>
                </Pressable>
              </View>
            ) : null}

            {r.status === "arrived" ? (
              <Pressable
                style={styles.primaryButton}
                onPress={() => handleRideFinish(r)}
                disabled={busy}
              >
                <Ionicons name="checkmark-done" size={17} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>Finish Trip</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    );
  };

  const renderStatus = (status: string, label?: string) => (
    <View
      style={[
        styles.statusPill,
        status === "completed" ? styles.statusDone : styles.statusOngoing,
      ]}
    >
      <Ionicons
        name={status === "completed" ? "checkmark-circle" : "time"}
        size={13}
        color={status === "completed" ? "#166534" : "#B86115"}
      />
      <Text
        style={[
          styles.statusText,
          status === "completed"
            ? styles.statusTextDone
            : styles.statusTextOngoing,
        ]}
      >
        {label || (status === "completed" ? "Completed" : "Ongoing")}
      </Text>
    </View>
  );

  const renderRouteLine = (from: string, to: string, place: string) => {
    if (from || to) {
      return (
        <View style={styles.infoRow}>
          <Ionicons name="location-outline" size={15} color="#7C5F46" />
          <Text style={styles.infoText}>
            {from || "?"} → {to || "?"}
          </Text>
        </View>
      );
    }

    if (place) {
      return (
        <View style={styles.infoRow}>
          <Ionicons name="location-outline" size={15} color="#7C5F46" />
          <Text style={styles.infoText}>{place}</Text>
        </View>
      );
    }

    return null;
  };

  const renderBookingCard = (b: BookingItem, viewer: Tab = "passenger") => {
    const meta = getCategoryMeta(b.category);
    const tripStatus = (b as any).tripStatus;
    const done = b.status === "completed" || tripStatus === "completed";
    const isSchool = b.category === "school";
    const isPersonalCategory = b.category === "personal";
    // School and (weekly) personal bookings both drive through the ride
    // navigation screen for their Start Ride -> Finish Trip lifecycle.
    const usesRideNavigation = isSchool || isPersonalCategory;
    const isDriverView = viewer === "driver";
    const bookingCanStart = canStartTrip(b);
    const bookingBlockedReason = getStartTripBlockedReason(b);

    return (
      <View key={b.id} style={[styles.card, done && styles.cardDone]}>
        <View style={styles.cardTop}>
          <View
            style={[styles.catChip, { backgroundColor: `${meta.color}18` }]}
          >
            <Ionicons name={meta.icon} size={15} color={meta.color} />
            <Text style={[styles.catText, { color: meta.color }]}>
              {meta.label}
            </Text>
          </View>

          <View style={styles.cardTopActions}>
            {renderBookingTripStatus(b)}
            {renderDeleteButton(() =>
              confirmHideGeneralBooking(b, viewer),
            )}
          </View>
        </View>

        {renderRouteLine(b.from, b.to, "")}

        {b.date ? (
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>{b.date}</Text>
          </View>
        ) : null}

        {b.time ? (
          <View style={styles.infoRow}>
            <Ionicons name="time-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>{b.time}</Text>
          </View>
        ) : null}

        <View style={styles.infoRow}>
          <Ionicons name="person-outline" size={15} color="#7C5F46" />
          <Text style={styles.infoText}>
            {isDriverView ? b.passengerName : b.driverName}
          </Text>
        </View>

        <View style={styles.metaRow}>
          {typeof b.price === "number" ? (
            <View style={styles.metaItem}>
              <Ionicons name="cash-outline" size={15} color="#F58220" />
              <Text style={styles.metaText}>{b.price} ₪</Text>
            </View>
          ) : null}

          {typeof b.seats === "number" ? (
            <View style={styles.metaItem}>
              <Ionicons name="people-outline" size={15} color="#F58220" />
              <Text style={styles.metaText}>{b.seats} seats</Text>
            </View>
          ) : null}
        </View>

        {viewer === "passenger" ? (
          <>
            {tripStatus === "arrived_pickup" ? (
              <View style={styles.waitBanner}>
                <Ionicons name="car-outline" size={16} color="#B86115" />
                <Text style={styles.waitText}>
                  Driver arrived. Please go to the car.
                </Text>
              </View>
            ) : null}

            {canShowLiveTracking(b) ? (
              <Pressable
                style={styles.liveTrackButton}
                onPress={() => openLiveTracking(b.id)}
              >
                <Ionicons name="map-outline" size={17} color="#FFFFFF" />
                <Text style={styles.liveTrackButtonText}>Live Tracking</Text>
              </Pressable>
            ) : null}

            {done && bookingNeedsRating(b) ? (
              <Pressable
                style={styles.primaryButton}
                onPress={() => openSchoolRatingModal(b)}
              >
                <Ionicons name="star-outline" size={17} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>Rate Driver</Text>
              </Pressable>
            ) : null}

            {done && !bookingNeedsRating(b) ? (
              <Pressable
                style={styles.primaryButton}
                onPress={() => openRebook(b)}
              >
                <Ionicons name="refresh" size={17} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>Book Again</Text>
              </Pressable>
            ) : null}

            {!done && !usesRideNavigation ? (
              <Pressable
                style={styles.completeButton}
                onPress={() => confirmComplete("bookings", b.id, "booking")}
              >
                <Ionicons name="checkmark-done" size={17} color="#166534" />
                <Text style={styles.completeButtonText}>Mark as Completed</Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <>
            {usesRideNavigation && tripStatus === "booked" ? (
              <>
                <Pressable
                  style={[
                    styles.startButton,
                    !bookingCanStart && styles.startDisabled,
                  ]}
                  onPress={() => {
                    if (!canStartTrip(b)) {
                      Alert.alert(
                        "Not available yet",
                        getStartTripBlockedReason(b) ||
                          "You can start this trip only on the trip date.",
                      );
                      return;
                    }

                    openSchoolRideNavigation(b.id);
                  }}
                  disabled={!bookingCanStart}
                >
                  <Ionicons name="play" size={16} color="#FFFFFF" />
                  <Text style={styles.startButtonText}>Start Ride</Text>
                </Pressable>

                {!bookingCanStart && bookingBlockedReason ? (
                  <Text style={styles.appHint}>{bookingBlockedReason}</Text>
                ) : null}
              </>
            ) : null}

            {usesRideNavigation &&
            (tripStatus === "driver_on_way" ||
              tripStatus === "arrived_pickup" ||
              tripStatus === "in_progress") ? (
              <Pressable
                style={styles.startButton}
                onPress={() => openSchoolRideNavigation(b.id)}
              >
                <Ionicons name="navigate-outline" size={16} color="#FFFFFF" />
                <Text style={styles.startButtonText}>Open Ride Navigation</Text>
              </Pressable>
            ) : null}

            {!usesRideNavigation && !done ? (
              <Pressable
                style={styles.completeButton}
                onPress={() => confirmComplete("bookings", b.id, "booking")}
              >
                <Ionicons name="checkmark-done" size={17} color="#166534" />
                <Text style={styles.completeButtonText}>Mark as Completed</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    );
  };

  const renderTripCard = (t: DriverTripItem) => {
    const meta = getCategoryMeta(t.category);
    const done = t.status === "completed";
    const daysText = t.days.length > 0 ? t.days.join(", ") : "";
    const waitingForBooking = !done && !isTripBookedOrActive(t);

    return (
      <View
        key={`${t.collectionName}-${t.id}`}
        style={[styles.card, done && styles.cardDone]}
      >
        <View style={styles.cardTop}>
          <View
            style={[styles.catChip, { backgroundColor: `${meta.color}18` }]}
          >
            <Ionicons name={meta.icon} size={15} color={meta.color} />
            <Text style={[styles.catText, { color: meta.color }]}>
              {meta.label}
            </Text>
          </View>

          <View style={styles.cardTopActions}>
            {renderStatus(
              t.status,
              waitingForBooking ? "Waiting for booking" : undefined,
            )}
            {renderDeleteButton(() => confirmDeleteTrip(t))}
          </View>
        </View>

        {t.title ? <Text style={styles.tripTitle}>{t.title}</Text> : null}

        {renderRouteLine(t.from, t.to, t.location)}

        {t.date ? (
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>{t.date}</Text>
          </View>
        ) : null}

        {daysText ? (
          <View style={styles.infoRow}>
            <Ionicons name="repeat-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>{daysText}</Text>
          </View>
        ) : null}

        {t.time ? (
          <View style={styles.infoRow}>
            <Ionicons name="time-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>{t.time}</Text>
          </View>
        ) : null}

        <View style={styles.metaRow}>
          {typeof t.price === "number" ? (
            <View style={styles.metaItem}>
              <Ionicons name="cash-outline" size={15} color="#F58220" />
              <Text style={styles.metaText}>{t.price} ₪</Text>
            </View>
          ) : null}

          {t.collectionName === "workJobs" ? (
            <>
              {typeof t.totalSeats === "number" ? (
                <View style={styles.metaItem}>
                  <Ionicons name="people-outline" size={15} color="#F58220" />
                  <Text style={styles.metaText}>
                    Workers needed: {t.totalSeats}
                  </Text>
                </View>
              ) : null}

              {typeof t.acceptedWorkersCount === "number" &&
              t.acceptedWorkersCount > 0 ? (
                <View style={styles.metaItem}>
                  <Ionicons name="person-add-outline" size={15} color="#F58220" />
                  <Text style={styles.metaText}>
                    Accepted: {t.acceptedWorkersCount}
                  </Text>
                </View>
              ) : null}

              {typeof t.remainingSeats === "number" ? (
                <View style={styles.metaItem}>
                  <Ionicons
                    name="checkmark-done-outline"
                    size={15}
                    color="#F58220"
                  />
                  <Text style={styles.metaText}>
                    Places remaining: {t.remainingSeats}
                  </Text>
                </View>
              ) : null}
            </>
          ) : typeof t.seats === "number" ? (
            <View style={styles.metaItem}>
              <Ionicons name="people-outline" size={15} color="#F58220" />
              <Text style={styles.metaText}>{t.seats}</Text>
            </View>
          ) : null}
        </View>

{!done && !(t.collectionName === "driverRoutes" && t.category === "school") ? (
  <Pressable
    style={styles.completeButton}
    onPress={() => confirmComplete(t.collectionName, t.id, "trip")}
  >
    <Ionicons name="checkmark-done" size={17} color="#166534" />
    <Text style={styles.completeButtonText}>Mark as Completed</Text>
  </Pressable>
) : null}
      </View>
    );
  };

  const goToRoadsidePayment = (b: BookingItem) => {
    router.push({
      pathname: "/booking/roadside-help/payment",
      params: {
        bookingId: b.id,
        requestId: b.requestId,
        offerId: b.offerId,
        driverId: b.driverId,
        driverName: b.driverName,
        amount: typeof b.price === "number" ? String(b.price) : "",
        category: "roadside",
      },
    } as any);
  };

  const renderRoadsideCard = (b: BookingItem, viewer: Tab) => {
    const meta = getCategoryMeta("roadside");
    const otherName = viewer === "passenger" ? b.driverName : b.passengerName;
    const otherPhone = viewer === "passenger" ? b.driverPhone : b.passengerPhone;
    const isDriverView = viewer === "driver";

    const isAccepted = b.status !== "completed" && !b.helpCompleted;
    const isCompletedUnpaid =
      (b.status === "completed" || b.helpCompleted) && b.paymentStatus !== "paid";
    const isPaid = b.paymentStatus === "paid";

    return (
      <View
        key={`roadside-${b.id}`}
        style={[styles.card, !isAccepted && styles.cardDone]}
      >
        <View style={styles.cardTop}>
          <View
            style={[styles.catChip, { backgroundColor: `${meta.color}18` }]}
          >
            <Ionicons name={meta.icon} size={15} color={meta.color} />
            <Text style={[styles.catText, { color: meta.color }]}>
              Roadside Help
            </Text>
          </View>

          <View style={styles.cardTopActions}>
            {isPaid ? (
              <View style={[styles.statusPill, styles.statusDone]}>
                <Ionicons name="cash" size={13} color="#166534" />
                <Text style={[styles.statusText, styles.statusTextDone]}>
                  Payment received
                </Text>
              </View>
            ) : isCompletedUnpaid ? (
              <View style={[styles.statusPill, styles.statusOngoing]}>
                <Ionicons name="time" size={13} color="#B86115" />
                <Text style={[styles.statusText, styles.statusTextOngoing]}>
                  Waiting for payment
                </Text>
              </View>
            ) : (
              <View style={[styles.statusPill, styles.statusOngoing]}>
                <Ionicons name="checkmark-circle" size={13} color="#B86115" />
                <Text style={[styles.statusText, styles.statusTextOngoing]}>
                  Accepted
                </Text>
              </View>
            )}
            {renderDeleteButton(() =>
              confirmHideGeneralBooking(b, viewer, "roadside help"),
            )}
          </View>
        </View>

        {b.problemTypes.length > 0 ? (
          <View style={styles.chipRow}>
            {b.problemTypes.map((p) => (
              <View key={p} style={styles.problemChip}>
                <Text style={styles.problemChipText}>{p}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {b.description ? (
          <Text style={styles.description}>{b.description}</Text>
        ) : null}

        {b.address ? (
          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>{b.address}</Text>
          </View>
        ) : null}

        <View style={styles.infoRow}>
          <Ionicons name="person-outline" size={15} color="#7C5F46" />
          <Text style={styles.infoText}>{otherName}</Text>
        </View>

        {otherPhone ? (
          <Pressable style={styles.infoRow} onPress={() => callPhone(otherPhone)}>
            <Ionicons name="call-outline" size={15} color="#F58220" />
            <Text style={styles.infoText}>{otherPhone}</Text>
          </Pressable>
        ) : null}

        <View style={styles.metaRow}>
          {typeof b.price === "number" ? (
            <View style={styles.metaItem}>
              <Ionicons name="cash-outline" size={15} color="#F58220" />
              <Text style={styles.metaText}>{b.price} ₪</Text>
            </View>
          ) : null}

          {typeof b.etaMinutes === "number" ? (
            <View style={styles.metaItem}>
              <Ionicons name="time-outline" size={15} color="#F58220" />
              <Text style={styles.metaText}>{b.etaMinutes} min</Text>
            </View>
          ) : null}
        </View>

        {!isDriverView && isCompletedUnpaid ? (
          <Pressable
            style={styles.primaryButtonFull}
            onPress={() => goToRoadsidePayment(b)}
          >
            <Ionicons name="card" size={18} color="#FFFFFF" />
            <Text style={styles.primaryButtonText}>Pay Now</Text>
          </Pressable>
        ) : null}

        {isPaid && typeof b.rating === "number" ? (
          <View style={styles.ratingSummaryRow}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Ionicons
                key={i}
                name={i < (b.rating || 0) ? "star" : "star-outline"}
                size={16}
                color="#F58220"
              />
            ))}

            {b.reviewComment ? (
              <Text style={styles.ratingComment}>“{b.reviewComment}”</Text>
            ) : null}
          </View>
        ) : null}

        {!isDriverView && isPaid && bookingNeedsRating(b) ? (
          <Pressable
            style={styles.primaryButton}
            onPress={() => openRoadsideRatingModal(b)}
          >
            <Ionicons name="star-outline" size={17} color="#FFFFFF" />
            <Text style={styles.primaryButtonText}>Rate Helper</Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  // Weekly bookings share a bookingGroupId (one document per booked day,
  // possibly with different drivers). Render each group's day-cards together
  // under one "Weekly booking" header instead of scattering them in the list.
  const renderWeeklyGroup = (groupItems: BookingItem[], viewer: Tab) => {
    const sorted = [...groupItems].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    );

    const dayLabels = sorted
      .map((item) => item.dayName || item.date)
      .filter(Boolean)
      .join(", ");

    return (
      <View
        key={`group-${sorted[0].bookingGroupId}`}
        style={styles.weeklyGroupBox}
      >
        <View style={styles.weeklyGroupHeader}>
          <Ionicons name="calendar-outline" size={15} color="#F58220" />
          <Text style={styles.weeklyGroupHeaderText}>
            Weekly booking{dayLabels ? ` · ${dayLabels}` : ""}
          </Text>
        </View>

        {sorted.map((item) => renderBookingCard(item, viewer))}
      </View>
    );
  };

  const renderWithCardRef = (id: string, node: React.ReactNode) => (
    <View
      key={`ref-${id}`}
      ref={(n) => {
        appCardRefs.current[id] = n;
      }}
      style={highlightAppId === id ? styles.highlightWrap : undefined}
    >
      {node}
    </View>
  );

  // Single dispatcher for the ONE combined, already-sorted list — never
  // re-groups or re-sorts by category. `rows` is whatever order
  // sortMyBookings produced; this only picks the right card renderer per row.
  const renderCombinedRows = (rows: CombinedRow[], viewer: Tab) => {
    const renderedGroupIds = new Set<string>();

    return rows.map((row) => {
      if (row._kind === "ride") {
        return renderRideCard(row, viewer);
      }

      if (row._kind === "trip") {
        return renderTripCard(row);
      }

      if (row._kind === "application") {
        return renderWithCardRef(row.id, renderApplicationCard(row, viewer));
      }

      // row._kind === "booking"
      if (row.category === "roadside") {
        // Driver side renders the SAME shared card + SAME roadsideRequests
        // source of truth as Help Requests (see roadsideLib.ts). Passenger
        // side keeps its own card (payment button, no driver actions).
        const liveRequest =
          viewer === "driver" && row.requestId
            ? driverRoadsideRequestsById.get(row.requestId)
            : undefined;

        if (liveRequest) {
          return renderWithCardRef(
            row.id,
            <RoadsideAcceptedCard
              key={`live-${row.id}`}
              request={liveRequest}
              onDelete={() =>
                confirmHideGeneralBooking(row, viewer, "roadside help")
              }
            />,
          );
        }

        return renderWithCardRef(row.id, renderRoadsideCard(row, viewer));
      }

      if (row.bookingGroupId) {
        if (renderedGroupIds.has(row.bookingGroupId)) return null;

        renderedGroupIds.add(row.bookingGroupId);

        const groupItems: BookingItem[] = rows.filter(
          (r): r is TaggedBooking =>
            r._kind === "booking" && r.bookingGroupId === row.bookingGroupId,
        );

        return renderWeeklyGroup(groupItems, viewer);
      }

      return renderBookingCard(row, viewer);
    });
  };

  const renderApplicationCard = (a: NormalizedApplication, viewer: Tab) => {
    const meta = getCategoryMeta(a.category);
    const done = a.status === "completed";
    const dead = a.status === "cancelled" || a.status === "rejected";
    const busy = busyId === a.id;

    const statusStyle =
      a.status === "completed"
        ? styles.statusDone
        : dead
          ? styles.statusDead
          : styles.statusOngoing;

    const statusTextStyle =
      a.status === "completed"
        ? styles.statusTextDone
        : dead
          ? styles.statusTextDead
          : styles.statusTextOngoing;

    const otherName = viewer === "passenger" ? a.providerName : a.customerName;

    const future = startState(a.date) === "future";
    const cancelBlocked = cancelBlockedReason(a);

    return (
      <View
        key={`${a.kind}-app-${a.id}`}
        style={[styles.card, (done || dead) && styles.cardDone]}
      >
        <View style={styles.cardTop}>
          <View
            style={[styles.catChip, { backgroundColor: `${meta.color}18` }]}
          >
            <Ionicons name={meta.icon} size={15} color={meta.color} />
            <Text style={[styles.catText, { color: meta.color }]}>
              {meta.label}
            </Text>
          </View>

          <View style={styles.cardTopActions}>
            <View style={[styles.statusPill, statusStyle]}>
              <Text style={[styles.statusText, statusTextStyle]}>
                {STATUS_LABEL[a.status]}
              </Text>
            </View>

            {renderDeleteButton(() => confirmHideApplication(a, viewer))}
          </View>
        </View>

        {a.title ? <Text style={styles.tripTitle}>{a.title}</Text> : null}

        {a.date ? (
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>
              {a.date}
              {a.startTime ? `  ${a.startTime}` : ""}
              {a.endTime ? ` - ${a.endTime}` : ""}
            </Text>
          </View>
        ) : null}

        <View style={styles.infoRow}>
          <Ionicons name="person-outline" size={15} color="#7C5F46" />
          <Text style={styles.infoText}>{otherName}</Text>
        </View>

        {viewer === "driver" ? (
          <View style={styles.infoRow}>
            <Ionicons name="business-outline" size={15} color="#7C5F46" />
            <Text style={styles.infoText}>
              {a.city}
              {a.neighborhood ? ` · ${a.neighborhood}` : ""}
            </Text>
          </View>
        ) : null}

        {viewer === "driver" && a.status === "pending" ? (
          // Pending Accept/Reject decision: show the passenger's age instead
          // of the price/wage — the driver needs the age to decide, not the
          // price. Price/hourlyPay stay in Firestore untouched for payment
          // later; they're just not the headline here.
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Ionicons name="person-outline" size={15} color="#F58220" />
              <Text style={styles.metaText}>
                {a.customerAge !== null
                  ? `Passenger age: ${a.customerAge} years`
                  : "Passenger age not available"}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.metaRow}>
            {a.price !== null ? (
              <View style={styles.metaItem}>
                <Ionicons name="cash-outline" size={15} color="#F58220" />
                <Text style={styles.metaText}>{a.price} ₪</Text>
              </View>
            ) : null}

            {a.hourlyPay !== null ? (
              <View style={styles.metaItem}>
                <Ionicons name="cash-outline" size={15} color="#F58220" />
                <Text style={styles.metaText}>{a.hourlyPay} ₪/hr</Text>
              </View>
            ) : null}
          </View>
        )}

        <View style={styles.payRow}>
          <Ionicons name="card-outline" size={14} color="#7C5F46" />
          <Text style={styles.payText}>
            {a.kind === "work"
              ? // Work is paid in reverse (driver -> passenger, after
                // completion) — say so plainly instead of reusing the
                // generic "paymentStatus" wording, which means the opposite
                // thing for every other booking type.
                a.driverPaymentStatus === "paid"
                ? `Paid to worker${
                    a.paymentMethod
                      ? ` · ${paymentMethodLabel(a.paymentMethod)}`
                      : ""
                  }${a.cardLast4 ? ` (•••• ${a.cardLast4})` : ""}`
                : a.status === "completed"
                  ? "Payment to worker: pending"
                  : "Payment to worker: due after Finish Work"
              : a.paymentMethod
                ? `${paymentMethodLabel(a.paymentMethod)} · ${
                    a.paymentStatus
                  }${a.cardLast4 ? ` (•••• ${a.cardLast4})` : ""}`
                : "Payment: unpaid"}
          </Text>
        </View>

        {viewer === "passenger" ? (
          <>
            {a.kind === "errand" && a.status === "payment_pending_passenger" ? (
              <Pressable
                style={styles.primaryButton}
                onPress={() => goToPayment(a)}
              >
                <Ionicons name="card" size={16} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>
                  Continue to Payment
                </Text>
              </Pressable>
            ) : null}

            {a.kind === "work" &&
            a.status === "completed" &&
            a.driverPaymentStatus !== "paid" ? (
              <View style={styles.waitBanner}>
                <Ionicons name="time-outline" size={16} color="#B86115" />
                <Text style={styles.waitText}>
                  Waiting for employer payment
                </Text>
              </View>
            ) : null}

            {a.status === "completed" && bookingNeedsRating(a) ? (
              <Pressable
                style={styles.primaryButton}
                onPress={() => openAppRatingModal(a)}
              >
                <Ionicons name="star-outline" size={17} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>Rate Driver</Text>
              </Pressable>
            ) : null}

            {!cancelBlocked &&
            (a.status === "accepted" || isAwaitingPayment(a.status)) ? (
              <Pressable
                style={styles.cancelLink}
                onPress={() => handleAppCancel(a, "passenger")}
              >
                <Text style={styles.cancelLinkText}>Cancel booking</Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <>
            {a.status === "pending" ? (
              <View style={styles.appActionsRow}>
                <Pressable
                  style={styles.rejectButton}
                  onPress={() => handleAppReject(a)}
                  disabled={busy}
                >
                  <Text style={styles.rejectButtonText}>Reject</Text>
                </Pressable>

                <Pressable
                  style={styles.startButton}
                  onPress={() => handleAppAccept(a)}
                  disabled={busy}
                >
                  <Text style={styles.startButtonText}>Accept</Text>
                </Pressable>
              </View>
            ) : null}

            {a.kind === "errand" && a.status === "payment_pending_passenger" ? (
              <View style={styles.waitBanner}>
                <Ionicons name="time-outline" size={16} color="#B86115" />
                <Text style={styles.waitText}>
                  Waiting for customer payment
                </Text>
              </View>
            ) : null}

            {a.status === "accepted" ? (
              <>
                <Pressable
                  style={[styles.startButton, future && styles.startDisabled]}
                  onPress={() => handleAppStart(a)}
                  disabled={future || busy}
                >
                  <Ionicons name="play" size={16} color="#FFFFFF" />
                  <Text style={styles.startButtonText}>Start</Text>
                </Pressable>

                {future ? (
                  <Text style={styles.appHint}>
                    Start will be available on the{" "}
                    {a.kind === "work" ? "job" : "errand"} date.
                  </Text>
                ) : null}
              </>
            ) : null}

            {a.status === "on_the_way" ? (
              <View style={styles.appActionsRow}>
                <Pressable
                  style={styles.completeButton}
                  onPress={() => openNavigation(a)}
                >
                  <Ionicons name="navigate-outline" size={16} color="#166534" />
                  <Text style={styles.completeButtonText}>Open Map</Text>
                </Pressable>

                <Pressable
                  style={styles.startButton}
                  onPress={() => handleAppArrive(a)}
                  disabled={busy}
                >
                  <Text style={styles.startButtonText}>I arrived</Text>
                </Pressable>
              </View>
            ) : null}

            {a.status === "arrived" ? (
              <Pressable
                style={styles.startButton}
                onPress={() => handleAppFinish(a)}
                disabled={busy}
              >
                <Ionicons name="checkmark-done" size={16} color="#FFFFFF" />
                <Text style={styles.startButtonText}>
                  {a.kind === "work" ? "Finish Work" : "Finish Errand"}
                </Text>
              </Pressable>
            ) : null}

            {a.kind === "work" &&
            a.status === "completed" &&
            a.driverPaymentStatus !== "paid" ? (
              // Fallback re-entry in case the driver left the payment screen
              // without paying right after Finish Work.
              <Pressable
                style={styles.primaryButton}
                onPress={() => goToWorkPayment(a)}
              >
                <Ionicons name="cash-outline" size={16} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>Pay Worker</Text>
              </Pressable>
            ) : null}

            {a.kind === "work" &&
            a.status === "completed" &&
            a.driverPaymentStatus === "paid" ? (
              <View style={styles.waitBanner}>
                <Ionicons
                  name="checkmark-circle-outline"
                  size={16}
                  color="#166534"
                />
                <Text style={styles.waitText}>Worker paid</Text>
              </View>
            ) : null}

            {!cancelBlocked &&
            (a.status === "accepted" || isAwaitingPayment(a.status)) ? (
              <Pressable
                style={styles.cancelLink}
                onPress={() => handleAppCancel(a, "driver")}
              >
                <Text style={styles.cancelLinkText}>Cancel booking</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    );
  };

  const isEmpty =
    tab === "passenger"
      ? filteredPassengerRows.length === 0
      : filteredDriverRows.length === 0;

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView
        ref={mainScrollRef}
        contentContainerStyle={styles.scroll}
        onScroll={(e) => {
          scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
      >
        <View style={styles.titleRow}>
          <Text style={styles.title}>My Bookings</Text>

          {!isEmpty ? (
            <Pressable
              onPress={handleClearAllBookings}
              disabled={clearingAll}
              hitSlop={8}
            >
              <Text style={styles.clearAllText}>
                {clearingAll ? "Clearing..." : "Clear All"}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.toggle}>
          <Pressable
            style={[
              styles.toggleBtn,
              tab === "passenger" && styles.toggleBtnActive,
            ]}
            onPress={() => setTab("passenger")}
          >
            <Ionicons
              name="person-outline"
              size={16}
              color={tab === "passenger" ? "#FFFFFF" : "#7C5F46"}
            />
            <Text
              style={[
                styles.toggleText,
                tab === "passenger" && styles.toggleTextActive,
              ]}
            >
              Passenger
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.toggleBtn,
              tab === "driver" && styles.toggleBtnActive,
            ]}
            onPress={() => setTab("driver")}
          >
            <Ionicons
              name="car-outline"
              size={16}
              color={tab === "driver" ? "#FFFFFF" : "#7C5F46"}
            />
            <Text
              style={[
                styles.toggleText,
                tab === "driver" && styles.toggleTextActive,
              ]}
            >
              Driver
            </Text>
          </Pressable>
        </View>

        <View style={styles.searchRow}>
          <Ionicons name="search-outline" size={18} color="#8B7B6B" />
          <TextInput
            style={styles.searchInput}
            placeholder={
              tab === "passenger"
                ? "Search date, category, place, driver…"
                : "Search date, category, place…"
            }
            placeholderTextColor="#8B7B6B"
            value={search}
            onChangeText={setSearch}
          />

          {search ? (
            <Pressable onPress={() => setSearch("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color="#8B7B6B" />
            </Pressable>
          ) : null}
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#F58220" />
          </View>
        ) : isEmpty ? (
          <View style={styles.emptyCard}>
            <Ionicons
              name={tab === "passenger" ? "bag-handle-outline" : "car-outline"}
              size={40}
              color="#8B7B6B"
            />
            <Text style={styles.emptyTitle}>
              {search
                ? "No matches"
                : tab === "passenger"
                  ? "No bookings yet"
                  : "No trips yet"}
            </Text>
            <Text style={styles.emptyText}>
              {tab === "passenger"
                ? "When you book a driver, it will appear here."
                : "Trips and jobs you create as a driver will appear here."}
            </Text>
          </View>
        ) : tab === "passenger" ? (
          <View style={styles.list}>
            {renderCombinedRows(filteredPassengerRows, "passenger")}
          </View>
        ) : (
          <>
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="flash" size={16} color="#166534" />
              <Text style={styles.sectionHeaderText}>Booked &amp; Active</Text>
            </View>

            {driverActiveRows.length > 0 ? (
              <View style={styles.list}>
                {renderCombinedRows(driverActiveRows, "driver")}
              </View>
            ) : (
              <Text style={styles.sectionEmptyText}>
                No booked or active trips yet.
              </Text>
            )}

            <View style={styles.sectionSeparator} />

            <View style={styles.sectionHeaderRow}>
              <Ionicons name="create-outline" size={16} color="#B86115" />
              <Text style={styles.sectionHeaderText}>
                Created — Waiting for Booking
              </Text>
            </View>

            {driverCreatedRows.length > 0 ? (
              <View style={styles.list}>
                {renderCombinedRows(driverCreatedRows, "driver")}
              </View>
            ) : (
              <Text style={styles.sectionEmptyText}>
                Nothing you&apos;ve created is waiting for a booking right now.
              </Text>
            )}
          </>
        )}
      </ScrollView>

      <Modal
        visible={!!rebook}
        transparent
        animationType="slide"
        onRequestClose={() => setRebook(null)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setRebook(null)} />

          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Book Again</Text>
            <Text style={styles.modalSub}>
              Same trip, new date & time. You&apos;ll pick a driver again.
            </Text>

            {rebook ? (
              <View style={styles.modalSummary}>
                {(() => {
                  const meta = getCategoryMeta(rebook.category);

                  return (
                    <View
                      style={[
                        styles.catChip,
                        {
                          backgroundColor: `${meta.color}18`,
                          alignSelf: "flex-start",
                        },
                      ]}
                    >
                      <Ionicons name={meta.icon} size={15} color={meta.color} />
                      <Text style={[styles.catText, { color: meta.color }]}>
                        {meta.label}
                      </Text>
                    </View>
                  );
                })()}

                <View style={styles.infoRow}>
                  <Ionicons name="location-outline" size={15} color="#7C5F46" />
                  <Text style={styles.infoText}>
                    {rebook.from || "?"} → {rebook.to || "?"}
                  </Text>
                </View>

                {typeof rebook.seats === "number" ? (
                  <View style={styles.infoRow}>
                    <Ionicons name="people-outline" size={15} color="#7C5F46" />
                    <Text style={styles.infoText}>{rebook.seats} seats</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            <DateInput
              label="New Date"
              value={rebookDate}
              onChange={setRebookDate}
              showPicker={showDatePicker}
              setShowPicker={setShowDatePicker}
            />

            <TimeInput
              label="New Time"
              value={rebookTime}
              onChange={setRebookTime}
              showPicker={showTimePicker}
              setShowPicker={setShowTimePicker}
            />

            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancel}
                onPress={() => setRebook(null)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>

              <Pressable style={styles.modalSearch} onPress={submitRebook}>
                <Ionicons name="search-outline" size={18} color="#FFFFFF" />
                <Text style={styles.modalSearchText}>Search Drivers</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={
          !!ratingBooking ||
          !!schoolRatingBooking ||
          !!appRatingBooking ||
          !!roadsideRatingBooking
        }
        transparent
        animationType="fade"
        onRequestClose={() => {
          setRatingBooking(null);
          setSchoolRatingBooking(null);
          setAppRatingBooking(null);
          setRoadsideRatingBooking(null);
        }}
      >
        <View style={styles.ratingBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              setRatingBooking(null);
              setSchoolRatingBooking(null);
              setAppRatingBooking(null);
              setRoadsideRatingBooking(null);
            }}
          />

          <View style={styles.ratingCard}>
            <View style={styles.ratingIconCircle}>
              <Ionicons name="checkmark-circle" size={34} color="#F58220" />
            </View>

            {roadsideRatingBooking ? (
              <>
                <Text style={styles.ratingTitle}>Rate your helper</Text>
                <Text style={styles.ratingSubtitle}>
                  How was your Roadside Help experience with{" "}
                  {roadsideRatingBooking.driverName}?
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.ratingTitle}>You have arrived safely!</Text>
                <Text style={styles.ratingSubtitle}>Rate Your Driver</Text>
              </>
            )}

            <View style={styles.ratingStarsRow}>
              {Array.from({ length: 5 }).map((_, i) => {
                const value = i + 1;
                const active = value <= ratingStars;

                return (
                  <Pressable
                    key={value}
                    onPress={() => setRatingStars(value)}
                    hitSlop={6}
                  >
                    <Ionicons
                      name={active ? "star" : "star-outline"}
                      size={38}
                      color={active ? "#F58220" : "#D8C9BC"}
                    />
                  </Pressable>
                );
              })}
            </View>

            <TextInput
              style={styles.ratingInput}
              value={ratingComment}
              onChangeText={setRatingComment}
              placeholder="Leave a comment (optional)"
              placeholderTextColor="#9B7A68"
              multiline
              textAlignVertical="top"
            />

            <Pressable
              style={[
                styles.ratingSubmit,
                (ratingStars < 1 || ratingBusy) && styles.ratingSubmitDisabled,
              ]}
              onPress={submitRating}
              disabled={ratingStars < 1 || ratingBusy}
            >
              {ratingBusy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.ratingSubmitText}>Submit Rating</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  highlightWrap: {
    borderWidth: 2,
    borderColor: "#F58220",
    borderRadius: 26,
    backgroundColor: "rgba(245,130,32,0.08)",
    padding: 2,
    marginBottom: -2,
  },
  weeklyGroupBox: {
    borderWidth: 1,
    borderColor: "#F58220",
    borderRadius: 20,
    padding: 10,
    marginBottom: 18,
    backgroundColor: "#FFF8F2",
    gap: 12,
  },
  weeklyGroupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 6,
  },
  weeklyGroupHeaderText: {
    fontSize: 14,
    fontWeight: "900",
    color: "#B86115",
    flexShrink: 1,
  },
  page: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  scroll: {
    padding: 20,
    paddingTop: 50,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: "900",
    color: "#111827",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  clearAllText: {
    color: "#F58220",
    fontWeight: "900",
    fontSize: 14,
  },
  toggle: {
    flexDirection: "row",
    backgroundColor: "#F1E7DD",
    borderRadius: 16,
    padding: 5,
    gap: 5,
    marginBottom: 14,
  },
  toggleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
  },
  toggleBtnActive: {
    backgroundColor: "#F58220",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 2,
  },
  toggleText: {
    fontWeight: "900",
    color: "#7C5F46",
    fontSize: 15,
  },
  toggleTextActive: {
    color: "#FFFFFF",
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 20,
  },
  searchInput: {
    flex: 1,
    color: "#111827",
    fontWeight: "600",
    padding: 0,
  },
  loadingBox: {
    paddingVertical: 50,
    alignItems: "center",
  },
  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#E7DCD1",
    padding: 30,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: "#111827",
    marginTop: 12,
    marginBottom: 6,
  },
  emptyText: {
    color: "#7C5F46",
    textAlign: "center",
    lineHeight: 20,
  },
  list: {
    gap: 14,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 12,
  },
  sectionHeaderText: {
    fontSize: 15,
    fontWeight: "900",
    color: "#111827",
  },
  sectionSeparator: {
    height: 1,
    backgroundColor: "#E7DCD1",
    marginVertical: 22,
  },
  sectionEmptyText: {
    color: "#7C5F46",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 20,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 2,
  },
  cardDone: {
    backgroundColor: "#F8F6F2",
    borderColor: "#E7E1D8",
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  cardTopActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  deleteButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF1F1",
    borderWidth: 1,
    borderColor: "#F7C7C7",
  },
  catChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 13,
  },
  catText: {
    fontWeight: "900",
    fontSize: 13,
  },
  tripTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  problemChip: {
    backgroundColor: "#FFF2E8",
    borderWidth: 1,
    borderColor: "#F7D3B4",
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 13,
  },
  problemChipText: {
    color: "#B86115",
    fontWeight: "900",
    fontSize: 12,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  statusOngoing: {
    backgroundColor: "#FFF2E8",
  },
  statusDone: {
    backgroundColor: "#E7F7EC",
  },
  statusText: {
    fontWeight: "900",
    fontSize: 12,
  },
  statusTextOngoing: {
    color: "#B86115",
  },
  statusTextDone: {
    color: "#166534",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  infoText: {
    color: "#3C2319",
    fontSize: 14,
    fontWeight: "700",
    flexShrink: 1,
  },
  description: {
    color: "#3C2319",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  metaRow: {
    flexDirection: "row",
    gap: 20,
    marginTop: 2,
    marginBottom: 14,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaText: {
    fontSize: 15,
    fontWeight: "900",
    color: "#111827",
  },
  completeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1.5,
    borderColor: "#BBE7C6",
    backgroundColor: "#F1FBF4",
    borderRadius: 14,
    paddingVertical: 13,
  },
  completeButtonText: {
    color: "#166534",
    fontWeight: "900",
    fontSize: 15,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#F58220",
    borderRadius: 14,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
  },
  primaryButtonFull: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#16A34A",
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 4,
  },
  finishButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1.5,
    borderColor: "#BBE7C6",
    backgroundColor: "#F1FBF4",
    borderRadius: 14,
    paddingVertical: 13,
    marginTop: 10,
  },
  finishButtonText: {
    color: "#166534",
    fontWeight: "900",
    fontSize: 15,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  statusDead: {
    backgroundColor: "#F1E7E7",
  },
  statusTextDead: {
    color: "#B91C1C",
  },
  driverDetailsBox: {
    backgroundColor: "#FFFDFC",
    borderWidth: 1,
    borderColor: "#EFE3D6",
    borderRadius: 14,
    padding: 12,
    marginTop: 2,
    marginBottom: 14,
  },
  driverDetailsTitle: {
    color: "#111827",
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 8,
  },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  phoneText: {
    color: "#F58220",
    fontSize: 14,
    fontWeight: "900",
    textDecorationLine: "underline",
  },
  payRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 14,
  },
  payText: {
    color: "#7C5F46",
    fontSize: 13,
    fontWeight: "700",
    flexShrink: 1,
  },
  startButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#F58220",
    borderRadius: 14,
    paddingVertical: 14,
  },
  startDisabled: {
    backgroundColor: "#D8C9BC",
  },
  startButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
  },
  appHint: {
    color: "#7C5F46",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 8,
  },
  appActionsRow: {
    flexDirection: "row",
    gap: 12,
  },
  rejectButton: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: "#E4DDD7",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFDFC",
  },
  rejectButtonText: {
    color: "#7C5F46",
    fontWeight: "900",
    fontSize: 15,
  },
  waitBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFF2E8",
    borderRadius: 12,
    padding: 14,
  },
  waitText: {
    color: "#B86115",
    fontWeight: "800",
    fontSize: 14,
  },
  cancelLink: {
    alignItems: "center",
    marginTop: 12,
  },
  cancelLinkText: {
    color: "#B91C1C",
    fontWeight: "800",
    fontSize: 14,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.25)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#FBF7F1",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 34,
  },
  modalHandle: {
    width: 46,
    height: 5,
    borderRadius: 20,
    backgroundColor: "#D8C9BC",
    alignSelf: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: "#111827",
  },
  modalSub: {
    color: "#7C5F46",
    fontSize: 14,
    marginTop: 4,
    marginBottom: 16,
  },
  modalSummary: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 16,
    padding: 14,
    gap: 4,
    marginBottom: 8,
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  modalCancel: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: "#E4DDD7",
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  modalCancelText: {
    color: "#7C5F46",
    fontWeight: "900",
    fontSize: 15,
  },
  modalSearch: {
    flex: 1.5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#F58220",
    borderRadius: 14,
    paddingVertical: 15,
  },
  modalSearchText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
  },
  ratingSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    flexWrap: "wrap",
    marginBottom: 6,
  },
  ratingComment: {
    color: "#7C5F46",
    fontSize: 13,
    fontWeight: "700",
    fontStyle: "italic",
    marginLeft: 6,
    flexShrink: 1,
  },
  ratingBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  ratingCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#EFE3D6",
    paddingHorizontal: 24,
    paddingVertical: 26,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 24,
    elevation: 6,
  },
  ratingIconCircle: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "#FFF2E8",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  ratingTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: "#111827",
    textAlign: "center",
    marginBottom: 6,
  },
  ratingSubtitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#7C5F46",
    textAlign: "center",
    marginBottom: 18,
  },
  ratingStarsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 20,
  },
  ratingInput: {
    width: "100%",
    minHeight: 84,
    backgroundColor: "#FBF7F1",
    borderWidth: 1,
    borderColor: "#E4DDD7",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#111827",
    marginBottom: 18,
  },
  ratingSubmit: {
    width: "100%",
    backgroundColor: "#F58220",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  ratingSubmitDisabled: {
    opacity: 0.5,
  },
  ratingSubmitText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 16,
  },
  liveTrackButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#111827",
    borderRadius: 14,
    paddingVertical: 14,
    marginBottom: 10,
  },
  liveTrackButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
  },
});
