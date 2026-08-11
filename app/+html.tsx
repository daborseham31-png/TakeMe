// ---------------------------------------------------------------------------
// Root HTML document for Web static rendering (Expo Router "+html" — see
// https://docs.expo.dev/router/reference/static-rendering/#root-html). Only
// runs in Node.js at export time — no DOM/browser APIs here.
//
// This file exists to make the hosted Web build installable as a PWA
// (Add to Home Screen on iOS Safari, Install on Android Chrome) — see
// public/manifest.json for the actual manifest content and
// public/icon-*.png / apple-touch-icon.png for the icons. Everything below
// the PWA-specific block is a faithful copy of Expo's own default template
// (node_modules/expo/node_modules/@expo/cli/static/template/+html.tsx) so
// existing behavior (style reset, viewport) is unchanged.
// ---------------------------------------------------------------------------

import { ScrollViewStyleReset } from "expo-router/html";

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* viewport-fit=cover is required for env(safe-area-inset-*) to
            resolve to a real, non-zero value on iOS Safari/PWA (otherwise
            every safe-area-inset-* always computes to 0) — see
            app/(tabs)/_layout.tsx's CustomTabBar, which already applies
            insets.bottom via react-native-safe-area-context's Web
            implementation (reads this same env() value) but was silently
            getting 0 without this. */}
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
        <title>TakeMe</title>

        {/*
          Disable body scrolling on web. This makes ScrollView components work closer to how they do on native.
        */}
        <ScrollViewStyleReset />

        {/* --- PWA: installable "Add to Home Screen" / "Install app" --- */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#F58220" />

        {/* Android/Chrome + the modern cross-browser equivalent. */}
        <meta name="mobile-web-app-capable" content="yes" />

        {/* iOS Safari doesn't reliably read manifest.json for "Add to Home
            Screen" — these Apple-specific tags are what actually control
            the standalone launch mode, home-screen name, and status bar. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="TakeMe" />
        {/* "default" (not "black-translucent") keeps the OS reserving space
            for the status bar automatically, so content never renders
            underneath the notch/status bar without this app needing its own
            safe-area-inset CSS. */}
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body>{children}</body>
    </html>
  );
}
