// ---------------------------------------------------------------------------
// Shared card for the Home "Trips near you" feed. One component for all four
// categories (Personal Ride, School Ride, Work, Errand) — do not fork this
// per category; category-specific rows are simple conditionals below.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { FeedCategory, FeedItem } from "./homeFeedLib";

const LANGUAGE_LABELS: Record<string, string> = {
  ar: "العربية",
  he: "עברית",
  en: "English",
  ru: "Русский",
};

const CATEGORY_META: Record<
  FeedCategory,
  { label: string; icon: keyof typeof Ionicons.glyphMap; color: string; bookLabel: string }
> = {
  personal: {
    label: "Personal Ride",
    icon: "person-outline",
    color: "#EC4899",
    bookLabel: "Book Ride",
  },
  school: {
    label: "School",
    icon: "school-outline",
    color: "#3B82F6",
    bookLabel: "Request School Ride",
  },
  work: {
    label: "Work",
    icon: "briefcase-outline",
    color: "#22C55E",
    bookLabel: "Apply for Work",
  },
  errand: {
    label: "Errand",
    icon: "location-outline",
    color: "#F58220",
    bookLabel: "Request Errand",
  },
};

type Props = {
  item: FeedItem;
  onPressBook: () => void;
};

export default function TripFeedCard({ item, onPressBook }: Props) {
  const meta = CATEGORY_META[item.category];
  const languageLabels = item.languages
    .map((code) => LANGUAGE_LABELS[code] || code)
    .filter(Boolean);

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={[styles.badge, { backgroundColor: `${meta.color}1A` }]}>
          <Ionicons name={meta.icon} size={14} color={meta.color} />
          <Text style={[styles.badgeText, { color: meta.color }]}>
            {meta.label}
          </Text>
        </View>

        {item.isWeekly ? (
          <View style={styles.weeklyPill}>
            <Ionicons name="calendar-outline" size={12} color="#B86115" />
            <Text style={styles.weeklyPillText}>Weekly</Text>
          </View>
        ) : null}
      </View>

      {/* Route / title row */}
      {item.category === "personal" ? (
        <Text style={styles.routeText}>
          {item.from || "?"} → {item.to || "?"}
        </Text>
      ) : item.category === "school" ? (
        <>
          {item.schoolName ? (
            <Text style={styles.routeText}>{item.schoolName}</Text>
          ) : null}
          <Text style={styles.subRouteText}>
            {item.from || "?"} → {item.to || "?"}
          </Text>
        </>
      ) : item.category === "work" ? (
        <Text style={styles.routeText}>{item.title}</Text>
      ) : (
        <Text style={styles.routeText}>{item.title}</Text>
      )}

      {/* Location line for Work/Errand (single place, not from→to) */}
      {(item.category === "work" || item.category === "errand") &&
      item.location ? (
        <View style={styles.infoRow}>
          <Ionicons name="location-outline" size={14} color="#7C5F46" />
          <Text style={styles.infoText}>{item.location}</Text>
        </View>
      ) : null}

      {/* Date / day / time */}
      <View style={styles.metaRow}>
        {item.isWeekly ? (
          <View style={styles.metaItem}>
            <Ionicons name="calendar-outline" size={14} color="#7C5F46" />
            <Text style={styles.metaText}>
              {item.availableWeeklyDays.length} day
              {item.availableWeeklyDays.length === 1 ? "" : "s"} available
            </Text>
          </View>
        ) : (
          <>
            {item.day || item.date ? (
              <View style={styles.metaItem}>
                <Ionicons name="calendar-outline" size={14} color="#7C5F46" />
                <Text style={styles.metaText}>
                  {item.day ? `${item.day} ` : ""}
                  {item.date}
                </Text>
              </View>
            ) : null}

            {item.category === "work" || item.category === "errand" ? (
              (item.startTime || item.endTime) && (
                <View style={styles.metaItem}>
                  <Ionicons name="time-outline" size={14} color="#7C5F46" />
                  <Text style={styles.metaText}>
                    {item.startTime}
                    {item.endTime ? `–${item.endTime}` : ""}
                  </Text>
                </View>
              )
            ) : item.time ? (
              <View style={styles.metaItem}>
                <Ionicons name="time-outline" size={14} color="#7C5F46" />
                <Text style={styles.metaText}>{item.time}</Text>
              </View>
            ) : null}
          </>
        )}
      </View>

      {/* Price + seats */}
      <View style={styles.metaRow}>
        {item.category === "work" ? (
          <View style={styles.metaItem}>
            <Ionicons name="cash-outline" size={14} color="#F58220" />
            <Text style={styles.priceText}>₪{item.price ?? 0}/hour</Text>
          </View>
        ) : item.price !== null ? (
          <View style={styles.metaItem}>
            <Ionicons name="cash-outline" size={14} color="#F58220" />
            <Text style={styles.priceText}>
              ₪{item.price}
              {item.category === "personal" || item.category === "school"
                ? " per seat"
                : ""}
            </Text>
          </View>
        ) : null}

        {typeof item.seats === "number" ? (
          <View style={styles.metaItem}>
            <Ionicons name="people-outline" size={14} color="#7C5F46" />
            <Text style={styles.metaText}>
              {item.seats}{" "}
              {item.category === "work"
                ? "workers needed"
                : item.category === "errand"
                  ? "places available"
                  : "seats available"}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Car details — rides only */}
      {(item.category === "personal" || item.category === "school") &&
      (item.car || item.carColor || item.carPlateLast3) ? (
        <View style={styles.metaRow}>
          {item.car ? (
            <View style={styles.metaItem}>
              <Ionicons name="car-outline" size={14} color="#7C5F46" />
              <Text style={styles.metaText}>{item.car}</Text>
            </View>
          ) : null}

          {item.carColor ? (
            <View style={styles.metaItem}>
              <Ionicons
                name="color-palette-outline"
                size={14}
                color="#7C5F46"
              />
              <Text style={styles.metaText}>{item.carColor}</Text>
            </View>
          ) : null}

          {item.carPlateLast3 ? (
            <View style={styles.metaItem}>
              <Ionicons name="barcode-outline" size={14} color="#7C5F46" />
              <Text style={styles.metaText}>***{item.carPlateLast3}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.divider} />

      {/* Provider row */}
      <View style={styles.providerRow}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={16} color="#F58220" />
        </View>

        <View style={styles.providerInfo}>
          <Text style={styles.providerName} numberOfLines={1}>
            {item.providerName}
            {item.gender ? (item.gender === "male" ? " ♂" : " ♀") : ""}
          </Text>

          <View style={styles.ratingRow}>
            <Ionicons name="star" size={12} color="#F58220" />
            {item.ratingCount > 0 ? (
              <Text style={styles.ratingText}>
                {item.ratingAverage.toFixed(1)} ({item.ratingCount})
              </Text>
            ) : (
              <Text style={styles.ratingText}>New</Text>
            )}

            {languageLabels.length > 0 ? (
              <Text style={styles.languagesText} numberOfLines={1}>
                {" "}
                · {languageLabels.join(", ")}
              </Text>
            ) : null}
          </View>
        </View>
      </View>

      <Pressable style={styles.bookButton} onPress={onPressBook}>
        <Text style={styles.bookButtonText}>{meta.bookLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 1,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  badgeText: {
    fontWeight: "900",
    fontSize: 12,
  },
  weeklyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FFF2E8",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  weeklyPillText: {
    color: "#B86115",
    fontWeight: "800",
    fontSize: 11,
  },
  routeText: {
    fontSize: 16,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 2,
  },
  subRouteText: {
    fontSize: 13,
    color: "#7C5F46",
    fontWeight: "700",
    marginBottom: 6,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
    marginBottom: 4,
  },
  infoText: {
    color: "#7C5F46",
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    marginTop: 8,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  metaText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#7C5F46",
  },
  priceText: {
    fontSize: 14,
    fontWeight: "900",
    color: "#F58220",
  },
  divider: {
    height: 1,
    backgroundColor: "#F0E5DC",
    marginTop: 12,
    marginBottom: 12,
  },
  providerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#FFF2E8",
    alignItems: "center",
    justifyContent: "center",
  },
  providerInfo: {
    flex: 1,
  },
  providerName: {
    fontSize: 14,
    fontWeight: "900",
    color: "#111827",
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#7C5F46",
  },
  languagesText: {
    fontSize: 12,
    color: "#7C5F46",
    flexShrink: 1,
  },
  bookButton: {
    backgroundColor: "#F58220",
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  bookButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 14,
  },
});
