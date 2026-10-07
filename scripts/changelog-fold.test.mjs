import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fold, readFragments } from "./changelog-fold.mjs";

const script = new URL("./changelog-fold.mjs", import.meta.url).pathname;
const repoFragments = new URL("../docs/changelog.d", import.meta.url).pathname;

test("every fragment in the repo is valid", () => {
  assert.deepEqual(readFragments(repoFragments).problems, []);
});

test("fold appends to an existing date and adds a new date on top", () => {
  const changelog = "# Changelog\n\n## 2026-10-06\n\nOld entry.\n\n## 2026-10-04\n\nOlder entry.\n";
  const folded = fold(changelog, [
    { date: "2026-10-06", text: "Second entry." },
    { date: "2026-10-07", text: "Newest entry." },
  ]);
  assert.equal(
    folded,
    "# Changelog\n\n## 2026-10-07\n\nNewest entry.\n\n## 2026-10-06\n\nOld entry.\n\nSecond entry.\n\n## 2026-10-04\n\nOlder entry.\n",
  );
});

test("the script folds the fragments and removes them, and --check rejects a bad name", () => {
  const dir = mkdtempSync(join(tmpdir(), "changelog-fold-"));
  try {
    const fragments = join(dir, "changelog.d");
    const file = join(dir, "changelog.md");
    mkdirSync(fragments);
    writeFileSync(join(fragments, "README.md"), "How to add a fragment.\n");
    writeFileSync(join(fragments, "2026-10-07-flow-1.md"), "Entry one.\n");
    writeFileSync(file, "# Changelog\n\n## 2026-10-06\n\nOld entry.\n");
    const run = (/** @type {string[]} */ ...args) =>
      spawnSync("node", [script, "--dir", fragments, "--file", file, ...args], { encoding: "utf8" });

    let result = run("--check");
    assert.equal(result.status, 0, result.stderr);

    writeFileSync(join(fragments, "FLOW-2.md"), "Entry two.\n");
    result = run("--check");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FLOW-2\.md: name it/);
    rmSync(join(fragments, "FLOW-2.md"));

    result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(file, "utf8"), "# Changelog\n\n## 2026-10-07\n\nEntry one.\n\n## 2026-10-06\n\nOld entry.\n");
    assert.deepEqual(readdirSync(fragments), ["README.md"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a fragment with a heading is rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "changelog-fold-"));
  try {
    writeFileSync(join(dir, "2026-10-07-x.md"), "## 2026-10-07\n\nEntry.\n");
    assert.match(readFragments(dir).problems[0], /no headings/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
