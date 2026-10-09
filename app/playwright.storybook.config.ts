import { defineConfig, devices } from "@playwright/test";

/** Serves the built Storybook (`pnpm build-storybook`) and opens every story in the manager. */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /storybook-(static|layout|clip|secret)\.spec\.ts/,
  timeout: 30_000,
  // Every test opens its own page on a read-only static build, so tests can run in any order.
  // CI shards split by test, which keeps the runners even.
  fullyParallel: true,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:6193",
    serviceWorkers: "block",
    // The pre-push gate points this at a cloud container's Chromium when Playwright's can't download.
    ...(process.env.FLOW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.FLOW_CHROMIUM_PATH } } : {}),
  },
  webServer: {
    command: "python3 e2e/storybook-static-server.py",
    cwd: ".",
    url: "http://127.0.0.1:6193/index.json",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
