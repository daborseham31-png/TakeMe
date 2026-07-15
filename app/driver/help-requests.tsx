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
  TextInput,
  View,
} from "react-native";

import { auth, db } from "../../firebase";
import RoadsideAcceptedCard from "../booking/roadside-help/RoadsideAcceptedCard";
import {
  markNotificationRead,
  normalizeRoadsideRequest,
  rejectNotification,
  RoadsideRequestRecord,
  sendDriverOffer,
} from "../booking/roadside-help/roadsideLib";

type Notification = {
  id: string;
  driverId?: string;
  requestId?: string;
  offerId?: string;
  type?: string;
  title?: string;
  message?: string;
  problemTypes?: string[];
  description?: string;
  passengerName?: string;
  passengerPhone?: string;
  passengerLocation?: {
    latitude?: number;
    longitude?: number;
    address?: string;
  } | null;
  distanceKm?: number;
  price?: number;
  etaMinutes?: number;
  status?: string;
  read?: boolean;
  // Soft delete — this document belongs only to this driver (driverId), so
  // hiding it here never affects anyone else's data.
  deletedForDriver?: boolean;
  createdAt?: { seconds?: number } | null;
};

// Highest-priority status wins when the same request has more than one
// notification (e.g. legacy data): accepted > offered > new.
const statusPriority = (status?: string) =>
  status === "accepted" ? 3 : status === "offered" ? 2 : 1;

