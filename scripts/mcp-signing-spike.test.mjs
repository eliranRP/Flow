import assert from "node:assert/strict";
import test from "node:test";
import { criterion1, criterion4 } from "./mcp-signing-spike.mjs";

test("criterion 4 fails when cf-connecting-ip did not reach the function", () => {
  assert.equal(criterion4(null).ok, false);
  assert.equal(criterion4("").ok, false);
  assert.equal(criterion4("absent").ok, false);
  assert.match(criterion4(null).message, /criterion 4 failed/);
  assert.equal(criterion4("present").ok, true);
});

test("the spike stops when the only JWKS key would be Auth's in-use key", () => {
  const stopped = criterion1(["985184ff-0c58-4ffd-a4a5-d7322027aee6"], undefined);
  assert.equal(stopped.ok, false);
  assert.equal(stopped.stop, true);
  assert.match(stopped.message, /Do not set FLOW_JWT_LEGACY/);

  const only = criterion1(["auth-kid"], "auth-kid");
  assert.equal(only.ok, false);
  assert.match(only.message, /only one key/);

  const extra = criterion1(["auth-kid", "mcp-kid"], "mcp-kid");
  assert.equal(extra.ok, true);
});
