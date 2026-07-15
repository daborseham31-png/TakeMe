import { collection, getDocs, query, where } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { auth, db } from "../../firebase";
import { sendAdminNotification } from "./adminNotificationsLib";
import { subscribeAllUsers } from "./adminUsersLib";
import { AdminUserRow, NotificationAudience } from "./adminTypes";
import { adminColors, adminRadius, adminSpacing } from "./adminTheme";
import AdminScreen from "./components/AdminScreen";
import SearchBar from "./components/SearchBar";
import { useAdminCollection } from "./useAdminCollection";

const AUDIENCE_OPTIONS: { key: NotificationAudience; label: string }[] = [
  { key: "single_user", label: "One passenger" },
  { key: "single_driver", label: "One driver" },
  { key: "all_passengers", label: "All passengers" },
  { key: "all_drivers", label: "All drivers" },
  { key: "all_users", label: "Everyone" },
];

type SentNotification = {
  id: string;
  title: string;
  message: string;
  type: string;
  createdAtSeconds: number;
};

export default function AdminNotificationsScreen() {
  const [audience, setAudience] = useState<NotificationAudience>("all_users");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<AdminUserRow | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<SentNotification[]>([]);

  const { data: users } = useAdminCollection(subscribeAllUsers);

  const needsUserPicker = audience === "single_user" || audience === "single_driver";

  const pickerUsers = users.filter((user) => {
    if (audience === "single_driver" && !user.isDriver) return false;
    if (audience === "single_user" && user.isDriver) return false;

    const needle = search.trim().toLowerCase();
    if (!needle) return true;

    return (
      user.name.toLowerCase().includes(needle) ||
      user.email.toLowerCase().includes(needle) ||
      user.phone.toLowerCase().includes(needle)
    );
  });

  const loadSent = async () => {
    const adminId = auth.currentUser?.uid;
    if (!adminId) return;

    const snap = await getDocs(
      query(collection(db, "notifications"), where("senderId", "==", adminId)),
    );

    const items = snap.docs
      .map((d) => {
        const data = d.data();
        const createdAt = data.createdAt as { seconds?: number } | undefined;
        return {
          id: d.id,
          title: data.title || "",
          message: data.message || "",
          type: data.type || "",
          createdAtSeconds: createdAt?.seconds || 0,
        };
      })
      .sort((a, b) => b.createdAtSeconds - a.createdAtSeconds)
      .slice(0, 10);

    setSent(items);
  };

  useEffect(() => {
    loadSent();
  }, []);

  const handleSend = async () => {
    if (sending) return;

    if (needsUserPicker && !selectedUser) {
      Alert.alert("Choose a recipient", "Please select who this notification is for.");
      return;
    }

    try {
      setSending(true);
      const count = await sendAdminNotification({
        audience,
        title,
        message,
        targetUserId: selectedUser?.id,
      });

      setTitle("");
      setMessage("");
      setSelectedUser(null);
      await loadSent();

      Alert.alert("Sent", `Notification delivered to ${count} recipient${count === 1 ? "" : "s"}.`);
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Could not send this notification.");
    } finally {
      setSending(false);
    }
  };

  return (
    <AdminScreen title="Notifications" activeKey="notifications">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <FlatList
          data={sent}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scroll}
          ListHeaderComponent={
            <View>
              <Text style={styles.label}>Send to</Text>
              <View style={styles.audienceRow}>
                {AUDIENCE_OPTIONS.map((option) => (
                  <Pressable
                    key={option.key}
                    style={[
                      styles.audienceChip,
                      audience === option.key && styles.audienceChipActive,
                    ]}
                    onPress={() => {
                      setAudience(option.key);
                      setSelectedUser(null);
                    }}
                  >
                    <Text
                      style={[
                        styles.audienceChipText,
                        audience === option.key && styles.audienceChipTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {needsUserPicker ? (
                <View style={styles.pickerBox}>
                  <SearchBar value={search} onChangeText={setSearch} placeholder="Search recipient" />
                  <View style={styles.pickerList}>
                    {pickerUsers.slice(0, 6).map((user) => (
                      <Pressable
                        key={user.id}
                        style={[
                          styles.pickerRow,
                          selectedUser?.id === user.id && styles.pickerRowActive,
                        ]}
                        onPress={() => setSelectedUser(user)}
                      >
                        <Text style={styles.pickerRowText}>{user.name}</Text>
                        <Text style={styles.pickerRowSub}>{user.email || user.phone}</Text>
                      </Pressable>
                    ))}
                  </View>
                  {selectedUser ? (
                    <Text style={styles.selectedText}>Selected: {selectedUser.name}</Text>
                  ) : null}
                </View>
              ) : null}

              <Text style={styles.label}>Title</Text>
              <TextInput
                style={styles.input}
                value={title}
                onChangeText={setTitle}
                placeholder="Notification title"
                placeholderTextColor={adminColors.placeholder}
              />

              <Text style={styles.label}>Message</Text>
              <TextInput
                style={[styles.input, styles.messageInput]}
                value={message}
                onChangeText={setMessage}
                placeholder="Notification message"
                placeholderTextColor={adminColors.placeholder}
                multiline
              />

              <Pressable
                style={[styles.sendButton, sending && styles.sendButtonDisabled]}
                onPress={handleSend}
                disabled={sending}
              >
                {sending ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.sendButtonText}>Send Notification</Text>
                )}
              </Pressable>

              <Text style={styles.sectionTitle}>Recently sent</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.sentCard}>
              <Text style={styles.sentTitle}>{item.title}</Text>
              <Text style={styles.sentMessage} numberOfLines={2}>
                {item.message}
              </Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>Notifications you send will show up here.</Text>
          }
        />
      </KeyboardAvoidingView>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: adminSpacing.lg,
    paddingBottom: 40,
  },
  label: {
    fontSize: 13,
    fontWeight: "900",
    color: adminColors.text,
    marginTop: 14,
    marginBottom: 8,
  },
  audienceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  audienceChip: {
    borderWidth: 1,
    borderColor: adminColors.border,
    backgroundColor: adminColors.card,
    borderRadius: adminRadius.pill,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  audienceChipActive: {
    backgroundColor: adminColors.primary,
    borderColor: adminColors.primary,
  },
  audienceChipText: {
    color: adminColors.textMuted,
    fontWeight: "800",
    fontSize: 12.5,
  },
  audienceChipTextActive: {
    color: "#FFFFFF",
  },
  pickerBox: {
    marginTop: 10,
    gap: 8,
  },
  pickerList: {
    gap: 6,
  },
  pickerRow: {
    backgroundColor: adminColors.card,
    borderWidth: 1,
    borderColor: adminColors.border,
    borderRadius: adminRadius.sm,
    padding: 10,
  },
  pickerRowActive: {
    borderColor: adminColors.primary,
    backgroundColor: adminColors.warningBg,
  },
  pickerRowText: {
    color: adminColors.text,
    fontWeight: "800",
    fontSize: 13,
  },
  pickerRowSub: {
    color: adminColors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  selectedText: {
    color: adminColors.primaryDark,
    fontWeight: "800",
    fontSize: 12.5,
  },
  input: {
    borderWidth: 1,
    borderColor: adminColors.borderStrong,
    borderRadius: adminRadius.sm,
    padding: 12,
    backgroundColor: adminColors.card,
    color: adminColors.text,
  },
  messageInput: {
    minHeight: 90,
    textAlignVertical: "top",
  },
  sendButton: {
    backgroundColor: adminColors.primary,
    borderRadius: adminRadius.md,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 16,
  },
  sendButtonDisabled: {
    opacity: 0.6,
  },
  sendButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: adminColors.text,
    marginTop: 24,
    marginBottom: 10,
  },
  sentCard: {
    backgroundColor: adminColors.card,
    borderWidth: 1,
    borderColor: adminColors.border,
    borderRadius: adminRadius.md,
    padding: 12,
    marginBottom: 8,
  },
  sentTitle: {
    fontWeight: "900",
    color: adminColors.text,
    fontSize: 13.5,
  },
  sentMessage: {
    color: adminColors.textMuted,
    fontSize: 12.5,
    marginTop: 2,
  },
  emptyText: {
    color: adminColors.textMuted,
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 20,
  },
});