export default function DriverHelpRequestsScreen() {
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  // Accepted requests — same roadsideRequests/{requestId} source of truth,
  // same shared card, as My Bookings -> Driver tab (see bookings.tsx).
  const [acceptedRequests, setAcceptedRequests] = useState<
    RoadsideRequestRecord[]
  >([]);

  // Offer form state (keyed by the notification being answered).
  const [offerForId, setOfferForId] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [eta, setEta] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setUid(user?.uid ?? null);
      if (!user) setLoading(false);
    });
  }, []);

  // Real-time listener, single equality filter -> no composite index needed.
  useEffect(() => {
    if (!uid) return;

    const q = query(
      collection(db, "driverNotifications"),
      where("driverId", "==", uid),
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const list: Notification[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Notification, "id">),
        }));
        setNotifications(list);
        setLoading(false);
      },
      () => setLoading(false),
    );

    return unsubscribe;
  }, [uid]);

  // Same source of truth as My Bookings -> Driver tab (roadsideRequests
  // where I'm the selected driver), so both screens always agree in
  // real time with zero extra plumbing.
  useEffect(() => {
    if (!uid) return;

    const q = query(
      collection(db, "roadsideRequests"),
      where("selectedDriverId", "==", uid),
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      setAcceptedRequests(
        snap.docs.map((d) => normalizeRoadsideRequest(d.id, d.data())),
      );
    });

    return unsubscribe;
  }, [uid]);

  // Hide rejected/completed/accepted. Once a passenger accepts an offer,
  // that request moves entirely to My Bookings -> Driver tab (Go help /
  // Finished Help live there now), so it no longer shows in this discovery
  // list. Keep only ONE card per request (the most advanced remaining
  // status), so there are never duplicate cards for the same request.
  const visible = useMemo(() => {
    const active = notifications.filter(
      (n) =>
        n.deletedForDriver !== true &&
        n.status !== "rejected" &&
        n.status !== "completed" &&
        n.status !== "accepted",
    );

    const byRequest = new Map<string, Notification>();
    const standalone: Notification[] = [];

    for (const n of active) {
      if (!n.requestId) {
        standalone.push(n);
        continue;
      }

      const existing = byRequest.get(n.requestId);
      const better =
        !existing ||
        statusPriority(n.status) > statusPriority(existing.status) ||
        (statusPriority(n.status) === statusPriority(existing.status) &&
          (n.createdAt?.seconds || 0) > (existing.createdAt?.seconds || 0));

      if (better) byRequest.set(n.requestId, n);
    }

    return [...byRequest.values(), ...standalone].sort(
      (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0),
    );
  }, [notifications]);

  const openOfferForm = (notification: Notification) => {
    setOfferForId(notification.id);
    setPrice("");
    setEta("");

    if (!notification.read) {
      markNotificationRead(notification.id).catch(() => {});
    }
  };

  const handleSendOffer = async (notification: Notification) => {
    const priceValue = Number(price);
    const etaValue = Number(eta);

    if (!priceValue || priceValue <= 0) {
      Alert.alert("Invalid price", "Please enter a price in ₪.");
      return;
    }

    if (!etaValue || etaValue <= 0) {
      Alert.alert("Invalid ETA", "Please enter your ETA in minutes.");
      return;
    }

    if (!notification.requestId) return;

    try {
      setBusyId(notification.id);

      await sendDriverOffer({
        requestId: notification.requestId,
        notificationId: notification.id,
        price: priceValue,
        etaMinutes: etaValue,
      });

      setOfferForId(null);
      Alert.alert("Offer sent", "The passenger can now see your offer.");
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Could not send the offer.");
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (notification: Notification) => {
    try {
      setBusyId(notification.id);
      await rejectNotification(notification.id);
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Could not reject the request.");
    } finally {
      setBusyId(null);
    }
  };

  // Soft delete only — the document belongs to this driver alone, so this
  // never affects the passenger's own request.
  const deleteRequest = async (notification: Notification) => {
    setNotifications((prev) => prev.filter((n) => n.id !== notification.id));

    await updateDoc(doc(db, "driverNotifications", notification.id), {
      deletedForDriver: true,
      updatedAt: serverTimestamp(),
    });
  };

  const confirmDeleteRequest = (notification: Notification) => {
    Alert.alert(
      "Delete request",
      "Delete this request from your list?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteRequest(notification).catch(() => {}),
        },
      ],
    );
  };

  const handleClearAll = () => {
    if (visible.length === 0 || clearingAll) return;

    Alert.alert(
      "Clear all",
      "Clear all help requests from your list?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: async () => {
            const ids = visible.map((n) => n.id);

            setClearingAll(true);
            setNotifications((prev) => prev.filter((n) => !ids.includes(n.id)));

            try {
              // Firestore batched writes cap at 500 operations — chunk
              // defensively even though this list is realistically small.
              for (let i = 0; i < ids.length; i += 450) {
                const batch = writeBatch(db);

                ids.slice(i, i + 450).forEach((id) => {
                  batch.update(doc(db, "driverNotifications", id), {
                    deletedForDriver: true,
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
          },
        },
      ],
    );
  };

  const renderRequestCard = (n: Notification) => {
    const isOffering = offerForId === n.id;
    const offered = n.status === "offered";
    const busy = busyId === n.id;
    const loc = n.passengerLocation;
    const address =
      loc?.address ||
      (loc?.latitude && loc?.longitude
        ? `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`
        : "Unknown location");

    return (
      <View key={n.id} style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.iconBadge}>
            <Ionicons name="construct" size={20} color="#F58220" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Roadside help nearby</Text>
            {typeof n.distanceKm === "number" ? (
              <Text style={styles.cardSub}>
                ≈ {n.distanceKm} km from your route
              </Text>
            ) : null}
          </View>
          {!n.read ? <View style={styles.newDot} /> : null}
          <Pressable
            style={styles.deleteButton}
            onPress={() => confirmDeleteRequest(n)}
            hitSlop={8}
          >
            <Ionicons name="trash-outline" size={18} color="#B91C1C" />
          </Pressable>
        </View>

        <View style={styles.tagRow}>
          {(n.problemTypes || []).map((p) => (
            <View key={p} style={styles.tag}>
              <Text style={styles.tagText}>{p}</Text>
            </View>
          ))}
        </View>

        {n.description ? (
          <Text style={styles.description}>{n.description}</Text>
        ) : null}

        <View style={styles.infoRow}>
          <Ionicons name="location-outline" size={16} color="#7C5F46" />
          <Text style={styles.infoText}>{address}</Text>
        </View>

        {/* Phone is intentionally hidden until the passenger accepts an offer. */}

        {offered ? (
          <View style={styles.offeredBanner}>
            <Ionicons name="time-outline" size={18} color="#B86115" />
            <Text style={styles.offeredText}>
              Waiting for passenger confirmation
            </Text>
          </View>
        ) : isOffering ? (
          <View style={styles.offerForm}>
            <View style={styles.offerFields}>
              <View style={styles.offerField}>
                <Text style={styles.fieldLabel}>Price (₪)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter price"
                  placeholderTextColor="#8B7B6B"
                  keyboardType="numeric"
                  value={price}
                  onChangeText={(t) => setPrice(t.replace(/\D/g, ""))}
                />
              </View>
              <View style={styles.offerField}>
                <Text style={styles.fieldLabel}>ETA (min)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter ETA in minutes"
                  placeholderTextColor="#8B7B6B"
                  keyboardType="numeric"
                  value={eta}
                  onChangeText={(t) => setEta(t.replace(/\D/g, ""))}
                />
              </View>
            </View>

            <View style={styles.actionsRow}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => setOfferForId(null)}
                disabled={busy}
              >
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryButton, busy && styles.buttonDisabled]}
                onPress={() => handleSendOffer(n)}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryText}>Send Offer</Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.actionsRow}>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => handleReject(n)}
              disabled={busy}
            >
              <Text style={styles.secondaryText}>Reject</Text>
            </Pressable>
            <Pressable
              style={styles.primaryButton}
              onPress={() => openOfferForm(n)}
              disabled={busy}
            >
              <Text style={styles.primaryText}>Accept / Send Offer</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
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
            <Ionicons name="help-buoy" size={26} color="#F58220" />
            <Text style={styles.title}>Help Requests</Text>
          </View>

          {visible.length > 0 ? (
            <Pressable onPress={handleClearAll} disabled={clearingAll} hitSlop={8}>
              <Text style={styles.clearAllText}>
                {clearingAll ? "Clearing..." : "Clear All"}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.subtitle}>
          Roadside help requests from passengers near your routes
        </Text>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#F58220" />
          </View>
        ) : visible.length === 0 && acceptedRequests.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="mail-open-outline" size={40} color="#8B7B6B" />
            <Text style={styles.emptyTitle}>No requests yet</Text>
            <Text style={styles.emptyText}>
              When a passenger near one of your routes needs roadside help, it
              will show up here.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {acceptedRequests.map((r) => (
              <RoadsideAcceptedCard key={r.id} request={r} />
            ))}
            {visible.map((n) => renderRequestCard(n))}
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
  clearAllText: {
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
    gap: 16,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 20,
    padding: 18,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 2,
  },
  acceptedCard: {
    borderColor: "#BBE7C6",
    backgroundColor: "#F6FCF7",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  deleteButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBadge: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#FFF2E8",
    alignItems: "center",
    justifyContent: "center",
  },
  iconBadgeGreen: {
    backgroundColor: "#E7F7EC",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: "#111827",
  },
  cardSub: {
    color: "#7C5F46",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
  },
  newDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#F58220",
  },
  acceptedPill: {
    backgroundColor: "#16A34A",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  acceptedPillText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 12,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  tag: {
    backgroundColor: "#FFF2E8",
    borderWidth: 1,
    borderColor: "#F7D3B4",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  tagText: {
    color: "#B86115",
    fontWeight: "900",
    fontSize: 13,
  },
  description: {
    color: "#3C2319",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  infoText: {
    color: "#7C5F46",
    fontSize: 14,
    fontWeight: "700",
    flexShrink: 1,
  },
  phoneText: {
    color: "#F58220",
  },
  metaRow: {
    flexDirection: "row",
    gap: 24,
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
  offeredBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFF2E8",
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
  },
  offeredText: {
    color: "#B86115",
    fontWeight: "800",
    fontSize: 14,
  },
  offerForm: {
    marginTop: 6,
    gap: 12,
  },
  offerFields: {
    flexDirection: "row",
    gap: 12,
  },
  offerField: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    padding: 13,
    backgroundColor: "#FFFDFC",
    color: "#111827",
    fontWeight: "700",
  },
  actionsRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 4,
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: "#E4DDD7",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#FFFDFC",
  },
  secondaryText: {
    color: "#7C5F46",
    fontWeight: "900",
    fontSize: 15,
  },
  primaryButton: {
    flex: 1.6,
    backgroundColor: "#F58220",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonFull: {
    backgroundColor: "#16A34A",
    borderRadius: 14,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
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
    paddingVertical: 14,
    marginTop: 10,
  },
  finishButtonText: {
    color: "#166534",
    fontWeight: "900",
    fontSize: 15,
  },
  primaryText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
