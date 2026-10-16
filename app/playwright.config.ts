/// <reference types="node" />
import { defineConfig, devices } from "@playwright/test";

// FLOW_E2E_PORT moves the served build off 43123 (a parallel run on this host needs its own port).
const port = process.env.FLOW_E2E_PORT ?? "43123";

export default defineConfig({
  testDir: "./e2e",
  // sumit-live hits the live SUMIT company. sumit-drain writes local rows.
  // Both stay on their own configs. CI points this suite at local Supabase
  // only when FLOW_E2E_SUPABASE_URL is the loopback API from `supabase start`.
  // *.test.ts files under e2e are vitest unit tests (vitest.config.ts), not Playwright tests.
  testIgnore: [/sumit-live/, /sumit-drain/, /storybook-/, /smoke-readonly/, /\.test\.ts$/],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${port}`,
  },
  webServer: {
    // A bundled development build (DEV routes, React's development build) served from disk. Each
    // test opens a fresh page, and the dev server's ~250 module requests cost 1.6 s a page; the
    // bundle loads in 0.7 s. The build takes about 12 s, once per run.
    command:
      `pnpm exec vite build --mode development --outDir node_modules/.e2e-dist --emptyOutDir --logLevel error && node ../scripts/serve-dist.mjs node_modules/.e2e-dist ${port}`,
    url: `http://127.0.0.1:${port}`,
    // The gate (scripts/local-ci.sh) never reuses a server on the port: it may hold an old build.
    reuseExistingServer: !process.env.CI && !process.env.FLOW_E2E_FRESH_SERVER,
    timeout: 120_000,
    env: {
      NODE_ENV: "development",
      // No service worker and unminified CSS, as on the dev server (vite.config.ts).
      FLOW_E2E_BUILD: "1",
      VITE_SUPABASE_URL: process.env.FLOW_E2E_SUPABASE_URL ?? "",
      VITE_SUPABASE_ANON_KEY: process.env.FLOW_E2E_SUPABASE_ANON_KEY ?? "",
      VITE_FLOW_MCP_URL: "https://example.com/functions/v1/flow-mcp",
    },
  },
});
