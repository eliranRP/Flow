import { defineConfig, devices } from "@playwright/test";

export const defaultSmokeHost = "https://flow-app-dx5.pages.dev";

/** `SMOKE_BASE_URL` overrides the Pages host. Unset, the live check uses the current host. */
export function smokeBaseURL(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.SMOKE_BASE_URL?.trim() ?? "";
  return configured !== "" ? configured : defaultSmokeHost;
}

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
    baseURL: smokeBaseURL(),
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
