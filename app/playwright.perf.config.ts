/// <reference types="node" />
import { defineConfig, devices } from "@playwright/test";

// FLOW-804: the Home speed test runs on the production build (pnpm build first), served gzipped.
export default defineConfig({
  testDir: "./perf",
  workers: 1,
  retries: 0,
  use: {
    ...devices["Pixel 7"],
    baseURL: "http://127.0.0.1:43124",
    serviceWorkers: "block",
  },
  webServer: {
    command: "node ../scripts/serve-dist.mjs dist 43124",
    url: "http://127.0.0.1:43124",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
