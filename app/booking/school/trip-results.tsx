// ---------------------------------------------------------------------------
// School trip search results — outbound/return/round-trip search against the
// NEW schoolTrips collection (AGENTS.md #4/#5/#6/#7). Shows exact matches;
// when none exist, shows the closest alternative trips within
// MAX_ALTERNATIVE_MINUTES in a bottom-sheet modal, and always offers a
// "Notify me" waiting-request button as the final fallback (return trips
// only — see RideRequest's direction: "from_school" in schoolTripsLib.ts).
//
// Per-child return flow (AGENTS.md #3): when this is a return search
// ("from_school") for more than one child (params.childEntries, set by
// DirectionSearchForm and forwarded by trip-confirm's handleContinueToReturn
// for the round-trip case), each child gets their OWN independent search —
// own requested time, own exact/alternative trips, own "no return needed"
// or "notify me" fallback, own selected trip — never one shared result list.
// A single child (or an outbound search, which is always shared) still uses
// the original single-list UI below, unchanged. This is the SAME screen/
// route for both cases — never a second results screen.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { useLanguage } from "../../i18n/LanguageProvider";
import {
  AlternativeTrip,
  ChildReturnSearchCriteria,
  bookReturnForChild,
  createRideRequest,
  fetchDriverRating,
  findAlternativeTrips,
  findAlternativeTripsForChild,
  findMatchingSchoolTrips,
  findReturnTripsForChild,
  generateBookingGroupId,
  SchoolBookingPaymentMethod,
  SchoolTrip,
  SchoolTripDirection,
} from "../schoolTripsLib";

type DriverInfo = { ratingAverage: number; ratingCount: number; photoUrl: string | null };

type ParsedChildEntry = {
  localId: string;
  childName?: string;
  returnRequestedTime?: string;
};

type ChildSearchState = {
  entry: ParsedChildEntry;
  loading: boolean;
  exactTrips: SchoolTrip[];
  alternatives: AlternativeTrip[];
  showAlternatives: boolean;
  selectedTripId: string | null;
  skipped: boolean;
  creatingRequest: boolean;
  requestCreated: boolean;
  // Set only when this child's own search threw — never the raw
  // error.message (which for a Firestore denial is an unhelpful SDK code),
  // always a localized, generic search-failed string.
  searchError: boolean;
};

