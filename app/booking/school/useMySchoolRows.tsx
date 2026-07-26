// ---------------------------------------------------------------------------
// "New" school trips data + cards for My Bookings — a hook (not a rendered
// section) so its rows can be merged into app/(tabs)/bookings.tsx's single
// global Upcoming/In Progress/Completed list alongside every other category,
// instead of rendering as a separate, always-first block. This is the same
// Firestore subscriptions / cancel / rating logic that used to live in the
// now-removed MySchoolTripsSection.tsx component — only HOW it's exposed to
// the parent screen changed (data + render closures instead of a positioned
// <View>), not what it fetches, computes, or renders.
//
// Passenger view: every schoolBookings doc for this user is its OWN fully
// independent top-level My Bookings card — one outbound booking (carrying
// every child riding together) and one SEPARATE card per child's own return
// booking. There is deliberately NO visual/round-trip grouping anymore:
// `bookingGroupId` still exists on each document (useful for internal
// history/linking — see acceptReplacementOffer in schoolTripsLib.ts) but is
// never read here for layout, tab placement, sorting, or lifecycle — each
// card's tab/sort/status come ONLY from that exact document's own
// `.status`/`.tripStatus`/`.date`/`.departureTime`. Completing, starting, or
// cancelling one booking can therefore never visually affect another, even
// one from the same original round trip. Plus a "Waiting for a ride" list of
// this user's active rideRequests (AGENTS.md #7/#16 — cancel a waiting
// request) — a rideRequest with no actual booking yet is NEVER rendered as
// if it were a return booking (see the deliberate absence of any
// "no return needed"/"searching" placeholder row below).
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
// small, self-contained modal here (same reasoning as this file staying
// separate from bookings.tsx's own ride/booking/application rating modal).
//
// Driver view: every schoolTrips doc this driver created, each with its own
// Cancel button — cancelling one leg never touches its linked trip
// (AGENTS.md #12, edge cases #3/#4) — plus a Start/Continue Trip button.
// Bucket (Upcoming/In Progress/Completed/Unbooked Trips) placement is
// decided centrally by bookingsLib.ts's getDriverTripStatus/
// getDriverTripBucket, from each row's .status/.tripStatus/
// .waitingForBooking — this hook never filters by bucket itself.
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
import {
  BookingBucket,
  buildSearchText,
  canStartTrip,
  dismissRatingNotifications,
  DRIVER_CANCEL_LOCK_HOURS,
  getCategoryMeta,
  getDriverTripBucket,
  getDriverTripStatus,
  getPassengerTripBucket,
  getStartTripBlockedReason,
} from "../bookingsLib";
import { DirectionalCard } from "../../i18n/DirectionalPrimitives";
import { formatLocalizedDateFromYMD, translateCategoryLabel } from "../../i18n/formatters";
import { useLanguage } from "../../i18n/LanguageProvider";
import { accentBorderStart, pushToEnd } from "../../i18n/rtl";
import {
  cancelRideRequest,
  cancelSchoolBooking,
  cancelSchoolTrip,
  getSchoolCancelBlockedReason,
  hideRideRequest,
  hideSchoolBooking,
  hideSchoolTrip,
  normalizeSchoolBooking,
  normalizeSchoolTrip,
  RideRequest,
  SCHOOL_BOOKINGS_COLLECTION,
  SCHOOL_TRIPS_COLLECTION,
  schoolTripDirectionLabel,
  SchoolBooking,
  SchoolBookingStatus,
  SchoolTrip,
  subscribeMyRideRequests,
  submitSchoolBookingRating,
} from "../schoolTripsLib";

type Params = {
  tab: "passenger" | "driver";
  uid: string | null;
  // Set only from a tapped rating notification whose bookingId this hook's
  // own `bookings` (SCHOOL_BOOKINGS_COLLECTION) might contain — see
  // bookings.tsx's pendingRatingBookingId, which passes the same id down
  // here after failing to find it among its own ride/booking/application
  // arrays. onConsumePendingRating tells the parent this hook has had its
  // one shot (found-and-opened or not), so it clears the id and this never
  // runs again for the same notification tap.
  pendingRatingBookingId?: string | null;
  onConsumePendingRating?: () => void;
};

export type SchoolPassengerRow =
  | {
      // One row per actual schoolBookings document — outbound and every
      // child's own return are always separate rows, never merged into a
      // round-trip group (see this file's header).
      _kind: "schoolBooking";
      id: string;
      date: string;
      time: string;
      status: SchoolBookingStatus;
      tripStatus: string;
      searchText: string;
      render: () => React.ReactNode;
    }
  | {
      _kind: "schoolWaiting";
      id: string;
      date: string;
      time: string;
      status: string;
      searchText: string;
      render: () => React.ReactNode;
    };

export type SchoolDriverRow = SchoolTrip & {
  _kind: "schoolTrip";
  time: string;
  // Real count of SchoolBooking docs with status "booked" for this tripId —
  // never derived from availableSeats/totalSeats.
  activeBookingCount: number;
  // Same condition the card's own status pill uses (isSchoolTripWaitingForBooking)
  // — read FIRST by getDriverTripStatus so this row can never simultaneously
  // qualify for Upcoming/In Progress/Completed.
  waitingForBooking: boolean;
  searchText: string;
  render: () => React.ReactNode;
};

