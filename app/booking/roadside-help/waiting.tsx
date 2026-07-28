import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useTranslation } from "react-i18next";

import { db } from "../../../firebase";
import { DirectionalScreen } from "../../i18n/DirectionalPrimitives";
import { translateProblemTypesList } from "../../i18n/formatters";
import { useLanguage } from "../../i18n/LanguageProvider";
import { ltrContentStyle } from "../../i18n/rtl";
import { normalizeLanguagesFromAccount } from "../../driver/create/driverHelpers";
import BitBadge from "../BitBadge";
import DriverReviewsSection from "../DriverReviewsSection";
import { getOfferDriverId } from "../driverReviewsLib";
import { acceptOffer, RoadsidePaymentMethod, rejectOffer } from "./roadsideLib";

type Offer = {
  id: string;
  driverId: string;
  driverName?: string;
  driverGender?: string;
  driverPhone?: string;
  offeredPrice?: number;
  estimatedArrivalMinutes?: number;
  status?: string;
  createdAt?: { seconds?: number } | null;
};

// users/{driverId} — languages + the driver's global rating, loaded once
// per driver and reused across every offer card for that same driver.
type DriverProfileInfo = {
  languages: string[];
  ratingAverage: number;
  ratingCount: number;
};

// Language names are always shown in their own script, regardless of the
// app's current UI language — these are never translated.
const LANGUAGE_LABELS: Record<string, string> = {
  ar: "العربية",
  he: "עברית",
  en: "English",
  ru: "Русский",
};

