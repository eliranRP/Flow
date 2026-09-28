import path from "node:path";
import { fileURLToPath } from "node:url";
import { storybookTest } from "@storybook/experimental-addon-test/vitest-plugin";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(async () => ({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "jsdom",
          css: true,
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
          setupFiles: ["./src/test-setup.ts"],
        },
      },
      {
        plugins: await storybookTest({ configDir: path.join(dirname, ".storybook") }),
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            headless: true,
            provider: "playwright",
            instances: [{ browser: "chromium", viewport: { width: 390, height: 844 } }],
          },
          setupFiles: ["./.storybook/vitest.setup.ts"],
        },
      },
    ],
  },
}));
