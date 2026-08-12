// ---------------------------------------------------------------------------
// Shared "Passenger accepted your offer" card — used identically by:
//   - app/driver/help-requests.tsx
//   - app/(tabs)/bookings.tsx (Driver tab)
//
// Both screens subscribe to `roadsideRequests` with their own onSnapshot
// listener and pass the normalized record down as a plain prop, so this
// component is the ONE place status/action logic for an accepted Roadside
// Help request lives — including starting/stopping the helper's own
// foreground GPS sharing. Every real status change comes from Firestore and
// flows back down through the parent's listener, so both screens always
// agree.
//
// HELPER-ONLY: this card only ever renders for the accepted helper (both
// parent screens query `roadsideRequests` where selectedDriverId == me), so
// none of its actions need their own client-side "am I the helper" check —
// firestore.rules is still the real enforcement boundary (see roadsideLib.ts
// / firestore.rules), this is just who the UI is built for. Never shows
// Accept Offer, payment-method selection, Confirm Completion, Report a
// Problem, Pay with Bit, or the customer's rating action — those are the
// customer's own actions, rendered only on their side (see
// renderRoadsideCard in app/(tabs)/bookings.tsx).
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Alert } from "../../AppAlert";
import { useTranslation } from "react-i18next";

import { auth } from "../../../firebase";
import {
  captureDriverLocationOnce,
  startDriverLocationTracking,
  stopDriverLocationTracking,
} from "../../driverLocationTask";
import { translateProblemTypesList } from "../../i18n/formatters";
import { ltrContentStyle } from "../../i18n/rtl";
import { openConversation } from "../../chat/chatLib";
import {
  buildDirectionsUrl,
  finishRoadsideHelp,
  getCurrentPositionBestEffort,
  markHelperArrived,
  RoadsideRequestRecord,
  startDriving,
  startHelp,
} from "./roadsideLib";

type Props = {
  request: RoadsideRequestRecord;
  // Optional screen-specific chrome (e.g. My Bookings' "remove from my
  // list" trash icon). The status/action logic below is identical
  // regardless of whether this is passed.
  onDelete?: () => void;
};

