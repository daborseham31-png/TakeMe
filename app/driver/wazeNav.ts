import { Linking } from "react-native";

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
