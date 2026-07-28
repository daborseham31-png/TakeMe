// ---------------------------------------------------------------------------
// Driver "Help Requests" discovery screen.
//
// ONE card per Roadside Help request, keyed by requestId, for the whole
// lifecycle: Nearby -> Offer Sent -> Passenger Accepted -> Start Driving ->
// Helper On the Way -> Arrived -> Help in Progress -> Waiting for Passenger
// Confirmation -> Waiting for Payment -> Completed. The request never
// renders twice under two different titles — see the `cards` useMemo below,
// which merges three collections (driverNotifications, roadsideOffers,
// roadsideRequests) into one card per requestId BEFORE anything is rendered.
// ---------------------------------------------------------------------------

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
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useTranslation } from "react-i18next";

import { auth, db } from "../../firebase";
import KeyboardAvoidingWrapper from "../components/KeyboardAvoidingWrapper";
import { DirectionalScreen } from "../i18n/DirectionalPrimitives";
import { formatLocalizedDate, formatLocalizedTime, translateProblemType } from "../i18n/formatters";
import { ltrContentStyle } from "../i18n/rtl";
import { useLanguage } from "../i18n/LanguageProvider";
import RoadsideAcceptedCard from "../booking/roadside-help/RoadsideAcceptedCard";
import {
  markNotificationRead,
  MyOfferRecord,
  normalizeMyOffer,
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
  // hiding it here never affects anyone else's data. This is the ONE flag
  // "hidden for this helper" lives on, for every stage a request can be in —
  // see the top-of-file comment.
  deletedForDriver?: boolean;
  createdAt?: { seconds?: number } | null;
};

// A request the helper accepted is represented ONLY by "accepted" — never
// also by a "pending" card for the same requestId (see the `cards` useMemo).
type HelpRequestCard =
  | {
      kind: "accepted";
      requestId: string;
      record: RoadsideRequestRecord;
      notificationId: string | null;
    }
  | {
      kind: "pending";
      requestId: string;
      notification: Notification;
      offer: MyOfferRecord | null;
    };

type PendingStage = "nearby" | "offer_sent" | "not_selected" | "rejected";

const getPendingStage = (
  notification: Notification,
  offer: MyOfferRecord | null,
): PendingStage => {
  if (notification.status === "rejected") return "rejected";
  if (notification.status === "offered") {
    return offer?.status === "not_selected" ? "not_selected" : "offer_sent";
  }
  return "nearby";
};

// Sort groups (spec order): 1) currently working on, 2) accepted but not
// started, 3) open nearby requests, 4) offer sent/awaiting response,
// 5) completed/rejected/cancelled/not-selected.
const ACTIVE_ACCEPTED_STATUSES = new Set([
  "helper_on_way",
  "arrived",
  "in_progress",
  "completion_pending",
]);

const getSortGroup = (card: HelpRequestCard): number => {
  if (card.kind === "accepted") {
    const { status, paymentStatus } = card.record;

    if (status === "cancelled") return 5;
    if (status === "completed") return paymentStatus === "paid" ? 5 : 1;
    if (ACTIVE_ACCEPTED_STATUSES.has(status)) return 1;

    return 2; // "helper_assigned" — accepted, not started yet
  }

  const stage = getPendingStage(card.notification, card.offer);

  if (stage === "nearby") return 3;
  if (stage === "offer_sent") return 4;

  return 5; // rejected / not_selected
};

const getSortSeconds = (card: HelpRequestCard): number => {
  if (card.kind === "accepted") {
    return card.record.updatedAtSeconds || card.record.createdAtSeconds;
  }

  return (
    card.offer?.updatedAtSeconds ||
    card.notification.createdAt?.seconds ||
    0
  );
};

// A card is "currently active work" only for the stages the helper is
// mid-service on (spec #4/#5) — never merely "accepted" (helper_assigned),
// which is safe to hide from this page since it stays fully actionable in
// My Bookings either way.
const isCurrentlyActive = (card: HelpRequestCard): boolean =>
  card.kind === "accepted" &&
  (ACTIVE_ACCEPTED_STATUSES.has(card.record.status) ||
    (card.record.status === "completed" && card.record.paymentStatus !== "paid"));

