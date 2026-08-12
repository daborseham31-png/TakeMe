// ---------------------------------------------------------------------------
// Appeal form for a driver no-show violation (see driverNoShowLib.ts /
// driverNoShowCore.ts — a completely separate system from the driver
// cancellation-violation warnings elsewhere in this app). Opened from the
// Violations tab in app/(tabs)/bookings.tsx via "Submit an Appeal" on an
// open violation with no existing appeal (canSubmitAppeal).
//
// Evidence upload mirrors the exact pattern already used by the passenger
// "Report a problem" flow (app/(tabs)/profile.tsx) and driver license
// verification (app/driver/verify-license.tsx): expo-image-picker ->
// compressImageToBase64 -> a data: URI stored directly on the Firestore
// document. There is no Firebase Storage on this project's (Spark) plan —
// see app/login/idVerificationLib.ts's own header for why — so this is
// capped at exactly ONE image to respect Firestore's 1MiB document limit.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Alert } from "../AppAlert";
import { useTranslation } from "react-i18next";

import { compressImageToBase64 } from "../login/idVerificationLib";
import { useLanguage } from "../i18n/LanguageProvider";
import {
  isEvidenceWithinSizeLimit,
  isSupportedEvidenceMimeType,
  NO_SHOW_REASON_CATEGORIES,
  NO_SHOW_REASON_LABEL_KEY,
  NoShowAppealError,
  NoShowAppealReasonCategory,
  submitViolationAppeal,
  ViolationSource,
} from "./driverNoShowLib";

type Props = {
  visible: boolean;
  violationId: string;
  // Defaults to "driverViolations" (the no-show system) when omitted, so
  // every existing caller keeps working unchanged.
  violationSource?: ViolationSource;
  tripId: string;
  onClose: () => void;
  onSubmitted: () => void;
};

