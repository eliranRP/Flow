import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { pickStories, reachesBuild, relatedRun, selectStories } from "./storybook-stories.mjs";
import { isolatedEnv, scrubGitEnv } from "./test-git-env.mjs";

// The throwaway repos must never reach the repo being pushed (see test-git-env.mjs).
scrubGitEnv();

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
  assert.equal(select("app/e2e/storybook-network.ts"), "all");
  // A vitest test of a smoke helper runs in the unit project; it opens no story.
  assert.deepEqual(select("app/e2e/storybook-network.test.ts", "app/e2e/smoke-allow.test.ts"), []);
  assert.equal(reachesBuild("app/e2e/storybook-network.test.ts", { root }), false);
});

test("whole tiers fit the budget, nearest first; the first tier always goes", () => {
  const tiered = [[1, "a"], [2, "b"], [2, "c"], [3, "d"]];
  const counts = new Map([["a", 300], ["b", 10], ["c", 10], ["d", 5]]);
  assert.deepEqual(pickStories(tiered, counts, 250), { files: ["a"], partial: true });
  counts.set("a", 10);
  assert.deepEqual(pickStories(tiered, counts, 30), { files: ["a", "b", "c"], partial: true });
  assert.deepEqual(pickStories(tiered, counts, 35), { files: ["a", "b", "c", "d"], partial: false });
  assert.deepEqual(pickStories([], counts, 35), { files: [], partial: false });
});

// A throwaway repo with the manifests, a tsconfig and a lockfile at a base commit.
function configRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storybook-stories-"));
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  const json = (file, value) => write(file, `${JSON.stringify(value, null, 2)}\n`);
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: isolatedEnv() }).trim();
  const app = {
    name: "@flow/app",
    type: "module",
    scripts: { build: "vite build", "build-storybook": "storybook build" },
    dependencies: { react: "19.0.0" },
    devDependencies: { storybook: "9.0.0" },
  };
  const rootPkg = { name: "flow", scripts: { lint: "eslint ." }, devDependencies: { wrangler: "4.0.0" } };
  const tsconfig = { extends: "../tsconfig.base.json", compilerOptions: { jsx: "react-jsx" }, include: ["src"] };
  const lock = (rootTool, appReact) =>
    `lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    devDependencies:\n      wrangler:\n        version: ${rootTool}\n\n` +
    `  app:\n    dependencies:\n      react:\n        version: ${appReact}\n\n  packages/shared: {}\n\npackages:\n\n  x@1.0.0: {}\n`;
  json("app/package.json", app);
  json("package.json", rootPkg);
  json("app/tsconfig.json", tsconfig);
  json("tsconfig.base.json", { compilerOptions: { strict: true } });
  write("pnpm-lock.yaml", lock("4.0.0", "19.0.0"));
  write("app/src/a.stories.tsx", "export default {};\n");
  git("init", "-q", "-b", "main");
  git("config", "user.email", "ci@example.com");
  git("config", "user.name", "CI");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  const base = git("rev-parse", "HEAD");
  const reaches = (file) => reachesBuild(file, { root: dir, base });
  return { dir, base, app, rootPkg, tsconfig, lock, json, write, reaches };
}

test("a script, include list or root tool change does not reach the Storybook build", () => {
  const r = configRepo();
  try {
    r.json("app/package.json", { ...r.app, scripts: { ...r.app.scripts, "test:perf": "playwright test -c perf" } });
    r.json("package.json", { ...r.rootPkg, scripts: { lint: "eslint .", perf: "pnpm -C app test:perf" }, devDependencies: { wrangler: "4.1.0" } });
    r.json("app/tsconfig.json", { ...r.tsconfig, include: ["src", "perf"] });
    r.write("pnpm-lock.yaml", r.lock("4.1.0", "19.0.0"));
    for (const file of ["app/package.json", "package.json", "app/tsconfig.json", "pnpm-lock.yaml"]) assert.equal(r.reaches(file), false, file);
    assert.deepEqual(selectStories(["app/package.json", "app/tsconfig.json", "pnpm-lock.yaml"], { root: r.dir, base: r.base }), []);
  } finally {
    fs.rmSync(r.dir, { recursive: true, force: true });
  }
});

