import { defineConfig, devices } from "@playwright/test";

/** Serves the built Storybook (`pnpm build-storybook`) and opens every story in the manager. */
export default defineConfig({
  testDir: "./e2e",
  testMatch: [/storybook-(static|layout)\.spec\.ts/, /storybook-clip\.spec\.mjs/],
  timeout: 30_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:6193",
    serviceWorkers: "block",
  },
  webServer: {
    command: "python3 -m http.server 6193 --bind 127.0.0.1",
    cwd: "./storybook-static",
    url: "http://127.0.0.1:6193/index.json",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
