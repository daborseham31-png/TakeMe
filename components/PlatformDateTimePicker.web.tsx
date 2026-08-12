// ---------------------------------------------------------------------------
// Web fallback for PlatformDateTimePicker (see that file's header — the real
// @react-native-community/datetimepicker has no web build at all). Metro
// resolves THIS file instead of PlatformDateTimePicker.tsx when bundling for
// the web platform.
//
// Renders a native browser <input type="date"> so the two current call
// sites (app/driver/create/DateInput.tsx, app/(tabs)/bookings.tsx) keep the
// exact same value/onChange contract as the real component
// (onChange(event, selectedDate)) without any change to their own state,
// validation, or formatting logic.
// ---------------------------------------------------------------------------

import React from "react";
import { View } from "react-native";

type Props = {
  value: Date;
  mode?: "date" | "time" | "datetime";
  display?: string;
  minimumDate?: Date;
  maximumDate?: Date;
  onChange?: (event: { type: string }, selectedDate?: Date) => void;
  style?: any;
};

function toYMD(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromYMD(raw: string) {
  const [y, m, d] = raw.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export default function PlatformDateTimePicker({
  value,
  minimumDate,
  maximumDate,
  onChange,
  style,
}: Props) {
  return (
    <View style={style}>
      <input
        type="date"
        value={toYMD(value)}
        min={minimumDate ? toYMD(minimumDate) : undefined}
        max={maximumDate ? toYMD(maximumDate) : undefined}
        onChange={(event) => {
          const raw = event.target.value;
          if (!raw) return;
          onChange?.({ type: "set" }, fromYMD(raw));
        }}
        style={{
          fontSize: 16,
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid #E2D8CF",
          color: "#111827",
          fontFamily: "inherit",
          width: "100%",
          boxSizing: "border-box",
        }}
      />
    </View>
  );
}
