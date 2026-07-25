// ---------------------------------------------------------------------------
// My Children — parent-facing School Child profile management (Phase 1 of
// the School Return Kiosk project; see AGENTS.md's kiosk audit). Lets the
// signed-in parent view/add/edit their children, see each child's permanent
// School Return code, reset it, and deactivate/restore a profile.
//
// Reachable from the School screen header (see school/index.tsx). Every
// write here goes through app/booking/school/schoolChildrenLib.ts — this
// screen never touches Firestore directly.
//
// Add/Edit Child field order is City/Area BEFORE School (the School field
// stays disabled until a city is picked — see SchoolAutocomplete's own
// `disabled = !areaLocationId`), so a school is always chosen from a
// bounded, geographically-scoped list — never every school in the country.
// Tapping School immediately opens the FULL scrollable list of every real
// school registered to the picked city (see schools.ts's getSchoolsForCity)
// — no typing required; an optional filter field only narrows that
// already-loaded list. School names shown/stored here are always the
// school's own real, unmodified name (school.name) — never the localized/
// best-effort display variant schools.ts also offers for other contexts.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { useLanguage } from "../../i18n/LanguageProvider";
import { getIsraelLocationById, IsraelLocation } from "../israelLocations";
import IsraelLocationAutocomplete from "../IsraelLocationAutocomplete";
import SchoolAutocomplete from "../SchoolAutocomplete";
import { findSchoolById, SchoolLocation } from "../schools";
import {
  createSchoolChild,
  resetSchoolChildReturnCode,
  SchoolChild,
  setSchoolChildActive,
  subscribeMyChildren,
  updateSchoolChildProfile,
} from "./schoolChildrenLib";

// city display text in the app's current language — english/arabic/hebrew
// are the only three IsraelLocation carries; Russian falls back to English,
// same convention schools.ts already uses for the same reason (no Russian
// column in that dataset).
const cityDisplayName = (city: IsraelLocation, language: string): string => {
  if (language === "he") return city.hebrew;
  if (language === "ar") return city.arabic;
  return city.english;
};

