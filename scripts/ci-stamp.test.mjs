import assert from "node:assert/strict";
import test from "node:test";
import { parsePhases, stampBody } from "./ci-stamp.mjs";

const SHA = "4fbcb05242fb529a932d8e2e84fe900b406ec05e";

test("parsePhases reads one phase per line and refuses a malformed one", () => {
  assert.deepEqual(parsePhases("static pass 42\ntypes fail 7\n"), [
    { name: "static", pass: true, seconds: 42 },
    { name: "types", pass: false, seconds: 7 },
  ]);
  assert.throws(() => parsePhases("static maybe 4\n"), /bad phase line/);
});

test("stampBody carries the full sha in the marker and passes only when every phase passes", () => {
  const pass = stampBody({ sha: SHA, phases: parsePhases("static pass 42\ntests pass 90\n") });
  assert.ok(pass.startsWith(`<!-- flow-ci-stamp sha=${SHA} result=pass -->\n`));
  assert.match(pass, /\*\*Local CI: pass\*\* for `4fbcb05`/);
  assert.match(pass, /\| tests \| pass \| 90 \|/);

  const fail = stampBody({ sha: SHA, phases: parsePhases("static pass 42\ntypes fail 7\n") });
  assert.match(fail, /^<!-- flow-ci-stamp sha=\S+ result=fail -->/);
  assert.match(fail, /\| types \| fail \| 7 \|/);
});

test("stampBody refuses a short sha and an empty phase list", () => {
  assert.throws(() => stampBody({ sha: "4fbcb05", phases: parsePhases("static pass 1\n") }), /40-character/);
  assert.throws(() => stampBody({ sha: SHA, phases: [] }), /no phases/);
});
