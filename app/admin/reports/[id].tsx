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
import { useTranslation } from "react-i18next";

import { db } from "../../../firebase";
import { updateReportStatus } from "../adminReportsLib";
import { AdminReportRow, ReportStatus } from "../adminTypes";
import { adminColors, adminRadius, adminSpacing } from "../adminTheme";
import AdminScreen from "../components/AdminScreen";
import { LoadingState } from "../components/AdminStates";
import { translateReportCategory } from "../../i18n/formatters";

const toSeconds = (value: unknown): number => {
  const timestamp = value as { seconds?: number } | undefined;
  return timestamp?.seconds || 0;
};

const STATUS_FLOW: ReportStatus[] = ["open", "under_review", "resolved", "rejected"];

export default function AdminReportDetailScreen() {
  const { t } = useTranslation();
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
            reporterName: data.reporterName || t("common.user"),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  const handleUpdate = async (status: ReportStatus) => {
    if (busy) return;

    try {
      setBusy(true);
      await updateReportStatus(reportId, status, response.trim(), note.trim());
      Alert.alert(t("admin.savedTitle"), t("admin.reportUpdatedMessage"));
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("admin.couldNotUpdateReport"));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <AdminScreen title={t("admin.reportDetailsTitle")}>
        <LoadingState label={t("admin.loadingReportLabel")} />
      </AdminScreen>
    );
  }

  if (notFound || !report) {
    return (
      <AdminScreen title={t("admin.reportDetailsTitle")}>
        <View style={styles.center}>
          <Text style={styles.notFoundText}>{t("admin.reportNotFound")}</Text>
        </View>
      </AdminScreen>
    );
  }

  return (
    <AdminScreen title={t("admin.reportDetailsTitle")}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.headerCard}>
            <View style={styles.pill}>
              <Text style={styles.pillText}>{translateReportCategory(report.category, t)}</Text>
            </View>
            <Text style={styles.description}>{report.description}</Text>
            <Text style={styles.reporter}>{t("admin.reportedByLabel", { name: report.reporterName })}</Text>
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
                {t("admin.openReportedTarget", {
                  target: t(`admin.targetType.${report.targetType}`, { defaultValue: report.targetType }),
                })}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={adminColors.placeholder} />
            </Pressable>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("admin.adminResponseTitle")}</Text>
            <TextInput
              style={styles.input}
              value={response}
              onChangeText={setResponse}
              placeholder={t("admin.writeResponsePlaceholder")}
              placeholderTextColor={adminColors.placeholder}
              multiline
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("admin.internalNoteAdminsOnlyTitle")}</Text>
            <TextInput
              style={styles.input}
              value={note}
              onChangeText={setNote}
              placeholder={t("admin.privateNoteAdminsPlaceholder")}
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
                  {t(`admin.reportStatusLabel.${status}`, { defaultValue: status.replace("_", " ") })}
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
