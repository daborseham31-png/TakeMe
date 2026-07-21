// ---------------------------------------------------------------------------
// Driver profile + reviews modal — opened from the Home "Trips near you"
// feed card (see TripFeedCard's provider row / home.tsx). Reuses the SAME
// driverReviewsLib.loadDriverReviews fetch already used by driverresults.tsx
// (DriverReviewsSection) — no second reviews query/collection.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import { doc, getDoc } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { db } from "../../firebase";
import { formatLocalizedDate } from "../i18n/formatters";
import { useLanguage } from "../i18n/LanguageProvider";
import { DriverReviewItem, loadDriverReviews } from "./driverReviewsLib";

type Props = {
  visible: boolean;
  driverId: string | null;
  // Fallback shown immediately (from the already-loaded feed item) while the
  // driver's own profile document is still loading.
  driverName?: string;
  onClose: () => void;
};

type DriverProfileSummary = {
  name: string;
  ratingAverage: number;
  ratingCount: number;
};

export default function DriverProfileReviewsModal({
  visible,
  driverId,
  driverName,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const { isRTL, language } = useLanguage();

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [profile, setProfile] = useState<DriverProfileSummary | null>(null);
  const [reviews, setReviews] = useState<DriverReviewItem[]>([]);

  useEffect(() => {
    if (!visible || !driverId) return;

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setLoadError(false);

      try {
        const [profileSnap, reviewItems] = await Promise.all([
          getDoc(doc(db, "users", driverId)),
          loadDriverReviews(driverId),
        ]);

        if (cancelled) return;

        const profileData = profileSnap.exists() ? profileSnap.data() : null;

        setProfile({
          name: profileData?.name || driverName || "Driver",
          ratingAverage: Number(profileData?.ratingAverage) || 0,
          ratingCount: Number(profileData?.ratingCount) || 0,
        });
        setReviews(reviewItems);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [visible, driverId, driverName]);

  useEffect(() => {
    if (!visible) {
      setProfile(null);
      setReviews([]);
      setLoadError(false);
    }
  }, [visible]);

  const displayName = profile?.name || driverName || "Driver";
  const ratingAverage = profile?.ratingAverage ?? 0;
  const ratingCount = profile?.ratingCount ?? 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={styles.avatar}>
              <Ionicons name="person" size={26} color="#F58220" />
            </View>

            <View style={styles.headerText}>
              <Text style={[styles.driverName, isRTL && styles.textRTL]}>
                {displayName}
              </Text>

              <View style={styles.ratingRow}>
                <Ionicons name="star" size={14} color="#F58220" />
                {ratingCount > 0 ? (
                  <Text style={styles.ratingText}>
                    {ratingAverage.toFixed(1)} · {t("rides.reviewsCount", { count: ratingCount })}
                  </Text>
                ) : (
                  <Text style={styles.ratingText}>{t("roadsideHelp.newDriverLabel")}</Text>
                )}
              </View>
            </View>

            <Pressable style={styles.closeButton} onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color="#7C5F46" />
            </Pressable>
          </View>

          <Text style={[styles.sectionTitle, isRTL && styles.textRTL]}>
            {t("rides.reviews")}
          </Text>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {loading ? (
              <View style={styles.centerRow}>
                <ActivityIndicator color="#F58220" />
                <Text style={styles.stateText}>{t("common.loading")}</Text>
              </View>
            ) : loadError ? (
              <View style={styles.centerRow}>
                <Ionicons name="alert-circle-outline" size={20} color="#B91C1C" />
                <Text style={styles.stateText}>{t("rides.reviewsLoadError")}</Text>
              </View>
            ) : !driverId ? (
              <View style={styles.centerRow}>
                <Ionicons name="person-outline" size={20} color="#7C5F46" />
                <Text style={styles.stateText}>{t("rides.driverMissing")}</Text>
              </View>
            ) : reviews.length === 0 ? (
              <View style={styles.centerRow}>
                <Ionicons name="chatbox-outline" size={20} color="#7C5F46" />
                <Text style={styles.stateText}>{t("rides.noReviewsYet")}</Text>
              </View>
            ) : (
              reviews.map((review, index) => (
                <View key={index} style={styles.reviewItem}>
                  <View style={styles.reviewHeader}>
                    <Text style={styles.reviewerName} numberOfLines={1}>
                      {review.passengerName}
                    </Text>

                    <View style={styles.starsRow}>
                      {Array.from({ length: 5 }).map((_, starIndex) => (
                        <Ionicons
                          key={starIndex}
                          name={starIndex < review.rating ? "star" : "star-outline"}
                          size={13}
                          color="#F58220"
                        />
                      ))}
                    </View>
                  </View>

                  <Text style={styles.reviewComment}>{review.comment}</Text>

                  {review.createdAtSeconds > 0 ? (
                    <Text style={styles.reviewDate}>
                      {formatLocalizedDate(
                        new Date(review.createdAtSeconds * 1000),
                        language,
                      )}
                    </Text>
                  ) : null}
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  backdrop: {
    flex: 1,
  },
  sheet: {
    backgroundColor: "#FBF7F1",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 34,
    maxHeight: "80%",
  },
  handle: {
    alignSelf: "center",
    width: 46,
    height: 5,
    borderRadius: 20,
    backgroundColor: "#D8C9BC",
    marginBottom: 14,
  },
  textRTL: {
    textAlign: "right",
    writingDirection: "rtl",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#FFF2E8",
    borderWidth: 1.5,
    borderColor: "#FFDCB8",
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: {
    flex: 1,
  },
  driverName: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  ratingText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#B86115",
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 10,
  },
  list: {
    marginBottom: 4,
  },
  listContent: {
    paddingBottom: 6,
  },
  centerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 20,
    justifyContent: "center",
  },
  stateText: {
    color: "#7C5F46",
    fontSize: 13.5,
    fontWeight: "700",
  },
  reviewItem: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#F0E5DC",
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    gap: 4,
  },
  reviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  reviewerName: {
    fontSize: 14,
    fontWeight: "900",
    color: "#111827",
    flexShrink: 1,
  },
  starsRow: {
    flexDirection: "row",
    gap: 2,
  },
  reviewComment: {
    color: "#7C5F46",
    fontSize: 13.5,
  },
  reviewDate: {
    color: "#8B7B6B",
    fontSize: 11.5,
    fontWeight: "700",
    marginTop: 2,
  },
});
