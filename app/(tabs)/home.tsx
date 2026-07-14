import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
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
  buildErrandBookNav,
  buildQuickRideNav,
  buildWeeklyRideNav,
  buildWorkApplyNav,
  FEED_PAGE_SIZE,
  FeedCategory,
  FeedItem,
  getUserHomeLocationId,
  sortFeedItems,
  subscribeHomeFeed,
} from "../booking/homeFeedLib";
import { WeeklyDriverDay } from "../booking/weeklyBookingLib";
import TripFeedCard from "../booking/TripFeedCard";

const logoImg = require("../../assets/images/logo-new.jpg");

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
  const [refreshKey, setRefreshKey] = useState(0);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [userLocationId, setUserLocationId] = useState<string | null>(null);

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
  // Re-subscribing on refreshKey change is what "pull to refresh" triggers;
  // onSnapshot already keeps the list live in between refreshes.
  useEffect(() => {
    let cancelled = false;
    setFeedLoading(true);

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const locationId = await getUserHomeLocationId(user.uid);
        if (!cancelled) setUserLocationId(locationId);
      } else {
        if (!cancelled) setUserLocationId(null);
      }
    });

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
      unsubAuth();
      unsubFeed();
    };
  }, [refreshKey]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshKey((prev) => prev + 1);
  }, []);

  const visibleFeedItems = useMemo(() => {
    const filtered =
      filter === "all"
        ? feedItems
        : feedItems.filter((item) => item.category === filter);

    return sortFeedItems(filtered, userLocationId).slice(0, FEED_PAGE_SIZE);
  }, [feedItems, filter, userLocationId]);

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
      {/* Top notification icons (Instagram/Facebook style) */}
      <View style={styles.topBar}>
        <Pressable
          style={styles.iconButton}
          onPress={() => router.push("/notifications" as any)}
          hitSlop={8}
        >
          <Ionicons name="notifications-outline" size={26} color="#7C5F46" />
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
          <Ionicons name="help-buoy-outline" size={26} color="#7C5F46" />
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
            size={26}
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

      <View style={styles.hero}>
        <Image source={logoImg} style={styles.logo} />

        <Text style={styles.title}>Take Me</Text>

        <Text style={styles.description}>
          Connect with neighbors heading your way. Safe, affordable rides for
          your community.
        </Text>

        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.primaryButtonPressed,
          ]}
          onPress={() => router.push("/booking/ride-category" as any)}
        >
          <Ionicons name="search" size={19} color="#FFFFFF" />
          <Text style={styles.primaryButtonText}>Find a Ride</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.outlineButton,
            pressed && styles.outlineButtonPressed,
            checkingDriver && styles.outlineButtonDisabled,
          ]}
          onPress={handleBecomeDriver}
          disabled={checkingDriver}
        >
          {checkingDriver ? (
            <ActivityIndicator color="#2B2118" />
          ) : (
            <>
              <Ionicons name="car-sport-outline" size={19} color="#2B2118" />
              <Text style={styles.outlineButtonText}>Become a Driver</Text>
              <Ionicons name="arrow-forward" size={17} color="#2B2118" />
            </>
          )}
        </Pressable>
      </View>

      {/* --- Trips near you ------------------------------------------- */}
      <View style={styles.feedSection}>
        <View style={styles.feedHeader}>
          <View style={styles.feedTitleRow}>
            <View style={styles.feedTitleIcon}>
              <Ionicons name="navigate" size={16} color="#F58220" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.feedTitle}>Trips near you</Text>
              <Text style={styles.feedSubtitle}>
                Available rides and services around your area
              </Text>
            </View>
          </View>

          {!userLocationId ? (
            <View style={styles.noAreaBanner}>
              <Ionicons
                name="information-circle"
                size={18}
                color="#B86115"
              />
              <Text style={styles.noAreaBannerText}>
                Showing recent available trips. Choose your city in Profile
                to see trips near you first.
              </Text>
            </View>
          ) : null}
        </View>

        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={FILTERS}
          keyExtractor={(f) => f.key}
          contentContainerStyle={styles.filterRow}
          renderItem={({ item: f }) => (
            <Pressable
              style={[
                styles.filterChip,
                filter === f.key && styles.filterChipActive,
              ]}
              onPress={() => setFilter(f.key)}
            >
              <Ionicons
                name={FILTER_ICONS[f.key]}
                size={14}
                color={filter === f.key ? "#FFFFFF" : "#7C5F46"}
              />
              <Text
                style={[
                  styles.filterChipText,
                  filter === f.key && styles.filterChipTextActive,
                ]}
              >
                {f.label}
              </Text>
            </Pressable>
          )}
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
            <TripFeedCard item={item} onPressBook={() => handleBookPress(item)} />
          </View>
        )}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          !feedLoading ? (
            <View style={styles.emptyFeedBox}>
              <Ionicons name="search-outline" size={32} color="#8B7B6B" />
              <Text style={styles.emptyFeedText}>
                No nearby trips available right now.
              </Text>
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
  hero: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 4,
    paddingBottom: 8,
  },
  logo: {
    width: 108,
    height: 108,
    borderRadius: 54,
    marginBottom: 14,
  },
  title: {
    fontSize: 38,
    fontWeight: "900",
    color: "#F39C2D",
    marginBottom: 8,
  },
  description: {
    textAlign: "center",
    fontSize: 15,
    lineHeight: 21,
    color: "#8A7A6C",
    marginBottom: 22,
    paddingHorizontal: 8,
  },
  primaryButton: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#F28C28",
    paddingVertical: 16,
    borderRadius: 16,
    marginBottom: 10,
    shadowColor: "#F28C28",
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 10,
    elevation: 3,
  },
  primaryButtonPressed: {
    opacity: 0.9,
  },
  primaryButtonText: {
    textAlign: "center",
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 16,
  },
  outlineButton: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "#E7DCD1",
    paddingVertical: 16,
    borderRadius: 16,
  },
  outlineButtonPressed: {
    backgroundColor: "#FBF7F1",
  },
  outlineButtonText: {
    textAlign: "center",
    color: "#2B2118",
    fontWeight: "800",
    fontSize: 16,
  },
  outlineButtonDisabled: {
    opacity: 0.6,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  iconButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
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
  filterRow: {
    paddingHorizontal: 20,
    paddingRight: 28,
    paddingBottom: 16,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
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
  filterChipActive: {
    backgroundColor: "#F58220",
    borderColor: "#F58220",
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
