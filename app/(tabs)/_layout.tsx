import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Tabs } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  onSnapshot,
  query,
  QueryDocumentSnapshot,
  where,
} from "firebase/firestore";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { auth, db } from "../../firebase";
import { normalizeBooking } from "../booking/bookingsLib";
import { normalizeRideBooking, RIDE_CATEGORY } from "../booking/rideBookingLib";
import { stopDriverLocationTracking } from "../driverLocationTask";
import { useLanguage } from "../i18n/LanguageProvider";
import { positionEnd } from "../i18n/rtl";
import {
  capturePassengerLocationOnce,
  startPassengerLocationTracking,
  stopPassengerLocationTracking,
} from "../passengerLocationTask";
import { registerForPushNotificationsAsync } from "../pushNotifications";

const RIDE_LIKE_CATEGORIES = [RIDE_CATEGORY, "school"];

// A booking still needs attention as a passenger while the trip hasn't been
// finished by the driver yet, or the trip finished but the passenger hasn't
// rated the driver yet.
const passengerNeedsAttention = (data: any) => {
  if (!RIDE_LIKE_CATEGORIES.includes(data.category)) return false;

  const isDone = data.status === "completed" || data.tripStatus === "completed";
  const ratingPending =
    data.needsPassengerRating === true && data.ratingSubmitted !== true;

  return !isDone || ratingPending;
};

// A booking still needs attention as a driver while Finish Trip hasn't been
// pressed yet.
const driverNeedsAttention = (data: any) => {
  if (!RIDE_LIKE_CATEGORIES.includes(data.category)) return false;

  return data.status !== "completed" && data.tripStatus !== "completed";
};

// Which single booking (if any) the signed-in passenger should be sharing
// their live location for right now — a personal-ride/legacy-school
// booking that's still waiting for the driver to arrive. Deliberately the
// SAME "booked"/on-the-way window as before (see git history on
// app/(tabs)/bookings.tsx): stops being eligible the moment the driver
// arrives, the trip starts, it's cancelled, or completed. Reused against
// the passenger's own `bookings` snapshot that this layout already
// subscribes to for the tab badge, instead of opening a second listener.
const findActivePassengerLocationTarget = (
  docs: QueryDocumentSnapshot[],
  uid: string,
): { targetId: string; passengerId: string; driverId: string } | null => {
  const activeRide = docs
    .filter((d) => d.data().category === RIDE_CATEGORY)
    .map((d) => normalizeRideBooking(d.id, d.data()))
    .find((r) => r.status === "booked" || r.status === "on_the_way");

  const schoolDoc = activeRide
    ? null
    : docs.find((d) => {
        const data = d.data();
        return (
          data.category === "school" &&
          data.status === "ongoing" &&
          (data.tripStatus === "booked" || data.tripStatus === "driver_on_way")
        );
      });

  const activeSchoolBooking = schoolDoc ? normalizeBooking(schoolDoc.id, schoolDoc.data()) : null;

  const active = activeRide || activeSchoolBooking || null;

  if (!active || !active.driverId) return null;

  return { targetId: active.id, passengerId: uid, driverId: active.driverId };
};

// Small green dot shown over the My Bookings tab icon while the passenger has an
// active (unfinished) personal-ride booking.
function BookingsTabIcon({
  color,
  size,
  hasActive,
  isRTL,
}: {
  color: string;
  size: number;
  hasActive: boolean;
  isRTL: boolean;
}) {
  return (
    <View>
      <Ionicons name="car" size={size} color={color} />
      {hasActive ? (
        <View
          style={{
            position: "absolute",
            top: -2,
            ...positionEnd(-3, isRTL),
            width: 11,
            height: 11,
            borderRadius: 6,
            backgroundColor: "#22C55E",
            borderWidth: 1.5,
            borderColor: "#FFFFFF",
          }}
        />
      ) : null}
    </View>
  );
}

