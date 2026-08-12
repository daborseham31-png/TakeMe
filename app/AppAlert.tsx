// ---------------------------------------------------------------------------
// Cross-platform drop-in replacement for React Native's Alert.alert().
//
// WHY: react-native-web ships Alert.alert() as a complete no-op (see
// node_modules/react-native-web/src/exports/Alert/index.js — `static
// alert() {}`), so every validation/error/confirmation message in this app
// silently did nothing on Web — indistinguishable from a broken button.
//
// USAGE: import { Alert } from "./AppAlert" (adjust the relative path)
// instead of destructuring Alert from "react-native", then call
// Alert.alert(title, message, buttons, options) exactly as before — same
// signature, same button shape ({ text, onPress, style }), same options
// ({ cancelable, onDismiss }). No call site's arguments or logic change,
// only the import.
//
// NATIVE (iOS/Android): calls straight through to the real react-native
// Alert.alert — byte-identical behavior, never touched.
//
// WEB: renders a small app-styled Modal (mounted once at the root — see
// AppAlertHost, rendered from app/_layout.tsx) instead of the browser's
// window.alert(), matching the visual language already used by
// app/admin/components/ConfirmModal.tsx.
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from "react";
import {
  Alert as RNAlert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

export type AppAlertButton = {
  text?: string;
  onPress?: (value?: string) => void;
  style?: "default" | "cancel" | "destructive";
};

export type AppAlertOptions = {
  cancelable?: boolean;
  onDismiss?: () => void;
};

type AlertState = {
  title: string;
  message?: string;
  buttons: AppAlertButton[];
  options?: AppAlertOptions;
};

// Single active alert only — real Alert.alert() call sites in this app
// never stack multiple alerts at once; a later call simply replaces
// whatever is currently showing, matching how a second native Alert.alert()
// call would replace/queue behind the first anyway.
type Listener = (state: AlertState | null) => void;
let listener: Listener | null = null;

function alertImpl(
  title: string,
  message?: string,
  buttons?: AppAlertButton[],
  options?: AppAlertOptions,
): void {
  if (Platform.OS !== "web") {
    RNAlert.alert(title, message, buttons as any, options as any);
    return;
  }

  listener?.({
    title,
    message,
    buttons: buttons && buttons.length > 0 ? buttons : [{ style: "default" }],
    options,
  });
}

// Drop-in for `import { Alert } from "react-native"` — same shape, same
// call signature, so no call site needs anything beyond a changed import.
export const Alert = { alert: alertImpl };

// Mounted once at the app root (see app/_layout.tsx). The real Alert.alert
// above only ever routes here on Web, so this component is a deliberate
// no-op on native.
export function AppAlertHost() {
  const { t } = useTranslation();
  const [state, setState] = useState<AlertState | null>(null);

  useEffect(() => {
    listener = setState;
    return () => {
      listener = null;
    };
  }, []);

  if (Platform.OS !== "web" || !state) return null;

  const dismiss = () => setState(null);

  const handleBackdropPress = () => {
    if (state.options?.cancelable === false) return;
    dismiss();
    state.options?.onDismiss?.();
  };

  const handleButtonPress = (button: AppAlertButton) => {
    dismiss();
    button.onPress?.();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleBackdropPress}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleBackdropPress} />

        <View style={styles.card}>
          <Text style={styles.title}>{state.title}</Text>
          {state.message ? <Text style={styles.message}>{state.message}</Text> : null}

          <View style={styles.buttonsRow}>
            {state.buttons.map((button, index) => (
              <Pressable
                key={index}
                style={[
                  styles.button,
                  button.style === "cancel" && styles.cancelButton,
                  button.style === "destructive" && styles.destructiveButton,
                ]}
                onPress={() => handleButtonPress(button)}
              >
                <Text
                  style={[
                    styles.buttonText,
                    button.style === "cancel" && styles.cancelButtonText,
                    button.style === "destructive" && styles.destructiveButtonText,
                  ]}
                >
                  {button.text || t("common.ok")}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 8,
    textAlign: "center",
  },
  message: {
    fontSize: 14,
    color: "#7C5F46",
    lineHeight: 20,
    marginBottom: 18,
    textAlign: "center",
  },
  buttonsRow: {
    flexDirection: "row",
    gap: 10,
  },
  button: {
    flex: 1,
    backgroundColor: "#F58220",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 14,
  },
  cancelButton: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2D8CF",
  },
  cancelButtonText: {
    color: "#7C5F46",
  },
  destructiveButton: {
    backgroundColor: "#EF4444",
  },
  destructiveButtonText: {
    color: "#FFFFFF",
  },
});
