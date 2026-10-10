import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { importers, lintScope, reachesApp } from "./gate-scope.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// A throwaway tree: a leaf, a barrel, a screen through the barrel, a test, the shared package.
function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-scope-"));
  const files = {
    "packages/shared/src/index.ts": 'export * from "./money";\n',
    "packages/shared/src/money.ts": "export const agorot = (n: number) => n;\n",
    "app/src/ui/leaf.tsx": 'import { agorot } from "@flow/shared";\nexport const Leaf = () => agorot(1);\n',
    "app/src/ui/index.ts": 'export { Leaf } from "./leaf";\n',
    "app/src/screens/home.tsx": 'import {\n  Leaf,\n} from "../ui";\nexport const Home = Leaf;\n',
    "app/src/screens/lazy.tsx": 'export const load = () => import("./home");\n',
    "app/src/screens/home.test.tsx": 'import { Home } from "./home";\nimport "../ui/leaf.css";\nvoid Home;\n',
    "app/src/ui/leaf.css": ".leaf {}\n",
    "app/src/other.ts": "export const other = 1;\n",
    "app/src/data.json": "{}\n",
    "app/src/reads-json.ts": 'import data from "./data.json";\nexport default data;\n',
  };
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  return { dir, files: Object.keys(files) };
}

test("a change reaches the files that import it, through barrels, multi-line and dynamic imports", () => {
  const { dir, files } = tree();
  try {
    assert.deepEqual([...importers(["app/src/ui/leaf.tsx"], { root: dir, files })].sort(), [
      "app/src/screens/home.test.tsx",
      "app/src/screens/home.tsx",
      "app/src/screens/lazy.tsx",
      "app/src/ui/index.ts",
      "app/src/ui/leaf.tsx",
    ]);
    // @flow/shared resolves to the package's sources.
    assert.ok(importers(["packages/shared/src/money.ts"], { root: dir, files }).has("app/src/screens/home.test.tsx"));
    assert.deepEqual([...importers(["app/src/other.ts"], { root: dir, files })], ["app/src/other.ts"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("lint scope: code and JSON changes with their importers; CSS and docs reach nothing", () => {
  const { dir, files } = tree();
  try {
    const scope = (...lines) => lintScope(lines, { root: dir, files });
    assert.deepEqual(scope("M\tapp/src/screens/home.tsx"), [
      "app/src/screens/home.test.tsx",
      "app/src/screens/home.tsx",
      "app/src/screens/lazy.tsx",
    ]);
    assert.deepEqual(scope("M\tapp/src/data.json"), ["app/src/reads-json.ts"]);
    assert.deepEqual(scope("M\tapp/src/ui/leaf.css", "M\tdocs/backlog/TASKS.md"), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("lint scope: config, tsconfig, manifests, lockfile, .d.ts, deletes and renames lint all", () => {
  for (const line of [
    "M\teslint.config.js",
    "M\tapp/tsconfig.json",
    "M\ttsconfig.base.json",
    "M\tapp/package.json",
    "M\tpnpm-lock.yaml",
    "A\tapp/src/vite-env.d.ts",
    "D\tapp/src/other.ts",
    "R100\tapp/src/a.ts\tapp/src/b.ts",
  ]) {
    assert.equal(lintScope(["M\tapp/src/other.ts", line], { root, files: [] }), "all", line);
  }
});

test("the real tree: a UI component reaches its screen, the app and their tests", () => {
  const scope = lintScope(["M\tapp/src/ui/hero.tsx"], { root });
  assert.notEqual(scope, "all");
  for (const file of ["app/src/ui/hero.tsx", "app/src/screens/HomeScreen.tsx", "app/src/App.tsx", "app/src/App.test.tsx"]) {
    assert.ok(scope.includes(file), file);
  }
});

test("the build reads every app input but tests, stories, specs, test setups and migrations", () => {
  for (const file of [
    "app/src/screens/home.test.tsx",
    "app/src/ui/hero.stories.tsx",
    "app/src/test-waits.ts",
    "app/src/ui/test-support.ts",
    "app/e2e/review.spec.ts",
    "app/.storybook/preview.tsx",
    "app/playwright.config.ts",
    "app/vitest.config.ts",
    "supabase/migrations/20261013000000_x.sql",
    "scripts/gate-scope.test.mjs",
  ]) {
    assert.equal(reachesApp([`M\t${file}`]), false, file);
  }
  for (const file of [
    "app/src/ui/hero.tsx",
    "app/src/ui/css/02-fields-sheets.css",
    "app/src/ui/screen-stories-support.tsx",
    "app/index.html",
    "app/vite.config.ts",
    "app/package.json",
    "packages/shared/src/money.ts",
    "design/system/tokens.css",
    "scripts/check-prod-bundle.mjs",
    "pnpm-lock.yaml",
  ]) {
    assert.equal(reachesApp([`M\tapp/src/a.test.tsx`, `M\t${file}`]), true, file);
  }
  assert.equal(reachesApp(["D\tapp/src/a.test.tsx"]), true);
  assert.equal(reachesApp([]), false);
});
