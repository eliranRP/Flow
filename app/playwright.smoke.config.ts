import { defineConfig, devices } from "@playwright/test";

/** Live Pages after deploy. Read-only. No local web server. */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /smoke-readonly\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  retries: 1,
  workers: 1,
  reporter: [["line"], ["./e2e/smoke-retry-reporter.ts"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "https://flow-app-dx5.pages.dev",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
