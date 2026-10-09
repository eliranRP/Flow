import assert from "node:assert/strict";
import test from "node:test";
import { fileSizeProblems, limitFor, parseAllowlist } from "./check-file-size.mjs";

test("code files get 800 lines, tests 1,200, and migrations and generated types are exempt", () => {
  assert.equal(limitFor("app/src/screens/home-screen.tsx"), 800);
  assert.equal(limitFor("app/src/ui/css/10-base.css"), 800);
  assert.equal(limitFor("scripts/local-ci.sh"), 800);
  assert.equal(limitFor("app/src/screens/home.test.tsx"), 1200);
  assert.equal(limitFor("app/e2e/controls.spec.ts"), 1200);
  assert.equal(limitFor("supabase/functions/flow-mcp/tools_reads_test.ts"), 1200);
  assert.equal(limitFor("supabase/functions/flow-mcp/tools_test_support.ts"), 1200);
  assert.equal(limitFor("supabase/tests/database/loans_l1.test.sql"), 1200);
  assert.equal(limitFor("supabase/migrations/20261010090000_loan_kinds_rates.sql"), null);
  assert.equal(limitFor("packages/shared/src/database.types.ts"), null);
  assert.equal(limitFor("docs/backlog/TASKS.md"), null);
});

test("a file over its limit is listed unless allowed, and an allowed file may not grow", () => {
  const allowed = parseAllowlist("# note\n900 a/big.ts # why\n");
  assert.deepEqual(
    fileSizeProblems(
      [
        { file: "a/ok.ts", lines: 800 },
        { file: "a/over.ts", lines: 801 },
        { file: "a/over.test.ts", lines: 1201 },
        { file: "a/fine.test.ts", lines: 1200 },
        { file: "a/big.ts", lines: 900 },
      ],
      allowed,
    ),
    [
      'a/over.ts: 801 lines, the limit is 800. Split it (CONTRIBUTING "File size").',
      'a/over.test.ts: 1201 lines, the limit is 1200. Split it (CONTRIBUTING "File size").',
    ],
  );
  assert.deepEqual(fileSizeProblems([{ file: "a/big.ts", lines: 901 }], allowed), [
    "a/big.ts: 901 lines, its allowed size is 900. A file over the limit may not grow.",
  ]);
});

test("a stale allowlist entry fails", () => {
  const allowed = parseAllowlist("900 a/big.ts\n900 a/gone.ts\n");
  assert.deepEqual(fileSizeProblems([{ file: "a/big.ts", lines: 700 }], allowed), [
    "a/big.ts: 700 lines is under the limit of 800 now; remove it from scripts/file-size-allow.txt.",
    "a/gone.ts: listed in scripts/file-size-allow.txt but not a checked file; remove the entry.",
  ]);
  assert.throws(() => parseAllowlist("a/big.ts 900\n"), /cannot read/);
});

