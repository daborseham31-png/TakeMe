// ---------------------------------------------------------------------------
// Drop-in replacement for a screen's outermost <ScrollView> whenever that
// screen holds a TextInput. Pairs the ScrollView with KeyboardAvoidingWrapper
// so the focused field/button is never left hidden behind the keyboard, and
// defaults the handful of props every form screen in this app needs:
//   - keyboardShouldPersistTaps="handled": a tap on a button/suggestion row
//     registers instead of just dismissing the keyboard first.
//   - keyboardDismissMode: swipe-to-dismiss on iOS ("interactive"); Android
//     keeps its normal on-drag dismiss.
//   - contentContainerStyle flexGrow: 1: lets short forms still center/grow
//     instead of collapsing to content height.
//
// Usage — swap this in for the bare ScrollView a screen already renders as
// the direct child of its DirectionalScreen/SafeAreaView root:
//   <DirectionalScreen style={styles.page}>
//     <KeyboardSafeScreen contentContainerStyle={styles.scroll}>
//       ...form content...
//     </KeyboardSafeScreen>
//   </DirectionalScreen>
// ---------------------------------------------------------------------------

import React from "react";
import { Platform, ScrollView, ScrollViewProps } from "react-native";

import KeyboardAvoidingWrapper from "./KeyboardAvoidingWrapper";

type Props = ScrollViewProps & {
  keyboardVerticalOffset?: number;
  children: React.ReactNode;
};

export default function KeyboardSafeScreen({
  style,
  contentContainerStyle,
  keyboardVerticalOffset = 0,
  keyboardShouldPersistTaps = "handled",
  keyboardDismissMode = Platform.OS === "ios" ? "interactive" : "on-drag",
  children,
  ...rest
}: Props) {
  return (
    <KeyboardAvoidingWrapper keyboardVerticalOffset={keyboardVerticalOffset}>
      <ScrollView
        style={style}
        contentContainerStyle={[{ flexGrow: 1 }, contentContainerStyle]}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        keyboardDismissMode={keyboardDismissMode}
        {...rest}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingWrapper>
  );
}
