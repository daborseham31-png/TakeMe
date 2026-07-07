import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  query,
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

type Notification = {
  id: string;
  type?: string;
  title?: string;
  message?: string;
  applicationId?: string | null;
  kind?: "work" | "errand" | null;
  read?: boolean;
  deleted?: boolean;
  createdAt?: { seconds?: number } | null;
};

const ICON_FOR: Record<string, keyof typeof Ionicons.glyphMap> = {
  request_received: "mail-outline",
  request_accepted: "checkmark-circle-outline",
  request_rejected: "close-circle-outline",
  payment_confirmed: "card-outline",
  on_the_way: "car-outline",
  arrived: "location-outline",
  completed: "trophy-outline",
  cancelled: "ban-outline",
};

export default function NotificationsScreen() {
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setUid(user?.uid ?? null);
      if (!user) setLoading(false);
    });
  }, []);

  // Single equality filter → no composite index needed. Deleted + sort handled
  // client-side.
  useEffect(() => {
    if (!uid) return;
    setLoading(true);

    const unsub = onSnapshot(
      query(collection(db, "notifications"), where("userId", "==", uid)),
      (snap) => {
        setItems(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Notification, "id">) })),
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

  // Errand acceptance is the only notification that sends the recipient to pay
  // (work is paid by the employer, not the applicant).
  const needsPayment = (n: Notification) =>
    n.type === "request_accepted" && n.kind === "errand";

  const onPressNotification = (n: Notification) => {
    if (!n.read) {
      updateDoc(doc(db, "notifications", n.id), { read: true }).catch(() => {});
    }

    if (needsPayment(n) && n.applicationId && n.kind) {
      router.push({
        pathname: "/booking/payment",
        params: { kind: n.kind, id: n.applicationId },
      } as any);
      return;
    }

    router.push("/(tabs)/bookings" as any);
  };

  // Deleting only hides the notification for this user – the underlying
  // application / booking is untouched.
  const deleteOne = (n: Notification) => {
    updateDoc(doc(db, "notifications", n.id), { deleted: true }).catch(() => {});
  };

  const clearAll = () => {
    if (visible.length === 0) return;
    Alert.alert("Clear all", "Hide all notifications?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear all",
        style: "destructive",
        onPress: async () => {
          try {
            const batch = writeBatch(db);
            visible.forEach((n) =>
              batch.update(doc(db, "notifications", n.id), { deleted: true }),
            );
            await batch.commit();
          } catch (error: any) {
            Alert.alert("Error", error?.message || "Could not clear.");
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
            <Pressable onPress={clearAll} hitSlop={8}>
              <Text style={styles.clearAll}>Clear all</Text>
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
              <Ionicons name="notifications-off-outline" size={38} color="#8B7B6B" />
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
                        <Ionicons name="card-outline" size={13} color="#FFFFFF" />
                        <Text style={styles.payPillText}>Continue to Payment</Text>
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
