import assert from "node:assert/strict";
import { test } from "node:test";
import { namesIn, pgtapSpecs } from "./pgtap-specs.mjs";

const T = "supabase/tests/database";

test("namesIn finds functions, tables, views and triggers, not keywords", () => {
  const sql = `
    -- create table ignored_in_comment (id int);
    create or replace function public.list_widgets(p int) returns table (id int) language sql as $$ select 1 $$;
    create table if not exists private.widget_marks (id int);
    alter table only public.widgets add column size int;
    create trigger widgets_touch before update on public.widgets for each row execute function private.touch();
    create or replace view widget_totals as select 1;
    select pg_temp.anchor_count('x');`;
  assert.deepEqual([...namesIn(sql)].sort(), ["list_widgets", "touch", "widget_marks", "widget_totals", "widgets", "widgets_touch"]);
});

test("pgtapSpecs picks changed tests and tests naming a changed object", () => {
  const tests = new Map([
    [`${T}/widgets.test.sql`, "select list_widgets(1);"],
    [`${T}/gadgets.test.sql`, "select list_gadgets(1);"],
    [`${T}/changed.test.sql`, "select 1;"],
    [`${T}/widget_marks_extra.test.sql`, "select * from widgets_extra;"],
  ]);
  const migrations = { "supabase/migrations/20990101000000_w.sql": "create function list_widgets() returns int as $$ select 1 $$;" };
  const picked = pgtapSpecs(
    ["supabase/migrations/20990101000000_w.sql", `${T}/changed.test.sql`, "app/src/x.ts"],
    tests,
    (path) => migrations[path] ?? null,
  );
  assert.deepEqual(picked, [`${T}/changed.test.sql`, `${T}/widgets.test.sql`]);
});

test("pgtapSpecs picks nothing for a change outside the database", () => {
  assert.deepEqual(pgtapSpecs(["docs/backlog/TASKS.md"], new Map([[`${T}/a.test.sql`, "select 1;"]]), () => null), []);
});
