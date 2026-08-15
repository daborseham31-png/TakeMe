import { Linking, Platform } from "react-native";

// Waze's own `waze://` scheme is the only reliable way to land directly on
// turn-by-turn navigation to a specific point. The `https://waze.com/ul`
// universal link this replaced would sometimes just open Waze to its default
// map with no destination/route at all — the hand-off from a plain web link
// into the app (carrying the destination along with it) isn't guaranteed the
// way opening the app's own scheme directly is.
//
// Mirrors bitPayment.ts's tryOpenBit: canOpenURL can return false, or throw,
// on some OEMs even when Waze IS installed — so this always falls through to
// a direct openURL attempt on the scheme before giving up and using the
// universal link (which also doubles as the "install Waze" fallback) as a
// last resort.
export const openWazeNavigation = async (lat: number, lng: number): Promise<void> => {
  const scheme = `waze://?ll=${lat},${lng}&navigate=yes`;
  const universal = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;

  // Web-only: react-native-web's Linking.canOpenURL() always resolves true
  // regardless of the URL, and openURL() just calls window.open(), which
  // does not throw for a scheme ("waze://") the browser has no handler
  // for — it silently does nothing. Left unguarded, the native-only logic
  // below would report "opened" after the very first (no-op) attempt and
  // return immediately, skipping the universal HTTPS link entirely — a
  // driver tapping Navigate on Web got nothing at all: no Waze, no
  // fallback, no error. There's no reliable way to detect real scheme
  // success on Web, so go straight to the one link that's actually honest
  // and functional in a browser (same universal link the native fallback
  // already uses when Waze isn't installed).
  if (Platform.OS === "web") {
    await Linking.openURL(universal);
    return;
  }

  try {
    const canOpen = await Linking.canOpenURL(scheme);
    if (canOpen) {
      await Linking.openURL(scheme);
      return;
    }
  } catch {
    // fall through
  }

  try {
    await Linking.openURL(scheme);
    return;
  } catch {
    // Waze isn't installed (or the scheme is blocked) — fall back to the
    // universal web link.
  }

  await Linking.openURL(universal);
};
