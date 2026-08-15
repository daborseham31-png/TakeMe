// ---------------------------------------------------------------------------
// Web implementation of PlatformMapView (see that file's own header for why
// this split exists, and why it lives outside app/). Metro resolves THIS
// file instead of PlatformMapView.tsx whenever bundling for the web
// platform.
//
// A REAL, interactive map — Leaflet + OpenStreetMap tiles (free, no API key,
// no billing — react-native-maps itself doesn't require one either, so this
// keeps that property on Web). This is a from-scratch Web renderer, not a
// react-native-maps port, but it deliberately mirrors react-native-maps'
// own prop shapes (MapView: initialRegion/region/onPress/onPanDrag/ref;
// Marker: coordinate/draggable/onDragEnd/pinColor/title/description/anchor/
// children; Polyline: coordinates/strokeColor/strokeWidth/lineDashPattern)
// so every existing call site (PickupLocationPicker, roadside-help,
// live-tracking, job-navigation, ride-navigation) keeps working completely
// unchanged — only this one file differs from the native barrel.
//
// SSR SAFETY: `expo.web.output: "static"` pre-renders every route to HTML
// in Node.js (no DOM). Leaflet touches `window`/`document` as soon as it's
// imported, so this component renders nothing but an empty placeholder box
// until it has actually mounted in a real browser (the `mounted` gate
// below) — the map itself, and every Leaflet import, only ever executes
// client-side.
// ---------------------------------------------------------------------------

import { Ionicons } from "@expo/vector-icons";
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";

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

// react-native-maps expresses zoom as a lat/lng "delta" (degrees of visible
// span) rather than a slippy-map zoom level. Standard conversion: at zoom
// z, the whole 360°-wide world is covered in 2^z tiles, so a span of
// `longitudeDelta` degrees corresponds to z = log2(360 / longitudeDelta).
function deltaToZoom(longitudeDelta: number): number {
  if (!longitudeDelta || !isFinite(longitudeDelta) || longitudeDelta <= 0) return 15;
  const zoom = Math.log2(360 / longitudeDelta);
  return Math.max(2, Math.min(19, Math.round(zoom)));
}

function zoomToLongitudeDelta(zoom: number): number {
  return 360 / Math.pow(2, zoom);
}

// ---------------------------------------------------------------------------
// MapView
// ---------------------------------------------------------------------------

type MapViewProps = {
  style?: StyleProp<ViewStyle>;
  initialRegion?: Region;
  region?: Region;
  onPress?: (event: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => void;
  onPanDrag?: () => void;
  children?: React.ReactNode;
  [key: string]: any;
};

// Internal — lives inside <MapContainer>, where react-leaflet's map context
// (useMap/useMapEvents) is available. Wires up press/drag events and
// keeps a *controlled* `region` prop's center/zoom in sync (mirrors
// react-native-maps: `region` is controlled and re-centers on change,
// `initialRegion` only ever sets the starting view).
function MapController({
  region,
  onPress,
  onPanDrag,
  mapRef,
}: {
  region?: Region;
  onPress?: MapViewProps["onPress"];
  onPanDrag?: () => void;
  mapRef: React.MutableRefObject<any>;
}) {
  // Deferred require so this module (and the Leaflet CSS it needs) is only
  // ever touched client-side — see the SSR note at the top of this file.
  const { useMap, useMapEvents } = require("react-leaflet");

  const map = useMap();
  mapRef.current = map;

  useMapEvents({
    click(e: any) {
      onPress?.({ nativeEvent: { coordinate: { latitude: e.latlng.lat, longitude: e.latlng.lng } } });
    },
    dragstart() {
      onPanDrag?.();
    },
  });

  const lastRegionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!region) return;
    // Only re-center when the CONTROLLED region actually changed — avoids
    // fighting the user's own pan/zoom on every unrelated re-render.
    const key = `${region.latitude},${region.longitude},${region.latitudeDelta}`;
    if (lastRegionRef.current === key) return;
    lastRegionRef.current = key;
    map.setView([region.latitude, region.longitude], deltaToZoom(region.longitudeDelta));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region?.latitude, region?.longitude, region?.latitudeDelta]);

  return null;
}

