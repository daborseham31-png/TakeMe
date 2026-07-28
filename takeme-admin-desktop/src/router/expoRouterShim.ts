// ---------------------------------------------------------------------------
// Drop-in replacement for the two expo-router imports every copied admin
// screen uses: the imperative `router` singleton (`router.push/replace/back`)
// and the `useLocalSearchParams()` hook. Every copied file keeps its
// original call sites (`router.push(...)`, `useLocalSearchParams()`)
// unchanged — only the import line is repointed here, at
// `import { router, useLocalSearchParams } from "../../router/expoRouterShim"`.
//
// React Router v6 doesn't expose a bare importable `navigate` outside a
// component by default, so this creates one real `history` object at module
// scope and drives the router from it via `unstable_HistoryRouter` (see
// src/router/AppRouter.tsx) — the officially supported way to get an
// imperative navigate that also works outside React.
//
// Uses createHashHistory, not createBrowserHistory: the packaged app loads
// index.html via win.loadFile(), which sets window.location to the full
// filesystem path (file:///C:/.../resources/app.asar/dist/index.html) —
// createBrowserHistory matches routes against that real pathname, which
// never equals "/" or "/admin", so every <Route> silently fails to match
// and the app renders nothing (confirmed: this was the actual blank-window
// cause — LanguageProvider still initializes fine since it doesn't depend
// on routing at all, which is why its own console logs kept appearing even
// though no screen was ever mounted). Hash-based routing keeps the real
// file:// location untouched and matches purely against the #fragment
// (e.g. file:///.../index.html#/admin), which works identically whether
// the app is loaded from a dev server, a plain file, or inside an asar.
import { createHashHistory } from "history";
import { useParams } from "react-router-dom";

export const appHistory = createHashHistory();

export const router = {
  push: (path: string) => appHistory.push(path),
  replace: (path: string) => appHistory.replace(path),
  back: () => appHistory.back(),
};

// expo-router's useLocalSearchParams() returns Record<string, string | string[]>;
// react-router's useParams() returns Readonly<Params<string>>
// (Record<string, string | undefined>) — every admin screen only ever reads
// a single named segment as a plain string (e.g. `String(params.id || "")`),
// so the shapes are compatible for every existing call site.
export const useLocalSearchParams = () => useParams();
