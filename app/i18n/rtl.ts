// ---------------------------------------------------------------------------
// Centralized direction-aware style helpers. React Native's automatic RTL
// mirroring (I18nManager) only covers a few native primitives (Yoga flips
// `flexDirection: "row"`, and RN's own `marginStart`/`marginEnd`/`start`/`end`
// logical properties) — plain `marginLeft`/`marginRight`, `paddingLeft`/
// `paddingRight`, `borderLeftWidth`/`borderRightWidth`, and absolute
// `left`/`right` positioning are NOT auto-flipped. Every screen that needs
// one of those must go through a helper here instead of re-deriving
// `language === "ar" || language === "he"` (or worse, hardcoding one side)
// itself — one central place to get this right, reused everywhere.
//
// Every helper takes `isRTL` as a plain argument (from useLanguage().isRTL)
// rather than reading language state itself, so these stay pure, easily
// testable, and usable both inside components and inside plain style
// objects built at render time.
// ---------------------------------------------------------------------------

// "start" = right in RTL, left in LTR (how reading order begins).
// "end" = left in RTL, right in LTR (how reading order finishes).
export function directionalTextAlign(
  isRTL: boolean,
  edge: "start" | "end" = "start",
): "left" | "right" {
  const startsRight = edge === "start" ? isRTL : !isRTL;
  return startsRight ? "right" : "left";
}

// A row whose children must read in logical start→end order — mirrors to
// row-reverse in RTL. Only use this for a row you build/order yourself;
// never wrap something that already relies on RN's native auto-mirroring.
export function directionalRow(isRTL: boolean): "row" | "row-reverse" {
  return isRTL ? "row-reverse" : "row";
}

// `value` accepts a percentage string (e.g. "26%") as well as a number of
// points — both are valid React Native margin/padding/position values (used,
// for example, to center a lone wrapped grid item via a percentage margin).
// Deliberately `${number}%` (matching RN's own DimensionValue), not a plain
// `string` — a plain string would make TS accept literally any string here
// while also making every existing plain-number call site fail to typecheck.
type SpacingValue = number | `${number}%`;

export function marginStart(value: SpacingValue, isRTL: boolean) {
  return isRTL ? { marginRight: value } : { marginLeft: value };
}

export function marginEnd(value: SpacingValue, isRTL: boolean) {
  return isRTL ? { marginLeft: value } : { marginRight: value };
}

export function paddingStart(value: SpacingValue, isRTL: boolean) {
  return isRTL ? { paddingRight: value } : { paddingLeft: value };
}

export function paddingEnd(value: SpacingValue, isRTL: boolean) {
  return isRTL ? { paddingLeft: value } : { paddingRight: value };
}

// Absolute-positioning helpers — e.g. a badge/close button/floating action
// pinned to one edge of its parent.
export function positionStart(value: SpacingValue, isRTL: boolean) {
  return isRTL ? { right: value } : { left: value };
}

export function positionEnd(value: SpacingValue, isRTL: boolean) {
  return isRTL ? { left: value } : { right: value };
}

// A modal's own "X" close button conventionally sits at the top corner
// pointing away from the reading direction — top-right in LTR, top-left in
// RTL. A thin, semantically-named alias over positionEnd/positionStart so a
// modal header doesn't have to re-derive which one it means.
export function modalCloseButtonPosition(value: SpacingValue, isRTL: boolean) {
  return positionEnd(value, isRTL);
}

// A colored accent stripe (e.g. a booking card's category color) that should
// sit on the logical "start" edge of a card.
export function accentBorderStart(width: number, color: string, isRTL: boolean) {
  return isRTL
    ? { borderRightWidth: width, borderRightColor: color }
    : { borderLeftWidth: width, borderLeftColor: color };
}

// "Push to the end" — the `marginLeft: "auto"` pattern used to shove one
// item (a delete icon, a status dot) to the far side of a row.
export function pushToEnd(isRTL: boolean) {
  return isRTL ? { marginRight: "auto" as const } : { marginLeft: "auto" as const };
}

// Back/forward chevron pair — "back" always visually points toward where
// the previous screen actually is: left in LTR, right in RTL.
export function backIconName(isRTL: boolean): "arrow-back" | "arrow-forward" {
  return isRTL ? "arrow-forward" : "arrow-back";
}

// Disclosure/"view more" chevron — always visually points toward more
// content in the current reading direction: right in LTR, left in RTL.
export function chevronForwardIconName(isRTL: boolean): "chevron-forward" | "chevron-back" {
  return isRTL ? "chevron-back" : "chevron-forward";
}

// Keeps a value that must NEVER visually reverse (verification codes,
// permanent student codes, phone numbers, plate numbers, prices, GPS
// coordinates) reading in normal left-to-right order even while an
// ancestor's writing direction is RTL. Spread this into a Text style
// alongside any other styles — e.g.
// <Text style={[styles.code, ltrContentStyle]}>{code}</Text>
export const ltrContentStyle = {
  writingDirection: "ltr" as const,
  textAlign: "left" as const,
};