const MapView = forwardRef<PlatformMapViewHandle, MapViewProps>(function MapView(
  { style, initialRegion, region, onPress, onPanDrag, children },
  ref,
) {
  const [mounted, setMounted] = useState(false);
  const leafletMapRef = useRef<any>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useImperativeHandle(ref, () => ({
    animateToRegion: (target, duration) => {
      const map = leafletMapRef.current;
      if (!map) return;
      map.flyTo([target.latitude, target.longitude], deltaToZoom(target.longitudeDelta), {
        duration: Math.max(0.1, (duration ?? 500) / 1000),
      });
    },
    fitToCoordinates: (coordinates, options) => {
      const map = leafletMapRef.current;
      if (!map || coordinates.length === 0) return;
      const { latLngBounds } = require("leaflet");
      const bounds = latLngBounds(coordinates.map((c) => [c.latitude, c.longitude]));
      const padding = (options?.edgePadding as any) || {};
      map.fitBounds(bounds, {
        paddingTopLeft: [padding.left ?? 40, padding.top ?? 40],
        paddingBottomRight: [padding.right ?? 40, padding.bottom ?? 40],
      });
    },
  }));

  const startRegion = region || initialRegion;

  if (!mounted || !startRegion) {
    return <View style={[styles.container, style]} />;
  }

  // Required so Metro's web CSS support picks it up — Leaflet's tile/marker
  // positioning is broken without it. Safe to import repeatedly (module
  // cache dedupes it); only ever reached client-side, after `mounted`.
  require("leaflet/dist/leaflet.css");
  const { MapContainer, TileLayer } = require("react-leaflet");

  return (
    <View style={[styles.container, style]}>
      <MapContainer
        center={[startRegion.latitude, startRegion.longitude]}
        zoom={deltaToZoom(startRegion.longitudeDelta)}
        style={{ width: "100%", height: "100%" }}
        // Matches the "no attribution control clutter on a small embedded
        // map" look of the native SDKs' own attribution badge; OSM's
        // license still requires attribution, so it's kept, just unobtrusive.
        attributionControl={true}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        <MapController region={region} onPress={onPress} onPanDrag={onPanDrag} mapRef={leafletMapRef} />
        {children}
      </MapContainer>
    </View>
  );
});

export default MapView;

// ---------------------------------------------------------------------------
// Marker
// ---------------------------------------------------------------------------

type MarkerProps = {
  coordinate: { latitude: number; longitude: number };
  draggable?: boolean;
  onDragEnd?: (event: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => void;
  pinColor?: string;
  title?: string;
  description?: string;
  anchor?: { x: number; y: number };
  children?: React.ReactNode;
  [key: string]: any;
};

// Simple teardrop pin (matches the default marker silhouette every native
// map SDK uses) rendered as inline SVG — no external icon image files, so
// there's nothing for a bundler to mis-resolve (the classic Leaflet +
// bundler "broken marker icon" issue).
function pinSvgHtml(color: string): string {
  return `<svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg">
    <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 27 15 27s15-16.5 15-27C30 6.7 23.3 0 15 0z" fill="${color}"/>
    <circle cx="15" cy="15" r="6" fill="#FFFFFF"/>
  </svg>`;
}

export function Marker({
  coordinate,
  draggable,
  onDragEnd,
  pinColor,
  title,
  description,
  anchor,
  children,
}: MarkerProps) {
  const { Marker: RLMarker, Popup } = require("react-leaflet");
  const L = require("leaflet");
  const markerInstanceRef = useRef<any>(null);
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);

  const icon = useMemo(() => {
    if (children) {
      // Empty div sized 1x1 — its real content is portaled in below, once
      // Leaflet has actually created the DOM node for it. anchor defaults
      // to react-native-maps' own default (0.5, 1.0 — bottom-center);
      // callers that need center-anchoring (e.g. a live driver dot) pass
      // anchor={{x:0.5,y:0.5}} same as they already do on native.
      const ax = anchor?.x ?? 0.5;
      const ay = anchor?.y ?? 1;
      return L.divIcon({
        html: '<div class="rnw-marker-portal" style="display:inline-block"></div>',
        className: "rnw-marker-icon-wrap",
        iconSize: [1, 1],
        iconAnchor: [1 * ax, 1 * ay],
      });
    }
    return L.divIcon({
      html: pinSvgHtml(pinColor || "#F58220"),
      className: "rnw-marker-icon-wrap",
      iconSize: [30, 42],
      iconAnchor: [15, 42],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children, pinColor, anchor?.x, anchor?.y]);

  return (
    <RLMarker
      position={[coordinate.latitude, coordinate.longitude]}
      icon={icon}
      draggable={!!draggable}
      eventHandlers={{
        add: (e: any) => {
          markerInstanceRef.current = e.target;
          if (children) setPortalNode(e.target.getElement());
        },
        dragend: (e: any) => {
          const pos = e.target.getLatLng();
          onDragEnd?.({ nativeEvent: { coordinate: { latitude: pos.lat, longitude: pos.lng } } });
        },
      }}
    >
      {(title || description) ? (
        <Popup>
          {title ? <b>{title}</b> : null}
          {title && description ? <br /> : null}
          {description || null}
        </Popup>
      ) : null}
      {children && portalNode ? createPortal(children, portalNode) : null}
    </RLMarker>
  );
}

// ---------------------------------------------------------------------------
// Polyline
// ---------------------------------------------------------------------------

type PolylineProps = {
  coordinates: { latitude: number; longitude: number }[];
  strokeColor?: string;
  strokeWidth?: number;
  lineDashPattern?: number[];
  [key: string]: any;
};

export function Polyline({ coordinates, strokeColor, strokeWidth, lineDashPattern }: PolylineProps) {
  const { Polyline: RLPolyline } = require("react-leaflet");

  if (!coordinates || coordinates.length === 0) return null;

  return (
    <RLPolyline
      positions={coordinates.map((c) => [c.latitude, c.longitude])}
      pathOptions={{
        color: strokeColor || "#F58220",
        weight: strokeWidth ?? 3,
        dashArray: lineDashPattern ? lineDashPattern.join(",") : undefined,
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F1EAE1",
    overflow: "hidden",
  },
});
