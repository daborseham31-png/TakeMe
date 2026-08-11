import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  ImageBackground,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { auth, db } from "../../firebase";
import { fetchDriverEligibility, getDriverEligibilityAlertCopy } from "../driver/driverEligibility";
import {
  DirectionalCard,
  DirectionalRow,
  DirectionalScreen,
  DirectionalText,
  PhysicalDirectionalBlockText,
} from "../i18n/DirectionalPrimitives";
import { useLanguage } from "../i18n/LanguageProvider";
import { positionEnd } from "../i18n/rtl";
import {
  attachDistances,
  attachRouteMatches,
  buildErrandBookNav,
  buildQuickRideNav,
  buildSchoolTripNav,
  buildWeeklyRideNav,
  buildWorkApplyNav,
  computeRouteMatchesForPersonalRides,
  FEED_PAGE_SIZE,
  FeedCategory,
  FeedItem,
  filterNearbyOrRouteMatchedItems,
  isRideExpired,
  NEARBY_RIDE_RADIUS_KM,
  sortFeedItems,
  subscribeHomeFeed,
} from "../booking/homeFeedLib";
import { RouteMatchResult } from "../booking/routeMatchLib";
import { useCurrentLocation } from "../booking/useCurrentLocation";
import { WeeklyDriverDay } from "../booking/weeklyBookingLib";
import TripFeedCard from "../booking/TripFeedCard";
import DriverProfileReviewsModal from "../booking/DriverProfileReviewsModal";
import PickupLocationPicker, { PickupLocation } from "../booking/PickupLocationPicker";
import ChildSelector, { SelectedChildEntry } from "../booking/school/ChildSelector";

// Re-checked once a minute while Home stays open (plus on pull-to-refresh /
// focus) so a ride whose departure time has passed disappears from the list
// even without a new Firestore snapshot arriving.
const EXPIRY_RECHECK_INTERVAL_MS = 60000;

type RideDisplayMode = "nearby" | "all";

// Combined pin+map + "Takeme" wordmark, transparent background, trimmed to
// its content box.
const logoImg = require("../../assets/images/TakeMe_header_logo.png");

type FilterKey = "all" | FeedCategory;

// "school" is one visible chip covering BOTH the legacy driverRoutes school
// category and the newer schoolTrips-collection category — selecting it
// reveals a second inline row (all / outbound / return / round trip) above
// the rides list rather than a second separate top-level chip. See
// schoolDirectionFilter.
const FILTER_KEYS: FilterKey[] = ["all", "personal", "school", "work", "errand"];

type SchoolDirectionFilter = "all" | "outbound" | "return" | "round";

const SCHOOL_DIRECTION_OPTIONS: { key: SchoolDirectionFilter; labelKey: string }[] = [
  { key: "all", labelKey: "common.all" },
  { key: "outbound", labelKey: "schoolTrip.outboundOnly" },
  { key: "return", labelKey: "schoolTrip.returnOnly" },
  { key: "round", labelKey: "schoolTrip.roundTrip" },
];

const FILTER_ICONS: Record<FilterKey, keyof typeof Ionicons.glyphMap> = {
  all: "apps-outline",
  personal: "person-outline",
  school: "school-outline",
  schoolTrip: "school-outline",
  work: "briefcase-outline",
  errand: "location-outline",
};

