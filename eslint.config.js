import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "**/dist/**",
      "scripts/**/*.mjs",
      "**/storybook-static/**",
      "**/.vite/**",
      "**/node_modules/**",
      "design/**",
      "docs/**",
      "supabase/**",
      "packages/shared/fixtures/**",
      "packages/shared/src/database.types.ts",
      "playwright-report/**",
      "test-results/**",
      // FLOW-502: a plain worker script that workbox imports; it runs in the service-worker scope.
      "app/public/push-sw.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "eslint.config.js",
            "app/vite.config.ts",
            "app/playwright.drain.config.ts",
            "packages/shared/vitest.config.ts",
          ],
          defaultProject: "scripts/tsconfig.json",
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    files: ["app/src/**/*.{ts,tsx}"],
    ignores: [
      "app/src/**/*.test.ts",
      "app/src/**/*.test.tsx",
      "app/src/**/*.stories.tsx",
      "app/src/**/*.stories-support.tsx",
      "app/src/demo/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/fixtures/**",
                "**/*.stories",
                "**/*.stories.*",
                "**/*.stories-support",
                "**/*.stories-support.*",
                "@flow/shared/testing",
                "**/demo/**",
              ],
              message: "Screens and the app runtime do not import fixtures, stories, demo data, or the testing entry.",
            },
          ],
        },
      ],
    },
  },
);
