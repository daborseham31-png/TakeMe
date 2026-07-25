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
import { chevronForwardIconName, positionEnd } from "../../../i18n/rtl";
import DriverReviewsSection from "../../DriverReviewsSection";
import { getDisplayedDriverId } from "../../driverReviewsLib";

type Driver = {
  id: string;
  ownerId: string;
  name: string;
  gender: "male" | "female";
  phone: string;
  languages: string[];
  allowsPets: boolean;
  canTakeKids: boolean;
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
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadErrands();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadErrands = async () => {
    try {
      setLoading(true);

      const snapshot = await getDocs(collection(db, "errandJobs"));

      // The owner's rating is their overall driverReviews-backed rating
      // (users/{ownerId}.ratingAverage/ratingCount) — the SAME number shown
      // for School/Personal/Work — never a value cached on the errand
      // listing itself, so it stays correct after every future rating.
      const errandsList: Driver[] = await Promise.all(
        snapshot.docs.map(async (docSnap): Promise<Driver> => {
          const data = docSnap.data();

          let ratingAverage = 0;
          let ratingCount = 0;

          if (data.ownerId) {
            try {
              const profileSnap = await getDoc(doc(db, "users", data.ownerId));

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
            ownerId: data.ownerId || "",
            name: data.ownerName || "Person",
            gender: (data.gender === "female" ? "female" : "male") as
              | "male"
              | "female",
            phone: data.phone || "",
            languages: Array.isArray(data.languages) ? data.languages : [],
            allowsPets: data.allowsPets === true,
            canTakeKids: data.canTakeKids === true,

            rating: ratingAverage,
            reviews: ratingCount,

            price: Number(data.price || 0),

            destination: "errands",
            destinationLabel: data.errandTitle || "Errand",

            departureTime: data.startTime || "",
            returnTime: data.endTime || "",

            date: data.date || "",
            day: data.day || "",

            location: data.location || "",
            seats: Number(data.seats || 1),
          };
        }),
      );

      const filteredErrands = errandsList
        .filter((driver) => isTodayOrFuture(driver.date))
        .sort((a, b) => {
          if (a.date === b.date) {
            return a.departureTime.localeCompare(b.departureTime);
          }

          return a.date.localeCompare(b.date);
        });

      setDrivers(filteredErrands);
    } catch (error: any) {
      console.log("Load errands error:", error.message);
      Alert.alert(t("common.error"), t("workErrand.couldNotLoadErrands"));
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
          <Text style={styles.loadingText}>{t("workErrand.loadingErrands")}</Text>
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
            size={25}
            color="#7A5C4B"
          />
        </Pressable>

        <View style={styles.pageHeader}>
          <View style={styles.headerIconCircle}>
            <Text style={styles.headerEmoji}>📍</Text>
          </View>

          <View>
            <Text style={styles.title}>{t("workErrand.errandsTitle")}</Text>
            <Text style={styles.subtitle}>{t("workErrand.errandsSubtitle")}</Text>
          </View>
        </View>

        {drivers.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="location-outline" size={44} color="#7A665C" />
            <Text style={styles.emptyTitle}>{t("workErrand.noErrandsFound")}</Text>
            <Text style={styles.emptyText}>{t("workErrand.noErrandsHint")}</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {drivers.map((driver) => {
              return (
                <View key={driver.id} style={styles.card}>
                  <View style={styles.header}>
                    <View style={styles.profileRow}>
                      <View style={styles.avatar}>
                        <Ionicons
                          name="person-outline"
                          size={27}
                          color="#F58220"
                        />
                      </View>

                      <View style={styles.profileInfo}>
                        <Text style={styles.name}>{driver.name}</Text>

                        <View style={styles.infoRow}>
                          <Text style={styles.infoText}>
                            {driver.gender === "male" ? "♂" : "♀"}
                          </Text>

                          <Text style={styles.dot}>•</Text>

                          <Ionicons
                            name="location-outline"
                            size={14}
                            color="#7A5C4B"
                          />

                          <Text style={styles.infoText}>{driver.location}</Text>
                        </View>
                      </View>
                    </View>

                    <View style={styles.ratingBox}>
                      <Ionicons name="star" size={17} color="#B45309" />
                      {driver.reviews > 0 ? (
                        <>
                          <Text style={styles.ratingText}>
                            {driver.rating.toFixed(1)}
                          </Text>
                          <Text style={styles.reviewsText}>
                            ({driver.reviews})
                          </Text>
                        </>
                      ) : (
                        <Text style={styles.reviewsText}>{t("workErrand.newEmployer")}</Text>
                      )}
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

                  <View style={styles.detailsBox}>
                    <View style={styles.detailColumn}>
                      <View style={styles.detailRow}>
                        <View style={styles.detailIconBox}>
                          <Ionicons
                            name="calendar-outline"
                            size={17}
                            color="#F58220"
                          />
                        </View>

                        <Text style={styles.detailText}>
                          {driver.date} ({driver.day})
                        </Text>
                      </View>

                      <View style={styles.line} />

                      <View style={styles.detailRow}>
                        <View style={styles.detailIconBox}>
                          <Ionicons
                            name="time-outline"
                            size={17}
                            color="#F58220"
                          />
                        </View>

                        <Text style={styles.detailText}>
                          {driver.departureTime} - {driver.returnTime}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.verticalLine} />

                    <View style={styles.detailColumn}>
                      <View style={styles.detailRow}>
                        <View style={styles.detailIconBox}>
                          <Ionicons
                            name="people-outline"
                            size={17}
                            color="#F58220"
                          />
                        </View>

                        <Text style={styles.detailText}>
                          {t("workErrand.seatsAvailableCount", { count: driver.seats })}
                        </Text>
                      </View>

                      <View style={styles.line} />

                      <View style={styles.detailRow}>
                        <View style={styles.detailIconBox}>
                          <Ionicons
                            name="bag-outline"
                            size={17}
                            color="#F58220"
                          />
                        </View>

                        <Text style={styles.price}>{driver.price} ₪</Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.badgesRow}>
                    {driver.languages.map((lang) => (
                      <View key={lang} style={styles.languageBadge}>
                        <Ionicons
                          name="language-outline"
                          size={15}
                          color="#178C7B"
                        />
                        <Text style={styles.languageText}>
                          {LANGUAGES_MAP[lang] || lang}
                        </Text>
                      </View>
                    ))}

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
                        color={driver.allowsPets ? "#F58220" : "#7A5C4B"}
                      />

                      <Text
                        style={[
                          styles.petText,
                          driver.allowsPets
                            ? styles.petAllowedText
                            : styles.petNotAllowedText,
                        ]}
                      >
                        {driver.allowsPets ? t("rides.petsAllowed") : t("rides.noPets")}
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.kidsBadge,
                        driver.canTakeKids
                          ? styles.kidsAllowedBadge
                          : styles.kidsNotAllowedBadge,
                      ]}
                    >
                      <Ionicons
                        name={
                          driver.canTakeKids
                            ? "people-outline"
                            : "close-outline"
                        }
                        size={15}
                        color={driver.canTakeKids ? "#2563EB" : "#7A5C4B"}
                      />

                      <Text
                        style={[
                          styles.kidsText,
                          driver.canTakeKids
                            ? styles.kidsAllowedText
                            : styles.kidsNotAllowedText,
                        ]}
                      >
                        {driver.canTakeKids ? t("workErrand.kidsAllowed") : t("workErrand.kidsNotAllowed")}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.divider} />

                  <DriverReviewsSection
                    driverId={getDisplayedDriverId(driver)}
                    reviewCountHint={driver.reviews}
                  />

                  <Pressable
                    style={styles.bookButton}
                    onPress={() => handleSelectDriver(driver)}
                  >
                    <Text style={styles.bookButtonText}>{t("workErrand.selectAndBook")}</Text>

                    <View style={[styles.bookArrowCircle, positionEnd(14, isRTL)]}>
                      <Ionicons
                        name={chevronForwardIconName(isRTL)}
                        size={22}
                        color="#F58220"
                      />
                    </View>
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
    marginBottom: 18,
  },
  pageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 28,
  },
  headerIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#FFF3E6",
    alignItems: "center",
    justifyContent: "center",
  },
  headerEmoji: {
    fontSize: 28,
  },
  title: {
    fontSize: 34,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 3,
  },
  subtitle: {
    fontSize: 16,
    color: "#7A5C4B",
  },
  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E4DDD7",
    borderRadius: 22,
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
    gap: 18,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E4DDD7",
    borderRadius: 24,
    padding: 18,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: {
      width: 0,
      height: 6,
    },
    shadowRadius: 14,
    elevation: 2,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 12,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#FFF3E6",
    alignItems: "center",
    justifyContent: "center",
  },
  profileInfo: {
    flex: 1,
  },
  name: {
    fontSize: 20,
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
    fontSize: 14,
    color: "#7A5C4B",
  },
  dot: {
    color: "#7A5C4B",
    fontWeight: "900",
  },
  ratingBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF3E6",
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 15,
    gap: 4,
  },
  ratingText: {
    fontSize: 16,
    color: "#111827",
    fontWeight: "900",
  },
  reviewsText: {
    fontSize: 13,
    color: "#7A5C4B",
  },
  destinationBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#FFF8F0",
    borderWidth: 1,
    borderColor: "#FFE2C5",
    borderRadius: 17,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16,
  },
  destinationIcon: {
    fontSize: 23,
  },
  destinationText: {
    fontSize: 20,
    fontWeight: "900",
    color: "#111827",
  },
  detailsBox: {
    flexDirection: "row",
    marginBottom: 16,
  },
  detailColumn: {
    flex: 1,
    gap: 10,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 35,
  },
  detailIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "#FFF3E6",
    alignItems: "center",
    justifyContent: "center",
  },
  detailText: {
    fontSize: 14,
    color: "#111827",
    flexShrink: 1,
  },
  price: {
    fontSize: 16,
    color: "#111827",
    fontWeight: "900",
  },
  line: {
    height: 1,
    backgroundColor: "#F0E5DC",
    marginRight: 10,
  },
  verticalLine: {
    width: 1,
    backgroundColor: "#F0E5DC",
    marginHorizontal: 12,
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
    color: "#7A5C4B",
  },
  kidsBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
  },
  kidsAllowedBadge: {
    backgroundColor: "#EFF6FF",
    borderColor: "#93C5FD",
  },
  kidsNotAllowedBadge: {
    backgroundColor: "#F5F1ED",
    borderColor: "#E4DDD7",
  },
  kidsText: {
    fontSize: 13,
    fontWeight: "900",
  },
  kidsAllowedText: {
    color: "#2563EB",
  },
  kidsNotAllowedText: {
    color: "#7A5C4B",
  },
  divider: {
    height: 1,
    backgroundColor: "#F0E5DC",
    marginBottom: 14,
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
  bookArrowCircle: {
    position: "absolute",
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
});
