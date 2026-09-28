import { defineConfig } from "@playwright/test";

/** Posts the local sumit-sync drain. No browser app. */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /sumit-drain/,
  timeout: 60_000,
  expect: { timeout: 20_000 },
});
