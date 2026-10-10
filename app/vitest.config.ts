import path from "node:path";
import { fileURLToPath } from "node:url";
import { storybookTest } from "@storybook/experimental-addon-test/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, type TestProjectInlineConfiguration } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const unit: TestProjectInlineConfiguration = {
  test: {
    name: "unit",
    environment: "jsdom",
    css: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "e2e/**/*.test.ts"],
    setupFiles: ["./src/test-setup.ts"],
  },
};

export default defineConfig(async () => {
  const storybook: TestProjectInlineConfiguration = {
    plugins: await storybookTest({ configDir: path.join(dirname, ".storybook") }),
    test: {
      name: "storybook",
      browser: {
        enabled: true,
        headless: true,
        // vitest 4 takes the provider as a factory from its own package (FLOW-818).
        provider: playwright(),
        instances: [{ browser: "chromium", viewport: { width: 390, height: 844 } }],
      },
      setupFiles: ["./.storybook/vitest.setup.ts"],
    },
  };
  return { test: { projects: [unit, storybook] } };
});
