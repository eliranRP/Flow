import { defineConfig, devices } from "@playwright/test";

/** Production bundle, pointed at the local stack that syncs the live SUMIT test company. */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /sumit-live/,
  timeout: 360_000,
  expect: { timeout: 20_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:43124",
  },
  webServer: {
    command: "pnpm exec vite preview --host 127.0.0.1 --port 43124 --strictPort",
    url: "http://127.0.0.1:43124",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
