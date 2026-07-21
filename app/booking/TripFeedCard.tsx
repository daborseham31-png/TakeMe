// ---------------------------------------------------------------------------
// Shared card for the Home "Trips near you" feed. One component for all four
// categories (Personal Ride, School Ride, Work, Errand) — do not fork this
// per category; category-specific rows are simple conditionals below.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { FeedCategory, FeedItem } from "./homeFeedLib";
import { schoolTripDirectionLabel } from "./schoolTripsLib";

// Language names are always shown in their own script, regardless of the
// app's current UI language — these are never translated.
const LANGUAGE_LABELS: Record<string, string> = {
  ar: "العربية",
  he: "עברית",
  en: "English",
  ru: "Русский",
};

const CATEGORY_META: Record<
  FeedCategory,
  {
    labelKey: string;
    icon: keyof typeof Ionicons.glyphMap;
    color: string;
    bookLabelKey: string;
  }
> = {
  personal: {
    labelKey: "rides.personalRide",
    icon: "person-outline",
    color: "#EC4899",
    bookLabelKey: "rides.bookRide",
  },
  school: {
    labelKey: "rides.schoolRide",
    icon: "school-outline",
    color: "#3B82F6",
    bookLabelKey: "rides.requestSchoolRide",
  },
  schoolTrip: {
    labelKey: "rides.schoolRide",
    icon: "school-outline",
    color: "#3B82F6",
    bookLabelKey: "schoolTrip.viewDetails",
  },
  work: {
    labelKey: "rides.work",
    icon: "briefcase-outline",
    color: "#22C55E",
    bookLabelKey: "rides.applyForWork",
  },
  errand: {
    labelKey: "rides.errand",
    icon: "location-outline",
    color: "#F58220",
    bookLabelKey: "rides.requestErrand",
  },
};

type Props = {
  item: FeedItem;
  onPressBook: () => void;
  // Opens the driver's reviews (see DriverProfileReviewsModal) — omitted
  // (never rendered as Pressable) when the item has no real providerId, e.g.
  // Work/Errand listings keyed by employerId/ownerId are still valid here,
  // only a genuinely missing id disables it.
  onPressDriver?: () => void;
  distanceKm?: number | null;
};

