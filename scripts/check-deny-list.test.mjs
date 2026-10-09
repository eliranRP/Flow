import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { deniedLines, denyEntries, denyListRequired, scanFiles, words } from "./check-deny-list.mjs";

// Invented names only, plus the owner's allowed first name.
const entries = denyEntries([
  "Zorbel Quint",
  "  Pavlo   Ostrander Tiling & Stone  ",
  "one two three four five six seven eight",
  "",
  " Eliran ",
].join("\n"));

test("entries are normalised word lists, blank lines dropped", () => {
  assert.deepEqual(entries, [
    ["zorbel", "quint"],
    ["pavlo", "ostrander", "tiling", "stone"],
    ["one", "two", "three", "four", "five", "six", "seven", "eight"],
  ]);
  assert.deepEqual(words("José  García-Ruiz"), ["jose", "garcia", "ruiz"]);
});

test("an entry matches through punctuation, case, accents and line breaks", () => {
  assert.deepEqual(deniedLines("a\nPaid ZORBÉL, quint today", entries), [2]);
  assert.deepEqual(deniedLines("x\npavlo-ostrander\n(tiling/stone)", entries), [2]);
  assert.deepEqual(deniedLines("zorbel quintet", entries), []);
  assert.deepEqual(deniedLines("zorbel\n", entries), []);
});

test("an entry longer than six words still matches", () => {
  assert.deepEqual(deniedLines("x one two three four five six seven eight y", entries), [1]);
  assert.deepEqual(deniedLines("one two three four five six seven", entries), []);
});

test("a planted name fails in every path the old fixture check missed", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "deny-list-"));
  const planted = [
    "docs/design/log/2026-10-09-note.md",
    "app/src/ui/stories/row.stories.tsx",
    "app/e2e/review.spec.ts",
    "supabase/tests/connectors/mercury/fixtures/rules/categories.json",
    "supabase/tests/connectors/mercury/fixtures/README.md",
    "supabase/functions/_shared/connectors/mercury/rules.yaml",
    "README.md",
  ];
  for (const file of planted) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), `first line\nsupplier: "Zorbel Quint"\n`);
  }
  writeFileSync(path.join(dir, "clean.md"), "nothing here\n");
  writeFileSync(path.join(dir, "shot.png"), "Zorbel Quint");
  const hits = scanFiles(dir, [...planted, "clean.md", "shot.png", "missing.md"], entries);
  assert.deepEqual(hits, planted.map((file) => `${file}:2`));
});

test("the check is required only in CI on eliranRP/Flow, not on forks", () => {
  const env = (/** @type {Record<string, string>} */ values) => ({ get: (/** @type {string} */ name) => values[name] });
  assert.equal(denyListRequired(env({})), false);
  assert.equal(denyListRequired(env({ GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "someone/Flow" })), false);
  assert.equal(
    denyListRequired(env({ GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "eliranRP/Flow", GITHUB_EVENT_HEAD_REPO_FORK: "true" })),
    false,
  );
  assert.equal(denyListRequired(env({ GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "eliranRP/Flow" })), true);
});
