import assert from "node:assert/strict";
import test from "node:test";
import { criterion1, criterion3, criterion4 } from "./mcp-signing-spike.mjs";

test("criterion 4 fails when cf-connecting-ip did not reach the function", () => {
  assert.equal(criterion4(null).ok, false);
  assert.equal(criterion4("").ok, false);
  assert.equal(criterion4("absent").ok, false);
  assert.match(criterion4(null).message, /criterion 4 failed/);
  assert.equal(criterion4("present").ok, true);
});

test("criterion 1 checks standby status, not a JWKS key count", () => {
  const stopped = criterion1([{ status: "in_use", kid: "auth-kid" }], undefined);
  assert.equal(stopped.ok, false);
  assert.equal(stopped.stop, true);
  assert.match(stopped.message, /Do not set FLOW_JWT_LEGACY/);
  assert.match(stopped.message, /JWKS key count is not/);

  const same = criterion1([
    { status: "in_use", kid: "auth-kid" },
    { status: "standby", kid: "auth-kid" },
  ], "auth-kid");
  assert.equal(same.ok, false);
  assert.match(same.message, /in-use key/);

  const waiting = criterion1([
    { status: "in_use", kid: "auth-kid" },
    { status: "standby", kid: "standby-kid" },
  ], undefined);
  assert.equal(waiting.ok, false);
  assert.equal(waiting.needsKey, true);
  assert.equal(waiting.stop, false);

  const ready = criterion1([
    { status: "in_use", kid: "auth-kid" },
    { status: "standby", kid: "standby-kid" },
  ], "standby-kid");
  assert.equal(ready.ok, true);
  assert.match(ready.message, /not Auth's in-use key/);
});

test("criterion 3 fails when PostgREST rejects the standby key or leaks the company", () => {
  assert.equal(criterion3({
    ownerStatus: 401,
    ownerCompany: null,
    otherCompany: null,
    expectedCompany: "company-a",
  }).ok, false);
  assert.equal(criterion3({
    ownerStatus: 200,
    ownerCompany: "company-a",
    otherCompany: "company-a",
    expectedCompany: "company-a",
  }).ok, false);
  assert.equal(criterion3({
    ownerStatus: 200,
    ownerCompany: "company-a",
    otherCompany: null,
    expectedCompany: "company-a",
  }).ok, true);
});
