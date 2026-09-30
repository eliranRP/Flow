/// <reference types="node" />
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // sumit-live hits the live SUMIT company. sumit-drain writes local rows.
  // Both stay on their own configs. CI points this suite at local Supabase
  // only when FLOW_E2E_SUPABASE_URL is the loopback API from `supabase start`.
  testIgnore: [/sumit-live/, /sumit-drain/, /storybook-/],
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
    },
  },
});
