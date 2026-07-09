import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { auth, db } from "../../firebase";
import { fetchDriverEligibility } from "../driver/driverEligibility";

const logoImg = require("../../assets/images/logo-new.jpg");

export default function HomeScreen() {
  const [unreadHelp, setUnreadHelp] = useState(0);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  // Unread chat messages across all of the user's conversations.
  const [unreadChats, setUnreadChats] = useState(0);
  const [checkingDriver, setCheckingDriver] = useState(false);

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

  return (
    <SafeAreaView style={styles.page}>
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
          style={styles.primaryButton}
          onPress={() => router.push("/booking/ride-category" as any)}
        >
          <Text style={styles.primaryButtonText}> Find a Ride 🔍</Text>
        </Pressable>

        <Pressable
          style={[
            styles.outlineButton,
            checkingDriver && styles.outlineButtonDisabled,
          ]}
          onPress={handleBecomeDriver}
          disabled={checkingDriver}
        >
          {checkingDriver ? (
            <ActivityIndicator color="#2B2118" />
          ) : (
            <Text style={styles.outlineButtonText}>Become a Driver →</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#F8F2EA",
  },
  hero: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  logo: {
    width: 170,
    height: 170,
    borderRadius: 85,
    marginBottom: 24,
  },
  title: {
    fontSize: 56,
    fontWeight: "900",
    color: "#F39C2D",
    marginBottom: 14,
  },
  badge: {
    backgroundColor: "#FFF2E2",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 30,
    marginBottom: 24,
  },
  badgeText: {
    color: "#B86115",
    fontWeight: "700",
    fontSize: 15,
  },
  description: {
    textAlign: "center",
    fontSize: 20,
    lineHeight: 30,
    color: "#6B7280",
    marginBottom: 35,
  },
  primaryButton: {
    width: "100%",
    backgroundColor: "#F28C28",
    paddingVertical: 18,
    borderRadius: 18,
    marginBottom: 14,
  },
  primaryButtonText: {
    textAlign: "center",
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 18,
  },
  outlineButton: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "#D9CDBE",
    paddingVertical: 18,
    borderRadius: 18,
    marginBottom: 14,
  },
  outlineButtonText: {
    textAlign: "center",
    color: "#2B2118",
    fontWeight: "800",
    fontSize: 18,
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
  ghostButton: {
    paddingVertical: 12,
  },
  ghostButtonText: {
    color: "#7A6A5A",
    fontWeight: "700",
    fontSize: 17,
  },
});
