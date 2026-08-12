// ---------------------------------------------------------------------------
// The ONE language-selection UI in the app — used from both the user
// Profile screen and the Admin Settings screen (same global app language,
// per spec: no separate admin language system). Never a text input: always
// a tappable list of the supported languages (see SUPPORTED_LANGUAGES in
// ./languages.ts — this list renders however many there are, no hardcoded
// count here).
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import { reloadAppAsync } from "expo";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
} from "react-native";
import { Alert } from "../AppAlert";
import { useTranslation } from "react-i18next";

import {
  DirectionalCard,
  DirectionalRow,
  DirectionalText,
} from "./DirectionalPrimitives";
import { useLanguage } from "./LanguageProvider";
import { SUPPORTED_LANGUAGES, SupportedLanguage } from "./languages";

type Props = {
  visible: boolean;
  onClose: () => void;
};

export default function LanguageSelectorModal({ visible, onClose }: Props) {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();
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

      if (result === "restart-available") {
        // Never reached in Expo Go (see LanguageProvider.setLanguage) — the
        // JS-controlled direction architecture (DirectionalScreen/
        // DirectionalCard/etc., see i18n/rtl.ts) already makes the UI fully
        // correct without this. Only a genuine dev/standalone build ever
        // gets here, and even then this is an OPTIONAL offer — Cancel
        // leaves the app exactly as correct as it already is; restarting
        // only additionally syncs native-only primitives.
        Alert.alert(
          t("settings.restartRequiredTitle"),
          t("settings.restartRequiredMessage"),
          [
            { text: t("common.cancel"), style: "cancel" },
            {
              text: t("settings.restartNow"),
              onPress: () => {
                reloadAppAsync("Language direction changed").catch(() => {
                  // Nothing more we can safely do from JS if even this
                  // fails — the language is already saved and the UI is
                  // already visually correct via JS direction either way.
                });
              },
            },
          ],
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
      <DirectionalCard style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <DirectionalCard style={styles.card}>
          <DirectionalText style={styles.title}>
            {t("settings.chooseLanguage")}
          </DirectionalText>
          <DirectionalText style={styles.subtitle}>
            {t("settings.languageDescription")}
          </DirectionalText>

          {SUPPORTED_LANGUAGES.map((lang) => {
            const selected = lang.code === language;

            return (
              <Pressable
                key={lang.code}
                onPress={() => handleSelect(lang.code)}
                disabled={!!changing}
              >
                <DirectionalRow style={[styles.row, selected && styles.rowSelected]}>
                  <DirectionalText
                    style={[styles.rowText, selected && styles.rowTextSelected]}
                  >
                    {lang.nativeName}
                  </DirectionalText>

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
                </DirectionalRow>
              </Pressable>
            );
          })}

          <Pressable style={styles.closeButton} onPress={onClose}>
            <DirectionalText style={styles.closeButtonText}>
              {t("common.close")}
            </DirectionalText>
          </Pressable>
        </DirectionalCard>
      </DirectionalCard>
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
  row: {
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
