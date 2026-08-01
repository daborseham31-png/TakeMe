// ---------------------------------------------------------------------------
// Reusable "pick one or more of my own children" list — the shared core of
// select-child.tsx (Home → School Ride category entry) and the Home feed's
// School Trip card entry (see app/(tabs)/home.tsx's childSelectItem/
// handleChildSelectionContinue). Owns the schoolChildren subscription,
// selection state, empty state, and Continue gating; navigation (what
// Continue/Add Child actually DO once pressed) is entirely the caller's —
// this component never calls router.push itself, so every entry point wires
// it to its own destination without a second, incompatible child-picker
// existing anywhere in the app.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { findSchoolById } from "../schools";
import { SchoolChild, subscribeMyChildren } from "./schoolChildrenLib";

const makeLocalId = () => `child_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export type SelectedChildEntry = { localId: string; childId: string; childName: string };

// Prefers the child's own stable-data snapshot (same fallback my-children.tsx
// uses) so an older profile created before that snapshot existed still shows
// a real school name instead of a raw schoolId.
const schoolDisplayFor = (child: SchoolChild): string => {
  if (child.schoolName) return child.schoolName;
  const school = findSchoolById(child.schoolId);
  return school ? school.name : child.schoolId;
};

type Props = {
  onContinue: (entries: SelectedChildEntry[]) => void;
  onAddChild: () => void;
};

export default function ChildSelector({ onContinue, onAddChild }: Props) {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [children, setChildren] = useState<SchoolChild[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Kept mounted for the whole time the parent may navigate to
  // "Manage Children" (Add Child) and back — the same live-listener
  // convention DirectionSearchForm.tsx already relies on, so a newly added
  // child appears here automatically with no manual refresh.
  useEffect(() => {
    const unsub = subscribeMyChildren((next) => {
      setChildren(next.filter((c) => c.active));
      setLoading(false);
    });
    return unsub;
  }, []);

  const toggleChild = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectedCount = selectedIds.size;

  const handleContinue = () => {
    if (selectedCount === 0) return;

    const entries = children
      .filter((child) => selectedIds.has(child.id))
      .map((child) => ({
        localId: makeLocalId(),
        childId: child.id,
        childName: child.childName,
      }));

    onContinue(entries);
  };

  if (loading) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator size="large" color="#F58220" />
      </View>
    );
  }

  if (children.length === 0) {
    return (
      <View style={styles.emptyBox}>
        <Ionicons name="people-outline" size={40} color="#C7B9AC" />
        <Text style={styles.emptyTitle}>{t("schoolChildren.noChildrenAddedTitle")}</Text>
        <Text style={styles.emptyText}>{t("schoolChildren.addChildrenFirstMessage")}</Text>

        <Pressable style={styles.addButton} onPress={onAddChild}>
          <Ionicons name="add" size={20} color="#FFFFFF" />
          <Text style={styles.addButtonText}>{t("schoolChildren.addChild")}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <>
      <ScrollView contentContainerStyle={styles.scroll}>
        {children.map((child) => {
          const selected = selectedIds.has(child.id);
          return (
            <Pressable
              key={child.id}
              style={[styles.card, selected && styles.cardSelected]}
              onPress={() => toggleChild(child.id)}
            >
              <Ionicons
                name={selected ? "checkbox" : "square-outline"}
                size={24}
                color={selected ? "#F58220" : "#8B7B6B"}
              />

              <View style={styles.cardTextBox}>
                <Text style={styles.childName}>{child.childName}</Text>
                <Text style={styles.schoolName}>{schoolDisplayFor(child)}</Text>
              </View>
            </Pressable>
          );
        })}

        <Pressable style={styles.manageChildrenLink} onPress={onAddChild}>
          <Ionicons name="add-circle-outline" size={16} color="#3B82F6" />
          <Text style={styles.manageChildrenLinkText}>{t("schoolChildren.addChild")}</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        {selectedCount > 0 ? (
          <Text style={styles.selectedCountText}>
            {t("schoolChildren.selectedChildrenCount", { count: selectedCount })}
          </Text>
        ) : null}

        <Pressable
          style={[styles.continueButton, selectedCount === 0 && styles.continueButtonDisabled]}
          onPress={handleContinue}
          disabled={selectedCount === 0}
        >
          <Text style={styles.continueButtonText}>{t("common.continue")}</Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  loadingBox: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 40 },
  emptyBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingVertical: 30,
    gap: 10,
  },
  emptyTitle: { fontSize: 17, fontWeight: "900", color: "#111827", marginTop: 6, textAlign: "center" },
  emptyText: { color: "#7C5F46", fontWeight: "700", textAlign: "center" },
  addButton: {
    marginTop: 14,
    backgroundColor: "#F58220",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  addButtonText: { color: "#FFFFFF", fontWeight: "900", fontSize: 16 },
  scroll: { padding: 20, paddingBottom: 24 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E7DCD1",
    padding: 16,
    marginBottom: 12,
  },
  cardSelected: { borderColor: "#F58220", borderWidth: 2 },
  cardTextBox: { flex: 1 },
  childName: { fontSize: 16, fontWeight: "900", color: "#111827" },
  schoolName: { fontSize: 13, color: "#7C5F46", fontWeight: "700", marginTop: 2 },
  manageChildrenLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginTop: 4,
  },
  manageChildrenLinkText: { color: "#3B82F6", fontWeight: "800", fontSize: 13 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: "#F0E5DC",
    backgroundColor: "#FBF7F1",
  },
  selectedCountText: {
    color: "#7C5F46",
    fontWeight: "800",
    fontSize: 13,
    marginBottom: 8,
    textAlign: "center",
  },
  continueButton: {
    backgroundColor: "#F58220",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  continueButtonDisabled: { backgroundColor: "#E2D8CF" },
  continueButtonText: { color: "#FFFFFF", fontWeight: "900", fontSize: 16 },
});
