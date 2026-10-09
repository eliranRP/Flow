import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
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

test("camelCase and run-together spellings of a multi-word entry match", () => {
  assert.deepEqual(deniedLines("const zorbelQuintId = 1", entries), [1]);
  assert.deepEqual(deniedLines("x\nhttps://zorbelquint.example.com", entries), [2]);
  assert.deepEqual(deniedLines("zorbelquintet", entries), []);
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
  const { hits, unreadable } = scanFiles(dir, [...planted, "clean.md", "shot.png"], entries);
  assert.deepEqual(hits, planted.map((file) => `${file}:2`));
  assert.deepEqual(unreadable, []);
});

test("a tracked file that cannot be read is reported, not skipped", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "deny-list-"));
  mkdirSync(path.join(dir, "folder"));
  const { hits, unreadable } = scanFiles(dir, ["missing.md", "folder"], entries);
  assert.deepEqual(hits, []);
  assert.deepEqual(unreadable, ["missing.md: ENOENT", "folder: EISDIR"]);
});

const script = fileURLToPath(new URL("./check-deny-list.mjs", import.meta.url));

/** Runs the CLI inside a fresh git repo holding `files`, with only `env` set. */
function runCli(/** @type {Record<string, string>} */ files, /** @type {Record<string, string>} */ env) {
  const dir = mkdtempSync(path.join(tmpdir(), "deny-list-cli-"));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  }
  // A pre-push hook exports GIT_DIR (and in a worktree it is absolute), so git would act on the
  // pushing repo, not this temp one. Drop the GIT_* variables for the setup commands.
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  spawnSync("git", ["init", "-q"], { cwd: dir, env: gitEnv });
  spawnSync("git", ["add", "-A"], { cwd: dir, env: gitEnv });
  const result = spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test("the CLI exits 1 on a hit and prints file:line, never the denied text", () => {
  const run = runCli({ "docs/note.md": "first\nPaid Zorbel Quint\n" }, { MERCURY_FIXTURE_DENYLIST: "Zorbel Quint" });
  assert.equal(run.status, 1);
  assert.match(run.output, /docs\/note\.md:2/);
  assert.doesNotMatch(run.output, /zorbel|quint/i);
});

test("the CLI exits 0 when clean, when skipped, and when only allowed names are listed", () => {
  const files = { "a.md": "nothing here, Eliran approved it\n" };
  assert.equal(runCli(files, { MERCURY_FIXTURE_DENYLIST: "Zorbel Quint" }).status, 0);
  assert.equal(runCli(files, {}).status, 0);
  const allowedOnly = runCli(files, { MERCURY_FIXTURE_DENYLIST: "Eliran", GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "eliranRP/Flow" });
  assert.equal(allowedOnly.status, 0);
  assert.match(allowedOnly.output, /no entries after the allow-list/);
});

test("the CLI exits 2 when the secret is missing in CI on eliranRP/Flow", () => {
  const run = runCli({ "a.md": "x\n" }, { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "eliranRP/Flow" });
  assert.equal(run.status, 2);
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

test("the CLI exits 3 when a tracked file cannot be read", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "deny-list-cli-"));
  writeFileSync(path.join(dir, "gone.md"), "x\n");
  // A pre-push hook exports GIT_DIR (and in a worktree it is absolute), so git would act on the
  // pushing repo, not this temp one. Drop the GIT_* variables for the setup commands.
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  spawnSync("git", ["init", "-q"], { cwd: dir, env: gitEnv });
  spawnSync("git", ["add", "-A"], { cwd: dir, env: gitEnv });
  spawnSync("rm", [path.join(dir, "gone.md")]);
  const result = spawnSync(process.execPath, [script], {
    cwd: dir,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", MERCURY_FIXTURE_DENYLIST: "Zorbel Quint" },
  });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /gone\.md: ENOENT/);
});