// Numeric badge (same shape as home.tsx's old top-bar icon badges) shown
// over the Messages tab icon while there are unread chat messages.
function MessagesTabIcon({
  color,
  size,
  unreadCount,
  isRTL,
}: {
  color: string;
  size: number;
  unreadCount: number;
  isRTL: boolean;
}) {
  return (
    <View>
      <Ionicons name="chatbubble-ellipses" size={size} color={color} />
      {unreadCount > 0 ? (
        <View
          style={{
            position: "absolute",
            top: -4,
            ...positionEnd(-8, isRTL),
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            paddingHorizontal: 3,
            backgroundColor: "#DC2626",
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1.5,
            borderColor: "#FFFFFF",
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 9, fontWeight: "900" }}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// A fully custom tab bar — REQUIRED after real-device screenshots proved
// that reordering the <Tabs.Screen> declarations themselves (an earlier
// attempt) had NO effect on the actual rendered tab order. Rather than
// depend on however expo-router/React Navigation internally decide
// registration order (proven unreliable for this purpose), this component
// renders every tab BUTTON itself — never touching route names, navigation
// targets, or badge logic — only which physical position each
// already-existing button renders at. Each button still navigates via
// `navigation.navigate(route.name)`, so Home always opens Home, Bookings
// always opens Bookings, etc., regardless of where it's drawn.
//
// `orderedRoutes` is deliberately `state.routes` UNREVERSED — an earlier
// version reversed this array here AND relied on the bar's own row to
// mirror it a second time via inherited direction, which silently canceled
// back out on a real device (see this file's own `tabBarStyles.bar`: the
// bar neutralizes inherited direction and applies ONE explicit
// `flexDirection: isRTL ? "row-reverse" : "row"` — that single flip is the
// only thing that reorders these buttons now).
function CustomTabBar({
  state,
  descriptors,
  navigation,
  isRTL,
}: BottomTabBarProps & { isRTL: boolean }) {
  const insets = useSafeAreaInsets();
  const orderedRoutes = state.routes;

  return (
    <View
      style={[
        tabBarStyles.bar,
        { paddingBottom: Math.max(insets.bottom, 8) },
        { direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" },
      ]}
    >
      {orderedRoutes.map((route) => {
        const { options } = descriptors[route.key];
        const isFocused = state.routes[state.index]?.key === route.key;
        const color = isFocused ? "#F58220" : "#8E8E93";

        const onPress = () => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });

          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            style={tabBarStyles.item}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            accessibilityLabel={
              typeof options.title === "string" ? options.title : route.name
            }
          >
            {options.tabBarIcon?.({ focused: isFocused, color, size: 24 })}
            <Text style={[tabBarStyles.label, { color }]} numberOfLines={1}>
              {options.title ?? route.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const tabBarStyles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#E7DCD1",
    paddingTop: 8,
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingVertical: 2,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
  },
});

export default function TabLayout() {
  const { t } = useTranslation();
  const { language, isRTL } = useLanguage();
  const languageRef = useRef(language);
  const [hasPassengerAttention, setHasPassengerAttention] = useState(false);
  const [hasDriverAttention, setHasDriverAttention] = useState(false);
  const hasActiveRide = hasPassengerAttention || hasDriverAttention;
  const [unreadChats, setUnreadChats] = useState(0);

  // Which booking's location this device is currently sharing for, if any
  // — lets the effect below start/stop tracking only when this actually
  // changes, instead of re-issuing a capture+start on every single snapshot
  // tick (foregroundLocationTracker.ts's own start() already de-dupes a
  // repeat call for the SAME target, but capturePassengerLocationOnce is
  // not idempotent — it always takes a fresh GPS fix).
  const activePassengerTargetRef = useRef<string | null>(null);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  // Live listeners: passenger side stays lit until the trip is rated;
  // driver side stays lit until the driver presses Finish Trip.
  //
  // This is ALSO where the passenger's own live-location sharing
  // (passengerLocationTask.ts) is started and stopped — deliberately here,
  // in the tab layout, rather than on the My Bookings screen. That screen
  // unmounts every time the passenger switches to Home/Messages/Profile,
  // which used to kill sharing mid-trip even though the driver was still
  // on the way; this layout stays mounted for as long as the passenger is
  // signed in and inside the (tabs) group, so it can depend on "the app is
  // open and the booking is still active" instead of "one particular
  // screen happens to be open". Tracking stops the moment: the driver
  // arrives / the trip starts / the booking is cancelled or completed (all
  // of these simply make findActivePassengerLocationTarget stop returning
  // a target on the next snapshot), the signed-in user changes (handled
  // explicitly below), or foreground permission is no longer granted
  // (foregroundLocationTracker.ts's own start() no-ops in that case).
  useEffect(() => {
    let unsubPassenger: (() => void) | null = null;
    let unsubDriver: (() => void) | null = null;

    const stopPassengerSharing = () => {
      activePassengerTargetRef.current = null;
      stopPassengerLocationTracking().catch(() => {});
    };

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      unsubPassenger?.();
      unsubDriver?.();
      unsubPassenger = null;
      unsubDriver = null;

      if (!user) {
        setHasPassengerAttention(false);
        setHasDriverAttention(false);
        // Tracking is no longer authorized once the driver signs out — see
        // app/driverLocationTask.ts (this is the one central place every
        // auth-loss path in the app already passes through).
        stopDriverLocationTracking();
        // Same reasoning, passenger side — a different signed-in user (or
        // no user) must never keep sharing the previous passenger's
        // location.
        stopPassengerSharing();
        return;
      }

      // Best-effort, once per sign-in — see app/pushNotifications.ts for
      // why this can silently no-op (permission denied, no EAS project id).
      registerForPushNotificationsAsync(user.uid, languageRef.current);

      unsubPassenger = onSnapshot(
        query(collection(db, "bookings"), where("passengerId", "==", user.uid)),
        (snap) => {
          setHasPassengerAttention(
            snap.docs.some((d) => passengerNeedsAttention(d.data())),
          );

          const target = findActivePassengerLocationTarget(snap.docs, user.uid);

          if (!target) {
            if (activePassengerTargetRef.current) stopPassengerSharing();
            return;
          }

          if (activePassengerTargetRef.current === target.targetId) return;
          activePassengerTargetRef.current = target.targetId;

          (async () => {
            try {
              await capturePassengerLocationOnce(target);
              await startPassengerLocationTracking(target);
            } catch (error) {
              console.log("(tabs)/_layout: failed to start passenger location sharing", error);
            }
          })();
        },
        () => {
          setHasPassengerAttention(false);
          stopPassengerSharing();
        },
      );

      unsubDriver = onSnapshot(
        query(collection(db, "bookings"), where("driverId", "==", user.uid)),
        (snap) => {
          setHasDriverAttention(
            snap.docs.some((d) => driverNeedsAttention(d.data())),
          );
        },
        () => setHasDriverAttention(false),
      );
    });

    return () => {
      unsubPassenger?.();
      unsubDriver?.();
      unsubAuth();
      // Leaving the (tabs) group entirely (e.g. signing out) — nothing
      // left mounted that's still watching for a reason to keep sharing.
      stopPassengerSharing();
    };
  }, []);

  // Live unread chat count for the Messages tab icon badge — single
  // array-contains filter, index-free (moved here from home.tsx's old
  // top-bar chat icon, now that Messages is its own tab).
  useEffect(() => {
    let unsubChats: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      unsubChats?.();
      unsubChats = null;

      if (!user) {
        setUnreadChats(0);
        return;
      }

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
      unsubChats?.();
      unsubAuth();
    };
  }, []);

  // Registration order here is now purely nominal — CustomTabBar (above) is
  // what actually decides visual left-to-right order, reordering these same
  // four routes for RTL without touching any of them. Each `name` still
  // resolves to the exact same route file regardless of visual position.
  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} isRTL={isRTL} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#F58220",
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: t("home.tabTitle"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="bookings"
        options={{
          title: t("bookings.tabTitle"),
          tabBarIcon: ({ color, size }) => (
            <BookingsTabIcon
              color={color}
              size={size}
              hasActive={hasActiveRide}
              isRTL={isRTL}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="messages"
        options={{
          title: t("messages.tabTitle"),
          tabBarIcon: ({ color, size }) => (
            <MessagesTabIcon color={color} size={size} unreadCount={unreadChats} isRTL={isRTL} />
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: t("profile.tabTitle"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