export default function ViolationAppealModal({
  visible,
  violationId,
  violationSource,
  tripId,
  onClose,
  onSubmitted,
}: Props) {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();

  const [reasonCategory, setReasonCategory] = useState<NoShowAppealReasonCategory | null>(null);
  const [explanation, setExplanation] = useState("");
  const [evidenceUri, setEvidenceUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setReasonCategory(null);
    setExplanation("");
    setEvidenceUri(null);
    setError(null);
  };

  const handleClose = () => {
    if (submitting) return; // Prevent dismissing mid-submit.
    reset();
    onClose();
  };

  // Only the picker's SOURCE asset is checked against the MIME allowlist —
  // compressImageToBase64 always re-encodes to JPEG regardless of input, so
  // this is a defensive reject of anything that isn't a supported image
  // format the picker itself claims to have returned, not a check on the
  // (always-JPEG) output.
  const acceptEvidenceAsset = (asset: ImagePicker.ImagePickerAsset) => {
    if (asset.mimeType && !isSupportedEvidenceMimeType(asset.mimeType)) {
      setError(t("driverNoShow.errorEvidenceUnsupportedType"));
      return;
    }
    setError(null);
    setEvidenceUri(asset.uri);
  };

  const pickEvidence = async () => {
    Alert.alert(
      t("driverNoShow.attachEvidence"),
      "",
      [
        {
          text: t("common.takePhoto"),
          onPress: async () => {
            const { status } = await ImagePicker.requestCameraPermissionsAsync();
            if (status !== "granted") return;
            const result = await ImagePicker.launchCameraAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              quality: 0.6,
            });
            if (!result.canceled) acceptEvidenceAsset(result.assets[0]);
          },
        },
        {
          text: t("common.chooseFromGallery"),
          onPress: async () => {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== "granted") return;
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              quality: 0.6,
            });
            if (!result.canceled) acceptEvidenceAsset(result.assets[0]);
          },
        },
        { text: t("common.cancel"), style: "cancel" },
      ],
    );
  };

  const handleSubmit = async () => {
    if (submitting) return; // Double-submission guard.
    setError(null);

    if (!reasonCategory) {
      setError(t("driverNoShow.errorSelectReason"));
      return;
    }
    if (!explanation.trim()) {
      setError(t("driverNoShow.errorExplanationRequired"));
      return;
    }

    setSubmitting(true);
    try {
      let evidenceDataUri: string | null = null;
      if (evidenceUri) {
        const base64 = await compressImageToBase64(evidenceUri);
        if (!isEvidenceWithinSizeLimit(base64.length)) {
          setError(t("driverNoShow.errorEvidenceTooLarge"));
          setSubmitting(false);
          return;
        }
        evidenceDataUri = `data:image/jpeg;base64,${base64}`;
      }

      await submitViolationAppeal({
        violationId,
        violationSource,
        tripId,
        reasonCategory,
        explanation,
        evidenceDataUri,
      });

      reset();
      onSubmitted();
    } catch (err) {
      const message =
        err instanceof NoShowAppealError ? err.message : t("driverNoShow.errorSubmitFailed");
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            <Text style={[styles.title, isRTL && styles.textRTL]}>{t("driverNoShow.submitAppeal")}</Text>

            <Text style={[styles.label, isRTL && styles.textRTL]}>{t("driverNoShow.appealReason")}</Text>
            <View style={styles.reasonList}>
              {NO_SHOW_REASON_CATEGORIES.map((reason) => {
                const active = reasonCategory === reason;
                return (
                  <Pressable
                    key={reason}
                    style={[styles.reasonChip, active && styles.reasonChipActive]}
                    onPress={() => setReasonCategory(reason)}
                  >
                    <Text style={[styles.reasonChipText, active && styles.reasonChipTextActive]}>
                      {t(NO_SHOW_REASON_LABEL_KEY[reason])}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.label, isRTL && styles.textRTL]}>{t("driverNoShow.explainWhatHappened")}</Text>
            <TextInput
              style={[styles.textArea, isRTL && styles.textInputRTL]}
              multiline
              numberOfLines={4}
              value={explanation}
              onChangeText={setExplanation}
              placeholder={t("driverNoShow.explanationPlaceholder")}
              editable={!submitting}
            />

            <Text style={[styles.label, isRTL && styles.textRTL]}>{t("driverNoShow.attachEvidence")}</Text>
            {evidenceUri ? (
              <View style={styles.evidencePreviewWrap}>
                <Image source={{ uri: evidenceUri }} style={styles.evidencePreview} />
                <Pressable
                  style={styles.evidenceRemove}
                  onPress={() => setEvidenceUri(null)}
                  disabled={submitting}
                >
                  <Ionicons name="close-circle" size={22} color="#B0413E" />
                </Pressable>
              </View>
            ) : (
              <Pressable style={styles.evidenceButton} onPress={pickEvidence} disabled={submitting}>
                <Ionicons name="camera-outline" size={18} color="#7C5F46" />
                <Text style={styles.evidenceButtonText}>{t("driverNoShow.attachEvidenceOptional")}</Text>
              </Pressable>
            )}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <View style={styles.actionsRow}>
              <Pressable style={styles.cancelButton} onPress={handleClose} disabled={submitting}>
                <Text style={styles.cancelButtonText}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable
                style={[styles.sendButton, submitting && styles.sendButtonDisabled]}
                onPress={handleSubmit}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.sendButtonText}>{t("driverNoShow.sendAppeal")}</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "88%",
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 32,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#2B2118",
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#2B2118",
    marginTop: 14,
    marginBottom: 8,
  },
  textRTL: { textAlign: "right", writingDirection: "rtl" },
  reasonList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  reasonChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: "#F4EDE4",
    borderWidth: 1,
    borderColor: "#E4D4C0",
  },
  reasonChipActive: {
    backgroundColor: "#7C5F46",
    borderColor: "#7C5F46",
  },
  reasonChipText: {
    fontSize: 13,
    color: "#7C5F46",
    fontWeight: "600",
  },
  reasonChipTextActive: {
    color: "#FFFFFF",
  },
  textArea: {
    borderWidth: 1,
    borderColor: "#E4D4C0",
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: "#2B2118",
    minHeight: 90,
    textAlignVertical: "top",
  },
  textInputRTL: { textAlign: "right", writingDirection: "rtl" },
  evidenceButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#C9B79E",
    alignSelf: "flex-start",
  },
  evidenceButtonText: {
    fontSize: 13,
    color: "#7C5F46",
    fontWeight: "600",
  },
  evidencePreviewWrap: {
    alignSelf: "flex-start",
    position: "relative",
  },
  evidencePreview: {
    width: 96,
    height: 96,
    borderRadius: 12,
  },
  evidenceRemove: {
    position: "absolute",
    top: -8,
    right: -8,
    backgroundColor: "#FFFFFF",
    borderRadius: 11,
  },
  errorText: {
    color: "#B0413E",
    fontSize: 13,
    marginTop: 12,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 24,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E4D4C0",
    alignItems: "center",
  },
  cancelButtonText: {
    color: "#7C5F46",
    fontWeight: "600",
    fontSize: 14,
  },
  sendButton: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: "#7C5F46",
    alignItems: "center",
  },
  sendButtonDisabled: {
    opacity: 0.7,
  },
  sendButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },
});
