import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import {
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";

type JobListing = {
  id: number;
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

const mockListings: JobListing[] = [
  {
    id: 1,
    name: "Ahmad Jabarin",
    gender: "male",
    jobTypeEn: "Carpenter",
    descriptionEn: "Looking for a carpenter to help install a full kitchen",
    hourlyRate: 80,
    phone: "050-1234567",
    workHoursFrom: "08:00",
    workHoursTo: "16:00",
    dayEn: "Sunday",
    date: "2026-03-15",
    workersNeeded: 2,
    locationEn: "Nazareth",
    rating: 4.8,
    ratingCount: 23,
    languages: ["ar", "he"],
  },
  {
    id: 2,
    name: "Yousef Khatib",
    gender: "male",
    jobTypeEn: "Blacksmith",
    descriptionEn: "Looking for a blacksmith to help repair an iron gate",
    hourlyRate: 70,
    phone: "052-9876543",
    workHoursFrom: "07:00",
    workHoursTo: "14:00",
    dayEn: "Monday",
    date: "2026-03-16",
    workersNeeded: 1,
    locationEn: "Haifa",
    rating: 4.5,
    ratingCount: 15,
    languages: ["ar", "en"],
  },
  {
    id: 3,
    name: "Sami Awad",
    gender: "male",
    jobTypeEn: "Cook",
    descriptionEn: "Looking for a cook to help with a family party of 50 people",
    hourlyRate: 60,
    phone: "054-5551234",
    workHoursFrom: "10:00",
    workHoursTo: "18:00",
    dayEn: "Friday",
    date: "2026-03-20",
    workersNeeded: 3,
    locationEn: "Kafr Kanna",
    rating: 4.9,
    ratingCount: 41,
    languages: ["ar", "he", "en"],
  },
  {
    id: 4,
    name: "Khaled Zoabi",
    gender: "male",
    jobTypeEn: "Painter",
    descriptionEn: "Looking for a painter to help with a 4-room apartment",
    hourlyRate: 55,
    phone: "053-7778899",
    workHoursFrom: "09:00",
    workHoursTo: "17:00",
    dayEn: "Tuesday",
    date: "2026-03-17",
    workersNeeded: 2,
    locationEn: "Nazareth",
    rating: 4.3,
    ratingCount: 9,
    languages: ["ar"],
  },
  {
    id: 5,
    name: "Lina Haddad",
    gender: "female",
    jobTypeEn: "Clothing Sales",
    descriptionEn: "Looking for someone to work with me at a clothing store in Nazareth",
    hourlyRate: 45,
    phone: "050-3334455",
    workHoursFrom: "09:00",
    workHoursTo: "17:00",
    dayEn: "Sunday",
    date: "2026-03-15",
    workersNeeded: 1,
    locationEn: "Nazareth",
    rating: 4.7,
    ratingCount: 18,
    languages: ["ar", "he"],
  },
  {
    id: 6,
    name: "Rania Masri",
    gender: "female",
    jobTypeEn: "Bakery Assistant",
    descriptionEn: "Looking for someone to work with me at a cake and sweets shop",
    hourlyRate: 50,
    phone: "052-6667788",
    workHoursFrom: "07:00",
    workHoursTo: "15:00",
    dayEn: "Monday",
    date: "2026-03-16",
    workersNeeded: 2,
    locationEn: "Kafr Kanna",
    rating: 4.9,
    ratingCount: 32,
    languages: ["ar", "ru"],
  },
];

export default function FindWorkScreen() {
const handleApply = (listing: JobListing) => {
  router.push({
    pathname: "/booking/work-errand/work/apply",
    params: {
      job: JSON.stringify(listing),
    },
  } as any);
};

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

        <View style={styles.list}>
          {mockListings.map((listing) => (
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
                  <Text style={styles.ratingCount}>({listing.ratingCount})</Text>
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
                  <Ionicons name="calendar-outline" size={16} color="#7A665C" />
                  <Text style={styles.detailText}>
                    {listing.dayEn} · {listing.date}
                  </Text>
                </View>

                <View style={styles.detail}>
                  <Ionicons name="location-outline" size={16} color="#7A665C" />
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
                      {LANGUAGES_MAP[lang]}
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