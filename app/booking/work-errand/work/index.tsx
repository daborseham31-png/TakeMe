import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
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
import { useTranslation } from "react-i18next";

import { db } from "../../../../firebase";
import { useLanguage } from "../../../i18n/LanguageProvider";
import { ltrContentStyle, paddingEnd } from "../../../i18n/rtl";
import DriverReviewsSection from "../../DriverReviewsSection";
import { getDisplayedDriverId } from "../../driverReviewsLib";

type JobListing = {
  id: string;
  employerId: string;
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
  remainingSeats: number;
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
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const [listings, setListings] = useState<JobListing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadWorkJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadWorkJobs = async () => {
    try {
      setLoading(true);

      const snapshot = await getDocs(collection(db, "workJobs"));

      // The employer's rating is their overall driverReviews-backed rating
      // (users/{employerId}.ratingAverage/ratingCount) — the SAME number
      // shown for School/Personal/Errand — never a value cached on the job
      // listing itself, so it stays correct after every future rating.
      const jobs = await Promise.all(
        snapshot.docs.map(async (docSnap) => {
          const data = docSnap.data();

          const totalSeats = Number(
            data.totalSeats ?? data.seats ?? data.workersNeeded ?? 1,
          );
          const remainingSeats =
            typeof data.remainingSeats === "number"
              ? data.remainingSeats
              : totalSeats;

          let ratingAverage = 0;
          let ratingCount = 0;

          if (data.employerId) {
            try {
              const profileSnap = await getDoc(
                doc(db, "users", data.employerId),
              );

              if (profileSnap.exists()) {
                const profile = profileSnap.data();
                ratingAverage = Number(profile.ratingAverage) || 0;
                ratingCount = Number(profile.ratingCount) || 0;
              }
            } catch {
              // Keep 0/0 -> renders as "New driver" below.
            }
          }

          return {
            id: docSnap.id,
            employerId: data.employerId || "",
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
            workersNeeded: totalSeats,
            remainingSeats,
            locationEn: data.location || "",
            rating: ratingAverage,
            ratingCount,
            languages: Array.isArray(data.languages) ? data.languages : [],

            // Filter-only fields, stripped back off below.
            available: data.available !== false,
            status: data.status || "available",
            deletedForDriver: data.deletedForDriver === true,
          };
        }),
      );

      const filteredJobs = jobs
        // A Work job stays visible to passengers for as long as it has
        // open places — it must NOT disappear after the first accepted
        // worker, only once remainingSeats actually reaches 0.
        .filter(
          (job) =>
            isTodayOrFuture(job.date) &&
            job.available &&
            job.remainingSeats > 0 &&
            job.status !== "full" &&
            job.status !== "completed" &&
            !job.deletedForDriver,
        )
        .map(({ available, status, deletedForDriver, ...job }): JobListing => job)
        .sort((a, b) => {
          if (a.date === b.date) {
            return a.workHoursFrom.localeCompare(b.workHoursFrom);
          }

          return a.date.localeCompare(b.date);
        });

      setListings(filteredJobs);
    } catch (error: any) {
      console.log("Load work jobs error:", error.message);
      Alert.alert(t("common.error"), t("workErrand.couldNotLoadWorkJobs"));
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
          <Text style={styles.loadingText}>{t("workErrand.loadingWorkJobs")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons
            name={isRTL ? "arrow-forward" : "arrow-back"}
            size={24}
            color="#7A665C"
          />
        </Pressable>

        <Text style={styles.title}>{t("workErrand.findWorkTitle")}</Text>

        <Text style={styles.subtitle}>{t("workErrand.findWorkSubtitle")}</Text>

        {listings.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="briefcase-outline" size={44} color="#7A665C" />
            <Text style={styles.emptyTitle}>{t("workErrand.noWorkJobsFound")}</Text>
            <Text style={styles.emptyText}>{t("workErrand.noWorkJobsHint")}</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {listings.map((listing) => (
              <View key={listing.id} style={styles.card}>
                <View style={styles.header}>
                  <View style={[styles.leftHeader, paddingEnd(10, isRTL)]}>
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
                    {listing.ratingCount > 0 ? (
                      <>
                        <Text style={styles.ratingNumber}>
                          {listing.rating.toFixed(1)}
                        </Text>
                        <Text style={styles.ratingCount}>
                          ({listing.ratingCount})
                        </Text>
                      </>
                    ) : (
                      <Text style={styles.ratingCount}>{t("workErrand.newEmployer")}</Text>
                    )}
                  </View>
                </View>

                <Text style={styles.description}>{listing.descriptionEn}</Text>

                <View style={styles.detailsGrid}>
                  <View style={[styles.detail, paddingEnd(6, isRTL)]}>
                    <Ionicons name="time-outline" size={16} color="#7A665C" />
                    <Text style={styles.detailText}>
                      {listing.workHoursFrom} - {listing.workHoursTo}
                    </Text>
                  </View>

                  <View style={[styles.detail, paddingEnd(6, isRTL)]}>
                    <Ionicons
                      name="calendar-outline"
                      size={16}
                      color="#7A665C"
                    />
                    <Text style={styles.detailText}>
                      {t(`booking.days.${listing.dayEn}`, { defaultValue: listing.dayEn })} ·{" "}
                      {listing.date}
                    </Text>
                  </View>

                  <View style={[styles.detail, paddingEnd(6, isRTL)]}>
                    <Ionicons
                      name="location-outline"
                      size={16}
                      color="#7A665C"
                    />
                    <Text style={styles.detailText}>{listing.locationEn}</Text>
                  </View>

                  <View style={[styles.detail, paddingEnd(6, isRTL)]}>
                    <Ionicons name="people-outline" size={16} color="#7A665C" />
                    <Text style={styles.detailText}>
                      {t("workErrand.workersNeededCount", { count: listing.workersNeeded })}
                    </Text>
                  </View>

                  <View style={[styles.detail, paddingEnd(6, isRTL)]}>
                    <Ionicons
                      name="checkmark-done-outline"
                      size={16}
                      color="#7A665C"
                    />
                    <Text style={styles.detailText}>
                      {t("workErrand.placesRemainingCount", { count: listing.remainingSeats })}
                    </Text>
                  </View>

                  <View style={[styles.detail, paddingEnd(6, isRTL)]}>
                    <Ionicons name="call-outline" size={16} color="#7A665C" />
                    <Text style={[styles.detailText, ltrContentStyle]}>{listing.phone}</Text>
                  </View>

                  <View style={[styles.detail, paddingEnd(6, isRTL)]}>
                    <Text style={styles.price}>
                      ₪{listing.hourlyRate}{t("booking.perHourShort")}
                    </Text>
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

                <View style={styles.divider} />

                <DriverReviewsSection
                  driverId={getDisplayedDriverId(listing)}
                  reviewCountHint={listing.ratingCount}
                />

                <Pressable
                  style={styles.applyButton}
                  onPress={() => handleApply(listing)}
                >
                  <Text style={styles.applyText}>{t("workErrand.applyForThisJob")}</Text>
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
  divider: {
    height: 1,
    backgroundColor: "#F0E5DC",
    marginBottom: 14,
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
