import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
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
import { createPassengerBooking } from "./bookingsLib";

type DriverProfile = {
  name?: string;
  phone?: string;
  age?: number | string;
  driverAge?: number | string;
  gender?: string;
  language?: string;
  languages?: string[];
  ratingAverage?: number;
  ratingCount?: number;
};

type DriverComment = {
  user: string;
  text: string;
  stars: number;
  createdAtSeconds: number;
};

type DriverRoute = {
  id: string;
  driverId?: string;

  driverName?: string;
  phone?: string;
  gender?: "male" | "female";
  languages?: string[];

  profile?: DriverProfile;

  car?: string;
  carColor?: string;
  carPlate?: string;

  allowsPets?: boolean;

  category?: string;
  from?: string;
  to?: string;
  fromNormalized?: string;
  toNormalized?: string;

  tripDate?: string;
  deliveryDate?: string;
  day?: string;
  availableDays?: string[];
  time?: string;
  price?: number;
  seats?: number;

  storeName?: string;
  recipientPhone?: string;
  itemDescription?: string;

  rating?: number;
  reviews?: number;
  eta?: number;
  active?: boolean;

  comments?: DriverComment[];
};

const LANGUAGES: Record<string, string> = {
  ar: "Arabic",
  he: "Hebrew",
  en: "English",
  ru: "Russian",
};

const MAX_TIME_DIFF_MINUTES = 30;

const normalize = (value: string) => value.trim().toLowerCase();

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
  if (!passengerTime) return true;
  if (!driverTime) return false;

  const driverMinutes = timeToMinutes(driverTime);
  const passengerMinutes = timeToMinutes(passengerTime);

  if (driverMinutes === null || passengerMinutes === null) return false;

  return Math.abs(driverMinutes - passengerMinutes) <= MAX_TIME_DIFF_MINUTES;
};

const languageToCode = (value: any) => {
  const clean = String(value || "")
    .trim()
    .toLowerCase();

  if (
    clean === "ar" ||
    clean === "arabic" ||
    clean === "عربي" ||
    clean === "العربية"
  ) {
    return "ar";
  }

  if (clean === "he" || clean === "hebrew" || clean === "עברית") {
    return "he";
  }

  if (clean === "en" || clean === "english") {
    return "en";
  }

  if (clean === "ru" || clean === "russian" || clean === "русский") {
    return "ru";
  }

  return "";
};

const getProfileLanguages = (profile?: DriverProfile) => {
  if (!profile) return [];

  if (Array.isArray(profile.languages)) {
    return profile.languages
      .map(languageToCode)
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index);
  }

  const singleLanguage = languageToCode(profile.language);

  return singleLanguage ? [singleLanguage] : [];
};

const getDriverLanguages = (driver: DriverRoute) => {
  const profileLanguages = getProfileLanguages(driver.profile);

  if (profileLanguages.length > 0) {
    return profileLanguages;
  }

  if (Array.isArray(driver.languages)) {
    return driver.languages
      .map(languageToCode)
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index);
  }

  return [];
};

const normalizeGender = (value?: string) => {
  const gender = String(value || "").toLowerCase();

  if (gender === "female") return "female";
  if (gender === "male") return "male";

  return "";
};

const getDriverGender = (driver: DriverRoute) => {
  return (
    normalizeGender(driver.profile?.gender) || normalizeGender(driver.gender)
  );
};

const getDriverName = (driver: DriverRoute) => {
  return driver.profile?.name || driver.driverName || "Driver";
};

const getDriverPhone = (driver: DriverRoute) => {
  return driver.profile?.phone || driver.phone || "";
};

const getReviewCreatedAtSeconds = (createdAt: any) => {
  if (!createdAt) return 0;
  if (typeof createdAt.seconds === "number") return createdAt.seconds;
  return 0;
};

const getDriverReviews = async (driverId: string) => {
  const reviewsSnap = await getDocs(
    query(collection(db, "driverReviews"), where("driverId", "==", driverId)),
  );

  return reviewsSnap.docs
    .map((reviewDoc) => {
      const data = reviewDoc.data();

      return {
        user:
          String(
            data.passengerName || data.user || data.userName || "",
          ).trim() || "Passenger",
        text: String(
          data.comment || data.reviewComment || data.text || "",
        ).trim(),
        stars: Number(data.rating || data.stars || 0),
        createdAtSeconds: getReviewCreatedAtSeconds(data.createdAt),
      };
    })
    .filter((review) => review.stars > 0)
    .sort((a, b) => b.createdAtSeconds - a.createdAtSeconds);
};

