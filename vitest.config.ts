// ---------------------------------------------------------------------------
// Vitest config — deliberately narrow. This project's actual app code runs
// under Expo/Metro/Hermes, not Node, so this config only ever targets pure,
// framework-free TypeScript modules (e.g. app/booking/routeMatchLib.ts's
// algorithm functions) that are safe to run directly under Node. It is not
// a general React Native testing setup (no jest-expo/react-native preset,
// no component rendering) — see each *.test.ts file's own header for what
// it covers.
// ---------------------------------------------------------------------------

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", "cloudflare-worker/**", "takeme-admin-desktop/**"],
  },
});
