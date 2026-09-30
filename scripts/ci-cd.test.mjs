import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const push = readFileSync(new URL("./cd-push.sh", import.meta.url), "utf8");
const preflight = readFileSync(new URL("./cd-preflight.sh", import.meta.url), "utf8");

/** @param {string} name */
function job(name) {
  const marker = `\n  ${name}:\n`;
  const start = ci.indexOf(marker);
  assert.ok(start >= 0, name);
  const rest = ci.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z0-9-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

test("CI keeps the hosted and reviewer builds apart and skips live writers", () => {
  assert.match(ci, /pull_request:\n {2}push:\n {4}branches:\n {6}- main\n/);
  assert.equal(ci.includes("head.repo.full_name"), false);
  for (const name of ["lint", "check", "e2e"]) {
    assert.equal(job(name).includes("\n    if:"), false, name);
  }
  assert.match(ci, /pnpm check:bundle/);
  assert.match(ci, /pnpm check:reviewer-bundle/);
  assert.match(ci, /hosted-dist/);
  assert.match(ci, /reviewer-dist/);
  assert.match(ci, /storybook-static/);
  assert.match(ci, /supabase start/);
  assert.match(ci, /supabase test db/);
  assert.match(ci, /pnpm test:e2e\n/);
  assert.match(job("e2e"), /bash scripts\/cd-preflight.sh/);
  assert.match(job("e2e"), /bash scripts\/cd-dry-run-pending.sh/);
  assert.match(job("e2e"), /FLOW_CD_PREFLIGHT_LOCAL=1/);
  assert.equal(job("deploy").includes("FLOW_CD_PREFLIGHT_LOCAL"), false);
  assert.equal(ci.includes("test:e2e:live"), false);
  assert.equal(ci.includes("playwright.drain.config.ts"), false);
  assert.equal(ci.includes("sumit-live"), false);
});

test("deploy runs only after CI on a push to main, and the bundle is checked before the migration", () => {
  assert.equal(existsSync(new URL("../.github/workflows/cd.yml", import.meta.url)), false);
  const deploy = job("deploy");
  assert.match(deploy, /needs: \[lint, check, e2e\]/);
  assert.match(deploy, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(deploy, /environment: production/);
  assert.match(deploy, /group: cd-production/);
  assert.match(deploy, /cancel-in-progress: false/);
  assert.match(deploy, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4\.4\.0/);
  assert.match(deploy, /persist-credentials: false/);
  assert.match(deploy, /pnpm\/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320 # v4\.4\.0/);
  assert.match(deploy, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4\.4\.0/);
  assert.match(deploy, /supabase\/setup-cli@1dedf2c611547ede7232d26866dd3c56ab903bbb # v1\.7\.3/);
  assert.match(deploy, /SUPABASE_DB_URL/);
  assert.match(deploy, /CLOUDFLARE_API_TOKEN/);
  assert.match(deploy, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(deploy, /exit 1/);
  assert.equal(deploy.includes("SUPABASE_ACCESS_TOKEN"), false);
  assert.equal(deploy.includes("SUPABASE_DB_PASSWORD"), false);
  assert.equal(deploy.includes("npx"), false);
  assert.equal(deploy.includes("VITE_REVIEWER_BUILD"), false);
  assert.equal(deploy.includes("CD skipped"), false);
  assert.equal(deploy.includes("reviewer-dist"), false);
  assert.equal(deploy.includes("sumit-live"), false);
  assert.equal(deploy.includes("db reset"), false);
  assert.match(deploy, /pnpm exec wrangler pages deploy app\/dist/);
  assert.match(deploy, /project-name=flow-app/);
  assert.match(deploy, /--branch=main/);
  assert.match(deploy, /cd-smoke.sh/);

  const build = deploy.indexOf("pnpm build");
  const stamp = deploy.indexOf("stamp-build.mjs");
  const guard = deploy.indexOf("pnpm check:bundle");
  const migrate = deploy.indexOf("cd-push.sh");
  const publish = deploy.indexOf("pnpm exec wrangler");
  const smoke = deploy.indexOf("cd-smoke.sh");
  assert.ok(build >= 0 && stamp > build && guard > stamp && migrate > guard && publish > migrate && smoke > publish);

  assert.match(push, /cd-preflight.sh/);
  assert.match(push, /db push --db-url/);
  assert.equal(push.includes("--include-seed"), false);
  assert.equal(push.includes("db reset"), false);
  assert.match(preflight, /SET TRANSACTION READ ONLY/);
  assert.match(preflight, /-q -At -F '\|'/);
  assert.match(preflight, /cd-output.mjs read-only/);
  assert.match(preflight, /cd-output.mjs counts/);
  assert.match(preflight, /cd-output.mjs dry-run/);
  assert.match(preflight, /--dry-run/);
  assert.match(preflight, /preflight-r23.sql/);
  assert.equal(preflight.includes("tr -d"), false);
  assert.match(readFileSync(new URL("./cd-smoke.sh", import.meta.url), "utf8"), /cd-output\.mjs" equals/);
});
