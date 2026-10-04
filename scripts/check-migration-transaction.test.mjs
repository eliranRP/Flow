import assert from "node:assert/strict";
import test from "node:test";
import { explicitTransactionProblems, migrationTransactionProblems } from "./check-migration-transaction.mjs";

test("a mid-file commit is rejected, and one begin plus a final commit is not", () => {
  assert.deepEqual(explicitTransactionProblems("begin;\nselect 1;\ncommit;\n", "wrap.sql"), []);
  assert.deepEqual(
    explicitTransactionProblems("select 1;\ncommit;\nselect 2;\n", "mid.sql"),
    ["mid.sql:2 starts a transaction statement (commit) but the file is not one begin and one final commit"],
  );
  assert.deepEqual(
    explicitTransactionProblems("begin;\nselect 1;\ncommit;\nselect 2;\n", "tail.sql"),
    [
      "tail.sql:1 starts a transaction statement (begin) but the file is not one begin and one final commit",
      "tail.sql:3 starts a transaction statement (commit) but the file is not one begin and one final commit",
    ],
  );
  assert.deepEqual(explicitTransactionProblems("rollback;\n", "undo.sql"), [
    "undo.sql:1 starts a transaction statement (rollback) but the file is not one begin and one final commit",
  ]);
  assert.deepEqual(explicitTransactionProblems("rollback to savepoint s;\n", "save.sql"), []);
  assert.deepEqual(
    explicitTransactionProblems(
      "create function f() returns void language plpgsql as $$\nbegin\n  perform 1;\nend;\n$$;\n",
      "fn.sql",
    ),
    [],
  );
  assert.deepEqual(explicitTransactionProblems("-- commit;\nselect 1;\n", "note.sql"), []);
  assert.deepEqual(explicitTransactionProblems("select 'commit;';\n", "str.sql"), []);
});

test("the migration directory is one transaction or none", () => {
  assert.deepEqual(migrationTransactionProblems(), []);
});
