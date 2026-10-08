/// <reference types="node" />
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // sumit-live hits the live SUMIT company. sumit-drain writes local rows.
  // Both stay on their own configs. CI points this suite at local Supabase
  // only when FLOW_E2E_SUPABASE_URL is the loopback API from `supabase start`.
  // *.test.ts files under e2e are vitest unit tests (vitest.config.ts), not Playwright tests.
  testIgnore: [/sumit-live/, /sumit-drain/, /storybook-/, /smoke-readonly/, /\.test\.ts$/],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:43123",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:43123",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: process.env.FLOW_E2E_SUPABASE_URL ?? "",
      VITE_SUPABASE_ANON_KEY: process.env.FLOW_E2E_SUPABASE_ANON_KEY ?? "",
      VITE_FLOW_MCP_URL: "https://example.com/functions/v1/flow-mcp",
    },
  },
});
