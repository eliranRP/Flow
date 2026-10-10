import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { importers, lintScope, reachesApp, sweepRoutes } from "./gate-scope.mjs";
import { scrubGitEnv } from "./test-git-env.mjs";

// git ls-files must read the tree a test names, never a hook's GIT_DIR (see test-git-env.mjs).
scrubGitEnv();

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

// A shell bar with an icon, two screens (one lazy from App, one from the loaders), a card on screen a
// and on dev-routes' DevA, the screens barrel, and the e2e fixtures.
function app() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-sweep-"));
  const files = {
    "app/src/main.tsx": 'import { App } from "./App";\nvoid App;\n',
    "app/src/App.tsx":
      'import { Bar } from "./ui/shell-bar";\nimport { screenLoaders } from "./screen-loaders";\n' +
      'const a = () => import("./screens/a");\nconst dev = () => import("./dev-routes");\nexport const App = [Bar, a, dev, screenLoaders];\n',
    "app/src/screen-loaders.ts": 'export const screenLoaders = { b: () => import("./screens/b") };\n',
    "app/src/screens/a.tsx": 'import { Card } from "../ui/card";\nexport const A = Card;\n',
    "app/src/screens/b.tsx": "export const B = 1;\n",
    "app/src/screens/flow-screens.tsx": 'export { A } from "./a";\nexport { B } from "./b";\n',
    "app/src/ui/card.tsx": "export const Card = 1;\n",
    "app/src/ui/shell-bar.tsx": 'import { Icon } from "./icon";\nexport const Bar = Icon;\n',
    "app/src/ui/icon.tsx": "export const Icon = 1;\n",
    "app/src/dev/sample.ts": "export const sample = 1;\n",
    "app/src/dev-routes.tsx":
      'import { Card } from "./ui/card";\nimport { B } from "./screens/flow-screens";\nimport { sample } from "./dev/sample";\n' +
      "export function DevA() {\n  return Card + sample;\n}\nexport function DevB() {\n  return B;\n}\n",
  };
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  const map = {
    all: ["^app/src/App\\.tsx$", "^app/src/.*\\.css$"],
    sweeps: {
      pages: [],
      routes: {
        "s.spec.ts": {
          "/a": ["screens/a.tsx"],
          "/b": ["screens/b.tsx"],
          "/e2e/a": ["dev-routes.tsx#DevA"],
          "/e2e/b": ["screens/b.tsx", "dev-routes.tsx#DevB"],
        },
      },
    },
  };
  return { dir, files: Object.keys(files), map };
}

test("the sweep opens the routes whose files a change reaches, and every route for the shell", () => {
  const { dir, files, map } = app();
  try {
    const urls = (...changed) => sweepRoutes(changed, { root: dir, files, map }).map(({ url }) => url);
    // The card draws on screen a and in DevA; screen b's only importers are the barrel and loaders.
    assert.deepEqual(urls("app/src/ui/card.tsx"), ["/a", "/e2e/a"]);
    assert.deepEqual(urls("app/src/screens/b.tsx"), ["/b", "/e2e/b"]);
    assert.deepEqual(urls("app/src/dev/sample.ts"), ["/e2e/a"]);
    assert.deepEqual(urls("docs/x.md"), []);
    for (const file of ["app/src/ui/icon.tsx", "app/src/ui/a.css", "app/e2e/control-sweep.ts"]) {
      assert.deepEqual(urls(file), ["/a", "/b", "/e2e/a", "/e2e/b"], file);
    }
    assert.deepEqual(urls("app/e2e/s.spec.ts"), ["/a", "/b", "/e2e/a", "/e2e/b"]);
    const [why] = sweepRoutes(["app/src/ui/icon.tsx"], { root: dir, files, map });
    assert.equal(why?.why, "app/src/ui/icon.tsx reaches the app shell through app/src/ui/icon.tsx");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the real sweep map: every route draws files that exist, and a screen reaches only its routes", () => {
  const map = JSON.parse(fs.readFileSync(path.join(root, "app/e2e/spec-sources.json"), "utf8"));
  const dev = fs.readFileSync(path.join(root, "app/src/dev-routes.tsx"), "utf8");
  for (const [spec, urls] of Object.entries(map.sweeps.routes)) {
    assert.match(fs.readFileSync(path.join(root, "app/e2e", spec), "utf8"), new RegExp(`sweepControls\\("${spec.replace(/\./g, "\\.")}"\\)`));
    for (const [url, entries] of Object.entries(urls)) {
      for (const entry of entries) {
        const [file, name] = entry.split("#");
        assert.ok(fs.existsSync(path.join(root, "app/src", file)), `${url}: ${entry}`);
        if (name) assert.match(dev, new RegExp(`^export function ${name}\\b`, "m"), `${url}: ${entry}`);
      }
      // dev-routes draws every /e2e/ route; a route with no entry would never be swept by the gate.
      if (url.startsWith("/e2e/")) assert.ok(entries.some((entry) => entry.startsWith("dev-routes.tsx#")), url);
      else assert.ok(entries.length > 0, url);
    }
  }
  const urls = (file) => sweepRoutes([file], { root, map }).map(({ url }) => url);
  assert.deepEqual(urls("app/src/screens/categories-screen.tsx"), ["/settings/categories?preview=1", "/e2e/categories?preview=1"]);
  assert.equal(urls("app/src/ui/tab-bar.tsx").length, Object.values(map.sweeps.routes).flatMap(Object.keys).length);
});
