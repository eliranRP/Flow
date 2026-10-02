import assert from "node:assert/strict";
import test from "node:test";
import { criterion1, criterion3, criterion4, signingKeysFromPayload, signingKidOf, spikeExit } from "./mcp-signing-spike.mjs";

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

test("criterion 1 parses the Management API object {keys:[...]}", () => {
  const keys = signingKeysFromPayload({
    keys: [
      { status: "in_use", id: "ignored", public_jwk: { kid: "auth-kid", kty: "EC" } },
      { status: "standby", public_jwk: { kid: "standby-kid", kty: "EC" } },
      { status: "previously_used", public_jwk: { kid: "old-kid" } },
    ],
  });
  assert.deepEqual(keys.map((key) => key.kid), ["auth-kid", "standby-kid", "old-kid"]);
  const ready = criterion1(keys, "standby-kid");
  assert.equal(ready.ok, true);
  assert.equal(signingKeysFromPayload([]).length, 0);
  assert.equal(signingKeysFromPayload({ keys: "nope" }).length, 0);
});

test("each criterion has an exit code, incomplete is its own code, and a kid mismatch is criterion 1", () => {
  assert.equal(spikeExit({ ok: true }), 0);
  assert.equal(spikeExit({ ok: false, criterion: 1, stop: true }), 1);
  assert.equal(spikeExit({ ok: false, incomplete: true }), 2);
  assert.equal(spikeExit({ ok: false, needsKey: true }), 2);
  assert.equal(spikeExit({ ok: false, criterion: 3 }), 3);
  assert.equal(spikeExit({ ok: false, criterion: 4 }), 4);
  const mismatch = criterion1([
    { status: "in_use", kid: "auth-kid" },
    { status: "standby", kid: "standby-kid" },
  ], "other-kid");
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.criterion, 1);
  assert.match(mismatch.message, /not the standby key/);
  assert.equal(spikeExit(mismatch), 1);
});

test("a signing-key parse failure keeps the key out of the result", () => {
  const fragment = "private-key-material-not-for-logs";
  const parsed = signingKidOf(`{${fragment}`);
  assert.equal(parsed.ok, false);
  assert.equal(JSON.stringify(parsed).includes(fragment), false);
  assert.equal(signingKidOf(JSON.stringify({ kid: "standby-kid", d: fragment })).kid, "standby-kid");
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