export default function HomeScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const [unreadHelp, setUnreadHelp] = useState(0);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [checkingDriver, setCheckingDriver] = useState(false);

  // --- "Trips near you" feed --------------------------------------------
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");

  // --- Initial-viewport scroll layout ------------------------------------
  // A single vertical ScrollView (no nested ScrollView/FlatList) holds the
  // whole screen. "aboveFoldHeight" is the measured height of
  // header+hero+action-cards; "scrollViewportHeight" is the ScrollView's
  // own visible height. The Nearby-rides preview panel below (see its
  // minHeight+justifyContent:"flex-end" further down) fills the remaining
  // space between them, so it always sits flush above the tab bar, with the
  // ride cards/filters starting only after it. "nearbySectionY" is the
  // measured Y (within the ScrollView's own content, which onLayout already
  // reports in) of where that "rest" content begins — the chevron scrolls
  // there.
  const scrollViewRef = useRef<ScrollView>(null);
  const { height: windowHeight } = useWindowDimensions();
  const [scrollViewportHeight, setScrollViewportHeight] = useState(0);
  const [aboveFoldHeight, setAboveFoldHeight] = useState(0);
  const [nearbySectionY, setNearbySectionY] = useState(0);
  // Falls back to the raw window height until the ScrollView's own onLayout
  // fires, so the preview panel starts close to its final size right away
  // instead of snapping from "no gap" to "full gap" a frame later.
  const effectiveViewportHeight = scrollViewportHeight || windowHeight;

  const scrollToNearbyRides = useCallback(() => {
    scrollViewRef.current?.scrollTo({ y: Math.max(0, nearbySectionY - 80), animated: true });
  }, [nearbySectionY]);

  // GPS-based nearby/all mode — see useCurrentLocation.ts. Foreground-only,
  // never tracked in the background, never saved to Firestore.
  const {
    state: locationState,
    coords,
    canAskAgain,
    refresh: refreshLocation,
    requestPermission: requestLocationPermission,
  } = useCurrentLocation();
  const [mode, setMode] = useState<RideDisplayMode>("nearby");
  const [schoolDirectionFilter, setSchoolDirectionFilter] =
    useState<SchoolDirectionFilter>("all");

  // Ticks once a minute (plus on refresh/focus) purely to force expired
  // rides out of visibleFeedItems below — never re-fetches from Firestore.
  const [expiryTick, setExpiryTick] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(
      () => setExpiryTick(Date.now()),
      EXPIRY_RECHECK_INTERVAL_MS,
    );
    return () => clearInterval(interval);
  }, []);

  const [reviewsDriverId, setReviewsDriverId] = useState<string | null>(null);
  const [reviewsDriverName, setReviewsDriverName] = useState("");

  const [dayPickerItem, setDayPickerItem] = useState<FeedItem | null>(null);
  const [dayPickerSelected, setDayPickerSelected] = useState<Set<string>>(
    new Set(),
  );
  // Set only for a weekly School Ride item (never weekly Personal Ride) —
  // the child(ren) already confirmed on the child-select step BEFORE the day
  // picker opens for this item, carried through confirmDayPicker's own seat
  // check into beginPickupSelection. Cleared whenever the day picker closes,
  // same lifetime as dayPickerItem/dayPickerSelected.
  const [dayPickerChildEntries, setDayPickerChildEntries] = useState<SelectedChildEntry[] | null>(
    null,
  );

  // Pickup-location step for Home/Nearby bookings (Personal Ride, School
  // Ride quick/weekly, School Trip outbound) — the exact same
  // PickupLocationPicker sheet the internal category screens
  // (personal-ride/index.tsx, DirectionSearchForm.tsx) already use, so a
  // booking made straight from Home always gets a real pickup point instead
  // of skipping straight to ride-payment/trip-confirm with none. Work/Errand
  // need no equivalent here — buildWorkApplyNav/buildErrandBookNav already
  // send those straight to apply.tsx/book.tsx, which have this same picker
  // built in and require it before submitting regardless of entry point.
  const [pickupPickerVisible, setPickupPickerVisible] = useState(false);
  const [pendingBookItem, setPendingBookItem] = useState<FeedItem | null>(null);
  const [pendingWeeklyDays, setPendingWeeklyDays] = useState<WeeklyDriverDay[] | null>(null);
  // Carried alongside pendingBookItem/pendingWeeklyDays from the child-select
  // step below through to whichever buildSchoolTripNav call actually fires
  // (with or without a pickup step) — never re-derived, never defaulted back
  // to "no children" once set.
  const [pendingChildEntries, setPendingChildEntries] = useState<SelectedChildEntry[] | null>(null);

  // School Trip's own child-selection gate, inserted between the card's
  // "View details"/"Select ride" press and the pickup-location step (or the
  // direct push for a return-leg card, which has no pickup step at all) —
  // mirrors dayPickerItem below (pending item + a modal keyed off it), and
  // reuses the exact same ChildSelector component select-child.tsx uses for
  // the main School Ride category entry, never a second child picker.
  const [childSelectItem, setChildSelectItem] = useState<FeedItem | null>(null);

  // Live count of unread roadside help notifications for the signed-in driver.
  // Single equality filter keeps this index-free; unread count is computed here.
  useEffect(() => {
    let unsubNotifications: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubNotifications) {
        unsubNotifications();
        unsubNotifications = null;
      }

      if (!user) {
        setUnreadHelp(0);
        return;
      }

      const q = query(
        collection(db, "driverNotifications"),
        where("driverId", "==", user.uid),
      );

      unsubNotifications = onSnapshot(
        q,
        (snap) => {
          const count = snap.docs.filter(
            (d) => d.data().read === false && d.data().status !== "rejected",
          ).length;
          setUnreadHelp(count);
        },
        () => setUnreadHelp(0),
      );
    });

    return () => {
      if (unsubNotifications) unsubNotifications();
      unsubAuth();
    };
  }, []);

  // Live unread notifications for the signed-in user — single-filter query,
  // index-free. (Unread chat count now lives on the Messages tab icon
  // itself, in (tabs)/_layout.tsx, since chat moved off this screen.)
  useEffect(() => {
    let unsubNotifs: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      unsubNotifs?.();
      unsubNotifs = null;

      if (!user) {
        setUnreadNotifs(0);
        return;
      }

      unsubNotifs = onSnapshot(
        query(collection(db, "notifications"), where("userId", "==", user.uid)),
        (snap) => {
          setUnreadNotifs(
            snap.docs.filter(
              (d) => d.data().read === false && d.data().deleted !== true,
            ).length,
          );
        },
        () => setUnreadNotifs(0),
      );
    });

    return () => {
      unsubNotifs?.();
      unsubAuth();
    };
  }, []);

  // Trips near you — one combined, live-updating feed (see homeFeedLib.ts).
  // Subscribed exactly once for the component's lifetime; onSnapshot already
  // keeps the list live, so pull-to-refresh / Nearby-All switching only ever
  // re-filters this same already-loaded array — no extra Firebase reads.
  //
  // Gated behind onAuthStateChanged (like the two listener effects above) —
  // driverRoutes/workJobs/errandJobs all require a signed-in caller per
  // firestore.rules. Subscribing unconditionally on mount could race ahead
  // of Firebase Auth's async rehydration on cold start (auth.currentUser is
  // briefly null until the first onAuthStateChanged callback), throwing
  // "Missing or insufficient permissions" for that first connection attempt.
  useEffect(() => {
    let cancelled = false;
    let unsubFeed: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      unsubFeed?.();
      unsubFeed = null;

      if (!user) {
        setFeedItems([]);
        setFeedLoading(false);
        setRefreshing(false);
        return;
      }

      setFeedLoading(true);

      unsubFeed = subscribeHomeFeed(
        (items) => {
          if (cancelled) return;
          setFeedItems(items);
          setFeedLoading(false);
          setRefreshing(false);
        },
        () => {
          if (cancelled) return;
          setFeedLoading(false);
          setRefreshing(false);
        },
      );
    });

    return () => {
      cancelled = true;
      unsubFeed?.();
      unsubAuth();
    };
  }, []);

  // Re-check location every time Home regains focus (app foregrounded,
  // navigated back to this tab) — this is what makes "nearby" update when
  // the user has physically moved to a different city. Silent: never
  // re-prompts the system permission dialog on its own.
  useFocusEffect(
    useCallback(() => {
      refreshLocation();
      setExpiryTick(Date.now());
    }, [refreshLocation]),
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setExpiryTick(Date.now());
    refreshLocation().finally(() => setRefreshing(false));
  }, [refreshLocation]);

  // "Nearby" only ever actually applies once we have granted permission AND
  // a current fix — otherwise we silently fall back to "All rides" without
  // blocking the screen (denied / services-disabled / unavailable banners
  // below explain why).
  const effectiveMode: RideDisplayMode =
    mode === "nearby" && locationState === "granted" && coords
      ? "nearby"
      : "all";

  // expiryTick is read only to force this memo to re-run on the periodic
  // tick/refresh/focus above — isRideExpired always uses the real current
  // time, never the tick value itself.
  const categoryFilteredItems = useMemo(
    () => {
      const base =
        filter === "all"
          ? feedItems
          : filter === "school"
            ? feedItems.filter(
                (item) => item.category === "school" || item.category === "schoolTrip",
              )
            : feedItems.filter((item) => item.category === filter);

      // Direction sub-filter, school only. "all" is the default, unrestricted
      // view; "outbound"/"return" narrow to exactly one direction (legacy
      // "school" items carry no direction at all, so they only ever show
      // under "all" — see homeFeedLib.ts); "round" keeps only schoolTrip legs
      // that were created together with their outbound/return counterpart
      // (linkedTripId set — see homeFeedLib.ts's FeedItem.linkedTripId).
      const directionFiltered =
        filter !== "school" || schoolDirectionFilter === "all"
          ? base
          : schoolDirectionFilter === "round"
            ? base.filter((item) => !!item.linkedTripId)
            : base.filter(
                (item) =>
                  item.direction ===
                  (schoolDirectionFilter === "outbound" ? "to_school" : "from_school"),
              );

      return directionFiltered.filter((item) => !isRideExpired(item));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feedItems, filter, schoolDirectionFilter, expiryTick],
  );

  const itemsWithDistance = useMemo(
    () => attachDistances(categoryFilteredItems, coords),
    [categoryFilteredItems, coords],
  );

  // Route-based/detour-aware matching (see routeMatchLib.ts) — a fully
  // local, free, synchronous geometric approximation (no network call, no
  // API key), so this is just another useMemo, computed only for
  // "personal" items and only while in "nearby" mode (the only place
  // eligibility actually depends on it; "All rides" ignores it below).
  const routeMatches = useMemo(() => {
    if (effectiveMode !== "nearby" || !coords) return new Map<string, RouteMatchResult>();

    const personalCandidates = categoryFilteredItems.filter(
      (item) => item.category === "personal",
    );
    if (personalCandidates.length === 0) return new Map<string, RouteMatchResult>();

    return computeRouteMatchesForPersonalRides(personalCandidates, coords);
  }, [categoryFilteredItems, coords, effectiveMode]);

  const itemsWithRouteMatch = useMemo(
    () => attachRouteMatches(itemsWithDistance, routeMatches),
    [itemsWithDistance, routeMatches],
  );

  const nearbyItems = useMemo(
    () => sortFeedItems(filterNearbyOrRouteMatchedItems(itemsWithRouteMatch)),
    [itemsWithRouteMatch],
  );

  const allItemsSorted = useMemo(
    () => sortFeedItems(itemsWithRouteMatch),
    [itemsWithRouteMatch],
  );

  const visibleFeedItems = (
    effectiveMode === "nearby" ? nearbyItems : allItemsSorted
  ).slice(0, FEED_PAGE_SIZE);

  // Nearby mode found nothing but there ARE other available items — offer a
  // one-tap way to see them instead of a dead end.
  const nearbyIsEmptyButOthersExist =
    effectiveMode === "nearby" &&
    nearbyItems.length === 0 &&
    allItemsSorted.length > 0;

  const handlePressNearbyTab = () => {
    setMode("nearby");
    if (locationState !== "granted") {
      requestLocationPermission();
    }
  };

  const openDayPicker = (item: FeedItem) => {
    setDayPickerItem(item);
    setDayPickerSelected(new Set(item.availableWeeklyDays.map((d) => d.date)));
  };

  const closeDayPicker = () => {
    setDayPickerItem(null);
    setDayPickerSelected(new Set());
    setDayPickerChildEntries(null);
  };

  const toggleDaySelection = (date: string) => {
    setDayPickerSelected((prev) => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  };

  const confirmDayPicker = () => {
    if (!dayPickerItem) return;

    const chosen: WeeklyDriverDay[] = dayPickerItem.availableWeeklyDays.filter(
      (d) => dayPickerSelected.has(d.date),
    );

    if (chosen.length === 0) {
      Alert.alert(t("rides.chooseDayTitle"), t("rides.chooseDayMessage"));
      return;
    }

    // Weekly School only (dayPickerChildEntries is never set for weekly
    // Personal Ride — see handleChildSelectionContinue) — one seat per
    // selected child is required on EVERY chosen day, not just one. This is
    // a convenience check; createWeeklyBookings' own Firestore transaction
    // re-verifies remainingSeats server-side regardless (see
    // weeklyBookingLib.ts), so this can never be bypassed by racing it.
    if (dayPickerChildEntries && dayPickerChildEntries.length > 0) {
      const shortOnSeats = chosen.some(
        (day) => day.remainingSeats < dayPickerChildEntries.length,
      );

      if (shortOnSeats) {
        Alert.alert(t("common.error"), t("rides.notEnoughSeats"));
        return;
      }
    }

    const item = dayPickerItem;
    const childEntries = dayPickerChildEntries;
    closeDayPicker();

    // Chosen days aren't booked yet — next comes the same pickup-location
    // step every other path below goes through.
    beginPickupSelection(item, chosen, childEntries);
  };

  // Opens the shared PickupLocationPicker sheet before continuing on to
  // ride-payment/trip-confirm — mirrors "select ride -> confirm pickup
  // location -> continue" from the internal Personal Ride / School screens,
  // which this same booking button previously skipped entirely when reached
  // from Home. weeklyDays is null for a quick (single-day) or school-trip
  // booking, and the chosen days for a weekly one.
  const beginPickupSelection = (
    item: FeedItem,
    weeklyDays: WeeklyDriverDay[] | null,
    childEntries: SelectedChildEntry[] | null = null,
  ) => {
    setPendingBookItem(item);
    setPendingWeeklyDays(weeklyDays);
    setPendingChildEntries(childEntries);
    setPickupPickerVisible(true);
  };

  // Fires once the passenger actually confirms a pickup point (current
  // location / Home / a saved place / a dropped pin) — never on cancel, so
  // no booking is ever created without one. See PickupLocationPicker.tsx:
  // onSelect is only ever called together with a real confirmed location,
  // immediately followed by the sheet closing itself.
  const handlePickupSelected = (pickupLocation: PickupLocation) => {
    const item = pendingBookItem;
    const weeklyDays = pendingWeeklyDays;
    const childEntries = pendingChildEntries;
    setPendingBookItem(null);
    setPendingWeeklyDays(null);
    setPendingChildEntries(null);

    if (!item) return;

    if (item.category === "schoolTrip") {
      router.push(buildSchoolTripNav(item, pickupLocation, childEntries) as any);
      return;
    }

    if (weeklyDays) {
      router.push(buildWeeklyRideNav(item, weeklyDays, pickupLocation, childEntries) as any);
      return;
    }

    router.push(buildQuickRideNav(item, pickupLocation) as any);
  };

  const closeChildSelect = () => setChildSelectItem(null);

  // Fires once the passenger has picked ≥1 child and pressed Continue on the
  // child-select sheet (ChildSelector's own Continue is disabled until then
  // — nothing here is ever reached with an empty roster). A standalone
  // return-leg card has no pickup step at all (see handleBookPress's own
  // comment), so it goes straight to buildSchoolTripNav; every other
  // schoolTrip card continues into the SAME pickup-location step every other
  // Home booking already goes through, just now carrying the chosen
  // children forward through it.
  const handleChildSelectionContinue = (entries: SelectedChildEntry[]) => {
    const item = childSelectItem;
    setChildSelectItem(null);

    if (!item) return;

    // Weekly School Ride — the day picker (which day(s) of the driver's
    // week to book) still comes next, same as it always has; the chosen
    // children just ride along into it (see confirmDayPicker's own seat
    // check) instead of straight into the pickup step.
    if (item.category === "school" && item.isWeekly) {
      setDayPickerChildEntries(entries);
      openDayPicker(item);
      return;
    }

    if (item.direction === "from_school") {
      router.push(buildSchoolTripNav(item, null, entries) as any);
      return;
    }

    beginPickupSelection(item, null, entries);
  };

  const handleBookPress = (item: FeedItem) => {
    if (item.category === "work") {
      router.push(buildWorkApplyNav(item) as any);
      return;
    }

    if (item.category === "errand") {
      router.push(buildErrandBookNav(item) as any);
      return;
    }

    if (item.category === "schoolTrip") {
      // Every School Trip card — outbound, return-leg, exact, or
      // alternative — shares this one handler, so gating it here covers all
      // of them. The child-select step decides for itself (via
      // handleChildSelectionContinue) whether a pickup step follows, since a
      // standalone return-leg card still has none (same as
      // DirectionSearchForm.tsx, which never shows that field for a return
      // search either — the real pickup point is the school itself).
      setChildSelectItem(item);
      return;
    }

    // A published Weekly School Ride (legacy driverRoutes, category
    // "school") — gated the SAME as School Trip above, before the day
    // picker even opens (handleChildSelectionContinue opens it once
    // children are confirmed). Checked ahead of the generic `isWeekly`
    // branch below so weekly Personal Ride (category "personal") keeps
    // going straight into openDayPicker, completely unaffected.
    if (item.category === "school" && item.isWeekly) {
      setChildSelectItem(item);
      return;
    }

    if (item.isWeekly) {
      openDayPicker(item);
      return;
    }

    beginPickupSelection(item, null);
  };

  const handleBecomeDriver = async () => {
    const user = auth.currentUser;

    if (!user) {
      router.replace("/");
      return;
    }

    if (checkingDriver) return;

    setCheckingDriver(true);

    try {
      const eligibility = await fetchDriverEligibility(user.uid);

      if (eligibility.eligible) {
        router.push("/driver/add-route" as any);
        return;
      }

      // pending_admin_approval/rejected/suspended all mean the driver
      // already completed license verification — show why they're blocked
      // and stay on Home, never send them back to re-upload a license they
      // already submitted.
      if (
        eligibility.status === "pending_admin_approval" ||
        eligibility.status === "rejected" ||
        eligibility.status === "suspended"
      ) {
        const copy = getDriverEligibilityAlertCopy(eligibility.status, t);
        Alert.alert(copy.title, copy.message);
        return;
      }

      if (eligibility.status === "license_expired") {
        Alert.alert(
          t("driver.licenseExpired"),
          t("driver.licenseExpiredMessage"),
        );
      }

      // not_registered, license_missing, and languages_missing all land on
      // the same verification screen.
      router.push("/driver/verify-license" as any);
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("driver.couldNotCheckStatus"));
    } finally {
      setCheckingDriver(false);
    }
  };

  // Display-order-only reversal for these two static filter arrays — never
  // changes which key a chip represents or which filter is currently
  // selected (that's still keyed by the real FILTER_KEYS/
  // SCHOOL_DIRECTION_OPTIONS values via `filter`/`schoolDirectionFilter`),
  // only what order the FlatList physically renders them in. Reversing the
  // rendered DATA is what actually works for a horizontal FlatList — its
  // internal scroll/virtualization does not reliably mirror via a
  // flexDirection style the way a plain View row does.
  const visibleFilterKeys = isRTL ? [...FILTER_KEYS].reverse() : FILTER_KEYS;
  const visibleSchoolDirectionOptions = isRTL
    ? [...SCHOOL_DIRECTION_OPTIONS].reverse()
    : SCHOOL_DIRECTION_OPTIONS;

  const listHeader = (
    <View>
      {/* Header + hero + action cards, measured as one block so the
          "Nearby rides" title row below can be pinned to the bottom of the
          first screen (see aboveFoldHeight/scrollViewportHeight above). */}
      <View onLayout={(e) => setAboveFoldHeight(e.nativeEvent.layout.height)}>
      {/* Top brand row: logo + wordmark on the left, notification icons on
          the right (Instagram/Facebook style). */}
      <View style={styles.topBar}>
        <View style={styles.brandRow}>
          <Image
            source={logoImg}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        <View style={styles.topBarIcons}>
          <Pressable
            style={styles.iconButton}
            onPress={() => router.push("/notifications" as any)}
            hitSlop={8}
          >
            <Ionicons name="notifications-outline" size={22} color="#7C5F46" />
            {unreadNotifs > 0 ? (
              <View style={[styles.iconBadge, positionEnd(-3, isRTL)]}>
                <Text style={styles.iconBadgeText}>
                  {unreadNotifs > 99 ? "99+" : unreadNotifs}
                </Text>
              </View>
            ) : null}
          </Pressable>

          <Pressable
            style={styles.iconButton}
            onPress={() => router.push("/driver/help-requests" as any)}
            hitSlop={8}
          >
            <Ionicons name="help-buoy-outline" size={22} color="#7C5F46" />
            {unreadHelp > 0 ? (
              <View style={[styles.iconBadge, positionEnd(-3, isRTL)]}>
                <Text style={styles.iconBadgeText}>
                  {unreadHelp > 99 ? "99+" : unreadHelp}
                </Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>

      {/* Page headline + subtitle — sit above the hero image itself (plain
          page background), not overlaid on the photo. */}
      <View style={styles.heroPageTextBlock}>
        <PhysicalDirectionalBlockText style={styles.heroTitle}>
          {t("home.whereToGo")}
        </PhysicalDirectionalBlockText>

        <PhysicalDirectionalBlockText style={styles.heroDescription}>
          {t("home.heroDescription")}
        </PhysicalDirectionalBlockText>
      </View>

      {/* --- Hero: the real illustration (assets/images/hero-car.png) as the
          card's background image — car + road + pin live inside the photo
          itself, never redrawn in code, shown clean with no overlay. --- */}
      <View style={styles.heroWrap}>
        <ImageBackground
          source={require("../../assets/images/hero-car.png")}
          resizeMode="cover"
          style={styles.hero}
          imageStyle={styles.heroBgImage}
        />
      </View>

      {/* --- Two big action cards, below (not inside) the hero card --- */}
      <View style={styles.actionCardsWrap}>
        <Pressable
          style={({ pressed }) => [pressed && styles.heroRowPressed]}
          onPress={() => router.push("/booking/ride-category" as any)}
        >
          <DirectionalRow style={styles.actionCard}>
            <View style={styles.actionCardIcon}>
              <Ionicons name="search" size={20} color="#F58220" />
            </View>
            <View style={styles.heroRowText}>
              <Text
                style={[
                  styles.actionCardTitle,
                  {
                    width: "100%",
                    textAlign: isRTL ? "right" : "left",
                    writingDirection: isRTL ? "rtl" : "ltr",
                  },
                ]}
              >
                {t("home.findARide")}
              </Text>
              <Text
                style={[
                  styles.heroRowSubtitle,
                  {
                    width: "100%",
                    textAlign: isRTL ? "right" : "left",
                    writingDirection: isRTL ? "rtl" : "ltr",
                  },
                ]}
              >
                {t("home.findARideSubtitle")}
              </Text>
            </View>
            <View style={styles.actionCardArrow}>
              <Ionicons
                name={isRTL ? "arrow-back" : "arrow-forward"}
                size={16}
                color="#F58220"
              />
            </View>
          </DirectionalRow>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            pressed && styles.heroRowPressed,
            checkingDriver && styles.outlineButtonDisabled,
          ]}
          onPress={handleBecomeDriver}
          disabled={checkingDriver}
        >
          <DirectionalRow style={styles.actionCard}>
            <View style={styles.actionCardIcon}>
              {checkingDriver ? (
                <ActivityIndicator size="small" color="#F58220" />
              ) : (
                <Ionicons name="car-sport-outline" size={20} color="#F58220" />
              )}
            </View>
            <View style={styles.heroRowText}>
              <Text
                style={[
                  styles.actionCardTitle,
                  {
                    width: "100%",
                    textAlign: isRTL ? "right" : "left",
                    writingDirection: isRTL ? "rtl" : "ltr",
                  },
                ]}
              >
                {t("home.becomeADriver")}
              </Text>
              <Text
                style={[
                  styles.heroRowSubtitle,
                  {
                    width: "100%",
                    textAlign: isRTL ? "right" : "left",
                    writingDirection: isRTL ? "rtl" : "ltr",
                  },
                ]}
              >
                {t("home.becomeADriverSubtitle")}
              </Text>
            </View>
            <View style={styles.actionCardArrow}>
              <Ionicons
                name={isRTL ? "arrow-back" : "arrow-forward"}
                size={16}
                color="#F58220"
              />
            </View>
          </DirectionalRow>
        </Pressable>
      </View>
      </View>

      {/* "Nearby rides" preview panel — a light-beige panel that fills
          whatever's left of the first screen below the header/hero/action
          cards (minHeight bounds it to the remaining space, so it still
          always sits flush above the tab bar). The title row is centered
          in that space rather than glued to the very bottom, so it doesn't
          read as one big empty block under it — some breathing room above
          and below instead of all of it below. Only the icon/title/
          subtitle/chevron row show here; the filters/ride cards start below
          it, off-screen until the user scrolls or taps the chevron. */}
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: "#EFE3D6",
          marginTop: 6,
          paddingTop: 20,
          paddingBottom: 24,
          paddingHorizontal: 20,
          minHeight: Math.max(0, effectiveViewportHeight - aboveFoldHeight),
          justifyContent: "center",
        }}
      >
        {/* Nearby / All toggle — moved above the "Nearby rides" title so
            it's visible right away, not tucked below the fold. */}
        <DirectionalRow style={[styles.modeRow, { marginTop: 0, marginBottom: 14 }]}>
          <Pressable onPress={handlePressNearbyTab}>
            <DirectionalRow
              style={[
                styles.modeButton,
                mode === "nearby" && styles.modeButtonActive,
              ]}
            >
              <Ionicons
                name="navigate"
                size={14}
                color={mode === "nearby" ? "#FFFFFF" : "#7C5F46"}
              />
              <DirectionalText
                style={[
                  styles.modeButtonText,
                  mode === "nearby" && styles.modeButtonTextActive,
                ]}
              >
                {t("home.nearby")}
              </DirectionalText>
            </DirectionalRow>
          </Pressable>

          <Pressable onPress={() => setMode("all")}>
            <DirectionalRow
              style={[
                styles.modeButton,
                mode === "all" && styles.modeButtonActive,
              ]}
            >
              <Ionicons
                name="globe-outline"
                size={14}
                color={mode === "all" ? "#FFFFFF" : "#7C5F46"}
              />
              <DirectionalText
                style={[
                  styles.modeButtonText,
                  mode === "all" && styles.modeButtonTextActive,
                ]}
              >
                {t("home.allRides")}
              </DirectionalText>
            </DirectionalRow>
          </Pressable>
        </DirectionalRow>

        <DirectionalRow style={styles.feedTitleRow}>
          <View style={styles.feedTitleIcon}>
            <Ionicons name="navigate" size={16} color="#F58220" />
          </View>
          <View style={{ flex: 1 }}>
            <PhysicalDirectionalBlockText style={styles.feedTitle}>
              {effectiveMode === "nearby"
                ? t("home.nearbyRides")
                : t("home.allAvailableRides")}
            </PhysicalDirectionalBlockText>
            <PhysicalDirectionalBlockText style={styles.feedSubtitle}>
              {effectiveMode === "nearby"
                ? t("home.withinRadius", { radius: NEARBY_RIDE_RADIUS_KM })
                : t("home.allRidesEverywhere")}
            </PhysicalDirectionalBlockText>
          </View>

          {filter !== "all" ? (
            <Pressable onPress={() => setFilter("all")}>
              <DirectionalRow style={styles.viewAllChip}>
                <DirectionalText style={styles.viewAllChipText}>
                  {t("common.viewAll")}
                </DirectionalText>
                <Ionicons
                  name={isRTL ? "arrow-back" : "arrow-forward"}
                  size={13}
                  color="#F58220"
                />
              </DirectionalRow>
            </Pressable>
          ) : null}

          <Pressable
            style={styles.nearbyChevronButton}
            onPress={scrollToNearbyRides}
            hitSlop={8}
          >
            <Ionicons name="chevron-down" size={20} color="#F58220" />
          </Pressable>
        </DirectionalRow>
      </View>

      {/* Everything below the title row. A direct child of listHeader's own
          root View (same level as the header/hero/action-cards block
          above), so its onLayout y is already relative to the ScrollView's
          content — exactly the coordinate space scrollTo's y expects. */}
      <View onLayout={(e) => setNearbySectionY(e.nativeEvent.layout.y)}>
        <View style={{ paddingHorizontal: 20, marginBottom: 14 }}>
          {/* Location state banners — only relevant while the user is trying
              to use Nearby mode; "All rides" always works regardless. */}
          {mode === "nearby" && locationState === "checking" ? (
            <View style={styles.noAreaBanner}>
              <ActivityIndicator size="small" color="#B86115" />
              <Text style={styles.noAreaBannerText}>
                {t("home.gettingLocation")}
              </Text>
            </View>
          ) : null}

          {mode === "nearby" && locationState === "denied" ? (
            <View style={styles.noAreaBanner}>
              <Ionicons name="location-outline" size={18} color="#B86115" />
              <View style={{ flex: 1 }}>
                <Text style={styles.noAreaBannerText}>
                  {t("home.locationDenied")}
                </Text>
                <Pressable
                  style={styles.bannerButton}
                  onPress={
                    canAskAgain
                      ? requestLocationPermission
                      : () => Linking.openSettings()
                  }
                >
                  <Text style={styles.bannerButtonText}>
                    {canAskAgain ? t("home.grantLocationAccess") : t("common.openSettings")}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {mode === "nearby" && locationState === "services-disabled" ? (
            <View style={styles.noAreaBanner}>
              <Ionicons name="location-outline" size={18} color="#B86115" />
              <View style={{ flex: 1 }}>
                <Text style={styles.noAreaBannerText}>
                  {t("home.locationServicesDisabled")}
                </Text>
                <Pressable
                  style={styles.bannerButton}
                  onPress={requestLocationPermission}
                >
                  <Text style={styles.bannerButtonText}>{t("common.tryAgain")}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {mode === "nearby" && locationState === "unavailable" ? (
            <View style={styles.noAreaBanner}>
              <Ionicons
                name="information-circle"
                size={18}
                color="#B86115"
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.noAreaBannerText}>
                  {t("home.locationUnavailable")}
                </Text>
                <Pressable
                  style={styles.bannerButton}
                  onPress={requestLocationPermission}
                >
                  <Text style={styles.bannerButtonText}>{t("common.tryAgain")}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {nearbyIsEmptyButOthersExist ? (
            <View style={styles.noAreaBanner}>
              <Ionicons
                name="information-circle"
                size={18}
                color="#B86115"
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.noAreaBannerText}>
                  {t("home.noNearbyRides", { radius: NEARBY_RIDE_RADIUS_KM })}
                </Text>
                <Pressable
                  style={styles.bannerButton}
                  onPress={() => setMode("all")}
                >
                  <Text style={styles.bannerButtonText}>{t("home.showAllRides")}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.filterRow, { paddingRight: 28 }]}
        >
          {visibleFilterKeys.map((key) => {
            const active = filter === key;

            return (
              <Pressable
                key={key}
                style={[styles.filterChip, { marginRight: 8 }]}
                onPress={() => setFilter(key)}
              >
                {active ? (
                  <LinearGradient
                    colors={["#FFB870", "#F58220"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFillObject}
                  />
                ) : null}
                <Ionicons
                  name={FILTER_ICONS[key]}
                  size={14}
                  color={active ? "#FFFFFF" : "#7C5F46"}
                />
                <Text
                  style={[
                    styles.filterChipText,
                    active && styles.filterChipTextActive,
                  ]}
                >
                  {t(`home.filters.${key}`)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {filter === "school" ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.schoolDirectionRow}
          >
            {visibleSchoolDirectionOptions.map((option) => {
              const optionActive = schoolDirectionFilter === option.key;

              return (
                <Pressable
                  key={option.key}
                  style={[
                    styles.schoolDirectionChip,
                    optionActive && styles.schoolDirectionChipActive,
                  ]}
                  onPress={() => setSchoolDirectionFilter(option.key)}
                >
                  <Text
                    style={[
                      styles.schoolDirectionChipText,
                      optionActive && styles.schoolDirectionChipTextActive,
                    ]}
                  >
                    {t(option.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {feedLoading ? (
          <View style={styles.feedLoadingBox}>
            <ActivityIndicator color="#F58220" />
            <Text style={styles.feedLoadingText}>{t("home.loadingTrips")}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );

  return (
    <DirectionalScreen style={styles.page}>
      <ScrollView
        ref={scrollViewRef}
        onLayout={(e) => setScrollViewportHeight(e.nativeEvent.layout.height)}
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        {listHeader}

        {!feedLoading && visibleFeedItems.length === 0 ? (
          <View style={styles.emptyFeedBox}>
            <Ionicons name="search-outline" size={32} color="#8B7B6B" />
            <Text style={styles.emptyFeedText}>
              {effectiveMode === "nearby"
                ? t("home.noNearbyRides", { radius: NEARBY_RIDE_RADIUS_KM })
                : t("home.noAvailableRides")}
            </Text>
            {effectiveMode === "nearby" && allItemsSorted.length > 0 ? (
              <Pressable
                style={styles.bannerButton}
                onPress={() => setMode("all")}
              >
                <Text style={styles.bannerButtonText}>{t("home.showAllRides")}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {!feedLoading &&
          visibleFeedItems.map((item) => (
            <View key={`${item.category}-${item.id}`} style={styles.feedItemWrap}>
              <TripFeedCard
                item={item}
                onPressBook={() => handleBookPress(item)}
                onPressDriver={() => {
                  if (!item.providerId) return;
                  setReviewsDriverId(item.providerId);
                  setReviewsDriverName(item.providerName);
                }}
                distanceKm={item.distanceKm}
              />
            </View>
          ))}
      </ScrollView>

      <Modal
        visible={!!dayPickerItem}
        transparent
        animationType="fade"
        onRequestClose={closeDayPicker}
      >
        <View style={styles.dayPickerBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeDayPicker} />

          <DirectionalCard style={styles.dayPickerCard}>
            <Text style={[styles.dayPickerTitle, isRTL && styles.textRTL]}>
              {t("rides.pickDaysTitle")}
            </Text>
            <Text style={[styles.dayPickerSubtitle, isRTL && styles.textRTL]}>
              {t("rides.pickDaysSubtitle")}
            </Text>

            <FlatList
              data={dayPickerItem?.availableWeeklyDays || []}
              keyExtractor={(d) => d.date}
              style={styles.dayPickerList}
              renderItem={({ item: day }) => {
                const selected = dayPickerSelected.has(day.date);

                return (
                  <Pressable
                    style={styles.dayRow}
                    onPress={() => toggleDaySelection(day.date)}
                  >
                    <Ionicons
                      name={selected ? "checkbox" : "square-outline"}
                      size={20}
                      color={selected ? "#F58220" : "#8B7B6B"}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.dayRowTitle}>
                        {day.dayName} · {day.date}
                      </Text>
                      <Text style={styles.dayRowSubtitle}>
                        {day.time} · ₪{day.price} ·{" "}
                        {t("rides.seatsLeft", { count: day.remainingSeats })}
                      </Text>
                    </View>
                  </Pressable>
                );
              }}
            />

            <View style={styles.dayPickerButtonsRow}>
              <Pressable style={styles.dayPickerCancel} onPress={closeDayPicker}>
                <Text style={styles.dayPickerCancelText}>{t("common.cancel")}</Text>
              </Pressable>

              <Pressable
                style={styles.dayPickerConfirm}
                onPress={confirmDayPicker}
              >
                <Text style={styles.dayPickerConfirmText}>{t("common.continue")}</Text>
              </Pressable>
            </View>
          </DirectionalCard>
        </View>
      </Modal>

      <Modal
        visible={!!childSelectItem}
        transparent
        animationType="slide"
        onRequestClose={closeChildSelect}
      >
        <View style={styles.childSelectOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeChildSelect} />

          <DirectionalCard style={styles.childSelectCard}>
            <View style={styles.childSelectHandle} />

            <View style={styles.childSelectHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.childSelectTitle, isRTL && styles.textRTL]}>
                  {t("schoolChildren.selectChildScreenTitle")}
                </Text>
                <Text style={[styles.childSelectSubtitle, isRTL && styles.textRTL]}>
                  {t("schoolChildren.selectChildScreenSubtitle")}
                </Text>
              </View>

              <Pressable style={styles.childSelectClose} onPress={closeChildSelect} hitSlop={8}>
                <Ionicons name="close" size={20} color="#7C5F46" />
              </Pressable>
            </View>

            <ChildSelector
              onContinue={handleChildSelectionContinue}
              onAddChild={() => router.push("/booking/school/my-children" as any)}
            />
          </DirectionalCard>
        </View>
      </Modal>

      <PickupLocationPicker
        visible={pickupPickerVisible}
        onClose={() => {
          setPickupPickerVisible(false);
          setPendingBookItem(null);
          setPendingWeeklyDays(null);
          setPendingChildEntries(null);
        }}
        onSelect={handlePickupSelected}
      />

      <DriverProfileReviewsModal
        visible={!!reviewsDriverId}
        driverId={reviewsDriverId}
        driverName={reviewsDriverName}
        onClose={() => {
          setReviewsDriverId(null);
          setReviewsDriverName("");
        }}
      />
    </DirectionalScreen>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#F8F2EA",
  },
  scroll: {
    paddingBottom: 40,
  },
  textRTL: {
    textAlign: "right",
    writingDirection: "rtl",
  },
  // --- Top brand bar -------------------------------------------------------
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logo: {
    // Combined pin+map + "Takeme" wordmark image (aspect ~3.18:1).
    width: 127,
    height: 40,
  },
  topBarIcons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#EADFD2",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 2,
  },

  // --- Hero ------------------------------------------------------------
  heroWrap: {
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  // hero-car.png is a square image whose empty cream area sits in its own
  // upper-left corner; minHeight is generous enough that resizeMode="cover"
  // doesn't have to crop away the car/road/pin on typical phone widths.
  hero: {
    borderRadius: 28,
    padding: 22,
    minHeight: 300,
    justifyContent: "flex-start",
    overflow: "hidden",
    shadowColor: "#D8541F",
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 20,
    elevation: 6,
  },
  heroBgImage: {
    borderRadius: 28,
  },
  heroPageTextBlock: {
    paddingHorizontal: 20,
    marginTop: 14,
    marginBottom: 14,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: "900",
    color: "#000000",
    lineHeight: 31,
    marginBottom: 8,
  },
  heroDescription: {
    fontSize: 15.5,
    lineHeight: 21,
    color: "#6B5B4E",
  },

  heroRowPressed: {
    opacity: 0.85,
  },
  heroRowText: {
    flex: 1,
  },
  heroRowSubtitle: {
    fontSize: 12,
    color: "#7C5F46",
    marginTop: 1,
  },
  outlineButtonDisabled: {
    opacity: 0.6,
  },

  // --- Action cards (Find a Ride / Become a Driver) — separate white
  // shadowed cards BELOW the hero card, not nested inside it. ---
  actionCardsWrap: {
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 24,
  },
  actionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 2,
  },
  actionCardIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: "#FFF2E8",
    alignItems: "center",
    justifyContent: "center",
  },
  actionCardTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: "#111827",
  },
  actionCardArrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#FFF2E8",
    alignItems: "center",
    justifyContent: "center",
  },
  iconBadge: {
    position: "absolute",
    top: -3,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: "#F8F2EA",
  },
  iconBadgeText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 11,
  },

  // --- Feed ---------------------------------------------------------------
  feedSection: {
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#EFE3D6",
    paddingTop: 20,
  },
  feedHeader: {
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  feedTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  feedTitleIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#FFF2E8",
    alignItems: "center",
    justifyContent: "center",
  },
  feedTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: "#111827",
  },
  feedSubtitle: {
    fontSize: 12.5,
    color: "#7C5F46",
    marginTop: 2,
  },
  viewAllChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FFF2E8",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  viewAllChipText: {
    color: "#F58220",
    fontWeight: "800",
    fontSize: 12.5,
  },
  nearbyChevronButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#FBF7F1",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 2,
  },
  noAreaBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFF2E8",
    borderRadius: 12,
    padding: 10,
    marginTop: 12,
  },
  noAreaBannerText: {
    color: "#B86115",
    fontSize: 12.5,
    fontWeight: "700",
    flexShrink: 1,
  },
  modeRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 14,
  },
  modeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#E7DCD1",
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  modeButtonActive: {
    backgroundColor: "#F58220",
    borderColor: "#F58220",
  },
  modeButtonText: {
    color: "#7C5F46",
    fontWeight: "800",
    fontSize: 13,
  },
  modeButtonTextActive: {
    color: "#FFFFFF",
  },
  bannerButton: {
    alignSelf: "flex-start",
    backgroundColor: "#F58220",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 8,
  },
  bannerButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 12.5,
  },
  filterRow: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    shadowColor: "#000",
    shadowOpacity: 0.03,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 1,
  },
  filterChipText: {
    color: "#7C5F46",
    fontWeight: "800",
    fontSize: 13,
  },
  filterChipTextActive: {
    color: "#FFFFFF",
  },
  schoolDirectionRow: {
    gap: 8,
    paddingBottom: 10,
    paddingTop: 2,
  },
  schoolDirectionChip: {
    borderWidth: 1,
    borderColor: "#E7DCD1",
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  schoolDirectionChipActive: {
    backgroundColor: "#F58220",
    borderColor: "#F58220",
  },
  schoolDirectionChipText: {
    color: "#7C5F46",
    fontWeight: "800",
    fontSize: 12.5,
  },
  schoolDirectionChipTextActive: {
    color: "#FFFFFF",
  },
  feedLoadingBox: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 30,
  },
  feedLoadingText: {
    color: "#7C5F46",
    fontWeight: "700",
  },
  feedItemWrap: {
    paddingHorizontal: 20,
  },
  emptyFeedBox: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 40,
    paddingHorizontal: 30,
  },
  emptyFeedText: {
    color: "#7C5F46",
    fontWeight: "700",
    textAlign: "center",
  },

  // --- Weekly day picker modal ---------------------------------------------
  dayPickerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    padding: 24,
  },
  dayPickerCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 20,
    maxHeight: "80%",
  },
  dayPickerTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: "#111827",
  },
  dayPickerSubtitle: {
    fontSize: 13,
    color: "#7C5F46",
    marginTop: 4,
    marginBottom: 14,
  },
  dayPickerList: {
    marginBottom: 14,
  },
  dayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F0E5DC",
  },
  dayRowTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: "#111827",
  },
  dayRowSubtitle: {
    fontSize: 12.5,
    color: "#7C5F46",
    marginTop: 2,
  },
  dayPickerButtonsRow: {
    flexDirection: "row",
    gap: 12,
  },
  dayPickerCancel: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  dayPickerCancelText: {
    color: "#7C5F46",
    fontWeight: "900",
  },
  dayPickerConfirm: {
    flex: 1,
    backgroundColor: "#F58220",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  dayPickerConfirmText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  // School Trip's child-select sheet — same bottom-sheet convention as
  // PickupLocationPicker.tsx (overlay + backdrop + rounded-top card + handle
  // bar), the step it sits directly in front of, so the two feel like one
  // continuous flow rather than two differently-designed modals.
  childSelectOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  childSelectCard: {
    backgroundColor: "#FBF7F1",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 12,
    paddingHorizontal: 0,
    maxHeight: "85%",
  },
  childSelectHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#E2D8CF",
    marginBottom: 10,
  },
  childSelectHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 20,
  },
  childSelectTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: "#111827",
  },
  childSelectSubtitle: {
    fontSize: 13,
    color: "#7C5F46",
    marginTop: 4,
  },
  childSelectClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3ECE3",
  },
});