export default function SchoolTripResultsScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const params = useLocalSearchParams<Record<string, string>>();

  const direction = (params.direction === "from_school" ? "from_school" : "to_school") as SchoolTripDirection;
  const seats = Number(params.seats) || 1;
  const roundTrip = params.roundTrip === "true";

  const [loading, setLoading] = useState(true);
  const [exactTrips, setExactTrips] = useState<SchoolTrip[]>([]);
  const [alternatives, setAlternatives] = useState<AlternativeTrip[]>([]);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [driverInfo, setDriverInfo] = useState<Record<string, DriverInfo>>({});
  const [creatingRequest, setCreatingRequest] = useState(false);

  // From/To are always independent, real areas (never the school) — see
  // AGENTS.md's correction. Which one is "the passenger's own location" for
  // matching purposes depends on direction: outbound matches against From
  // (pickup), return matches against To (destination) — see
  // isDestinationNearRoute's routeStart/routeEnd choice in schoolTripsLib.ts.
  const fromCoords = useMemo(() => {
    const lat = Number(params.fromLat);
    const lng = Number(params.fromLng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : null;
  }, [params.fromLat, params.fromLng]);

  const toCoords = useMemo(() => {
    const lat = Number(params.toLat);
    const lng = Number(params.toLng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : null;
  }, [params.toLat, params.toLng]);

  const schoolCoords = useMemo(() => {
    const lat = Number(params.schoolLat);
    const lng = Number(params.schoolLng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : null;
  }, [params.schoolLat, params.schoolLng]);

  const passengerCoords = direction === "to_school" ? fromCoords : toCoords;

  // Every return search carries one entry per child (AGENTS.md #3) — an
  // outbound search or a single-child return degenerates to the original
  // single-list flow below, never the per-child sectioned one.
  const parsedChildEntries = useMemo<ParsedChildEntry[]>(() => {
    const raw = String(params.childEntries || "");
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((entry) => entry && typeof entry.localId === "string")
        .map((entry) => ({
          localId: entry.localId,
          childName: entry.childName || undefined,
          returnRequestedTime: entry.returnRequestedTime || undefined,
        }));
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.childEntries]);

  const isPerChildReturn = direction === "from_school" && parsedChildEntries.length > 1;

  const [childStates, setChildStates] = useState<ChildSearchState[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<SchoolBookingPaymentMethod>("cash");
  const [confirmingReturns, setConfirmingReturns] = useState(false);

  // -------------------------------------------------------------------
  // Single-list search (outbound, or a return search for exactly one
  // child) — unchanged from before the per-child rework.
  // -------------------------------------------------------------------
  useEffect(() => {
    if (isPerChildReturn) return;
    let cancelled = false;

    const run = async () => {
      setLoading(true);

      const criteria = {
        direction,
        schoolId: String(params.schoolId || ""),
        date: String(params.date || ""),
        seats,
        requestedTime: String(params.requestedTime || ""),
        destination: passengerCoords,
      };

      const exact = await findMatchingSchoolTrips(criteria);

      if (cancelled) return;

      if (exact.length > 0) {
        setExactTrips(exact);
        setAlternatives([]);
      } else {
        const alts = await findAlternativeTrips(criteria);
        if (cancelled) return;
        setExactTrips([]);
        setAlternatives(alts);
        setShowAlternatives(alts.length > 0);
      }

      const driverIds = Array.from(new Set(exact.map((tr) => tr.driverId)));

      const entries = await Promise.all(
        driverIds.map(async (id) => [id, await fetchDriverRating(id)] as const),
      );

      if (!cancelled) {
        setDriverInfo((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      }

      setLoading(false);
    };

    run();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPerChildReturn, direction, params.schoolId, params.date, params.requestedTime, seats]);

  // Alternative trips' drivers are only fetched once the modal is shown, to
  // avoid an unnecessary read burst when an exact match already exists.
  useEffect(() => {
    if (isPerChildReturn || !showAlternatives || alternatives.length === 0) return;

    let cancelled = false;

    const missing = alternatives
      .map((alt) => alt.trip.driverId)
      .filter((id) => !driverInfo[id]);

    if (missing.length === 0) return;

    Promise.all(missing.map(async (id) => [id, await fetchDriverRating(id)] as const)).then(
      (entries) => {
        if (!cancelled) setDriverInfo((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      },
    );

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPerChildReturn, showAlternatives, alternatives]);

  // -------------------------------------------------------------------
  // Per-child search — one independent search per child, own requested
  // time, own results (AGENTS.md #3's "never reuse one child's time for
  // another"). findReturnTripsForChild/findAlternativeTripsForChild both
  // force seats:1 + direction:"from_school" and reuse the exact same
  // matching logic as the single-list search above — never a second
  // matching implementation.
  // -------------------------------------------------------------------
  useEffect(() => {
    if (!isPerChildReturn) return;
    let cancelled = false;

    setChildStates(
      parsedChildEntries.map((entry) => ({
        entry,
        loading: true,
        exactTrips: [],
        alternatives: [],
        showAlternatives: false,
        selectedTripId: null,
        skipped: false,
        creatingRequest: false,
        requestCreated: false,
        searchError: false,
      })),
    );

    const runAll = async () => {
      await Promise.all(
        parsedChildEntries.map(async (entry) => {
          try {
            const criteria: ChildReturnSearchCriteria = {
              schoolId: String(params.schoolId || ""),
              date: String(params.date || ""),
              requestedTime: entry.returnRequestedTime || String(params.requestedTime || ""),
              destinationLocation: toCoords,
            };

            const exact = await findReturnTripsForChild(criteria);
            if (cancelled) return;

            if (exact.length > 0) {
              setChildStates((prev) =>
                prev.map((cs) =>
                  cs.entry.localId === entry.localId
                    ? { ...cs, loading: false, exactTrips: exact, alternatives: [] }
                    : cs,
                ),
              );
              return;
            }

            const alts = await findAlternativeTripsForChild(criteria);
            if (cancelled) return;

            setChildStates((prev) =>
              prev.map((cs) =>
                cs.entry.localId === entry.localId
                  ? { ...cs, loading: false, exactTrips: [], alternatives: alts }
                  : cs,
              ),
            );
          } catch (error) {
            if (cancelled) return;

            // Never the raw error.message next to a child's name — a
            // generic, localized "search failed" state instead. The real
            // cause still goes to the console for debugging.
            console.log(`Return-trip search failed for child ${entry.localId}`, error);
            setChildStates((prev) =>
              prev.map((cs) =>
                cs.entry.localId === entry.localId ? { ...cs, loading: false, searchError: true } : cs,
              ),
            );
          }
        }),
      );
    };

    runAll();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPerChildReturn, parsedChildEntries, params.schoolId, params.date, toCoords]);

  // Driver ratings for every trip surfaced across all children's results.
  useEffect(() => {
    if (!isPerChildReturn) return;

    const ids = new Set<string>();
    childStates.forEach((cs) => {
      cs.exactTrips.forEach((tr) => ids.add(tr.driverId));
      cs.alternatives.forEach((alt) => ids.add(alt.trip.driverId));
    });

    const missing = Array.from(ids).filter((id) => !driverInfo[id]);
    if (missing.length === 0) return;

    let cancelled = false;
    Promise.all(missing.map(async (id) => [id, await fetchDriverRating(id)] as const)).then(
      (entries) => {
        if (!cancelled) setDriverInfo((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      },
    );

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPerChildReturn, childStates]);

  const tripsById = useMemo(() => {
    const map: Record<string, SchoolTrip> = {};
    childStates.forEach((cs) => {
      cs.exactTrips.forEach((tr) => (map[tr.id] = tr));
      cs.alternatives.forEach((alt) => (map[alt.trip.id] = alt.trip));
    });
    return map;
  }, [childStates]);

  const goToConfirm = (tripId: string) => {
    router.push({
      pathname: "/booking/school/trip-confirm",
      params: {
        tripId,
        seats: String(seats),
        roundTrip: roundTrip ? "true" : "false",
        returnRequestedTime: String(params.returnRequestedTime || ""),
        bookingGroupId: String(params.bookingGroupId || ""),
        // Carried through only so a round trip's outbound leg can hand off
        // the return leg's pre-filled destination once booked (see
        // trip-confirm.tsx's handleContinueToReturn) — never used to infer
        // the school itself.
        fromArea: String(params.fromArea || ""),
        fromLat: String(params.fromLat || ""),
        fromLng: String(params.fromLng || ""),
        toArea: String(params.toArea || ""),
        toLat: String(params.toLat || ""),
        toLng: String(params.toLng || ""),
        returnToArea: String(params.returnToArea || ""),
        returnToLat: String(params.returnToLat || ""),
        returnToLng: String(params.returnToLng || ""),
        returnChildEntries: String(params.returnChildEntries || ""),
        // The outbound leg's own child roster (AGENTS.md #3) — only
        // meaningful when direction is "to_school"; harmless to forward
        // otherwise since trip-confirm only reads it for outbound bookings.
        childEntries: String(params.childEntries || ""),
        schoolId: String(params.schoolId || ""),
        schoolName: String(params.schoolName || ""),
        schoolAddress: String(params.schoolAddress || ""),
        schoolLat: String(params.schoolLat || ""),
        schoolLng: String(params.schoolLng || ""),
      },
    } as any);
  };

  const handleNotifyMe = async () => {
    if (direction !== "from_school" || creatingRequest) return;

    try {
      setCreatingRequest(true);

      await createRideRequest({
        // Single-child (or legacy, entry-less) return search — the one
        // child this request is for is the only entry parsed, if any.
        childEntryId: parsedChildEntries[0]?.localId || "solo",
        childName: parsedChildEntries[0]?.childName,
        schoolId: String(params.schoolId || ""),
        schoolName: String(params.schoolName || ""),
        schoolAddress: String(params.schoolAddress || ""),
        schoolLocation: schoolCoords,
        // For a return search, From = the school's own area and To = the
        // parent's home/destination (see AGENTS.md's schoolSearchArea rule)
        // — both already resolved above for the criteria.destination match.
        fromArea: String(params.fromArea || ""),
        fromLocation: fromCoords,
        toArea: String(params.toArea || ""),
        destinationLocation: toCoords,
        requestedDate: String(params.date || ""),
        requestedTime: String(params.requestedTime || ""),
        seats,
      });

      Alert.alert(t("schoolTrip.waitingRequestCreatedTitle"), t("schoolTrip.waitingRequestCreatedMessage"));
      setShowAlternatives(false);
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("errors.generic"));
    } finally {
      setCreatingRequest(false);
    }
  };

  // -------------------------------------------------------------------
  // Per-child handlers
  // -------------------------------------------------------------------
  const selectTripForChild = (localId: string, tripId: string) => {
    setChildStates((prev) =>
      prev.map((cs) => (cs.entry.localId === localId ? { ...cs, selectedTripId: tripId, skipped: false } : cs)),
    );
  };

  const skipReturnForChild = (localId: string) => {
    setChildStates((prev) =>
      prev.map((cs) => (cs.entry.localId === localId ? { ...cs, selectedTripId: null, skipped: true } : cs)),
    );
  };

  const toggleChildAlternatives = (localId: string, value: boolean) => {
    setChildStates((prev) =>
      prev.map((cs) => (cs.entry.localId === localId ? { ...cs, showAlternatives: value } : cs)),
    );
  };

  const useSameTripForAll = (tripId: string) => {
    setChildStates((prev) => prev.map((cs) => ({ ...cs, selectedTripId: tripId, skipped: false })));
  };

  const handleNotifyChild = async (cs: ChildSearchState) => {
    if (cs.creatingRequest) return;

    setChildStates((prev) =>
      prev.map((c) => (c.entry.localId === cs.entry.localId ? { ...c, creatingRequest: true } : c)),
    );

    try {
      await createRideRequest({
        childEntryId: cs.entry.localId,
        childName: cs.entry.childName,
        schoolId: String(params.schoolId || ""),
        schoolName: String(params.schoolName || ""),
        schoolAddress: String(params.schoolAddress || ""),
        schoolLocation: schoolCoords,
        fromArea: String(params.fromArea || ""),
        fromLocation: fromCoords,
        toArea: String(params.toArea || ""),
        destinationLocation: toCoords,
        requestedDate: String(params.date || ""),
        requestedTime: cs.entry.returnRequestedTime || String(params.requestedTime || ""),
        seats: 1,
      });

      setChildStates((prev) =>
        prev.map((c) =>
          c.entry.localId === cs.entry.localId
            ? { ...c, creatingRequest: false, requestCreated: true, showAlternatives: false }
            : c,
        ),
      );
    } catch (error: any) {
      setChildStates((prev) =>
        prev.map((c) => (c.entry.localId === cs.entry.localId ? { ...c, creatingRequest: false } : c)),
      );
      Alert.alert(t("common.error"), error?.message || t("errors.generic"));
    }
  };

  const selectedChildren = childStates.filter((cs) => cs.selectedTripId);
  const totalSelectedPrice = selectedChildren.reduce(
    (sum, cs) => sum + (tripsById[cs.selectedTripId as string]?.pricePerSeat || 0),
    0,
  );

  const handleConfirmReturns = async () => {
    if (selectedChildren.length === 0 || confirmingReturns) return;

    setConfirmingReturns(true);

    const bookingGroupId = String(params.bookingGroupId || "") || generateBookingGroupId();
    const failures: { childLabel: string; message: string }[] = [];
    let successCount = 0;

    for (const cs of selectedChildren) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await bookReturnForChild(
          cs.selectedTripId as string,
          { localId: cs.entry.localId, childName: cs.entry.childName },
          paymentMethod,
          bookingGroupId,
        );
        successCount += 1;
      } catch (error: any) {
        failures.push({
          childLabel: cs.entry.childName || cs.entry.localId,
          message: error?.message || t("errors.generic"),
        });
      }
    }

    setConfirmingReturns(false);

    if (failures.length === 0) {
      Alert.alert(t("common.success"), t("schoolTrip.familyReturnBookingSuccess"), [
        { text: t("common.ok"), onPress: () => router.replace("/(tabs)/bookings" as any) },
      ]);
      return;
    }

    if (successCount > 0) {
      Alert.alert(
        t("schoolTrip.partialBookingTitle"),
        failures.map((f) => `${f.childLabel}: ${f.message}`).join("\n"),
        [{ text: t("common.ok"), onPress: () => router.replace("/(tabs)/bookings" as any) }],
      );
      return;
    }

    Alert.alert(t("common.error"), failures.map((f) => `${f.childLabel}: ${f.message}`).join("\n"));
  };

  const renderTripCard = (
    trip: SchoolTrip,
    diffLabel: string | null,
  ) => {
    const info = driverInfo[trip.driverId];

    return (
      <View key={trip.id} style={styles.card}>
        <View style={styles.cardHeader}>
          {info?.photoUrl ? (
            <Image source={{ uri: info.photoUrl }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Ionicons name="person" size={20} color="#8B7B6B" />
            </View>
          )}

          <View style={{ flex: 1 }}>
            <Text style={styles.driverName}>{trip.driverName}</Text>
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={13} color="#F58220" />
              <Text style={styles.ratingText}>
                {!info
                  ? "—"
                  : info.ratingCount > 0
                    ? `${info.ratingAverage.toFixed(1)} (${info.ratingCount})`
                    : t("roadsideHelp.newDriverLabel")}
              </Text>
            </View>
          </View>

          <View style={styles.timeBox}>
            <Text style={styles.timeText}>{trip.departureTime}</Text>
            {diffLabel ? <Text style={styles.diffText}>{diffLabel}</Text> : null}
          </View>
        </View>

        <View style={styles.routeRow}>
          <Ionicons name="location-outline" size={15} color="#7C5F46" />
          <Text style={styles.routeText} numberOfLines={1}>
            {trip.fromAddress} → {trip.toAddress}
          </Text>
        </View>

        <View style={styles.footerRow}>
          <Text style={styles.priceText}>{trip.pricePerSeat} ₪</Text>
          <Text style={styles.seatsText}>
            {trip.availableSeats} {t("schoolTrip.seatsLeft")}
          </Text>
        </View>

        <View style={styles.buttonRow}>
          <Pressable style={styles.secondaryButton} onPress={() => goToConfirm(trip.id)}>
            <Text style={styles.secondaryButtonText}>{t("schoolTrip.viewDetails")}</Text>
          </Pressable>
          <Pressable style={styles.primaryButton} onPress={() => goToConfirm(trip.id)}>
            <Text style={styles.primaryButtonText}>{t("schoolTrip.selectRide")}</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  const renderChildTripCard = (cs: ChildSearchState, trip: SchoolTrip, diffLabel: string | null) => {
    const info = driverInfo[trip.driverId];
    const isSelected = cs.selectedTripId === trip.id;

    return (
      <View key={trip.id} style={[styles.card, isSelected && localStyles.cardSelected]}>
        <View style={styles.cardHeader}>
          {info?.photoUrl ? (
            <Image source={{ uri: info.photoUrl }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Ionicons name="person" size={20} color="#8B7B6B" />
            </View>
          )}

          <View style={{ flex: 1 }}>
            <Text style={styles.driverName}>{trip.driverName}</Text>
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={13} color="#F58220" />
              <Text style={styles.ratingText}>
                {!info
                  ? "—"
                  : info.ratingCount > 0
                    ? `${info.ratingAverage.toFixed(1)} (${info.ratingCount})`
                    : t("roadsideHelp.newDriverLabel")}
              </Text>
            </View>
          </View>

          <View style={styles.timeBox}>
            <Text style={styles.timeText}>{trip.departureTime}</Text>
            {diffLabel ? <Text style={styles.diffText}>{diffLabel}</Text> : null}
          </View>
        </View>

        <View style={styles.routeRow}>
          <Ionicons name="location-outline" size={15} color="#7C5F46" />
          <Text style={styles.routeText} numberOfLines={1}>
            {trip.fromAddress} → {trip.toAddress}
          </Text>
        </View>

        <View style={styles.footerRow}>
          <Text style={styles.priceText}>{trip.pricePerSeat} ₪</Text>
          <Text style={styles.seatsText}>
            {trip.availableSeats} {t("schoolTrip.seatsLeft")}
          </Text>
        </View>

        <Pressable
          style={[styles.primaryButton, isSelected && localStyles.selectButtonActive, { marginTop: 12 }]}
          onPress={() => selectTripForChild(cs.entry.localId, trip.id)}
        >
          <Text style={styles.primaryButtonText}>
            {isSelected ? t("schoolTrip.tripSelected") : t("schoolTrip.selectRide")}
          </Text>
        </Pressable>
      </View>
    );
  };

  const alternativeDiffLabel = (alt: AlternativeTrip) => {
    if (alt.diffMinutes === 0) return null;
    return alt.isAfterRequestedTime
      ? t("schoolTrip.minutesLater", { count: alt.diffMinutes })
      : t("schoolTrip.minutesEarlier", { count: alt.diffMinutes });
  };

  const renderChildSection = (cs: ChildSearchState, index: number) => {
    const childLabel = cs.entry.childName || t("schoolTrip.childNumber", { number: index + 1 });

    return (
      <View key={cs.entry.localId} style={localStyles.childSection}>
        <View style={localStyles.childSectionHeader}>
          <Text style={localStyles.childSectionTitle}>
            {t("schoolTrip.returnRideForChild", { child: childLabel })}
          </Text>
          {cs.entry.returnRequestedTime ? (
            <Text style={localStyles.childSectionTime}>{cs.entry.returnRequestedTime}</Text>
          ) : null}
        </View>

        {cs.loading ? (
          <View style={localStyles.childLoadingBox}>
            <ActivityIndicator size="small" color="#F58220" />
          </View>
        ) : cs.searchError ? (
          <View style={styles.emptyCard}>
            <Ionicons name="alert-circle-outline" size={28} color="#B91C1C" />
            <Text style={styles.emptyTitle}>{t("schoolTrip.returnSearchFailedForChild", { child: childLabel })}</Text>
          </View>
        ) : cs.skipped ? (
          <View style={localStyles.noReturnBanner}>
            <Ionicons name="checkmark-circle-outline" size={18} color="#7C5F46" />
            <Text style={localStyles.noReturnBannerText}>{t("schoolTrip.noReturnNeeded")}</Text>
            <Pressable onPress={() => skipReturnForChild(cs.entry.localId)}>
              <Text style={localStyles.undoSkipText}>{t("common.cancel")}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {cs.exactTrips.length > 0 ? (
              cs.exactTrips.map((trip) => renderChildTripCard(cs, trip, null))
            ) : (
              <View style={styles.emptyCard}>
                <Ionicons name="calendar-outline" size={28} color="#8B7B6B" />
                <Text style={styles.emptyTitle}>{t("schoolTrip.noExactReturnForChild", { child: childLabel })}</Text>

                {cs.alternatives.length > 0 ? (
                  <Pressable
                    style={styles.showAltButton}
                    onPress={() => toggleChildAlternatives(cs.entry.localId, true)}
                  >
                    <Text style={styles.showAltButtonText}>{t("schoolTrip.alternativeTripsFound")}</Text>
                  </Pressable>
                ) : null}

                <Pressable
                  style={[styles.notifyButton, cs.creatingRequest && { opacity: 0.6 }]}
                  onPress={() => handleNotifyChild(cs)}
                  disabled={cs.creatingRequest || cs.requestCreated}
                >
                  <Ionicons name="notifications-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.notifyButtonText}>
                    {cs.requestCreated
                      ? t("schoolTrip.waitingRequestCreatedTitle")
                      : cs.creatingRequest
                        ? t("driverCreate.creating")
                        : t("schoolTrip.notifyWhenAvailable")}
                  </Text>
                </Pressable>
              </View>
            )}

            {!cs.skipped ? (
              <Pressable style={localStyles.noReturnLink} onPress={() => skipReturnForChild(cs.entry.localId)}>
                <Text style={localStyles.noReturnLinkText}>{t("schoolTrip.noReturnNeeded")}</Text>
              </Pressable>
            ) : null}
          </>
        )}

        <Modal
          visible={cs.showAlternatives}
          animationType="slide"
          transparent
          onRequestClose={() => toggleChildAlternatives(cs.entry.localId, false)}
        >
          <View style={styles.modalOverlay}>
            <Pressable style={styles.modalBackdrop} onPress={() => toggleChildAlternatives(cs.entry.localId, false)} />

            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>{t("schoolTrip.alternativeTripsFound")}</Text>
              <Text style={styles.modalSubtitle}>{t("schoolTrip.noExactTripMessage")}</Text>

              <ScrollView style={{ maxHeight: 420 }}>
                {cs.alternatives.map((alt) => renderChildTripCard(cs, alt.trip, alternativeDiffLabel(alt)))}
              </ScrollView>

              <Pressable
                style={[styles.notifyButton, cs.creatingRequest && { opacity: 0.6 }]}
                onPress={() => handleNotifyChild(cs)}
                disabled={cs.creatingRequest || cs.requestCreated}
              >
                <Ionicons name="notifications-outline" size={16} color="#FFFFFF" />
                <Text style={styles.notifyButtonText}>
                  {cs.requestCreated
                    ? t("schoolTrip.waitingRequestCreatedTitle")
                    : cs.creatingRequest
                      ? t("driverCreate.creating")
                      : t("schoolTrip.notifyWhenAvailable")}
                </Text>
              </Pressable>

              <Pressable
                style={styles.modalCloseButton}
                onPress={() => toggleChildAlternatives(cs.entry.localId, false)}
              >
                <Text style={styles.modalCloseText}>{t("common.cancel")}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </View>
    );
  };

  const anyChildLoading = childStates.some((cs) => cs.loading);
  const firstSelectedTrip = childStates.find((cs) => cs.selectedTripId)?.selectedTripId || null;

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name={isRTL ? "arrow-forward" : "arrow-back"} size={24} color="#7C5F46" />
        </Pressable>
        <Text style={styles.title}>
          {direction === "to_school" ? t("schoolTrip.outboundOnly") : t("schoolTrip.returnFromSchool")}
        </Text>
        <Text style={styles.subtitle}>{params.schoolName}</Text>
      </View>

      {isPerChildReturn ? (
        <>
          {anyChildLoading && childStates.length === 0 ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color="#F58220" />
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.scroll}>
              {firstSelectedTrip && childStates.length > 1 ? (
                <Pressable
                  style={localStyles.useSameAllButton}
                  onPress={() => useSameTripForAll(firstSelectedTrip)}
                >
                  <Ionicons name="copy-outline" size={16} color="#F58220" />
                  <Text style={localStyles.useSameAllButtonText}>{t("schoolTrip.useSameReturnForAll")}</Text>
                </Pressable>
              ) : null}

              {childStates.map((cs, index) => renderChildSection(cs, index))}
            </ScrollView>
          )}

          <View style={localStyles.summaryBar}>
            <View style={localStyles.paymentRow}>
              {(["cash", "bit"] as const).map((method) => (
                <Pressable
                  key={method}
                  style={[localStyles.paymentOption, paymentMethod === method && localStyles.paymentOptionActive]}
                  onPress={() => setPaymentMethod(method)}
                >
                  <Text
                    style={[
                      localStyles.paymentOptionText,
                      paymentMethod === method && localStyles.paymentOptionTextActive,
                    ]}
                  >
                    {method === "cash" ? t("common.cash", { defaultValue: "Cash" }) : "Bit"}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={localStyles.summaryRow}>
              <Text style={localStyles.summaryLabel}>
                {t("schoolTrip.familyBookingSummary", { count: selectedChildren.length })}
              </Text>
              <Text style={localStyles.summaryPrice}>{totalSelectedPrice} ₪</Text>
            </View>

            <Pressable
              style={[
                localStyles.confirmButton,
                (selectedChildren.length === 0 || confirmingReturns) && { opacity: 0.5 },
              ]}
              onPress={handleConfirmReturns}
              disabled={selectedChildren.length === 0 || confirmingReturns}
            >
              {confirmingReturns ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={localStyles.confirmButtonText}>{t("schoolTrip.confirmReturnBookings")}</Text>
              )}
            </Pressable>
          </View>
        </>
      ) : loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#F58220" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {exactTrips.length > 0 ? (
            exactTrips.map((trip) => renderTripCard(trip, null))
          ) : (
            <View style={styles.emptyCard}>
              <Ionicons name="calendar-outline" size={34} color="#8B7B6B" />
              <Text style={styles.emptyTitle}>{t("schoolTrip.noExactTrip")}</Text>

              {alternatives.length > 0 ? (
                <Pressable
                  style={styles.showAltButton}
                  onPress={() => setShowAlternatives(true)}
                >
                  <Text style={styles.showAltButtonText}>
                    {t("schoolTrip.alternativeTripsFound")}
                  </Text>
                </Pressable>
              ) : null}

              {direction === "from_school" ? (
                <Pressable
                  style={[styles.notifyButton, creatingRequest && { opacity: 0.6 }]}
                  onPress={handleNotifyMe}
                  disabled={creatingRequest}
                >
                  <Ionicons name="notifications-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.notifyButtonText}>
                    {creatingRequest ? t("driverCreate.creating") : t("schoolTrip.notifyWhenAvailable")}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </ScrollView>
      )}

      {!isPerChildReturn ? (
        <Modal visible={showAlternatives} animationType="slide" transparent onRequestClose={() => setShowAlternatives(false)}>
          <View style={styles.modalOverlay}>
            <Pressable style={styles.modalBackdrop} onPress={() => setShowAlternatives(false)} />

            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>{t("schoolTrip.alternativeTripsFound")}</Text>
              <Text style={styles.modalSubtitle}>{t("schoolTrip.noExactTripMessage")}</Text>

              <ScrollView style={{ maxHeight: 420 }}>
                {alternatives.map((alt) => renderTripCard(alt.trip, alternativeDiffLabel(alt)))}
              </ScrollView>

              {direction === "from_school" ? (
                <Pressable
                  style={[styles.notifyButton, creatingRequest && { opacity: 0.6 }]}
                  onPress={handleNotifyMe}
                  disabled={creatingRequest}
                >
                  <Ionicons name="notifications-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.notifyButtonText}>
                    {creatingRequest ? t("driverCreate.creating") : t("schoolTrip.notifyWhenAvailable")}
                  </Text>
                </Pressable>
              ) : null}

              <Pressable style={styles.modalCloseButton} onPress={() => setShowAlternatives(false)}>
                <Text style={styles.modalCloseText}>{t("common.cancel")}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#FBF7F1" },
  header: { paddingHorizontal: 20, paddingTop: 50, paddingBottom: 8 },
  backButton: { width: 40, height: 40, justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "900", color: "#111827", marginTop: 4 },
  subtitle: { fontSize: 14, color: "#7C5F46", fontWeight: "700", marginTop: 2 },
  loadingBox: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: 20, paddingTop: 8, paddingBottom: 40 },
  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E7DCD1",
    padding: 28,
    alignItems: "center",
    gap: 10,
  },
  emptyTitle: { fontSize: 15, fontWeight: "800", color: "#111827", textAlign: "center" },
  showAltButton: {
    backgroundColor: "#FFF2E8",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginTop: 6,
  },
  showAltButtonText: { color: "#F58220", fontWeight: "900" },
  notifyButton: {
    backgroundColor: "#F58220",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
  },
  notifyButtonText: { color: "#FFFFFF", fontWeight: "900" },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E7DCD1",
    padding: 16,
    marginBottom: 14,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F3ECE3",
    alignItems: "center",
    justifyContent: "center",
  },
  driverName: { fontWeight: "900", color: "#111827", fontSize: 15 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  ratingText: { fontSize: 12, color: "#7C5F46", fontWeight: "700" },
  timeBox: { alignItems: "flex-end" },
  timeText: { fontSize: 18, fontWeight: "900", color: "#F58220" },
  diffText: { fontSize: 11, color: "#7C5F46", fontWeight: "700" },
  routeRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  routeText: { flex: 1, color: "#111827", fontWeight: "700", fontSize: 13 },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
  },
  priceText: { fontWeight: "900", color: "#111827", fontSize: 15 },
  seatsText: { color: "#7C5F46", fontWeight: "700", fontSize: 13 },
  buttonRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  secondaryButtonText: { color: "#7C5F46", fontWeight: "800" },
  primaryButton: {
    flex: 1,
    backgroundColor: "#F58220",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "900" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)", justifyContent: "flex-end" },
  modalBackdrop: { flex: 1 },
  modalSheet: {
    backgroundColor: "#FBF7F1",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    padding: 20,
    paddingBottom: 34,
  },
  modalHandle: {
    width: 46,
    height: 5,
    borderRadius: 20,
    backgroundColor: "#D8C9BC",
    alignSelf: "center",
    marginBottom: 14,
  },
  modalTitle: { fontSize: 19, fontWeight: "900", color: "#111827" },
  modalSubtitle: { fontSize: 13, color: "#7C5F46", marginTop: 4, marginBottom: 14, fontWeight: "600" },
  modalCloseButton: { alignItems: "center", paddingVertical: 12, marginTop: 4 },
  modalCloseText: { color: "#7C5F46", fontWeight: "800" },
});

const localStyles = StyleSheet.create({
  cardSelected: { borderColor: "#F58220", borderWidth: 2 },
  selectButtonActive: { backgroundColor: "#2E7D32" },
  useSameAllButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFF2E8",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 16,
    alignSelf: "flex-start",
  },
  useSameAllButtonText: { color: "#F58220", fontWeight: "900", fontSize: 13 },
  childSection: {
    marginBottom: 24,
    borderTopWidth: 1,
    borderTopColor: "#EADFD3",
    paddingTop: 16,
  },
  childSectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  childSectionTitle: { fontSize: 16, fontWeight: "900", color: "#111827" },
  childSectionTime: { fontSize: 13, fontWeight: "800", color: "#F58220" },
  childLoadingBox: { paddingVertical: 24, alignItems: "center" },
  noReturnBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#F3ECE3",
    borderRadius: 12,
    padding: 14,
  },
  noReturnBannerText: { flex: 1, color: "#7C5F46", fontWeight: "800", fontSize: 13 },
  undoSkipText: { color: "#F58220", fontWeight: "900", fontSize: 13 },
  noReturnLink: { alignItems: "center", paddingVertical: 10 },
  noReturnLinkText: { color: "#7C5F46", fontWeight: "800", fontSize: 13, textDecorationLine: "underline" },
  summaryBar: {
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#E7DCD1",
    padding: 16,
    paddingBottom: 26,
    gap: 10,
  },
  paymentRow: { flexDirection: "row", gap: 10 },
  paymentOption: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: "center",
  },
  paymentOptionActive: { backgroundColor: "#FFF2E8", borderColor: "#F58220" },
  paymentOptionText: { color: "#7C5F46", fontWeight: "800", fontSize: 13 },
  paymentOptionTextActive: { color: "#F58220" },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryLabel: { color: "#7C5F46", fontWeight: "800", fontSize: 13 },
  summaryPrice: { color: "#111827", fontWeight: "900", fontSize: 18 },
  confirmButton: {
    backgroundColor: "#F58220",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  confirmButtonText: { color: "#FFFFFF", fontWeight: "900", fontSize: 15 },
});
