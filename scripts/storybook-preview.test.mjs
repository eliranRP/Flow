import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { changedStories, MARKER, previewComment, sharedChanged } from "./storybook-preview-comment.mjs";
import { previewKeyViolations } from "./storybook-preview-keys.mjs";

const workflow = readFileSync(new URL("../.github/workflows/storybook-preview.yml", import.meta.url), "utf8");
const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const storybookMain = readFileSync(new URL("../app/.storybook/main.ts", import.meta.url), "utf8");

const entries = [
  { id: "screens-loans-list--grouped", title: "Screens/Loans list", name: "Grouped", importPath: "./src/screens/loan-list.stories.tsx", type: "story" },
  { id: "screens-loans-list--only-closed", title: "Screens/Loans list", name: "Only closed", importPath: "./src/screens/loan-list.stories.tsx", type: "story" },
  { id: "components-listrow--project", title: "Components/ListRow", name: "Project", importPath: "./src/ui/list-row.stories.tsx", type: "story" },
  { id: "components-listrow--docs", title: "Components/ListRow", name: "Docs", importPath: "./src/ui/list-row.stories.tsx", type: "docs" },
];

test("a changed stories file or its module names that file's stories", () => {
  assert.deepEqual(changedStories(entries, ["app/src/screens/loan-list.tsx"]).map((s) => s.id), [
    "screens-loans-list--grouped",
    "screens-loans-list--only-closed",
  ]);
  assert.deepEqual(changedStories(entries, ["app/src/ui/list-row.stories.tsx"]).map((s) => s.id), ["components-listrow--project"]);
  assert.deepEqual(changedStories(entries, ["supabase/migrations/x.sql", "app/src/screens/other.tsx"]), []);
});

test("shared styles and the Storybook setup are called out", () => {
  assert.equal(sharedChanged(["app/src/ui/css/01-base.css"]), true);
  assert.equal(sharedChanged(["app/.storybook/preview.tsx"]), true);
  assert.equal(sharedChanged(["app/src/screens/loan-list.tsx"]), false);
});

test("the comment carries the marker, the link, and one link per changed story", () => {
  const body = previewComment({
    entries,
    changed: ["app/src/screens/loan-list.stories.tsx", "app/src/ui/css/01-base.css"],
    url: "https://pr-9.flow-storybook.pages.dev/",
    sha: "0123456789abcdef",
  });
  assert.ok(body.startsWith(`${MARKER}\n`));
  assert.match(body, /for 0123456: https:\/\/pr-9\.flow-storybook\.pages\.dev\/\n/);
  assert.match(body, /Shared styles or the Storybook setup changed/);
  assert.match(body, /Stories this pull request changed \(2\):/);
  assert.match(body, /- \[Screens\/Loans list \/ Grouped\]\(https:\/\/pr-9\.flow-storybook\.pages\.dev\/\?path=\/story\/screens-loans-list--grouped\)/);
  const none = previewComment({ entries, changed: ["docs/x.md"], url: "https://x.pages.dev", sha: "abc" });
  assert.match(none, /No stories file changed/);
});

test("the key check fails on the hosted project or a JWT and passes sample data", () => {
  const clean = mkdtempSync(path.join(tmpdir(), "sb-clean-"));
  mkdirSync(path.join(clean, "assets"));
  writeFileSync(path.join(clean, "assets", "a.js"), 'const url="https://example.supabase.co";const key="storybook-sample-anon-key";');
  assert.deepEqual(previewKeyViolations(clean), []);
  const dirty = mkdtempSync(path.join(tmpdir(), "sb-dirty-"));
  mkdirSync(path.join(dirty, "assets"));
  writeFileSync(path.join(dirty, "assets", "b.js"), `const url="https://${"sxqpnetmtufkzowutduq"}.supabase.co";`);
  writeFileSync(path.join(dirty, "c.json"), `{"k":"${"eyJhbGciOi"}JIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.x"}`);
  assert.deepEqual(previewKeyViolations(dirty).sort(), [
    "assets/b.js: the hosted Supabase project",
    "c.json: a JWT (a Supabase anon or service key)",
  ]);
});

