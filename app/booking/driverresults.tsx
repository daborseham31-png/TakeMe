import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { collection, getDocs } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { db } from "../../firebase";

type DriverRoute = {
  id: string;
  driverId?: string;
  driverName?: string;
  phone?: string;
  car?: string;
  gender?: "male" | "female";
  languages?: string[];

  category?: string;
  from?: string;
  to?: string;
  fromNormalized?: string;
  toNormalized?: string;

  tripDate?: string;
  availableDays?: string[];
  time?: string;
  price?: number;
  seats?: number;

  rating?: number;
  reviews?: number;
  eta?: number;
  active?: boolean;

  comments?: {
    user: string;
    text: string;
    stars: number;
  }[];
};

const LANGUAGES: Record<string, string> = {
  ar: "Arabic",
  he: "Hebrew",
  en: "English",
  ru: "Russian",
};

const MAX_TIME_DIFF_MINUTES = 30;

const normalize = (value: string) => {
  return value.trim().toLowerCase();
};

const locationMatches = (driverValue: string, userValue: string) => {
  const driver = normalize(driverValue);
  const user = normalize(userValue);

  if (!user) return true;

  return driver === user || driver.includes(user) || user.includes(driver);
};

const timeToMinutes = (time: string) => {
  if (!time) return null;

  const parts = time.trim().split(":");
  const hours = Number(parts[0]);
  const minutes = Number(parts[1] || 0);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;

  return hours * 60 + minutes;
};

const isTimeClose = (driverTime: string | undefined, passengerTime: string) => {
  if (!passengerTime) return false;
  if (!driverTime) return false;

  const driverMinutes = timeToMinutes(driverTime);
  const passengerMinutes = timeToMinutes(passengerTime);

  if (driverMinutes === null || passengerMinutes === null) return false;

  const difference = Math.abs(driverMinutes - passengerMinutes);

  return difference <= MAX_TIME_DIFF_MINUTES;
};

