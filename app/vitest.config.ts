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

// Both themes run the same stories: `storybook` renders light (preview.tsx's default), and
// `storybook-dark` the same set with the theme global set to dark (FLOW-833).
const storybookProject = async (name: string, setupFile: string): Promise<TestProjectInlineConfiguration> => ({
  plugins: await storybookTest({ configDir: path.join(dirname, ".storybook") }),
  test: {
    name,
    browser: {
      enabled: true,
      headless: true,
      // vitest 4 takes the provider as a factory from its own package (FLOW-818).
      provider: playwright(),
      instances: [{ browser: "chromium", viewport: { width: 390, height: 844 } }],
    },
    setupFiles: [setupFile],
  },
});

export default defineConfig(async () => {
  const storybook = await storybookProject("storybook", "./.storybook/vitest.setup.ts");
  const storybookDark = await storybookProject("storybook-dark", "./.storybook/vitest.setup-dark.ts");
  return { test: { projects: [unit, storybook, storybookDark] } };
});
