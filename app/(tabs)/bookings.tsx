import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import DateInput, { TimeInput } from "../driver/create/DateInput";
import {
  BookingItem,
  DriverTripItem,
  getCategoryMeta,
  markCompleted,
  normalizeBooking,
  normalizeDriverTrip,
} from "../booking/bookingsLib";
import {
  acceptRequest,
  arriveJob,
  cancelApplication,
  cancelBlockedReason,
  finishJob,
  isAwaitingPayment,
  NormalizedApplication,
  normalizeApplication,
  rejectRequest,
  startJob,
  startState,
  STATUS_LABEL,
} from "../booking/work-errand/workErrandLib";

type Tab = "passenger" | "driver";

type DriverRow =
  | {
      kind: "trip";
      key: string;
      createdAtSeconds: number;
      searchText: string;
      trip: DriverTripItem;
    }
  | {
      kind: "roadside";
      key: string;
      createdAtSeconds: number;
      searchText: string;
      booking: BookingItem;
    };

export default function BookingsScreen() {
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [tab, setTab] = useState<Tab>("passenger");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [driverRoadside, setDriverRoadside] = useState<BookingItem[]>([]);
  const [routes, setRoutes] = useState<DriverTripItem[]>([]);
  const [workJobs, setWorkJobs] = useState<DriverTripItem[]>([]);
  const [errandJobs, setErrandJobs] = useState<DriverTripItem[]>([]);

  // Work / errand applications (the request → pay → complete flow).
  const [myWorkApps, setMyWorkApps] = useState<NormalizedApplication[]>([]);
  const [myErrandApps, setMyErrandApps] = useState<NormalizedApplication[]>([]);
  const [asProviderWork, setAsProviderWork] = useState<NormalizedApplication[]>([]);
  const [asProviderErrand, setAsProviderErrand] = useState<NormalizedApplication[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  // "Book Again" modal
  const [rebook, setRebook] = useState<BookingItem | null>(null);
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

  // Real-time listeners. Each uses a single equality filter (no composite
  // index needed); results are sorted client-side.
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
            snap.docs.map((d) =>
              normalizeDriverTrip(d.id, d.data(), collectionName),
            ),
          );
          setLoading(false);
        },
        () => setLoading(false),
      );

    const unsubBookings = onSnapshot(
      query(collection(db, "bookings"), where("passengerId", "==", uid)),
      (snap) => {
        setBookings(snap.docs.map((d) => normalizeBooking(d.id, d.data())));
        setLoading(false);
      },
      () => setLoading(false),
    );

    // Completed roadside help the current user provided as a driver. Filtered to
    // category "roadside" so normal passenger bookings never leak into the
    // driver tab.
    const unsubDriverRoadside = onSnapshot(
      query(collection(db, "bookings"), where("driverId", "==", uid)),
      (snap) => {
        setDriverRoadside(
          snap.docs
            .filter((d) => d.data().category === "roadside")
            .map((d) => normalizeBooking(d.id, d.data())),
        );
        setLoading(false);
      },
      () => setLoading(false),
    );

    const unsubRoutes = subscribe("driverRoutes", "driverId", setRoutes);
    const unsubWork = subscribe("workJobs", "employerId", setWorkJobs);
    const unsubErrands = subscribe("errandJobs", "ownerId", setErrandJobs);

    // Work / errand applications. Each uses a single equality filter → no
    // composite index needed; results are sorted client-side.
    const subscribeApps = (
      collectionName: "workApplications" | "errandApplications",
      field: string,
      kind: "work" | "errand",
      setter: (items: NormalizedApplication[]) => void,
    ) =>
      onSnapshot(
        query(collection(db, collectionName), where(field, "==", uid)),
        (snap) => {
          setter(
            snap.docs.map((d) => normalizeApplication(d.id, d.data(), kind)),
          );
          setLoading(false);
        },
        () => setLoading(false),
      );

    const unsubMyWork = subscribeApps(
      "workApplications",
      "applicantId",
      "work",
      setMyWorkApps,
    );
    const unsubMyErrand = subscribeApps(
      "errandApplications",
      "passengerId",
      "errand",
      setMyErrandApps,
    );
    const unsubProvWork = subscribeApps(
      "workApplications",
      "employerId",
      "work",
      setAsProviderWork,
    );
    const unsubProvErrand = subscribeApps(
      "errandApplications",
      "driverId",
      "errand",
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

  // Combined + sorted application lists for each tab.
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

  const driverTrips = useMemo(
    () =>
      [...routes, ...workJobs, ...errandJobs].sort(
        (a, b) => b.createdAtSeconds - a.createdAtSeconds,
      ),
    [routes, workJobs, errandJobs],
  );

  // The driver tab mixes created trips/jobs with completed roadside bookings.
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
        kind: "roadside" as const,
        key: `roadside-${b.id}`,
        createdAtSeconds: b.createdAtSeconds,
        searchText: b.searchText,
        booking: b,
      })),
    ];

    return rows.sort((a, b) => b.createdAtSeconds - a.createdAtSeconds);
  }, [driverTrips, driverRoadside]);

  const sortedBookings = useMemo(
    () =>
      [...bookings].sort((a, b) => b.createdAtSeconds - a.createdAtSeconds),
    [bookings],
  );

  const q = search.trim().toLowerCase();

  const filteredBookings = useMemo(
    () => (q ? sortedBookings.filter((b) => b.searchText.includes(q)) : sortedBookings),
    [sortedBookings, q],
  );

  const filteredDriverRows = useMemo(
    () => (q ? driverRows.filter((r) => r.searchText.includes(q)) : driverRows),
    [driverRows, q],
  );

  const filteredPassengerApps = useMemo(
    () => (q ? passengerApps.filter((a) => a.searchText.includes(q)) : passengerApps),
    [passengerApps, q],
  );

  const filteredDriverApps = useMemo(
    () => (q ? driverApps.filter((a) => a.searchText.includes(q)) : driverApps),
    [driverApps, q],
  );

  // Shared runner for the work/errand application actions.
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

  const handleAppCancel = (a: NormalizedApplication, by: "passenger" | "driver") => {
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
        onPress: () => runApp(a.id, () => cancelApplication(a.kind, a.id, a, by)),
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
    setRebook(booking);
    setRebookDate(booking.date || "");
    setRebookTime(booking.time || "");
  };

  const submitRebook = () => {
    if (!rebook) return;

    router.push({
      pathname: "/booking/driverresults",
      params: {
        from: rebook.from,
        to: rebook.to,
        category: rebook.category,
        seats: String(rebook.seats || 1),
        tripDate: rebookDate,
        time: rebookTime,
      },
    } as any);

    setRebook(null);
  };

  // ------------------------------------------------------------------ render

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
          status === "completed" ? styles.statusTextDone : styles.statusTextOngoing,
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

  const renderBookingCard = (b: BookingItem) => {
    const meta = getCategoryMeta(b.category);
    const done = b.status === "completed";

    return (
      <View key={b.id} style={[styles.card, done && styles.cardDone]}>
        <View style={styles.cardTop}>
          <View style={[styles.catChip, { backgroundColor: `${meta.color}18` }]}>
            <Ionicons name={meta.icon} size={15} color={meta.color} />
            <Text style={[styles.catText, { color: meta.color }]}>
              {meta.label}
            </Text>
          </View>
          {renderStatus(b.status)}
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
          <Text style={styles.infoText}>{b.driverName}</Text>
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

        {done ? (
          <Pressable style={styles.primaryButton} onPress={() => openRebook(b)}>
            <Ionicons name="refresh" size={17} color="#FFFFFF" />
            <Text style={styles.primaryButtonText}>Book Again</Text>
          </Pressable>
        ) : (
          <Pressable
            style={styles.completeButton}
            onPress={() => confirmComplete("bookings", b.id, "booking")}
          >
            <Ionicons name="checkmark-done" size={17} color="#166534" />
            <Text style={styles.completeButtonText}>Mark as Completed</Text>
          </Pressable>
        )}
      </View>
    );
  };

  const renderTripCard = (t: DriverTripItem) => {
    const meta = getCategoryMeta(t.category);
    const done = t.status === "completed";
    const daysText = t.days.length > 0 ? t.days.join(", ") : "";

    return (
      <View key={`${t.collectionName}-${t.id}`} style={[styles.card, done && styles.cardDone]}>
        <View style={styles.cardTop}>
          <View style={[styles.catChip, { backgroundColor: `${meta.color}18` }]}>
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

        {!done ? (
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

  // Completed roadside help. Passenger view shows the driver name; driver view
  // shows the passenger name. Phone numbers are intentionally not shown here.
  const renderRoadsideCard = (b: BookingItem, viewer: Tab) => {
    const meta = getCategoryMeta("roadside");
    const otherName = viewer === "passenger" ? b.driverName : b.passengerName;

    return (
      <View key={`roadside-${b.id}`} style={[styles.card, styles.cardDone]}>
        <View style={styles.cardTop}>
          <View style={[styles.catChip, { backgroundColor: `${meta.color}18` }]}>
            <Ionicons name={meta.icon} size={15} color={meta.color} />
            <Text style={[styles.catText, { color: meta.color }]}>
              Roadside Help
            </Text>
          </View>
          {renderStatus(b.status)}
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

  // Work / errand application card, rendered in both tabs.
  const renderApplicationCard = (
    a: NormalizedApplication,
    viewer: Tab,
  ) => {
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

    const otherName =
      viewer === "passenger" ? a.providerName : a.customerName;

    const future = startState(a.date) === "future";
    const cancelBlocked = cancelBlockedReason(a);

    return (
      <View
        key={`${a.kind}-app-${a.id}`}
        style={[styles.card, (done || dead) && styles.cardDone]}
      >
        <View style={styles.cardTop}>
          <View style={[styles.catChip, { backgroundColor: `${meta.color}18` }]}>
            <Ionicons name={meta.icon} size={15} color={meta.color} />
            <Text style={[styles.catText, { color: meta.color }]}>
              {meta.label}
            </Text>
          </View>
          <View style={[styles.statusPill, statusStyle]}>
            <Text style={[styles.statusText, statusTextStyle]}>
              {STATUS_LABEL[a.status]}
            </Text>
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

        {/* Payment info */}
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

        {/* Action buttons */}
        {viewer === "passenger" ? (
          <>
            {/* Errand: the passenger pays. */}
            {a.kind === "errand" && a.status === "payment_pending_passenger" ? (
              <Pressable
                style={styles.primaryButton}
                onPress={() => goToPayment(a)}
              >
                <Ionicons name="card" size={16} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>Continue to Payment</Text>
              </Pressable>
            ) : null}

            {/* Work: the employer pays – the applicant just waits. */}
            {a.kind === "work" && a.status === "payment_pending_driver" ? (
              <View style={styles.waitBanner}>
                <Ionicons name="time-outline" size={16} color="#B86115" />
                <Text style={styles.waitText}>Waiting for employer payment</Text>
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
            {/* Provider still needs to accept/reject the request. */}
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

            {/* Work: the employer/driver completes payment to confirm. */}
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

            {/* Errand: the driver waits for the customer to pay. */}
            {a.kind === "errand" && a.status === "payment_pending_passenger" ? (
              <View style={styles.waitBanner}>
                <Ionicons name="time-outline" size={16} color="#B86115" />
                <Text style={styles.waitText}>Waiting for customer payment</Text>
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
      ? filteredBookings.length === 0 && filteredPassengerApps.length === 0
      : filteredDriverRows.length === 0 && filteredDriverApps.length === 0;

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>My Bookings</Text>

        {/* Passenger / Driver toggle */}
        <View style={styles.toggle}>
          <Pressable
            style={[styles.toggleBtn, tab === "passenger" && styles.toggleBtnActive]}
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
            style={[styles.toggleBtn, tab === "driver" && styles.toggleBtnActive]}
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

        {/* Search / filter */}
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
                {filteredPassengerApps.map((a) =>
                  renderApplicationCard(a, "passenger"),
                )}
                {filteredBookings.map((b) =>
                  b.category === "roadside"
                    ? renderRoadsideCard(b, "passenger")
                    : renderBookingCard(b),
                )}
              </>
            ) : (
              <>
                {filteredDriverApps.map((a) =>
                  renderApplicationCard(a, "driver"),
                )}
                {filteredDriverRows.map((r) =>
                  r.kind === "trip"
                    ? renderTripCard(r.trip)
                    : renderRoadsideCard(r.booking, "driver"),
                )}
              </>
            )}
          </View>
        )}
      </ScrollView>

      {/* Book Again modal */}
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
                        { backgroundColor: `${meta.color}18`, alignSelf: "flex-start" },
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
    marginBottom: 12,
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
  // Work / errand application extras
  statusDead: {
    backgroundColor: "#F1E7E7",
  },
  statusTextDead: {
    color: "#B91C1C",
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
  // Modal
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
});