type Result = {
  loading: boolean;
  passengerRows: SchoolPassengerRow[];
  driverRows: SchoolDriverRow[];
  modals: React.ReactNode;
  clearAllSchoolRows: (bucket: BookingBucket) => Promise<{ cleared: number; failed: number }>;
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

export default function useMySchoolRows({
  tab,
  uid,
  pendingRatingBookingId,
  onConsumePendingRating,
}: Params): Result {
  const { t } = useTranslation();
  const { language, isRTL } = useLanguage();

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
                .filter((tr) => tr.status !== "cancelled" && !tr.deletedForDriver),
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
              feature: "useMySchoolRows.driverBookings",
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

  // Same one-shot targeted-open behaviour as bookings.tsx's own effect (see
  // its comment) — this hook's `bookings` (SCHOOL_BOOKINGS_COLLECTION,
  // new-style school trips) is invisible to that parent effect, so it's
  // given the same pendingRatingBookingId as a parameter and searches its
  // own data independently. Either this finds it or the parent already
  // didn't — exactly one of the two ever actually contains a given
  // bookingId.
  useEffect(() => {
    if (!pendingRatingBookingId) return;
    if (tab !== "passenger") return;
    if (loading) return;
    if (ratingBooking) return;

    const match = bookings.find((b) => b.id === pendingRatingBookingId);

    if (match) {
      const eligible =
        match.status === "completed" &&
        match.tripStatus === "completed" &&
        match.completedAtSeconds > 0 &&
        match.needsPassengerRating === true &&
        match.ratingSubmitted !== true;

      if (eligible) openRatingModal(match);
    }

    onConsumePendingRating?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRatingBookingId, tab, loading, bookings, ratingBooking]);

  const handleCancelBooking = (booking: SchoolBooking) => {
    if (booking.status !== "booked") return;

    const blocked = getSchoolCancelBlockedReason(
      booking.date,
      booking.departureTime,
      booking.tripStatus,
    );
    if (blocked) {
      Alert.alert(t("booking.cannotCancelTitle"), blocked);
      return;
    }

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
    const blocked = getSchoolCancelBlockedReason(
      trip.date,
      trip.departureTime,
      trip.tripStatus,
      DRIVER_CANCEL_LOCK_HOURS,
    );
    if (blocked) {
      Alert.alert(t("booking.cannotCancelTitle"), blocked);
      return;
    }

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

  // Only ever offered once a booking/trip is finished (completed) — see the
  // render below. "X"/outside tap just closes the confirm, same as every
  // other Alert in this file — nothing is removed unless "Remove" is tapped.
  const handleHideBooking = (booking: SchoolBooking) => {
    Alert.alert(
      t("booking.removeBookingTitle"),
      t("booking.removeConfirmCompleted", { label: t("booking.labelWord") }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("booking.removeButton"),
          style: "destructive",
          onPress: async () => {
            setBusyId(booking.id);
            try {
              await hideSchoolBooking(booking.id, "passenger");
            } catch (error: any) {
              Alert.alert(t("common.error"), error?.message || t("errors.generic"));
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  };

  const handleHideTrip = (trip: SchoolTrip) => {
    Alert.alert(
      t("booking.removeBookingTitle"),
      t("booking.removeConfirmCompleted", { label: t("booking.labelWord") }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("booking.removeButton"),
          style: "destructive",
          onPress: async () => {
            setBusyId(trip.id);
            try {
              await hideSchoolTrip(trip.id);
            } catch (error: any) {
              Alert.alert(t("common.error"), error?.message || t("errors.generic"));
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
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
      await dismissRatingNotifications(ratingBooking.id);
      closeRatingModal();
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("errors.generic"));
    } finally {
      setRatingSubmitting(false);
    }
  };

  const schoolMeta = getCategoryMeta("school");

  // Single top-right status pill — same visual pattern (and same
  // statusPill/statusDone/statusDead/statusOngoing styling) as every other
  // My Bookings card (see renderApplicationCard's "Work Helper" card and
  // renderStatus/renderBookingTripStatus in app/(tabs)/bookings.tsx). Only
  // presentation is shared here — the underlying status/tripStatus fields
  // and their meaning are untouched.
  const renderStatusPill = (cancelled: boolean, completed: boolean, label: string) => (
    <View
      style={[
        styles.statusPill,
        cancelled ? styles.statusDead : completed ? styles.statusDone : styles.statusOngoing,
      ]}
    >
      <Ionicons
        name={cancelled ? "close-circle" : completed ? "checkmark-circle" : "time"}
        size={13}
        color={cancelled ? "#B91C1C" : completed ? "#166534" : "#B86115"}
      />
      <Text
        style={[
          styles.statusPillText,
          cancelled
            ? styles.statusPillTextDead
            : completed
              ? styles.statusPillTextDone
              : styles.statusPillTextOngoing,
        ]}
      >
        {label}
      </Text>
    </View>
  );

  // A leg is always a real booking (never "unbooked") — cancelled/completed
  // read straight off its own status; anything else is its live tracking
  // state (see trackingStatusKey).
  const legStatusLabel = (leg: SchoolBooking) => {
    if (leg.status === "cancelled") return t("bookings.status.cancelled");
    if (leg.status === "completed") return t("common.completed");
    return t(trackingStatusKey(leg.tripStatus));
  };

  // A driver's own trip listing additionally has a "waiting for booking"
  // state — zero real active passenger bookings AND never actually started
  // (tripStatus still "booked"; once genuinely started it stays whatever
  // it is regardless of a later cancellation, same as the generic
  // DriverTripItem trip card in app/(tabs)/bookings.tsx). This is the ONE
  // place that decides "waiting for booking" — both the card's status pill
  // (tripStatusLabel below) and the Upcoming/Unbooked Trips bucket
  // (SchoolDriverRow.waitingForBooking, read first in getDriverTripStatus)
  // read this exact same value, so the two can never disagree.
  const isSchoolTripWaitingForBooking = (trip: SchoolTrip, activeBookingCount: number) =>
    trip.status !== "completed" &&
    trip.status !== "cancelled" &&
    trip.tripStatus === "booked" &&
    activeBookingCount === 0;

  const tripStatusLabel = (trip: SchoolTrip, waitingForBooking: boolean) => {
    if (trip.status === "cancelled") return t("bookings.status.cancelled");
    if (trip.status === "completed") return t("common.completed");
    if (waitingForBooking) {
      // Same distinction bookings.tsx's DriverTripItem card uses — future
      // zero-booking trips read "Waiting for booking", past ones read
      // "Expired — No bookings", via the one shared getDriverTripStatus.
      const effectiveStatus = getDriverTripStatus({
        _kind: "schoolTrip",
        waitingForBooking,
        date: trip.date,
        time: trip.departureTime,
      });
      return effectiveStatus === "expiredNoBookings"
        ? t("booking.expiredNoBookingsLabel")
        : t("booking.waitingForBookingLabel");
    }
    return t(trackingStatusKey(trip.tripStatus));
  };

  // Shared per-leg bits every card (outbound or return) needs — each reads
  // ONLY the exact `booking` passed in, never a sibling leg, the group, or
  // array position. This is what guarantees completing/starting/cancelling
  // one leg can never visually change another (AGENTS.md's independent-leg
  // requirement).
  const canTrackLeg = (booking: SchoolBooking) => booking.tripStatus === "in_progress";
  const legNeedsRating = (booking: SchoolBooking) =>
    booking.status === "completed" && booking.needsPassengerRating && !booking.ratingSubmitted;
  const legNeedsReplacement = (booking: SchoolBooking) =>
    booking.bookingStatus === "replacement_pending" || booking.bookingStatus === "replacement_offered";
  const legCancelBlockedReason = (booking: SchoolBooking) =>
    booking.status === "booked"
      ? getSchoolCancelBlockedReason(booking.date, booking.departureTime, booking.tripStatus)
      : null;

  const renderReplacementBanner = (booking: SchoolBooking) => (
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
  );

  const renderVehicleLine = (booking: SchoolBooking) =>
    booking.car || booking.carColor || booking.carPlate ? (
      <Text style={styles.metaText}>
        <Ionicons name="car-outline" size={12} color="#7C5F46" />{" "}
        {[booking.car, booking.carColor].filter(Boolean).join(" · ")}
        {booking.carPlate ? <Text style={styles.ltrText}> · {booking.carPlate}</Text> : null}
      </Text>
    ) : null;

  const renderLegActions = (booking: SchoolBooking) => {
    const cancelBlockedReason = legCancelBlockedReason(booking);

    return (
      <>
        {canTrackLeg(booking) ? (
          <Pressable style={styles.trackButton} onPress={() => handleTrackDriver(booking)}>
            <Ionicons name="navigate-outline" size={14} color="#FFFFFF" />
            <Text style={styles.trackButtonText}>{t("rides.liveTracking")}</Text>
          </Pressable>
        ) : null}

        {legNeedsRating(booking) ? (
          <Pressable style={styles.rateButton} onPress={() => openRatingModal(booking)}>
            <Ionicons name="star-outline" size={14} color="#F58220" />
            <Text style={styles.rateButtonText}>{t("schoolTrip.rateDriverButton")}</Text>
          </Pressable>
        ) : null}

        {booking.status === "booked" ? (
          <>
            <Pressable
              style={[
                styles.cancelButton,
                (busyId === booking.id || !!cancelBlockedReason) && { opacity: 0.5 },
              ]}
              onPress={() => handleCancelBooking(booking)}
              disabled={busyId === booking.id || !!cancelBlockedReason}
            >
              <Text style={styles.cancelButtonText}>{t("booking.cancelBookingLink")}</Text>
            </Pressable>

            {cancelBlockedReason ? (
              <Text style={styles.noReturnRowText}>{cancelBlockedReason}</Text>
            ) : null}
          </>
        ) : null}
      </>
    );
  };

  // OUTBOUND card — a fully independent, top-level My Bookings card. Every
  // child riding together, one shared verification code, blue accent.
  // Slightly dimmed once THIS exact booking is completed (a purely
  // cosmetic, per-card cue — never dependent on any return booking's own
  // status, since there is no round-trip grouping anymore).
  const renderOutboundLegCard = (booking: SchoolBooking) => {
    const dimmed = booking.status === "completed";
    const childNames = (booking.childEntries || [])
      .map((c) => c.childName)
      .filter((name): name is string => Boolean(name));
    const childSummary =
      booking.childEntries && booking.childEntries.length > 0
        ? t("schoolTrip.childrenRidingCount", { count: booking.childEntries.length }) +
          (childNames.length > 0 ? `: ${childNames.join(", ")}` : "")
        : null;

    // Outbound-ONLY — this is the driver-start-trip verification code
    // (schoolTripsLib.ts's verifyPassengerCodeAndStartTrip), a completely
    // different thing from the child's own PERMANENT return identification
    // code (schoolChildren/{childId}.returnCode, shown only in the booking
    // form / future School Kiosk — see schoolChildrenLib.ts). Never shown
    // once this leg is no longer in the "waiting to be verified" state —
    // once completed/cancelled/expired, the status pill above already
    // tells the real story and the code box would just be stale clutter.
    const showVerificationCode =
      booking.status === "booked" &&
      booking.verificationStatus === "pending" &&
      !!booking.verificationCode;

    return (
      <View
        key={booking.id}
        style={[styles.legCard, accentBorderStart(4, "#2563EB", isRTL), dimmed && styles.legCardDimmed]}
      >
        <View style={[styles.catChip, { backgroundColor: `${schoolMeta.color}18` }]}>
          <Ionicons name={schoolMeta.icon} size={13} color={schoolMeta.color} />
          <Text style={[styles.catChipText, { color: schoolMeta.color }]}>
            {translateCategoryLabel("school", schoolMeta.label, t)}
          </Text>
        </View>

        <View style={styles.legHeader}>
          <View style={[styles.badge, styles.badgeOutbound]}>
            <Ionicons name="arrow-up-circle" size={13} color="#1D4ED8" />
            <Text style={[styles.badgeText, styles.badgeTextOutbound]}>
              {directionLabel(t, booking.bookingDirection)}
            </Text>
          </View>

          <View style={styles.legHeaderActions}>
            {renderStatusPill(
              booking.status === "cancelled",
              booking.status === "completed",
              legStatusLabel(booking),
            )}

            {booking.status === "completed" ? (
              <Pressable style={[styles.deleteButton, pushToEnd(isRTL)]} onPress={() => handleHideBooking(booking)} hitSlop={8}>
                <Ionicons name="trash-outline" size={18} color="#B91C1C" />
              </Pressable>
            ) : null}
          </View>
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
        {renderVehicleLine(booking)}
        {childSummary ? <Text style={styles.childSummaryText}>{childSummary}</Text> : null}

        {legNeedsReplacement(booking) ? renderReplacementBanner(booking) : null}

        {showVerificationCode ? (
          <View style={styles.verificationCodeBox}>
            <Text style={styles.verificationCodeLabel}>{t("booking.verificationCode")}</Text>
            <Text style={styles.verificationCodeValue}>{booking.verificationCode}</Text>
            <Text style={styles.verificationCodeHint}>{t("booking.giveCodeToDriver")}</Text>
          </View>
        ) : null}

        {renderLegActions(booking)}
      </View>
    );
  };

  // RETURN card — a fully independent, top-level My Bookings card, always
  // exactly ONE child, green/neutral accent, child name prominent. Matched
  // to its child by the durable childId this document itself already
  // carries (see schoolTripsLib.ts's bookReturnForChild) — never by name,
  // array position, or return time; an older booking with no childId simply
  // falls back to its own childName/childEntryId text, exactly as it always
  // displayed. Never shows the verification-code box (that belongs to the
  // outbound card only) and never the child's permanent return
  // identification code (schoolChildren.returnCode) — that belongs only to
  // My Children / the booking form / the future Kiosk, never here.
  //
  // `stableKey` is normally this booking's own id, EXCEPT when this exact
  // booking was created to fulfil a waiting rideRequest (see
  // findLinkedBooking below) — then it's that request's own stable key, so
  // React sees the SAME card transform from "searching" to "booked" instead
  // of mounting a second one (see this file's passengerRows comment).
  const renderReturnLegCard = (booking: SchoolBooking, stableKey: string) => {
    const dimmed = booking.status === "completed";
    const childLabel = booking.childName || t("schoolTrip.childNumber", { number: 1 });
    // The booking's OWN exact return date — never the outbound leg's date,
    // never derived from any sibling return booking. `.date` is already the
    // one normalized field every schoolBookings doc stores it under (see
    // normalizeSchoolBooking) — the raw stored value itself is never
    // touched, only displayed here through the locale-aware formatter.
    const displayDate = formatLocalizedDateFromYMD(booking.date, language);

    return (
      <View
        key={stableKey}
        style={[styles.legCard, accentBorderStart(4, "#16A34A", isRTL), dimmed && styles.legCardDimmed]}
      >
        <View style={[styles.catChip, { backgroundColor: `${schoolMeta.color}18` }]}>
          <Ionicons name={schoolMeta.icon} size={13} color={schoolMeta.color} />
          <Text style={[styles.catChipText, { color: schoolMeta.color }]}>
            {translateCategoryLabel("school", schoolMeta.label, t)}
          </Text>
        </View>

        <View style={styles.legHeader}>
          <View style={[styles.badge, styles.badgeReturn]}>
            <Ionicons name="arrow-down-circle" size={13} color="#15803D" />
            <Text style={[styles.badgeText, styles.badgeTextReturn]}>
              {t("schoolTrip.returnForChild", { child: childLabel })}
            </Text>
          </View>

          <View style={styles.legHeaderActions}>
            {renderStatusPill(
              booking.status === "cancelled",
              booking.status === "completed",
              legStatusLabel(booking),
            )}

            {booking.status === "completed" ? (
              <Pressable style={[styles.deleteButton, pushToEnd(isRTL)]} onPress={() => handleHideBooking(booking)} hitSlop={8}>
                <Ionicons name="trash-outline" size={18} color="#B91C1C" />
              </Pressable>
            ) : null}
          </View>
        </View>

        <Text style={styles.childNameProminent}>{childLabel}</Text>
        <Text style={styles.metaText}>
          {t("booking.date")}: {displayDate}
        </Text>
        <Text style={styles.metaText}>
          {t("schoolTrip.finishingTime")}: {booking.departureTime}
        </Text>
        <Text style={styles.metaText}>
          {booking.fromAddress} → {booking.toAddress}
        </Text>
        {booking.driverName ? (
          <Text style={styles.metaText}>
            {t("driver.driverLabel", { defaultValue: "Driver" })}: {booking.driverName}
          </Text>
        ) : null}
        {renderVehicleLine(booking)}

        {legNeedsReplacement(booking) ? renderReplacementBanner(booking) : null}

        {renderLegActions(booking)}
      </View>
    );
  };

  const renderTripCard = (trip: SchoolTrip, activeBookingCount: number) => {
    const canStart = canStartTrip(trip);
    const blockedReason = getStartTripBlockedReason(trip);
    const waitingForBooking = isSchoolTripWaitingForBooking(trip, activeBookingCount);
    // Never show/enable Start Trip for a trip with zero real active
    // passenger bookings — once it has actually started (tripStatus past
    // "booked"), Continue keeps showing regardless, since this only guards
    // the initial Start.
    const showLifecycleButton = trip.status !== "cancelled" && trip.status !== "completed" && !waitingForBooking;

    // Driver's own trip uses the stricter 5-hour-before-departure window
    // (see DRIVER_CANCEL_LOCK_HOURS) — cancelling here can affect passengers
    // already booked onto it, not just the driver's own plan.
    const cancelBlockedReason =
      trip.status === "active" || trip.status === "full"
        ? getSchoolCancelBlockedReason(
            trip.date,
            trip.departureTime,
            trip.tripStatus,
            DRIVER_CANCEL_LOCK_HOURS,
          )
        : null;

    return (
      <View
        key={trip.id}
        style={[styles.legCard, accentBorderStart(4, schoolMeta.color, isRTL)]}
      >
        <View style={[styles.catChip, { backgroundColor: `${schoolMeta.color}18` }]}>
          <Ionicons name={schoolMeta.icon} size={13} color={schoolMeta.color} />
          <Text style={[styles.catChipText, { color: schoolMeta.color }]}>
            {translateCategoryLabel("school", schoolMeta.label, t)}
          </Text>
        </View>

        <View style={styles.legHeader}>
          <View
            style={[
              styles.badge,
              trip.direction === "to_school" ? styles.badgeOutbound : styles.badgeReturn,
            ]}
          >
            <Text style={styles.badgeText}>{directionLabel(t, trip.direction)}</Text>
          </View>

          <View style={styles.legHeaderActions}>
            {renderStatusPill(
              trip.status === "cancelled",
              trip.status === "completed",
              tripStatusLabel(trip, waitingForBooking),
            )}

            {trip.status === "completed" ? (
              <Pressable style={[styles.deleteButton, pushToEnd(isRTL)]} onPress={() => handleHideTrip(trip)} hitSlop={8}>
                <Ionicons name="trash-outline" size={18} color="#B91C1C" />
              </Pressable>
            ) : null}
          </View>
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
          <>
            <Pressable
              style={[
                styles.cancelButton,
                (busyId === trip.id || !!cancelBlockedReason) && { opacity: 0.5 },
              ]}
              onPress={() => handleCancelTrip(trip)}
              disabled={busyId === trip.id || !!cancelBlockedReason}
            >
              <Text style={styles.cancelButtonText}>{t("schoolTrip.cancelTripButton")}</Text>
            </Pressable>

            {cancelBlockedReason ? (
              <Text style={styles.noReturnRowText}>{cancelBlockedReason}</Text>
            ) : null}
          </>
        ) : null}
      </View>
    );
  };

  // SEARCHING/AWAITING-CONFIRMATION card — the same visual shape as
  // renderReturnLegCard (category chip, "Return for X" badge, child name,
  // date, finishing time, route) so this card visibly reads as the SAME
  // return, just not confirmed yet. `stableKey` is always this exact
  // request's own stable key (see passengerRows below) — once a real
  // booking is created for it, renderReturnLegCard reuses that identical
  // key, so React updates this card in place instead of mounting a new one.
  const renderWaitingCard = (request: RideRequest, stableKey: string) => {
    const childLabel = request.childName || t("schoolTrip.childNumber", { number: 1 });
    const statusLabel =
      request.status === "matched"
        ? t("schoolTrip.awaitingConfirmationBadge")
        : t("schoolTrip.searchingForDriverBadge");
    const displayDate = formatLocalizedDateFromYMD(request.requestedDate, language);

    return (
      <View key={stableKey} style={[styles.legCard, accentBorderStart(4, "#16A34A", isRTL)]}>
        <View style={[styles.catChip, { backgroundColor: `${schoolMeta.color}18` }]}>
          <Ionicons name={schoolMeta.icon} size={13} color={schoolMeta.color} />
          <Text style={[styles.catChipText, { color: schoolMeta.color }]}>
            {translateCategoryLabel("school", schoolMeta.label, t)}
          </Text>
        </View>

        <View style={styles.legHeader}>
          <View style={[styles.badge, styles.badgeReturn]}>
            <Ionicons name="arrow-down-circle" size={13} color="#15803D" />
            <Text style={[styles.badgeText, styles.badgeTextReturn]}>
              {t("schoolTrip.returnForChild", { child: childLabel })}
            </Text>
          </View>

          <View style={styles.legHeaderActions}>
            {renderStatusPill(false, false, statusLabel)}
          </View>
        </View>

        <Text style={styles.childNameProminent}>{childLabel}</Text>
        <Text style={styles.metaText}>
          {t("booking.date")}: {displayDate}
        </Text>
        <Text style={styles.metaText}>
          {t("schoolTrip.finishingTime")}: {request.requestedTime}
        </Text>
        <Text style={styles.metaText}>
          {request.schoolName} → {request.toArea}
        </Text>

        <Pressable
          style={[styles.cancelButton, busyId === request.id && { opacity: 0.6 }]}
          onPress={() => handleCancelRequest(request)}
          disabled={busyId === request.id}
        >
          <Text style={styles.cancelButtonText}>{t("schoolTrip.cancelWaitingRequestTitle")}</Text>
        </Pressable>
      </View>
    );
  };

  const visibleRequests = useMemo(
    () =>
      rideRequests.filter(
        (r) => (r.status === "waiting" || r.status === "matched") && !r.hiddenForParent,
      ),
    [rideRequests],
  );

  // Links a waiting rideRequest to the real return booking that fulfils it,
  // so My Bookings can render ONE continuous card instead of both a stale
  // "searching" card and a separate new "booked" card for the same logical
  // return (see this file's header + passengerRows below). Checked in
  // priority order, per AGENTS.md's stable-linkage rule — never by child
  // name, array position, or displayed return time alone:
  //   1. booking.sourceRideRequestId === request.id — the explicit forward
  //      link bookReturnForChild stamps on every booking it creates from a
  //      request (see schoolTripsLib.ts).
  //   2. request.matchedBookingId === booking.id — the request's own
  //      back-reference, written in the SAME call — a fallback in case only
  //      one side of that write ever reached this client's cache.
  //   3. Backward-compat ONLY, for a request/booking pair that predates
  //      both of the above fields entirely: the durable childId + the
  //      booking's own EXACT return date, and only when the booking itself
  //      carries no sourceRideRequestId at all (so a genuinely unrelated,
  //      already-linked booking is never falsely claimed by a second
  //      request for the same child/date).
  const findLinkedBooking = (request: RideRequest): SchoolBooking | undefined => {
    const bySourceId = bookings.find((b) => b.sourceRideRequestId === request.id);
    if (bySourceId) return bySourceId;

    if (request.matchedBookingId) {
      const byBackReference = bookings.find((b) => b.id === request.matchedBookingId);
      if (byBackReference) return byBackReference;
    }

    if (request.childId) {
      return bookings.find(
        (b) =>
          b.bookingDirection === "from_school" &&
          !b.sourceRideRequestId &&
          b.childId === request.childId &&
          b.date === request.requestedDate,
      );
    }

    return undefined;
  };

  const passengerRows = useMemo<SchoolPassengerRow[]>(() => {
    // Every visible request that already has a real booking behind it —
    // rendered ONCE, as that booking, under the REQUEST's own stable key
    // (see bookingRows below); the request itself never renders its own
    // separate waiting card once linked (see waitingRows below).
    const linkedBookingIdByRequestId = new Map<string, string>();
    const linkedRequestIdByBookingId = new Map<string, string>();

    visibleRequests.forEach((request) => {
      const linked = findLinkedBooking(request);
      if (linked) {
        linkedBookingIdByRequestId.set(request.id, linked.id);
        linkedRequestIdByBookingId.set(linked.id, request.id);
      }
    });

    // ONE row per actual schoolBookings document — outbound and every
    // child's own return booking are always independent top-level cards.
    // Each row's status/tripStatus/date/time are that EXACT document's own
    // fields, read directly, never aggregated across any other booking —
    // this is what makes getPassengerTripBucket/sortMyBookings (both
    // shared, unmodified, bookingsLib.ts classifiers) place and sort each
    // card purely on its own real lifecycle, with zero risk of one booking
    // visually affecting another. A return booking linked to a request uses
    // that REQUEST's own stable key instead of its own id, so the request's
    // earlier "searching"/"awaiting confirmation" card visually transforms
    // into this one in place (same React key) rather than a second card
    // appearing alongside it.
    const bookingRows: SchoolPassengerRow[] = bookings.map((booking) => {
      const linkedRequestId = linkedRequestIdByBookingId.get(booking.id);
      const stableKey = linkedRequestId
        ? `school-return-request-${linkedRequestId}`
        : booking.bookingDirection === "from_school"
          ? `school-return-booking-${booking.id}`
          : booking.id;

      return {
        _kind: "schoolBooking",
        id: booking.id,
        date: booking.date,
        time: booking.departureTime,
        status: booking.status,
        tripStatus: booking.tripStatus,
        // Per-booking search text — covers date/route/school/driver/child
        // name/category/direction for THIS exact document only. Searching a
        // child's name still surfaces both their own return card AND any
        // outbound card they rode on, since each of those is its own row
        // with its own searchText built from its own childName/childEntries.
        searchText: buildSearchText([
          schoolMeta.label,
          "school",
          directionLabel(t, booking.bookingDirection),
          booking.fromAddress,
          booking.toAddress,
          booking.schoolName,
          booking.driverName,
          booking.date,
          booking.departureTime,
          booking.passengerName,
          booking.childName,
          ...(booking.childEntries || []).map((c) => c.childName),
        ]),
        render: () =>
          booking.bookingDirection === "to_school"
            ? renderOutboundLegCard(booking)
            : renderReturnLegCard(booking, stableKey),
      };
    });

    // A rideRequest with no actual booking yet is a WAITING row, never a
    // return-booking row — see this file's header. It disappears from here
    // the moment it's cancelled/expired (visibleRequests already filters to
    // waiting/matched only) OR the moment a real booking is linked to it
    // (linkedBookingIdByRequestId above) — that booking now renders in this
    // exact request's own stable slot instead (see bookingRows above), so
    // rendering the waiting card too would show two cards for one logical
    // return.
    const waitingRows: SchoolPassengerRow[] = visibleRequests
      .filter((request) => !linkedBookingIdByRequestId.has(request.id))
      .map((request) => ({
        _kind: "schoolWaiting",
        id: request.id,
        date: request.requestedDate,
        time: request.requestedTime,
        status: request.status,
        searchText: buildSearchText([
          t("schoolTrip.waitingBadge"),
          "school",
          request.schoolName,
          request.fromArea,
          request.toArea,
          request.requestedDate,
          request.requestedTime,
          request.childName,
        ]),
        render: () => renderWaitingCard(request, `school-return-request-${request.id}`),
      }));

    return [...bookingRows, ...waitingRows];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, visibleRequests, busyId]);

  const driverRows = useMemo<SchoolDriverRow[]>(
    () =>
      trips.map((trip) => {
        // Real count of SchoolBooking docs for this trip, never availableSeats
        // — same expression handleCancelTrip already uses for its "affected
        // passengers" warning.
        const activeBookingCount = bookings.filter(
          (b) => b.tripId === trip.id && b.status === "booked",
        ).length;
        const waitingForBooking = isSchoolTripWaitingForBooking(trip, activeBookingCount);

        return {
          ...trip,
          _kind: "schoolTrip",
          time: trip.departureTime,
          activeBookingCount,
          waitingForBooking,
          searchText: buildSearchText([
            schoolMeta.label,
            "school",
            trip.fromArea,
            trip.toArea,
            trip.schoolName,
            trip.driverName,
            trip.date,
            trip.departureTime,
          ]),
          render: () => renderTripCard(trip, activeBookingCount),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trips, bookings, busyId],
  );

  // Bulk "Clear All" support for My Bookings (app/(tabs)/bookings.tsx) — a
  // PURE per-user view-hide, never a cancellation: every row in the current
  // bucket is hidden one at a time through the exact same hide functions its
  // own single-card trash button already uses (hideSchoolBooking/
  // hideSchoolTrip/hideRideRequest — never cancelSchoolBooking/
  // cancelSchoolTrip/cancelRideRequest, never the two-hour/five-hour cancel
  // lock, never a status/tripStatus write, never a groupId). `bucket` is the
  // exact BookingBucket the caller has already scoped its rows to — reusing
  // passengerRows/driverRows (not a re-derived list) and the shared
  // getPassengerTripBucket/getDriverTripBucket classifiers guarantees this
  // can never disagree with what's actually shown on that tab.
  //
  // Promise.allSettled (never Promise.all) — one row's write being denied
  // (e.g. a rules gap for that exact collection) never stops the rest of the
  // batch from being hidden; each rejection is logged with the exact
  // collection/row type/error CODE only (never the booking's own child
  // name, return code, or any other private field) so a real denial can be
  // diagnosed without guessing.
  const clearAllSchoolRows = async (
    bucket: BookingBucket,
  ): Promise<{ cleared: number; failed: number }> => {
    type HideTask = {
      collection: typeof SCHOOL_BOOKINGS_COLLECTION | typeof SCHOOL_TRIPS_COLLECTION | "rideRequests";
      rowKind: "schoolBooking" | "schoolWaiting" | "schoolTrip";
      run: () => Promise<void>;
    };

    const tasks: HideTask[] =
      tab === "passenger"
        ? passengerRows
            .filter((row) => getPassengerTripBucket(row) === bucket)
            .map((row) =>
              row._kind === "schoolWaiting"
                ? { collection: "rideRequests" as const, rowKind: "schoolWaiting" as const, run: () => hideRideRequest(row.id) }
                : {
                    collection: SCHOOL_BOOKINGS_COLLECTION,
                    rowKind: "schoolBooking" as const,
                    run: () => hideSchoolBooking(row.id, "passenger"),
                  },
            )
        : driverRows
            .filter((row) => getDriverTripBucket(row) === bucket)
            .map((row) => ({
              collection: SCHOOL_TRIPS_COLLECTION,
              rowKind: "schoolTrip" as const,
              run: () => hideSchoolTrip(row.id),
            }));

    // Dev-only diagnostic — which collections/row kinds this press is about
    // to hide, and how many — never the rows' own field values.
    const countsByCollection = new Map<string, number>();
    tasks.forEach((task) => {
      countsByCollection.set(task.collection, (countsByCollection.get(task.collection) ?? 0) + 1);
    });
    console.log("CLEAR_ALL_SOURCE_COLLECTIONS", {
      feature: "clearAllSchoolRows",
      collections: [...countsByCollection.entries()].map(([name, count]) => ({
        collection: name,
        count,
      })),
    });

    const results = await Promise.allSettled(tasks.map((task) => task.run()));

    let cleared = 0;
    let failed = 0;

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        cleared += 1;
        return;
      }

      failed += 1;
      console.log("Clear All hide failed", {
        feature: "clearAllSchoolRows",
        collection: tasks[index].collection,
        rowKind: tasks[index].rowKind,
        operation: "hide",
        code: (result.reason as any)?.code,
      });
    });

    return { cleared, failed };
  };

  const modals = (
    <>
      <Modal visible={!!ratingBooking} animationType="fade" transparent onRequestClose={closeRatingModal}>
        <View style={styles.ratingOverlay}>
          <DirectionalCard style={styles.ratingSheet}>
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
          </DirectionalCard>
        </View>
      </Modal>

      <Modal
        visible={!!cancelTripTarget}
        animationType="fade"
        transparent
        onRequestClose={closeCancelTripModal}
      >
        <View style={styles.ratingOverlay}>
          <DirectionalCard style={styles.ratingSheet}>
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
          </DirectionalCard>
        </View>
      </Modal>
    </>
  );

  return { loading, passengerRows, driverRows, modals, clearAllSchoolRows };
}

const styles = StyleSheet.create({
  loadingBox: { paddingVertical: 16, alignItems: "center" },
  section: { marginBottom: 18 },
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  sectionHeaderText: { fontWeight: "900", color: "#111827", fontSize: 14 },
  catChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 8,
  },
  catChipText: { fontWeight: "800", fontSize: 11.5 },
  deleteButton: { padding: 2 },
  legCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  // Blue accent — outbound (shared leg, all children riding together).
  // Actual border side applied inline via accentBorderStart(4, color, isRTL)
  // at each usage site below (this file's own centralized RTL helper) so it
  // sits on the correct edge in RTL, not just always on the left.
  // Any card (outbound or return) once THAT exact booking is completed —
  // a purely cosmetic per-card cue, never dependent on any other booking.
  legCardDimmed: {
    opacity: 0.55,
  },
  legHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    rowGap: 6,
    columnGap: 8,
    marginBottom: 8,
  },
  // Groups the top-right status pill + delete button together, same
  // pattern as cardTopActions in app/(tabs)/bookings.tsx. flexShrink lets
  // this group (and the status pill's own text inside it) give way instead
  // of pushing the row wider than the card on a long label like
  // "Expired — No bookings".
  legHeaderActions: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  // A waiting-for-ride request card has no direction badge to anchor the
  // left side — its one status pill still belongs top-right.
  legHeaderStatusOnly: { justifyContent: "flex-end" },
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
  badgeText: { fontSize: 11, fontWeight: "900", color: "#111827" },
  badgeTextOutbound: { color: "#1D4ED8" },
  badgeTextReturn: { color: "#15803D" },
  childNameProminent: {
    fontSize: 16,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 4,
  },
  // Top-right status pill — same visual values as statusPill/statusDone/
  // statusDead/statusOngoing/statusText/statusTextDone/statusTextDead/
  // statusTextOngoing in app/(tabs)/bookings.tsx (the "Work Helper" card's
  // reference styling), duplicated here since each screen keeps its own
  // StyleSheet in this codebase.
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  statusOngoing: { backgroundColor: "#FFF2E8" },
  statusDone: { backgroundColor: "#E7F7EC" },
  statusDead: { backgroundColor: "#F1E7E7" },
  statusPillText: { fontWeight: "900", fontSize: 12, flexShrink: 1 },
  statusPillTextOngoing: { color: "#B86115" },
  statusPillTextDone: { color: "#166534" },
  statusPillTextDead: { color: "#B91C1C" },
  routeText: { fontWeight: "800", color: "#111827", fontSize: 14, marginBottom: 4 },
  metaText: { fontSize: 12.5, color: "#7C5F46", fontWeight: "600", marginBottom: 2 },
  ltrText: { writingDirection: "ltr" },
  childSummaryText: { fontSize: 12.5, color: "#F58220", fontWeight: "800", marginTop: 2 },
  cancelButton: { marginTop: 8, alignSelf: "flex-start" },
  cancelButtonText: { color: "#B91C1C", fontWeight: "800", fontSize: 12.5 },
  // Small hint text under a blocked cancel/start action (e.g. "you can no
  // longer cancel — the driver is already on the way").
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