test("the check fails on the app's Pages rules at the build's root (0192)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sb-rules-"));
  writeFileSync(path.join(dir, "_headers"), "/*\n  X-Frame-Options: DENY\n");
  writeFileSync(path.join(dir, "_redirects"), "/sign-in /app-shell 200\n");
  assert.deepEqual(previewKeyViolations(dir).map((line) => line.split(":")[0]).sort(), ["_headers", "_redirects"]);
});

test("Storybook leaves the app's public folder out and copies only the favicon", () => {
  assert.match(storybookMain, /config\.publicDir = false;/);
  assert.equal(/from: "\.\.\/public"\s*[,}]/.test(storybookMain), false, "staticDirs must not copy the whole public folder");
});

test("Storybook replaces the hosted Supabase settings with sample ones", () => {
  assert.match(storybookMain, /"import\.meta\.env\.VITE_SUPABASE_URL": JSON\.stringify\("https:\/\/example\.supabase\.co"\)/);
  assert.match(storybookMain, /"import\.meta\.env\.VITE_SUPABASE_ANON_KEY": JSON\.stringify\("storybook-sample-anon-key"\)/);
});

test("the preview workflow skips forks, keeps off production, and pins actions like ci", () => {
  assert.match(workflow, /\non:\n {2}pull_request:\n/);
  assert.equal(workflow.includes("pull_request_target"), false);
  assert.match(workflow, /if: github\.event\.pull_request\.head\.repo\.full_name == github\.repository && !github\.event\.pull_request\.draft\n/);
  assert.match(workflow, /environment: storybook-preview\n/);
  assert.equal(/environment: production/.test(workflow), false);
  assert.match(workflow, /persist-credentials: false\n/);
  assert.match(workflow, /\npermissions:\n {2}contents: read\n/);
  // The key checks run before anything is published.
  const build = workflow.indexOf("node scripts/storybook-preview-keys.mjs preview/storybook-static");
  assert.ok(build > 0 && build < workflow.indexOf("wrangler pages deploy"));
  assert.ok(workflow.indexOf("node scripts/check-jev-bundle.mjs preview/storybook-static") < workflow.indexOf("wrangler pages deploy"));
  assert.match(workflow, /--project-name=flow-storybook \\\n/);
  assert.equal(workflow.includes("--project-name=flow-app"), false);
  const pins = new Set(ci.split("\n").filter((line) => /^\s*(?:-\s*)?uses:/.test(line)).map((line) => line.trim().replace(/^- /, "")));
  for (const line of workflow.split("\n").filter((l) => /^\s*(?:-\s*)?uses:/.test(l))) {
    assert.ok(pins.has(line.trim().replace(/^- /, "")), `pinned as in ci.yml: ${line.trim()}`);
  }
});

// FLOW-853: the pull request's code (its dependencies and its scripts included) builds in a job that holds
// no secret; only the deploy job reads the Cloudflare token, and it runs code from the base commit alone.
function previewJob(name) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.ok(start > 0, `job ${name}`);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

test("the preview builds the pull request without secrets and deploys it with code from the base", () => {
  const build = previewJob("build");
  const deploy = previewJob("deploy");
  assert.equal(build.includes("secrets."), false);
  assert.equal(build.includes("environment:"), false);
  assert.match(build, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}\n/);
  assert.match(build, /run: pnpm build-storybook\n/);
  assert.match(build, /uses: actions\/upload-artifact@/);
  assert.match(deploy, /\n {4}needs: build\n/);
  assert.match(deploy, /\n {4}environment: storybook-preview\n/);
  assert.match(deploy, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}\n/);
  assert.equal(deploy.includes("head.sha }}\n          fetch-depth"), false);
  assert.equal(/ref: \$\{\{ github\.event\.pull_request\.head\.sha/.test(deploy), false);
  assert.equal(deploy.includes("pnpm build-storybook"), false);
  assert.match(deploy, /uses: actions\/download-artifact@/);
  assert.ok(deploy.includes("secrets.CLOUDFLARE_API_TOKEN"));
  assert.equal(workflow.split("secrets.CLOUDFLARE_API_TOKEN").length, 2, "the token is read in one place");
});
