import assert from "node:assert/strict";
import test from "node:test";
import { checkSessionPoolerUrl } from "./cd-db-url.mjs";

const good = "postgresql://postgres.sxqpnetmtufkzowutduq:s3cret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require";

test("accepts the session pooler URL", () => {
  assert.deepEqual(checkSessionPoolerUrl(good), { ok: true });
});

test("accepts a percent-encoded password", () => {
  const encoded = good.replace("s3cret", "p%40ss%3Aword");
  assert.equal(checkSessionPoolerUrl(encoded).ok, true);
});

test("rejects a missing secret, the wrong project, and a write-capable pooler port", () => {
  assert.equal(checkSessionPoolerUrl("").ok, false);
  assert.equal(checkSessionPoolerUrl(undefined).ok, false);
  assert.match(checkSessionPoolerUrl("https://example.com").reason, /postgresql scheme/);
  assert.match(checkSessionPoolerUrl(good.replace("postgres.sxqpnetmtufkzowutduq", "postgres")).reason, /session-pooler role/);
  assert.match(checkSessionPoolerUrl(good.replace("aws-0-eu-central-1.pooler.supabase.com", "db.sxqpnetmtufkzowutduq.supabase.co")).reason, /session pooler/);
  assert.match(checkSessionPoolerUrl(good.replace(":5432", ":6543")).reason, /5432/);
  assert.match(checkSessionPoolerUrl(good.replace("/postgres?", "/other?")).reason, /database must be postgres/);
  assert.match(checkSessionPoolerUrl(good.replace("sslmode=require", "sslmode=disable")).reason, /sslmode=require/);
  assert.match(checkSessionPoolerUrl(good.replace("?sslmode=require", "")).reason, /sslmode=require/);
  const reasons = [
    checkSessionPoolerUrl(good),
    checkSessionPoolerUrl(good.replace("s3cret", "other-secret")),
  ];
  assert.equal(JSON.stringify(reasons).includes("s3cret"), false);
  assert.equal(JSON.stringify(reasons).includes("other-secret"), false);
});
