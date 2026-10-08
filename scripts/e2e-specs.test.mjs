import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readMap, selectSpecs, specClosures } from "./e2e-specs.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const map = readMap(root);
const select = (...changed) => selectSpecs(changed, { root, map });

test("every e2e spec is mapped or ignored, and every entry exists", () => {
  const specs = fs.readdirSync(path.join(root, "app/e2e")).filter((name) => name.endsWith(".spec.ts"));
  const listed = [...Object.keys(map.specs), ...map.ignored];
  assert.deepEqual([...specs].sort(), [...listed].sort(), "add each new app/e2e spec to app/e2e/spec-sources.json");
  for (const entries of Object.values(map.specs)) {
    assert.ok(entries.length > 0);
    for (const entry of entries) assert.ok(fs.existsSync(path.join(root, "app/src", entry)), `app/src/${entry}`);
  }
});

test("the ignored specs are the ones playwright.config.ts leaves out", () => {
  const config = fs.readFileSync(path.join(root, "app/playwright.config.ts"), "utf8");
  const ignore = /testIgnore:\s*\[([^\]]*)\]/.exec(config);
  assert.ok(ignore, "testIgnore moved: update scripts/e2e-specs.test.mjs");
  const patterns = [...ignore[1].matchAll(/\/((?:\\.|[^/])+)\//g)].map((match) => new RegExp(match[1]));
  for (const spec of map.ignored) assert.ok(patterns.some((pattern) => pattern.test(spec)), spec);
  for (const spec of Object.keys(map.specs)) assert.ok(!patterns.some((pattern) => pattern.test(spec)), spec);
});

test("a screen's copy change runs the specs that open that screen", () => {
  const specs = select("app/src/screens/jev-settings.tsx");
  assert.ok(specs.includes("jev-settings.spec.ts"));
  assert.ok(specs.includes("sheet-stack.spec.ts"));
  assert.ok(!specs.includes("split.spec.ts"));
  assert.ok(!specs.includes("reviewer.spec.ts"));
});

test("a spec, or a file only it imports, runs that spec", () => {
  assert.deepEqual(select("app/e2e/split.spec.ts"), ["split.spec.ts"]);
  assert.ok(select("app/src/assistant-sample.ts").includes("sheet-stack.spec.ts"));
});

test("an import through the screens barrel reaches only the named screens", () => {
  const { closures } = specClosures({ root, map });
  const reviewer = closures.get("reviewer.spec.ts");
  assert.ok(reviewer.has("app/src/screens/review-queue.tsx"));
  assert.ok(!reviewer.has("app/src/screens/connections-screen.tsx"));
});

test("App.tsx, CSS and the e2e config run every spec; tests and stories run none", () => {
  const every = Object.keys(map.specs).sort();
  assert.deepEqual(select("app/src/App.tsx"), every);
  assert.deepEqual(select("app/src/ui/css/01-base.css"), every);
  assert.deepEqual(select("app/playwright.config.ts"), every);
  assert.deepEqual(select("app/src/screens/jev-settings.test.tsx", "app/src/screens/jev-settings.stories.tsx"), []);
  assert.deepEqual(select("supabase/migrations/x.sql", "docs/backlog/TASKS.md"), []);
});
