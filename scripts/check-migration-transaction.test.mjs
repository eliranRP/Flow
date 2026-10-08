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
  assert.deepEqual(
    explicitTransactionProblems("create function f() returns int language sql begin atomic select 1; end;\n", "atomic.sql"),
    [],
  );
  assert.deepEqual(explicitTransactionProblems("select E'\\'; commit;';\n", "esc.sql"), []);
  assert.deepEqual(explicitTransactionProblems("begin atomic select 1;\n", "atomic-stmt.sql"), []);
  assert.deepEqual(explicitTransactionProblems("end;\n", "end.sql"), [
    "end.sql:1 starts a transaction statement (end) but the file is not one begin and one final commit",
  ]);
  assert.deepEqual(
    explicitTransactionProblems("do $$\nbegin\n  commit;\nend;\n$$;\n", "doblock.sql"),
    ["doblock.sql:3 has a transaction statement inside a DO or function body (commit)"],
  );
  assert.deepEqual(
    explicitTransactionProblems(
      "create function f() returns int language sql begin atomic select 1; select 2; end;\n",
      "atomic-multi.sql",
    ),
    [],
  );
  assert.deepEqual(explicitTransactionProblems("begin atomic\nselect 1;\nselect 2;\nend;\n", "atomic-block.sql"), []);
  assert.deepEqual(explicitTransactionProblems("select $$ commit $$;\n", "dollar.sql"), []);
  assert.deepEqual(explicitTransactionProblems("select $tag$ commit $tag$;\n", "tag.sql"), []);
  assert.deepEqual(
    explicitTransactionProblems("do $$\nbegin\n  -- commit;\n  perform $$commit$$;\nend;\n$$;\n", "skipped.sql"),
    [],
  );
  assert.deepEqual(
    explicitTransactionProblems(
      "do $outer$\nbegin\n  execute $f$create function g() returns void language plpgsql as $b$ begin perform 1; end; $b$$f$;\nend;\n$outer$;\n",
      "nested-ok.sql",
    ),
    [],
  );
  assert.deepEqual(
    explicitTransactionProblems(
      "create function f() returns void language plpgsql as $outer$\nbegin\n  do $inner$\n  begin\n    commit;\n  end;\n  $inner$;\nend;\n$outer$;\n",
      "nested-do.sql",
    ),
    ["nested-do.sql:5 has a transaction statement inside a DO or function body (commit)"],
  );
  assert.deepEqual(
    explicitTransactionProblems(
      "do $outer$\nbegin\n  create procedure p() language plpgsql as $p$\n  begin\n    rollback;\n  end;\n  $p$;\nend;\n$outer$;\n",
      "nested-as.sql",
    ),
    ["nested-as.sql:5 has a transaction statement inside a DO or function body (rollback)"],
  );
  assert.deepEqual(explicitTransactionProblems("drop index concurrently ix;\n", "dropc.sql"), []);
  assert.deepEqual(
    explicitTransactionProblems("begin;\ncreate index concurrently ix on public.t (id);\ncommit;\n", "cin.sql"),
    ["cin.sql:2 creates or drops an index concurrently inside a transaction"],
  );
  assert.deepEqual(
    explicitTransactionProblems("begin;\ndrop index concurrently ix;\ncommit;\n", "din.sql"),
    ["din.sql:2 creates or drops an index concurrently inside a transaction"],
  );
  assert.deepEqual(
    explicitTransactionProblems("create index ix on public.t (id);\n", "idx.sql"),
    ["idx.sql:1 creates or drops an index outside a file transaction"],
  );
  assert.deepEqual(
    explicitTransactionProblems("begin;\ncreate index ix on public.t (id);\ncommit;\n", "wrapped.sql"),
    [],
  );
  assert.deepEqual(
    explicitTransactionProblems("create index concurrently ix on public.t (id);\n", "conc.sql"),
    [],
  );
});

test("the migration directory is one transaction or none", () => {
  assert.deepEqual(migrationTransactionProblems(), []);
});
