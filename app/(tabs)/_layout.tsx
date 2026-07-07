import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import { View } from "react-native";

import { auth, db } from "../../firebase";
import { isActiveRideStatus, RIDE_CATEGORY } from "../booking/rideBookingLib";

// Small green dot shown over the My Bookings tab icon while the passenger has an
// active (unfinished) personal-ride booking.
function BookingsTabIcon({
  color,
  size,
  hasActive,
}: {
  color: string;
  size: number;
  hasActive: boolean;
}) {
  return (
    <View>
      <Ionicons name="car" size={size} color={color} />
      {hasActive ? (
        <View
          style={{
            position: "absolute",
            top: -2,
            right: -3,
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

export default function TabLayout() {
  const [hasActiveRide, setHasActiveRide] = useState(false);

  // Live listener: any of the passenger's bookings still in booked/on_the_way/
  // arrived means an active ride the passenger hasn't finished yet.
  useEffect(() => {
    let unsubBookings: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      unsubBookings?.();
      unsubBookings = null;

      if (!user) {
        setHasActiveRide(false);
        return;
      }

      unsubBookings = onSnapshot(
        query(collection(db, "bookings"), where("passengerId", "==", user.uid)),
        (snap) => {
          const active = snap.docs.some((d) => {
            const data = d.data();
            return (
              data.category === RIDE_CATEGORY &&
              isActiveRideStatus(data.status)
            );
          });
          setHasActiveRide(active);
        },
        () => setHasActiveRide(false),
      );
    });

    return () => {
      unsubBookings?.();
      unsubAuth();
    };
  }, []);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#F58220",
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="bookings"
        options={{
          title: "My Bookings",
          tabBarIcon: ({ color, size }) => (
            <BookingsTabIcon
              color={color}
              size={size}
              hasActive={hasActiveRide}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
