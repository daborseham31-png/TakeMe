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
} from "firebase/firestore";
import React, { useEffect, useMemo, useState } from "react";
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
  DriverTripItem,
  getCategoryMeta,
  markCompleted,
  normalizeBooking,
  normalizeDriverTrip,
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
  finishJob,
  isAwaitingPayment,
  normalizeApplication,
  NormalizedApplication,
  rejectRequest,
  startJob,
  startState,
  STATUS_LABEL,
} from "../booking/work-errand/workErrandLib";
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

type DriverRow =
  | {
      kind: "trip";
      key: string;
      createdAtSeconds: number;
      searchText: string;
      trip: DriverTripItem;
    }
  | {
      kind: "booking";
      key: string;
      createdAtSeconds: number;
      searchText: string;
      booking: BookingItem;
    };

export default function BookingsScreen() {
  const params = useLocalSearchParams<{
    tab?: string | string[];
    bookingId?: string | string[];
    applicationId?: string | string[];
    type?: string | string[];
    kind?: string | string[];
  }>();

  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [tab, setTab] = useState<Tab>("passenger");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [driverRoadside, setDriverRoadside] = useState<BookingItem[]>([]);

  const [passengerRides, setPassengerRides] = useState<RideBooking[]>([]);
  const [driverRides, setDriverRides] = useState<RideBooking[]>([]);

  const [ratingBooking, setRatingBooking] = useState<RideBooking | null>(null);
  const [schoolRatingBooking, setSchoolRatingBooking] =
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
  }, [params.tab]);

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
        (snap) => {
          const deleteField =
            viewer === "passenger" ? "deletedForPassenger" : "deletedForDriver";

          setter(
            snap.docs
              .filter((d) => d.data()[deleteField] !== true)
              .map((d) => normalizeApplication(d.id, d.data(), kind)),
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

const driverTrips = useMemo(
  () =>
    [...routes, ...workJobs, ...errandJobs]
      .filter((t) => {
        // إذا رحلة مدرسة انحجزت، لا تعرض كرت driverRoutes الأصلي
        if (t.collectionName === "driverRoutes" && bookedRouteIds.has(t.id)) {
          return false;
        }

        return true;
      })
      .sort((a, b) => b.createdAtSeconds - a.createdAtSeconds),
  [routes, workJobs, errandJobs, bookedRouteIds],
);

  const driverRows = useMemo<DriverRow[]>(() => {
    const rows: DriverRow[] = [
      ...driverTrips.map((t) => ({
        kind: "trip" as const,
        key: `${t.collectionName}-${t.id}`,
        createdAtSeconds: t.createdAtSeconds,
        searchText: t.searchText,
        trip: t,
      })),
      ...driverRoadside.map((b) => ({
        kind: "booking" as const,
        key: `booking-${b.id}`,
        createdAtSeconds: b.createdAtSeconds,
        searchText: b.searchText,
        booking: b,
      })),
    ];

    return rows.sort((a, b) => b.createdAtSeconds - a.createdAtSeconds);
  }, [driverTrips, driverRoadside]);

  const sortedBookings = useMemo(
    () => [...bookings].sort((a, b) => b.createdAtSeconds - a.createdAtSeconds),
    [bookings],
  );

  const q = search.trim().toLowerCase();

  const filteredBookings = useMemo(
    () =>
      q
        ? sortedBookings.filter((b) => b.searchText.includes(q))
        : sortedBookings,
    [sortedBookings, q],
  );

  const filteredDriverRows = useMemo(
    () => (q ? driverRows.filter((r) => r.searchText.includes(q)) : driverRows),
    [driverRows, q],
  );

  const sortedPassengerRides = useMemo(
    () =>
      [...passengerRides].sort(
        (a, b) => b.createdAtSeconds - a.createdAtSeconds,
      ),
    [passengerRides],
  );

  const sortedDriverRides = useMemo(
    () =>
      [...driverRides].sort((a, b) => b.createdAtSeconds - a.createdAtSeconds),
    [driverRides],
  );

  const filteredPassengerRides = useMemo(
    () =>
      q
        ? sortedPassengerRides.filter((r) => r.searchText.includes(q))
        : sortedPassengerRides,
    [sortedPassengerRides, q],
  );

  const filteredDriverRides = useMemo(
    () =>
      q
        ? sortedDriverRides.filter((r) => r.searchText.includes(q))
        : sortedDriverRides,
    [sortedDriverRides, q],
  );

  const filteredPassengerApps = useMemo(
    () =>
      q ? passengerApps.filter((a) => a.searchText.includes(q)) : passengerApps,
    [passengerApps, q],
  );

  const filteredDriverApps = useMemo(
    () => (q ? driverApps.filter((a) => a.searchText.includes(q)) : driverApps),
    [driverApps, q],
  );

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

  const canShowLiveTracking = (item: any) => {
    return item?.trackingEnabled === true && item?.tripStatus === "arrived_pickup";
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

  const confirmHideRideBooking = (ride: RideBooking, viewer: Tab) => {
    Alert.alert("Remove booking", "Remove this booking from your list?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () =>
          runApp(ride.id, () =>
            viewer === "passenger"
              ? hideRideBookingForPassenger(ride.id)
              : hideRideBookingForDriver(ride.id, ride.routeId),
          ),
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
    bookingId: string,
    viewer: Tab,
    label = "booking",
  ) => {
    Alert.alert("Remove booking", `Remove this ${label} from your list?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () =>
          runApp(bookingId, () => hideGeneralBooking(bookingId, viewer)),
      },
    ]);
  };

  const hideApplicationFromList = async (
    app: NormalizedApplication,
    viewer: Tab,
  ) => {
    const collectionName =
      app.kind === "work" ? "workApplications" : "errandApplications";

    await updateDoc(doc(db, collectionName, app.id), {
      [viewer === "passenger" ? "deletedForPassenger" : "deletedForDriver"]:
        true,
      updatedAt: serverTimestamp(),
    });
  };

  const confirmHideApplication = (app: NormalizedApplication, viewer: Tab) => {
    Alert.alert("Remove booking", "Remove this booking from your list?", [
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
          onPress: () => runApp(a.id, () => finishJob(a.kind, a.id, a)),
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

  const handleRideStart = (r: RideBooking) =>
    runApp(r.id, async () => {
      await startRide(r.id, r);
      router.push({
        pathname: "/driver/ride-navigation",
        params: { id: r.id },
      } as any);
    });

  const handleRideOpenMap = (r: RideBooking) =>
    router.push({
      pathname: "/driver/ride-navigation",
      params: { id: r.id },
    } as any);

  const handleRideArrived = (r: RideBooking) =>
    runApp(r.id, () => arriveRide(r.id, r));

  const handleRideFinish = (r: RideBooking) =>
    runApp(r.id, () => finishRide(r.id, r));
    const bookingNeedsRating = (b: BookingItem | RideBooking) => {
    const item: any = b;

    if (ratedSchoolBookingIds.includes(b.id)) {
      return false;
    }

    return (
      (item.status === "completed" || item.tripStatus === "completed") &&
      item.needsPassengerRating === true &&
      item.ratingSubmitted !== true &&
      typeof item.rating !== "number" &&
      !!item.driverId
    );
  };

const openSchoolRatingModal = (b: BookingItem) => {
  setSchoolRatingBooking(b);
  setRatingBooking(null);
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

  if (!item.driverId) {
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
  if (ratingBooking || schoolRatingBooking || ratingBusy) return;

  const pendingRideRating = passengerRides.find((r) => bookingNeedsRating(r));

  if (pendingRideRating) {
    openRatingModal(pendingRideRating);
    return;
  }

  const pendingSchoolRating = bookings.find((b) => bookingNeedsRating(b));

  if (pendingSchoolRating) {
    openSchoolRatingModal(pendingSchoolRating);
  }
}, [
  bookings,
  passengerRides,
  tab,
  ratingBooking,
  schoolRatingBooking,
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
              {r.paymentMethod === "cash" ? "Cash" : "Card"}
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
              {canShowLiveTracking(r) ? (
                <Pressable
                  style={styles.liveTrackButton}
                  onPress={() => openLiveTracking(r.id)}
                >
                  <Ionicons name="map-outline" size={17} color="#FFFFFF" />
                  <Text style={styles.liveTrackButtonText}>Live Tracking</Text>
                </Pressable>
              ) : null}

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
              <Pressable
                style={styles.startButton}
                onPress={() => handleRideStart(r)}
                disabled={busy}
              >
                <Ionicons name="play" size={16} color="#FFFFFF" />
                <Text style={styles.startButtonText}>Start Ride</Text>
              </Pressable>
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

  const renderStatus = (status: string) => (
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
        {status === "completed" ? "Completed" : "Ongoing"}
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
    const isDriverView = viewer === "driver";

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
              confirmHideGeneralBooking(b.id, viewer),
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

            {!done && !isSchool ? (
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
            {isSchool && tripStatus === "booked" ? (
              <Pressable
                style={styles.startButton}
                onPress={() => openSchoolRideNavigation(b.id)}
              >
                <Ionicons name="play" size={16} color="#FFFFFF" />
                <Text style={styles.startButtonText}>Start Ride</Text>
              </Pressable>
            ) : null}

            {isSchool &&
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

            {!isSchool && !done ? (
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

          {renderStatus(t.status)}
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

          {typeof t.seats === "number" ? (
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

  const renderRoadsideCard = (b: BookingItem, viewer: Tab) => {
    const meta = getCategoryMeta("roadside");
    const otherName = viewer === "passenger" ? b.driverName : b.passengerName;

    return (
      <View key={`roadside-${b.id}`} style={[styles.card, styles.cardDone]}>
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
            {renderStatus(b.status)}
            {renderDeleteButton(() =>
              confirmHideGeneralBooking(b.id, viewer, "roadside help"),
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
      </View>
    );
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

        <View style={styles.payRow}>
          <Ionicons name="card-outline" size={14} color="#7C5F46" />
          <Text style={styles.payText}>
            {a.paymentMethod
              ? `${a.paymentMethod === "cash" ? "Cash" : "Card"} · ${
                  a.paymentStatus
                }`
              : "Payment: unpaid"}
            {a.cardLast4 ? ` (•••• ${a.cardLast4})` : ""}
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

            {a.kind === "work" && a.status === "payment_pending_driver" ? (
              <View style={styles.waitBanner}>
                <Ionicons name="time-outline" size={16} color="#B86115" />
                <Text style={styles.waitText}>
                  Waiting for employer payment
                </Text>
              </View>
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

            {a.kind === "work" && a.status === "payment_pending_driver" ? (
              <Pressable
                style={styles.primaryButton}
                onPress={() => goToPayment(a)}
              >
                <Ionicons name="card" size={16} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>
                  Complete payment to confirm worker
                </Text>
              </Pressable>
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
      ? filteredBookings.length === 0 &&
        filteredPassengerApps.length === 0 &&
        filteredPassengerRides.length === 0
      : filteredDriverRows.length === 0 &&
        filteredDriverApps.length === 0 &&
        filteredDriverRides.length === 0;

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>My Bookings</Text>

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
        ) : (
          <View style={styles.list}>
            {tab === "passenger" ? (
              <>
                {filteredPassengerRides.map((r) =>
                  renderRideCard(r, "passenger"),
                )}
                {filteredPassengerApps.map((a) =>
                  renderApplicationCard(a, "passenger"),
                )}
                {filteredBookings.map((b) =>
                  b.category === "roadside"
                    ? renderRoadsideCard(b, "passenger")
                    : renderBookingCard(b, "passenger"),
                )}
              </>
            ) : (
              <>
                {filteredDriverRides.map((r) => renderRideCard(r, "driver"))}
                {filteredDriverApps.map((a) =>
                  renderApplicationCard(a, "driver"),
                )}
                {filteredDriverRows.map((r) =>
                  r.kind === "trip"
                    ? renderTripCard(r.trip)
                    : r.booking.category === "roadside"
                      ? renderRoadsideCard(r.booking, "driver")
                      : renderBookingCard(r.booking, "driver"),
                )}
              </>
            )}
          </View>
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
        visible={!!ratingBooking || !!schoolRatingBooking}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setRatingBooking(null);
          setSchoolRatingBooking(null);
        }}
      >
        <View style={styles.ratingBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              setRatingBooking(null);
              setSchoolRatingBooking(null);
            }}
          />

          <View style={styles.ratingCard}>
            <View style={styles.ratingIconCircle}>
              <Ionicons name="checkmark-circle" size={34} color="#F58220" />
            </View>

            <Text style={styles.ratingTitle}>You have arrived safely!</Text>
            <Text style={styles.ratingSubtitle}>Rate Your Driver</Text>

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
    marginBottom: 18,
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
