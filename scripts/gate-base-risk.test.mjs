import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { riskAreas, riskyChanges } from "./gate-base-risk.mjs";

const SCRIPT = fileURLToPath(new URL("./gate-base-risk.mjs", import.meta.url));

test("riskyChanges keeps migrations, flow-mcp, the shared package and the seed", () => {
  assert.deepEqual(
    riskyChanges([
      "supabase/migrations/20261013175142_team_members.sql",
      "supabase/functions/flow-mcp/tools.ts",
      "packages/shared/src/dashboard.ts",
      "supabase/seed.sql",
      "app/src/screens/home.tsx",
      "docs/backlog/TASKS.md",
      "supabase/functions/sumit-sync/index.ts",
    ]),
    [
      "supabase/migrations/20261013175142_team_members.sql",
      "supabase/functions/flow-mcp/tools.ts",
      "packages/shared/src/dashboard.ts",
      "supabase/seed.sql",
    ],
  );
});

// A throwaway repo: main, a branch with a migration that passed on main's first commit, then main
// moving on under it.
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "gate-base-risk-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "ci@example.com");
  git("config", "user.name", "CI");
  const commit = (path, text, message) => {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
    git("add", "-A");
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  return { dir, git, commit };
}

function run(dir, marked, current) {
  return spawnSync("node", [SCRIPT, marked, current], { cwd: dir, encoding: "utf8" });
}

test("the #364-then-#383 shape is not skipped: main changed a migration under an unchanged patch", () => {
  const { dir, git, commit } = repo();
  try {
    const fork = commit("supabase/migrations/20261013162756_rollups.sql", "select 1;\n", "main");
    git("checkout", "-q", "-b", "lane");
    commit("supabase/migrations/20261013175550_project_groups.sql", "select 2;\n", "groups");
    git("checkout", "-q", "main");
    const moved = commit("supabase/migrations/20261013175142_team_members.sql", "select 3;\n", "team members");
    const result = run(dir, fork, moved);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /20261013175142_team_members\.sql/);
    assert.match(result.stdout, /\nareas=database\n$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a UI-only move of main keeps the skip, and the same fork needs no diff", () => {
  const { dir, git, commit } = repo();
  try {
    const fork = commit("supabase/migrations/20261013162756_rollups.sql", "select 1;\n", "main");
    const moved = commit("app/src/screens/home.tsx", "export {};\n", "ui");
    assert.equal(run(dir, fork, moved).status, 0);
    assert.equal(run(dir, moved, moved).status, 0);
    assert.equal(git("rev-parse", "HEAD"), moved);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a mark with no fork, or a fork not under main, is not trusted", () => {
  const { dir, commit } = repo();
  try {
    const head = commit("README.md", "x\n", "main");
    assert.equal(run(dir, "", head).status, 1);
    assert.match(run(dir, "", head).stdout, /\nareas=all\n$/);
    assert.equal(run(dir, "f".repeat(40), head).status, 1);
    assert.match(run(dir, "f".repeat(40), head).stdout, /\nareas=all\n$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("riskAreas names each area main touched, in a fixed order", () => {
  assert.deepEqual(riskAreas(["app/src/a.tsx", "docs/x.md"]), []);
  assert.deepEqual(
    riskAreas([
      "packages/shared/src/dashboard.ts",
      "supabase/functions/flow-mcp/tools.ts",
      "supabase/seed.sql",
      "supabase/migrations/20261013212342_starter_categories.sql",
    ]),
    ["database", "flow-mcp", "shared"],
  );
  assert.deepEqual(riskAreas(["supabase/seed.sql"]), ["database"]);
  assert.deepEqual(riskAreas(["packages/shared/src/index.ts"]), ["shared"]);
});
