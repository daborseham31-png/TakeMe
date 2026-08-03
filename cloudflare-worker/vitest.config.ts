// ---------------------------------------------------------------------------
// Vitest config for this Worker's own tests — deliberately separate from the
// root project's vitest.config.ts (which explicitly excludes
// cloudflare-worker/**, since ITS scope is Expo/RN-free pure TS only). This
// Worker's code is plain TS against the fetch/Web Crypto APIs, which Node's
// "node" test environment already provides natively, so no Workers-specific
// runtime (e.g. @cloudflare/vitest-pool-workers) is needed for the pure
// logic + mocked-fetch tests in src/*.test.ts.
// ---------------------------------------------------------------------------

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
