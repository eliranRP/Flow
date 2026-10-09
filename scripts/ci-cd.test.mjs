import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const push = readFileSync(new URL("./cd-push.sh", import.meta.url), "utf8");
const preflight = readFileSync(new URL("./cd-preflight.sh", import.meta.url), "utf8");

const USES_PIN = /^\s*(?:-\s*)?uses: ([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([0-9a-f]{40}) # v\d+\.\d+\.\d+$/;
const ACTION_SHA = {
  "actions/checkout": "3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/setup-node": "820762786026740c76f36085b0efc47a31fe5020",
  "actions/cache": "55cc8345863c7cc4c66a329aec7e433d2d1c52a9",
  "actions/upload-artifact": "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  "pnpm/action-setup": "ea17c68df8912ef543352723c149a84f56e3d413",
  "supabase/setup-cli": "45a513f8c64c0bc8e0e3dfe572b5c95be85f6359",
  "denoland/setup-deno": "22d081ff2d3a40755e97629de92e3bcbfa7cf2ed",
};
const playwrightVersion = JSON.parse(readFileSync(new URL("../app/package.json", import.meta.url), "utf8")).devDependencies.playwright;
const PLAYWRIGHT_KEY = `key: \${{ runner.os }}-playwright-${playwrightVersion}`;
const PLAYWRIGHT_APT_KEY = `key: \${{ runner.os }}-playwright-apt-${playwrightVersion}-\${{ github.run_id }}\n          restore-keys: \${{ runner.os }}-playwright-apt-${playwrightVersion}\n`;
const INSTALL_DEPS = "run: bash scripts/ci-apt-cache.sh install";
const APT_RESTORE = "run: bash scripts/ci-apt-cache.sh restore";
const APT_SAVE = "run: bash scripts/ci-apt-cache.sh save";
const DENO_SHA256_X64 = "c6527f24f4b16031d3ae4fa9f658d5f11534c8d84ce7dc8502420280919c3490";
const DENO_SHA256_ARM64 = "c832298b1ad4422481334855f6003e0f54145762c5a134f20a489511d2f65bbf";
const SUPABASE_SHA256_AMD64 = "f6089a86fb9d9221c958193a277338daddd6822f706929943812fa32e106c86d";
const SUPABASE_SHA256_ARM64 = "0cd35fea97c2c93dce8a2cd661311be88c107233946cbe3692566196238859c5";

/** @param {string} name */
function job(name) {
  return jobIn(ci, name);
}

/** @param {string} text @param {string} name */
function jobIn(text, name) {
  const marker = `\n  ${name}:\n`;
  const start = text.indexOf(marker);
  assert.ok(start >= 0, name);
  const rest = text.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z0-9-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** @param {string} text */
function usesProblems(text) {
  /** @type {string[]} */
  const problems = [];
  for (const line of text.split("\n")) {
    if (!/^\s*(?:-\s*)?uses:/.test(line)) continue;
    const match = USES_PIN.exec(line);
    if (!match || ACTION_SHA[match[1]] !== match[2]) problems.push(line.trim());
  }
  return problems;
}

/** @param {string} body */
function installDepsStep(body) {
  const marker = "      - name: Install Playwright system dependencies\n";
  const start = body.indexOf(marker);
  if (start < 0) return "";
  const rest = body.slice(start);
  const next = rest.slice(marker.length).search(/\n      - /);
  return next === -1 ? rest : rest.slice(0, marker.length + next);
}

/** @param {string} text */
function playwrightProblems(text) {
  /** @type {string[]} */
  const problems = [];
  for (const name of ["check-storybook", "check-stories", "e2e-shard"]) {
    const body = jobIn(text, name);
    if (!body.includes(PLAYWRIGHT_KEY)) problems.push(`${name} cache key`);
    if (body.includes("env.ImageOS") || body.includes("env.ImageVersion")) problems.push(`${name} runner image`);
    const step = installDepsStep(body);
    if (!step.includes(INSTALL_DEPS)) problems.push(`${name} install-deps`);
    if (/\bif:/.test(step)) problems.push(`${name} install-deps condition`);
    if (!body.includes(PLAYWRIGHT_APT_KEY)) problems.push(`${name} apt cache key`);
    const restoreAt = body.indexOf(APT_RESTORE);
    const depsAt = body.indexOf(INSTALL_DEPS);
    const saveAt = body.indexOf(APT_SAVE);
    if (restoreAt < 0 || saveAt < 0 || !(restoreAt < depsAt && depsAt < saveAt)) problems.push(`${name} apt cache order`);
  }
  return problems;
}

/**
 * @param {string} text
 * @param {string} jobName
 * @param {string} from
 * @param {string} to
 */
function replaceInJob(text, jobName, from, to) {
  const body = jobIn(text, jobName);
  assert.equal(body.includes(from), true, from);
  const replaced = body.replace(from, to);
  const at = text.indexOf(body);
  assert.ok(at >= 0, jobName);
  return text.slice(0, at) + replaced + text.slice(at + body.length);
}

/** @param {string} script */
function checksumProblems(script) {
  /** @type {string[]} */
  const problems = [];
  const denoAt = script.indexOf("deno_version=");
  const supabaseAt = script.indexOf("supabase_version=");
  const deno = script.slice(denoAt, supabaseAt);
  const supabase = script.slice(supabaseAt);
  const ordered = (section, unpack) => {
    const curl = section.indexOf("curl ");
    const verify = section.indexOf("verify_sha256 ");
    const unpackAt = section.indexOf(unpack);
    return curl >= 0 && verify > curl && unpackAt > verify;
  };
  if (!ordered(deno, "unzip ")) problems.push("deno order");
  if (!ordered(supabase, "tar ")) problems.push("supabase order");
  for (const hash of [DENO_SHA256_X64, DENO_SHA256_ARM64, SUPABASE_SHA256_AMD64, SUPABASE_SHA256_ARM64]) {
    if (!script.includes(hash)) problems.push(hash);
  }
  return problems;
}

test("CI keeps the hosted and reviewer builds apart and skips live writers", () => {
  // Pull requests are gated by scripts/local-ci.sh. main runs CI in batches, or by hand.
  assert.match(ci, /\non:\n {2}push:\n {4}branches:\n {6}- main\n {2}workflow_dispatch:\n/);
  assert.equal(ci.includes("pull_request:"), false);
  assert.equal(ci.includes("head.repo.full_name"), false);
  assert.match(job("plan"), /run: bash scripts\/ci-deploy-plan\.sh\n/);
  assert.match(job("plan"), /FLOW_DEPLOY_BATCH: "5"\n/);
  assert.match(job("plan"), /fetch-depth: 0\n/);
  assert.match(job("plan"), /deployments: read\n/);
  for (const name of ["lint", "check-core", "check-storybook", "check-stories", "e2e-shard"]) {
    assert.match(job(name), /\n {4}needs: \[plan\]\n {4}if: needs\.plan\.outputs\.run == 'true'\n/, name);
  }
  // check and e2e are the required checks. They are gates that run always and pass only on success.
  assert.match(job("check"), /needs: \[plan, check-core, check-storybook, check-stories\]\n {4}if: always\(\) && needs\.plan\.outputs\.run == 'true'\n/);
  assert.match(job("check"), /test "\$CORE" = success\n/);
  for (const name of ["CORE", "STORYBOOK", "STORIES"]) {
    assert.match(job("check"), new RegExp(`test "\\$${name}" = success\n`), name);
  }
  assert.match(job("e2e"), /needs: \[plan, e2e-shard\]\n {4}if: always\(\) && needs\.plan\.outputs\.run == 'true'\n/);
  assert.match(job("e2e"), /test "\$SHARDS" = success\n/);
  assert.match(ci, /pnpm check:bundle/);
  assert.match(ci, /pnpm check:reviewer-bundle/);
  assert.match(ci, /supabase start/);
  assert.match(ci, /supabase test db/);
  assert.match(ci, /pnpm test:e2e --shard=\$\{\{ matrix\.shard \}\}\/3\n/);
  assert.match(job("check-stories"), /pnpm test:storybook:smoke --grep "every static story" --shard=\$\{\{ matrix\.shard \}\}\/4\n/);
  assert.match(job("check-storybook"), /pnpm test:storybook:smoke --grep-invert "every static story"\n/);
  assert.match(job("check-storybook"), /run: pnpm test:storybook\n/);
  assert.equal(ci.includes("check-unit"), false);
  assert.match(
    job("check-core"),
    /name: Mercury connector tests\n {8}env:\n {10}MERCURY_FIXTURE_DENYLIST: \$\{\{ secrets\.MERCURY_FIXTURE_DENYLIST \}\}/,
  );
  // check-core runs all of test:unit, @flow/app included. A new part of test:unit fails this pin
  // until CI runs it too.
  const rootPackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  // check-core excludes the root package by name ('!flow'), so its own test script does not run there.
  assert.equal(rootPackage.name, "flow");
  const rootScripts = rootPackage.scripts;
  const deno1 = "deno test --no-prompt --no-lock --node-modules-dir=none --ignore=supabase/functions/_shared/connectors supabase/functions/_shared";
  const deno2 = "deno test --no-prompt --node-modules-dir=none --config supabase/functions/_shared/connectors/deno.json supabase/functions/_shared/connectors";
  assert.equal(rootScripts["test:unit"], `node --test scripts/*.test.mjs && pnpm -r --if-present test && ${deno1} && ${deno2}`);
  const unitStep = job("check-core").slice(job("check-core").indexOf("- name: Unit tests"));
  for (const part of ["node --test scripts/*.test.mjs", "pnpm -r --if-present --filter '!flow' test", deno1, deno2]) {
    assert.ok(unitStep.includes(`\n          ${part}\n`), part);
  }
  assert.equal((job("check-core").match(/secrets\.MERCURY_FIXTURE_DENYLIST/g) ?? []).length, 1);
  assert.match(job("check-core"), /run: \|\n {10}pnpm test:connectors\n {10}node scripts\/check-deny-list\.mjs\n/);
  assert.match(ci, /node scripts\/check-migration-order.mjs/);
  assert.match(ci, /node scripts\/check-migration-transaction.mjs/);
  assert.match(job("e2e-shard"), /bash scripts\/cd-preflight.sh/);
  assert.match(job("e2e-shard"), /bash scripts\/cd-dry-run-pending.sh/);
  assert.match(job("e2e-shard"), /FLOW_CD_PREFLIGHT_LOCAL=1/);
  assert.equal(job("deploy").includes("FLOW_CD_PREFLIGHT_LOCAL"), false);
  assert.equal(ci.includes("test:e2e:live"), false);
  assert.equal(ci.includes("playwright.drain.config.ts"), false);
  assert.equal(ci.includes("sumit-live"), false);
});

test("deploy runs only after CI on a push to main, and the bundle is checked before the migration", () => {
  assert.equal(existsSync(new URL("../.github/workflows/cd.yml", import.meta.url)), false);
  const deploy = job("deploy");
  assert.match(deploy, /needs: \[plan, lint, check, e2e\]/);
  assert.match(deploy, /if: needs\.plan\.outputs\.run == 'true' && github\.ref == 'refs\/heads\/main'/);
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
  assert.match(deploy, /functions deploy jev-tag --project-ref sxqpnetmtufkzowutduq/);
  assert.match(deploy, /functions deploy push-send --project-ref sxqpnetmtufkzowutduq/);
  assert.match(job("check-core"), /denoland\/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed # v2\.0\.5/);
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
  const jevFn = deploy.indexOf("functions deploy jev-tag");
  const mktemp = deploy.indexOf("mktemp");
  const preflightStep = deploy.indexOf("bash scripts/cd-preflight.sh");
  const sumitSync = deploy.indexOf("functions deploy sumit-sync");
  const sumitConnect = deploy.indexOf("functions deploy sumit-connect");
  const sumitResealFn = deploy.indexOf("functions deploy sumit-reseal");
  const reseal = deploy.indexOf("bash scripts/cd-sumit-reseal.sh");
  assert.ok(build >= 0 && stamp > build && guard > stamp && migrate > guard && publish > migrate && smoke > publish);
  assert.ok(validate >= 0 && validate < probe && probe < migrate && publish < mktemp && mktemp < secretsFile && secretsFile < fn && fn < jevFn && jevFn < smoke);
  const mercuryConnect = deploy.indexOf("functions deploy mercury-connect");
  const mercurySync = deploy.indexOf("functions deploy mercury-sync");
  assert.ok(probe < preflightStep && preflightStep < sumitSync && sumitSync < sumitConnect && sumitConnect < sumitResealFn && sumitResealFn < reseal && reseal < mercuryConnect && mercuryConnect < mercurySync && mercurySync < migrate);
  const resealScript = readFileSync(new URL("./cd-sumit-reseal.sh", import.meta.url), "utf8");
  assert.match(resealScript, /::add-mask::/);
  assert.match(resealScript, /-H @-/);
  assert.equal(resealScript.includes("x-flow-cron: ${secret}"), false);
  assert.equal(deploy.slice(probe, migrate).includes("mktemp"), false);
  assert.equal(deploy.slice(probe, migrate).includes("FLOW_MCP_PEPPER"), false);
  assert.equal(deploy.slice(probe, migrate).includes("functions deploy flow-mcp"), false);
  assert.equal(deploy.slice(probe, migrate).includes("functions deploy jev-tag"), false);
  assert.match(deploy, /mktemp "\$RUNNER_TEMP\/flow-mcp-secrets\.XXXXXX"/);
  assert.match(deploy, /trap 'rm -f "\$envfile"' EXIT INT TERM/);
  assert.match(deploy, /if: always\(\)/);

  assert.match(push, /cd-preflight.sh/);
  assert.match(push, /db push --db-url/);
  assert.ok(push.indexOf("db push --db-url") < push.indexOf("bash scripts/check-sumit-cron.sh"));
  assert.equal(preflight.includes("check-sumit-cron"), false);
  const e2e = job("e2e-shard");
  assert.match(e2e, /bash scripts\/check-sumit-cron\.sh/);
  assert.ok(e2e.indexOf("supabase test db") < e2e.indexOf("check-sumit-cron.sh"));
  const psql = "run: bash scripts/ci-apt-cache.sh psql";
  assert.ok(e2e.includes(psql) && e2e.indexOf(psql) < e2e.indexOf("check-sumit-cron.sh"));
  assert.ok(job("deploy").includes(psql));
  // Every apt-get that reaches the mirror goes through scripts/ci-apt-cache.sh, with its time limit.
  assert.equal(/apt-get (update|install)/.test(ci), false);
  assert.equal(ci.includes("exec playwright install-deps"), false);
  assert.equal(push.includes("--include-seed"), false);
  assert.equal(push.includes("db reset"), false);
  assert.match(preflight, /SET TRANSACTION READ ONLY/);
  assert.match(preflight, /-q -At -F '\|'/);
  assert.match(preflight, /cd-output.mjs read-only/);
  assert.match(preflight, /cd-output.mjs counts/);
  assert.match(preflight, /cd-output.mjs dry-run --target remote/);
  assert.match(preflight, /node scripts\/cd-output\.mjs preflight-kind --target local "\$kind" <\/dev\/null/);
  assert.match(preflight, /node scripts\/cd-output\.mjs preflight-kind --target remote "\$kind" <\/dev\/null/);
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
  assert.match(owners, /^scripts\/check-migration-transaction\.mjs @eliranRP$/m);
  assert.match(owners, /^scripts\/preflight-r23\.sql @eliranRP$/m);
  assert.match(owners, /^\.github\/workflows\/ @eliranRP$/m);
  assert.match(owners, /^\.github\/CODEOWNERS @eliranRP$/m);
  assert.match(owners, /^package\.json @eliranRP$/m);
  assert.match(owners, /^pnpm-lock\.yaml @eliranRP$/m);
  assert.match(owners, /^supabase\/config\.toml @eliranRP$/m);
  const smokeScript = readFileSync(new URL("./cd-smoke.sh", import.meta.url), "utf8");
  assert.match(smokeScript, /cd-output\.mjs" equals/);
  assert.match(smokeScript, /\/settings\?preview=1/);
  assert.match(smokeScript, /settings_code" != "200"/);
});

test("CI bounds every job, cancels only pull requests, and installs Playwright browsers once", () => {
  assert.match(ci, /group: ci-\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}/);
  assert.match(ci, /cancel-in-progress: \$\{\{ github\.ref != 'refs\/heads\/main' \}\}/);
  assert.match(job("deploy"), /cancel-in-progress: false/);
  for (const name of ["lint", "check-core", "check-storybook", "check-stories", "e2e-shard"]) {
    assert.match(job(name), /timeout-minutes: 20\n/, name);
  }
  for (const name of ["check", "e2e"]) {
    assert.match(job(name), /timeout-minutes: 5\n/, name);
  }
  assert.match(job("deploy"), /timeout-minutes: 30\n/);
  const liveSmoke = job("deploy");
  assert.ok(liveSmoke.indexOf("bash scripts/cd-smoke.sh") < liveSmoke.indexOf("Read-only smoke of the live app"));
  assert.equal(liveSmoke.includes("::add-mask::$SMOKE_PASSWORD"), false);
  assert.match(liveSmoke, /SMOKE_EMAIL or SMOKE_PASSWORD is unset/);
  assert.match(liveSmoke, /Warning: read-only smoke skipped/);
  assert.match(liveSmoke, /GITHUB_STEP_SUMMARY/);
  assert.match(liveSmoke, /does not fail the deploy/);
  assert.match(liveSmoke, /exit 0/);
  assert.match(liveSmoke, /Production is already live/);
  assert.match(liveSmoke, /What failed:/);
  assert.match(liveSmoke, /The step log has the Playwright output/);
  assert.match(liveSmoke, /SMOKE_COMPANY_NAME: Flow Test/);
  assert.equal(liveSmoke.includes("tail "), false);
  assert.match(liveSmoke, /exit 1/);
  const smokeConfig = JSON.parse(execFileSync(process.execPath, [
    "--experimental-strip-types",
    "--input-type=module",
    "-e",
    `const mod = await import(${JSON.stringify(new URL("../app/playwright.smoke.config.ts", import.meta.url).href)});
     const config = mod.default;
     const reporter = config.reporter ?? [];
     process.stdout.write(JSON.stringify({
       retries: config.retries,
       baseURL: config.use?.baseURL ?? null,
       reporter: reporter.map((entry) => Array.isArray(entry) ? entry[0] : entry),
       defaultHost: mod.defaultSmokeHost,
       override: mod.smokeBaseURL({ SMOKE_BASE_URL: " http://127.0.0.1:43123 " }),
       blank: mod.smokeBaseURL({ SMOKE_BASE_URL: "   " }),
     }));`,
  ], {
    encoding: "utf8",
    env: { ...process.env, SMOKE_BASE_URL: "" },
  }));
  assert.equal(smokeConfig.retries, 1);
  assert.equal(smokeConfig.baseURL, "https://flow-app-dx5.pages.dev");
  assert.equal(smokeConfig.defaultHost, "https://flow-app-dx5.pages.dev");
  assert.equal(smokeConfig.override, "http://127.0.0.1:43123");
  assert.equal(smokeConfig.blank, "https://flow-app-dx5.pages.dev");
  assert.ok(smokeConfig.reporter.some((entry) => String(entry).endsWith("smoke-retry-reporter.ts")));
  const smokeSpec = readFileSync(new URL("../app/e2e/smoke-readonly.spec.ts", import.meta.url), "utf8");
  // The write guard lives in smoke-allow.ts (unit-tested there) and is anchored to the Supabase host.
  const smokeAllow = readFileSync(new URL("../app/e2e/smoke-allow.ts", import.meta.url), "utf8");
  assert.match(smokeSpec, /return isReadRequest\(request\.method\(\), request\.url\(\), hosted\.url\)/);
  assert.equal(smokeAllow.includes('if (url.includes("/auth/v1/")) return true'), false);
  assert.match(smokeAllow, /target\.origin === supabase\.origin/);
  assert.match(smokeAllow, /\/auth\/v1\/token/);
  assert.match(smokeAllow, /\/auth\/v1\/user/);
  const smokeRunbook = readFileSync(new URL("../docs/runbooks/smoke-user.md", import.meta.url), "utf8");
  assert.match(smokeRunbook, /Never set `is_demo`/);
  assert.match(smokeRunbook, /SMOKE_BASE_URL/);
  assert.equal(ci.includes("timeout-minutes: 45"), false);
  assert.equal(ci.includes("timeout-minutes: 40"), false);
  assert.equal(ci.includes("timeout-minutes: 10"), false);
  assert.equal(ci.includes("--with-deps"), false);
  assert.equal(ci.includes("env.ImageOS"), false);
  assert.equal(ci.includes("env.ImageVersion"), false);
  assert.match(ci, /timeout-minutes: 8\n\s+run: bash scripts\/ci-apt-cache\.sh install\n/);
  assert.match(ci, /timeout-minutes: 5\n\s+run: pnpm --filter @flow\/app exec playwright install chromium\n/);
  assert.match(ci, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7\.0\.0/);
  assert.match(ci, /actions\/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6\.1\.0/);
  assert.equal(ci.includes("upload-artifact"), false);
  assert.match(ci, /denoland\/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed # v2\.0\.5/);
  assert.deepEqual(usesProblems(ci), []);
  assert.deepEqual(playwrightProblems(ci), []);
  for (const name of ["check-storybook", "check-stories", "e2e-shard"]) {
    const step = installDepsStep(job(name));
    assert.equal(step.includes(INSTALL_DEPS), true, `${name} install-deps`);
    assert.equal(/\bif:/.test(step), false, `${name} install-deps condition`);
    assert.equal(job(name).includes(PLAYWRIGHT_KEY), true, `${name} cache key`);
  }
  assert.equal(job("deploy").includes("FLOW_CD_PREFLIGHT_LOCAL"), false);
});

test("the homepage and /settings retry like build.txt, list reads wait for the session, and a retry-pass stays out of the summary", () => {
  const smokeScript = readFileSync(new URL("./cd-smoke.sh", import.meta.url), "utf8");
  assert.match(smokeScript, /attempts=18/);
  assert.match(smokeScript, /SMOKE_RETRY_PAUSE:-10/);
  assert.equal((smokeScript.match(/seq 1 "\$attempts"/g) ?? []).length, 3);
  assert.match(smokeScript, /homepage is not \$\{sha\} yet/);
  assert.match(smokeScript, /\/settings is not \$\{sha\} yet/);
  const homeLoop = smokeScript.slice(
    smokeScript.indexOf("home_matched=0"),
    smokeScript.indexOf('"$home_matched" != 1'),
  );
  assert.match(homeLoop, /seq 1 "\$attempts"/);
  assert.match(homeLoop, /sleep "\$pause"/);
  assert.equal(homeLoop.includes("/settings"), false);

  const books = readFileSync(new URL("../app/src/use-books.ts", import.meta.url), "utf8");
  const waits = books.split("await waitForAccessToken(supabase);").length - 1;
  const rpcs = books.split(".rpc(").length - 1;
  const guardedFrom = (books.match(/await waitForAccessToken\(supabase\);\s+const \{ data, error \} = await supabase\s+\.from\(/g) ?? []).length;
  assert.equal(waits, rpcs + guardedFrom);
  assert.ok(waits >= 10);
  assert.match(books, /await waitForAccessToken\(supabase\);\n\s+dropLegacyJevConnectorKey\(\);\n\s+const listed = supabase\.rpc\("list_review"\)/);

  const smokeSpec = readFileSync(new URL("../app/e2e/smoke-readonly.spec.ts", import.meta.url), "utf8");
  assert.match(smokeSpec, /waitForStoredSession/);
  assert.ok(smokeSpec.indexOf("await waitForStoredSession(page)") < smokeSpec.indexOf("await Promise.all(pending)"));
  assert.match(smokeSpec, /x-client-info/);
  assert.match(smokeSpec, /access-control-allow-headers/);
  assert.ok(smokeSpec.indexOf("const statusCall = waitStatus(page)") < smokeSpec.indexOf('openList(page, "/settings"'));
  const http = readFileSync(new URL("../supabase/functions/_shared/http.ts", import.meta.url), "utf8");
  const handler = readFileSync(new URL("../supabase/functions/flow-mcp/handler.ts", import.meta.url), "utf8");
  assert.match(http, /export const corsAllowHeaders = "authorization, x-client-info, apikey, content-type, x-flow-cron, x-flow-company"/);
  assert.match(handler, /corsHeadersFor/);
  assert.equal(handler.includes('"authorization, content-type, apikey"'), false);

  const liveSmoke = job("deploy");
  assert.match(liveSmoke, /passed on retry/);
  assert.match(liveSmoke, /The Playwright output is in the step log, not in this summary/);
  const failedAt = liveSmoke.indexOf("### Read-only smoke failed");
  const failedEnd = liveSmoke.indexOf("exit 1", failedAt);
  const failedSummary = liveSmoke.slice(failedAt, failedEnd);
  assert.equal(failedSummary.includes("$log"), false);
  assert.equal(failedSummary.includes("cat "), false);
  const retryAt = liveSmoke.indexOf("passed on retry");
  const retryBlock = liveSmoke.slice(retryAt, liveSmoke.indexOf("cat \"$log\"", retryAt));
  assert.equal(retryBlock.includes("cat \"$log\""), false);

  const warning = execFileSync(process.execPath, [
    "--experimental-strip-types",
    "--input-type=module",
    "-e",
    `const mod = await import(${JSON.stringify(new URL("../app/e2e/smoke-retry-reporter.ts", import.meta.url).href)});
     process.stdout.write(mod.retryWarning(["home › loads"]));`,
  ], { encoding: "utf8" });
  assert.match(warning, /### Warning: read-only smoke passed on retry/);
  assert.match(warning, /home › loads/);
  assert.match(warning, /not in this summary/);
  assert.equal(warning.includes("Error:"), false);
  assert.equal(warning.includes("list_unpaid"), false);
});

test("a wrong pin in one job fails, and install-deps stays unconditional", () => {
  const lintPnpm = replaceInJob(
    ci,
    "lint",
    `uses: pnpm/action-setup@${ACTION_SHA["pnpm/action-setup"]}`,
    `uses: pnpm/action-setup@${ACTION_SHA["actions/checkout"]}`,
  );
  assert.deepEqual(usesProblems(lintPnpm), [
    `- uses: pnpm/action-setup@${ACTION_SHA["actions/checkout"]} # v6.1.0`,
  ]);
  assert.equal(jobIn(lintPnpm, "e2e-shard").includes(`pnpm/action-setup@${ACTION_SHA["pnpm/action-setup"]}`), true);

  const e2eCli = replaceInJob(
    ci,
    "e2e-shard",
    `uses: supabase/setup-cli@${ACTION_SHA["supabase/setup-cli"]}`,
    `uses: supabase/setup-cli@${ACTION_SHA["actions/setup-node"]}`,
  );
  assert.deepEqual(usesProblems(e2eCli), [
    `- uses: supabase/setup-cli@${ACTION_SHA["actions/setup-node"]} # v3.0.1`,
  ]);
  assert.equal(jobIn(e2eCli, "deploy").includes(`supabase/setup-cli@${ACTION_SHA["supabase/setup-cli"]}`), true);

  const oneCache = replaceInJob(
    ci,
    "check-storybook",
    `uses: actions/cache@${ACTION_SHA["actions/cache"]}`,
    `uses: actions/cache@${ACTION_SHA["denoland/setup-deno"]}`,
  );
  assert.deepEqual(usesProblems(oneCache), [
    `uses: actions/cache@${ACTION_SHA["denoland/setup-deno"]} # v6.1.0`,
  ]);
  assert.equal(
    jobIn(oneCache, "check-storybook").split(`actions/cache@${ACTION_SHA["actions/cache"]}`).length - 1,
    1,
  );

  const swapped = ci.replace(
    `uses: actions/checkout@${ACTION_SHA["actions/checkout"]} # v7.0.1`,
    "uses: actions/checkout@v4",
  );
  assert.deepEqual(usesProblems(swapped), ["- uses: actions/checkout@v4"]);
  assert.deepEqual(usesProblems(ci), []);
  assert.deepEqual(playwrightProblems(ci), []);

  const e2eBody = jobIn(ci, "e2e-shard");
  const conditional = e2eBody.replace(
    "      - name: Install Playwright system dependencies\n",
    "      - name: Install Playwright system dependencies\n        if: steps.playwright-cache.outputs.cache-hit != 'true'\n",
  );
  const at = ci.indexOf(e2eBody);
  const withIf = ci.slice(0, at) + conditional + ci.slice(at + e2eBody.length);
  assert.deepEqual(playwrightProblems(withIf), ["e2e-shard install-deps condition"]);
  assert.equal(/\bif:/.test(installDepsStep(jobIn(withIf, "check-storybook"))), false);
});

test("every Playwright job restores the apt cache before install-deps and saves it after", () => {
  const noSave = replaceInJob(ci, "check-stories", "      - name: Keep Playwright system packages for the next run\n        " + APT_SAVE + "\n", "");
  assert.deepEqual(playwrightProblems(noSave), ["check-stories apt cache order"]);
  const wrongKey = replaceInJob(ci, "e2e-shard", PLAYWRIGHT_APT_KEY, "key: ${{ runner.os }}-playwright-apt-0.0.0\n");
  assert.deepEqual(playwrightProblems(wrongKey), ["e2e-shard apt cache key"]);
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
  assert.deepEqual(checksumProblems(install), []);
  const stripped = install.replaceAll("verify_sha256", "skip_sha256");
  const strippedProblems = checksumProblems(stripped);
  assert.equal(strippedProblems.includes("deno order"), true);
  assert.equal(strippedProblems.includes("supabase order"), true);
});

test("aarch64 selects the arm64 Deno checksum", () => {
  const install = readFileSync(new URL("./cloud-agent-install.sh", import.meta.url), "utf8");
  const hashesAt = install.indexOf('deno_sha256_x86_64=');
  const hashesEnd = install.indexOf("if ! command -v deno");
  const blockAt = install.indexOf('  asset="deno-x86_64-unknown-linux-gnu.zip"');
  const blockEnd = install.indexOf("  esac", blockAt);
  assert.ok(hashesAt >= 0 && hashesEnd > hashesAt && blockAt > hashesEnd && blockEnd > blockAt);
  const snippet = `${install.slice(hashesAt, hashesEnd)}\n${install.slice(blockAt, blockEnd + "  esac".length)}`;
  const selected = (arch) => execFileSync(
    "bash",
    ["-c", `arch="$1"\nuname() { echo "$arch"; }\n${snippet}\nprintf '%s\\n%s\\n' "$asset" "$deno_sha256"`, "bash", arch],
    { encoding: "utf8" },
  ).trim().split("\n");
  assert.deepEqual(selected("aarch64"), ["deno-aarch64-unknown-linux-gnu.zip", DENO_SHA256_ARM64]);
  assert.deepEqual(selected("arm64"), ["deno-aarch64-unknown-linux-gnu.zip", DENO_SHA256_ARM64]);
  assert.deepEqual(selected("x86_64"), ["deno-x86_64-unknown-linux-gnu.zip", DENO_SHA256_X64]);
});

test("verify_sha256 rejects a download that does not match the pinned checksum", () => {
  const install = readFileSync(new URL("./cloud-agent-install.sh", import.meta.url), "utf8");
  const start = install.indexOf("verify_sha256()");
  const end = install.indexOf("\n}\n", start);
  assert.ok(start >= 0 && end > start, "verify_sha256");
  const fn = install.slice(start, end + 3);
  const dir = mkdtempSync(join(tmpdir(), "cloud-sha-"));
  const file = join(dir, "blob");
  try {
    writeFileSync(file, "not-the-archive");
    const good = createHash("sha256").update("not-the-archive").digest("hex");
    execFileSync("bash", ["-c", `${fn}\nverify_sha256 "$1" "$2"`, "bash", file, good], { stdio: "pipe" });
    let failed = false;
    try {
      execFileSync("bash", ["-c", `${fn}\nverify_sha256 "$1" "$2"`, "bash", file, "0".repeat(64)], { stdio: "pipe" });
    } catch (error) {
      failed = true;
      assert.equal(error.status, 1);
    }
    assert.equal(failed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("local-ci.sh runs every part of the CI suite, and the pre-push hook runs it", () => {
  const local = readFileSync(new URL("./local-ci.sh", import.meta.url), "utf8");
  for (const part of [
    "pnpm lint",
    "node scripts/check-migration-order.mjs --base",
    "node scripts/check-migration-transaction.mjs",
    "node scripts/check-file-size.mjs",
    "deno test --allow-env --config supabase/functions/flow-mcp/deno.json supabase/functions/flow-mcp",
    "pnpm typecheck",
    "pnpm test:unit",
    "pnpm test:connectors",
    "pnpm check:bundle",
    "pnpm check:reviewer-bundle",
    "pnpm test:storybook\n",
    "pnpm build-storybook",
    "pnpm test:storybook:smoke\n",
    "supabase start -x studio,postgres-meta,logflare,vector,mailpit,imgproxy,supavisor,realtime",
    "bash scripts/mcp-function-smoke.sh",
    "supabase test db supabase/tests/database",
    "bash scripts/check-db-types.sh",
    "bash scripts/cd-preflight.sh",
    "bash scripts/cd-dry-run-pending.sh",
    "bash scripts/check-sumit-cron.sh",
    "pnpm test:e2e\n",
  ]) {
    assert.ok(local.includes(part), part);
    assert.ok(ci.includes(part.trim().replace(/^pnpm test:e2e$/, "pnpm test:e2e --shard")), `CI ${part}`);
  }
  // The fast gate stamps after the Storybook tests; --full stamps only after e2e.
  const stamps = [...local.matchAll(/echo "\$head" >/g)].map((m) => m.index);
  assert.equal(stamps.length, 2);
  // The fast gate stamps after the scoped Storybook smoke; --full runs the whole smoke after it.
  const scoped = local.indexOf('FLOW_STORY_SCOPE="$scope" pnpm test:storybook:smoke --reporter=line --grep "every static story"');
  assert.ok(scoped > local.indexOf("pnpm test:storybook\n") && stamps[0] > scoped);
  assert.ok(stamps[0] < local.indexOf("pnpm test:storybook:smoke\n"));
  assert.ok(local.indexOf("if (( ! full )); then") < stamps[0]);
  assert.ok(stamps[1] > local.indexOf("pnpm test:e2e\n"), "--full stamps last");
  // FLOW-813: the fast gate runs the e2e specs that reach the change before it stamps.
  const picked = local.indexOf('playwright test --fully-parallel "${e2e_specs[@]}"');
  assert.ok(picked > local.indexOf("pnpm test:storybook\n") && picked < stamps[0]);
  assert.match(local, /--full\) full=1 ;;/);
  // FLOW-813: --full and FLOW_LOCAL_CI_NO_SKIP never skip a part.
  assert.ok(local.includes('if (( full )) || [[ -n "${FLOW_LOCAL_CI_NO_SKIP:-}" ]]; then skips=0; fi'));
  assert.match(local, /green\(\) \{\n  \(\( skips \)\) && /);
  const hook = readFileSync(new URL("../.githooks/pre-push", import.meta.url), "utf8");
  assert.match(hook, /bash "\$root\/scripts\/local-ci\.sh" <\/dev\/null/);
  assert.match(hook, /bash "\$root\/scripts\/local-ci\.sh" --full <\/dev\/null/);
  const install = readFileSync(new URL("./cloud-agent-install.sh", import.meta.url), "utf8");
  assert.match(install, /git config core\.hooksPath \.githooks\n/);
});
