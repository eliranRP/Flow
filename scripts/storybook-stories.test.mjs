import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { selectStories } from "./storybook-stories.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const select = (...changed) => selectStories(changed, { root });
const tierOf = (stories, file) => stories.find(([, story]) => story === file)?.[0];

test("a changed story file is tier 1", () => {
  const stories = select("app/src/screens/loan-list.stories.tsx");
  assert.deepEqual(stories, [[1, "./src/screens/loan-list.stories.tsx"]]);
});

test("a story importing a changed source is tier 2, one reaching it further down is tier 3", () => {
  const stories = select("app/src/screens/loan-list.tsx");
  assert.equal(tierOf(stories, "./src/screens/loan-list.stories.tsx"), 2);
  assert.ok(stories.some(([tier]) => tier === 3));
  assert.deepEqual(stories, [...stories].sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1])));
});

test("CSS and files outside the app pick no story; the Storybook config and lockfile pick all", () => {
  assert.deepEqual(select("app/src/ui/css/02-fields-sheets.css", "docs/backlog/TASKS.md"), []);
  assert.equal(select(".storybook/x", "app/.storybook/preview.tsx"), "all");
  assert.equal(select("pnpm-lock.yaml"), "all");
  assert.equal(select("app/e2e/storybook-static.spec.ts"), "all");
});
