import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

type Comment = {
  user: string;
  text: string;
  stars: number;
};

type Driver = {
  id: number;
  name: string;
  gender: "male" | "female";
  age: number;
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
};

const mockDrivers: Driver[] = [
  {
    id: 1,
    name: "Layla Mansour",
    gender: "female",
    age: 28,
    phone: "050-1234567",
    languages: ["ar", "he"],
    rating: 4.9,
    reviews: 53,
    price: 20,
    destination: "shopping",
    destinationLabel: "Shopping at Big Mall",
    departureTime: "10:00",
    returnTime: "13:00",
    date: "2026-03-14",
    day: "Sat",
    location: "Nazareth",
    seats: 3,
    comments: [
      { user: "Noor", text: "Very friendly and punctual!", stars: 5 },
      { user: "Hana", text: "Great ride, comfortable car", stars: 5 },
    ],
  },
  {
    id: 2,
    name: "Khaled Issa",
    gender: "male",
    age: 35,
    phone: "052-9876543",
    languages: ["ar", "en"],
    rating: 4.7,
    reviews: 31,
    price: 15,
    destination: "nature",
    destinationLabel: "Trip to Mount Tabor",
    departureTime: "08:00",
    returnTime: "15:00",
    date: "2026-03-15",
    day: "Sun",
    location: "Kafr Kanna",
    seats: 4,
    comments: [
      { user: "Ahmad", text: "Safe driver, knows the roads well", stars: 5 },
      { user: "Sara", text: "Good price for the trip", stars: 4 },
    ],
  },
  {
    id: 3,
    name: "Rania Khalil",
    gender: "female",
    age: 24,
    phone: "054-5551234",
    languages: ["ar", "he", "en"],
    rating: 4.8,
    reviews: 19,
    price: 25,
    destination: "beach",
    destinationLabel: "Beach Day in Haifa",
    departureTime: "09:00",
    returnTime: "17:00",
    date: "2026-03-14",
    day: "Sat",
    location: "Nazareth",
    seats: 2,
    comments: [{ user: "Lina", text: "Amazing experience!", stars: 5 }],
  },
  {
    id: 4,
    name: "Omar Haddad",
    gender: "male",
    age: 42,
    phone: "050-7778899",
    languages: ["ar"],
    rating: 4.5,
    reviews: 65,
    price: 18,
    destination: "restaurant",
    destinationLabel: "Lunch at Tiberias",
    departureTime: "11:30",
    returnTime: "14:30",
    date: "2026-03-16",
    day: "Mon",
    location: "Yafa an-Naseriyye",
    seats: 3,
    comments: [
      { user: "Yusuf", text: "Reliable and on time", stars: 4 },
      { user: "Fatima", text: "Very nice person", stars: 5 },
    ],
  },
  {
    id: 5,
    name: "Mira Sabbagh",
    gender: "female",
    age: 30,
    phone: "053-1112233",
    languages: ["ar", "he", "ru"],
    rating: 4.6,
    reviews: 27,
    price: 22,
    destination: "mall",
    destinationLabel: "Shopping at Grand Canyon Mall",
    departureTime: "14:00",
    returnTime: "18:00",
    date: "2026-03-15",
    day: "Sun",
    location: "Shefa-Amr",
    seats: 1,
    comments: [{ user: "Dina", text: "Fun and safe ride!", stars: 5 }],
  },
];

export default function ErrandsScreen() {
  const [expandedDriver, setExpandedDriver] = useState<number | null>(null);

const handleSelectDriver = (driver: Driver) => {
  router.push({
    pathname: "/booking/work-errand/errand/book",
    params: {
      driver: JSON.stringify(driver),
    },
  } as any);
};

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#7A665C" />
        </Pressable>

        <Text style={styles.title}>📍 Errands</Text>
        <Text style={styles.subtitle}>Shopping, appointments, etc.</Text>

        <View style={styles.list}>
          {mockDrivers.map((driver) => (
            <View key={driver.id} style={styles.card}>
              <View style={styles.header}>
                <View style={styles.profileRow}>
                  <View style={styles.avatar}>
                    <Ionicons name="person-outline" size={25} color="#B45309" />
                  </View>

                  <View style={styles.profileInfo}>
                    <Text style={styles.name}>{driver.name}</Text>

                    <View style={styles.infoRow}>
                      <Text style={styles.infoText}>
                        {driver.gender === "male" ? "♂" : "♀"}
                      </Text>
                      <Text style={styles.infoText}>Age {driver.age}</Text>
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
                  <Ionicons name="calendar-outline" size={16} color="#F58220" />
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
                        {LANGUAGES_MAP[lang]}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>

              <Pressable
                style={styles.commentsButton}
                onPress={() =>
                  setExpandedDriver(
                    expandedDriver === driver.id ? null : driver.id
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
                  {driver.comments.map((comment, index) => (
                    <View key={index} style={styles.commentItem}>
                      <View style={styles.commentHeader}>
                        <Text style={styles.commentUser}>{comment.user}</Text>

                        <Text style={styles.commentStars}>
                          {"★".repeat(comment.stars)}
                        </Text>
                      </View>

                      <Text style={styles.commentText}>{comment.text}</Text>
                    </View>
                  ))}
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