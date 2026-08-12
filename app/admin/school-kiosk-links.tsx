// ---------------------------------------------------------------------------
// School Kiosk Links — admin screen. Lets an admin find any school's kiosk
// link (Copy/Open) without ever touching source code or Firestore. Reads
// ONLY the static school dataset (schoolKioskLinksLib.ts → schools.ts) — no
// Firestore reads at all, so no child/parent/driver/booking data is ever
// loaded here. Route protection is inherited from app/admin/_layout.tsx
// (the same admin-only guard every /admin/* screen goes through).
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Alert } from "../AppAlert";
import { useTranslation } from "react-i18next";

import { isSafeHttpsKioskUrl, isSchoolKioskBackendConfigured } from "../booking/school/schoolKioskLinks";
import { useLanguage } from "../i18n/LanguageProvider";
import { adminColors, adminRadius, adminSpacing } from "./adminTheme";
import { filterSchoolKioskLinkRows, getSchoolKioskLinkRows, SchoolKioskLinkRow } from "./schoolKioskLinksLib";
import AdminScreen from "./components/AdminScreen";
import { EmptyState } from "./components/AdminStates";
import SearchBar from "./components/SearchBar";

// How long the inline "Link copied" confirmation stays visible next to the
// row it belongs to — long enough to notice, short enough to never feel
// like a lingering/stuck state.
const COPY_FEEDBACK_MS = 1600;

