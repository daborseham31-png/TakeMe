// ---------------------------------------------------------------------------
// "New" school trips section for My Bookings (AGENTS.md #10) — deliberately
// a SEPARATE, self-contained block (own Firestore subscriptions, own
// rendering) rather than merged into bookings.tsx's existing CombinedRow
// union. That union is deeply tied to the legacy driverRoutes/bookings
// shape (ride/booking/trip/application `_kind`s, live-tracking, rating
// flows) — bolting a fifth shape onto it risked regressing a screen every
// category depends on. This section is rendered inline on both the
// passenger and driver tabs of app/(tabs)/bookings.tsx, additive only.
//
// Passenger view: every schoolBookings doc for this user, grouped by
// bookingGroupId ("School booking — Round trip" when a group has both an
// outbound and a return leg — AGENTS.md #10), each leg still individually
// manageable (its own Cancel button, own status). Plus a "Waiting for a
// ride" list of this user's active rideRequests (AGENTS.md #7/#16 — cancel a
// waiting request).
//
// Trip lifecycle (start → on the way → arrived → live tracking → rating):
// reuses the EXACT same screens Personal Ride already has —
// app/driver/ride-navigation.tsx and app/booking/live-tracking.tsx, via a
// `source=schoolTrips` param — never a second navigation/tracking screen.
// A school trip is one car shared by several independent SchoolBooking
// docs, so tripStatus/trackingEnabled/driverLocation live on the SchoolTrip
// itself; each booking carries a synced mirror of tripStatus/trackingEnabled
// so a passenger's own card (and rating eligibility) reads from one
// subscription — see schoolTripsLib.ts's SchoolTrip/SchoolBooking comments
// and ride-navigation.tsx's updateSchoolTripStatus. Rating itself is a
// small, self-contained modal here (same reasoning as this whole file being
// separate from bookings.tsx's shared one).
//
// Driver view: every schoolTrips doc this driver created, each with its own
// Cancel button — cancelling one leg never touches its linked trip
// (AGENTS.md #12, edge cases #3/#4) — plus a Start/Continue Trip button.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import {
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { db } from "../../../firebase";
import { canStartTrip, getStartTripBlockedReason } from "../bookingsLib";
import {
  cancelRideRequest,
  cancelSchoolBooking,
  cancelSchoolTrip,
  normalizeSchoolBooking,
  normalizeSchoolTrip,
  RideRequest,
  SCHOOL_BOOKINGS_COLLECTION,
  SCHOOL_TRIPS_COLLECTION,
  schoolTripDirectionLabel,
  SchoolBooking,
  SchoolTrip,
  subscribeMyRideRequests,
  submitSchoolBookingRating,
} from "../schoolTripsLib";

type Props = {
  tab: "passenger" | "driver";
  uid: string | null;
};

const directionLabel = schoolTripDirectionLabel;

// Same status vocabulary/keys as app/booking/live-tracking.tsx's
// getStatusKey — one shared meaning for "driver_on_way" etc. everywhere in
// the app, never a second set of status strings.
const trackingStatusKey = (status: SchoolBooking["tripStatus"] | SchoolTrip["tripStatus"]) => {
  if (status === "driver_on_way") return "rides.driverOnWay";
  if (status === "arrived_pickup") return "rides.driverArrivedPickup";
  if (status === "in_progress") return "rides.tripInProgress";
  if (status === "completed") return "rides.tripCompleted";
  return "rides.waitingForDriver";
};

