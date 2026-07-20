// ---------------------------------------------------------------------------
// InfiniteTimeWheelPicker — the ONE shared time wheel for the whole app.
// Two columns (hours, minutes) that each loop continuously in both
// directions: scrolling down past 23:55 reaches 00:00 with no visible stop,
// and scrolling up past 00:00 reaches 23:55 the same way.
//
// Implemented with the safe, dependency-free "repeated data list" trick
// (no native wheel library, nothing that can go stale/abandoned and break
// an EAS build): each column's base sequence (0-23 for hours, 0/5/10/... for
// minutes) is rendered several times back to back in a plain ScrollView.
// Landing near either end of that repeated list silently (no animation, no
// visible jump — the row content is identical) re-centers the scroll
// position back into the middle copy, so a normal flick can never actually
// reach a true start/end. See recenterIfNearEdge below.
//
// This component owns only the wheel UI + an uncommitted "draft" selection
// — it fires onChange live as the user settles on each new value (like a
// native picker), always as Western-digit "HH:MM" strings. Committing that
// as a saved value (vs. treating it as a live preview) is entirely up to
// the caller — see DateInput.tsx's TimeInput, which wraps this with a
// Confirm/Cancel modal and only calls ITS OWN onChange from Confirm.
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo, useRef } from "react";
import { NativeSyntheticEvent, NativeScrollEvent, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const ROW_HEIGHT = 46;
const VISIBLE_ROWS = 5;
// Copies of the base sequence rendered back to back, centered on the
// middle one — the buffer (copies on each side) a single flick would need
// to outrun to ever reach a true edge. 3 copies of buffer per side is far
// more than any realistic gesture covers.
const REPEAT_COUNT = 7;
const MIDDLE_COPY = Math.floor(REPEAT_COUNT / 2);

const pad2 = (value: number) => String(value).padStart(2, "0");

export type InfiniteTimeWheelPickerProps = {
  // "HH:mm", Western digits — the wheel centers on this when it (re)mounts
  // or when this value changes from OUTSIDE a user scroll (e.g. the caller
  // resets the draft on Cancel/reopen).
  value: string;
  // Fires with a new "HH:mm" every time the user settles the wheel on a
  // different value — a live draft, not necessarily a final save (see
  // file header).
  onChange: (value: string) => void;
  // Matches the app's existing default (5) when not overridden — pass 1 for
  // one-minute precision.
  minuteInterval?: number;
  disabled?: boolean;
  // Screen-specific restrictions ONLY — never disable the wheel globally
  // for one screen's rule. The wheel keeps looping/scrolling either way;
  // disabled rows just can't be tapped and are skipped on settle.
  isHourDisabled?: (hour: number) => boolean;
  isMinuteDisabled?: (hour: number, minute: number) => boolean;
};

function buildRepeated<T>(base: T[]): T[] {
  const out: T[] = [];
  for (let copy = 0; copy < REPEAT_COUNT; copy += 1) {
    out.push(...base);
  }
  return out;
}

type ColumnProps = {
  base: number[];
  selected: number;
  format: (value: number) => string;
  isDisabled: (value: number) => boolean;
  onSettle: (value: number) => void;
  disabled?: boolean;
};

function WheelColumn({ base, selected, format, isDisabled, onSettle, disabled }: ColumnProps) {
  const scrollRef = useRef<ScrollView>(null);
  const baseLength = base.length;
  const repeated = useMemo(() => buildRepeated(base), [base]);

  const indexOfValue = (value: number) => {
    const i = base.indexOf(value);
    return i === -1 ? 0 : i;
  };

  const middleIndexFor = (value: number) => MIDDLE_COPY * baseLength + indexOfValue(value);

  // Centers on `selected` whenever it changes from OUTSIDE a scroll (mount,
  // or the caller resetting the draft) — never fights an in-progress scroll
  // since this only re-runs when the prop itself changes.
  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: middleIndexFor(selected) * ROW_HEIGHT, animated: false });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const nearestEnabledFrom = (rawIndex: number) => {
    // Searches outward from rawIndex within the repeated list for the
    // closest non-disabled row, preferring the same direction the user was
    // already scrolling (forward first, matching the existing app's prior
    // behavior of "snap forward to the next valid slot").
    for (let offset = 0; offset < repeated.length; offset += 1) {
      const forward = rawIndex + offset;
      if (forward < repeated.length && !isDisabled(repeated[forward])) return forward;

      const backward = rawIndex - offset;
      if (backward >= 0 && !isDisabled(repeated[backward])) return backward;
    }
    return rawIndex;
  };

  const recenterIfNearEdge = (rawIndex: number) => {
    const safeMin = baseLength;
    const safeMax = repeated.length - baseLength - 1;

    if (rawIndex >= safeMin && rawIndex <= safeMax) return rawIndex;

    const valueIndex = ((rawIndex % baseLength) + baseLength) % baseLength;
    const recentered = MIDDLE_COPY * baseLength + valueIndex;

    scrollRef.current?.scrollTo({ y: recentered * ROW_HEIGHT, animated: false });
    return recentered;
  };

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const rawIndex = Math.round(event.nativeEvent.contentOffset.y / ROW_HEIGHT);
    const clamped = Math.max(0, Math.min(repeated.length - 1, rawIndex));

    const settledIndex = isDisabled(repeated[clamped]) ? nearestEnabledFrom(clamped) : clamped;

    if (settledIndex !== clamped) {
      scrollRef.current?.scrollTo({ y: settledIndex * ROW_HEIGHT, animated: true });
    }

    const finalIndex = recenterIfNearEdge(settledIndex);
    onSettle(repeated[finalIndex] ?? repeated[settledIndex]);
  };

  const handleSelectRow = (rowIndex: number) => {
    if (disabled || isDisabled(repeated[rowIndex])) return;

    scrollRef.current?.scrollTo({ y: rowIndex * ROW_HEIGHT, animated: true });
    onSettle(repeated[rowIndex]);
  };

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.column}
      contentContainerStyle={styles.columnContent}
      showsVerticalScrollIndicator={false}
      snapToInterval={ROW_HEIGHT}
      decelerationRate="fast"
      scrollEnabled={!disabled}
      onMomentumScrollEnd={handleScrollEnd}
      onScrollEndDrag={handleScrollEnd}
    >
      {repeated.map((rowValue, index) => {
        const rowDisabled = disabled || isDisabled(rowValue);
        const isCurrentlySelected = rowValue === selected;

        return (
          <Pressable
            key={index}
            disabled={rowDisabled}
            onPress={() => handleSelectRow(index)}
            style={[styles.cell, isCurrentlySelected && styles.cellSelected]}
          >
            <Text
              style={[
                styles.cellText,
                isCurrentlySelected && styles.cellTextSelected,
                rowDisabled && styles.cellTextDisabled,
              ]}
            >
              {format(rowValue)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export default function InfiniteTimeWheelPicker({
  value,
  onChange,
  minuteInterval = 5,
  disabled,
  isHourDisabled,
  isMinuteDisabled,
}: InfiniteTimeWheelPickerProps) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  const now = new Date();
  const selectedHour = match ? Number(match[1]) : now.getHours();
  const selectedMinuteRaw = match ? Number(match[2]) : now.getMinutes();

  const minutes = useMemo(() => {
    const step = Math.max(1, Math.min(30, Math.round(minuteInterval)));
    const list: number[] = [];
    for (let m = 0; m < 60; m += step) list.push(m);
    return list;
  }, [minuteInterval]);

  const selectedMinute = useMemo(() => {
    // Snaps an out-of-grid initial value (e.g. a device clock's minute that
    // isn't on the configured interval) to the nearest valid row.
    return minutes.reduce((closest, m) =>
      Math.abs(m - selectedMinuteRaw) < Math.abs(closest - selectedMinuteRaw) ? m : closest,
    );
  }, [minutes, selectedMinuteRaw]);

  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);

  return (
    <View style={styles.wrapper}>
      <View style={styles.columnsRow}>
        <WheelColumn
          base={hours}
          selected={selectedHour}
          format={pad2}
          disabled={disabled}
          isDisabled={(h) => !!isHourDisabled?.(h)}
          onSettle={(h) => onChange(`${pad2(h)}:${pad2(selectedMinute)}`)}
        />

        <Text style={styles.colon}>:</Text>

        <WheelColumn
          base={minutes}
          selected={selectedMinute}
          format={pad2}
          disabled={disabled}
          isDisabled={(m) => !!isMinuteDisabled?.(selectedHour, m)}
          onSettle={(m) => onChange(`${pad2(selectedHour)}:${pad2(m)}`)}
        />
      </View>

      <View pointerEvents="none" style={styles.selectionHighlight} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7DCD1",
    borderRadius: 18,
    position: "relative",
  },
  columnsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  column: {
    height: ROW_HEIGHT * VISIBLE_ROWS,
    width: 90,
  },
  // Pads the scrollable content itself (not the row around it) so the
  // first and last rendered row can each be scrolled all the way to the
  // centered selection slot.
  columnContent: {
    paddingVertical: (ROW_HEIGHT * (VISIBLE_ROWS - 1)) / 2,
  },
  colon: {
    fontSize: 24,
    fontWeight: "900",
    color: "#111827",
    marginHorizontal: 6,
  },
  cell: {
    height: ROW_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  cellSelected: {
    backgroundColor: "#FFF2E8",
    borderRadius: 12,
  },
  cellText: {
    fontSize: 20,
    fontWeight: "800",
    color: "#111827",
    // Always Western digits, laid out left-to-right, even on an RTL/Arabic
    // screen — see app/i18n/digits.ts's normalizeToWesternDigits (the
    // "HH:mm" values feeding this component are already normalized at the
    // source, this only guarantees the DIRECTION never mirrors).
    writingDirection: "ltr",
  },
  cellTextSelected: {
    color: "#F58220",
    fontWeight: "900",
  },
  cellTextDisabled: {
    color: "#D9CFC5",
  },
  selectionHighlight: {
    position: "absolute",
    left: 12,
    right: 12,
    top: (ROW_HEIGHT * VISIBLE_ROWS) / 2 - ROW_HEIGHT / 2,
    height: ROW_HEIGHT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#F1CBA5",
  },
});
