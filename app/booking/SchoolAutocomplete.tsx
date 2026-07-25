// ---------------------------------------------------------------------------
// Shared school picker — the ONE input to use everywhere a screen asks a
// driver or parent to pick a school for a school trip. Selecting a result
// returns the school's stable id, real (untranslated) name, city, and GPS
// coordinates, so every school trip is matched by schoolId (never a
// free-text school name string) — see schoolTripsLib.ts.
//
// ALWAYS scoped to a single area via `areaLocationId` (the trip's currently
// selected To area for an outbound leg, From area for a return leg, or the
// city/area picked on the School Child profile form — see
// AGENTS.md's school-search-area rule). The field stays disabled until an
// area is selected, and a picked school is cleared by the caller whenever
// that area changes (a school picked for one area is never silently kept
// when the area changes to a different one).
//
// UX: tapping the field (once enabled) immediately opens a full,
// virtualized (FlatList), scrollable list of EVERY school registered to
// that area — no typing required. An optional filter field at the top of
// that list narrows it locally (never a network call, never changes which
// area is selected) — see schools.ts's getSchoolsForCity/
// filterSchoolsLocally. This is a deliberate departure from a classic
// type-ahead autocomplete: the parent should never have to already know
// how a school's name starts before they can find it.
//
// Display text for every result — and for the value written back via
// onChangeText/onSelectSchool once one is picked — is always the school's
// own STORED name (school.name, the real Ministry-of-Education Hebrew
// name), never the localized/best-effort display variant
// (getLocalizedSchoolName) schools.ts also offers for OTHER contexts. Only
// this component's own interface labels ("Select a school", "Search
// schools", "No schools found", ...) are translated.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { useLanguage } from "../i18n/LanguageProvider";
import { filterSchoolsLocally, getSchoolsForCity, SchoolLocation } from "./schools";

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  onSelectSchool: (school: SchoolLocation) => void;
  areaLocationId: string | null;
  placeholder?: string;
  label?: string;
  error?: string;
  // Shown (as the disabled field's own text, and as the Alert when tapped
  // while disabled) instead of the default "Select From/To first" wording —
  // callers whose "area" isn't a trip's From/To (e.g. the School Child
  // profile form's City/Area field) pass their own precise wording here.
  disabledMessage?: string;
};

