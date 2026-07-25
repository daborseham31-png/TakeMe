// ---------------------------------------------------------------------------
// Centralized JS-controlled direction components.
//
// WHY THIS FILE EXISTS: real-device diagnostics (see LanguageProvider.tsx's
// RTL_* logs) proved that inside Expo Go, I18nManager.forceRTL() never
// actually flips the NATIVE I18nManager.isRTL flag that React Native's own
// automatic layout mirroring depends on (Expo Go hosts the JS runtime inside
// a persistent shared native container that a JS-only reload cannot
// recreate — see this project's own RTL diagnosis report). app/_layout.tsx
// therefore sets a JS-controlled `direction: isRTL ? "rtl" : "ltr"` on the
// app's own root View, and useLanguage().isRTL — never I18nManager.isRTL —
// is the one thing every screen's visible layout depends on.
//
// DOUBLE-MIRRORING BUG THIS FILE NOW FIXES: that root `direction` CAN cascade
// into ordinary nested Views (anything not separated by a Modal's own native
// surface or a native-stack screen boundary). Every row-order component below
// ALSO sets an explicit `flexDirection: isRTL ? "row-reverse" : "row"` — if
// both apply to the same row, they compound: an already-mirrored ambient
// direction plus an explicit row-reverse cancels back out to the WRONG (or a
// device-inconsistent) visual order. So every component below that controls
// row order first NEUTRALIZES whatever direction it inherited by setting
// `direction: "ltr"` on itself, THEN applies its own explicit
// `flexDirection: isRTL ? "row-reverse" : "row"` on top of that known,
// reset-to-LTR baseline. This makes row order depend on EXACTLY one thing —
// this component's own isRTL check — never on what any ancestor happened to
// set.
//
// `textAlign`/`writingDirection` are never inherited from an ancestor's
// `direction` either — every Text/TextInput that needs to visibly align sets
// them directly on itself, via a plain ternary (no indirection through a
// second helper that could invert edges unexpectedly).
//
// TEXT WIDTH: `alignSelf: "stretch"` only affects the CROSS axis — inside a
// horizontal row that's the element's HEIGHT, not its width, so it never
// guarantees a Text actually has room to visibly shift horizontally. Instead:
// DirectionalText/DirectionalTextInput stay COMPACT (content-hugging) by
// default — correct for inline text inside rows, chips, badges, and buttons,
// which must never stretch — and only take `width: "100%"` when the caller
// passes `block` AND has actually placed this Text inside a vertical/column
// container with room to give (a `flex: 1` wrapper, typically).
//
// IMPORTANT SCOPE NOTE: RN's <Modal> renders its content into a SEPARATE
// native surface/window — it is NOT a descendant of the app's main root view
// for layout purposes, so nothing set at the app root reaches a Modal's
// content. Every Modal in this app must apply these primitives to its own
// content directly. The same applies across expo-router's native-stack
// screen boundaries — each screen's own outermost container should use
// DirectionalScreen rather than a bare SafeAreaView.
// ---------------------------------------------------------------------------

import React from "react";
import {
  SafeAreaView,
  Text,
  TextInput,
  TextInputProps,
  TextProps,
  View,
  ViewProps,
} from "react-native";

import { useLanguage } from "./LanguageProvider";
import { ltrContentStyle } from "./rtl";

type SafeAreaViewProps = React.ComponentProps<typeof SafeAreaView>;

// Drop-in replacement for SafeAreaView as a screen's outermost container.
// Does not itself reorder anything (a screen's root has no row order of its
// own) — kept as the one place a future native-only enhancement could hook
// in without touching every screen again.
export function DirectionalScreen({ style, children, ...rest }: SafeAreaViewProps) {
  return (
    <SafeAreaView style={style} {...rest}>
      {children}
    </SafeAreaView>
  );
}

