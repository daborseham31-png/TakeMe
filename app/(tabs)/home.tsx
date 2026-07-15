import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { auth, db } from "../../firebase";
import { fetchDriverEligibility } from "../driver/driverEligibility";
import {
  attachDistances,
  buildErrandBookNav,
  buildQuickRideNav,
  buildWeeklyRideNav,
  buildWorkApplyNav,
  FEED_PAGE_SIZE,
  FeedCategory,
  FeedItem,
  filterNearbyItems,
  NEARBY_RIDE_RADIUS_KM,
  sortFeedItems,
  subscribeHomeFeed,
} from "../booking/homeFeedLib";
import { useCurrentLocation } from "../booking/useCurrentLocation";
import { WeeklyDriverDay } from "../booking/weeklyBookingLib";
import TripFeedCard from "../booking/TripFeedCard";

type RideDisplayMode = "nearby" | "all";

const logoImg = require("../../assets/images/logo.jpeg");

type FilterKey = "all" | FeedCategory;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "personal", label: "Personal" },
  { key: "school", label: "School" },
  { key: "work", label: "Work" },
  { key: "errand", label: "Errands" },
];

const FILTER_ICONS: Record<FilterKey, keyof typeof Ionicons.glyphMap> = {
  all: "apps-outline",
  personal: "person-outline",
  school: "school-outline",
  work: "briefcase-outline",
  errand: "location-outline",
};

