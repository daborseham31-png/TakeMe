// ---------------------------------------------------------------------------
// Shared "Passenger accepted your offer" card — used identically by:
//   - app/driver/help-requests.tsx
//   - app/(tabs)/bookings.tsx (Driver tab)
//
// Both screens subscribe to `roadsideRequests` with their own onSnapshot
// listener and pass the normalized record down as a plain prop, so this
// component is the ONE place status/action logic for an accepted Roadside
// Help request lives. There is no local status state here beyond a
// short-lived "busy" flag for the Finished Help button — every real status
// change comes from Firestore and flows back down through the parent's
// listener, so both screens always agree.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { translateProblemTypesList } from "../../i18n/formatters";
import {
  buildDirectionsUrl,
  finishRoadsideHelp,
  getCurrentPositionBestEffort,
  markDriverOnTheWay,
  RoadsideRequestRecord,
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
  const [busy, setBusy] = useState(false);

  const isOnTheWay = request.status === "driver_on_the_way";
  const isPaid = request.paymentStatus === "paid";
  const isCompletedUnpaid =
    !isPaid &&
    (request.status === "completed" || request.status === "completed_paid");
  const showActionButtons = !isCompletedUnpaid && !isPaid;

  const badgeLabel = isPaid
    ? t("roadsideHelp.badgeCompleted")
    : isCompletedUnpaid
      ? t("roadsideHelp.badgeCompleted")
      : isOnTheWay
        ? t("roadsideHelp.badgeOnTheWay")
        : t("roadsideHelp.badgeAccepted");

  const displayServiceType =
    request.problemTypes.length > 0
      ? translateProblemTypesList(request.problemTypes, t)
      : request.serviceType || t("rideCategory.categories.help.title");

  const badgeStyle =
    isPaid || isCompletedUnpaid
      ? styles.badgeGreen
      : isOnTheWay
        ? styles.badgeBlue
        : styles.badgeOrange;

  const handleGoHelp = async () => {
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

    if (request.status === "accepted") {
      markDriverOnTheWay({
        bookingId: request.bookingId,
        requestId: request.id,
      }).catch(() => {});
    }
  };

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
          onPress: async () => {
            try {
              setBusy(true);
              await finishRoadsideHelp(request.bookingId);
            } catch (error: any) {
              Alert.alert(
                t("common.error"),
                error?.message || t("roadsideHelp.couldNotFinishHelp"),
              );
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const callPassenger = () => {
    if (!request.passengerPhone) return;
    Linking.openURL(`tel:${request.passengerPhone}`).catch(() =>
      Alert.alert(t("common.error"), t("roadsideHelp.couldNotStartCall")),
    );
  };

  return (
    <View style={[styles.card, !showActionButtons && styles.cardDone]}>
      <View style={styles.header}>
        <View
          style={[styles.iconBadge, !showActionButtons && styles.iconBadgeGreen]}
        >
          <Ionicons
            name={isPaid ? "cash" : "checkmark-done"}
            size={20}
            color={!showActionButtons ? "#16A34A" : "#F58220"}
          />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t("roadsideHelp.passengerAcceptedOffer")}</Text>
          <Text style={styles.subtitle}>{displayServiceType}</Text>
        </View>

        <View style={styles.headerActions}>
          <View style={[styles.badge, badgeStyle]}>
            <Text style={styles.badgeText}>{badgeLabel}</Text>
          </View>

          {onDelete ? (
            <Pressable style={styles.deleteButton} onPress={onDelete} hitSlop={8}>
              <Ionicons name="trash-outline" size={18} color="#B91C1C" />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.infoRow}>
        <Ionicons name="person-outline" size={16} color="#7C5F46" />
        <Text style={styles.infoText}>{request.passengerName}</Text>
      </View>

      {request.passengerPhone ? (
        <Pressable style={styles.infoRow} onPress={callPassenger}>
          <Ionicons name="call-outline" size={16} color="#F58220" />
          <Text style={[styles.infoText, styles.phoneText]}>
            {request.passengerPhone}
          </Text>
        </Pressable>
      ) : null}

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
      </View>

      {isPaid ? (
        <View style={[styles.statusBanner, styles.statusBannerGreen]}>
          <Ionicons name="checkmark-done-circle" size={18} color="#16A34A" />
          <Text style={[styles.statusBannerText, styles.statusBannerTextGreen]}>
            {t("roadsideHelp.paymentReceivedAmount", {
              amount: request.paidAmount ?? request.agreedPrice ?? 0,
            })}
          </Text>
        </View>
      ) : isCompletedUnpaid ? (
        <View style={styles.statusBanner}>
          <Ionicons name="time-outline" size={18} color="#B86115" />
          <Text style={styles.statusBannerText}>
            {t("roadsideHelp.waitingForPassengerPayment")}
          </Text>
        </View>
      ) : (
        <>
          <Pressable style={styles.primaryButtonFull} onPress={handleGoHelp}>
            <Ionicons name="navigate" size={18} color="#FFFFFF" />
            <Text style={styles.primaryText}>
              {isOnTheWay ? t("roadsideHelp.openNavigation") : t("roadsideHelp.goHelpPassenger")}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.finishButton, busy && styles.buttonDisabled]}
            onPress={handleFinish}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#166534" />
            ) : (
              <>
                <Ionicons name="checkmark-done" size={18} color="#166534" />
                <Text style={styles.finishButtonText}>{t("roadsideHelp.finishedHelpButton")}</Text>
              </>
            )}
          </Pressable>
        </>
      )}
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
  badgeText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 12,
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
  statusBannerText: {
    color: "#B86115",
    fontWeight: "800",
    fontSize: 14,
    flexShrink: 1,
  },
  statusBannerTextGreen: {
    color: "#166534",
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
  primaryText: {
    color: "#FFFFFF",
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
});
