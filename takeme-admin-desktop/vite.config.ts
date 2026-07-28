import react from "@vitejs/plugin-react";
import { transform } from "esbuild";
import path from "path";
import { defineConfig, loadEnv, Plugin } from "vite";

import pkg from "./package.json";

// @expo/vector-icons ships un-transpiled JSX inside a plain .js file
// (build/createIconSet.js) — valid for Metro (which treats every .js file as
// potentially containing JSX) but not for Vite/Rollup's default pipeline,
// which fails to even parse it before any other plugin's transform hook
// runs. This runs first (enforce: "pre") and JSX-transforms just that one
// package's files, leaving every other file's normal loader untouched.
function expoVectorIconsJsxFix(): Plugin {
  return {
    name: "expo-vector-icons-jsx-fix",
    enforce: "pre",
    async transform(code, id) {
      if (!id.includes("@expo/vector-icons") || !id.endsWith(".js")) return null;
      // Every file in this package's build/ dir ends with a
      // //# sourceMappingURL=X.js.map comment pointing at a map Rollup can't
      // always resolve once the file goes through an extra transform pass —
      // strip it so nothing tries to chase that reference.
      const stripped = code.replace(/\/\/# sourceMappingURL=.*$/m, "");
      const result = await transform(stripped, { loader: "jsx", jsx: "automatic" });
      return { code: result.code, map: null };
    },
  };
}

// React Native Web setup: alias `react-native` to `react-native-web` so every
// admin file/component copied verbatim from the mobile app (which imports
// from "react-native") resolves to the web implementation, and prefer
// `.web.ts(x)` variants when present (react-native-web's own convention).
export default defineConfig(({ mode }) => {
  // loadEnv's third arg "" (not the default "VITE_") loads EVERY key from
  // .env, not just VITE_-prefixed ones — needed because the copied
  // schoolKioskLinks.ts reads process.env.EXPO_PUBLIC_BACKEND_URL verbatim
  // (Expo's naming convention, not Vite's), and that file is intentionally
  // left unmodified rather than rewritten to fit Vite's own convention.
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [expoVectorIconsJsxFix(), react({ include: /\.(jsx|js|tsx|ts)$/ })],
    base: "./",
    resolve: {
      alias: [
        { find: /^react-native$/, replacement: "react-native-web" },
        // See src/shims/expoFontWeb.ts — replaces the whole package (its real
        // web implementation depends on Expo's native-module runtime, which
        // doesn't exist outside an Expo-CLI build).
        { find: /^expo-font$/, replacement: path.resolve(__dirname, "src/shims/expoFontWeb.ts") },
        { find: "@", replacement: path.resolve(__dirname, "src") },
      ],
      extensions: [
        ".web.tsx",
        ".web.ts",
        ".web.jsx",
        ".web.js",
        ".tsx",
        ".ts",
        ".jsx",
        ".js",
        ".json",
      ],
    },
    define: {
      global: "window",
      __DEV__: JSON.stringify(process.env.NODE_ENV !== "production"),
      __APP_VERSION__: JSON.stringify(pkg.version),
      // expo-modules-core (pulled in transitively by @expo/vector-icons)
      // reads process.env.EXPO_OS, normally injected by babel-preset-expo
      // during an Expo-CLI build. This isn't an Expo-CLI project, so nothing
      // injects it — without this define, the bare reference to `process`
      // throws ReferenceError in this browser bundle (there's no Node
      // `process` global here at all). "web" is the correct value: it makes
      // expo-modules-core's own `process.env.EXPO_OS === "web"` checks match
      // reality for a react-native-web/Electron renderer.
      "process.env.EXPO_OS": JSON.stringify("web"),
      // schoolKioskLinks.ts (copied verbatim from the mobile app) reads
      // process.env.EXPO_PUBLIC_BACKEND_URL for the School Kiosk Links
      // screen. Sourced from this project's own .env (see .env.example) via
      // loadEnv above — falls back to "" (the same "not configured" state
      // the mobile app shows) if no .env is present.
      "process.env.EXPO_PUBLIC_BACKEND_URL": JSON.stringify(env.EXPO_PUBLIC_BACKEND_URL || ""),
    },
    optimizeDeps: {
      esbuildOptions: {
        loader: { ".js": "jsx" },
        resolveExtensions: [
          ".web.tsx",
          ".web.ts",
          ".web.jsx",
          ".web.js",
          ".tsx",
          ".ts",
          ".jsx",
          ".js",
        ],
      },
      include: ["react-native-web"],
    },
    server: {
      port: 5173,
      strictPort: true,
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
