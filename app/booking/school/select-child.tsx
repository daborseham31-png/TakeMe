// ---------------------------------------------------------------------------
// School Ride entry gate — reached from Home via ride-category.tsx before
// the actual booking form (school/index.tsx) ever mounts. The passenger
// must explicitly pick which of their own children (schoolChildren, see
// schoolChildrenLib.ts) this booking is for; nothing is auto-selected.
//
// The actual list/selection/empty-state logic lives in ChildSelector.tsx —
// this screen is just its header chrome plus what Continue/Add Child do.
// The Home feed's own School Trip card entry point (see app/(tabs)/home.tsx's
// childSelectItem/handleChildSelectionContinue) reuses that SAME
// ChildSelector component inside a bottom-sheet modal instead of a full
// screen — never a second, incompatible child picker.
//
// On Continue, the chosen children are forwarded as a `childEntries` route
// param in the exact { localId, childId, childName } shape DirectionSearchForm/
// trip-results.tsx/trip-confirm.tsx/ride-payment.tsx already parse (see
// SchoolBookingChildEntry in schoolTripsLib.ts) — both school/index.tsx's
// forms read the SAME route params (they're rendered inside this screen's
// own route, not separate routes), so no prop-threading is needed beyond
// this one param.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { DirectionalScreen } from "../../i18n/DirectionalPrimitives";
import { useLanguage } from "../../i18n/LanguageProvider";
import ChildSelector, { SelectedChildEntry } from "./ChildSelector";

export default function SelectChildScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();

  const handleContinue = (childEntries: SelectedChildEntry[]) => {
    router.push({
      pathname: "/booking/school",
      params: { childEntries: JSON.stringify(childEntries) },
    } as any);
  };

  // Auto-opens my-children.tsx's Add form and auto-returns here on a
  // successful save — same behavior as Home's per-ride child-select sheet
  // (see app/(tabs)/home.tsx), so the two entry points never diverge.
  const handleAddChild = () =>
    router.push({
      pathname: "/booking/school/my-children",
      params: { autoAdd: "1" },
    } as any);

  const handleManageChildren = () => router.push("/booking/school/my-children" as any);

  return (
    <DirectionalScreen style={styles.page}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name={isRTL ? "arrow-forward" : "arrow-back"} size={24} color="#7C5F46" />
        </Pressable>
        <Text style={styles.title}>{t("schoolChildren.selectChildScreenTitle")}</Text>
        <Text style={styles.subtitle}>{t("schoolChildren.selectChildScreenSubtitle")}</Text>
      </View>

      <ChildSelector
        onContinue={handleContinue}
        onAddChild={handleAddChild}
        onManageChildren={handleManageChildren}
      />
    </DirectionalScreen>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#FBF7F1" },
  header: { paddingHorizontal: 20, paddingTop: 50 },
  backButton: { width: 40, height: 40, justifyContent: "center", marginBottom: 4 },
  title: { fontSize: 26, fontWeight: "900", color: "#111827" },
  subtitle: { fontSize: 14, color: "#7C5F46", marginTop: 4, marginBottom: 10 },
});