export default function MySchoolTripsSection({ tab, uid }: Props) {
  const { t } = useTranslation();

  const [bookings, setBookings] = useState<SchoolBooking[]>([]);
  const [trips, setTrips] = useState<SchoolTrip[]>([]);
  const [rideRequests, setRideRequests] = useState<RideRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [ratingBooking, setRatingBooking] = useState<SchoolBooking | null>(null);
  const [ratingStars, setRatingStars] = useState(0);
  const [ratingComment, setRatingComment] = useState("");
  const [ratingSubmitting, setRatingSubmitting] = useState(false);

  const [cancelTripTarget, setCancelTripTarget] = useState<SchoolTrip | null>(null);
  const [cancelReasonInput, setCancelReasonInput] = useState("");
  const [cancelSubmitting, setCancelSubmitting] = useState(false);

  useEffect(() => {
    if (!uid) {
      setBookings([]);
      setTrips([]);
      setRideRequests([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const unsubs: (() => void)[] = [];

    if (tab === "passenger") {
      unsubs.push(
        onSnapshot(
          query(collection(db, SCHOOL_BOOKINGS_COLLECTION), where("passengerId", "==", uid)),
          (snap) => {
            setBookings(
              snap.docs
                .map((d) => normalizeSchoolBooking(d.id, d.data()))
                .filter((b) => !b.deletedForPassenger),
            );
            setLoading(false);
          },
          () => setLoading(false),
        ),
      );

      unsubs.push(subscribeMyRideRequests(setRideRequests));
      setTrips([]);
    } else {
      unsubs.push(
        onSnapshot(
          query(collection(db, SCHOOL_TRIPS_COLLECTION), where("driverId", "==", uid)),
          (snap) => {
            setTrips(
              snap.docs
                .map((d) => normalizeSchoolTrip(d.id, d.data()))
                .filter((tr) => tr.status !== "cancelled"),
            );
            setLoading(false);
          },
          () => setLoading(false),
        ),
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, SCHOOL_BOOKINGS_COLLECTION), where("driverId", "==", uid)),
          (snap) => {
            setBookings(
              snap.docs
                .map((d) => normalizeSchoolBooking(d.id, d.data()))
                .filter((b) => !b.deletedForDriver),
            );
          },
          (error) => {
            console.log("Listener failed:", {
              feature: "MySchoolTripsSection.driverBookings",
              collection: SCHOOL_BOOKINGS_COLLECTION,
              userId: uid,
              code: error.code,
              message: error.message,
            });
            setBookings([]);
          },
        ),
      );
      setRideRequests([]);
    }

    return () => unsubs.forEach((unsub) => unsub());
  }, [tab, uid]);

  const groupedPassengerBookings = useMemo(() => {
    if (tab !== "passenger") return [];

    const groups = new Map<string, SchoolBooking[]>();
    bookings.forEach((booking) => {
      const key = booking.bookingGroupId || booking.id;
      groups.set(key, [...(groups.get(key) || []), booking]);
    });

    return Array.from(groups.entries())
      .map(([groupId, legs]) => ({
        groupId,
        legs: legs.sort((a, b) => (a.departureTime < b.departureTime ? -1 : 1)),
      }))
      .sort((a, b) => (a.legs[0]?.date < b.legs[0]?.date ? -1 : 1));
  }, [bookings, tab]);

  const handleCancelBooking = (booking: SchoolBooking) => {
    if (booking.status !== "booked") return;

    Alert.alert(t("booking.cancelBookingTitle"), t("booking.cancelBookingConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("booking.cancelBookingTitle"),
        style: "destructive",
        onPress: async () => {
          setBusyId(booking.id);
          try {
            await cancelSchoolBooking(booking.id);
          } catch (error: any) {
            Alert.alert(t("common.error"), error?.message || t("errors.generic"));
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  // A trip with no active bookings cancels with the original plain confirm
  // (no passenger is affected, no reason needed). A trip WITH bookings
  // requires a reason and shows how many passengers are affected — see the
  // cancel-with-reason modal below; the reason is stamped onto the trip
  // doc and read server-side by the onSchoolTripCancelled Cloud Function to
  // search for replacement trips for those passengers (AGENTS.md).
  const handleCancelTrip = (trip: SchoolTrip) => {
    const affectedCount = bookings.filter(
      (b) => b.tripId === trip.id && b.status === "booked",
    ).length;

    if (affectedCount === 0) {
      Alert.alert(t("booking.cancelBookingTitle"), t("schoolTrip.cancelTripConfirm"), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("booking.cancelBookingTitle"),
          style: "destructive",
          onPress: async () => {
            setBusyId(trip.id);
            try {
              await cancelSchoolTrip(trip.id);
            } catch (error: any) {
              Alert.alert(t("common.error"), error?.message || t("errors.generic"));
            } finally {
              setBusyId(null);
            }
          },
        },
      ]);
      return;
    }

    setCancelTripTarget(trip);
    setCancelReasonInput("");
  };

  const closeCancelTripModal = () => {
    setCancelTripTarget(null);
    setCancelReasonInput("");
  };

  const confirmCancelTripWithReason = async () => {
    if (!cancelTripTarget || !cancelReasonInput.trim() || cancelSubmitting) return;

    setCancelSubmitting(true);
    try {
      await cancelSchoolTrip(cancelTripTarget.id, cancelReasonInput.trim());
      closeCancelTripModal();
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("errors.generic"));
    } finally {
      setCancelSubmitting(false);
    }
  };

  const handleCancelRequest = (request: RideRequest) => {
    Alert.alert(t("schoolTrip.cancelWaitingRequestTitle"), t("schoolTrip.cancelWaitingRequestConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("booking.cancelBookingTitle"),
        style: "destructive",
        onPress: async () => {
          setBusyId(request.id);
          try {
            await cancelRideRequest(request.id);
          } catch (error: any) {
            Alert.alert(t("common.error"), error?.message || t("errors.generic"));
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  const handleStartOrContinueTrip = (trip: SchoolTrip) => {
    if (trip.tripStatus === "booked" && !canStartTrip(trip)) {
      Alert.alert(
        t("booking.notAvailableYetTitle"),
        getStartTripBlockedReason(trip) || t("booking.startTripOnlyOnTripDate"),
      );
      return;
    }

    router.push({
      pathname: "/driver/ride-navigation",
      params: { id: trip.id, source: "schoolTrips" },
    } as any);
  };

  const handleTrackDriver = (booking: SchoolBooking) => {
    router.push({
      pathname: "/booking/live-tracking",
      params: { id: booking.tripId, source: "schoolTrips" },
    } as any);
  };

  const openRatingModal = (booking: SchoolBooking) => {
    setRatingBooking(booking);
    setRatingStars(0);
    setRatingComment("");
  };

  const closeRatingModal = () => {
    setRatingBooking(null);
    setRatingStars(0);
    setRatingComment("");
  };

  const submitRating = async () => {
    if (!ratingBooking || ratingStars === 0 || ratingSubmitting) return;

    setRatingSubmitting(true);
    try {
      await submitSchoolBookingRating(ratingBooking.id, ratingBooking, ratingStars, ratingComment);
      closeRatingModal();
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("errors.generic"));
    } finally {
      setRatingSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator size="small" color="#F58220" />
      </View>
    );
  }

  const visibleRequests = rideRequests.filter(
    (r) => r.status === "waiting" || r.status === "matched",
  );

  const hasContent =
    tab === "passenger"
      ? groupedPassengerBookings.length > 0 || visibleRequests.length > 0
      : trips.length > 0 || bookings.length > 0;

  if (!hasContent) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <Ionicons name="school" size={16} color="#F58220" />
        <Text style={styles.sectionHeaderText}>{t("schoolTrip.mySchoolTripsSection")}</Text>
      </View>

      {tab === "passenger" &&
        groupedPassengerBookings.map((group) => (
          <View key={group.groupId} style={styles.groupCard}>
            {group.legs.length > 1 ? (
              <Text style={styles.groupTitle}>{t("schoolTrip.roundTripGroupTitle")}</Text>
            ) : null}

            {group.legs.map((booking) => {
              // Per-child labeling (AGENTS.md #3's My Bookings requirement)
              // — an outbound leg shared by several children shows who's
              // riding it; a return leg always shows the ONE child it was
              // booked for. Plain, pre-existing bookings with neither field
              // (seats-only) show nothing extra here — unchanged look.
              const childNames = (booking.childEntries || [])
                .map((c) => c.childName)
                .filter((name): name is string => Boolean(name));
              const childSummary =
                booking.childEntries && booking.childEntries.length > 0
                  ? t("schoolTrip.childrenRidingCount", { count: booking.childEntries.length }) +
                    (childNames.length > 0 ? `: ${childNames.join(", ")}` : "")
                  : booking.childEntryId
                    ? t("schoolTrip.returnForChild", {
                        child: booking.childName || t("schoolTrip.childNumber", { number: 1 }),
                      })
                    : null;

              // Live Tracking only once this exact booking's own trip has
              // actually started (a correct passenger code moved it from
              // "arrived_pickup" to "in_progress" — see
              // verifyPassengerCodeAndStartTrip in schoolTripsLib.ts).
              // Never during booked/driver_on_way/arrived_pickup/completed.
              const canTrack = booking.tripStatus === "in_progress";
              const needsRating =
                booking.status === "completed" &&
                booking.tripStatus === "completed" &&
                booking.completedAtSeconds > 0 &&
                booking.needsPassengerRating &&
                !booking.ratingSubmitted;
              const showVerificationCode =
                booking.status === "booked" &&
                booking.verificationStatus === "pending" &&
                !!booking.verificationCode;
              const needsReplacement =
                booking.bookingStatus === "replacement_pending" ||
                booking.bookingStatus === "replacement_offered";

              return (
                <View key={booking.id} style={styles.legCard}>
                  <View style={styles.legHeader}>
                    <View
                      style={[
                        styles.badge,
                        booking.bookingDirection === "to_school"
                          ? styles.badgeOutbound
                          : styles.badgeReturn,
                      ]}
                    >
                      <Text style={styles.badgeText}>
                        {directionLabel(t, booking.bookingDirection)}
                      </Text>
                    </View>
                    <Text style={styles.statusText}>
                      {booking.status === "cancelled"
                        ? t("booking.cancelBookingTitle")
                        : t(trackingStatusKey(booking.tripStatus))}
                    </Text>
                  </View>

                  <Text style={styles.routeText}>
                    {booking.fromAddress} → {booking.toAddress}
                  </Text>
                  <Text style={styles.metaText}>
                    {booking.date} · {booking.departureTime} · {booking.schoolName}
                  </Text>
                  <Text style={styles.metaText}>
                    {t("driver.driverLabel", { defaultValue: "Driver" })}: {booking.driverName} ·{" "}
                    {booking.seats} {t("schoolTrip.seatWord")} · {booking.totalPrice} ₪
                  </Text>
                  {booking.car || booking.carColor || booking.carPlate ? (
                    <Text style={styles.metaText}>
                      <Ionicons name="car-outline" size={12} color="#7C5F46" />{" "}
                      {[booking.car, booking.carColor].filter(Boolean).join(" · ")}
                      {booking.carPlate ? (
                        <Text style={styles.ltrText}> · {booking.carPlate}</Text>
                      ) : null}
                    </Text>
                  ) : null}
                  {childSummary ? <Text style={styles.childSummaryText}>{childSummary}</Text> : null}

                  {needsReplacement ? (
                    <View style={styles.replacementBanner}>
                      <Ionicons name="alert-circle-outline" size={16} color="#B91C1C" />
                      <Text style={styles.replacementBannerText}>
                        {booking.bookingStatus === "replacement_offered"
                          ? t("booking.replacementOffersAvailable")
                          : t("booking.replacementSearching")}
                      </Text>
                      <Pressable
                        onPress={() =>
                          router.push({
                            pathname: "/booking/school/replacement-offer",
                            params: { originalBookingId: booking.id },
                          } as any)
                        }
                      >
                        <Text style={styles.replacementBannerLink}>{t("booking.reviewOffers")}</Text>
                      </Pressable>
                    </View>
                  ) : null}

                  {showVerificationCode ? (
                    <View style={styles.verificationCodeBox}>
                      <Text style={styles.verificationCodeLabel}>{t("booking.verificationCode")}</Text>
                      <Text style={styles.verificationCodeValue}>{booking.verificationCode}</Text>
                      <Text style={styles.verificationCodeHint}>{t("booking.giveCodeToDriver")}</Text>
                    </View>
                  ) : null}

                  {canTrack ? (
                    <Pressable style={styles.trackButton} onPress={() => handleTrackDriver(booking)}>
                      <Ionicons name="navigate-outline" size={14} color="#FFFFFF" />
                      <Text style={styles.trackButtonText}>{t("rides.liveTracking")}</Text>
                    </Pressable>
                  ) : null}

                  {needsRating ? (
                    <Pressable style={styles.rateButton} onPress={() => openRatingModal(booking)}>
                      <Ionicons name="star-outline" size={14} color="#F58220" />
                      <Text style={styles.rateButtonText}>{t("schoolTrip.rateDriverButton")}</Text>
                    </Pressable>
                  ) : null}

                  {booking.status === "booked" ? (
                    <Pressable
                      style={[styles.cancelButton, busyId === booking.id && { opacity: 0.6 }]}
                      onPress={() => handleCancelBooking(booking)}
                      disabled={busyId === booking.id}
                    >
                      <Text style={styles.cancelButtonText}>{t("booking.cancelBookingLink")}</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}

            {(() => {
              // Children riding the outbound leg who have NO matching return
              // booking anywhere in this group — shown as an explicit "No
              // return ride" line rather than silently omitted (AGENTS.md
              // #3's "own time/driver, or 'No return ride needed'").
              const outboundLeg = group.legs.find((b) => b.bookingDirection === "to_school");
              const childrenWithoutReturn = (outboundLeg?.childEntries || []).filter(
                (child) =>
                  !group.legs.some(
                    (b) => b.bookingDirection === "from_school" && b.childEntryId === child.localId,
                  ),
              );

              if (childrenWithoutReturn.length === 0) return null;

              return (
                <View style={styles.noReturnRow}>
                  {childrenWithoutReturn.map((child, index) => (
                    <Text key={child.localId} style={styles.noReturnRowText}>
                      {(child.childName || t("schoolTrip.childNumber", { number: index + 1 })) +
                        ": " +
                        t("schoolTrip.noReturnNeeded")}
                    </Text>
                  ))}
                </View>
              );
            })()}
          </View>
        ))}

      {tab === "passenger" &&
        visibleRequests.map((request) => (
          <View key={request.id} style={styles.legCard}>
            <View style={styles.legHeader}>
              <View style={[styles.badge, styles.badgeWaiting]}>
                <Ionicons name="hourglass-outline" size={12} color="#B86115" />
                <Text style={styles.badgeText}>{t("schoolTrip.waitingBadge")}</Text>
              </View>
            </View>
            <Text style={styles.routeText}>
              {request.schoolName} → {request.toArea}
            </Text>
            <Text style={styles.metaText}>
              {request.requestedDate} · {request.requestedTime} · {request.seats}{" "}
              {t("schoolTrip.seatWord")}
            </Text>

            <Pressable
              style={[styles.cancelButton, busyId === request.id && { opacity: 0.6 }]}
              onPress={() => handleCancelRequest(request)}
              disabled={busyId === request.id}
            >
              <Text style={styles.cancelButtonText}>{t("schoolTrip.cancelWaitingRequestTitle")}</Text>
            </Pressable>
          </View>
        ))}

      {tab === "driver" &&
        trips.map((trip) => {
          const canStart = canStartTrip(trip);
          const blockedReason = getStartTripBlockedReason(trip);
          const showLifecycleButton = trip.status !== "cancelled" && trip.status !== "completed";

          return (
            <View key={trip.id} style={styles.legCard}>
              <View style={styles.legHeader}>
                <View
                  style={[
                    styles.badge,
                    trip.direction === "to_school" ? styles.badgeOutbound : styles.badgeReturn,
                  ]}
                >
                  <Text style={styles.badgeText}>{directionLabel(t, trip.direction)}</Text>
                </View>
                <Text style={styles.statusText}>{trip.status}</Text>
              </View>

              <Text style={styles.routeText}>
                {trip.fromAddress} → {trip.toAddress}
              </Text>
              <Text style={styles.metaText}>
                {trip.date} · {trip.departureTime} · {trip.schoolName}
              </Text>
              <Text style={styles.metaText}>
                {trip.availableSeats}/{trip.totalSeats} {t("schoolTrip.seatsLeft")} ·{" "}
                {trip.pricePerSeat} ₪
              </Text>
              {trip.tripStatus !== "booked" && trip.tripStatus !== "completed" ? (
                <Text style={styles.childSummaryText}>{t(trackingStatusKey(trip.tripStatus))}</Text>
              ) : null}

              {showLifecycleButton ? (
                <>
                  <Pressable
                    style={[styles.startButton, trip.tripStatus === "booked" && !canStart && { opacity: 0.5 }]}
                    onPress={() => handleStartOrContinueTrip(trip)}
                  >
                    <Ionicons name="navigate-outline" size={14} color="#FFFFFF" />
                    <Text style={styles.startButtonText}>
                      {trip.tripStatus === "booked"
                        ? t("schoolTrip.startTripButton")
                        : t("schoolTrip.continueTripButton")}
                    </Text>
                  </Pressable>

                  {trip.tripStatus === "booked" && !canStart && blockedReason ? (
                    <Text style={styles.noReturnRowText}>{blockedReason}</Text>
                  ) : null}
                </>
              ) : null}

              {trip.status === "active" || trip.status === "full" ? (
                <Pressable
                  style={[styles.cancelButton, busyId === trip.id && { opacity: 0.6 }]}
                  onPress={() => handleCancelTrip(trip)}
                  disabled={busyId === trip.id}
                >
                  <Text style={styles.cancelButtonText}>{t("schoolTrip.cancelTripButton")}</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}

      <Modal visible={!!ratingBooking} animationType="fade" transparent onRequestClose={closeRatingModal}>
        <View style={styles.ratingOverlay}>
          <View style={styles.ratingSheet}>
            <Text style={styles.ratingTitle}>{t("booking.arrivedSafelyTitle")}</Text>
            <Text style={styles.ratingSubtitle}>{t("booking.rateYourDriverSubtitle")}</Text>

            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable key={n} onPress={() => setRatingStars(n)} hitSlop={6}>
                  <Ionicons
                    name={n <= ratingStars ? "star" : "star-outline"}
                    size={32}
                    color="#F58220"
                  />
                </Pressable>
              ))}
            </View>

            <TextInput
              style={styles.commentInput}
              placeholder={t("booking.leaveCommentOptional")}
              placeholderTextColor="#8B7B6B"
              value={ratingComment}
              onChangeText={setRatingComment}
              multiline
            />

            <Pressable
              style={[styles.ratingSubmitButton, (ratingStars === 0 || ratingSubmitting) && { opacity: 0.5 }]}
              onPress={submitRating}
              disabled={ratingStars === 0 || ratingSubmitting}
            >
              {ratingSubmitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.ratingSubmitText}>{t("booking.submitRatingButton")}</Text>
              )}
            </Pressable>

            <Pressable style={styles.ratingCancelButton} onPress={closeRatingModal}>
              <Text style={styles.ratingCancelText}>{t("common.cancel")}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!cancelTripTarget}
        animationType="fade"
        transparent
        onRequestClose={closeCancelTripModal}
      >
        <View style={styles.ratingOverlay}>
          <View style={styles.ratingSheet}>
            <Ionicons name="warning-outline" size={32} color="#B91C1C" />
            <Text style={styles.ratingTitle}>{t("schoolTrip.cancelTripButton")}</Text>
            <Text style={styles.ratingSubtitle}>
              {t("schoolTrip.cancelTripAffectedWarning", {
                count: cancelTripTarget
                  ? bookings.filter((b) => b.tripId === cancelTripTarget.id && b.status === "booked").length
                  : 0,
              })}
            </Text>

            <TextInput
              style={styles.commentInput}
              placeholder={t("schoolTrip.cancellationReasonPlaceholder")}
              placeholderTextColor="#8B7B6B"
              value={cancelReasonInput}
              onChangeText={setCancelReasonInput}
              multiline
            />

            <Pressable
              style={[
                styles.ratingSubmitButton,
                (!cancelReasonInput.trim() || cancelSubmitting) && { opacity: 0.5 },
              ]}
              onPress={confirmCancelTripWithReason}
              disabled={!cancelReasonInput.trim() || cancelSubmitting}
            >
              {cancelSubmitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.ratingSubmitText}>{t("schoolTrip.cancelTripButton")}</Text>
              )}
            </Pressable>

            <Pressable style={styles.ratingCancelButton} onPress={closeCancelTripModal}>
              <Text style={styles.ratingCancelText}>{t("common.cancel")}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingBox: { paddingVertical: 16, alignItems: "center" },
  section: { marginBottom: 18 },
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  sectionHeaderText: { fontWeight: "900", color: "#111827", fontSize: 14 },
  groupCard: {
    backgroundColor: "#FFF8F2",
    borderWidth: 1,
    borderColor: "#FFE2C5",
    borderRadius: 16,
    padding: 10,
    marginBottom: 12,
  },
  groupTitle: {
    fontWeight: "900",
    color: "#F58220",
    fontSize: 12.5,
    marginBottom: 8,
    marginLeft: 4,
    textTransform: "uppercase",
  },
  legCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  legHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeOutbound: { backgroundColor: "#DBEAFE" },
  badgeReturn: { backgroundColor: "#DCFCE7" },
  badgeWaiting: { backgroundColor: "#FEF3C7" },
  badgeText: { fontSize: 11, fontWeight: "900", color: "#111827" },
  statusText: { fontSize: 12, color: "#7C5F46", fontWeight: "700", textTransform: "capitalize" },
  routeText: { fontWeight: "800", color: "#111827", fontSize: 14, marginBottom: 4 },
  metaText: { fontSize: 12.5, color: "#7C5F46", fontWeight: "600", marginBottom: 2 },
  ltrText: { writingDirection: "ltr" },
  childSummaryText: { fontSize: 12.5, color: "#F58220", fontWeight: "800", marginTop: 2 },
  cancelButton: { marginTop: 8, alignSelf: "flex-start" },
  cancelButtonText: { color: "#B91C1C", fontWeight: "800", fontSize: 12.5 },
  noReturnRow: { paddingHorizontal: 4, paddingTop: 2, paddingBottom: 4, gap: 2 },
  noReturnRowText: { fontSize: 12, color: "#7C5F46", fontWeight: "700" },
  trackButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#2563EB",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: "flex-start",
    marginTop: 8,
  },
  trackButtonText: { color: "#FFFFFF", fontWeight: "900", fontSize: 12.5 },
  rateButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#F58220",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: "flex-start",
    marginTop: 8,
  },
  rateButtonText: { color: "#F58220", fontWeight: "900", fontSize: 12.5 },
  startButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F58220",
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 14,
    alignSelf: "flex-start",
    marginTop: 8,
  },
  startButtonText: { color: "#FFFFFF", fontWeight: "900", fontSize: 12.5 },
  replacementBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FEE2E2",
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
  },
  replacementBannerText: { flex: 1, color: "#B91C1C", fontWeight: "700", fontSize: 12.5 },
  replacementBannerLink: { color: "#B91C1C", fontWeight: "900", fontSize: 12.5, textDecorationLine: "underline" },
  verificationCodeBox: {
    backgroundColor: "#FFF8F2",
    borderWidth: 1,
    borderColor: "#FFE2C5",
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    alignItems: "center",
  },
  verificationCodeLabel: { fontSize: 12, color: "#7C5F46", fontWeight: "800" },
  verificationCodeValue: {
    fontSize: 28,
    fontWeight: "900",
    color: "#111827",
    letterSpacing: 6,
    marginVertical: 4,
  },
  verificationCodeHint: { fontSize: 11.5, color: "#B86115", fontWeight: "700", textAlign: "center" },
  ratingOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  ratingSheet: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 22,
    alignItems: "center",
  },
  ratingTitle: { fontSize: 18, fontWeight: "900", color: "#111827" },
  ratingSubtitle: { fontSize: 13, color: "#7C5F46", fontWeight: "700", marginTop: 4, marginBottom: 16 },
  starsRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  commentInput: {
    width: "100%",
    minHeight: 70,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    padding: 12,
    color: "#111827",
    textAlignVertical: "top",
    marginBottom: 16,
  },
  ratingSubmitButton: {
    width: "100%",
    backgroundColor: "#F58220",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  ratingSubmitText: { color: "#FFFFFF", fontWeight: "900", fontSize: 15 },
  ratingCancelButton: { marginTop: 10, paddingVertical: 8 },
  ratingCancelText: { color: "#7C5F46", fontWeight: "800" },
});
