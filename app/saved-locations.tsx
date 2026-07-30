import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { DirectionalCard, DirectionalScreen } from "./i18n/DirectionalPrimitives";
import { useLanguage } from "./i18n/LanguageProvider";
import { backIconName } from "./i18n/rtl";
import {
  createSavedLocation,
  deleteSavedLocation,
  SavedLocation,
  setSavedLocationAsHome,
  subscribeMySavedLocations,
  updateSavedLocation,
} from "./booking/savedLocationsLib";
import { LocationMapModal, MapConfirmResult } from "./booking/PickupLocationPicker";

export default function SavedLocationsScreen() {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();

  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [addVisible, setAddVisible] = useState(false);
  const [renaming, setRenaming] = useState<SavedLocation | null>(null);
  const [renameText, setRenameText] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => subscribeMySavedLocations(setLocations), []);

  const handleAddConfirm = async (result: MapConfirmResult) => {
    try {
      await createSavedLocation({
        label: result.label || "",
        latitude: result.latitude,
        longitude: result.longitude,
        address: result.address,
      });
      setAddVisible(false);
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("savedLocations.couldNotSave"));
    }
  };

  const handleSetHome = async (loc: SavedLocation) => {
    if (busyId) return;
    try {
      setBusyId(loc.id);
      await setSavedLocationAsHome(loc.id);
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("savedLocations.couldNotSave"));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = (loc: SavedLocation) => {
    Alert.alert(t("savedLocations.deleteConfirmTitle"), t("savedLocations.deleteConfirmMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: async () => {
          try {
            setBusyId(loc.id);
            await deleteSavedLocation(loc.id);
          } catch (error: any) {
            Alert.alert(t("common.error"), error?.message || t("savedLocations.couldNotSave"));
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  const openRename = (loc: SavedLocation) => {
    setRenaming(loc);
    setRenameText(loc.label);
  };

  const submitRename = async () => {
    if (!renaming) return;
    try {
      await updateSavedLocation(renaming.id, { label: renameText });
      setRenaming(null);
    } catch (error: any) {
      Alert.alert(t("common.error"), error?.message || t("savedLocations.couldNotSave"));
    }
  };

  return (
    <DirectionalScreen style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name={backIconName(isRTL)} size={22} color="#7C5F46" />
          <Text style={styles.backText}>{t("common.back")}</Text>
        </Pressable>

        <Text style={styles.title}>{t("savedLocations.screenTitle")}</Text>

        {locations.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="location-outline" size={36} color="#8B7B6B" />
            <Text style={styles.emptyTitle}>{t("savedLocations.noLocationsYetTitle")}</Text>
            <Text style={styles.emptyText}>{t("savedLocations.noLocationsYetMessage")}</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {locations.map((loc) => (
              <View key={loc.id} style={styles.row}>
                <View style={styles.rowIcon}>
                  <Ionicons
                    name={loc.isHome ? "home" : "location"}
                    size={18}
                    color="#F58220"
                  />
                </View>

                <View style={styles.rowTextBox}>
                  <View style={styles.rowLabelRow}>
                    <Text style={styles.rowLabel}>{loc.label}</Text>
                    {loc.isHome ? (
                      <View style={styles.homeBadge}>
                        <Text style={styles.homeBadgeText}>{t("savedLocations.homeBadge")}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {loc.address}
                  </Text>
                </View>

                {busyId === loc.id ? (
                  <ActivityIndicator color="#F58220" />
                ) : (
                  <View style={styles.rowActions}>
                    {!loc.isHome ? (
                      <Pressable onPress={() => handleSetHome(loc)} hitSlop={6}>
                        <Ionicons name="home-outline" size={18} color="#7C5F46" />
                      </Pressable>
                    ) : null}
                    <Pressable onPress={() => openRename(loc)} hitSlop={6}>
                      <Ionicons name="create-outline" size={18} color="#7C5F46" />
                    </Pressable>
                    <Pressable onPress={() => handleDelete(loc)} hitSlop={6}>
                      <Ionicons name="trash-outline" size={18} color="#B91C1C" />
                    </Pressable>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        <Pressable style={styles.addButton} onPress={() => setAddVisible(true)}>
          <Ionicons name="add-circle-outline" size={20} color="#FFFFFF" />
          <Text style={styles.addButtonText}>{t("savedLocations.addLocationButton")}</Text>
        </Pressable>
      </ScrollView>

      <LocationMapModal
        visible={addVisible}
        variant="add"
        onClose={() => setAddVisible(false)}
        onConfirm={handleAddConfirm}
      />

      <Modal visible={!!renaming} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <View style={styles.renameOverlay}>
          <Pressable style={styles.renameBackdrop} onPress={() => setRenaming(null)} />
          <DirectionalCard style={styles.renameCard}>
            <Text style={styles.renameTitle}>{t("savedLocations.labelPlaceholder")}</Text>
            <TextInput
              style={styles.renameInput}
              value={renameText}
              onChangeText={setRenameText}
              autoFocus
            />
            <View style={styles.renameButtonsRow}>
              <Pressable style={styles.renameCancelButton} onPress={() => setRenaming(null)}>
                <Text style={styles.renameCancelText}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable style={styles.renameSaveButton} onPress={submitRename}>
                <Text style={styles.renameSaveText}>{t("common.save")}</Text>
              </Pressable>
            </View>
          </DirectionalCard>
        </View>
      </Modal>
    </DirectionalScreen>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  scroll: {
    padding: 20,
    paddingTop: 50,
    paddingBottom: 40,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 16,
  },
  backText: {
    color: "#7C5F46",
    fontWeight: "800",
    fontSize: 15,
  },
  title: {
    fontSize: 26,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 20,
  },
  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E7DCD1",
    padding: 26,
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: "#111827",
    marginTop: 4,
  },
  emptyText: {
    color: "#7C5F46",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
  },
  list: {
    gap: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#FFF2E8",
    alignItems: "center",
    justifyContent: "center",
  },
  rowTextBox: {
    flex: 1,
  },
  rowLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: "800",
    color: "#111827",
  },
  rowSub: {
    fontSize: 12.5,
    color: "#7C5F46",
    marginTop: 2,
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  homeBadge: {
    backgroundColor: "#F58220",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  homeBadgeText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 10.5,
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#F58220",
    borderRadius: 12,
    paddingVertical: 15,
    marginTop: 18,
  },
  addButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
  },
  renameOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 24,
  },
  renameBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  renameCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
  },
  renameTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#7C5F46",
    marginBottom: 10,
  },
  renameInput: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#111827",
    fontWeight: "700",
  },
  renameButtonsRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  renameCancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  renameCancelText: {
    color: "#7C5F46",
    fontWeight: "900",
  },
  renameSaveButton: {
    flex: 1,
    backgroundColor: "#F58220",
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  renameSaveText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
});