export default function RoadsideWaitingScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();

  const genderLabel = (value?: string) => {
    const gender = String(value || "").toLowerCase();
    if (gender === "female") return `${t("common.female")} ♀`;
    if (gender === "male") return `${t("common.male")} ♂`;
    return "";
  };

  const params = useLocalSearchParams();

  const requestId = String(params.requestId || "");
  const matchedCount = Number(params.matchedCount || 0);
  const rawProblemLabel = String(params.problemLabel || "Roadside Help");
  const problemLabel = translateProblemTypesList(
    rawProblemLabel.split(", "),
    t,
  ) || rawProblemLabel;
  const address = String(params.address || "");
  // Set when opened from a "roadside_offer_received" notification — the
  // matching offer card is scrolled to and briefly highlighted.
  const highlightOfferId = String(params.highlightOfferId || params.offerId || "");

  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyOfferId, setBusyOfferId] = useState<string | null>(null);
  const [flashOfferId, setFlashOfferId] = useState<string | null>(null);
  // The offer awaiting a Cash/Bit choice in the confirmation modal — the
  // customer must pick one before acceptOffer is ever called (spec #2), and
  // that choice is frozen server-side once accepted (see roadsideLib.ts /
  // firestore.rules — the accepted helper, price, and payment method can
  // never change after this point).
  const [confirmingOffer, setConfirmingOffer] = useState<Offer | null>(null);
  const [confirmMethod, setConfirmMethod] = useState<RoadsidePaymentMethod | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const offerCardRefs = useRef<Record<string, View | null>>({});

  // Driver name/rating/languages, keyed by the driver's real UID
  // (getOfferDriverId) — loaded once per driver, not once per offer.
  const [driverProfiles, setDriverProfiles] = useState<
    Record<string, DriverProfileInfo>
  >({});
  const fetchedDriverIdsRef = useRef<Set<string>>(new Set());

  // Listen to offers for this request in real time (sorted client-side so no
  // Firestore composite index is required).
  useEffect(() => {
    if (!requestId) {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, "roadsideOffers"),
      where("requestId", "==", requestId),
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const list: Offer[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Offer, "id">),
        }));
        setOffers(list);
        setLoading(false);
      },
      () => setLoading(false),
    );

    return unsubscribe;
  }, [requestId]);

  // Only show offers still open to the passenger.
  const visibleOffers = useMemo(
    () =>
      offers
        .filter((o) => o.status === "pending" || o.status === "accepted")
        .sort(
          (a, b) =>
            (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0),
        ),
    [offers],
  );

  // Deep link from "roadside_offer_received": once this offer shows up in
  // the list, scroll to it and flash it briefly.
  useEffect(() => {
    if (!highlightOfferId) return;
    if (!visibleOffers.some((o) => o.id === highlightOfferId)) return;

    setFlashOfferId(highlightOfferId);

    const scrollTimer = setTimeout(() => {
      const cardNode = offerCardRefs.current[highlightOfferId];
      const scrollNode = scrollRef.current as any;
      if (!cardNode || !scrollNode) return;

      cardNode.measure((
        _x: number,
        _y: number,
        _w: number,
        _h: number,
        pageX: number,
        pageY: number,
      ) => {
        scrollNode.measure((
          _sx: number,
          _sy: number,
          _sw: number,
          _sh: number,
          _spx: number,
          scrollPageY: number,
        ) => {
          scrollNode.scrollTo({
            y: Math.max(pageY - scrollPageY - 16, 0),
            animated: true,
          });
        });
      });
    }, 350);

    const clearTimer = setTimeout(() => setFlashOfferId(null), 2600);

    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(clearTimer);
    };
  }, [highlightOfferId, visibleOffers]);

  // Rating summary + language chips load with the driver profile (not
  // gated behind anything) — only the review LIST itself is lazy-loaded,
  // inside DriverReviewsSection, when the user expands it.
  useEffect(() => {
    const idsToLoad = Array.from(
      new Set(
        visibleOffers
          .map((offer) => getOfferDriverId(offer))
          .filter((id) => id && !fetchedDriverIdsRef.current.has(id)),
      ),
    );

    if (idsToLoad.length === 0) return;

    idsToLoad.forEach((id) => fetchedDriverIdsRef.current.add(id));

    let cancelled = false;

    (async () => {
      const entries = await Promise.all(
        idsToLoad.map(async (id): Promise<[string, DriverProfileInfo]> => {
          try {
            const snap = await getDoc(doc(db, "users", id));

            if (!snap.exists()) {
              return [id, { languages: [], ratingAverage: 0, ratingCount: 0 }];
            }

            const data = snap.data();

            return [
              id,
              {
                languages: normalizeLanguagesFromAccount(data),
                ratingAverage: Number(data.ratingAverage) || 0,
                ratingCount: Number(data.ratingCount) || 0,
              },
            ];
          } catch {
            return [id, { languages: [], ratingAverage: 0, ratingCount: 0 }];
          }
        }),
      );

      if (cancelled) return;

      setDriverProfiles((prev) => {
        const next = { ...prev };
        entries.forEach(([id, info]) => {
          next[id] = info;
        });
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [visibleOffers]);

  // "Accept Help" only opens the confirmation modal — the actual acceptance
  // (acceptOffer) never fires until the customer has picked Cash or Bit
  // there (spec #2).
  const openAcceptConfirmation = (offer: Offer) => {
    if (busyOfferId) return;
    setConfirmMethod(null);
    setConfirmingOffer(offer);
  };

  const closeAcceptConfirmation = () => {
    if (busyOfferId) return;
    setConfirmingOffer(null);
    setConfirmMethod(null);
  };

  const handleConfirmAccept = async () => {
    const offer = confirmingOffer;
    if (!offer || !confirmMethod || busyOfferId) return;

    try {
      setBusyOfferId(offer.id);

      await acceptOffer(
        requestId,
        {
          id: offer.id,
          driverId: offer.driverId,
          driverName: offer.driverName,
          driverPhone: offer.driverPhone,
          price: offer.offeredPrice,
          etaMinutes: offer.estimatedArrivalMinutes,
        },
        confirmMethod,
      );

      setConfirmingOffer(null);
      setConfirmMethod(null);

      // My Bookings now shows the full accepted-helper stage machine (Live
      // Tracking button, Waiting for helper to start driving, ...) — see
      // renderRoadsideCard in app/(tabs)/bookings.tsx.
      router.replace({
        pathname: "/(tabs)/bookings",
        params: { tab: "passenger" },
      } as any);
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("roadsideHelp.couldNotAcceptOffer"));
    } finally {
      setBusyOfferId(null);
    }
  };

  const handleReject = async (offer: Offer) => {
    if (busyOfferId) return;

    try {
      setBusyOfferId(offer.id);
      await rejectOffer(offer.id);
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("roadsideHelp.couldNotRejectOffer"));
    } finally {
      setBusyOfferId(null);
    }
  };

  const callDriver = (phone?: string) => {
    if (!phone) return;
    Linking.openURL(`tel:${phone}`).catch(() =>
      Alert.alert(t("common.error"), t("roadsideHelp.couldNotStartCall")),
    );
  };

  return (
    <DirectionalScreen style={styles.page}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name={isRTL ? "arrow-forward" : "arrow-back"} size={22} color="#7C5F46" />
          <Text style={styles.backText}>{t("common.back")}</Text>
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.headerEmoji}>🔧</Text>
          <Text style={styles.title}>{t("roadsideHelp.findingHelp")}</Text>
        </View>

        <Text style={styles.routeText}>
          {problemLabel}
          {address ? ` • ${address}` : ""}
        </Text>

        {/* Status banner */}
        <View style={styles.statusCard}>
          <ActivityIndicator color="#F58220" />
          <View style={{ flex: 1 }}>
            <Text style={styles.statusTitle}>
              {visibleOffers.length > 0
                ? t("roadsideHelp.offersComingIn")
                : t("roadsideHelp.waitingForNearbyDrivers")}
            </Text>
            <Text style={styles.statusSub}>
              {matchedCount > 0
                ? t("roadsideHelp.notifiedDrivers", { count: matchedCount })
                : t("roadsideHelp.requestSentNoOffersYet")}
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#F58220" />
          </View>
        ) : visibleOffers.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="time-outline" size={40} color="#8B7B6B" />
            <Text style={styles.emptyTitle}>{t("roadsideHelp.noOffersYetTitle")}</Text>
            <Text style={styles.emptyText}>
              {t("roadsideHelp.noOffersYetMessage")}
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {visibleOffers.map((offer) => {
              const busy = busyOfferId === offer.id;
              const gender = genderLabel(offer.driverGender);
              const driverId = getOfferDriverId(offer);
              const profile = driverId ? driverProfiles[driverId] : undefined;
              const languages = profile?.languages || [];
              const ratingCount = profile?.ratingCount ?? 0;
              const ratingAverage = profile?.ratingAverage ?? 0;

              return (
                <View
                  key={offer.id}
                  ref={(node) => {
                    offerCardRefs.current[offer.id] = node;
                  }}
                  style={[
                    styles.card,
                    flashOfferId === offer.id && styles.cardHighlight,
                  ]}
                >
                  <View style={styles.topRow}>
                    <View style={styles.driverInfoRow}>
                      <View style={styles.avatar}>
                        <Ionicons name="construct" size={24} color="#F58220" />
                      </View>

                      <View style={styles.driverTextBox}>
                        <Text style={styles.driverName}>
                          {offer.driverName || t("rides.driverFallback")}
                        </Text>
                        {gender ? (
                          <Text style={styles.driverMeta}>{gender}</Text>
                        ) : null}
                      </View>
                    </View>

                    <View style={styles.ratingBox}>
                      <Ionicons name="star" size={15} color="#B86115" />
                      {ratingCount > 0 ? (
                        <>
                          <Text style={styles.ratingText}>
                            {ratingAverage.toFixed(1)}
                          </Text>
                          <Text style={styles.ratingCountText}>
                            ({ratingCount})
                          </Text>
                        </>
                      ) : (
                        <Text style={styles.ratingCountText}>{t("roadsideHelp.newDriverLabel")}</Text>
                      )}
                    </View>
                  </View>

                  <View style={styles.languagesRow}>
                    <Ionicons
                      name="language-outline"
                      size={15}
                      color="#7C5F46"
                    />

                    {languages.length > 0 ? (
                      languages.map((lang) => (
                        <View key={lang} style={styles.languageBadge}>
                          <Text style={styles.languageText}>
                            {LANGUAGE_LABELS[lang] || lang}
                          </Text>
                        </View>
                      ))
                    ) : (
                      <Text style={styles.languagesEmptyText}>
                        {t("roadsideHelp.languagesNotAvailable")}
                      </Text>
                    )}
                  </View>

                  <View style={styles.metaRow}>
                    <View style={styles.metaItem}>
                      <Ionicons name="cash-outline" size={17} color="#F58220" />
                      <Text style={styles.metaText}>
                        {offer.offeredPrice ?? "--"} ₪
                      </Text>
                    </View>
                    <View style={styles.metaItem}>
                      <Ionicons name="time-outline" size={17} color="#F58220" />
                      <Text style={styles.metaText}>
                        {offer.estimatedArrivalMinutes ?? "--"} min
                      </Text>
                    </View>
                  </View>

                  {offer.driverPhone ? (
                    <Pressable
                      style={styles.phoneRow}
                      onPress={() => callDriver(offer.driverPhone)}
                    >
                      <Ionicons name="call-outline" size={16} color="#F58220" />
                      <Text style={[styles.phoneText, ltrContentStyle]}>{offer.driverPhone}</Text>
                    </Pressable>
                  ) : null}

                  <DriverReviewsSection
                    driverId={driverId}
                    reviewCountHint={ratingCount}
                  />

                  <View style={styles.actionsRow}>
                    <Pressable
                      style={[styles.rejectButton, busy && styles.buttonDisabled]}
                      onPress={() => handleReject(offer)}
                      disabled={busy}
                    >
                      <Text style={styles.rejectText}>{t("roadsideHelp.rejectButton")}</Text>
                    </Pressable>

                    <Pressable
                      style={[styles.acceptButton, busy && styles.buttonDisabled]}
                      onPress={() => openAcceptConfirmation(offer)}
                      disabled={busy}
                    >
                      {busy ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Text style={styles.acceptText}>{t("roadsideHelp.acceptHelpButton")}</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={!!confirmingOffer}
        transparent
        animationType="fade"
        onRequestClose={closeAcceptConfirmation}
      >
        <View style={styles.confirmBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={closeAcceptConfirmation}
          />

          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>{t("roadsideHelp.confirmOfferTitle")}</Text>

            {confirmingOffer ? (
              <>
                <View style={styles.confirmRow}>
                  <Ionicons name="person-outline" size={17} color="#7C5F46" />
                  <Text style={styles.confirmRowText}>
                    {confirmingOffer.driverName || t("rides.driverFallback")}
                  </Text>
                </View>

                <View style={styles.confirmRow}>
                  <Ionicons name="cash-outline" size={17} color="#F58220" />
                  <Text style={styles.confirmRowText}>
                    {t("roadsideHelp.offeredPriceLabel", {
                      amount: confirmingOffer.offeredPrice ?? "--",
                    })}
                  </Text>
                </View>

                <View style={styles.confirmRow}>
                  <Ionicons name="time-outline" size={17} color="#F58220" />
                  <Text style={styles.confirmRowText}>
                    {t("roadsideHelp.estimatedArrivalLabel", {
                      minutes: confirmingOffer.estimatedArrivalMinutes ?? "--",
                    })}
                  </Text>
                </View>
              </>
            ) : null}

            <Text style={styles.confirmMethodLabel}>
              {t("roadsideHelp.chooseHowToPayLabel")}
            </Text>

            <View style={styles.confirmMethodRow}>
              <Pressable
                style={[
                  styles.confirmMethodButton,
                  confirmMethod === "cash" && styles.confirmMethodButtonActive,
                ]}
                onPress={() => setConfirmMethod("cash")}
              >
                <Text style={styles.confirmMethodEmoji}>💵</Text>
                <Text
                  style={[
                    styles.confirmMethodText,
                    confirmMethod === "cash" && styles.confirmMethodTextActive,
                  ]}
                >
                  {t("common.cash")}
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.confirmMethodButton,
                  confirmMethod === "bit" && styles.confirmMethodButtonActive,
                ]}
                onPress={() => setConfirmMethod("bit")}
              >
                <BitBadge size={18} />
                <Text
                  style={[
                    styles.confirmMethodText,
                    confirmMethod === "bit" && styles.confirmMethodTextActive,
                  ]}
                >
                  {t("roadsideHelp.payWithBit")}
                </Text>
              </Pressable>
            </View>

            <View style={styles.confirmActionsRow}>
              <Pressable
                style={styles.confirmCancelButton}
                onPress={closeAcceptConfirmation}
                disabled={!!busyOfferId}
              >
                <Text style={styles.confirmCancelText}>{t("common.cancel")}</Text>
              </Pressable>

              <Pressable
                style={[
                  styles.confirmAcceptButton,
                  (!confirmMethod || !!busyOfferId) && styles.buttonDisabled,
                ]}
                onPress={handleConfirmAccept}
                disabled={!confirmMethod || !!busyOfferId}
              >
                {busyOfferId ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.confirmAcceptText}>
                    {t("roadsideHelp.confirmAndAcceptButton")}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 6,
  },
  headerEmoji: {
    fontSize: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: "900",
    color: "#111827",
  },
  routeText: {
    color: "#7C5F46",
    fontWeight: "700",
    marginBottom: 20,
  },
  statusCard: {
    backgroundColor: "#FFF2E8",
    borderWidth: 1,
    borderColor: "#F7D3B4",
    borderRadius: 18,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 22,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 3,
  },
  statusSub: {
    color: "#7C5F46",
    fontSize: 13,
    lineHeight: 18,
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
    borderRadius: 22,
    padding: 18,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 2,
  },
  cardHighlight: {
    borderColor: "#F58220",
    borderWidth: 2,
    backgroundColor: "#FFF8F2",
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  driverInfoRow: {
    flexDirection: "row",
    flex: 1,
    gap: 12,
    alignItems: "center",
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#FFF2E8",
    alignItems: "center",
    justifyContent: "center",
  },
  driverTextBox: {
    flex: 1,
  },
  driverName: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
  },
  driverMeta: {
    color: "#7C5F46",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
  },
  ratingBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FFF2E8",
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 15,
  },
  ratingText: {
    fontWeight: "900",
    color: "#111827",
    fontSize: 14,
  },
  ratingCountText: {
    color: "#7C5F46",
    fontSize: 12,
    fontWeight: "700",
  },
  languagesRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  languageBadge: {
    backgroundColor: "#EAF8F5",
    borderWidth: 1,
    borderColor: "#9DDDD2",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  languageText: {
    color: "#178C7B",
    fontSize: 12,
    fontWeight: "900",
  },
  languagesEmptyText: {
    color: "#7C5F46",
    fontSize: 13,
    fontWeight: "700",
  },
  metaRow: {
    flexDirection: "row",
    gap: 24,
    marginBottom: 16,
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
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFF8F2",
    borderWidth: 1,
    borderColor: "#F7D3B4",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  phoneText: {
    color: "#F58220",
    fontSize: 15,
    fontWeight: "900",
  },
  actionsRow: {
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
    backgroundColor: "#FFFDFC",
  },
  rejectText: {
    color: "#7C5F46",
    fontWeight: "900",
    fontSize: 15,
  },
  acceptButton: {
    flex: 1.4,
    backgroundColor: "#F58220",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  confirmBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  confirmCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 22,
    gap: 4,
  },
  confirmTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 10,
  },
  confirmRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  confirmRowText: {
    color: "#3C2319",
    fontWeight: "700",
    fontSize: 14,
    flexShrink: 1,
  },
  confirmMethodLabel: {
    fontSize: 14,
    fontWeight: "900",
    color: "#111827",
    marginTop: 12,
    marginBottom: 10,
  },
  confirmMethodRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 18,
  },
  confirmMethodButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E7DCD1",
    backgroundColor: "#FFFDFC",
  },
  confirmMethodButtonActive: {
    backgroundColor: "#F58220",
    borderColor: "#F58220",
  },
  confirmMethodEmoji: {
    fontSize: 16,
  },
  confirmMethodText: {
    fontSize: 14,
    fontWeight: "900",
    color: "#7C5F46",
  },
  confirmMethodTextActive: {
    color: "#FFFFFF",
  },
  confirmActionsRow: {
    flexDirection: "row",
    gap: 12,
  },
  confirmCancelButton: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: "#E4DDD7",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#FFFDFC",
  },
  confirmCancelText: {
    color: "#7C5F46",
    fontWeight: "900",
    fontSize: 15,
  },
  confirmAcceptButton: {
    flex: 1.4,
    backgroundColor: "#F58220",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmAcceptText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
  },
});
