import assert from "node:assert/strict";
import test from "node:test";
import { accessTokenProblem, accessTokenShapeWarning, pepperProblem } from "./cd-mcp-secrets.mjs";

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

test("token shape is a warning and does not fail the deploy", () => {
  assert.equal(accessTokenProblem(""), "is empty");
  assert.equal(accessTokenProblem("sbp_classicexampletokenvalue"), null);
  assert.equal(accessTokenProblem(`sbp_${"ab".repeat(20)}`), null);
  assert.equal(accessTokenProblem(`sbp_${"fc".repeat(20)}`), null);
  assert.match(accessTokenShapeWarning(`sbp_${"ab".repeat(20)}`) ?? "", /40 hex/);
  assert.match(accessTokenShapeWarning(`sbp_${"fc".repeat(20)}`) ?? "", /40 hex/);
  assert.match(accessTokenShapeWarning("sbp_classicexampletokenvalue") ?? "", /scoped prefix/);
  assert.equal(accessTokenShapeWarning("sbp_fc"), null);
  assert.equal(accessTokenShapeWarning(`sbp_fc_${"b".repeat(20)}`), null);
  assert.equal(accessTokenProblem("sbp_fc"), null);
});
