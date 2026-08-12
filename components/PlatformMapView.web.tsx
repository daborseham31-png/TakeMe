// ---------------------------------------------------------------------------
// Web fallback for PlatformMapView (see that file's own header for why this
// split exists, and why it lives outside app/). Metro resolves THIS file
// instead of PlatformMapView.tsx whenever bundling for the web platform.
//
// Renders a simple, honest "map preview not available" box rather than a
// half-working reimplementation of native maps — every screen that uses a
// map already shows the relevant address/ETA/status as plain text elsewhere
// on the same screen (confirmed per call site), so nothing here needs to
// duplicate that.
//
// Marker/Polyline are re-exported as no-op components (render nothing) so
// every existing call site's JSX — <PlatformMapView>...<Marker/>...
// </PlatformMapView> — keeps compiling completely unchanged; the map
// surface here just doesn't plot them. The ref exposes the same imperative
// methods real call sites use (animateToRegion, fitToCoordinates) as
// harmless no-ops, so calling them on Web never throws.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import React, { forwardRef, useImperativeHandle } from "react";
import { StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";

export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export type PlatformMapViewHandle = {
  animateToRegion: (region: Region, duration?: number) => void;
  fitToCoordinates: (
    coordinates: { latitude: number; longitude: number }[],
    options?: Record<string, unknown>,
  ) => void;
};

type Props = {
  style?: StyleProp<ViewStyle>;
  // Optional override for the fallback text — every current call site uses
  // the default (see below), since each already shows the relevant address/
  // ETA elsewhere on the same screen; kept as an escape hatch for a future
  // screen that doesn't.
  message?: string;
  children?: React.ReactNode;
  // Every other react-native-maps prop (initialRegion, region, onPress,
  // onPanDrag, ...) is accepted and silently ignored on Web — there is no
  // map surface here to apply them to.
  [key: string]: any;
};

const PlatformMapView = forwardRef<PlatformMapViewHandle, Props>(
  function PlatformMapView({ style, message }, ref) {
    const { t } = useTranslation();

    useImperativeHandle(ref, () => ({
      animateToRegion: () => {},
      fitToCoordinates: () => {},
    }));

    return (
      <View style={[styles.container, style]}>
        <Ionicons name="map-outline" size={30} color="#B8A897" />
        <Text style={styles.text}>{message || t("common.mapPreviewUnavailableWeb")}</Text>
      </View>
    );
  },
);

export default PlatformMapView;

export function Marker() {
  return null;
}

export function Polyline() {
  return null;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F1EAE1",
    padding: 24,
    gap: 10,
  },
  text: {
    color: "#7C5F46",
    fontWeight: "700",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
});
