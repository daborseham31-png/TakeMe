import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { doc, onSnapshot } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { db } from "../../../firebase";
import { updateReportStatus } from "../adminReportsLib";
import { AdminReportRow, ReportStatus } from "../adminTypes";
import { adminColors, adminRadius, adminSpacing } from "../adminTheme";
import AdminScreen from "../components/AdminScreen";
import { LoadingState } from "../components/AdminStates";

const toSeconds = (value: unknown): number => {
  const timestamp = value as { seconds?: number } | undefined;
  return timestamp?.seconds || 0;
};

const STATUS_FLOW: ReportStatus[] = ["open", "under_review", "resolved", "rejected"];

export default function AdminReportDetailScreen() {
  const params = useLocalSearchParams();
  const reportId = String(params.id || "");

  const [report, setReport] = useState<AdminReportRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [response, setResponse] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!reportId) {
      setLoading(false);
      setNotFound(true);
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, "adminReports", reportId),
      (snap) => {
        if (!snap.exists()) {
          setNotFound(true);
          setReport(null);
        } else {
          const data = snap.data();
          const normalized: AdminReportRow = {
            id: snap.id,
            reporterId: data.reporterId || "",
            reporterName: data.reporterName || "User",
            targetType: data.targetType || "",
            targetId: data.targetId || "",
            category: data.category || "other",
            description: data.description || "",
            imageUrl: data.imageUrl || "",
            status: data.status || "open",
            adminResponse: data.adminResponse || "",
            internalNote: data.internalNote || "",
            createdAtSeconds: toSeconds(data.createdAt),
          };
          setReport(normalized);
          setResponse(normalized.adminResponse);
          setNote(normalized.internalNote);
        }
        setLoading(false);
      },
      () => {
        setNotFound(true);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [reportId]);

  const handleUpdate = async (status: ReportStatus) => {
    if (busy) return;

    try {
      setBusy(true);
      await updateReportStatus(reportId, status, response.trim(), note.trim());
      Alert.alert("Saved", "The report was updated.");
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Could not update this report.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <AdminScreen title="Report Details">
        <LoadingState label="Loading report..." />
      </AdminScreen>
    );
  }

  if (notFound || !report) {
    return (
      <AdminScreen title="Report Details">
        <View style={styles.center}>
          <Text style={styles.notFoundText}>This report could not be found.</Text>
        </View>
      </AdminScreen>
    );
  }

  return (
    <AdminScreen title="Report Details">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.headerCard}>
            <View style={styles.pill}>
              <Text style={styles.pillText}>{report.category}</Text>
            </View>
            <Text style={styles.description}>{report.description}</Text>
            <Text style={styles.reporter}>Reported by {report.reporterName}</Text>
          </View>

          {report.targetType && report.targetId ? (
            <Pressable
              style={styles.linkRow}
              onPress={() => {
                const path =
                  report.targetType === "user"
                    ? `/admin/users/${report.targetId}`
                    : report.targetType === "booking"
                      ? `/admin/bookings/${report.targetId}`
                      : `/admin/rides/driverRoutes/${report.targetId}`;
                router.push(path as any);
              }}
            >
              <Ionicons name="link-outline" size={16} color={adminColors.textMuted} />
              <Text style={styles.linkLabel}>
                Open reported {report.targetType}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={adminColors.placeholder} />
            </Pressable>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Admin response (visible to reporter)</Text>
            <TextInput
              style={styles.input}
              value={response}
              onChangeText={setResponse}
              placeholder="Write a response to the reporter"
              placeholderTextColor={adminColors.placeholder}
              multiline
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Internal note (admins only)</Text>
            <TextInput
              style={styles.input}
              value={note}
              onChangeText={setNote}
              placeholder="Private note for other admins"
              placeholderTextColor={adminColors.placeholder}
              multiline
            />
          </View>

          <View style={styles.statusRow}>
            {STATUS_FLOW.map((status) => (
              <Pressable
                key={status}
                style={[
                  styles.statusButton,
                  report.status === status && styles.statusButtonActive,
                ]}
                onPress={() => handleUpdate(status)}
                disabled={busy}
              >
                <Text
                  style={[
                    styles.statusButtonText,
                    report.status === status && styles.statusButtonTextActive,
                  ]}
                >
                  {status.replace("_", " ")}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: adminSpacing.lg,
    paddingBottom: 60,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: adminSpacing.lg,
  },
  notFoundText: {
    color: adminColors.textMuted,
    fontWeight: "700",
  },
  headerCard: {
    backgroundColor: adminColors.card,
    borderWidth: 1,
    borderColor: adminColors.border,
    borderRadius: adminRadius.lg,
    padding: adminSpacing.lg,
    marginBottom: adminSpacing.md,
  },
  pill: {
    alignSelf: "flex-start",
    backgroundColor: adminColors.warningBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: adminRadius.pill,
    marginBottom: 8,
  },
  pillText: {
    fontSize: 11.5,
    fontWeight: "800",
    color: adminColors.primaryDark,
    textTransform: "capitalize",
  },
  description: {
    fontSize: 15,
    fontWeight: "700",
    color: adminColors.text,
    lineHeight: 21,
  },
  reporter: {
    fontSize: 12.5,
    color: adminColors.textMuted,
    marginTop: 8,
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: adminColors.card,
    borderWidth: 1,
    borderColor: adminColors.border,
    borderRadius: adminRadius.md,
    padding: 12,
    marginBottom: adminSpacing.md,
  },
  linkLabel: {
    flex: 1,
    color: adminColors.text,
    fontWeight: "800",
    fontSize: 13,
    textTransform: "capitalize",
  },
  section: {
    backgroundColor: adminColors.card,
    borderWidth: 1,
    borderColor: adminColors.border,
    borderRadius: adminRadius.lg,
    padding: adminSpacing.md,
    marginBottom: adminSpacing.md,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: adminColors.text,
  },
  input: {
    borderWidth: 1,
    borderColor: adminColors.borderStrong,
    borderRadius: adminRadius.sm,
    padding: 12,
    minHeight: 70,
    textAlignVertical: "top",
    color: adminColors.text,
  },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  statusButton: {
    borderWidth: 1,
    borderColor: adminColors.border,
    backgroundColor: adminColors.card,
    borderRadius: adminRadius.pill,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  statusButtonActive: {
    backgroundColor: adminColors.primary,
    borderColor: adminColors.primary,
  },
  statusButtonText: {
    color: adminColors.textMuted,
    fontWeight: "800",
    fontSize: 12.5,
    textTransform: "capitalize",
  },
  statusButtonTextActive: {
    color: "#FFFFFF",
  },
});
