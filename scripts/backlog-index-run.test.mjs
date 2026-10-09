import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { run } from "./backlog-index.mjs";

const taskFile = (status) => `# FLOW-901 · Widget reads\n- **Type:** BUG · **Status:** ${status} · **Depends on:** —\n`;

test("run writes TASKS.md, and --check fails while it is missing or out of date", () => {
  const root = mkdtempSync(join(tmpdir(), "backlog-root-"));
  try {
    mkdirSync(join(root, "docs/backlog/tasks"), { recursive: true });
    writeFileSync(join(root, "docs/backlog/tasks/index-source.md"), "# Flow backlog\n\n## Area\n\n- FLOW-901\n");
    writeFileSync(join(root, "docs/backlog/tasks/FLOW-901.md"), taskFile("ready"));
    assert.equal(run(root, true).code, 1, "a missing TASKS.md fails the check");
    assert.equal(run(root, false).code, 0);
    const first = readFileSync(join(root, "docs/backlog/TASKS.md"), "utf8");
    assert.deepEqual(run(root, true), { code: 0, message: "docs/backlog/TASKS.md is up to date." });
    run(root, false);
    assert.equal(readFileSync(join(root, "docs/backlog/TASKS.md"), "utf8"), first, "the output is the same on a second run");
    writeFileSync(join(root, "docs/backlog/tasks/FLOW-901.md"), taskFile("done (#5)"));
    const stale = run(root, true);
    assert.equal(stale.code, 1);
    assert.match(stale.message, /out of date\. Run `node scripts\/backlog-index\.mjs`/);
    assert.equal(readFileSync(join(root, "docs/backlog/TASKS.md"), "utf8"), first, "--check never writes");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
