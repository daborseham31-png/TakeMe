import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { auth, db } from "../firebase";
import {
  ChatUser,
  clearAllConversations,
  hideConversation,
  openConversation,
  searchUsers,
} from "./chat/chatLib";

type Conversation = {
  id: string;
  participants: string[];
  participantNames: Record<string, string>;
  lastMessage: string;
  lastMessageAtSeconds: number;
  unread: number;
  otherId: string;
  otherName: string;
  hidden?: boolean;
};

const formatTime = (seconds: number) => {
  if (!seconds) return "";
  const d = new Date(seconds * 1000);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes(),
    ).padStart(2, "0")}`;
  }
  return `${String(d.getDate()).padStart(2, "0")}/${String(
    d.getMonth() + 1,
  ).padStart(2, "0")}`;
};

export default function MessagesScreen() {
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearingAll, setClearingAll] = useState(false);

  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ChatUser[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setUid(user?.uid ?? null);
      if (!user) setLoading(false);
    });
  }, []);

  // Conversations for me. array-contains is a single filter → no index needed.
  useEffect(() => {
    if (!uid) return;
    setLoading(true);

    const unsub = onSnapshot(
      query(
        collection(db, "conversations"),
        where("participants", "array-contains", uid),
      ),
      (snap) => {
        const list: Conversation[] = snap.docs
          .map((d) => {
            const data = d.data();
            const participants: string[] = data.participants || [];
            const otherId = participants.find((p) => p !== uid) || "";
            const names = data.participantNames || {};
            const hiddenFor: string[] = data.hiddenFor || [];
            return {
              id: d.id,
              participants,
              participantNames: names,
              lastMessage: data.lastMessage || "",
              lastMessageAtSeconds: data.lastMessageAt?.seconds || 0,
              unread: data.unreadCount?.[uid] || 0,
              otherId,
              otherName: names[otherId] || "User",
              hidden: hiddenFor.includes(uid),
            };
          })
          .filter((c: any) => !c.hidden)
          .sort((a, b) => b.lastMessageAtSeconds - a.lastMessageAtSeconds);

        setConversations(list);
        setLoading(false);
      },
      () => setLoading(false),
    );

    return unsub;
  }, [uid]);

  // Debounced-ish user search on every change.
  useEffect(() => {
    const clean = search.trim();
    if (!clean) {
      setResults([]);
      return;
    }

    let active = true;
    setSearching(true);
    searchUsers(clean)
      .then((r) => {
        if (active) setResults(r);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setSearching(false);
      });

    return () => {
      active = false;
    };
  }, [search]);

  const openChat = async (other: ChatUser) => {
    try {
      const id = await openConversation(other);
      setSearch("");
      setResults([]);
      router.push({
        pathname: "/chat/[id]",
        params: { id, otherId: other.id, otherName: other.name },
      } as any);
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Could not open chat.");
    }
  };

  const openExisting = (c: Conversation) =>
    router.push({
      pathname: "/chat/[id]",
      params: { id: c.id, otherId: c.otherId, otherName: c.otherName },
    } as any);

  const onHide = (c: Conversation) =>
    Alert.alert("Delete chat", "Delete this conversation from your list?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          setConversations((prev) => prev.filter((item) => item.id !== c.id));
          hideConversation(c.id).catch(() => {});
        },
      },
    ]);

  const handleClearAll = () => {
    if (conversations.length === 0 || clearingAll) return;

    Alert.alert(
      "Clear all",
      "Clear all messages from your list?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: async () => {
            const ids = conversations.map((c) => c.id);

            setClearingAll(true);
            setConversations((prev) =>
              prev.filter((item) => !ids.includes(item.id)),
            );

            try {
              await clearAllConversations(ids);
            } catch (error: any) {
              Alert.alert("Error", error?.message || "Could not clear all.");
            } finally {
              setClearingAll(false);
            }
          },
        },
      ],
    );
  };

  const showingSearch = search.trim().length > 0;

  const initial = (name: string) => (name || "?").charAt(0).toUpperCase();

  const listContent = useMemo(() => conversations, [conversations]);

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#7C5F46" />
          <Text style={styles.backText}>Back</Text>
        </Pressable>

        <View style={styles.headerRow}>
          <View style={styles.header}>
            <Ionicons name="chatbubbles" size={26} color="#F58220" />
            <Text style={styles.title}>Messages</Text>
          </View>

          {conversations.length > 0 ? (
            <Pressable onPress={handleClearAll} disabled={clearingAll} hitSlop={8}>
              <Text style={styles.clearAllText}>
                {clearingAll ? "Clearing..." : "Clear All"}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.subtitle}>Chat with drivers and passengers</Text>

        {/* Search users by name */}
        <View style={styles.searchRow}>
          <Ionicons name="search-outline" size={18} color="#8B7B6B" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search a person by name…"
            placeholderTextColor="#8B7B6B"
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <Pressable onPress={() => setSearch("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color="#8B7B6B" />
            </Pressable>
          ) : null}
        </View>

        {showingSearch ? (
          <View style={styles.list}>
            {searching ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color="#F58220" />
              </View>
            ) : results.length === 0 ? (
              <Text style={styles.noResults}>No users found.</Text>
            ) : (
              results.map((u) => (
                <Pressable
                  key={u.id}
                  style={styles.row}
                  onPress={() => openChat(u)}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initial(u.name)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName}>{u.name}</Text>
                    <Text style={styles.rowSub}>{u.role}</Text>
                  </View>
                  <Ionicons name="chatbubble-outline" size={20} color="#F58220" />
                </Pressable>
              ))
            )}
          </View>
        ) : loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#F58220" />
          </View>
        ) : listContent.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Ionicons name="chatbubble-ellipses-outline" size={38} color="#8B7B6B" />
            </View>
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptyText}>
              Search a driver or passenger above to start a conversation.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {listContent.map((c) => (
              <View key={c.id} style={styles.row}>
                <Pressable
                  style={styles.rowMain}
                  onPress={() => openExisting(c)}
                  onLongPress={() => onHide(c)}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initial(c.otherName)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.rowTop}>
                      <Text style={styles.rowName} numberOfLines={1}>
                        {c.otherName}
                      </Text>
                      <Text style={styles.rowTime}>
                        {formatTime(c.lastMessageAtSeconds)}
                      </Text>
                    </View>
                    <View style={styles.rowBottom}>
                      <Text style={styles.rowLast} numberOfLines={1}>
                        {c.lastMessage || "Say hi 👋"}
                      </Text>
                      {c.unread > 0 ? (
                        <View style={styles.unreadBadge}>
                          <Text style={styles.unreadText}>
                            {c.unread > 99 ? "99+" : c.unread}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </Pressable>

                <Pressable
                  style={styles.rowDeleteButton}
                  onPress={() => onHide(c)}
                  hitSlop={8}
                >
                  <Ionicons name="trash-outline" size={18} color="#B91C1C" />
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
  page: { flex: 1, backgroundColor: "#FBF7F1" },
  scroll: { padding: 20, paddingTop: 50, paddingBottom: 40 },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 16,
  },
  backText: { color: "#7C5F46", fontWeight: "800", fontSize: 15 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontSize: 28, fontWeight: "900", color: "#111827" },
  clearAllText: { color: "#F58220", fontWeight: "900", fontSize: 14 },
  subtitle: {
    color: "#7C5F46",
    fontSize: 14,
    marginTop: 6,
    marginBottom: 18,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 18,
  },
  searchInput: { flex: 1, color: "#111827", fontWeight: "600", padding: 0 },
  loadingBox: { paddingVertical: 40, alignItems: "center" },
  noResults: { color: "#7C5F46", fontWeight: "700", paddingVertical: 12 },
  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#E7DCD1",
    padding: 34,
    alignItems: "center",
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#F3ECE3",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 6,
  },
  emptyText: { color: "#7C5F46", textAlign: "center", lineHeight: 20 },
  list: { gap: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 16,
    padding: 14,
  },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowDeleteButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#FFF2E8",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#F58220", fontWeight: "900", fontSize: 20 },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 3,
  },
  rowName: { fontSize: 16, fontWeight: "900", color: "#111827", flexShrink: 1 },
  rowSub: { color: "#7C5F46", fontSize: 13, fontWeight: "700", marginTop: 2 },
  rowTime: { color: "#8B7B6B", fontSize: 12, fontWeight: "700" },
  rowLast: { color: "#7C5F46", fontSize: 14, flexShrink: 1, marginRight: 8 },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#F58220",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  unreadText: { color: "#FFFFFF", fontWeight: "900", fontSize: 12 },
});