export default function MyChildrenScreen() {
  const { t } = useTranslation();
  const { isRTL, language } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [children, setChildren] = useState<SchoolChild[]>([]);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingChild, setEditingChild] = useState<SchoolChild | null>(null);
  const [nameInput, setNameInput] = useState("");

  const [cityQuery, setCityQuery] = useState("");
  const [selectedCity, setSelectedCity] = useState<IsraelLocation | null>(null);
  const [cityError, setCityError] = useState("");

  const [schoolQuery, setSchoolQuery] = useState("");
  const [selectedSchool, setSelectedSchool] = useState<SchoolLocation | null>(null);
  const [nameError, setNameError] = useState("");
  const [schoolError, setSchoolError] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyChildId, setBusyChildId] = useState<string | null>(null);

  // Whether the parent has actually interacted with the City/School fields
  // THIS modal session — reset on every open (see resetFormFields/
  // openEditModal below), never carried over from a previous Add/Edit
  // session. Lets handleSave tell "the parent hasn't touched school/city at
  // all" apart from "the parent cleared it and hasn't picked a new one yet"
  // — see handleSave's keepExistingSchool below.
  const [citySelectionTouched, setCitySelectionTouched] = useState(false);
  const [schoolSelectionTouched, setSchoolSelectionTouched] = useState(false);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeMyChildren((next) => {
      setChildren(next);
      setLoading(false);
    });
    return unsub;
  }, []);

  // Only ACTIVE children ever appear here — a removed child must fully
  // disappear from the normal Manage Children list the instant deactivation
  // succeeds, never lingering as a "Removed"/"Inactive" card with a Restore
  // option (see handleDeactivate below). The profile document itself is
  // never hard-deleted (active: false only — see schoolChildrenLib.ts), so
  // historical bookings that already reference this childId stay valid;
  // it's just hidden from this UI and from every booking-form child
  // selector (DirectionSearchForm.tsx's subscribeMyChildren already filters
  // the exact same way).
  const sortedChildren = useMemo(
    () =>
      children
        .filter((child) => child.active)
        .sort((a, b) => b.createdAtSeconds - a.createdAtSeconds),
    [children],
  );

  // Prefers the child's OWN stable-data snapshot (schoolName/schoolCityName
  // — see schoolChildrenLib.ts) taken at selection time; falls back to
  // re-deriving from the current schools.ts dataset by schoolId for any
  // profile created before that snapshot existed. Either way, schoolId
  // itself is never guessed from a display name, and the school's NAME is
  // always its real stored name — never localized/translated.
  const schoolDisplayFor = (child: SchoolChild): { name: string; city: string } => {
    if (child.schoolName) {
      return { name: child.schoolName, city: child.schoolCityName || "" };
    }
    const school = findSchoolById(child.schoolId);
    if (!school) return { name: child.schoolId, city: "" };
    return { name: school.name, city: school.city };
  };

  const resetFormFields = () => {
    setNameInput("");
    setCityQuery("");
    setSelectedCity(null);
    setSchoolQuery("");
    setSelectedSchool(null);
    setNameError("");
    setCityError("");
    setSchoolError("");
    setCitySelectionTouched(false);
    setSchoolSelectionTouched(false);
  };

  const openAddModal = () => {
    setEditingChild(null);
    resetFormFields();
    setModalVisible(true);
  };

  const openEditModal = (child: SchoolChild) => {
    setEditingChild(child);
    setNameInput(child.childName);

    const school = findSchoolById(child.schoolId);
    // Backward compatibility: an older profile has no schoolCityId snapshot
    // at all — fall back to the CURRENT school dataset's own areaLocationId
    // for that schoolId (never guessed from a locality name/text match).
    const cityId = child.schoolCityId || school?.areaLocationId || null;
    const city = getIsraelLocationById(cityId);

    setCityQuery(city ? cityDisplayName(city, language) : child.schoolCityName || "");
    setSelectedCity(city);
    setSchoolQuery(school ? school.name : child.schoolName || "");
    setSelectedSchool(school);
    setNameError("");
    setCityError("");
    setSchoolError("");
    setCitySelectionTouched(false);
    setSchoolSelectionTouched(false);
    setModalVisible(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalVisible(false);
  };

  // Typing invalidates the CONFIRMED city selection (there's no telling yet
  // which, if any, real location the parent will end up picking), but never
  // touches the already-picked school here — only an actual new city
  // selection (handleSelectCity below) ever decides whether the existing
  // school still applies, so reselecting the very same city (or simply
  // opening the picker and closing it again) can never force an otherwise
  // unchanged school to be re-picked.
  const handleCityChange = (text: string) => {
    setCityQuery(text);
    setSelectedCity(null);
    if (cityError) setCityError("");
    setCitySelectionTouched(true);
  };

  // A school always belongs to exactly one area (see schools.ts) — clear
  // the OLD school only if it no longer belongs to the NEWLY selected city.
  // Reselecting the same city the child's school already belongs to (e.g.
  // the parent just double-checked the field) leaves that school exactly as
  // it was, never forcing a reselect.
  const handleSelectCity = (city: IsraelLocation) => {
    setSelectedCity(city);
    setCityError("");
    setCitySelectionTouched(true);

    if (selectedSchool && selectedSchool.areaLocationId !== city.id) {
      setSchoolQuery("");
      setSelectedSchool(null);
      if (schoolError) setSchoolError("");
    }
  };

  const MAX_CHILD_NAME_LENGTH = 80;

  // Dev-only visibility into WHICH failure this was — the Firebase/Firestore
  // error CODE only (e.g. "permission-denied"), never the error's raw
  // message, and never returnCode/returnCodeHash/tokens/credentials (none of
  // which this screen ever touches anyway — see schoolChildrenLib.ts).
  const handleSaveError = (error: any) => {
    console.log("schoolChildren save failed", {
      feature: "my-children.handleSave",
      code: error?.code,
    });

    Alert.alert(
      t("schoolChildren.genericError"),
      error?.code === "permission-denied"
        ? t("schoolChildren.permissionDenied")
        : t("schoolChildren.couldNotSaveChanges"),
    );
  };

  const handleSave = async () => {
    const cleanName = nameInput.trim();

    if (!cleanName) {
      setNameError(t("schoolChildren.childNameRequired"));
      return;
    }
    if (cleanName.length > MAX_CHILD_NAME_LENGTH) {
      setNameError(t("schoolChildren.invalidChildName"));
      return;
    }

    // Editing an existing profile the parent never touched City/School for
    // THIS session keeps that profile's school data completely untouched —
    // never forces a reselect of an unchanged school, and still lets an
    // older profile (whose stored schoolId can't even be resolved back to a
    // display object — see openEditModal's backward-compatibility fallback)
    // save a plain name change safely. Only Add, or an Edit where the
    // parent actually interacted with either field, requires a full valid
    // city+school pick below.
    const keepExistingSchool =
      !!editingChild && !citySelectionTouched && !schoolSelectionTouched;

    if (!keepExistingSchool) {
      let hasError = false;

      if (!selectedCity) {
        setCityError(t("schoolChildren.cityRequired"));
        hasError = true;
      }
      if (!selectedSchool) {
        // Covers both "nothing selected yet" and "the parent typed something
        // but never tapped a real suggestion" — schoolQuery being non-empty
        // here means exactly that, since selecting a result is the ONLY thing
        // that ever sets selectedSchool (see SchoolAutocomplete.tsx).
        setSchoolError(t("schoolChildren.schoolRequired"));
        hasError = true;
      } else if (selectedCity && selectedSchool.areaLocationId !== selectedCity.id) {
        // Defensive — the picker only ever suggests schools already scoped to
        // the selected city, so this should be unreachable in normal use, but
        // is checked explicitly rather than assumed.
        setSchoolError(t("schoolChildren.schoolCityMismatchError"));
        hasError = true;
      }

      if (hasError || !selectedCity || !selectedSchool) return;
    }

    // A fresh city+school snapshot — only ever built when the parent has (or
    // just picked) a valid, matching pair; undefined when an Edit is keeping
    // the profile's existing school untouched (see keepExistingSchool
    // above), so that data is never overwritten with a recomputed value
    // (e.g. schoolCityName re-rendered in a different display language than
    // what's already stored).
    const schoolSnapshot =
      !keepExistingSchool && selectedCity && selectedSchool
        ? {
            schoolId: selectedSchool.id,
            // Always the school's real, unmodified stored name — never a
            // localized/translated variant (see this file's header).
            schoolName: selectedSchool.name,
            schoolCityId: selectedCity.id,
            schoolCityName: cityDisplayName(selectedCity, language),
            schoolAddress: selectedSchool.city,
          }
        : null;

    // Clean, explicit payload — never the entire child document or raw
    // modal state.
    try {
      setSaving(true);
      if (editingChild) {
        await updateSchoolChildProfile(editingChild.id, {
          childName: cleanName,
          ...schoolSnapshot,
        });
      } else {
        // Add always requires a freshly picked city+school — schoolSnapshot
        // is guaranteed non-null here since keepExistingSchool is always
        // false without an editingChild, so the validation block above
        // already ran and returned early on a missing/mismatched pick.
        await createSchoolChild({
          childName: cleanName,
          ...schoolSnapshot!,
        });
      }
      setModalVisible(false);
    } catch (error: any) {
      handleSaveError(error);
    } finally {
      setSaving(false);
    }
  };

  const handleResetCode = (child: SchoolChild) => {
    Alert.alert(
      t("schoolChildren.resetCodeConfirmTitle"),
      t("schoolChildren.resetCodeConfirmMessage", { child: child.childName }),
      [
        { text: t("schoolChildren.cancel"), style: "cancel" },
        {
          text: t("schoolChildren.confirmResetButton"),
          style: "destructive",
          onPress: async () => {
            try {
              setBusyChildId(child.id);
              await resetSchoolChildReturnCode(child.id);
              Alert.alert(t("common.success"), t("schoolChildren.resetCodeSuccess"));
            } catch (error: any) {
              Alert.alert(t("schoolChildren.genericError"), error?.message || "");
            } finally {
              setBusyChildId(null);
            }
          },
        },
      ],
    );
  };

  const handleDeactivate = (child: SchoolChild) => {
    Alert.alert(
      t("schoolChildren.deactivateConfirmTitle"),
      t("schoolChildren.deactivateConfirmMessage", { child: child.childName }),
      [
        { text: t("schoolChildren.cancel"), style: "cancel" },
        {
          text: t("schoolChildren.confirmDeactivateButton"),
          style: "destructive",
          onPress: async () => {
            try {
              setBusyChildId(child.id);
              await setSchoolChildActive(child.id, false);
            } catch (error: any) {
              Alert.alert(t("schoolChildren.genericError"), error?.message || "");
            } finally {
              setBusyChildId(null);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name={isRTL ? "arrow-forward" : "arrow-back"} size={24} color="#7C5F46" />
        </Pressable>
        <Text style={styles.title}>{t("schoolChildren.title")}</Text>
        <Text style={styles.subtitle}>{t("schoolChildren.subtitle")}</Text>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#F58220" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {sortedChildren.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="people-outline" size={36} color="#C7B9AC" />
              <Text style={styles.emptyText}>{t("schoolChildren.noChildrenYet")}</Text>
            </View>
          ) : (
            sortedChildren.map((child) => {
              const schoolDisplay = schoolDisplayFor(child);
              return (
                <View key={child.id} style={styles.card}>
                  <View style={styles.cardHeaderRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.childName}>{child.childName}</Text>
                      <Text style={styles.schoolName}>{schoolDisplay.name}</Text>
                      {schoolDisplay.city ? (
                        <Text style={styles.schoolCity}>{schoolDisplay.city}</Text>
                      ) : null}
                    </View>
                  </View>

                  <View style={styles.codeRow}>
                    <Ionicons name="key-outline" size={16} color="#7C5F46" />
                    <Text style={styles.codeLabel}>{t("schoolChildren.returnCodeLabel")}</Text>
                    <Text style={styles.codeValue}>{child.returnCode}</Text>
                  </View>
                  <Text style={styles.codeHint}>{t("schoolChildren.returnCodeHint")}</Text>

                  <View style={styles.actionsRow}>
                    <Pressable
                      style={styles.actionButton}
                      onPress={() => openEditModal(child)}
                      disabled={busyChildId === child.id}
                    >
                      <Ionicons name="pencil-outline" size={16} color="#F58220" />
                      <Text style={styles.actionText}>{t("schoolChildren.editChild")}</Text>
                    </Pressable>

                    <Pressable
                      style={styles.actionButton}
                      onPress={() => handleResetCode(child)}
                      disabled={busyChildId === child.id}
                    >
                      <Ionicons name="refresh-outline" size={16} color="#3B82F6" />
                      <Text style={[styles.actionText, { color: "#3B82F6" }]}>
                        {t("schoolChildren.resetCode")}
                      </Text>
                    </Pressable>

                    <Pressable
                      style={styles.actionButton}
                      onPress={() => handleDeactivate(child)}
                      disabled={busyChildId === child.id}
                    >
                      <Ionicons name="trash-outline" size={16} color="#B91C1C" />
                      <Text style={[styles.actionText, { color: "#B91C1C" }]}>
                        {t("schoolChildren.deactivateChild")}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      <Pressable style={styles.addButton} onPress={openAddModal}>
        <Ionicons name="add" size={20} color="#FFFFFF" />
        <Text style={styles.addButtonText}>{t("schoolChildren.addChild")}</Text>
      </Pressable>

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={closeModal}>
        <KeyboardAvoidingView
          style={styles.modalKeyboardAvoider}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.modalScrollContent}
              >
                <Text style={styles.modalTitle}>
                  {editingChild ? t("schoolChildren.editChildTitle") : t("schoolChildren.addChildTitle")}
                </Text>

                {/* 1. Child name */}
                <Text style={styles.label}>{t("schoolChildren.childNameLabel")}</Text>
                <TextInput
                  style={[styles.input, isRTL && { textAlign: "right" }]}
                  placeholder={t("schoolChildren.childNamePlaceholder")}
                  placeholderTextColor="#8B7B6B"
                  value={nameInput}
                  onChangeText={(text) => {
                    setNameInput(text);
                    if (nameError) setNameError("");
                  }}
                />
                {nameError ? <Text style={styles.errorText}>{nameError}</Text> : null}

                {/* 2. City / area — required, selected BEFORE the school field */}
                <IsraelLocationAutocomplete
                  label={t("schoolChildren.cityLabel")}
                  value={cityQuery}
                  onChangeText={handleCityChange}
                  onSelectLocation={handleSelectCity}
                  placeholder={t("schoolChildren.selectCityPlaceholder")}
                  error={cityError}
                />

                {/* 3. School — disabled until a city is selected (see
                    SchoolAutocomplete's own `disabled = !areaLocationId`) */}
                <SchoolAutocomplete
                  label={t("schoolTrip.schoolLabel")}
                  value={schoolQuery}
                  onChangeText={(text) => {
                    setSchoolQuery(text);
                    setSelectedSchool(null);
                    setSchoolSelectionTouched(true);
                    if (schoolError) setSchoolError("");
                  }}
                  onSelectSchool={(school) => {
                    setSelectedSchool(school);
                    setSchoolError("");
                    setSchoolSelectionTouched(true);
                    Keyboard.dismiss();
                  }}
                  areaLocationId={selectedCity?.id || null}
                  placeholder={t("schoolChildren.selectSchoolPlaceholder")}
                  error={schoolError}
                  disabledMessage={t("schoolChildren.selectCityFirstMessage")}
                />

                <View style={styles.modalActions}>
                  <Pressable style={styles.modalCancelButton} onPress={closeModal} disabled={saving}>
                    <Text style={styles.modalCancelText}>{t("schoolChildren.cancel")}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.modalSaveButton, saving && { opacity: 0.6 }]}
                    onPress={handleSave}
                    disabled={saving}
                  >
                    {saving ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.modalSaveText}>{t("schoolChildren.save")}</Text>
                    )}
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#FBF7F1" },
  header: { paddingHorizontal: 20, paddingTop: 50 },
  backButton: { width: 40, height: 40, justifyContent: "center", marginBottom: 4 },
  title: { fontSize: 26, fontWeight: "900", color: "#111827" },
  subtitle: { fontSize: 14, color: "#7C5F46", marginTop: 4, marginBottom: 10 },
  loadingBox: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: 20, paddingBottom: 100 },
  emptyBox: { alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 10 },
  emptyText: { color: "#7C5F46", fontWeight: "700", textAlign: "center" },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E7DCD1",
    padding: 16,
    marginBottom: 14,
  },
  cardHeaderRow: { flexDirection: "row", alignItems: "flex-start" },
  childName: { fontSize: 17, fontWeight: "900", color: "#111827" },
  schoolName: { fontSize: 13, color: "#7C5F46", fontWeight: "700", marginTop: 2 },
  schoolCity: { fontSize: 12, color: "#8B7B6B", fontWeight: "600", marginTop: 1 },
  codeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#F0E5DC",
  },
  codeLabel: { color: "#7C5F46", fontWeight: "700", fontSize: 12.5 },
  codeValue: {
    color: "#111827",
    fontWeight: "900",
    fontSize: 18,
    letterSpacing: 2,
    writingDirection: "ltr",
  },
  codeHint: { color: "#8B7B6B", fontSize: 11.5, marginTop: 4 },
  actionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 12 },
  actionButton: { flexDirection: "row", alignItems: "center", gap: 5 },
  actionText: { color: "#F58220", fontWeight: "800", fontSize: 12.5 },
  addButton: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 24,
    backgroundColor: "#F58220",
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  addButtonText: { color: "#FFFFFF", fontWeight: "900", fontSize: 16 },
  modalKeyboardAvoider: { flex: 1 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: "#FBF7F1",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    maxHeight: "85%",
  },
  modalScrollContent: { paddingBottom: 24 },
  modalTitle: { fontSize: 20, fontWeight: "900", color: "#111827", marginBottom: 16 },
  label: { fontSize: 14, fontWeight: "800", color: "#111827", marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#FFFDFC",
    fontSize: 15,
    color: "#111827",
    marginBottom: 4,
  },
  errorText: { color: "#B91C1C", fontWeight: "700", fontSize: 12.5, marginBottom: 10 },
  modalActions: { flexDirection: "row", gap: 12, marginTop: 10 },
  modalCancelButton: {
    flex: 1,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E2D8CF",
  },
  modalCancelText: { color: "#7C5F46", fontWeight: "800" },
  modalSaveButton: {
    flex: 1,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    backgroundColor: "#F58220",
  },
  modalSaveText: { color: "#FFFFFF", fontWeight: "900" },
});