export default function SchoolAutocomplete({
  value,
  onChangeText,
  onSelectSchool,
  areaLocationId,
  placeholder,
  label,
  error,
  disabledMessage,
}: Props) {
  const { t } = useTranslation();
  const { language, isRTL } = useLanguage();

  const [modalVisible, setModalVisible] = useState(false);
  const [filterText, setFilterText] = useState("");

  const disabled = !areaLocationId;
  const disabledText = disabledMessage || t("schoolTrip.selectAreaFirst");

  // Never carry a stale modal/filter over to a NEW area — see this file's
  // header. The caller is responsible for clearing its own selected school
  // when the area changes (every existing caller already does); this just
  // guards the component's OWN local state in case the area changes while
  // the picker happens to be open.
  useEffect(() => {
    setModalVisible(false);
    setFilterText("");
  }, [areaLocationId]);

  // The full, unfiltered roster for the selected area — loaded once per
  // area change, never re-derived from a previous one. See
  // schools.ts's getSchoolsForCity for the sort/exclusion rules (stored
  // name, alphabetical, no bare-locality entries).
  const citySchools = useMemo(() => getSchoolsForCity(areaLocationId), [areaLocationId]);

  // Purely local narrowing of citySchools — an empty filter always shows
  // the full list (see filterSchoolsLocally: empty input is a no-op pass
  // through), so opening the picker with nothing typed still shows
  // everything immediately.
  const filteredSchools = useMemo(
    () => filterSchoolsLocally(citySchools, filterText, language),
    [citySchools, filterText, language],
  );

  const openPicker = () => {
    if (disabled) {
      Alert.alert(disabledText);
      return;
    }
    setFilterText("");
    setModalVisible(true);
  };

  const closePicker = () => {
    setModalVisible(false);
  };

  const handleSelect = (school: SchoolLocation) => {
    Keyboard.dismiss();
    onChangeText(school.name);
    onSelectSchool(school);
    setModalVisible(false);
  };

  const handleClear = (event: any) => {
    event?.stopPropagation?.();
    onChangeText("");
  };

  return (
    <View style={styles.wrapper}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      <Pressable
        style={[styles.inputRow, disabled && styles.inputRowDisabled]}
        onPress={openPicker}
      >
        <Ionicons name="school-outline" size={18} color="#8B7B6B" />
        <Text
          style={[
            styles.inputText,
            !value && styles.inputTextPlaceholder,
            isRTL && styles.inputTextRTL,
          ]}
          numberOfLines={1}
        >
          {value || (disabled ? disabledText : placeholder || t("schoolTrip.selectSchoolTitle"))}
        </Text>
        {value && !disabled ? (
          <Pressable hitSlop={8} onPress={handleClear}>
            <Ionicons name="close-circle" size={18} color="#C7B9AC" />
          </Pressable>
        ) : null}
        {!disabled ? (
          <Ionicons name="chevron-down" size={16} color="#8B7B6B" />
        ) : null}
      </Pressable>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={closePicker}>
        <KeyboardAvoidingView
          style={styles.modalKeyboardAvoider}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalOverlay}>
            <Pressable style={styles.modalBackdrop} onPress={closePicker} />

            <View style={styles.modalCard}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>{t("schoolTrip.selectSchoolTitle")}</Text>

              <View style={styles.filterRow}>
                <Ionicons name="search-outline" size={16} color="#8B7B6B" />
                <TextInput
                  style={[styles.filterInput, isRTL && styles.inputTextRTL]}
                  value={filterText}
                  onChangeText={setFilterText}
                  placeholder={t("schoolTrip.searchSchoolPlaceholder")}
                  placeholderTextColor="#9B7A68"
                />
                {filterText ? (
                  <Pressable hitSlop={8} onPress={() => setFilterText("")}>
                    <Ionicons name="close-circle" size={16} color="#C7B9AC" />
                  </Pressable>
                ) : null}
              </View>

              {filteredSchools.length === 0 ? (
                <View style={styles.emptyRow}>
                  <Ionicons name="search-outline" size={16} color="#8B7B6B" />
                  <Text style={styles.emptyText}>{t("schoolTrip.noSchoolsFound")}</Text>
                </View>
              ) : (
                <FlatList
                  style={styles.resultsList}
                  data={filteredSchools}
                  keyExtractor={(school) => school.id}
                  keyboardShouldPersistTaps="handled"
                  initialNumToRender={20}
                  renderItem={({ item }) => (
                    <Pressable style={styles.resultRow} onPress={() => handleSelect(item)}>
                      <Ionicons name="school" size={16} color="#F58220" />
                      <Text
                        style={[styles.resultText, isRTL && styles.resultTextRTL]}
                        numberOfLines={1}
                      >
                        {item.name}
                      </Text>
                    </Pressable>
                  )}
                />
              )}

              <Pressable style={styles.modalCancelButton} onPress={closePicker}>
                <Text style={styles.modalCancelText}>{t("common.cancel")}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: "100%",
    marginBottom: 18,
  },
  label: {
    fontSize: 14,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#FFFDFC",
  },
  inputRowDisabled: {
    backgroundColor: "#F3ECE3",
  },
  inputText: {
    flex: 1,
    fontSize: 15,
    color: "#111827",
  },
  inputTextPlaceholder: {
    color: "#9B7A68",
  },
  inputTextRTL: {
    textAlign: "right",
    writingDirection: "rtl",
  },
  errorText: {
    color: "#B91C1C",
    fontWeight: "700",
    fontSize: 12.5,
    marginTop: 6,
  },
  modalKeyboardAvoider: { flex: 1 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalCard: {
    backgroundColor: "#FBF7F1",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    maxHeight: "80%",
  },
  modalHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#E2D8CF",
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 12,
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#FFFFFF",
    marginBottom: 10,
  },
  filterInput: {
    flex: 1,
    fontSize: 14,
    color: "#111827",
    padding: 0,
  },
  resultsList: {
    maxHeight: 420,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 6,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: "#F3ECE3",
  },
  resultText: {
    flex: 1,
    fontSize: 14.5,
    color: "#111827",
    fontWeight: "700",
  },
  resultTextRTL: {
    textAlign: "right",
    writingDirection: "rtl",
  },
  emptyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 6,
    paddingVertical: 20,
  },
  emptyText: {
    color: "#7C5F46",
    fontSize: 14,
    fontWeight: "600",
  },
  modalCancelButton: {
    marginTop: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  modalCancelText: {
    color: "#7C5F46",
    fontWeight: "800",
  },
});
