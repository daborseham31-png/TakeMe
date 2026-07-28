// ---------------------------------------------------------------------------
// Shared keyboard-avoidance wrapper — wrap this around a screen's existing
// ScrollView/content (or a Modal's content) so a focused TextInput is pushed
// above the software keyboard instead of being hidden behind it.
//
// iOS has no native resize behavior for the keyboard, so it needs the
// explicit "padding" behavior below. Android already resizes the window
// itself (see app.json's android.softwareKeyboardLayoutMode: "resize"), so
// passing a second padding/height behavior there would double-apply the
// shift and jitter the layout — this mirrors the behavior already used
// throughout the app (see app/admin/components/ConfirmModal.tsx,
// app/chat/[id].tsx, app/admin/drivers/[id].tsx, ...).
//
// keyboardVerticalOffset intentionally stays a prop rather than a hardcoded
// constant — pass the height of any fixed header that sits ABOVE this
// wrapper (outside it) so iOS's "padding" behavior accounts for it instead
// of over- or under-shifting content.
// ---------------------------------------------------------------------------

import React from "react";
import { KeyboardAvoidingView, Platform, StyleProp, ViewStyle } from "react-native";

type Props = {
  style?: StyleProp<ViewStyle>;
  keyboardVerticalOffset?: number;
  children: React.ReactNode;
};

export default function KeyboardAvoidingWrapper({
  style,
  keyboardVerticalOffset = 0,
  children,
}: Props) {
  return (
    <KeyboardAvoidingView
      style={[{ flex: 1 }, style]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={keyboardVerticalOffset}
    >
      {children}
    </KeyboardAvoidingView>
  );
}
