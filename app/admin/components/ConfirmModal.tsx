// ---------------------------------------------------------------------------
// Shared confirmation modal for every destructive/irreversible admin action
// (block, suspend, delete, cancel, remove...). Optionally collects a reason.
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { adminColors, adminRadius, adminSpacing } from "../adminTheme";

export type ConfirmModalProps = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  requireReason?: boolean;
  reasonPlaceholder?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
};

export default function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel = "Confirm",
  destructive = true,
  requireReason = false,
  reasonPlaceholder = "Enter a reason",
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmModalProps) {
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");

  useEffect(() => {
    if (visible) {
      setReason("");
      setReasonError("");
    }
  }, [visible]);

  const handleConfirm = () => {
    if (requireReason && !reason.trim()) {
      setReasonError("A reason is required.");
      return;
    }

    onConfirm(reason.trim());
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={styles.backdropTouch} onPress={busy ? undefined : onCancel} />

        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          {requireReason ? (
            <>
              <TextInput
                style={styles.input}
                placeholder={reasonPlaceholder}
                placeholderTextColor={adminColors.placeholder}
                value={reason}
                onChangeText={(text) => {
                  setReason(text);
                  if (reasonError) setReasonError("");
                }}
                multiline
              />
              {reasonError ? <Text style={styles.errorText}>{reasonError}</Text> : null}
            </>
          ) : null}

          <View style={styles.buttonsRow}>
            <Pressable style={styles.cancelButton} onPress={onCancel} disabled={busy}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>

            <Pressable
              style={[
                styles.confirmButton,
                destructive && styles.confirmButtonDestructive,
                busy && styles.confirmButtonDisabled,
              ]}
              onPress={handleConfirm}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.confirmText}>{confirmLabel}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: adminSpacing.lg,
  },
  backdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    backgroundColor: adminColors.card,
    borderRadius: adminRadius.lg,
    padding: adminSpacing.lg,
  },
  title: {
    fontSize: 18,
    fontWeight: "900",
    color: adminColors.text,
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    color: adminColors.textMuted,
    lineHeight: 20,
    marginBottom: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: adminColors.borderStrong,
    borderRadius: adminRadius.sm,
    padding: 12,
    minHeight: 70,
    textAlignVertical: "top",
    color: adminColors.text,
    marginBottom: 6,
  },
  errorText: {
    color: adminColors.danger,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 6,
  },
  buttonsRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 10,
  },
  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: adminColors.borderStrong,
    borderRadius: adminRadius.sm,
    paddingVertical: 13,
    alignItems: "center",
  },
  cancelText: {
    color: adminColors.textMuted,
    fontWeight: "900",
  },
  confirmButton: {
    flex: 1,
    backgroundColor: adminColors.primary,
    borderRadius: adminRadius.sm,
    paddingVertical: 13,
    alignItems: "center",
  },
  confirmButtonDestructive: {
    backgroundColor: adminColors.danger,
  },
  confirmButtonDisabled: {
    opacity: 0.6,
  },
  confirmText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
});
