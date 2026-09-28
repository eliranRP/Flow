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
