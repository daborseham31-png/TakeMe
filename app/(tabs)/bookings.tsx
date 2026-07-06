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

    return () => {
      unsubBookings();
      unsubDriverRoadside();
      unsubRoutes();
      unsubWork();
      unsubErrands();
    };
  }, [uid]);

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

  const isEmpty =
    tab === "passenger"
      ? filteredBookings.length === 0
      : filteredDriverRows.length === 0;

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
            {tab === "passenger"
              ? filteredBookings.map((b) =>
                  b.category === "roadside"
                    ? renderRoadsideCard(b, "passenger")
                    : renderBookingCard(b),
                )
              : filteredDriverRows.map((r) =>
                  r.kind === "trip"
                    ? renderTripCard(r.trip)
                    : renderRoadsideCard(r.booking, "driver"),
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
