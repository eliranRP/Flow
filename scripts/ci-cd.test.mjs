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
  assert.match(ci, /node scripts\/check-migration-order.mjs/);
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
  assert.match(deploy, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\.0\.1/);
  assert.match(deploy, /persist-credentials: false/);
  assert.match(deploy, /pnpm\/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6\.1\.0/);
  assert.match(deploy, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7\.0\.0/);
  assert.match(deploy, /supabase\/setup-cli@45a513f8c64c0bc8e0e3dfe572b5c95be85f6359 # v3\.0\.1/);
  assert.match(deploy, /SUPABASE_DB_URL/);
  assert.match(deploy, /CLOUDFLARE_API_TOKEN/);
  assert.match(deploy, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(readFileSync(new URL("./cd-mcp-secrets.mjs", import.meta.url), "utf8"), /process\.exit\(1\)/);
  assert.match(deploy, /SUPABASE_ACCESS_TOKEN/);
  assert.equal(deploy.includes("FLOW_MCP_SIGNING_KEY"), false);
  assert.match(deploy, /FLOW_MCP_PEPPER/);
  assert.match(deploy, /node scripts\/cd-mcp-secrets\.mjs/);
  assert.match(deploy, /--env-file/);
  assert.match(deploy, /functions deploy flow-mcp --project-ref sxqpnetmtufkzowutduq/);
  assert.match(job("check"), /denoland\/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed # v2\.0\.5/);
  assert.equal(deploy.includes("FLOW_JWT_LEGACY"), false);
  assert.equal(deploy.includes("FLOW_SECRET_KEY"), false);
  assert.equal(deploy.includes("service_role"), false);
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
  const validate = deploy.indexOf("cd-mcp-secrets.mjs");
  const probe = deploy.indexOf("functions list");
  const secretsFile = deploy.indexOf("--env-file");
  const fn = deploy.indexOf("functions deploy flow-mcp");
  const mktemp = deploy.indexOf("mktemp");
  assert.ok(build >= 0 && stamp > build && guard > stamp && migrate > guard && publish > migrate && smoke > publish);
  assert.ok(validate >= 0 && validate < probe && probe < migrate && publish < mktemp && mktemp < secretsFile && secretsFile < fn && fn < smoke);
  assert.equal(deploy.slice(probe, migrate).includes("mktemp"), false);
  assert.equal(deploy.slice(probe, migrate).includes("FLOW_MCP_PEPPER"), false);
  assert.match(deploy, /mktemp "\$RUNNER_TEMP\/flow-mcp-secrets\.XXXXXX"/);
  assert.match(deploy, /trap 'rm -f "\$envfile"' EXIT INT TERM/);
  assert.match(deploy, /if: always\(\)/);

  assert.match(push, /cd-preflight.sh/);
  assert.match(push, /db push --db-url/);
  assert.equal(push.includes("--include-seed"), false);
  assert.equal(push.includes("db reset"), false);
  assert.match(preflight, /SET TRANSACTION READ ONLY/);
  assert.match(preflight, /-q -At -F '\|'/);
  assert.match(preflight, /cd-output.mjs read-only/);
  assert.match(preflight, /cd-output.mjs counts/);
  assert.match(preflight, /cd-output.mjs dry-run --target remote/);
  assert.match(preflight, /cd-output.mjs preflight-kind --target local/);
  assert.match(preflight, /cd-output.mjs preflight-kind --target remote/);
  assert.match(preflight, /db push --db-url "\$SUPABASE_DB_URL" --dry-run --output-format json/);
  assert.match(readFileSync(new URL("./cd-dry-run-pending.sh", import.meta.url), "utf8"), /--output-format json/);
  assert.match(preflight, /--dry-run/);
  assert.match(preflight, /preflight-r23.sql/);
  assert.match(preflight, /backfill-recorded/);
  assert.match(preflight, /rule-risk/);
  assert.equal(preflight.includes("tr -d"), false);
  assert.equal(preflight.includes("Preflight failed"), false);
  const owners = readFileSync(new URL("../.github/CODEOWNERS", import.meta.url), "utf8");
  assert.match(owners, /^supabase\/migrations\/ @eliranRP$/m);
  assert.match(owners, /^supabase\/migrations\.lock @eliranRP$/m);
  assert.match(owners, /^scripts\/cd-\* @eliranRP$/m);
  assert.match(owners, /^scripts\/check-migration-order\.mjs @eliranRP$/m);
  assert.match(owners, /^scripts\/preflight-r23\.sql @eliranRP$/m);
  assert.match(owners, /^\.github\/workflows\/ @eliranRP$/m);
  assert.match(owners, /^\.github\/CODEOWNERS @eliranRP$/m);
  assert.match(owners, /^package\.json @eliranRP$/m);
  assert.match(owners, /^pnpm-lock\.yaml @eliranRP$/m);
  assert.match(owners, /^supabase\/config\.toml @eliranRP$/m);
  assert.match(readFileSync(new URL("./cd-smoke.sh", import.meta.url), "utf8"), /cd-output\.mjs" equals/);
});

test("CI bounds every job, cancels only pull requests, and installs Playwright browsers once", () => {
  assert.match(ci, /group: ci-\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}/);
  assert.match(ci, /cancel-in-progress: \$\{\{ github\.ref != 'refs\/heads\/main' \}\}/);
  assert.match(job("deploy"), /cancel-in-progress: false/);
  for (const name of ["lint", "check", "e2e", "deploy"]) {
    assert.match(job(name), /timeout-minutes: 20\n/, name);
  }
  assert.equal(ci.includes("timeout-minutes: 45"), false);
  assert.equal(ci.includes("timeout-minutes: 40"), false);
  assert.equal(ci.includes("timeout-minutes: 10"), false);
  assert.equal(ci.includes("--with-deps"), false);
  assert.match(ci, /if: steps\.playwright-cache\.outputs\.cache-hit != 'true'/);
  assert.match(ci, /timeout-minutes: 5\n\s+run: pnpm --filter @flow\/app exec playwright install-deps chromium/);
  assert.match(ci, /timeout-minutes: 5\n\s+run: pnpm --filter @flow\/app exec playwright install chromium\n/);
  assert.match(ci, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\.0\.1/);
  assert.match(ci, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7\.0\.0/);
  assert.match(ci, /actions\/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6\.1\.0/);
  assert.match(ci, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7\.0\.1/);
  assert.match(ci, /denoland\/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed # v2\.0\.5/);
  assert.equal(ci.includes("uses: actions/checkout@v"), false);
  assert.equal(ci.includes("uses: pnpm/action-setup@v"), false);
  assert.equal(ci.includes("uses: supabase/setup-cli@v"), false);
  assert.equal(job("deploy").includes("FLOW_CD_PREFLIGHT_LOCAL"), false);
});

test("the cloud agent install script prepares pnpm, Playwright, Supabase CLI, and Deno", () => {
  const env = JSON.parse(readFileSync(new URL("../.cursor/environment.json", import.meta.url), "utf8"));
  assert.equal(env.install, "bash scripts/cloud-agent-install.sh");
  const install = readFileSync(new URL("./cloud-agent-install.sh", import.meta.url), "utf8");
  assert.match(install, /pnpm@10\.33\.3/);
  assert.match(install, /playwright install --with-deps chromium/);
  assert.match(install, /supabase_\$\{supabase_version\}_linux_/);
  assert.match(install, /deno \$\{deno_version\}/);
  assert.match(install, /\/usr\/local\/bin\/deno/);
  assert.match(install, /\/usr\/local\/bin\/supabase/);
  assert.equal(install.includes("SUPABASE_ACCESS_TOKEN"), false);
});
