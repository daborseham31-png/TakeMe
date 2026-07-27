import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "../../router/expoRouterShim";
import { doc, onSnapshot } from "firebase/firestore";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { db } from "../../../firebase";
import { updateReportStatus } from "../adminReportsLib";
import { AdminReportRow, ReportStatus } from "../adminTypes";
import { adminColors, adminRadius, adminSpacing } from "../adminTheme";
import AdminScreen from "../components/AdminScreen";
import { LoadingState } from "../components/AdminStates";
import { translateReportCategory } from "../../i18n/formatters";
import { useLanguage } from "../../i18n/LanguageProvider";
import { chevronForwardIconName } from "../../i18n/rtl";

const toSeconds = (value: unknown): number => {
  const timestamp = value as { seconds?: number } | undefined;
  return timestamp?.seconds || 0;
};

const STATUS_FLOW: ReportStatus[] = ["open", "under_review", "resolved", "rejected"];

export default function AdminReportDetailScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const params = useLocalSearchParams();
  const reportId = String(params.id || "");
  const navigate = useNavigate();

  const [report, setReport] = useState<AdminReportRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [response, setResponse] = useState("");
  const [note, setNote] = useState("");
  // Locally selected status — tapping a status pill only updates this, it
  // never writes to Firestore by itself. The Submit button is the one place
  // status + response + note are all saved together, in a single write.
  const [selectedStatus, setSelectedStatus] = useState<ReportStatus>("open");
  const [busy, setBusy] = useState(false);
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  // Only seed selectedStatus from Firestore once, on first load — a live
  // onSnapshot update arriving later (e.g. another admin edited this report)
  // must never clobber a status the current admin already picked but hasn't
  // submitted yet.
  const hasInitializedStatusRef = useRef(false);

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
          if (!hasInitializedStatusRef.current) {
            hasInitializedStatusRef.current = true;
            setSelectedStatus(normalized.status);
          }
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

  // Tapping a status pill never touches Firestore — only Submit does, and it
  // always saves the three fields together in one write.
  const handleSelectStatus = (status: ReportStatus) => {
    if (busy) return;
    setSelectedStatus(status);
  };

  const handleSubmit = async () => {
    if (busy) return;

    try {
      setBusy(true);
      await updateReportStatus(reportId, selectedStatus, response.trim(), note.trim());
      // Only leave the screen once the write has actually succeeded — a
      // failed save must leave the admin right where they were, with their
      // edits intact, so they can retry.
      navigate(-1);
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

            {report.imageUrl ? (
              <Pressable onPress={() => setImageViewerVisible(true)}>
                <Image source={{ uri: report.imageUrl }} style={styles.attachedPhoto} />
              </Pressable>
            ) : null}
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
              <Ionicons name={chevronForwardIconName(isRTL)} size={16} color={adminColors.placeholder} />
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
                  selectedStatus === status && styles.statusButtonActive,
                ]}
                onPress={() => handleSelectStatus(status)}
                disabled={busy}
              >
                <Text
                  style={[
                    styles.statusButtonText,
                    selectedStatus === status && styles.statusButtonTextActive,
                  ]}
                >
                  {t(`admin.reportStatusLabel.${status}`, { defaultValue: status.replace("_", " ") })}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            style={[styles.submitButton, busy && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={busy}
          >
            {busy ? (
              <>
                <ActivityIndicator color="#FFFFFF" />
                <Text style={styles.submitButtonText}>{t("admin.savingButton")}</Text>
              </>
            ) : (
              <Text style={styles.submitButtonText}>{t("common.submit")}</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      {report.imageUrl ? (
        <Modal
          visible={imageViewerVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setImageViewerVisible(false)}
        >
          <Pressable
            style={styles.imageViewerBackdrop}
            onPress={() => setImageViewerVisible(false)}
          >
            <Image
              source={{ uri: report.imageUrl }}
              style={styles.imageViewerPhoto}
              resizeMode="contain"
            />
          </Pressable>
        </Modal>
      ) : null}
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
  attachedPhoto: {
    width: 120,
    height: 120,
    borderRadius: adminRadius.md,
    borderWidth: 1,
    borderColor: adminColors.border,
    marginTop: 12,
  },
  imageViewerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  imageViewerPhoto: {
    width: "100%",
    height: "80%",
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
  submitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: adminColors.primary,
    borderRadius: adminRadius.md,
    paddingVertical: 14,
    marginTop: adminSpacing.lg,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
  },
});