export default function DriverResultsScreen() {
  const params = useLocalSearchParams();

  const [drivers, setDrivers] = useState<DriverRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDriver, setExpandedDriver] = useState<string | null>(null);

  const from = String(params.from || "");
  const to = String(params.to || "");
  const category = String(params.category || "");
  const genderPref = String(params.genderPref || "any");
  const seats = Number(params.seats || 1);

  const requestedTime = String(params.time || "");
  const requestedDate = String(params.tripDate || "");

  const selectedLanguages = String(params.languages || "")
    .split(",")
    .filter(Boolean);

  const requestedDays = String(params.days || "")
    .split(",")
    .filter(Boolean);

  let requestedDayTimes: Record<string, string> = {};

  try {
    requestedDayTimes = JSON.parse(String(params.dayTimes || "{}"));
  } catch {
    requestedDayTimes = {};
  }

  useEffect(() => {
    loadDrivers();
  }, []);

  const loadDrivers = async () => {
    try {
      setLoading(true);

      const snapshot = await getDocs(collection(db, "driverRoutes"));

      const allDrivers: DriverRoute[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();

        return {
          id: docSnap.id,
          ...(data as Omit<DriverRoute, "id">),
        };
      });

      const filtered = allDrivers.filter((driver) => {
        const driverFrom =
          driver.fromNormalized || normalize(driver.from || "");
        const driverTo = driver.toNormalized || normalize(driver.to || "");

        const activeMatches = driver.active !== false;

        const categoryMatches = !category || driver.category === category;

        const fromMatches = locationMatches(driverFrom, from);
        const toMatches = locationMatches(driverTo, to);

        const genderMatches =
          genderPref === "any" || driver.gender === genderPref;

        const languageMatches =
          selectedLanguages.length === 0 ||
          selectedLanguages.some((lang) =>
            (driver.languages || []).includes(lang),
          );

        const seatsMatches = Number(driver.seats || 0) >= seats;

        const dateMatches = !requestedDate || driver.tripDate === requestedDate;

        let timeMatches = true;

        if (requestedDays.length > 0) {
          timeMatches = requestedDays.some((day) => {
            const driverDays = driver.availableDays || [];
            const driverWorksThisDay = driverDays.includes(day);
            const passengerTimeForDay = requestedDayTimes[day];

            return (
              driverWorksThisDay &&
              isTimeClose(driver.time, passengerTimeForDay)
            );
          });
        } else {
          timeMatches = isTimeClose(driver.time, requestedTime);
        }

        return (
          activeMatches &&
          categoryMatches &&
          fromMatches &&
          toMatches &&
          genderMatches &&
          languageMatches &&
          seatsMatches &&
          dateMatches &&
          timeMatches
        );
      });

      setDrivers(filtered);
    } catch (error: any) {
      console.log("Load drivers error:", error.message);
      Alert.alert("Error", "Could not load drivers.");
    } finally {
      setLoading(false);
    }
  };

  const handleBookDriver = (driver: DriverRoute) => {
    Alert.alert(
      "Booking Confirmed",
      `You selected ${
        driver.driverName || "this driver"
      }. The booking will be added to My Bookings.`,
    );

    router.push("/(tabs)/bookings" as any);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.page}>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#F58220" />
          <Text style={styles.loadingText}>Loading drivers...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#7C5F46" />
          <Text style={styles.backText}>Back</Text>
        </Pressable>

        <Text style={styles.title}>Available Drivers ({drivers.length})</Text>

        <Text style={styles.routeText}>
          {from || "Any location"} → {to || "Any destination"}
        </Text>

        {drivers.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="car-outline" size={42} color="#8B7B6B" />
            <Text style={styles.emptyTitle}>No drivers found</Text>
            <Text style={styles.emptyText}>
              Try changing pickup location, destination, time, gender, language,
              or seats.
            </Text>
          </View>
        ) : (
          drivers.map((driver) => {
            const totalPrice = Number(driver.price || 0) * seats;
            const expanded = expandedDriver === driver.id;
            const comments = driver.comments || [];

            return (
              <View key={driver.id} style={styles.card}>
                <View style={styles.topRow}>
                  <View style={styles.driverInfoRow}>
                    <View style={styles.avatar}>
                      <Ionicons
                        name="person-outline"
                        size={28}
                        color="#B86115"
                      />
                    </View>

                    <View style={styles.driverTextBox}>
                      <Text style={styles.driverName}>
                        {driver.driverName || "Driver"}
                      </Text>

                      <Text style={styles.carText}>
                        {driver.car || "Car information"}
                      </Text>

                      <Text style={styles.localText}>
                        📍 Local driver - {driver.from} to {driver.to}
                      </Text>

                      {driver.time && (
                        <Text style={styles.timeText}>
                          Departure time: {driver.time}
                        </Text>
                      )}

                      {driver.tripDate && (
                        <Text style={styles.timeText}>
                          Date: {driver.tripDate}
                        </Text>
                      )}

                      {driver.availableDays?.length ? (
                        <Text style={styles.timeText}>
                          Days: {driver.availableDays.join(", ")}
                        </Text>
                      ) : null}
                    </View>
                  </View>

                  <View style={styles.ratingBox}>
                    <Ionicons name="star" size={15} color="#B86115" />
                    <Text style={styles.ratingText}>
                      {driver.rating || 4.8}
                    </Text>
                    <Text style={styles.reviewCount}>
                      ({driver.reviews || 0})
                    </Text>
                  </View>
                </View>

                <View style={styles.detailsRow}>
                  <View style={styles.detailItem}>
                    <Ionicons name="cash-outline" size={18} color="#F58220" />
                    <Text style={styles.detailText}>{totalPrice} ₪</Text>
                  </View>

                  <View style={styles.detailItem}>
                    <Ionicons name="time-outline" size={18} color="#F58220" />
                    <Text style={styles.detailText}>
                      {driver.eta || 10} min
                    </Text>
                  </View>

                  <View style={styles.detailItem}>
                    <Ionicons name="people-outline" size={18} color="#F58220" />
                    <Text style={styles.detailText}>
                      {driver.seats || 1} seats
                    </Text>
                  </View>
                </View>

                <View style={styles.languageRow}>
                  {(driver.languages || []).map((lang) => (
                    <View key={lang} style={styles.languageBadge}>
                      <Text style={styles.languageText}>
                        {LANGUAGES[lang] || lang}
                      </Text>
                    </View>
                  ))}
                </View>

                <Pressable
                  style={styles.reviewsButton}
                  onPress={() => setExpandedDriver(expanded ? null : driver.id)}
                >
                  <Ionicons
                    name="chatbubble-outline"
                    size={16}
                    color="#F58220"
                  />
                  <Text style={styles.reviewsButtonText}>
                    Reviews ({comments.length})
                  </Text>
                  <Ionicons
                    name={expanded ? "chevron-up" : "chevron-down"}
                    size={16}
                    color="#F58220"
                  />
                </Pressable>

                {expanded && (
                  <View style={styles.commentsBox}>
                    {comments.length === 0 ? (
                      <Text style={styles.commentText}>
                        No reviews yet for this driver.
                      </Text>
                    ) : (
                      comments.map((comment, index) => (
                        <View key={index} style={styles.commentItem}>
                          <Text style={styles.commentUser}>{comment.user}</Text>

                          <View style={styles.starsRow}>
                            {Array.from({ length: comment.stars }).map(
                              (_, i) => (
                                <Ionicons
                                  key={i}
                                  name="star"
                                  size={12}
                                  color="#F58220"
                                />
                              ),
                            )}
                          </View>

                          <Text style={styles.commentText}>{comment.text}</Text>
                        </View>
                      ))
                    )}
                  </View>
                )}

                <Pressable
                  style={styles.bookButton}
                  onPress={() => handleBookDriver(driver)}
                >
                  <Text style={styles.bookButtonText}>Book This Driver</Text>
                </Pressable>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  scroll: {
    padding: 20,
    paddingTop: 50,
    paddingBottom: 40,
  },
  loadingBox: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    color: "#7C5F46",
    fontWeight: "800",
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 20,
  },
  backText: {
    color: "#7C5F46",
    fontWeight: "800",
    fontSize: 15,
  },
  title: {
    fontSize: 28,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 8,
  },
  routeText: {
    color: "#7C5F46",
    fontWeight: "700",
    marginBottom: 22,
  },
  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E7DCD1",
    padding: 30,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: "#111827",
    marginTop: 12,
    marginBottom: 6,
  },
  emptyText: {
    color: "#7C5F46",
    textAlign: "center",
    lineHeight: 20,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
  },
  driverInfoRow: {
    flexDirection: "row",
    flex: 1,
    gap: 12,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#FFF2E8",
    alignItems: "center",
    justifyContent: "center",
  },
  driverTextBox: {
    flex: 1,
  },
  driverName: {
    fontSize: 19,
    fontWeight: "900",
    color: "#111827",
  },
  carText: {
    color: "#7C5F46",
    marginTop: 2,
  },
  localText: {
    color: "#F58220",
    marginTop: 4,
    fontSize: 12,
    fontWeight: "800",
  },
  timeText: {
    color: "#7C5F46",
    marginTop: 4,
    fontSize: 12,
    fontWeight: "700",
  },
  ratingBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#FFF2E8",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  ratingText: {
    fontWeight: "900",
    color: "#111827",
  },
  reviewCount: {
    color: "#7C5F46",
    fontSize: 12,
  },
  detailsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 18,
    marginTop: 16,
    marginBottom: 10,
  },
  detailItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  detailText: {
    fontWeight: "900",
    color: "#111827",
  },
  languageRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  languageBadge: {
    backgroundColor: "#3F9D96",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  languageText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 12,
  },
  reviewsButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    marginBottom: 12,
  },
  reviewsButtonText: {
    color: "#F58220",
    fontWeight: "800",
  },
  commentsBox: {
    backgroundColor: "#FBF7F1",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  commentItem: {
    marginBottom: 10,
  },
  commentUser: {
    fontWeight: "900",
    color: "#111827",
  },
  starsRow: {
    flexDirection: "row",
    gap: 2,
    marginVertical: 3,
  },
  commentText: {
    color: "#7C5F46",
  },
  bookButton: {
    backgroundColor: "#F58220",
    borderRadius: 12,
    padding: 15,
    marginTop: 4,
  },
  bookButtonText: {
    color: "#FFFFFF",
    textAlign: "center",
    fontWeight: "900",
    fontSize: 16,
  },
});
