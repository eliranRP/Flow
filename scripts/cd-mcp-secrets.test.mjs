import assert from "node:assert/strict";
import test from "node:test";
import { accessTokenProblem, pepperProblem } from "./cd-mcp-secrets.mjs";

const secret = "a".repeat(32);

test("the pepper must be JSON with a kid and a secret of at least 32 bytes", () => {
  assert.equal(pepperProblem(undefined), "is empty");
  assert.equal(pepperProblem("raw-pepper"), "must be JSON with a kid and a secret of at least 32 bytes");
  assert.match(pepperProblem(JSON.stringify({ kid: "mcp-pepper-1", secret: "a".repeat(31) })) ?? "", /32 bytes/);
  assert.match(pepperProblem(JSON.stringify({ kid: "mcp-pepper-1", secret: `${"a".repeat(32)}+` })) ?? "", /letters, digits/);
  assert.equal(pepperProblem(JSON.stringify({ kid: "mcp-pepper-1", secret })), null);
  assert.equal(
    pepperProblem(JSON.stringify({
      kid: "mcp-pepper-2",
      secret,
      previous: [{ kid: "mcp-pepper-1", secret }],
    })),
    null,
  );
  assert.match(
    pepperProblem(JSON.stringify({
      kid: "mcp-pepper-1",
      secret,
      previous: [{ kid: "mcp-pepper-1", secret }],
    })) ?? "",
    /repeats a kid/,
  );
});

test("the access token must be a scoped personal access token", () => {
  assert.equal(accessTokenProblem(""), "is empty");
  assert.match(accessTokenProblem("sbp_classicexampletokenvalue") ?? "", /classic/);
  assert.match(accessTokenProblem(`sbp_${"ab".repeat(20)}`) ?? "", /40 hex/);
  assert.match(accessTokenProblem(`sbp_${"fc".repeat(20)}`) ?? "", /40 hex/);
  assert.equal(accessTokenProblem("sbp_fc"), null);
  assert.equal(accessTokenProblem(`sbp_fc5${"b".repeat(20)}`), null);
  assert.equal(accessTokenProblem(`sbp_fc_${"b".repeat(20)}`), null);
});
