// ---------------------------------------------------------------------------
// The ONE language-selection UI in the app — used from both the user
// Profile screen and the Admin Settings screen (same global app language,
// per spec: no separate admin language system). Never a text input: always
// a tappable list of the supported languages (see SUPPORTED_LANGUAGES in
// ./languages.ts — this list renders however many there are, no hardcoded
// count here).
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { useLanguage } from "./LanguageProvider";
import { SUPPORTED_LANGUAGES, SupportedLanguage } from "./languages";

type Props = {
  visible: boolean;
  onClose: () => void;
};

export default function LanguageSelectorModal({ visible, onClose }: Props) {
  const { t } = useTranslation();
  const { language, isRTL, setLanguage } = useLanguage();
  const [changing, setChanging] = useState<SupportedLanguage | null>(null);

  const handleSelect = async (code: SupportedLanguage) => {
    if (code === language || changing) {
      onClose();
      return;
    }

    setChanging(code);
    try {
      const result = await setLanguage(code);
      onClose();

      if (result === "restart-required") {
        Alert.alert(
          t("settings.restartRequiredTitle"),
          t("settings.restartRequiredMessage"),
          [{ text: t("settings.restartNow") }],
        );
      } else {
        Alert.alert(t("settings.languageUpdated"), t("settings.languageUpdatedMessage"));
      }
    } finally {
      setChanging(null);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <View style={styles.card}>
          <Text style={[styles.title, isRTL && styles.textRTL]}>
            {t("settings.chooseLanguage")}
          </Text>
          <Text style={[styles.subtitle, isRTL && styles.textRTL]}>
            {t("settings.languageDescription")}
          </Text>

          {SUPPORTED_LANGUAGES.map((lang) => {
            const selected = lang.code === language;

            return (
              <Pressable
                key={lang.code}
                style={[styles.row, selected && styles.rowSelected]}
                onPress={() => handleSelect(lang.code)}
                disabled={!!changing}
              >
                <Text
                  style={[
                    styles.rowText,
                    selected && styles.rowTextSelected,
                    lang.direction === "rtl" && styles.textRTL,
                  ]}
                >
                  {lang.nativeName}
                </Text>

                {changing === lang.code ? (
                  <ActivityIndicator size="small" color="#F58220" />
                ) : selected ? (
                  <Ionicons name="checkmark-circle" size={22} color="#F58220" />
                ) : (
                  <Ionicons
                    name="ellipse-outline"
                    size={22}
                    color="#D8CCBF"
                  />
                )}
              </Pressable>
            );
          })}

          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>{t("common.close")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 20,
  },
  title: {
    fontSize: 19,
    fontWeight: "900",
    color: "#111827",
  },
  subtitle: {
    fontSize: 13,
    color: "#7C5F46",
    marginTop: 4,
    marginBottom: 16,
  },
  textRTL: {
    textAlign: "right",
    writingDirection: "rtl",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    backgroundColor: "#FFFDFC",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
  },
  rowSelected: {
    borderColor: "#F58220",
    backgroundColor: "#FFF8F2",
  },
  rowText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#111827",
  },
  rowTextSelected: {
    color: "#B86115",
  },
  closeButton: {
    marginTop: 6,
    paddingVertical: 14,
    alignItems: "center",
  },
  closeButtonText: {
    color: "#7C5F46",
    fontWeight: "900",
    fontSize: 15,
  },
});
