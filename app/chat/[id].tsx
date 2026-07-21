import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import {
  collection,
  onSnapshot,
  query,
} from "firebase/firestore";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useTranslation } from "react-i18next";

import { auth, db } from "../../firebase";
import { useLanguage } from "../i18n/LanguageProvider";
import { markConversationRead, sendMessage } from "./chatLib";

type Message = {
  id: string;
  senderId: string;
  text: string;
  createdAtSeconds: number;
};

const formatTime = (seconds: number) => {
  if (!seconds) return "";
  const d = new Date(seconds * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
};

export default function ChatScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const params = useLocalSearchParams();
  const convId = typeof params.id === "string" ? params.id : "";
  const otherId = typeof params.otherId === "string" ? params.otherId : "";
  const otherName =
    typeof params.otherName === "string" ? params.otherName : t("messages.chatFallbackTitle");

  const me = auth.currentUser?.uid ?? null;
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!convId) {
      setLoading(false);
      return;
    }

    // Single-collection order → no composite index needed (sorted client-side
    // to stay index-free even if some docs lack createdAt yet).
    const unsub = onSnapshot(
      query(collection(db, "conversations", convId, "messages")),
      (snap) => {
        const list = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              senderId: data.senderId || "",
              text: data.text || "",
              createdAtSeconds: data.createdAt?.seconds || 0,
            };
          })
          .sort((a, b) => a.createdAtSeconds - b.createdAtSeconds);

        setMessages(list);
        setLoading(false);
      },
      () => setLoading(false),
    );

    // Opening the chat clears my unread count.
    markConversationRead(convId);

    return unsub;
  }, [convId]);

  // Re-clear unread whenever new messages arrive while the screen is open.
  useEffect(() => {
    if (convId && messages.length > 0) markConversationRead(convId);
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages.length, convId]);

  const handleSend = async () => {
    const clean = text.trim();
    if (!clean || !convId || !otherId) return;
    setText("");
    try {
      setSending(true);
      await sendMessage(convId, clean, otherId);
    } catch {
      setText(clean);
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.headerBar}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name={isRTL ? "arrow-forward" : "arrow-back"} size={24} color="#7C5F46" />
        </Pressable>
        <View style={styles.headerAvatar}>
          <Text style={styles.headerAvatarText}>
            {(otherName || "?").charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.headerName} numberOfLines={1}>
          {otherName}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#F58220" />
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.messages}
            onContentSizeChange={() =>
              scrollRef.current?.scrollToEnd({ animated: true })
            }
          >
            {messages.length === 0 ? (
              <Text style={styles.empty}>
                {t("messages.noMessagesYetSayHello")}
              </Text>
            ) : (
              messages.map((m) => {
                const mine = m.senderId === me;
                return (
                  <View
                    key={m.id}
                    style={[
                      styles.bubbleRow,
                      mine ? styles.bubbleRowMine : styles.bubbleRowOther,
                    ]}
                  >
                    <View
                      style={[
                        styles.bubble,
                        mine ? styles.bubbleMine : styles.bubbleOther,
                      ]}
                    >
                      <Text
                        style={[
                          styles.bubbleText,
                          mine ? styles.bubbleTextMine : styles.bubbleTextOther,
                        ]}
                      >
                        {m.text}
                      </Text>
                      <Text
                        style={[
                          styles.bubbleTime,
                          mine ? styles.bubbleTimeMine : styles.bubbleTimeOther,
                        ]}
                      >
                        {formatTime(m.createdAtSeconds)}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        )}

        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            placeholder={t("messages.typeMessagePlaceholder")}
            placeholderTextColor="#8B7B6B"
            value={text}
            onChangeText={setText}
            multiline
          />
          <Pressable
            style={[styles.sendButton, (!text.trim() || sending) && styles.sendDisabled]}
            onPress={handleSend}
            disabled={!text.trim() || sending}
          >
            <Ionicons name="send" size={20} color="#FFFFFF" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#FBF7F1" },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 14,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E7DCD1",
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFF2E8",
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatarText: { color: "#F58220", fontWeight: "900", fontSize: 18 },
  headerName: { fontSize: 18, fontWeight: "900", color: "#111827", flexShrink: 1 },
  loadingBox: { flex: 1, alignItems: "center", justifyContent: "center" },
  messages: { padding: 16, paddingBottom: 20, gap: 8 },
  empty: {
    textAlign: "center",
    color: "#7C5F46",
    fontWeight: "700",
    marginTop: 40,
  },
  bubbleRow: { flexDirection: "row" },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubbleRowOther: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "78%",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleMine: {
    backgroundColor: "#F58220",
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderBottomLeftRadius: 4,
  },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  bubbleTextMine: { color: "#FFFFFF" },
  bubbleTextOther: { color: "#111827" },
  bubbleTime: { fontSize: 10, marginTop: 4, alignSelf: "flex-end" },
  bubbleTimeMine: { color: "#FFE9D5" },
  bubbleTimeOther: { color: "#8B7B6B" },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#E7DCD1",
  },
  input: {
    flex: 1,
    maxHeight: 110,
    backgroundColor: "#F5EFE7",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: "#111827",
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#F58220",
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { opacity: 0.5 },
});
