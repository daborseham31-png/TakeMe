// ---------------------------------------------------------------------------
// Shared color/spacing constants for the Admin Dashboard. The rest of the app
// inlines these hex values per-screen (no existing theme file to reuse), so
// this file exists purely to stop the admin section from re-typing them in
// every screen. Values match the app's existing palette exactly.
// ---------------------------------------------------------------------------

export const adminColors = {
  page: "#FBF7F1",
  card: "#FFFFFF",
  border: "#E7DCD1",
  borderStrong: "#E2D8CF",
  primary: "#F58220",
  primaryDark: "#B86115",
  text: "#111827",
  textMuted: "#7C5F46",
  placeholder: "#8B7B6B",
  success: "#16A34A",
  successBg: "#E7F7EC",
  danger: "#DC2626",
  dangerBg: "#FDECEC",
  warning: "#B86115",
  warningBg: "#FFF2E8",
  info: "#2563EB",
  infoBg: "#EFF6FF",
  divider: "#F0E5DC",
};

export const adminSpacing = {
  xs: 4,
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
};

export const adminRadius = {
  sm: 10,
  md: 14,
  lg: 18,
  pill: 999,
};