export default function HomeScreen() {
  const [unreadHelp, setUnreadHelp] = useState(0);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  // Unread chat messages across all of the user's conversations.
  const [unreadChats, setUnreadChats] = useState(0);
  const [checkingDriver, setCheckingDriver] = useState(false);

  // --- "Trips near you" feed --------------------------------------------
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");

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

  const [dayPickerItem, setDayPickerItem] = useState<FeedItem | null>(null);
  const [dayPickerSelected, setDayPickerSelected] = useState<Set<string>>(
    new Set(),
  );

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

  // Live unread notifications + unread chat messages for the signed-in user.
  // Both use single-filter queries → index-free.
  useEffect(() => {
    let unsubNotifs: (() => void) | null = null;
    let unsubChats: (() => void) | null = null;

    const cleanup = () => {
      unsubNotifs?.();
      unsubChats?.();
      unsubNotifs = unsubChats = null;
    };

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      cleanup();

      if (!user) {
        setUnreadNotifs(0);
        setUnreadChats(0);
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

      unsubChats = onSnapshot(
        query(
          collection(db, "conversations"),
          where("participants", "array-contains", user.uid),
        ),
        (snap) => {
          const total = snap.docs.reduce((sum, d) => {
            const data = d.data();
            const hidden: string[] = data.hiddenFor || [];
            if (hidden.includes(user.uid)) return sum;
            return sum + (data.unreadCount?.[user.uid] || 0);
          }, 0);
          setUnreadChats(total);
        },
        () => setUnreadChats(0),
      );
    });

    return () => {
      cleanup();
      unsubAuth();
    };
  }, []);

  // Trips near you — one combined, live-updating feed (see homeFeedLib.ts).
  // Subscribed exactly once for the component's lifetime; onSnapshot already
  // keeps the list live, so pull-to-refresh / Nearby-All switching only ever
  // re-filters this same already-loaded array — no extra Firebase reads.
  useEffect(() => {
    let cancelled = false;
    setFeedLoading(true);

    const unsubFeed = subscribeHomeFeed(
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

    return () => {
      cancelled = true;
      unsubFeed();
    };
  }, []);

  // Re-check location every time Home regains focus (app foregrounded,
  // navigated back to this tab) — this is what makes "nearby" update when
  // the user has physically moved to a different city. Silent: never
  // re-prompts the system permission dialog on its own.
  useFocusEffect(
    useCallback(() => {
      refreshLocation();
    }, [refreshLocation]),
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
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

  const categoryFilteredItems = useMemo(
    () =>
      filter === "all"
        ? feedItems
        : feedItems.filter((item) => item.category === filter),
    [feedItems, filter],
  );

  const itemsWithDistance = useMemo(
    () => attachDistances(categoryFilteredItems, coords),
    [categoryFilteredItems, coords],
  );

  const nearbyItems = useMemo(
    () => sortFeedItems(filterNearbyItems(itemsWithDistance)),
    [itemsWithDistance],
  );

  const allItemsSorted = useMemo(
    () => sortFeedItems(itemsWithDistance),
    [itemsWithDistance],
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
      Alert.alert("Choose a day", "Please select at least one day to continue.");
      return;
    }

    const item = dayPickerItem;
    closeDayPicker();

    const nav = buildWeeklyRideNav(item, chosen);
    router.push(nav as any);
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

    if (item.isWeekly) {
      openDayPicker(item);
      return;
    }

    router.push(buildQuickRideNav(item) as any);
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

      if (eligibility.status === "license_expired") {
        Alert.alert(
          "License expired",
          "Your driving license is expired. Please upload a valid license before becoming a driver.",
        );
      }

      // not_registered, license_missing, and languages_missing all land on
      // the same verification screen.
      router.push("/driver/verify-license" as any);
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Could not check your driver status.");
    } finally {
      setCheckingDriver(false);
    }
  };

  const listHeader = (
    <View>
      {/* Top brand row: logo + wordmark on the left, notification icons on
          the right (Instagram/Facebook style). */}
      <View style={styles.topBar}>
        <View style={styles.brandRow}>
          <Image
            source={logoImg}
            style={styles.logo}
            resizeMode="contain"
          />
          <View>
            <Text style={styles.brandTitle}>Take Me</Text>
            <Text style={styles.brandTagline}>Community Rides</Text>
          </View>
        </View>

        <View style={styles.topBarIcons}>
          <Pressable
            style={styles.iconButton}
            onPress={() => router.push("/notifications" as any)}
            hitSlop={8}
          >
            <Ionicons name="notifications-outline" size={22} color="#7C5F46" />
            {unreadNotifs > 0 ? (
              <View style={styles.iconBadge}>
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
              <View style={styles.iconBadge}>
                <Text style={styles.iconBadgeText}>
                  {unreadHelp > 99 ? "99+" : unreadHelp}
                </Text>
              </View>
            ) : null}
          </Pressable>

          <Pressable
            style={styles.iconButton}
            onPress={() => router.push("/messages" as any)}
            hitSlop={8}
          >
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={22}
              color="#7C5F46"
            />
            {unreadChats > 0 ? (
              <View style={styles.iconBadge}>
                <Text style={styles.iconBadgeText}>
                  {unreadChats > 99 ? "99+" : unreadChats}
                </Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>

      {/* --- Hero: gradient card, no custom illustration — depth comes from
          the gradient + soft decorative circles + icon-row buttons. --- */}
      <View style={styles.heroWrap}>
        <LinearGradient
          colors={["#FFB870", "#F58220", "#D8541F"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroBlobOne} pointerEvents="none" />
          <View style={styles.heroBlobTwo} pointerEvents="none" />
          <Ionicons
            name="car-sport"
            size={140}
            color="rgba(255,255,255,0.12)"
            style={styles.heroWatermark}
          />

          <View style={styles.heroBadge}>
            <Ionicons name="sparkles" size={13} color="#FFFFFF" />
            <Text style={styles.heroBadgeText}>Connecting people</Text>
          </View>

          <Text style={styles.heroTitle}>Where would you{"\n"}like to go?</Text>

          <Text style={styles.heroDescription}>
            Connect with trusted neighbors heading your way. Safe, affordable
            rides for your community.
          </Text>

          <Pressable
            style={({ pressed }) => [
              styles.heroRow,
              pressed && styles.heroRowPressed,
            ]}
            onPress={() => router.push("/booking/ride-category" as any)}
          >
            <View style={styles.heroRowIcon}>
              <Ionicons name="search" size={18} color="#F58220" />
            </View>
            <View style={styles.heroRowText}>
              <Text style={styles.heroRowTitle}>Find a Ride</Text>
              <Text style={styles.heroRowSubtitle}>
                Search for rides near you
              </Text>
            </View>
            <View style={styles.heroRowArrow}>
              <Ionicons name="arrow-forward" size={16} color="#F58220" />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.heroRow,
              styles.heroRowSecondary,
              pressed && styles.heroRowPressed,
              checkingDriver && styles.outlineButtonDisabled,
            ]}
            onPress={handleBecomeDriver}
            disabled={checkingDriver}
          >
            <View style={styles.heroRowIcon}>
              {checkingDriver ? (
                <ActivityIndicator size="small" color="#F58220" />
              ) : (
                <Ionicons name="car-sport-outline" size={18} color="#F58220" />
              )}
            </View>
            <View style={styles.heroRowText}>
              <Text style={styles.heroRowTitle}>Become a Driver</Text>
              <Text style={styles.heroRowSubtitle}>
                Join our community of drivers
              </Text>
            </View>
            <View style={styles.heroRowArrow}>
              <Ionicons name="arrow-forward" size={16} color="#F58220" />
            </View>
          </Pressable>
        </LinearGradient>
      </View>

      {/* --- Trips near you ------------------------------------------- */}
      <View style={styles.feedSection}>
        <View style={styles.feedHeader}>
          <View style={styles.feedTitleRow}>
            <View style={styles.feedTitleIcon}>
              <Ionicons name="navigate" size={16} color="#F58220" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.feedTitle}>
                {effectiveMode === "nearby"
                  ? "Nearby rides"
                  : "All available rides"}
              </Text>
              <Text style={styles.feedSubtitle}>
                {effectiveMode === "nearby"
                  ? `Within ${NEARBY_RIDE_RADIUS_KM} km of your current location`
                  : "Available rides and services, everywhere"}
              </Text>
            </View>

            {filter !== "all" ? (
              <Pressable
                style={styles.viewAllChip}
                onPress={() => setFilter("all")}
              >
                <Text style={styles.viewAllChipText}>View all</Text>
                <Ionicons name="arrow-forward" size={13} color="#F58220" />
              </Pressable>
            ) : null}
          </View>

          {/* Nearby / All toggle */}
          <View style={styles.modeRow}>
            <Pressable
              style={[
                styles.modeButton,
                mode === "nearby" && styles.modeButtonActive,
              ]}
              onPress={handlePressNearbyTab}
            >
              <Ionicons
                name="navigate"
                size={14}
                color={mode === "nearby" ? "#FFFFFF" : "#7C5F46"}
              />
              <Text
                style={[
                  styles.modeButtonText,
                  mode === "nearby" && styles.modeButtonTextActive,
                ]}
              >
                Nearby
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.modeButton,
                mode === "all" && styles.modeButtonActive,
              ]}
              onPress={() => setMode("all")}
            >
              <Ionicons
                name="globe-outline"
                size={14}
                color={mode === "all" ? "#FFFFFF" : "#7C5F46"}
              />
              <Text
                style={[
                  styles.modeButtonText,
                  mode === "all" && styles.modeButtonTextActive,
                ]}
              >
                All rides
              </Text>
            </Pressable>
          </View>

          {/* Location state banners — only relevant while the user is trying
              to use Nearby mode; "All rides" always works regardless. */}
          {mode === "nearby" && locationState === "checking" ? (
            <View style={styles.noAreaBanner}>
              <ActivityIndicator size="small" color="#B86115" />
              <Text style={styles.noAreaBannerText}>
                Getting your current location...
              </Text>
            </View>
          ) : null}

          {mode === "nearby" && locationState === "denied" ? (
            <View style={styles.noAreaBanner}>
              <Ionicons name="location-outline" size={18} color="#B86115" />
              <View style={{ flex: 1 }}>
                <Text style={styles.noAreaBannerText}>
                  Location permission was not granted, so we&apos;re showing
                  all available rides instead.{"\n"}
                  لم يتم منح إذن الموقع، لذلك نعرض جميع الرحلات المتاحة.
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
                    {canAskAgain ? "Grant location access" : "Open Settings"}
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
                  Location services are turned off on your phone, so
                  we&apos;re showing all available rides instead.
                </Text>
                <Pressable
                  style={styles.bannerButton}
                  onPress={requestLocationPermission}
                >
                  <Text style={styles.bannerButtonText}>Try again</Text>
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
                  We couldn&apos;t get your current location, so we&apos;re
                  showing all available rides instead.
                </Text>
                <Pressable
                  style={styles.bannerButton}
                  onPress={requestLocationPermission}
                >
                  <Text style={styles.bannerButtonText}>Try again</Text>
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
                  No nearby rides within {NEARBY_RIDE_RADIUS_KM} km right now.
                </Text>
                <Pressable
                  style={styles.bannerButton}
                  onPress={() => setMode("all")}
                >
                  <Text style={styles.bannerButtonText}>Show all rides</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={FILTERS}
          keyExtractor={(f) => f.key}
          contentContainerStyle={styles.filterRow}
          renderItem={({ item: f }) => {
            const active = filter === f.key;

            return (
              <Pressable style={styles.filterChip} onPress={() => setFilter(f.key)}>
                {active ? (
                  <LinearGradient
                    colors={["#FFB870", "#F58220"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFillObject}
                  />
                ) : null}
                <Ionicons
                  name={FILTER_ICONS[f.key]}
                  size={14}
                  color={active ? "#FFFFFF" : "#7C5F46"}
                />
                <Text
                  style={[
                    styles.filterChipText,
                    active && styles.filterChipTextActive,
                  ]}
                >
                  {f.label}
                </Text>
              </Pressable>
            );
          }}
        />

        {feedLoading ? (
          <View style={styles.feedLoadingBox}>
            <ActivityIndicator color="#F58220" />
            <Text style={styles.feedLoadingText}>Loading nearby trips...</Text>
          </View>
        ) : null}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.page}>
      <FlatList
        data={feedLoading ? [] : visibleFeedItems}
        keyExtractor={(item) => `${item.category}-${item.id}`}
        renderItem={({ item }) => (
          <View style={styles.feedItemWrap}>
            <TripFeedCard
              item={item}
              onPressBook={() => handleBookPress(item)}
              distanceKm={item.distanceKm}
            />
          </View>
        )}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          !feedLoading ? (
            <View style={styles.emptyFeedBox}>
              <Ionicons name="search-outline" size={32} color="#8B7B6B" />
              <Text style={styles.emptyFeedText}>
                {effectiveMode === "nearby"
                  ? `No nearby rides within ${NEARBY_RIDE_RADIUS_KM} km right now.`
                  : "No available rides right now."}
              </Text>
              {effectiveMode === "nearby" && allItemsSorted.length > 0 ? (
                <Pressable
                  style={styles.bannerButton}
                  onPress={() => setMode("all")}
                >
                  <Text style={styles.bannerButtonText}>Show all rides</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null
        }
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      />

      <Modal
        visible={!!dayPickerItem}
        transparent
        animationType="fade"
        onRequestClose={closeDayPicker}
      >
        <View style={styles.dayPickerBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeDayPicker} />

          <View style={styles.dayPickerCard}>
            <Text style={styles.dayPickerTitle}>Choose your days</Text>
            <Text style={styles.dayPickerSubtitle}>
              Pick one or more available days for this weekly trip.
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
                        {day.time} · ₪{day.price} · {day.remainingSeats} left
                      </Text>
                    </View>
                  </Pressable>
                );
              }}
            />

            <View style={styles.dayPickerButtonsRow}>
              <Pressable style={styles.dayPickerCancel} onPress={closeDayPicker}>
                <Text style={styles.dayPickerCancelText}>Cancel</Text>
              </Pressable>

              <Pressable
                style={styles.dayPickerConfirm}
                onPress={confirmDayPicker}
              >
                <Text style={styles.dayPickerConfirmText}>Continue</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
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
    // Source art is 516x422 (not square) — size by aspect ratio and use
    // resizeMode="contain" above so it's never cropped/squished.
    width: 54,
    height: 44,
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: "#F58220",
    lineHeight: 22,
  },
  brandTagline: {
    fontSize: 12,
    color: "#8A7A6C",
    fontWeight: "600",
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
  hero: {
    borderRadius: 28,
    padding: 22,
    overflow: "hidden",
    shadowColor: "#D8541F",
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 20,
    elevation: 6,
  },
  heroBlobOne: {
    position: "absolute",
    top: -40,
    right: -30,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  heroBlobTwo: {
    position: "absolute",
    bottom: -50,
    left: -40,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  heroWatermark: {
    position: "absolute",
    top: 10,
    right: -10,
    transform: [{ rotate: "-12deg" }],
  },
  heroBadge: {
    flexDirection: "row",
    alignSelf: "flex-start",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.22)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginBottom: 14,
  },
  heroBadgeText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 12,
  },
  heroTitle: {
    fontSize: 30,
    fontWeight: "900",
    color: "#FFFFFF",
    lineHeight: 36,
    marginBottom: 10,
  },
  heroDescription: {
    fontSize: 14.5,
    lineHeight: 21,
    color: "rgba(255,255,255,0.92)",
    marginBottom: 20,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  heroRowSecondary: {
    backgroundColor: "rgba(255,255,255,0.85)",
  },
  heroRowPressed: {
    opacity: 0.85,
  },
  heroRowIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#FFF2E8",
    alignItems: "center",
    justifyContent: "center",
  },
  heroRowText: {
    flex: 1,
  },
  heroRowTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: "#111827",
  },
  heroRowSubtitle: {
    fontSize: 12,
    color: "#7C5F46",
    marginTop: 1,
  },
  heroRowArrow: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#FFF2E8",
    alignItems: "center",
    justifyContent: "center",
  },
  outlineButtonDisabled: {
    opacity: 0.6,
  },
  iconBadge: {
    position: "absolute",
    top: -3,
    right: -3,
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
    paddingRight: 28,
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
    marginRight: 8,
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
});