export default function TripFeedCard({
  item,
  onPressBook,
  onPressDriver,
  distanceKm,
}: Props) {
  const { t } = useTranslation();
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
            {t(meta.labelKey)}
          </Text>
        </View>

        {/* Which leg THIS specific card is — never both at once, even for a
            trip originally created as outbound-and-return (see
            schoolTripDirectionLabel in schoolTripsLib.ts). */}
        {item.category === "schoolTrip" && item.direction ? (
          <View
            style={[
              styles.directionBadge,
              item.direction === "to_school" ? styles.directionBadgeOutbound : styles.directionBadgeReturn,
            ]}
          >
            <Ionicons
              name={item.direction === "to_school" ? "arrow-forward-circle" : "arrow-back-circle"}
              size={13}
              color={item.direction === "to_school" ? "#2563EB" : "#B86115"}
            />
            <Text
              style={[
                styles.directionBadgeText,
                { color: item.direction === "to_school" ? "#2563EB" : "#B86115" },
              ]}
            >
              {schoolTripDirectionLabel(t, item.direction)}
            </Text>
          </View>
        ) : null}

        <View style={styles.topRowRight}>
          {typeof distanceKm === "number" ? (
            <View style={styles.distancePill}>
              <Ionicons name="navigate-outline" size={12} color="#2563EB" />
              <Text style={styles.distancePillText}>
                {t("home.distanceAway", { distance: distanceKm.toFixed(1) })}
              </Text>
            </View>
          ) : null}

          {item.isWeekly ? (
            <View style={styles.weeklyPill}>
              <Ionicons name="calendar-outline" size={12} color="#B86115" />
              <Text style={styles.weeklyPillText}>{t("rides.weekly")}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Route / title row */}
      {item.category === "personal" ? (
        <View style={styles.routeDotsRow}>
          <View style={styles.routeDotsColumn}>
            <View style={styles.routeDotStart} />
            <View style={styles.routeDotLine} />
            <View style={styles.routeDotEnd} />
          </View>
          <View style={styles.routeDotsText}>
            <Text style={styles.routeText}>{item.from || "?"}</Text>
            <Text style={[styles.routeText, styles.routeTextMuted]}>
              {item.to || "?"}
            </Text>
          </View>
        </View>
      ) : item.category === "school" || item.category === "schoolTrip" ? (
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
              {t("rides.daysAvailable", {
                count: item.availableWeeklyDays.length,
              })}
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
            <Text style={styles.priceText}>
              ₪{item.price ?? 0}/{t("rides.perHour")}
            </Text>
          </View>
        ) : item.price !== null ? (
          <View style={styles.metaItem}>
            <Ionicons name="cash-outline" size={14} color="#F58220" />
            <Text style={styles.priceText}>
              ₪{item.price}
              {item.category === "personal" ||
              item.category === "school" ||
              item.category === "schoolTrip"
                ? ` ${t("rides.perSeat")}`
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
                ? t("rides.workersNeeded")
                : item.category === "errand"
                  ? t("rides.placesAvailable")
                  : t("rides.seatsAvailable")}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Car details — rides only */}
      {(item.category === "personal" || item.category === "school" || item.category === "schoolTrip") &&
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
              {/* Plate numbers stay LTR regardless of app language. */}
              <Text style={[styles.metaText, styles.ltrText]}>
                ***{item.carPlateLast3}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.divider} />

      {/* Provider row — pressable (opens the driver's reviews) without
          overlapping the Book button below it. */}
      <Pressable
        style={styles.providerRow}
        onPress={onPressDriver}
        disabled={!onPressDriver}
      >
        <View style={styles.avatar}>
          <Ionicons name="person" size={16} color="#F58220" />
        </View>

        <View style={styles.providerInfo}>
          <Text style={styles.providerName} numberOfLines={1}>
            {item.providerName}
            {item.gender ? (item.gender === "male" ? " ♂" : " ♀") : ""}
          </Text>

          {languageLabels.length > 0 ? (
            <Text style={styles.languagesText} numberOfLines={1}>
              {languageLabels.join(", ")}
            </Text>
          ) : null}
        </View>

        <View style={styles.ratingPill}>
          <Ionicons name="star" size={12} color="#F58220" />
          {item.ratingCount > 0 ? (
            <Text style={styles.ratingText}>
              {item.ratingAverage.toFixed(1)}
              {item.ratingCount > 0 ? ` (${item.ratingCount})` : ""}
            </Text>
          ) : (
            <Text style={styles.ratingText}>{t("roadsideHelp.newDriverLabel")}</Text>
          )}
        </View>
      </Pressable>

      <Pressable onPress={onPressBook}>
        <LinearGradient
          colors={["#FFB870", "#F58220"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.bookButton}
        >
          <Text style={styles.bookButtonText}>{t(meta.bookLabelKey)}</Text>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#F0E5DC",
    borderRadius: 22,
    padding: 16,
    marginBottom: 14,
    shadowColor: "#D8541F",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 2,
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
  topRowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  distancePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#EFF6FF",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  distancePillText: {
    color: "#2563EB",
    fontWeight: "800",
    fontSize: 11,
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
  directionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 10,
  },
  directionBadgeOutbound: {
    backgroundColor: "#EFF6FF",
  },
  directionBadgeReturn: {
    backgroundColor: "#FFF2E8",
  },
  directionBadgeText: {
    fontWeight: "900",
    fontSize: 11.5,
  },
  routeText: {
    fontSize: 16,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 2,
  },
  routeTextMuted: {
    color: "#7C5F46",
  },
  routeDotsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 4,
  },
  routeDotsColumn: {
    alignItems: "center",
    paddingTop: 6,
  },
  routeDotStart: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#F58220",
  },
  routeDotLine: {
    width: 2,
    flex: 1,
    minHeight: 14,
    backgroundColor: "#F0D9C4",
    marginVertical: 3,
  },
  routeDotEnd: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: "#F58220",
  },
  routeDotsText: {
    flex: 1,
    justifyContent: "space-between",
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
  ltrText: {
    textAlign: "left",
    writingDirection: "ltr",
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
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#FFF2E8",
    borderWidth: 1.5,
    borderColor: "#FFDCB8",
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
  ratingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FFF2E8",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  ratingText: {
    fontSize: 12.5,
    fontWeight: "900",
    color: "#B86115",
  },
  languagesText: {
    fontSize: 12,
    color: "#7C5F46",
    flexShrink: 1,
    marginTop: 2,
  },
  bookButton: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  bookButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 14,
  },
});
