import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  QueryDocumentSnapshot,
} from "firebase/firestore";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Alert } from "../../../AppAlert";
import { useTranslation } from "react-i18next";

import { db } from "../../../../firebase";
import { getCategoryMeta } from "../../bookingsLib";
import { isCancelledTripStatus } from "../../driverViolationCore";
import {
  DirectionalRow,
  DirectionalScreen,
  DirectionalText,
} from "../../../i18n/DirectionalPrimitives";
import { translateCategoryLabel } from "../../../i18n/formatters";
import { useLanguage } from "../../../i18n/LanguageProvider";
import DriverReviewsSection from "../../DriverReviewsSection";
import { getDisplayedDriverId } from "../../driverReviewsLib";
import { getErrandBookingCount, isErrandHiddenFromSearch } from "../../homeFeedLib";

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
  // Real passenger booking count — see getErrandBookingCount in
  // homeFeedLib.ts. Never just `seats`, which is a static capacity number
  // that never decrements.
  bookingCount: number;
};

// Re-checked once a minute while this screen stays open (plus on focus) so
// an unbooked errand whose 5-minute grace window (see
// isErrandHiddenFromSearch) has elapsed disappears without needing a new
// Firestore read — mirrors Home's own EXPIRY_RECHECK_INTERVAL_MS pattern.
const EXPIRY_RECHECK_INTERVAL_MS = 60000;

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
  const meta = getCategoryMeta("errands");
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);

  // Ticks once a minute (plus on focus) purely to force an unbooked-and-
  // expired errand out of visibleDrivers below — never re-fetches from
  // Firestore by itself (see EXPIRY_RECHECK_INTERVAL_MS above).
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), EXPIRY_RECHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    loadErrands();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch whenever the passenger returns to this screen (spec: "apply
  // the filter... whenever the user returns to the screen") — picks up
  // both new/removed listings and any booking made elsewhere in the
  // meantime, not just the passage of time.
  useFocusEffect(
    useCallback(() => {
      loadErrands();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const loadErrands = async () => {
    try {
      setLoading(true);

      const snapshot = await getDocs(collection(db, "errandJobs"));

      // A trip the driver explicitly cancelled (or hid from their own list)
      // must never resurface in passenger browse results — see
      // driverViolationCore.ts's isCancelledTripStatus, the one shared
      // policy every public/search query should use.
      const openDocs = snapshot.docs.filter((docSnap: QueryDocumentSnapshot) => {
        const data = docSnap.data();
        return !isCancelledTripStatus(data.status) && data.deletedForDriver !== true;
      });

      // The owner's rating is their overall driverReviews-backed rating
      // (users/{ownerId}.ratingAverage/ratingCount) — the SAME number shown
      // for School/Personal/Work — never a value cached on the errand
      // listing itself, so it stays correct after every future rating.
      const errandsList: Driver[] = await Promise.all(
        openDocs.map(async (docSnap: QueryDocumentSnapshot): Promise<Driver> => {
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

            bookingCount: getErrandBookingCount(data),
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

  // The ONE place this screen hides an unbooked-and-expired errand — same
  // shared rule (isErrandHiddenFromSearch) the Home feed uses, re-evaluated
  // against nowTick so a card disappears on its own while this screen stays
  // open, without waiting for a new Firestore read (spec: "recalculate
  // automatically while the screen is open").
  const visibleDrivers = useMemo(
    () =>
      drivers.filter(
        (driver) =>
          !isErrandHiddenFromSearch(driver.date, driver.departureTime, driver.bookingCount, nowTick),
      ),
    [drivers, nowTick],
  );

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
      <DirectionalScreen style={styles.safe}>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#F58220" />
          <Text style={styles.loadingText}>{t("workErrand.loadingErrands")}</Text>
        </View>
      </DirectionalScreen>
    );
  }

  return (
    <DirectionalScreen style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <DirectionalRow style={styles.topRow}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Ionicons
              name={isRTL ? "arrow-forward" : "arrow-back"}
              size={25}
              color="#7A5C4B"
            />
          </Pressable>

          <DirectionalRow style={[styles.categoryBadge, { backgroundColor: `${meta.color}18` }]}>
            <Ionicons name={meta.icon} size={15} color={meta.color} />
            <DirectionalText style={[styles.categoryBadgeText, { color: meta.color }]}>
              {translateCategoryLabel("errands", meta.label, t)}
            </DirectionalText>
          </DirectionalRow>
        </DirectionalRow>

        <Text style={styles.subtitle}>{t("workErrand.errandsSubtitle")}</Text>

        {visibleDrivers.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="location-outline" size={44} color="#7A665C" />
            <Text style={styles.emptyTitle}>{t("workErrand.noErrandsFound")}</Text>
            <Text style={styles.emptyText}>{t("workErrand.noErrandsHint")}</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {visibleDrivers.map((driver) => {
              return (
                <View key={driver.id} style={styles.card}>
                  <View style={styles.header}>
                    <View style={styles.destinationHeaderRow}>
                      <Text style={styles.destinationIcon}>
                        {DESTINATION_ICONS[driver.destination] || "📍"}
                      </Text>

                      <Text style={styles.destinationText}>
                        {driver.destinationLabel}
                      </Text>
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

                  <View style={styles.profileRow}>
                    <View style={styles.avatar}>
                      <Ionicons
                        name="person-outline"
                        size={22}
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
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </DirectionalScreen>
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
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  backButton: {
    width: 45,
    height: 40,
    justifyContent: "center",
  },
  categoryBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  categoryBadgeText: {
    fontSize: 13.5,
    fontWeight: "900",
  },
  subtitle: {
    fontSize: 16,
    color: "#7A5C4B",
    marginBottom: 14,
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
    gap: 14,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E4DDD7",
    borderRadius: 20,
    padding: 14,
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
    alignItems: "center",
    marginBottom: 12,
  },
  destinationHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 8,
    marginRight: 10,
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 8,
    marginBottom: 14,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FFF3E6",
    alignItems: "center",
    justifyContent: "center",
  },
  profileInfo: {
    flex: 1,
  },
  name: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 3,
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
  dot: {
    color: "#7A5C4B",
    fontWeight: "900",
  },
  ratingBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF3E6",
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 13,
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
  destinationIcon: {
    fontSize: 22,
  },
  destinationText: {
    fontSize: 20,
    fontWeight: "900",
    color: "#111827",
    flexShrink: 1,
  },
  detailsBox: {
    flexDirection: "row",
    marginBottom: 12,
  },
  detailColumn: {
    flex: 1,
    gap: 8,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    minHeight: 30,
  },
  detailIconBox: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: "#FFF3E6",
    alignItems: "center",
    justifyContent: "center",
  },
  detailText: {
    fontSize: 13,
    color: "#111827",
    flexShrink: 1,
  },
  price: {
    fontSize: 14,
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
    gap: 7,
    marginBottom: 12,
  },
  languageBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#EAF8F5",
    borderWidth: 1,
    borderColor: "#9DDDD2",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  languageText: {
    color: "#178C7B",
    fontSize: 12,
    fontWeight: "900",
  },
  petBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
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
    fontSize: 12,
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
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
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
    fontSize: 12,
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
    marginBottom: 10,
  },
  bookButton: {
    backgroundColor: "#F58220",
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  bookButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
});
