// ---------------------------------------------------------------------------
// Collapsible "Reviews (N)" section shown on every driver result card
// (School, Personal Ride, Work, Errands). Reviews are lazy-loaded from
// driverReviews the first time the section is expanded, not fetched
// up-front for every card in a results list.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { formatLocalizedDate } from "../i18n/formatters";
import { useLanguage } from "../i18n/LanguageProvider";
import { DriverReviewItem, loadDriverReviews } from "./driverReviewsLib";

type Props = {
  driverId: string;
  // users/{driverId}.ratingCount — shown next to "Reviews" before the list
  // has been loaded, so the header doesn't read "Reviews (0)" while closed.
  reviewCountHint?: number | null;
};

export default function DriverReviewsSection({
  driverId,
  reviewCountHint,
}: Props) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reviews, setReviews] = useState<DriverReviewItem[]>([]);

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);

    if (!next || loaded || loading || !driverId) return;

    try {
      setLoading(true);
      setLoadError(false);
      const items = await loadDriverReviews(driverId);
      setReviews(items);
      setLoaded(true);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const displayCount = loaded ? reviews.length : (reviewCountHint ?? 0);
  // Star-only reviews (no written comment) still count toward the header
  // above and toward the driver's overall rating/count — they just aren't
  // rendered as a blank comment line below.
  const reviewsWithComments = reviews.filter((review) => review.comment);

  return (
    <>
      <Pressable style={styles.reviewsButton} onPress={toggle}>
        <View style={styles.reviewsLeft}>
          <Ionicons
            name="chatbubble-ellipses-outline"
            size={18}
            color="#F58220"
          />
          <Text style={styles.reviewsButtonText}>
            {t("driver.reviewsCount", { count: displayCount })}
          </Text>
        </View>

        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={20}
          color="#7C5F46"
        />
      </Pressable>

      {expanded ? (
        <View style={styles.commentsBox}>
          {loading ? (
            <View style={styles.noCommentsRow}>
              <ActivityIndicator color="#F58220" />
              <Text style={styles.commentText}>{t("driver.loadingReviews")}</Text>
            </View>
          ) : loadError ? (
            <Text style={styles.commentText}>{t("driver.couldNotLoadReviews")}</Text>
          ) : reviews.length === 0 ? (
            <View style={styles.noCommentsRow}>
              <View style={styles.noCommentsIcon}>
                <Ionicons name="chatbox-outline" size={18} color="#7C5F46" />
              </View>

              <Text style={styles.commentText}>{t("driver.noReviewsYet")}</Text>
            </View>
          ) : reviewsWithComments.length === 0 ? (
            <View style={styles.noCommentsRow}>
              <View style={styles.noCommentsIcon}>
                <Ionicons name="chatbox-outline" size={18} color="#7C5F46" />
              </View>

              <Text style={styles.commentText}>{t("driver.noWrittenReviewsYet")}</Text>
            </View>
          ) : (
            reviewsWithComments.map((review, index) => (
              <View key={index} style={styles.commentItem}>
                <View style={styles.commentHeader}>
                  <Text style={styles.commentUser}>
                    {review.passengerName}
                  </Text>

                  <View style={styles.starsRow}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Ionicons
                        key={i}
                        name={i < review.rating ? "star" : "star-outline"}
                        size={13}
                        color="#F58220"
                      />
                    ))}
                  </View>
                </View>

                <Text style={styles.commentText}>{review.comment}</Text>

                {review.createdAtSeconds > 0 ? (
                  <Text style={styles.commentDate}>
                    {formatLocalizedDate(
                      new Date(review.createdAtSeconds * 1000),
                      language,
                    )}
                  </Text>
                ) : null}
              </View>
            ))
          )}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
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
    flexShrink: 1,
  },
  commentDate: {
    color: "#8B7B6B",
    fontSize: 11.5,
    fontWeight: "700",
    marginTop: 2,
  },
});
