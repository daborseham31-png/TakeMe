import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

type Review = {
  user: string;
  stars: number;
  text: string;
};

type Helper = {
  id: string;
  name: string;
  services: string;
  price: number;
  eta: number;
  rating: number;
  reviewsCount: number;
  reviews: Review[];
};

const HELPERS: Helper[] = [
  {
    id: "h1",
    name: "Khaled Mansour",
    services: "Flat tire, battery, towing",
    price: 80,
    eta: 7,
    rating: 4.9,
    reviewsCount: 55,
    reviews: [
      { user: "Sara", stars: 5, text: "Arrived fast and fixed my tire in minutes!" },
      { user: "Omar", stars: 5, text: "Very professional and friendly." },
    ],
  },
  {
    id: "h2",
    name: "Yousef Haddad",
    services: "Battery jump, fuel delivery",
    price: 60,
    eta: 12,
    rating: 4.7,
    reviewsCount: 38,
    reviews: [
      { user: "Lina", stars: 5, text: "Brought fuel quickly, life saver." },
      { user: "Dana", stars: 4, text: "Good service, a little late." },
    ],
  },
  {
    id: "h3",
    name: "Ahmad Zoabi",
    services: "Towing, lockout, tire change",
    price: 95,
    eta: 15,
    rating: 4.8,
    reviewsCount: 41,
    reviews: [
      { user: "Rami", stars: 5, text: "Towed my car safely, great guy." },
    ],
  },
];

export default function RoadsideHelpResultsScreen() {
  const params = useLocalSearchParams();

  const problemLabel = String(params.problemLabel || "Roadside Help");
  const description = String(params.description || "");
  const address = String(params.address || "");
  const lat = String(params.lat || "");
  const lng = String(params.lng || "");

  const [expanded, setExpanded] = useState<string | null>(null);

  const handleChoose = (helper: Helper) => {
    router.push({
      pathname: "/booking/roadside-help/payment",
      params: {
        problemLabel,
        description,
        address,
        lat,
        lng,
        helperName: helper.name,
        helperSpecialty: helper.services,
        helperEta: String(helper.eta),
        helperPrice: String(helper.price),
        helperRating: String(helper.rating),
      },
    } as any);
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#7C5F46" />
          <Text style={styles.backText}>Back</Text>
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.headerEmoji}>🔧</Text>
          <Text style={styles.title}>Available Helpers ({HELPERS.length})</Text>
        </View>

        <Text style={styles.routeText}>
          {problemLabel}
          {address ? ` • ${address}` : ""}
        </Text>

        <View style={styles.list}>
          {HELPERS.map((helper) => {
            const isOpen = expanded === helper.id;

            return (
              <View key={helper.id} style={styles.card}>
                <View style={styles.topRow}>
                  <View style={styles.helperInfoRow}>
                    <View style={styles.avatar}>
                      <Ionicons name="construct" size={26} color="#F58220" />
                    </View>

                    <View style={styles.helperTextBox}>
                      <Text style={styles.helperName}>{helper.name}</Text>
                      <Text style={styles.helperServices}>{helper.services}</Text>
                    </View>
                  </View>

                  <View style={styles.ratingBox}>
                    <Ionicons name="star" size={15} color="#B86115" />
                    <Text style={styles.ratingText}>{helper.rating}</Text>
                    <Text style={styles.reviewCount}>({helper.reviewsCount})</Text>
                  </View>
                </View>

                <View style={styles.metaRow}>
                  <View style={styles.metaItem}>
                    <Ionicons name="cash-outline" size={17} color="#F58220" />
                    <Text style={styles.metaText}>{helper.price} ₪</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Ionicons name="time-outline" size={17} color="#F58220" />
                    <Text style={styles.metaText}>{helper.eta} min</Text>
                  </View>
                </View>

                <Pressable
                  style={styles.reviewsButton}
                  onPress={() => setExpanded(isOpen ? null : helper.id)}
                >
                  <View style={styles.reviewsLeft}>
                    <Ionicons
                      name="chatbubble-ellipses-outline"
                      size={17}
                      color="#F58220"
                    />
                    <Text style={styles.reviewsButtonText}>
                      Reviews ({helper.reviews.length})
                    </Text>
                  </View>
                  <Ionicons
                    name={isOpen ? "chevron-up" : "chevron-down"}
                    size={18}
                    color="#7C5F46"
                  />
                </Pressable>

                {isOpen && (
                  <View style={styles.commentsBox}>
                    {helper.reviews.map((review, index) => (
                      <View key={index} style={styles.commentItem}>
                        <View style={styles.commentHeader}>
                          <Text style={styles.commentUser}>{review.user}</Text>
                          <View style={styles.starsRow}>
                            {Array.from({ length: review.stars }).map((_, i) => (
                              <Ionicons
                                key={i}
                                name="star"
                                size={12}
                                color="#F58220"
                              />
                            ))}
                          </View>
                        </View>
                        <Text style={styles.commentText}>{review.text}</Text>
                      </View>
                    ))}
                  </View>
                )}

                <Pressable
                  style={styles.chooseButton}
                  onPress={() => handleChoose(helper)}
                >
                  <Text style={styles.chooseButtonText}>Choose This Helper</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
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
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 16,
  },
  backText: {
    color: "#7C5F46",
    fontWeight: "800",
    fontSize: 15,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 6,
  },
  headerEmoji: {
    fontSize: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: "900",
    color: "#111827",
    flexShrink: 1,
  },
  routeText: {
    color: "#7C5F46",
    fontWeight: "700",
    marginBottom: 22,
  },
  list: {
    gap: 18,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 22,
    padding: 18,
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
    marginBottom: 16,
  },
  helperInfoRow: {
    flexDirection: "row",
    flex: 1,
    gap: 12,
    alignItems: "center",
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#FFF2E8",
    alignItems: "center",
    justifyContent: "center",
  },
  helperTextBox: {
    flex: 1,
  },
  helperName: {
    fontSize: 19,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 3,
  },
  helperServices: {
    color: "#7C5F46",
    fontSize: 14,
    fontWeight: "600",
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
    fontSize: 14,
  },
  reviewCount: {
    color: "#7C5F46",
    fontSize: 12,
  },
  metaRow: {
    flexDirection: "row",
    gap: 24,
    marginBottom: 14,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaText: {
    fontSize: 15,
    fontWeight: "900",
    color: "#111827",
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
    color: "#B86115",
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
  chooseButton: {
    backgroundColor: "#F58220",
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  chooseButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
});
