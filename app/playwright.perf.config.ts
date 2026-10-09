/// <reference types="node" />
import { defineConfig, devices } from "@playwright/test";

// FLOW-804: the speed tests run on a production build, served gzipped. The build talks to the stub
// backend's address (perf/stub-backend.ts), which answers from the demo books, so the project page
// test can sign in and read without any server.
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
    command: "vite build --outDir perf-dist --emptyOutDir --logLevel warn && node ../scripts/serve-dist.mjs perf-dist 43124",
    url: "http://127.0.0.1:43124",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:43199",
      VITE_SUPABASE_ANON_KEY: "perf-stub-anon-key",
    },
  },
});