// A row whose children must visually read in logical start→end order.
// `direction: "ltr"` NEUTRALIZES whatever direction this row inherited from
// an ancestor (see this file's header on why that's required) BEFORE the
// explicit `flexDirection: isRTL ? "row-reverse" : "row"` is applied — so
// this row's visual order depends on exactly one thing: its OWN isRTL check.
// Use this for icon+text pairs, label/value rows, header rows, action-button
// rows — anywhere child ORDER (not just spacing) must flip for RTL. Never
// wrap a semantic route string ("Nazareth → Mashhad") in this — that value
// must stay in its own literal, unreversed order/text.
export function DirectionalRow({ style, children, ...rest }: ViewProps) {
  const { isRTL } = useLanguage();

  // The computed style MUST come AFTER the caller's own `style` in this
  // array — most callers still carry a static `flexDirection: "row"` baked
  // into their own StyleSheet (written before this component existed), and
  // RN's style-array merge lets a LATER entry win per-key. Putting the
  // caller's style first (and this computed one last) is what makes the
  // neutralize-then-reverse pair actually win instead of being silently
  // clobbered by that stale static "row".
  return (
    <View
      style={[
        style,
        { direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" },
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

// A card/section container. Purely a semantic wrapper today (no row order
// of its own to fix, so nothing to neutralize) — kept distinct from a plain
// View so a Modal's content root reads clearly as "this is the modal's real
// content box."
export function DirectionalCard({ style, children, ...rest }: ViewProps) {
  return (
    <View style={style} {...rest}>
      {children}
    </View>
  );
}

// A header row: title + optional start/end slots (back button, actions,
// language switcher, ...). Same neutralize-then-reverse mechanism as
// DirectionalRow, plus the header-specific `alignItems: "center"` default.
export function DirectionalHeader({ style, children, ...rest }: ViewProps) {
  const { isRTL } = useLanguage();

  // See DirectionalRow's own comment on why the computed style must come
  // AFTER the caller's `style` in this array, not before.
  return (
    <View
      style={[
        style,
        {
          direction: "ltr",
          flexDirection: isRTL ? "row-reverse" : "row",
          alignItems: "center",
        },
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

// Horizontal scroll content (a chips row, a horizontal category strip, a
// day-of-week selector, ...) built from plain Views (not FlatList/
// ScrollView, which don't accept this style the same way — for those, apply
// `rtl.ts`'s `directionalRowStyle` to their own `style`/`contentContainerStyle`
// directly). The underlying data array is never reversed — only the
// rendered order.
export function DirectionalScrollContent({ style, children, ...rest }: ViewProps) {
  const { isRTL } = useLanguage();

  // See DirectionalRow's own comment on why the computed style must come
  // AFTER the caller's `style` in this array, not before.
  return (
    <View
      style={[
        style,
        { direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" },
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

// Normal user-facing text: right-aligned + RTL writing direction in
// Arabic/Hebrew, left-aligned + LTR in English/Russian — set directly via a
// plain ternary (never routed through a second helper that could invert
// which edge is "start"/"end" unexpectedly).
//
// COMPACT BY DEFAULT: does not stretch — correct for inline text inside
// rows, chips, badges, and buttons, which must never grow to fill their row.
// Pass `block` only when this Text sits inside a vertical/column container
// that actually has spare width to give (typically a sibling `flex: 1`
// wrapper) — that's what makes `width: "100%"` meaningful; on a compact
// row/chip/badge it would do nothing useful and risks unwanted stretching.
//
// Pass `ltr` for content that must never reverse (emails, phone numbers,
// verification codes, plate numbers, prices, dates/times, coordinates) —
// see rtl.ts's ltrContentStyle, applied here instead of the normal
// direction-aware alignment.
export function DirectionalText({
  style,
  ltr,
  block,
  ...rest
}: TextProps & { ltr?: boolean; block?: boolean }) {
  const { isRTL } = useLanguage();

  const directionalStyle = ltr
    ? ltrContentStyle
    : {
        ...(block ? { width: "100%" as const } : null),
        textAlign: isRTL ? ("right" as const) : ("left" as const),
        writingDirection: isRTL ? ("rtl" as const) : ("ltr" as const),
      };

  // See DirectionalRow's own comment (same file) on why the computed style
  // must come AFTER the caller's `style` — a caller's static StyleSheet
  // entry written before this component existed often still carries its own
  // stale `textAlign`, which would otherwise silently win and produce
  // exactly the "no visible alignment change" bug this component exists to
  // fix.
  return <Text style={[style, directionalStyle]} {...rest} />;
}

// A full-width block of text (a title, subtitle, form label, helper, or
// error line) whose physical alignment must be immune to whatever direction
// an ancestor happens to have inherited. `DirectionalText`'s `block` prop
// (width: "100%" on the Text alone) is not always enough — a Text nested
// inside a container that itself inherited the app's RTL root direction can
// still have its available box recomputed against that inherited direction.
// This component neutralizes that by wrapping the Text in its OWN plain
// `View` with `{ width: "100%", direction: "ltr" }` FIRST, so the Text's
// `width: "100%"` is always measured against a known, reset-to-LTR box,
// and then sets the Text's own `textAlign`/`writingDirection` from isRTL on
// top of that neutral baseline. Use this — not bare DirectionalText — for
// every title/subtitle/label/helper/error line that has visibly failed to
// align despite `block` alone.
//
// Never use this for compact inline content (chips, badges, buttons) — see
// DirectionalText's own comment on why those must stay content-hugging.
export function PhysicalDirectionalBlockText({
  style,
  ltr,
  ...rest
}: TextProps & { ltr?: boolean }) {
  const { isRTL } = useLanguage();

  const directionalStyle = ltr
    ? ltrContentStyle
    : {
        width: "100%" as const,
        textAlign: isRTL ? ("right" as const) : ("left" as const),
        writingDirection: isRTL ? ("rtl" as const) : ("ltr" as const),
      };

  return (
    <View style={{ width: "100%", direction: "ltr" }}>
      <Text style={[style, directionalStyle]} {...rest} />
    </View>
  );
}

// Normal text input: label/placeholder/entered-text align right in
// Arabic/Hebrew, left in English/Russian — same compact-by-default /
// `block` behavior as DirectionalText, for the same reason. Pass `ltr` for
// the same never-reverse content list as DirectionalText (email, phone,
// codes, plates, prices, numeric values) — the field's OWN value/placeholder
// stays LTR while the surrounding label/layout the caller builds around it
// stays direction-aware.
export function DirectionalTextInput({
  style,
  ltr,
  block,
  ...rest
}: TextInputProps & { ltr?: boolean; block?: boolean }) {
  const { isRTL } = useLanguage();

  const directionalStyle = ltr
    ? ltrContentStyle
    : {
        ...(block ? { width: "100%" as const } : null),
        textAlign: isRTL ? ("right" as const) : ("left" as const),
        writingDirection: isRTL ? ("rtl" as const) : ("ltr" as const),
      };

  // See DirectionalRow's own comment (same file) on why the computed style
  // must come AFTER the caller's `style`.
  return <TextInput style={[style, directionalStyle]} {...rest} />;
}