test("a dependency, storybook script, compiler option or app lockfile change reaches every story", () => {
  const r = configRepo();
  try {
    const cases = [
      ["app/package.json", () => r.json("app/package.json", { ...r.app, dependencies: { react: "19.1.0" } })],
      ["app/package.json", () => r.json("app/package.json", { ...r.app, scripts: { ...r.app.scripts, "build-storybook": "storybook build --quiet" } })],
      ["package.json", () => r.json("package.json", { ...r.rootPkg, pnpm: { overrides: { react: "19.1.0" } } })],
      ["app/tsconfig.json", () => r.json("app/tsconfig.json", { ...r.tsconfig, compilerOptions: { jsx: "preserve" } })],
      ["tsconfig.base.json", () => r.json("tsconfig.base.json", { compilerOptions: { strict: true, target: "es2022" } })],
      ["pnpm-lock.yaml", () => r.write("pnpm-lock.yaml", r.lock("4.0.0", "19.1.0"))],
      ["app/tsconfig.json", () => r.write("app/tsconfig.json", "{ // not JSON\n}")],
    ];
    for (const [file, change] of cases) {
      execFileSync("git", ["checkout", "-q", "--", "."], { cwd: r.dir, env: isolatedEnv() });
      change();
      assert.equal(r.reaches(file), true, file);
    }
    execFileSync("git", ["checkout", "-q", "--", "."], { cwd: r.dir, env: isolatedEnv() });
    assert.equal(reachesBuild("app/package.json", { root: r.dir }), true, "no base: any manifest change reaches");
    assert.equal(reachesBuild("app/new-tsconfig.json", { root: r.dir, base: r.base }), false, "not an app tsconfig name");
    assert.equal(reachesBuild("app/tsconfig.perf.json", { root: r.dir, base: r.base }), true, "a new tsconfig has no base side");
  } finally {
    fs.rmSync(r.dir, { recursive: true, force: true });
  }
});

test("the vitest runs take the related tests for sources, migrations, e2e files and app CSS", () => {
  assert.equal(
    relatedRun([
      "M\tapp/src/ui/hero.tsx",
      "A\tapp/src/screens/home-skeleton.test.tsx",
      "M\tapp/src/ui/css/07-band-home.css",
      "M\tapp/e2e/controls.spec.ts",
      "M\tpackages/shared/src/categories.ts",
      "A\tsupabase/migrations/20261013000000_x.sql",
    ]),
    true,
  );
  assert.equal(relatedRun([]), true);
});

test("the vitest runs take every test for setup, config, design, scripts or a removed file", () => {
  for (const line of [
    "M\tapp/src/test-setup.ts",
    "M\tapp/.storybook/preview.tsx",
    "M\tapp/vite.config.ts",
    "M\tdesign/system/implementation-tokens.css",
    "M\tscripts/storybook-stories.mjs",
    "M\tpnpm-lock.yaml",
    "D\tapp/src/ui/hero.tsx",
    "R100\tapp/src/ui/a.tsx\tapp/src/ui/b.tsx",
  ]) {
    assert.equal(relatedRun(["M\tapp/src/ui/hero.tsx", line]), false, line);
  }
});

test("with a base, a config change the tests don't read keeps the related run; one they read runs all", () => {
  const r = configRepo();
  try {
    const run = (...lines) => relatedRun(["M\tapp/src/ui/hero.tsx", ...lines], { root: r.dir, base: r.base });
    r.json("app/package.json", { ...r.app, scripts: { ...r.app.scripts, "test:perf": "playwright test -c perf" } });
    r.json("app/tsconfig.json", { ...r.tsconfig, include: ["src", "perf"] });
    r.write("pnpm-lock.yaml", r.lock("4.1.0", "19.0.0"));
    assert.equal(run("M\tapp/package.json", "M\tapp/tsconfig.json", "M\tpnpm-lock.yaml"), true);
    assert.equal(relatedRun(["M\tapp/package.json"]), false, "no base: a manifest runs all");
    r.json("app/package.json", { ...r.app, scripts: { ...r.app.scripts, test: "vitest run --pool forks" } });
    assert.equal(run("M\tapp/package.json"), false, "a test script");
    r.json("app/package.json", { ...r.app, devDependencies: { storybook: "9.1.0" } });
    assert.equal(run("M\tapp/package.json"), false, "a dependency");
    r.write("pnpm-lock.yaml", r.lock("4.0.0", "19.1.0"));
    assert.equal(run("M\tpnpm-lock.yaml"), false, "the app's lockfile entries");
    assert.equal(run("A\tapp/tsconfig.perf.json"), false, "a new tsconfig");
  } finally {
    fs.rmSync(r.dir, { recursive: true, force: true });
  }
});
