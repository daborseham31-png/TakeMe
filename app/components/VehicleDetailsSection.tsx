// ---------------------------------------------------------------------------
// The ONE shared "Vehicle Details" section — car model, car color, plate
// number — used at the bottom of every driver trip-creation form (one-time
// School Trip, weekly recurring School/Personal via RideForm.tsx, ...),
// immediately before that form's own Create/Save button. Each screen keeps
// its own car/carColor/carPlate state and its own submit/save logic — this
// component only renders the fields and forwards onChangeText, so there is
// exactly one place the card design/title/icons/field order/autocomplete
// behavior is defined, never a copy-pasted second version.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { styles as sharedStyles } from "../driver/create/driverHelpers";
import { SavedFormValues } from "../driver/create/savedFormValuesLib";
import AutocompleteTextField from "./AutocompleteTextField";

type Props = {
  car: string;
  onChangeCar: (value: string) => void;
  carColor: string;
  onChangeCarColor: (value: string) => void;
  carPlate: string;
  onChangeCarPlate: (value: string) => void;
  // Only carModels/carColors/plateNumbers are read — pass the object
  // useSavedFormValues() already returns, no need to pick fields yourself.
  savedValues: Pick<SavedFormValues, "carModels" | "carColors" | "plateNumbers">;
};

export default function VehicleDetailsSection({
  car,
  onChangeCar,
  carColor,
  onChangeCarColor,
  carPlate,
  onChangeCarPlate,
  savedValues,
}: Props) {
  const { t } = useTranslation();

  return (
    <View style={sharedStyles.card}>
      <View style={localStyles.header}>
        <Ionicons name="car-sport-outline" size={20} color="#F58220" />
        <Text style={localStyles.headerTitle}>{t("driverCreate.vehicleDetails")}</Text>
      </View>

      <AutocompleteTextField
        label={t("driverCreate.carModel")}
        value={car}
        onChangeText={onChangeCar}
        suggestions={savedValues.carModels}
        placeholder={t("driverCreate.enterCarModel")}
        icon="car-outline"
      />

      <AutocompleteTextField
        label={t("driverCreate.carColor")}
        value={carColor}
        onChangeText={onChangeCarColor}
        suggestions={savedValues.carColors}
        placeholder={t("driverCreate.enterCarColor")}
        icon="color-palette-outline"
      />

      <AutocompleteTextField
        label={t("driverCreate.carPlateNumber")}
        value={carPlate}
        onChangeText={onChangeCarPlate}
        suggestions={savedValues.plateNumbers}
        placeholder={t("driverCreate.enterCarPlateNumber")}
        icon="barcode-outline"
        keyboardType="number-pad"
        ltr
      />
    </View>
  );
}

const localStyles = {
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginBottom: 6,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "900" as const,
    color: "#111827",
  },
};
