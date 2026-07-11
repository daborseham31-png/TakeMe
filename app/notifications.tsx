import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { auth, db } from "../firebase";

type BookingTab = "passenger" | "driver";

type Notification = {
  id: string;
  type?: string;
  title?: string;
  message?: string;

  applicationId?: string | null;
  bookingId?: string | null;

  kind?: "work" | "errand" | null;
  category?: string | null;

  // Canonical field for routing. openBookingTab/roleTarget are kept for
  // backwards compatibility with older notification documents.
  targetTab?: BookingTab | null;
  roleTarget?: BookingTab | null;
  openBookingTab?: BookingTab | null;

  // Roadside Help only — see notify()'s requestId/offerId/targetPage/amount.
  requestId?: string | null;
  offerId?: string | null;
  targetPage?: string | null;
  amount?: number | null;
  driverId?: string | null;
  passengerId?: string | null;

  read?: boolean;
  deleted?: boolean;
  createdAt?: { seconds?: number } | null;
};

const ICON_FOR: Record<string, keyof typeof Ionicons.glyphMap> = {
  request_received: "mail-outline",
  new_booking_request: "mail-outline",
  request_accepted: "checkmark-circle-outline",
  request_rejected: "close-circle-outline",
  payment_confirmed: "card-outline",
  on_the_way: "car-outline",
  arrived: "location-outline",
  completed: "trophy-outline",
  cancelled: "ban-outline",

  personal_ride_booking: "car-sport-outline",
  school_ride_booking: "school-outline",
  ride_on_the_way: "car-outline",
  ride_arrived: "location-outline",
  ride_completed: "trophy-outline",
  ride_trip_completed: "star-outline",

  roadside_offer_received: "construct-outline",
  roadside_offer_accepted: "checkmark-done-outline",
  roadside_driver_on_way: "navigate-outline",
  roadside_payment_required: "card-outline",
  roadside_payment_received: "cash-outline",
};

