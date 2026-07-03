import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
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

import { db } from "../../../../firebase";

type Comment = {
  user: string;
  text: string;
  stars: number;
};

type Driver = {
  id: string;
  name: string;
  gender: "male" | "female";
  phone: string;
  languages: string[];
  rating: number;
  reviews: number;
  price: number;
  destination: string;
  destinationLabel: string;
  departureTime: string;
  returnTime: string;
  date: string;
  day: string;
  location: string;
  seats: number;
  comments: Comment[];
};

const LANGUAGES_MAP: Record<string, string> = {
  ar: "العربية",
  he: "עברית",
  en: "English",
  ru: "Русский",
};

const DESTINATION_ICONS: Record<string, string> = {
  shopping: "🛒",
  nature: "🌿",
  beach: "🏖️",
  restaurant: "🍽️",
  hospital: "🏥",
  mall: "🏬",
  gym: "💪",
  pharmacy: "💊",
  errands: "📍",
};

const isTodayOrFuture = (dateText: string) => {
  const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) return true;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const errandDate = new Date(year, month - 1, day);
  errandDate.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return errandDate >= today;
};

export default function ErrandsScreen() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDriver, setExpandedDriver] = useState<string | null>(null);

  useEffect(() => {
    loadErrands();
  }, []);

  const loadErrands = async () => {
    try {
      setLoading(true);

      const snapshot = await getDocs(collection(db, "errandJobs"));

      const errandsList: Driver[] = snapshot.docs
        .map((docSnap): Driver => {
          const data = docSnap.data();

          return {
            id: docSnap.id,
            name: data.ownerName || "Person",
            gender: (data.gender === "female" ? "female" : "male") as
              | "male"
              | "female",
            phone: data.phone || "",
            languages: Array.isArray(data.languages) ? data.languages : [],

            rating: Number(data.rating || 4.8),
            reviews: Number(data.reviews || 0),

            price: Number(data.price || 0),

            destination: "errands",
            destinationLabel: data.errandTitle || "Errand",

            departureTime: data.startTime || "",
            returnTime: data.endTime || "",

            date: data.date || "",
            day: data.day || "",

            location: data.location || "",
            seats: Number(data.seats || 1),

            comments: Array.isArray(data.comments) ? data.comments : [],
          };
        })
        .filter((driver) => isTodayOrFuture(driver.date))
        .sort((a, b) => {
          if (a.date === b.date) {
            return a.departureTime.localeCompare(b.departureTime);
          }

          return a.date.localeCompare(b.date);
        });

      setDrivers(errandsList);
    } catch (error: any) {
      console.log("Load errands error:", error.message);
      Alert.alert("Error", "Could not load errands.");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectDriver = (driver: Driver) => {
    router.push({
      pathname: "/booking/work-errand/errand/book",
      params: {
        driver: JSON.stringify(driver),
      },
    } as any);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#F58220" />
          <Text style={styles.loadingText}>Loading errands...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#7A665C" />
        </Pressable>

        <Text style={styles.title}>📍 Errands</Text>
        <Text style={styles.subtitle}>Shopping, appointments, etc.</Text>

        {drivers.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="location-outline" size={44} color="#7A665C" />
            <Text style={styles.emptyTitle}>No errands found</Text>
            <Text style={styles.emptyText}>
              When someone creates an errand, it will appear here.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {drivers.map((driver) => (
              <View key={driver.id} style={styles.card}>
                <View style={styles.header}>
                  <View style={styles.profileRow}>
                    <View style={styles.avatar}>
                      <Ionicons
                        name="person-outline"
                        size={25}
                        color="#B45309"
                      />
                    </View>

                    <View style={styles.profileInfo}>
                      <Text style={styles.name}>{driver.name}</Text>

                      <View style={styles.infoRow}>
                        <Text style={styles.infoText}>
                          {driver.gender === "male" ? "♂" : "♀"}
                        </Text>

                        <Text style={styles.infoText}>•</Text>

                        <Ionicons
                          name="location-outline"
                          size={13}
                          color="#7A5C4B"
                        />

                        <Text style={styles.infoText}>{driver.location}</Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.ratingBox}>
                    <Ionicons name="star" size={16} color="#B45309" />
                    <Text style={styles.ratingText}>{driver.rating}</Text>
                    <Text style={styles.reviewsText}>({driver.reviews})</Text>
                  </View>
                </View>

                <View style={styles.destinationBox}>
                  <Text style={styles.destinationIcon}>
                    {DESTINATION_ICONS[driver.destination] || "📍"}
                  </Text>

                  <Text style={styles.destinationText}>
                    {driver.destinationLabel}
                  </Text>
                </View>

                <View style={styles.detailsGrid}>
                  <View style={styles.detail}>
                    <Ionicons
                      name="calendar-outline"
                      size={16}
                      color="#F58220"
                    />
                    <Text style={styles.detailText}>
                      {driver.date} ({driver.day})
                    </Text>
                  </View>

                  <View style={styles.detail}>
                    <Ionicons name="people-outline" size={16} color="#F58220" />
                    <Text style={styles.detailText}>
                      {driver.seats} seats available
                    </Text>
                  </View>

                  <View style={styles.detail}>
                    <Ionicons name="time-outline" size={16} color="#F58220" />
                    <Text style={styles.detailText}>
                      🚗 {driver.departureTime} → 🏠 {driver.returnTime}
                    </Text>
                  </View>

                  <View style={styles.detail}>
                    <Ionicons name="bag-outline" size={16} color="#F58220" />
                    <Text style={styles.price}>{driver.price} ₪</Text>
                  </View>
                </View>

                <View style={styles.phoneLangRow}>
                  <View style={styles.phoneRow}>
                    <Ionicons name="call-outline" size={16} color="#F58220" />
                    <Text style={styles.phoneText}>{driver.phone}</Text>
                  </View>

                  <View style={styles.languagesRow}>
                    {driver.languages.map((lang) => (
                      <View key={lang} style={styles.languageBadge}>
                        <Text style={styles.languageText}>
                          {LANGUAGES_MAP[lang] || lang}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>

                <Pressable
                  style={styles.commentsButton}
                  onPress={() =>
                    setExpandedDriver(
                      expandedDriver === driver.id ? null : driver.id,
                    )
                  }
                >
                  <Ionicons name="chatbox-outline" size={15} color="#F58220" />

                  <Text style={styles.commentsText}>
                    Comments ({driver.comments.length})
                  </Text>

                  <Ionicons
                    name={
                      expandedDriver === driver.id
                        ? "chevron-up"
                        : "chevron-down"
                    }
                    size={15}
                    color="#F58220"
                  />
                </Pressable>

                {expandedDriver === driver.id && (
                  <View style={styles.commentsBox}>
                    {driver.comments.length === 0 ? (
                      <Text style={styles.commentText}>No comments yet.</Text>
                    ) : (
                      driver.comments.map((comment, index) => (
                        <View key={index} style={styles.commentItem}>
                          <View style={styles.commentHeader}>
                            <Text style={styles.commentUser}>
                              {comment.user}
                            </Text>

                            <Text style={styles.commentStars}>
                              {"★".repeat(comment.stars)}
                            </Text>
                          </View>

                          <Text style={styles.commentText}>{comment.text}</Text>
                        </View>
                      ))
                    )}
                  </View>
                )}

                <Pressable
                  style={styles.bookButton}
                  onPress={() => handleSelectDriver(driver)}
                >
                  <Text style={styles.bookButtonText}>Select & Book</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  container: {
    paddingHorizontal: 20,
    paddingTop: 30,
    paddingBottom: 40,
  },
  loadingBox: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    color: "#7A5C4B",
    fontWeight: "800",
  },
  backButton: {
    width: 45,
    height: 40,
    justifyContent: "center",
    marginBottom: 10,
  },
  title: {
    fontSize: 30,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: "#7A5C4B",
    marginBottom: 26,
  },
  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E4DDD7",
    borderRadius: 14,
    padding: 28,
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
    color: "#7A5C4B",
    textAlign: "center",
    lineHeight: 20,
  },
  list: {
    gap: 16,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E4DDD7",
    borderRadius: 14,
    padding: 18,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 12,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#FFF3E6",
    alignItems: "center",
    justifyContent: "center",
  },
  profileInfo: {
    flex: 1,
  },
  name: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 5,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  infoText: {
    fontSize: 13,
    color: "#7A5C4B",
  },
  ratingBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF3E6",
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 4,
  },
  ratingText: {
    fontSize: 14,
    color: "#111827",
    fontWeight: "900",
  },
  reviewsText: {
    fontSize: 12,
    color: "#7A5C4B",
  },
  destinationBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#F5F1ED",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  destinationIcon: {
    fontSize: 22,
  },
  destinationText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#111827",
  },
  detailsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 12,
    marginBottom: 14,
  },
  detail: {
    width: "50%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingRight: 6,
  },
  detailText: {
    fontSize: 14,
    color: "#111827",
    flexShrink: 1,
  },
  price: {
    fontSize: 14,
    color: "#111827",
    fontWeight: "900",
  },
  phoneLangRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
    gap: 10,
  },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  phoneText: {
    fontSize: 14,
    color: "#111827",
  },
  languagesRow: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  languageBadge: {
    backgroundColor: "#2F9B95",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  languageText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  commentsButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 14,
  },
  commentsText: {
    color: "#F58220",
    fontSize: 14,
    fontWeight: "700",
  },
  commentsBox: {
    backgroundColor: "#F5F1ED",
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    gap: 10,
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
  commentStars: {
    fontSize: 12,
    color: "#F58220",
  },
  commentText: {
    fontSize: 13,
    color: "#7A5C4B",
  },
  bookButton: {
    backgroundColor: "#F58220",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  bookButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
});
