import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("./ci-deploy-plan.sh", import.meta.url).pathname;

/** A repo with `merges` commits after the deployed one, and a fake gh that reports deployments. */
function setup({ merges, deployments }) {
  const dir = mkdtempSync(join(tmpdir(), "ci-deploy-plan-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "ci@example.com");
  git("config", "user.name", "CI");
  git("commit", "-q", "--allow-empty", "-m", "deployed");
  const deployed = git("rev-parse", "HEAD");
  for (let i = 0; i < merges; i += 1) git("commit", "-q", "--allow-empty", "-m", `merge ${i}`);
  const rows = deployments(deployed, git("rev-parse", "HEAD"));
  const list = rows.map((row) => `${row.id}\t${row.sha}`).join("\n");
  const states = rows.map((row) => `${row.id}) echo ${row.state} ;;`).join("\n");
  const listFile = join(dir, "deployments.tsv");
  writeFileSync(listFile, list ? `${list}\n` : "");
  const gh = join(dir, "gh");
  writeFileSync(
    gh,
    `#!/bin/bash
case "$2" in
  */statuses*) id="\${2#*/deployments/}"; id="\${id%%/*}"; case "$id" in
${states}
  *) echo "" ;;
  esac ;;
  *) cat ${JSON.stringify(listFile)} ;;
esac
`,
  );
  chmodSync(gh, 0o755);
  const output = join(dir, "output");
  writeFileSync(output, "");
  const run = (event = "push") =>
    spawnSync("bash", [script], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, FLOW_GH: gh, GITHUB_OUTPUT: output, GITHUB_REPOSITORY: "example/flow", GITHUB_EVENT_NAME: event, GITHUB_STEP_SUMMARY: "" },
    });
  return { dir, run, output: () => readFileSync(output, "utf8") };
}

test("fewer than 5 merges since the last good deploy skip CI and the deploy", () => {
  const ctx = setup({ merges: 4, deployments: (sha) => [{ id: 7, sha, state: "success" }] });
  try {
    const result = ctx.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(ctx.output(), "run=false\n");
    assert.match(result.stdout, /4 of 5 merges/);
  } finally {
    rmSync(ctx.dir, { recursive: true, force: true });
  }
});

test("the fifth merge runs CI and the deploy", () => {
  const ctx = setup({ merges: 5, deployments: (sha) => [{ id: 7, sha, state: "success" }] });
  try {
    assert.equal(ctx.run().status, 0);
    assert.equal(ctx.output(), "run=true\n");
  } finally {
    rmSync(ctx.dir, { recursive: true, force: true });
  }
});

test("a failed deploy does not count, so the batch counts from the last good one", () => {
  const ctx = setup({
    merges: 5,
    deployments: (sha, head) => [
      { id: 9, sha: head, state: "failure" },
      { id: 7, sha, state: "success" },
    ],
  });
  try {
    assert.equal(ctx.run().status, 0);
    assert.equal(ctx.output(), "run=true\n");
  } finally {
    rmSync(ctx.dir, { recursive: true, force: true });
  }
});

test("a manual run always tests and deploys", () => {
  const ctx = setup({ merges: 1, deployments: (sha) => [{ id: 7, sha, state: "success" }] });
  try {
    assert.equal(ctx.run("workflow_dispatch").status, 0);
    assert.equal(ctx.output(), "run=true\n");
  } finally {
    rmSync(ctx.dir, { recursive: true, force: true });
  }
});

test("no known good deploy runs CI and the deploy", () => {
  const ctx = setup({ merges: 1, deployments: () => [] });
  try {
    assert.equal(ctx.run().status, 0);
    assert.equal(ctx.output(), "run=true\n");
  } finally {
    rmSync(ctx.dir, { recursive: true, force: true });
  }
});
