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
const INSTALL_DEPS = "run: pnpm --filter @flow/app exec playwright install-deps chromium";
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
  for (const name of ["check", "e2e"]) {
    const body = jobIn(text, name);
    if (!body.includes(PLAYWRIGHT_KEY)) problems.push(`${name} cache key`);
    if (body.includes("env.ImageOS") || body.includes("env.ImageVersion")) problems.push(`${name} runner image`);
    const step = installDepsStep(body);
    if (!step.includes(INSTALL_DEPS)) problems.push(`${name} install-deps`);
    if (/\bif:/.test(step)) problems.push(`${name} install-deps condition`);
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
  assert.match(ci, /node scripts\/check-migration-transaction.mjs/);
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
  assert.match(deploy, /functions deploy jev-tag --project-ref sxqpnetmtufkzowutduq/);
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
  const jevFn = deploy.indexOf("functions deploy jev-tag");
  const mktemp = deploy.indexOf("mktemp");
  const preflightStep = deploy.indexOf("bash scripts/cd-preflight.sh");
  const sumitSync = deploy.indexOf("functions deploy sumit-sync");
  const sumitConnect = deploy.indexOf("functions deploy sumit-connect");
  const sumitResealFn = deploy.indexOf("functions deploy sumit-reseal");
  const reseal = deploy.indexOf("bash scripts/cd-sumit-reseal.sh");
  assert.ok(build >= 0 && stamp > build && guard > stamp && migrate > guard && publish > migrate && smoke > publish);
  assert.ok(validate >= 0 && validate < probe && probe < migrate && publish < mktemp && mktemp < secretsFile && secretsFile < fn && fn < jevFn && jevFn < smoke);
  assert.ok(probe < preflightStep && preflightStep < sumitSync && sumitSync < sumitConnect && sumitConnect < sumitResealFn && sumitResealFn < reseal && reseal < migrate);
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
  const e2e = job("e2e");
  assert.match(e2e, /bash scripts\/check-sumit-cron\.sh/);
  assert.ok(e2e.indexOf("supabase test db") < e2e.indexOf("check-sumit-cron.sh"));
  assert.ok(e2e.indexOf("postgresql-client") < e2e.indexOf("check-sumit-cron.sh"));
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
  for (const name of ["lint", "check", "e2e"]) {
    assert.match(job(name), /timeout-minutes: 20\n/, name);
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
  const smokeConfig = readFileSync(new URL("../app/playwright.smoke.config.ts", import.meta.url), "utf8");
  assert.match(smokeConfig, /retries: 1/);
  assert.match(smokeConfig, /smoke-retry-reporter/);
  const smokeSpec = readFileSync(new URL("../app/e2e/smoke-readonly.spec.ts", import.meta.url), "utf8");
  assert.equal(smokeSpec.includes('if (url.includes("/auth/v1/")) return true'), false);
  assert.match(smokeSpec, /return isAuthAllowed\(request\)/);
  assert.match(smokeSpec, /\/auth\/v1\/token/);
  assert.match(smokeSpec, /\/auth\/v1\/user/);
  const smokeRunbook = readFileSync(new URL("../docs/runbooks/smoke-user.md", import.meta.url), "utf8");
  assert.match(smokeRunbook, /Never set `is_demo`/);
  assert.equal(ci.includes("timeout-minutes: 45"), false);
  assert.equal(ci.includes("timeout-minutes: 40"), false);
  assert.equal(ci.includes("timeout-minutes: 10"), false);
  assert.equal(ci.includes("--with-deps"), false);
  assert.equal(ci.includes("env.ImageOS"), false);
  assert.equal(ci.includes("env.ImageVersion"), false);
  assert.match(ci, /timeout-minutes: 5\n\s+run: pnpm --filter @flow\/app exec playwright install-deps chromium/);
  assert.match(ci, /timeout-minutes: 5\n\s+run: pnpm --filter @flow\/app exec playwright install chromium\n/);
  assert.match(ci, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7\.0\.0/);
  assert.match(ci, /actions\/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6\.1\.0/);
  assert.match(ci, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7\.0\.1/);
  assert.match(ci, /denoland\/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed # v2\.0\.5/);
  assert.deepEqual(usesProblems(ci), []);
  assert.deepEqual(playwrightProblems(ci), []);
  for (const name of ["check", "e2e"]) {
    const step = installDepsStep(job(name));
    assert.equal(step.includes(INSTALL_DEPS), true, `${name} install-deps`);
    assert.equal(/\bif:/.test(step), false, `${name} install-deps condition`);
    assert.equal(job(name).includes(PLAYWRIGHT_KEY), true, `${name} cache key`);
  }
  assert.equal(job("deploy").includes("FLOW_CD_PREFLIGHT_LOCAL"), false);
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
  assert.equal(jobIn(lintPnpm, "e2e").includes(`pnpm/action-setup@${ACTION_SHA["pnpm/action-setup"]}`), true);

  const e2eCli = replaceInJob(
    ci,
    "e2e",
    `uses: supabase/setup-cli@${ACTION_SHA["supabase/setup-cli"]}`,
    `uses: supabase/setup-cli@${ACTION_SHA["actions/setup-node"]}`,
  );
  assert.deepEqual(usesProblems(e2eCli), [
    `- uses: supabase/setup-cli@${ACTION_SHA["actions/setup-node"]} # v3.0.1`,
  ]);
  assert.equal(jobIn(e2eCli, "deploy").includes(`supabase/setup-cli@${ACTION_SHA["supabase/setup-cli"]}`), true);

  const oneUpload = replaceInJob(
    ci,
    "check",
    `uses: actions/upload-artifact@${ACTION_SHA["actions/upload-artifact"]}`,
    `uses: actions/upload-artifact@${ACTION_SHA["denoland/setup-deno"]}`,
  );
  assert.deepEqual(usesProblems(oneUpload), [
    `uses: actions/upload-artifact@${ACTION_SHA["denoland/setup-deno"]} # v7.0.1`,
  ]);
  assert.equal(
    jobIn(oneUpload, "check").split(`actions/upload-artifact@${ACTION_SHA["actions/upload-artifact"]}`).length - 1,
    2,
  );

  const swapped = ci.replace(
    `uses: actions/checkout@${ACTION_SHA["actions/checkout"]} # v7.0.1`,
    "uses: actions/checkout@v4",
  );
  assert.deepEqual(usesProblems(swapped), ["- uses: actions/checkout@v4"]);
  assert.deepEqual(usesProblems(ci), []);
  assert.deepEqual(playwrightProblems(ci), []);

  const e2eBody = jobIn(ci, "e2e");
  const conditional = e2eBody.replace(
    "      - name: Install Playwright system dependencies\n",
    "      - name: Install Playwright system dependencies\n        if: steps.playwright-cache.outputs.cache-hit != 'true'\n",
  );
  const at = ci.indexOf(e2eBody);
  const withIf = ci.slice(0, at) + conditional + ci.slice(at + e2eBody.length);
  assert.deepEqual(playwrightProblems(withIf), ["e2e install-deps condition"]);
  assert.equal(/\bif:/.test(installDepsStep(jobIn(withIf, "check"))), false);
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
