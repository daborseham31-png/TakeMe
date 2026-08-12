// ---------------------------------------------------------------------------
// Cross-platform MapView barrel — the ONE place every screen that needs a
// map imports MapView/Marker/Polyline from, instead of "react-native-maps"
// directly.
//
// Lives OUTSIDE app/ deliberately: Expo Router's require.context sweeps
// every .tsx file directly under app/ by its exact path (to build the route
// manifest), which bypasses Metro's platform-extension resolution and would
// still require the native file even when bundling for web. Keeping this
// pair in the top-level components/ directory (already used for other
// non-route, platform-specific files like components/ui/icon-symbol.ios.tsx)
// avoids that entirely.
//
// On native (iOS/Android) this file is a TRIVIAL re-export of the real
// react-native-maps components — zero behavior change, same component
// identity, so existing refs (mapRef.current?.animateToRegion(...) /
// .fitToCoordinates(...)) keep working exactly as before.
//
// On Web, Metro's platform-extension resolution picks PlatformMapView.web.tsx
// instead (see that file's own header) — react-native-maps has NO web build
// at all (confirmed: zero .web.* files in the package, no browser field),
// so importing it directly breaks `expo export --platform web` outright
// (reproduced: "Importing native-only module... on web from:
// react-native-maps\lib\MapMarkerNativeComponent.js"). This split is what
// keeps the native map experience completely untouched while still letting
// the web bundle build.
// ---------------------------------------------------------------------------

import MapView, { Marker, Polyline, Region } from "react-native-maps";

export { Marker, Polyline };
export type { Region };
export default MapView;
