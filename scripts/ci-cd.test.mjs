import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const cd = readFileSync(new URL("../.github/workflows/cd.yml", import.meta.url), "utf8");
const push = readFileSync(new URL("./cd-push.sh", import.meta.url), "utf8");
const preflight = readFileSync(new URL("./cd-preflight.sh", import.meta.url), "utf8");

test("CI keeps the hosted and reviewer builds apart and skips live writers", () => {
  assert.match(ci, /pnpm check:bundle/);
  assert.match(ci, /pnpm check:reviewer-bundle/);
  assert.match(ci, /hosted-dist/);
  assert.match(ci, /reviewer-dist/);
  assert.match(ci, /storybook-static/);
  assert.match(ci, /supabase start/);
  assert.match(ci, /supabase test db/);
  assert.match(ci, /pnpm test:e2e\n/);
  assert.equal(ci.includes("test:e2e:live"), false);
  assert.equal(ci.includes("playwright.drain.config.ts"), false);
  assert.equal(ci.includes("sumit-live"), false);
});

test("CD uses the session pooler, the production environment, and the hosted dist", () => {
  assert.match(cd, /environment: production/);
  assert.match(cd, /SUPABASE_DB_URL/);
  assert.match(cd, /CLOUDFLARE_API_TOKEN/);
  assert.match(cd, /CLOUDFLARE_ACCOUNT_ID/);
  assert.equal(cd.includes("SUPABASE_ACCESS_TOKEN"), false);
  assert.equal(cd.includes("SUPABASE_DB_PASSWORD"), false);
  assert.match(cd, /pages deploy app\/dist/);
  assert.match(cd, /project-name=flow-app/);
  assert.match(cd, /--branch=main/);
  assert.match(cd, /cd-smoke.sh/);
  assert.match(cd, /CD skipped/);
  assert.match(cd, /repository Actions secrets/);
  assert.equal(cd.includes("production environment"), false);
  assert.equal(cd.includes("VITE_REVIEWER_BUILD"), true);
  assert.equal(cd.includes("reviewer-dist"), false);
  assert.equal(cd.includes("sumit-live"), false);
  assert.equal(cd.includes("db reset"), false);
  assert.match(push, /cd-preflight.sh/);
  assert.match(push, /db push --db-url/);
  assert.equal(push.includes("--include-seed"), false);
  assert.equal(push.includes("db reset"), false);
  assert.match(preflight, /SET TRANSACTION READ ONLY/);
  assert.match(preflight, /--dry-run/);
  assert.match(preflight, /preflight-r23.sql/);
});
