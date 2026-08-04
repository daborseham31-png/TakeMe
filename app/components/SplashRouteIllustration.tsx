// ---------------------------------------------------------------------------
// The splash screen's car → route → destination illustration (see
// app/index.tsx's AppStartScreen). Drawn as scalable vector art rather than
// a bundled PNG specifically so it has a genuinely transparent background —
// no rectangular image bounds, no white/light backing box to matte out, and
// it scales crisply at any screen size instead of being raster-scaled.
// Colors are deliberately pulled straight from this screen's own existing
// palette (styles.splash.backgroundColor, styles.tagline's taupe) rather
// than introduced fresh, so the illustration reads as part of the same
// design rather than a pasted-in sticker.
// ---------------------------------------------------------------------------

import React from "react";
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from "react-native-svg";

// Matches styles.splash.backgroundColor in app/index.tsx exactly — the pin's
// "hole" is punched in this color so it reads as a real cutout showing the
// page behind it, not a separate white circle sitting on top.
const SPLASH_BACKGROUND = "#FFF9F2";
const ROUTE_LINE = "#8A6F58"; // Same taupe as styles.tagline, ties the line art to the existing text color.
const CAR_RED = "#E8412E";
const CAR_RED_DARK = "#C42F20";
const WINDOW_BLUE = "#BFD8E8";
const WHEEL_DARK = "#3A3A3A";
const WHEEL_HUB = "#C7C7C7";
const GROUND_SHADOW = "#8A6F58";

export type SplashRouteIllustrationProps = {
  width: number;
  height: number;
};

export default function SplashRouteIllustration({ width, height }: SplashRouteIllustrationProps) {
  return (
    <Svg width={width} height={height} viewBox="0 0 400 240" fill="none">
      {/* Soft ground shadows under the car and the pin — the same trick a
          designer would use to "seat" a flat illustration into a page
          instead of letting it float, without needing any raster shading. */}
      <Ellipse cx={88} cy={214} rx={62} ry={7} fill={GROUND_SHADOW} opacity={0.12} />
      <Ellipse cx={345} cy={192} rx={16} ry={4} fill={GROUND_SHADOW} opacity={0.18} />

      {/* Dashed route trailing from the car up into a loose flourish and
          across to the destination dot — deliberately hand-drawn rather
          than a straight line, echoing the looping route line in the
          reference art without literally tracing it. */}
      <Path
        d="M158,178 C205,168 205,120 165,110 C130,102 118,140 152,148 C186,156 218,120 255,112 C300,102 335,110 345,150 C348,162 347,174 345,185"
        stroke={ROUTE_LINE}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray="7,8"
        fill="none"
      />

      {/* Small ground point the route arrives at, directly beneath the pin. */}
      <Circle cx={345} cy={185} r={4} fill={ROUTE_LINE} />

      {/* Car — flat, two-tier silhouette (lower body + cabin bump), same
          red family as the pin so the whole illustration reads as one
          cohesive icon rather than two unrelated assets. */}
      <G>
        <Line x1={118} y1={118} x2={128} y2={100} stroke={WHEEL_DARK} strokeWidth={3} strokeLinecap="round" />
        <Rect x={15} y={150} width={140} height={42} rx={18} fill={CAR_RED} />
        <Rect x={55} y={118} width={68} height={45} rx={20} fill={CAR_RED} />
        <Path d="M15,178 h140 v10 a4,4 0 0 1 -4,4 h-132 a4,4 0 0 1 -4,-4 z" fill={CAR_RED_DARK} opacity={0.35} />
        <Rect x={66} y={128} width={46} height={24} rx={8} fill={WINDOW_BLUE} />

        <Circle cx={48} cy={196} r={19} fill={WHEEL_DARK} />
        <Circle cx={48} cy={196} r={7} fill={WHEEL_HUB} />
        <Circle cx={128} cy={196} r={19} fill={WHEEL_DARK} />
        <Circle cx={128} cy={196} r={7} fill={WHEEL_HUB} />
      </G>

      {/* Destination pin — classic rounded-teardrop marker, with the "hole"
          punched in the splash screen's own background color so it looks
          like a real cutout rather than a flat white circle. */}
      <G transform="translate(345,180) scale(1.7) translate(-12,-22)">
        <Path
          d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
          fill={CAR_RED}
        />
        <Circle cx={12} cy={9} r={2.6} fill={SPLASH_BACKGROUND} />
      </G>
    </Svg>
  );
}