export default function DriverHelpRequestsScreen() {
  const { t } = useTranslation();
  const { isRTL, language } = useLanguage();
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  // Accepted requests — same roadsideRequests/{requestId} source of truth,
  // same shared card, as My Bookings -> Driver tab (see bookings.tsx).
  const [acceptedRequests, setAcceptedRequests] = useState<
    RoadsideRequestRecord[]
  >([]);

  // My own sent offers — only needed to show the offered price/ETA on the
  // "Offer Sent" stage, and to tell "still waiting" apart from "the
  // passenger picked another helper" (not_selected).
  const [myOffers, setMyOffers] = useState<MyOfferRecord[]>([]);

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

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setAcceptedRequests(
          snap.docs.map((d) => normalizeRoadsideRequest(d.id, d.data())),
        );
      },
      (error) => {
        console.log("Listener failed:", {
          feature: "help-requests.acceptedRequests",
          collection: "roadsideRequests",
          userId: uid,
          code: error.code,
          message: error.message,
        });
        setAcceptedRequests([]);
      },
    );

    return unsubscribe;
  }, [uid]);

  // My own sent offers (roadsideOffers where driverId == me) — feeds the
  // "Offer Sent" stage's price/ETA and the "Not Selected" stage.
  useEffect(() => {
    if (!uid) return;

    const q = query(collection(db, "roadsideOffers"), where("driverId", "==", uid));

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setMyOffers(snap.docs.map((d) => normalizeMyOffer(d.id, d.data())));
      },
      (error) => {
        console.log("Listener failed:", {
          feature: "help-requests.myOffers",
          collection: "roadsideOffers",
          userId: uid,
          code: error.code,
          message: error.message,
        });
        setMyOffers([]);
      },
    );

    return unsubscribe;
  }, [uid]);

  // -------------------------------------------------------------------
  // ONE card per requestId. A request already represented by an
  // "accepted" card (roadsideRequests) is NEVER also turned into a
  // "pending" (nearby/offer sent/rejected) card for the same requestId —
  // this is the fix for the "same request shows up twice" bug. Sorted per
  // spec #3 (see getSortGroup/getSortSeconds above).
  // -------------------------------------------------------------------
  const cards = useMemo(() => {
    const acceptedByRequestId = new Map<string, RoadsideRequestRecord>();
    acceptedRequests.forEach((r) => acceptedByRequestId.set(r.id, r));

    const offerByRequestId = new Map<string, MyOfferRecord>();
    myOffers.forEach((o) => {
      if (!o.requestId) return;
      const existing = offerByRequestId.get(o.requestId);
      if (!existing || o.updatedAtSeconds >= existing.updatedAtSeconds) {
        offerByRequestId.set(o.requestId, o);
      }
    });

    const notificationByRequestId = new Map<string, Notification>();
    notifications.forEach((n) => {
      if (n.requestId) notificationByRequestId.set(n.requestId, n);
    });

    const result: HelpRequestCard[] = [];

    acceptedByRequestId.forEach((record, requestId) => {
      const notification = notificationByRequestId.get(requestId);
      if (notification?.deletedForDriver === true) return;

      result.push({
        kind: "accepted",
        requestId,
        record,
        notificationId: notification?.id || null,
      });
    });

    notifications.forEach((n) => {
      if (n.deletedForDriver === true) return;
      if (n.requestId && acceptedByRequestId.has(n.requestId)) return;

      result.push({
        kind: "pending",
        requestId: n.requestId || n.id,
        notification: n,
        offer: n.requestId ? offerByRequestId.get(n.requestId) || null : null,
      });
    });

    return result.sort((a, b) => {
      const groupDiff = getSortGroup(a) - getSortGroup(b);
      if (groupDiff !== 0) return groupDiff;
      return getSortSeconds(b) - getSortSeconds(a);
    });
  }, [acceptedRequests, notifications, myOffers]);

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
      Alert.alert(t("validation.invalidPriceTitle"), t("validation.enterPriceInShekel"));
      return;
    }

    if (!etaValue || etaValue <= 0) {
      Alert.alert(t("validation.invalidEtaTitle"), t("validation.enterEtaMinutes"));
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
      Alert.alert(t("roadsideHelp.offerSentTitle"), t("roadsideHelp.offerSentMessage"));
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("roadsideHelp.couldNotSendOffer"));
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (notification: Notification) => {
    try {
      setBusyId(notification.id);
      await rejectNotification(notification.id);
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("roadsideHelp.couldNotRejectRequest"));
    } finally {
      setBusyId(null);
    }
  };

  // Soft delete only — the notification document belongs to this driver
  // alone, so hiding it here never touches the passenger's own request, the
  // linked booking/offer/payment/rating/tracking data, or any admin/report
  // record. See the top-of-file comment for why this is the single "hidden
  // for this helper" flag across every stage.
  const hideNotification = async (notificationId: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, deletedForDriver: true } : n)),
    );

    await updateDoc(doc(db, "driverNotifications", notificationId), {
      deletedForDriver: true,
      updatedAt: serverTimestamp(),
    });
  };

  const confirmDeleteCard = (card: HelpRequestCard) => {
    const notificationId = card.kind === "accepted" ? card.notificationId : card.notification.id;
    if (!notificationId) return;

    const active = isCurrentlyActive(card);

    Alert.alert(
      t("roadsideHelp.deleteRequestTitle"),
      active
        ? t("roadsideHelp.deleteActiveRequestConfirm")
        : t("roadsideHelp.deleteRequestConfirm"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: () => hideNotification(notificationId).catch(() => {}),
        },
      ],
    );
  };

  // Clear All hides every dismissible card (spec #5) — every group EXCEPT
  // the request the helper is currently, actively working on, which is
  // never touched by Clear All and stays fully available in My Bookings.
  const clearableCards = useMemo(() => cards.filter((c) => !isCurrentlyActive(c)), [cards]);

  const handleClearAll = () => {
    if (clearableCards.length === 0 || clearingAll) return;

    Alert.alert(
      t("roadsideHelp.clearAllTitle"),
      t("roadsideHelp.clearAllConfirm"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("roadsideHelp.clearAllButton"),
          style: "destructive",
          onPress: async () => {
            const notificationIds = clearableCards
              .map((c) => (c.kind === "accepted" ? c.notificationId : c.notification.id))
              .filter((id): id is string => !!id);

            setClearingAll(true);
            setNotifications((prev) =>
              prev.map((n) =>
                notificationIds.includes(n.id) ? { ...n, deletedForDriver: true } : n,
              ),
            );

            try {
              // Firestore batched writes cap at 500 operations — chunk
              // defensively even though this list is realistically small.
              for (let i = 0; i < notificationIds.length; i += 450) {
                const batch = writeBatch(db);

                notificationIds.slice(i, i + 450).forEach((id) => {
                  batch.update(doc(db, "driverNotifications", id), {
                    deletedForDriver: true,
                    updatedAt: serverTimestamp(),
                  });
                });

                await batch.commit();
              }
            } catch (error: any) {
              Alert.alert(t("common.error"), error?.message || t("roadsideHelp.couldNotClearAll"));
            } finally {
              setClearingAll(false);
            }
          },
        },
      ],
    );
  };

  const renderPendingCard = (card: Extract<HelpRequestCard, { kind: "pending" }>) => {
    const n = card.notification;
    const stage = getPendingStage(n, card.offer);
    const isOffering = offerForId === n.id;
    const busy = busyId === n.id;
    const loc = n.passengerLocation;
    const address =
      loc?.address ||
      (loc?.latitude && loc?.longitude
        ? `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`
        : t("roadsideHelp.unknownLocation"));
    const createdDate = n.createdAt?.seconds ? new Date(n.createdAt.seconds * 1000) : null;

    const badge =
      stage === "offer_sent"
        ? { label: t("roadsideHelp.badgeOfferSent"), style: styles.badgeOrange }
        : stage === "not_selected"
          ? { label: t("roadsideHelp.badgeNotSelected"), style: styles.badgeMuted }
          : stage === "rejected"
            ? { label: t("roadsideHelp.badgeRejected"), style: styles.badgeMuted }
            : null;

    const isTerminal = stage === "not_selected" || stage === "rejected";

    return (
      <View
        key={card.requestId}
        style={[styles.card, isTerminal && styles.cardMuted]}
      >
        <View style={styles.cardHeader}>
          <View style={styles.iconBadge}>
            <Ionicons name="construct" size={20} color="#F58220" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>
              {stage === "nearby"
                ? t("roadsideHelp.roadsideHelpNearbyTitle")
                : stage === "offer_sent"
                  ? t("roadsideHelp.badgeOfferSent")
                  : stage === "not_selected"
                    ? t("roadsideHelp.badgeNotSelected")
                    : t("roadsideHelp.badgeRejected")}
            </Text>
            {typeof n.distanceKm === "number" ? (
              <Text style={styles.cardSub}>
                {t("roadsideHelp.distanceFromRoute", { km: n.distanceKm })}
              </Text>
            ) : null}
          </View>

          {badge ? (
            <View style={[styles.badge, badge.style]}>
              <Text style={styles.badgeText}>{badge.label}</Text>
            </View>
          ) : !n.read ? (
            <View style={styles.newDot} />
          ) : null}

          <Pressable
            style={styles.deleteButton}
            onPress={() => confirmDeleteCard(card)}
            hitSlop={8}
          >
            <Ionicons name="trash-outline" size={18} color="#B91C1C" />
          </Pressable>
        </View>

        <View style={styles.tagRow}>
          {(n.problemTypes || []).map((p) => (
            <View key={p} style={styles.tag}>
              <Text style={styles.tagText}>{translateProblemType(p, t)}</Text>
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

        {createdDate ? (
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={16} color="#7C5F46" />
            <Text style={[styles.infoText, ltrContentStyle]}>
              {formatLocalizedDate(createdDate, language)} • {formatLocalizedTime(createdDate, language)}
            </Text>
          </View>
        ) : null}

        {/* Phone is intentionally hidden until the passenger accepts an offer. */}

        {stage === "not_selected" ? (
          <View style={styles.mutedBanner}>
            <Ionicons name="information-circle-outline" size={18} color="#7C5F46" />
            <Text style={styles.mutedBannerText}>
              {t("roadsideHelp.offerNotSelectedMessage")}
            </Text>
          </View>
        ) : stage === "rejected" ? (
          <View style={styles.mutedBanner}>
            <Ionicons name="close-circle-outline" size={18} color="#7C5F46" />
            <Text style={styles.mutedBannerText}>
              {t("roadsideHelp.rejectedRequestMessage")}
            </Text>
          </View>
        ) : stage === "offer_sent" ? (
          <>
            <View style={styles.metaRow}>
              {typeof card.offer?.offeredPrice === "number" ? (
                <View style={styles.metaItem}>
                  <Ionicons name="cash-outline" size={16} color="#F58220" />
                  <Text style={styles.metaText}>{card.offer.offeredPrice} ₪</Text>
                </View>
              ) : null}

              {typeof card.offer?.estimatedArrivalMinutes === "number" ? (
                <View style={styles.metaItem}>
                  <Ionicons name="time-outline" size={16} color="#F58220" />
                  <Text style={styles.metaText}>
                    {t("booking.minutesShort", { count: card.offer.estimatedArrivalMinutes })}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.offeredBanner}>
              <Ionicons name="time-outline" size={18} color="#B86115" />
              <Text style={styles.offeredText}>
                {t("roadsideHelp.waitingForPassengerConfirmation")}
              </Text>
            </View>
          </>
        ) : isOffering ? (
          <View style={styles.offerForm}>
            <View style={styles.offerFields}>
              <View style={styles.offerField}>
                <Text style={styles.fieldLabel}>{t("roadsideHelp.priceLabel")}</Text>
                <TextInput
                  style={styles.input}
                  placeholder={t("roadsideHelp.enterPricePlaceholder")}
                  placeholderTextColor="#8B7B6B"
                  keyboardType="numeric"
                  value={price}
                  onChangeText={(val) => setPrice(val.replace(/\D/g, ""))}
                />
              </View>
              <View style={styles.offerField}>
                <Text style={styles.fieldLabel}>{t("roadsideHelp.etaLabel")}</Text>
                <TextInput
                  style={styles.input}
                  placeholder={t("roadsideHelp.enterEtaPlaceholder")}
                  placeholderTextColor="#8B7B6B"
                  keyboardType="numeric"
                  value={eta}
                  onChangeText={(val) => setEta(val.replace(/\D/g, ""))}
                />
              </View>
            </View>

            <View style={styles.actionsRow}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => setOfferForId(null)}
                disabled={busy}
              >
                <Text style={styles.secondaryText}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryButton, busy && styles.buttonDisabled]}
                onPress={() => handleSendOffer(n)}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryText}>{t("roadsideHelp.sendOfferButton")}</Text>
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
              <Text style={styles.secondaryText}>{t("roadsideHelp.rejectButton")}</Text>
            </Pressable>
            <Pressable
              style={styles.primaryButton}
              onPress={() => openOfferForm(n)}
              disabled={busy}
            >
              <Text style={styles.primaryText}>{t("roadsideHelp.acceptSendOfferButton")}</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  return (
    <DirectionalScreen style={styles.page}>
      <KeyboardAvoidingWrapper>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name={isRTL ? "arrow-forward" : "arrow-back"} size={22} color="#7C5F46" />
          <Text style={styles.backText}>{t("common.back")}</Text>
        </Pressable>

        <View style={styles.headerRow}>
          <View style={styles.header}>
            <Ionicons name="help-buoy" size={26} color="#F58220" />
            <Text style={styles.title}>{t("roadsideHelp.helpRequestsTitle")}</Text>
          </View>

          {clearableCards.length > 0 ? (
            <Pressable onPress={handleClearAll} disabled={clearingAll} hitSlop={8}>
              <Text style={styles.clearAllText}>
                {clearingAll ? t("roadsideHelp.clearingButton") : t("roadsideHelp.clearAllButton")}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.subtitle}>
          {t("roadsideHelp.helpRequestsSubtitle")}
        </Text>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#F58220" />
          </View>
        ) : cards.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="mail-open-outline" size={40} color="#8B7B6B" />
            <Text style={styles.emptyTitle}>{t("roadsideHelp.noRequestsYetTitle")}</Text>
            <Text style={styles.emptyText}>
              {t("roadsideHelp.noRequestsYetMessage")}
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {cards.map((card) =>
              card.kind === "accepted" ? (
                <RoadsideAcceptedCard
                  key={card.requestId}
                  request={card.record}
                  onDelete={
                    card.notificationId ? () => confirmDeleteCard(card) : undefined
                  }
                />
              ) : (
                renderPendingCard(card)
              ),
            )}
          </View>
        )}
      </ScrollView>
      </KeyboardAvoidingWrapper>
    </DirectionalScreen>
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
  // Completed/rejected/not-selected cards read visually simpler/quieter
  // than active ones (spec #6) — same shape, muted border, no shadow.
  cardMuted: {
    borderColor: "#E7DCD1",
    backgroundColor: "#FBF9F6",
    shadowOpacity: 0,
    elevation: 0,
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
  badge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeOrange: {
    backgroundColor: "#F58220",
  },
  badgeMuted: {
    backgroundColor: "#D8C9BC",
  },
  badgeText: {
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
    flexShrink: 1,
  },
  mutedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#F1E9DF",
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
  },
  mutedBannerText: {
    color: "#7C5F46",
    fontWeight: "700",
    fontSize: 13.5,
    flexShrink: 1,
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
  primaryText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