export default function NotificationsScreen() {
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearingAll, setClearingAll] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setUid(user?.uid ?? null);
      if (!user) setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!uid) return;

    setLoading(true);

    const unsub = onSnapshot(
      query(collection(db, "notifications"), where("userId", "==", uid)),
      (snap) => {
        setItems(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Notification, "id">),
          })),
        );
        setLoading(false);
      },
      () => setLoading(false),
    );

    return unsub;
  }, [uid]);

  const visible = useMemo(
    () =>
      items
        .filter((n) => n.deleted !== true)
        .sort(
          (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0),
        ),
    [items],
  );

  const needsPayment = (n: Notification) =>
    n.type === "request_accepted" && n.kind === "errand";

  const getBookingTabFromNotification = (n: Notification): BookingTab => {
    if (n.targetTab === "driver" || n.targetTab === "passenger") {
      return n.targetTab;
    }

    if (n.roleTarget === "driver" || n.roleTarget === "passenger") {
      return n.roleTarget;
    }

    if (n.openBookingTab === "driver" || n.openBookingTab === "passenger") {
      return n.openBookingTab;
    }

    // إشعارات عادة بتوصل للسائق
    const driverTypes = [
      "request_received",
      "new_booking_request",
      "payment_confirmed",
      "personal_ride_booking",
      "school_ride_booking",
      "ride_completed",
      "roadside_offer_accepted",
      "roadside_payment_received",
    ];

    if (driverTypes.includes(n.type || "")) {
      return "driver";
    }

    // إشعارات عادة بتوصل للمسافر
    const passengerTypes = [
      "request_accepted",
      "request_rejected",
      "on_the_way",
      "arrived",
      "completed",
      "cancelled",
      "ride_on_the_way",
      "ride_arrived",
      "ride_trip_completed",
      "roadside_driver_on_way",
    ];

    if (passengerTypes.includes(n.type || "")) {
      return "passenger";
    }

    return "passenger";
  };

  const onPressNotification = (n: Notification) => {
    if (!n.read) {
      updateDoc(doc(db, "notifications", n.id), {
        read: true,
        readAt: serverTimestamp(),
      }).catch(() => {});
    }

    if (needsPayment(n) && n.applicationId && n.kind) {
      router.push({
        pathname: "/booking/payment",
        params: {
          kind: n.kind,
          id: n.applicationId,
        },
      } as any);
      return;
    }

    // A driver just offered help — open Finding Help with this exact offer
    // highlighted. Never Home, never another category.
    if (n.type === "roadside_offer_received") {
      router.push({
        pathname: "/booking/roadside-help/waiting",
        params: {
          requestId: n.requestId || "",
          highlightOfferId: n.offerId || "",
        },
      } as any);
      return;
    }

    // The driver finished the help — open the Roadside Help payment page
    // directly (never My Bookings first).
    if (n.type === "roadside_payment_required") {
      router.push({
        pathname: "/booking/roadside-help/payment",
        params: {
          requestId: n.requestId || "",
          offerId: n.offerId || "",
          bookingId: n.bookingId || "",
          amount: n.amount != null ? String(n.amount) : "",
          category: "roadside",
        },
      } as any);
      return;
    }

    const tab = getBookingTabFromNotification(n);

    router.push({
      pathname: "/(tabs)/bookings",
      params: {
        tab,
        bookingId: n.bookingId || "",
        applicationId: n.applicationId || "",
        requestId: n.requestId || "",
        offerId: n.offerId || "",
        category: n.category || "",
        type: n.type || "",
        kind: n.kind || "",
      },
    } as any);
  };

  // Notification documents belong only to the receiving user (userId), so
  // it's safe to permanently delete them — but a soft `deleted` flag is used
  // instead, matching every other list in the app, and so a stray
  // `notifications` query anywhere else never has to special-case this one.
  const deleteOne = (n: Notification) => {
    setItems((prev) => prev.filter((item) => item.id !== n.id));

    updateDoc(doc(db, "notifications", n.id), { deleted: true }).catch(
      () => {},
    );
  };

  const clearAll = () => {
    if (visible.length === 0 || clearingAll) return;

    Alert.alert("Clear all", "Hide all notifications?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear all",
        style: "destructive",
        onPress: async () => {
          const ids = visible.map((n) => n.id);

          setClearingAll(true);
          setItems((prev) => prev.filter((item) => !ids.includes(item.id)));

          try {
            // Firestore batched writes cap at 500 operations — chunk
            // defensively so a very large notification list never fails.
            for (let i = 0; i < ids.length; i += 450) {
              const batch = writeBatch(db);

              ids
                .slice(i, i + 450)
                .forEach((id) =>
                  batch.update(doc(db, "notifications", id), {
                    deleted: true,
                  }),
                );

              await batch.commit();
            }
          } catch (error: any) {
            Alert.alert("Error", error?.message || "Could not clear.");
          } finally {
            setClearingAll(false);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#7C5F46" />
          <Text style={styles.backText}>Back</Text>
        </Pressable>

        <View style={styles.headerRow}>
          <View style={styles.header}>
            <Ionicons name="notifications" size={26} color="#F58220" />
            <Text style={styles.title}>Notifications</Text>
          </View>

          {visible.length > 0 ? (
            <Pressable onPress={clearAll} disabled={clearingAll} hitSlop={8}>
              <Text style={styles.clearAll}>
                {clearingAll ? "Clearing..." : "Clear all"}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.subtitle}>Requests & booking updates</Text>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#F58220" />
          </View>
        ) : visible.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Ionicons
                name="notifications-off-outline"
                size={38}
                color="#8B7B6B"
              />
            </View>

            <Text style={styles.emptyTitle}>No notifications yet</Text>
            <Text style={styles.emptyText}>
              Requests, payments and booking updates will appear here.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {visible.map((n) => (
              <View
                key={n.id}
                style={[styles.card, !n.read && styles.cardUnread]}
              >
                <Pressable
                  style={styles.cardMain}
                  onPress={() => onPressNotification(n)}
                >
                  <View style={styles.cardIcon}>
                    <Ionicons
                      name={ICON_FOR[n.type || ""] || "notifications-outline"}
                      size={20}
                      color="#F58220"
                    />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{n.title || "Update"}</Text>

                    {n.message ? (
                      <Text style={styles.cardMessage}>{n.message}</Text>
                    ) : null}

                    {needsPayment(n) ? (
                      <View style={styles.payPill}>
                        <Ionicons
                          name="card-outline"
                          size={13}
                          color="#FFFFFF"
                        />
                        <Text style={styles.payPillText}>
                          Continue to Payment
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {!n.read ? <View style={styles.dot} /> : null}
                </Pressable>

                <Pressable
                  style={styles.deleteButton}
                  onPress={() => deleteOne(n)}
                  hitSlop={6}
                >
                  <Ionicons name="trash-outline" size={18} color="#B91C1C" />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
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
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 16,
  },
  backText: {
    color: "#7C5F46",
    fontWeight: "800",
    fontSize: 15,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: "900",
    color: "#111827",
  },
  clearAll: {
    color: "#F58220",
    fontWeight: "900",
    fontSize: 14,
  },
  subtitle: {
    color: "#7C5F46",
    fontSize: 14,
    marginTop: 6,
    marginBottom: 22,
  },
  loadingBox: {
    paddingVertical: 40,
    alignItems: "center",
  },
  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#E7DCD1",
    padding: 34,
    alignItems: "center",
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#F3ECE3",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 6,
  },
  emptyText: {
    color: "#7C5F46",
    textAlign: "center",
    lineHeight: 20,
  },
  list: {
    gap: 12,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 18,
    paddingRight: 8,
  },
  cardUnread: {
    backgroundColor: "#FFF8F2",
    borderColor: "#FFE2C5",
  },
  cardMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 16,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: "#FFF2E8",
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: "#111827",
  },
  cardMessage: {
    color: "#7C5F46",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 3,
    lineHeight: 19,
  },
  payPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    backgroundColor: "#F58220",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 8,
  },
  payPillText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 12,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#F58220",
    marginTop: 4,
  },
  deleteButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
});