export default function AdminSchoolKioskLinksScreen() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [search, setSearch] = useState("");
  const [copiedSchoolId, setCopiedSchoolId] = useState<string | null>(null);
  const copyFeedbackTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const backendConfigured = isSchoolKioskBackendConfigured();

  const allRows = useMemo(() => getSchoolKioskLinkRows(language), [language]);
  const filteredRows = useMemo(
    () => filterSchoolKioskLinkRows(allRows, search),
    [allRows, search],
  );

  useEffect(() => {
    return () => {
      if (copyFeedbackTimeout.current) clearTimeout(copyFeedbackTimeout.current);
    };
  }, []);

  // Never a repeated Alert per tap (that becomes annoying fast if an admin
  // taps "Copy Link" on several rows in a row) — a quiet inline confirmation
  // next to the button that clears itself is the only feedback on success.
  // Alert.alert is reserved for the rare failure case below.
  const handleCopy = async (row: SchoolKioskLinkRow) => {
    if (!row.kioskUrl) return;

    try {
      await Clipboard.setStringAsync(row.kioskUrl);
      setCopiedSchoolId(row.schoolId);
      if (copyFeedbackTimeout.current) clearTimeout(copyFeedbackTimeout.current);
      copyFeedbackTimeout.current = setTimeout(() => setCopiedSchoolId(null), COPY_FEEDBACK_MS);
    } catch {
      Alert.alert(t("admin.somethingWentWrong"), t("admin.schoolKioskCopyFailed"));
    }
  };

  const handleOpen = async (row: SchoolKioskLinkRow) => {
    if (!row.kioskUrl || !isSafeHttpsKioskUrl(row.kioskUrl)) {
      Alert.alert(t("admin.somethingWentWrong"), t("admin.schoolKioskInvalidUrl"));
      return;
    }

    try {
      await Linking.openURL(row.kioskUrl);
    } catch {
      Alert.alert(t("admin.somethingWentWrong"), t("admin.schoolKioskOpenFailed"));
    }
  };

  const renderRow = ({ item }: { item: SchoolKioskLinkRow }) => (
    <View style={styles.card}>
      <Text style={styles.name} numberOfLines={2}>
        {item.name}
      </Text>
      <Text style={styles.city}>{item.city}</Text>
      <Text style={styles.schoolId}>
        {t("admin.schoolKioskSchoolIdLabel", { id: item.schoolId })}
      </Text>

      {item.kioskUrl ? (
        <Text style={styles.url} numberOfLines={2} selectable>
          {item.kioskUrl}
        </Text>
      ) : null}

      <View style={styles.actionsRow}>
        <Pressable
          style={[styles.actionButton, styles.copyButton, !item.kioskUrl && styles.actionButtonDisabled]}
          onPress={() => handleCopy(item)}
          disabled={!item.kioskUrl}
        >
          <Ionicons name="copy-outline" size={16} color={adminColors.primary} />
          <Text style={styles.copyButtonText}>{t("admin.copyLink")}</Text>
        </Pressable>

        <Pressable
          style={[styles.actionButton, styles.openButton, !item.kioskUrl && styles.actionButtonDisabled]}
          onPress={() => handleOpen(item)}
          disabled={!item.kioskUrl}
        >
          <Ionicons name="open-outline" size={16} color="#FFFFFF" />
          <Text style={styles.openButtonText}>{t("admin.openKiosk")}</Text>
        </Pressable>

        {copiedSchoolId === item.schoolId ? (
          <View style={styles.copiedBadge}>
            <Ionicons name="checkmark-circle" size={14} color={adminColors.success} />
            <Text style={styles.copiedBadgeText}>{t("admin.linkCopied")}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );

  return (
    <AdminScreen title={t("admin.schoolKioskLinks")} activeKey="schoolKioskLinks">
      <Text style={styles.intro}>{t("admin.schoolKioskLinksIntro")}</Text>

      {!backendConfigured ? (
        <View style={styles.warningBanner}>
          <Ionicons name="alert-circle-outline" size={18} color={adminColors.warning} />
          <Text style={styles.warningBannerText}>{t("errors.backendUrlNotSet")}</Text>
        </View>
      ) : null}

      <View style={styles.filtersWrap}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder={t("admin.schoolKioskSearchPlaceholder")}
        />
      </View>

      <FlatList
        data={filteredRows}
        keyExtractor={(item) => item.schoolId}
        renderItem={renderRow}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <EmptyState
            icon="school-outline"
            title={t("admin.noSchoolsFound")}
            subtitle={t("admin.tryDifferentSearchFilter")}
          />
        }
      />
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  intro: {
    fontSize: 13,
    color: adminColors.textMuted,
    lineHeight: 19,
    paddingHorizontal: adminSpacing.lg,
    marginBottom: adminSpacing.sm,
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: adminColors.warningBg,
    borderRadius: adminRadius.md,
    marginHorizontal: adminSpacing.lg,
    marginBottom: adminSpacing.sm,
    padding: 12,
  },
  warningBannerText: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: "700",
    color: adminColors.warning,
    lineHeight: 18,
  },
  filtersWrap: {
    paddingHorizontal: adminSpacing.lg,
    marginBottom: 6,
  },
  list: {
    paddingHorizontal: adminSpacing.lg,
    paddingBottom: 40,
    gap: 10,
  },
  card: {
    backgroundColor: adminColors.card,
    borderWidth: 1,
    borderColor: adminColors.border,
    borderRadius: adminRadius.lg,
    padding: 14,
    gap: 4,
  },
  name: {
    fontSize: 15,
    fontWeight: "900",
    color: adminColors.text,
  },
  city: {
    fontSize: 13,
    fontWeight: "700",
    color: adminColors.textMuted,
  },
  schoolId: {
    fontSize: 12.5,
    fontWeight: "700",
    color: adminColors.textMuted,
    marginBottom: 2,
  },
  url: {
    fontSize: 12,
    color: adminColors.info,
    marginBottom: 6,
  },
  actionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: adminRadius.pill,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  copyButton: {
    backgroundColor: adminColors.warningBg,
  },
  copyButtonText: {
    color: adminColors.primary,
    fontWeight: "800",
    fontSize: 12.5,
  },
  openButton: {
    backgroundColor: adminColors.primary,
  },
  openButtonText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 12.5,
  },
  copiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  copiedBadgeText: {
    fontSize: 12,
    fontWeight: "800",
    color: adminColors.success,
  },
});