export default function RoadsideAcceptedCard({ request, onDelete }: Props) {
  const { t } = useTranslation();
  const [busyAction, setBusyAction] = useState<
    "start_driving" | "arrived" | "finish" | null
  >(null);

  const status = request.status;
  const isCancelled = status === "cancelled";
  const isHelperAssigned = status === "helper_assigned";
  const isHelperOnWay = status === "helper_on_way";
  const isArrived = status === "arrived";
  const isInProgress = status === "in_progress";
  const isCompletionPending = status === "completion_pending";
  const isCompleted = status === "completed";

  const isPaid = request.paymentStatus === "paid";

  // ---------------------------------------------------------------------
  // Foreground-only GPS sharing (Location.watchPositionAsync — no
  // background task anywhere, see driverLocationTask.ts's own header).
  // Starts the moment the request reaches "helper_on_way" (Start Driving)
  // and stops the moment it leaves that state for ANY reason — arrived,
  // completed, cancelled — or this card unmounts. Re-running this effect on
  // every request.status change is what makes BOTH "stop when the helper
  // arrives" and "stop when this screen unmounts" the exact same cleanup
  // path (a status change away from helper_on_way tears down the previous
  // effect run just like an unmount does).
  //
  // NOTE: if this exact card is somehow mounted twice at once for the same
  // request (e.g. Help Requests and My Bookings both alive in memory), one
  // instance unmounting will stop tracking even while the other is still
  // showing "helper_on_way" — startDriverLocationTracking is idempotent per
  // target, so the remaining instance's own next render simply restarts it;
  // this has not needed a cross-instance lock in practice.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (status !== "helper_on_way") return;
    if (!request.bookingId) return;

    const user = auth.currentUser;
    if (!user) return;

    const target = {
      targetId: request.bookingId,
      driverId: user.uid,
      passengerId: request.passengerId,
    };

    let cancelled = false;

    (async () => {
      try {
        await captureDriverLocationOnce(target);
        if (cancelled) return;

        const result = await startDriverLocationTracking(target);
        if (!cancelled && !result.started) {
          Alert.alert(
            t("roadsideHelp.locationPermissionTitle"),
            t("roadsideHelp.allowLocationForTracking"),
          );
        }
      } catch (error) {
        console.log("RoadsideAcceptedCard: failed to start tracking", error);
      }
    })();

    return () => {
      cancelled = true;
      stopDriverLocationTracking().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, request.bookingId, request.passengerId]);

  const badgeLabel = isPaid
    ? t("roadsideHelp.badgeCompleted")
    : isCompleted || isCompletionPending
      ? t("roadsideHelp.badgeCompleted")
      : isInProgress
        ? t("roadsideHelp.badgeInProgress")
        : isArrived
          ? t("roadsideHelp.badgeArrived")
          : isHelperOnWay
            ? t("roadsideHelp.badgeOnTheWay")
            : t("roadsideHelp.badgeAccepted");

  const displayServiceType =
    request.problemTypes.length > 0
      ? translateProblemTypesList(request.problemTypes, t)
      : request.serviceType || t("rideCategory.categories.help.title");

  const badgeStyle =
    isPaid || isCompleted || isCompletionPending
      ? styles.badgeGreen
      : isInProgress || isArrived || isHelperOnWay
        ? styles.badgeBlue
        : styles.badgeOrange;

  const runAction = async (
    action: typeof busyAction,
    fn: () => Promise<void>,
    errorFallbackKey: string,
  ) => {
    if (busyAction) return;

    try {
      setBusyAction(action);
      await fn();
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t(errorFallbackKey));
    } finally {
      setBusyAction(null);
    }
  };

  const handleStartDriving = () =>
    runAction(
      "start_driving",
      () => startDriving({ bookingId: request.bookingId, requestId: request.id }),
      "roadsideHelp.couldNotUpdateStatus",
    );

  // A single tap covers both "I've arrived" and "Start Help" — arrived and
  // in_progress are still two separate Firestore writes (firestore.rules
  // only allows one status step at a time), just no longer two separate
  // button presses for the driver. Checks `status` fresh each call so that
  // if the first write succeeds but the second one fails (network drop
  // mid-transition), the button — now rendered again for the "arrived"
  // state below — can safely retry from wherever it actually got stuck,
  // instead of re-attempting a step that already happened.
  const handleArrived = () =>
    runAction(
      "arrived",
      async () => {
        if (status === "helper_on_way") {
          await markHelperArrived({ bookingId: request.bookingId, requestId: request.id });
          await stopDriverLocationTracking();
        }
        await startHelp({ bookingId: request.bookingId, requestId: request.id });
      },
      "roadsideHelp.couldNotUpdateStatus",
    );

  const handleFinish = () => {
    if (!request.bookingId) {
      Alert.alert(t("common.error"), t("roadsideHelp.noLinkedBookingMessage"));
      return;
    }

    Alert.alert(
      t("roadsideHelp.finishedHelpTitle"),
      t("roadsideHelp.finishedHelpConfirm"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("roadsideHelp.yesFinished"),
          onPress: () =>
            runAction(
              "finish",
              () => finishRoadsideHelp(request.bookingId),
              "roadsideHelp.couldNotFinishHelp",
            ),
        },
      ],
    );
  };

  const handleOpenNavigation = async () => {
    if (typeof request.latitude !== "number" || typeof request.longitude !== "number") {
      Alert.alert(t("roadsideHelp.noLocationTitle"), t("roadsideHelp.noLocationMessage"));
      return;
    }

    const origin = await getCurrentPositionBestEffort();
    const url = buildDirectionsUrl(
      { latitude: request.latitude, longitude: request.longitude },
      origin,
    );

    Linking.openURL(url).catch(() =>
      Alert.alert(t("common.error"), t("roadsideHelp.couldNotOpenMaps")),
    );
  };

  const callPassenger = () => {
    if (!request.passengerPhone) return;
    Linking.openURL(`tel:${request.passengerPhone}`).catch(() =>
      Alert.alert(t("common.error"), t("roadsideHelp.couldNotStartCall")),
    );
  };

  const messagePassenger = async () => {
    if (!request.passengerId) return;
    try {
      const id = await openConversation({
        id: request.passengerId,
        name: request.passengerName,
        role: "passenger",
      });
      router.push({
        pathname: "/chat/[id]",
        params: { id, otherId: request.passengerId, otherName: request.passengerName },
      } as any);
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("messages.couldNotOpenChat"));
    }
  };

  const showDone = isCompleted || isCompletionPending || isCancelled;

  return (
    <View style={[styles.card, isCancelled && styles.cardCancelled, showDone && !isCancelled && styles.cardDone]}>
      <View style={styles.header}>
        <View
          style={[
            styles.iconBadge,
            (showDone || isCancelled) && styles.iconBadgeGreen,
          ]}
        >
          <Ionicons
            name={isPaid ? "cash" : isCancelled ? "close-circle" : "checkmark-done"}
            size={20}
            color={isCancelled ? "#B91C1C" : showDone ? "#16A34A" : "#F58220"}
          />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t("roadsideHelp.passengerAcceptedOffer")}</Text>
          <Text style={styles.subtitle}>{displayServiceType}</Text>
        </View>

        <View style={styles.headerActions}>
          <View style={[styles.badge, isCancelled ? styles.badgeRed : badgeStyle]}>
            <Text style={styles.badgeText}>
              {isCancelled ? t("roadsideHelp.badgeCancelled") : badgeLabel}
            </Text>
          </View>

          {onDelete ? (
            <Pressable style={styles.deleteButton} onPress={onDelete} hitSlop={8}>
              <Ionicons name="trash-outline" size={18} color="#B91C1C" />
            </Pressable>
          ) : null}
        </View>
      </View>

      {request.description ? (
        <Text style={styles.description}>{request.description}</Text>
      ) : null}

      <View style={styles.infoRow}>
        <Ionicons name="person-outline" size={16} color="#7C5F46" />
        <Text style={styles.infoText}>{request.passengerName}</Text>
      </View>

      <View style={styles.contactRow}>
        {request.passengerPhone ? (
          <Pressable style={styles.contactButton} onPress={callPassenger}>
            <Ionicons name="call-outline" size={16} color="#F58220" />
            <Text style={[styles.contactButtonText, ltrContentStyle]}>
              {request.passengerPhone}
            </Text>
          </Pressable>
        ) : null}

        <Pressable style={styles.contactButton} onPress={messagePassenger}>
          <Ionicons name="chatbubble-outline" size={16} color="#F58220" />
          <Text style={styles.contactButtonText}>{t("roadsideHelp.messageButton")}</Text>
        </Pressable>
      </View>

      {request.address ? (
        <View style={styles.infoRow}>
          <Ionicons name="location-outline" size={16} color="#7C5F46" />
          <Text style={styles.infoText}>{request.address}</Text>
        </View>
      ) : null}

      <View style={styles.metaRow}>
        {typeof request.agreedPrice === "number" ? (
          <View style={styles.metaItem}>
            <Ionicons name="cash-outline" size={16} color="#F58220" />
            <Text style={styles.metaText}>{request.agreedPrice} ₪</Text>
          </View>
        ) : null}

        {typeof request.estimatedArrivalMinutes === "number" ? (
          <View style={styles.metaItem}>
            <Ionicons name="time-outline" size={16} color="#F58220" />
            <Text style={styles.metaText}>
              {request.estimatedArrivalMinutes} min
            </Text>
          </View>
        ) : null}

        {request.paymentMethod ? (
          <View style={styles.metaItem}>
            <Ionicons
              name={request.paymentMethod === "cash" ? "cash-outline" : "phone-portrait-outline"}
              size={16}
              color="#7C5F46"
            />
            <Text style={styles.metaTextMuted}>
              {request.paymentMethod === "cash" ? t("common.cash") : t("roadsideHelp.payWithBit")}
            </Text>
          </View>
        ) : null}
      </View>

      {isCancelled ? (
        <View style={[styles.statusBanner, styles.statusBannerRed]}>
          <Ionicons name="close-circle-outline" size={18} color="#B91C1C" />
          <Text style={[styles.statusBannerText, styles.statusBannerTextRed]}>
            {t("roadsideHelp.requestCancelledMessage")}
          </Text>
        </View>
      ) : isPaid ? (
        <View style={[styles.statusBanner, styles.statusBannerGreen]}>
          <Ionicons name="checkmark-done-circle" size={18} color="#16A34A" />
          <Text style={[styles.statusBannerText, styles.statusBannerTextGreen]}>
            {t("roadsideHelp.paymentReceivedAmount", {
              amount: request.paidAmount ?? request.agreedPrice ?? 0,
            })}
          </Text>
        </View>
      ) : isCompleted && request.paymentMethod === "bit" ? (
        <View style={styles.statusBanner}>
          <Ionicons name="time-outline" size={18} color="#B86115" />
          <Text style={styles.statusBannerText}>{t("roadsideHelp.waitingForBitPayment")}</Text>
        </View>
      ) : isCompletionPending ? (
        <View style={styles.statusBanner}>
          <Ionicons name="time-outline" size={18} color="#B86115" />
          <Text style={styles.statusBannerText}>
            {t("roadsideHelp.waitingForPassengerConfirmation")}
          </Text>
        </View>
      ) : null}

      {!showDone && !isCancelled ? (
        <View style={styles.actionsColumn}>
          {isHelperAssigned ? (
            <Pressable
              style={[styles.primaryButtonFull, busyAction && styles.buttonDisabled]}
              onPress={handleStartDriving}
              disabled={!!busyAction}
            >
              {busyAction === "start_driving" ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="navigate" size={18} color="#FFFFFF" />
                  <Text style={styles.primaryText}>{t("roadsideHelp.startDrivingButton")}</Text>
                </>
              )}
            </Pressable>
          ) : null}

          {isHelperOnWay ? (
            <>
              <Pressable style={styles.secondaryButtonFull} onPress={handleOpenNavigation}>
                <Ionicons name="map-outline" size={18} color="#F58220" />
                <Text style={styles.secondaryButtonText}>{t("roadsideHelp.openNavigation")}</Text>
              </Pressable>

              <Pressable
                style={[styles.primaryButtonFull, busyAction && styles.buttonDisabled]}
                onPress={handleArrived}
                disabled={!!busyAction}
              >
                {busyAction === "arrived" ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="flag" size={18} color="#FFFFFF" />
                    <Text style={styles.primaryText}>{t("roadsideHelp.iveArrivedButton")}</Text>
                  </>
                )}
              </Pressable>
            </>
          ) : null}

          {/* Only ever visible if the "arrived" write above succeeded but
              the immediately-following "start help" write failed (e.g. a
              dropped connection) — the normal path never leaves the driver
              sitting on this stage long enough to see it. */}
          {isArrived ? (
            <Pressable
              style={[styles.primaryButtonFull, busyAction && styles.buttonDisabled]}
              onPress={handleArrived}
              disabled={!!busyAction}
            >
              {busyAction === "arrived" ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="construct" size={18} color="#FFFFFF" />
                  <Text style={styles.primaryText}>{t("roadsideHelp.startHelpButton")}</Text>
                </>
              )}
            </Pressable>
          ) : null}

          {isInProgress ? (
            <Pressable
              style={[styles.finishButton, busyAction && styles.buttonDisabled]}
              onPress={handleFinish}
              disabled={!!busyAction}
            >
              {busyAction === "finish" ? (
                <ActivityIndicator color="#166534" />
              ) : (
                <>
                  <Ionicons name="checkmark-done" size={18} color="#166534" />
                  <Text style={styles.finishButtonText}>{t("roadsideHelp.finishedHelpButton")}</Text>
                </>
              )}
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#BBE7C6",
    borderRadius: 20,
    padding: 18,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 2,
  },
  cardDone: {
    borderColor: "#E7DCD1",
  },
  cardCancelled: {
    borderColor: "#F3C6C6",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
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
  title: {
    fontSize: 16,
    fontWeight: "900",
    color: "#111827",
  },
  subtitle: {
    color: "#7C5F46",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  deleteButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeOrange: {
    backgroundColor: "#F58220",
  },
  badgeBlue: {
    backgroundColor: "#2563EB",
  },
  badgeGreen: {
    backgroundColor: "#16A34A",
  },
  badgeRed: {
    backgroundColor: "#B91C1C",
  },
  badgeText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 12,
  },
  description: {
    color: "#3C2319",
    fontSize: 13.5,
    marginBottom: 10,
    lineHeight: 19,
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
  contactRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  contactButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFF8F2",
    borderWidth: 1,
    borderColor: "#F7D3B4",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  contactButtonText: {
    color: "#F58220",
    fontSize: 13,
    fontWeight: "800",
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
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
  metaTextMuted: {
    fontSize: 13,
    fontWeight: "800",
    color: "#7C5F46",
  },
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFF2E8",
    borderRadius: 12,
    padding: 12,
  },
  statusBannerGreen: {
    backgroundColor: "#E7F7EC",
  },
  statusBannerRed: {
    backgroundColor: "#FEE2E2",
  },
  statusBannerText: {
    color: "#B86115",
    fontWeight: "800",
    fontSize: 14,
    flexShrink: 1,
  },
  statusBannerTextGreen: {
    color: "#166534",
  },
  statusBannerTextRed: {
    color: "#B91C1C",
  },
  actionsColumn: {
    gap: 10,
    marginTop: 4,
  },
  primaryButtonFull: {
    backgroundColor: "#16A34A",
    borderRadius: 14,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
  },
  secondaryButtonFull: {
    borderWidth: 1.5,
    borderColor: "#F7D3B4",
    backgroundColor: "#FFF8F2",
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  secondaryButtonText: {
    color: "#F58220",
    fontWeight: "900",
    fontSize: 15,
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
  },
  finishButtonText: {
    color: "#166534",
    fontWeight: "900",
    fontSize: 15,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
