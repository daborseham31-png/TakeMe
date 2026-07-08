import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import { View } from "react-native";

import { auth, db } from "../../firebase";
import { RIDE_CATEGORY } from "../booking/rideBookingLib";

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
  const [hasPassengerAttention, setHasPassengerAttention] = useState(false);
  const [hasDriverAttention, setHasDriverAttention] = useState(false);
  const hasActiveRide = hasPassengerAttention || hasDriverAttention;

  // Live listeners: passenger side stays lit until the trip is rated;
  // driver side stays lit until the driver presses Finish Trip.
  useEffect(() => {
    let unsubPassenger: (() => void) | null = null;
    let unsubDriver: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      unsubPassenger?.();
      unsubDriver?.();
      unsubPassenger = null;
      unsubDriver = null;

      if (!user) {
        setHasPassengerAttention(false);
        setHasDriverAttention(false);
        return;
      }

      unsubPassenger = onSnapshot(
        query(collection(db, "bookings"), where("passengerId", "==", user.uid)),
        (snap) => {
          setHasPassengerAttention(
            snap.docs.some((d) => passengerNeedsAttention(d.data())),
          );
        },
        () => setHasPassengerAttention(false),
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