const getDriverRating = (
  driver: DriverRoute,
): { average: number; count: number } | null => {
  const profileCount = Number(driver.profile?.ratingCount) || 0;
  const profileAverage = Number(driver.profile?.ratingAverage) || 0;

  if (profileCount > 0 && profileAverage > 0) {
    return { average: profileAverage, count: profileCount };
  }

  const comments = driver.comments || [];

  if (comments.length === 0) return null;

  const total = comments.reduce((sum, comment) => sum + comment.stars, 0);
  const average = total / comments.length;

  return { average, count: comments.length };
};

const getDateText = (driver: DriverRoute) => {
  return driver.tripDate || driver.deliveryDate || "";
};

const getDaysText = (driver: DriverRoute) => {
  if (Array.isArray(driver.availableDays) && driver.availableDays.length > 0) {
    return driver.availableDays.join(", ");
  }

  return driver.day || "";
};

export default function DriverResultsScreen() {
  const params = useLocalSearchParams();

  const [drivers, setDrivers] = useState<DriverRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDriver, setExpandedDriver] = useState<string | null>(null);
  const [bookingBusy, setBookingBusy] = useState(false);

  const from = String(params.from || "");
  const to = String(params.to || "");
  const category = String(params.category || "");
  const genderPref = String(params.genderPref || "any");
  const seats = Number(params.seats || 1);

  const requestedTime = String(params.time || "");
  const requestedDate = String(params.tripDate || "");
  const requestedDay = String(params.tripDay || "");

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

      const routesWithoutProfiles: DriverRoute[] = snapshot.docs.map(
        (docSnap) => {
          const data = docSnap.data();

          return {
            id: docSnap.id,
            ...(data as Omit<DriverRoute, "id">),
          };
        },
      );

      const routesWithProfilesAndReviews: DriverRoute[] = await Promise.all(
        routesWithoutProfiles.map(async (driver) => {
          if (!driver.driverId) {
            return {
              ...driver,
              comments: [],
            };
          }

          try {
            const [profileSnap, comments] = await Promise.all([
              getDoc(doc(db, "users", driver.driverId)),
              getDriverReviews(driver.driverId),
            ]);

            return {
              ...driver,
              profile: profileSnap.exists()
                ? (profileSnap.data() as DriverProfile)
                : undefined,
              comments,
            };
          } catch {
            return {
              ...driver,
              comments: [],
            };
          }
        }),
      );

      const filtered = routesWithProfilesAndReviews.filter((driver) => {
        const driverFrom =
          driver.fromNormalized || normalize(driver.from || "");
        const driverTo = driver.toNormalized || normalize(driver.to || "");

        const activeMatches = driver.active !== false;
        const categoryMatches = !category || driver.category === category;

        const fromMatches = locationMatches(driverFrom, from);
        const toMatches = locationMatches(driverTo, to);

        const driverGender = getDriverGender(driver);
        const driverLanguages = getDriverLanguages(driver);

        const genderMatches =
          genderPref === "any" || driverGender === genderPref;

        const languageMatches =
          selectedLanguages.length === 0 ||
          selectedLanguages.some((lang) => driverLanguages.includes(lang));

        const isDelivery = driver.category === "delivery";

        const seatsMatches = isDelivery
          ? true
          : Number(driver.seats || 0) >= seats;

        const dateMatches =
          !requestedDate ||
          driver.tripDate === requestedDate ||
          driver.deliveryDate === requestedDate;

        let timeMatches = true;

        if (isDelivery) {
          timeMatches =
            !requestedTime || isTimeClose(driver.time, requestedTime);
        } else if (requestedDays.length > 0) {
          timeMatches = requestedDays.some((day) => {
            const driverDays = driver.availableDays || [];
            const passengerTimeForDay = requestedDayTimes[day];

            return (
              driverDays.includes(day) &&
              isTimeClose(driver.time, passengerTimeForDay)
            );
          });
        } else {
          timeMatches =
            !requestedTime || isTimeClose(driver.time, requestedTime);
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

  const handleBookDriver = async (driver: DriverRoute) => {
    if (bookingBusy) return;

    const isDelivery = driver.category === "delivery";
    const isPersonal = (driver.category || category) === "personal";
    const totalPrice = Number(driver.price || 0) * (isDelivery ? 1 : seats);

    if (isPersonal) {
      router.push({
        pathname: "/booking/ride-payment",
        params: {
          driverId: driver.driverId || "",
          driverName: getDriverName(driver),
          driverPhone: getDriverPhone(driver),
          routeId: driver.id,
          from: driver.from || from,
          to: driver.to || to,
          date: driver.tripDate || requestedDate || "",
          day: driver.day || requestedDay || "",
          time: driver.time || requestedTime || "",
          seats: String(seats),
          price: String(totalPrice),
          driverCar: driver.car || "",
          driverCarColor: driver.carColor || "",
          driverCarPlateLast3: (driver.carPlate || "")
            .replace(/\D/g, "")
            .slice(-3),
        },
      } as any);
      return;
    }

    try {
      setBookingBusy(true);

      await createPassengerBooking({
        driverId: driver.driverId,
        driverName: getDriverName(driver),
        routeId: driver.id,
        category: driver.category || category,
        from: driver.from || from,
        to: driver.to || to,
        date: driver.tripDate || driver.deliveryDate || requestedDate || "",
        time: driver.time || requestedTime || "",
        days: driver.availableDays || [],
        seats: isDelivery ? null : seats,
        price: totalPrice,
      });

      Alert.alert(
        "Booking Confirmed",
        `You selected ${getDriverName(driver)}. It was added to My Bookings.`,
      );

      router.push("/(tabs)/bookings" as any);
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Could not create the booking.");
    } finally {
      setBookingBusy(false);
    }
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

        {requestedDate ? (
          <Text style={styles.routeText}>📅 {requestedDate}</Text>
        ) : null}

        {drivers.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="car-outline" size={42} color="#8B7B6B" />
            <Text style={styles.emptyTitle}>No drivers found</Text>
            <Text style={styles.emptyText}>
              Try changing pickup location, destination, time, gender, language,
              date, or seats.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {drivers.map((driver) => {
              const isDelivery = driver.category === "delivery";
              const totalPrice =
                Number(driver.price || 0) * (isDelivery ? 1 : seats);

              const expanded = expandedDriver === driver.id;
              const comments = driver.comments || [];
              const driverLanguages = getDriverLanguages(driver);
              const dateText = getDateText(driver);
              const daysText = getDaysText(driver);
              const driverGender = getDriverGender(driver);
              const rating = getDriverRating(driver);

              return (
                <View key={driver.id} style={styles.card}>
                  <View style={styles.topRow}>
                    <View style={styles.driverInfoRow}>
                      <View style={styles.avatar}>
                        <Ionicons
                          name="person-outline"
                          size={29}
                          color="#F58220"
                        />
                      </View>

                      <View style={styles.driverTextBox}>
                        <Text style={styles.driverName}>
                          {getDriverName(driver)}
                        </Text>

                        <View style={styles.driverMetaRow}>
                          {driverGender ? (
                            <>
                              <Text style={styles.genderText}>
                                {driverGender === "female" ? "♀" : "♂"}
                              </Text>
                              <Text style={styles.dot}>•</Text>
                            </>
                          ) : null}

                          <Ionicons
                            name="location-outline"
                            size={15}
                            color="#7C5F46"
                          />

                          <Text style={styles.driverMetaText}>
                            {driver.from || from} → {driver.to || to}
                          </Text>
                        </View>
                      </View>
                    </View>

                    <View style={styles.ratingBox}>
                      <Ionicons name="star" size={16} color="#B86115" />
                      {rating ? (
                        <>
                          <Text style={styles.ratingText}>
                            {rating.average.toFixed(1)}
                          </Text>
                          <Text style={styles.reviewCount}>
                            ({rating.count})
                          </Text>
                        </>
                      ) : (
                        <Text style={styles.reviewCount}>New</Text>
                      )}
                    </View>
                  </View>

                  <View style={styles.detailsPanel}>
                    <View style={styles.detailsColumn}>
                      {(dateText || daysText) && (
                        <View style={styles.detailRow}>
                          <View style={styles.iconCircle}>
                            <Ionicons
                              name="calendar-outline"
                              size={17}
                              color="#F58220"
                            />
                          </View>

                          <View style={styles.detailTextBox}>
                            {dateText ? (
                              <Text style={styles.detailMainText}>
                                {dateText}
                              </Text>
                            ) : null}

                            {daysText ? (
                              <Text style={styles.detailSubText}>
                                {daysText}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                      )}

                      <View style={styles.softLine} />

                      <View style={styles.detailRow}>
                        <View style={styles.iconCircle}>
                          <Ionicons
                            name="time-outline"
                            size={17}
                            color="#F58220"
                          />
                        </View>

                        <View style={styles.detailTextBox}>
                          <Text style={styles.detailMainText}>
                            {driver.time || "--:--"}
                          </Text>
                          <Text style={styles.detailSubText}>
                            {isDelivery ? "Arrival time" : "Departure time"}
                          </Text>
                        </View>
                      </View>
                    </View>

                    <View style={styles.verticalDivider} />

                    <View style={styles.detailsColumn}>
                      {!isDelivery && (
                        <View style={styles.detailRow}>
                          <View style={styles.iconCircle}>
                            <Ionicons
                              name="people-outline"
                              size={17}
                              color="#F58220"
                            />
                          </View>

                          <View style={styles.detailTextBox}>
                            <Text style={styles.detailMainText}>
                              {driver.seats || 1} seats
                            </Text>
                            <Text style={styles.detailSubText}>Available</Text>
                          </View>
                        </View>
                      )}

                      {!isDelivery && <View style={styles.softLine} />}

                      <View style={styles.detailRow}>
                        <View style={styles.iconCircle}>
                          <Ionicons
                            name="bag-outline"
                            size={17}
                            color="#F58220"
                          />
                        </View>

                        <View style={styles.detailTextBox}>
                          <Text style={styles.priceText}>{totalPrice} ₪</Text>
                          <Text style={styles.detailSubText}>Price</Text>
                        </View>
                      </View>
                    </View>
                  </View>

                  <View style={styles.badgesRow}>
                    {driverLanguages.map((lang) => (
                      <View key={lang} style={styles.languageBadge}>
                        <Ionicons
                          name="language-outline"
                          size={15}
                          color="#178C7B"
                        />
                        <Text style={styles.languageText}>
                          {LANGUAGES[lang] || lang}
                        </Text>
                      </View>
                    ))}

                    {typeof driver.allowsPets === "boolean" && (
                      <View
                        style={[
                          styles.petBadge,
                          driver.allowsPets
                            ? styles.petAllowedBadge
                            : styles.petNotAllowedBadge,
                        ]}
                      >
                        <Ionicons
                          name={
                            driver.allowsPets ? "paw-outline" : "close-outline"
                          }
                          size={15}
                          color={driver.allowsPets ? "#F58220" : "#7C5F46"}
                        />

                        <Text
                          style={[
                            styles.petText,
                            driver.allowsPets
                              ? styles.petAllowedText
                              : styles.petNotAllowedText,
                          ]}
                        >
                          {driver.allowsPets ? "Pets allowed" : "No pets"}
                        </Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.divider} />

                  <Pressable
                    style={styles.reviewsButton}
                    onPress={() =>
                      setExpandedDriver(expanded ? null : driver.id)
                    }
                  >
                    <View style={styles.reviewsLeft}>
                      <Ionicons
                        name="chatbubble-ellipses-outline"
                        size={18}
                        color="#F58220"
                      />

                      <Text style={styles.reviewsButtonText}>
                        Reviews ({comments.length})
                      </Text>
                    </View>

                    <Ionicons
                      name={expanded ? "chevron-up" : "chevron-down"}
                      size={20}
                      color="#7C5F46"
                    />
                  </Pressable>

                  {expanded && (
                    <View style={styles.commentsBox}>
                      {comments.length === 0 ? (
                        <View style={styles.noCommentsRow}>
                          <View style={styles.noCommentsIcon}>
                            <Ionicons
                              name="chatbox-outline"
                              size={18}
                              color="#7C5F46"
                            />
                          </View>

                          <Text style={styles.commentText}>
                            No reviews yet for this driver.
                          </Text>
                        </View>
                      ) : (
                        comments.map((comment, index) => (
                          <View key={index} style={styles.commentItem}>
                            <View style={styles.commentHeader}>
                              <Text style={styles.commentUser}>
                                {comment.user}
                              </Text>

                              <View style={styles.starsRow}>
                                {Array.from({ length: 5 }).map((_, i) => (
                                  <Ionicons
                                    key={i}
                                    name={
                                      i < comment.stars
                                        ? "star"
                                        : "star-outline"
                                    }
                                    size={13}
                                    color="#F58220"
                                  />
                                ))}
                              </View>
                            </View>

                            <Text style={styles.commentText}>
                              {comment.text || "No comment."}
                            </Text>
                          </View>
                        ))
                      )}
                    </View>
                  )}

                  <Pressable
                    style={[styles.bookButton, bookingBusy && { opacity: 0.6 }]}
                    onPress={() => handleBookDriver(driver)}
                    disabled={bookingBusy}
                  >
                    <Text style={styles.bookButtonText}>Book This Driver</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
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
    borderRadius: 22,
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
  list: {
    gap: 18,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 24,
    padding: 18,
    marginBottom: 18,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 2,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 20,
  },
  driverInfoRow: {
    flexDirection: "row",
    flex: 1,
    gap: 12,
    alignItems: "center",
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#FFF2E8",
    alignItems: "center",
    justifyContent: "center",
  },
  driverTextBox: {
    flex: 1,
  },
  driverName: {
    fontSize: 21,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 5,
  },
  driverMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexWrap: "wrap",
  },
  genderText: {
    color: "#7C5F46",
    fontSize: 15,
    fontWeight: "900",
  },
  dot: {
    color: "#7C5F46",
    fontSize: 14,
    fontWeight: "900",
  },
  driverMetaText: {
    color: "#7C5F46",
    fontSize: 14,
    fontWeight: "700",
    flexShrink: 1,
  },
  ratingBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FFF2E8",
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 15,
  },
  ratingText: {
    fontWeight: "900",
    color: "#111827",
    fontSize: 15,
  },
  reviewCount: {
    color: "#7C5F46",
    fontSize: 12,
  },
  detailsPanel: {
    flexDirection: "row",
    backgroundColor: "#FBF7F1",
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
  },
  detailsColumn: {
    flex: 1,
    gap: 10,
  },
  verticalDivider: {
    width: 1,
    backgroundColor: "#E9DCD0",
    marginHorizontal: 14,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 42,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: "#FFF2E8",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  detailTextBox: {
    flex: 1,
  },
  detailMainText: {
    color: "#111827",
    fontSize: 15,
    fontWeight: "900",
  },
  detailSubText: {
    color: "#7C5F46",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  priceText: {
    color: "#111827",
    fontSize: 17,
    fontWeight: "900",
  },
  softLine: {
    height: 1,
    backgroundColor: "#E9DCD0",
  },
  badgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginBottom: 16,
  },
  languageBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#EAF8F5",
    borderWidth: 1,
    borderColor: "#9DDDD2",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
  },
  languageText: {
    color: "#178C7B",
    fontSize: 13,
    fontWeight: "900",
  },
  petBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
  },
  petAllowedBadge: {
    backgroundColor: "#FFF3E6",
    borderColor: "#FDBA74",
  },
  petNotAllowedBadge: {
    backgroundColor: "#F5F1ED",
    borderColor: "#E4DDD7",
  },
  petText: {
    fontSize: 13,
    fontWeight: "900",
  },
  petAllowedText: {
    color: "#F58220",
  },
  petNotAllowedText: {
    color: "#7C5F46",
  },
  divider: {
    height: 1,
    backgroundColor: "#F0E5DC",
    marginBottom: 14,
  },
  reviewsButton: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  reviewsLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  reviewsButtonText: {
    color: "#3C2319",
    fontSize: 15,
    fontWeight: "900",
  },
  commentsBox: {
    backgroundColor: "#F8F4EF",
    borderRadius: 16,
    padding: 13,
    marginBottom: 16,
    gap: 10,
  },
  noCommentsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  noCommentsIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#EFE6DD",
    alignItems: "center",
    justifyContent: "center",
  },
  commentItem: {
    gap: 4,
  },
  commentHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  commentUser: {
    fontSize: 14,
    fontWeight: "900",
    color: "#111827",
  },
  starsRow: {
    flexDirection: "row",
    gap: 2,
  },
  commentText: {
    color: "#7C5F46",
    fontSize: 14,
  },
  bookButton: {
    backgroundColor: "#F58220",
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    position: "relative",
  },
  bookButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
  },
});
