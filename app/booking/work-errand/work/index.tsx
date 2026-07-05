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

type JobListing = {
  id: string;
  name: string;
  gender: "male" | "female";
  jobTypeEn: string;
  descriptionEn: string;
  hourlyRate: number;
  phone: string;
  workHoursFrom: string;
  workHoursTo: string;
  dayEn: string;
  date: string;
  workersNeeded: number;
  locationEn: string;
  rating: number;
  ratingCount: number;
  languages: string[];
};

const LANGUAGES_MAP: Record<string, string> = {
  ar: "العربية",
  he: "עברית",
  en: "English",
  ru: "Русский",
};

const isTodayOrFuture = (dateText: string) => {
  const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) return true;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const jobDate = new Date(year, month - 1, day);
  jobDate.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return jobDate >= today;
};

export default function FindWorkScreen() {
  const [listings, setListings] = useState<JobListing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadWorkJobs();
  }, []);

  const loadWorkJobs = async () => {
    try {
      setLoading(true);

      const snapshot = await getDocs(collection(db, "workJobs"));

      const jobs: JobListing[] = snapshot.docs
        .map((docSnap) => {
          const data = docSnap.data();

          return {
            id: docSnap.id,
            name: data.employerName || "Employer",
            gender: (data.gender === "female" ? "female" : "male") as
              | "male"
              | "female",
            jobTypeEn: data.jobTitle || "Work Job",
            descriptionEn: data.description || "No description",
            hourlyRate: Number(data.hourlyPay || 0),
            phone: data.phone || "",
            workHoursFrom: data.startTime || "",
            workHoursTo: data.endTime || "",
            dayEn: data.day || "",
            date: data.date || "",
            workersNeeded: Number(data.workersNeeded || 1),
            locationEn: data.location || "",
            rating: Number(data.rating || 4.8),
            ratingCount: Number(data.reviews || 0),
            languages: Array.isArray(data.languages) ? data.languages : [],
          };
        })
        .filter((job) => isTodayOrFuture(job.date))
        .sort((a, b) => {
          if (a.date === b.date) {
            return a.workHoursFrom.localeCompare(b.workHoursFrom);
          }

          return a.date.localeCompare(b.date);
        });

      setListings(jobs);
    } catch (error: any) {
      console.log("Load work jobs error:", error.message);
      Alert.alert("Error", "Could not load work jobs.");
    } finally {
      setLoading(false);
    }
  };

  const handleApply = (listing: JobListing) => {
    router.push({
      pathname: "/booking/work-errand/work/apply",
      params: {
        job: JSON.stringify(listing),
      },
    } as any);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#F58220" />
          <Text style={styles.loadingText}>Loading work jobs...</Text>
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

        <Text style={styles.title}>Find Work</Text>

        <Text style={styles.subtitle}>
          Employers looking for workers — apply now!
        </Text>

        {listings.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="briefcase-outline" size={44} color="#7A665C" />
            <Text style={styles.emptyTitle}>No work jobs found</Text>
            <Text style={styles.emptyText}>
              When someone posts a Work Helpers job, it will appear here.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {listings.map((listing) => (
              <View key={listing.id} style={styles.card}>
                <View style={styles.header}>
                  <View style={styles.leftHeader}>
                    <Text style={styles.name}>
                      {listing.name}{" "}
                      <Text style={styles.gender}>
                        {listing.gender === "male" ? "♂" : "♀"}
                      </Text>
                    </Text>

                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{listing.jobTypeEn}</Text>
                    </View>
                  </View>

                  <View style={styles.ratingBox}>
                    <Ionicons name="star" size={16} color="#F58220" />
                    <Text style={styles.ratingNumber}>{listing.rating}</Text>
                    <Text style={styles.ratingCount}>
                      ({listing.ratingCount})
                    </Text>
                  </View>
                </View>

                <Text style={styles.description}>{listing.descriptionEn}</Text>

                <View style={styles.detailsGrid}>
                  <View style={styles.detail}>
                    <Ionicons name="time-outline" size={16} color="#7A665C" />
                    <Text style={styles.detailText}>
                      {listing.workHoursFrom} - {listing.workHoursTo}
                    </Text>
                  </View>

                  <View style={styles.detail}>
                    <Ionicons
                      name="calendar-outline"
                      size={16}
                      color="#7A665C"
                    />
                    <Text style={styles.detailText}>
                      {listing.dayEn} · {listing.date}
                    </Text>
                  </View>

                  <View style={styles.detail}>
                    <Ionicons
                      name="location-outline"
                      size={16}
                      color="#7A665C"
                    />
                    <Text style={styles.detailText}>{listing.locationEn}</Text>
                  </View>

                  <View style={styles.detail}>
                    <Ionicons name="people-outline" size={16} color="#7A665C" />
                    <Text style={styles.detailText}>
                      {listing.workersNeeded} workers needed
                    </Text>
                  </View>

                  <View style={styles.detail}>
                    <Ionicons name="call-outline" size={16} color="#7A665C" />
                    <Text style={styles.detailText}>{listing.phone}</Text>
                  </View>

                  <View style={styles.detail}>
                    <Text style={styles.price}>₪{listing.hourlyRate}/hr</Text>
                  </View>
                </View>

                <View style={styles.languagesRow}>
                  <Ionicons name="language-outline" size={16} color="#7A665C" />

                  {listing.languages.map((lang) => (
                    <View key={lang} style={styles.languageBadge}>
                      <Text style={styles.languageText}>
                        {LANGUAGES_MAP[lang] || lang}
                      </Text>
                    </View>
                  ))}
                </View>

                <Pressable
                  style={styles.applyButton}
                  onPress={() => handleApply(listing)}
                >
                  <Text style={styles.applyText}>Apply for This Job</Text>
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
    paddingHorizontal: 18,
    paddingTop: 35,
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
    marginBottom: 6,
  },
  title: {
    fontSize: 30,
    fontWeight: "900",
    color: "#111827",
    textAlign: "center",
    marginTop: 5,
  },
  subtitle: {
    fontSize: 16,
    color: "#7A5C4B",
    textAlign: "center",
    marginTop: 10,
    marginBottom: 28,
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
    marginBottom: 12,
  },
  leftHeader: {
    flex: 1,
    paddingRight: 10,
  },
  name: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 8,
  },
  gender: {
    color: "#7A665C",
    fontSize: 14,
    fontWeight: "400",
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "#2F9B95",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  ratingBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  ratingNumber: {
    fontSize: 14,
    fontWeight: "900",
    color: "#111827",
  },
  ratingCount: {
    fontSize: 14,
    color: "#7A665C",
  },
  description: {
    fontSize: 14,
    color: "#7A5C4B",
    lineHeight: 20,
    marginBottom: 16,
  },
  detailsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 10,
  },
  detail: {
    width: "50%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingRight: 6,
  },
  detailText: {
    fontSize: 13,
    color: "#7A5C4B",
    flexShrink: 1,
  },
  price: {
    fontSize: 14,
    color: "#F58220",
    fontWeight: "900",
  },
  languagesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    flexWrap: "wrap",
    marginTop: 16,
    marginBottom: 16,
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
  applyButton: {
    backgroundColor: "#F58220",
    borderRadius: 9,
    paddingVertical: 13,
    alignItems: "center",
  },
  applyText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
});
