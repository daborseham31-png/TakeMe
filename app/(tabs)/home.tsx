import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { auth, db } from "../../firebase";

const logoImg = require("../../assets/images/logo-new.jpg");

export default function HomeScreen() {
  const [unreadHelp, setUnreadHelp] = useState(0);
  // Future messages badge. No `messages` collection exists yet, so this stays 0
  // for now – the listener can be added here the same way as unreadHelp.
  const [unreadMessages] = useState(0);

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

  return (
    <SafeAreaView style={styles.page}>
      {/* Top notification icons (Instagram/Facebook style) */}
      <View style={styles.topBar}>
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
          onPress={() => router.push("/driver/messages" as any)}
          hitSlop={8}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={26} color="#7C5F46" />
          {unreadMessages > 0 ? (
            <View style={styles.iconBadge}>
              <Text style={styles.iconBadgeText}>
                {unreadMessages > 99 ? "99+" : unreadMessages}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      <View style={styles.hero}>
        <Image source={logoImg} style={styles.logo} />

        <Text style={styles.title}>Take Me</Text>

        <View style={styles.badge}>
          <Text style={styles.badgeText}>🚗 Community Rides & Deliveries</Text>
        </View>

        <Text style={styles.description}>
          Connect with neighbors heading your way. Safe, affordable rides and
          deliveries for your community.
        </Text>

        <Pressable
          style={styles.primaryButton}
          onPress={() => router.push("/booking/ride-category" as any)}
        >
          <Text style={styles.primaryButtonText}>🔍 Find a Ride</Text>
        </Pressable>

        <Pressable
          style={styles.outlineButton}
          onPress={() => router.push("/driver/add-route" as any)}
        >
          <Text style={styles.outlineButtonText}>Become a Driver →</Text>
        </Pressable>

        <Pressable style={styles.ghostButton}>
          <Text style={styles.ghostButtonText}>❓ Forgot Something?</Text>
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
