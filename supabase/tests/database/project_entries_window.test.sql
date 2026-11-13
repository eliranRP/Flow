-- FLOW-1171. private.project_category_entries_by_currency(project, from, to) reads a project's lines between
-- two dates (from inclusive, to exclusive), on both branches (its own lines and its share of a shared line); the
-- one-argument form still reads every line. project_category_months_many reads the window only, so a line
-- older than its months changes nothing. Anon cannot call the new form.
-- Invented data only. "Today" is 2026-09-20, so the window is March to September 2026.

begin;

select plan(6);

do $users$
begin
  perform tests.create_supabase_user('pew_owner', 'pew-owner@example.com');
end
$users$;

create temp table pew (label text primary key, id uuid);
grant all on pew to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from pg_temp.pew where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into pew (label, id) values ('co', tests.fixture_company('pew_owner', 'Example Window LLC'));
insert into pew (label, id) values
  ('house', tests.fixture_project(pg_temp.id('co'), 'Example House')),
  ('shop', tests.fixture_project(pg_temp.id('co'), 'Example Shop')),
  ('paint', tests.fixture_category(pg_temp.id('co'), 'Paint'));

create function pg_temp.line(p_key text, p_amount bigint, p_date date, p_project text default null,
  p_role text default 'project')
returns uuid language sql as $$
  select tests.fixture_line(pg_temp.id('co'), 'pew:' || p_key, p_amount, p_project => pg_temp.id(p_project),
    p_category => pg_temp.id('paint'), p_doc_date => p_date, p_pnl_role => p_role)
$$;

-- The house's own lines: one before the window, one on its first day, one on the last day before its end, one on
-- its end (out).
insert into pew (label, id) values
  ('old', pg_temp.line('old', 50000, '2026-01-15', 'house')),
  ('first', pg_temp.line('first', 1000, '2026-03-01', 'house')),
  ('last', pg_temp.line('last', 2000, '2026-09-30', 'house')),
  ('after', pg_temp.line('after', 3000, '2026-10-01', 'house'));
-- Shared lines, half each: one before the window, one in it.
insert into pew (label, id) values
  ('s_old', pg_temp.line('s_old', 40000, '2026-02-10', p_role => 'shared')),
  ('s_in', pg_temp.line('s_in', 8000, '2026-07-14', p_role => 'shared'));
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
values (pg_temp.id('co'), pg_temp.id('s_old'), pg_temp.id('house'), 5000, -20000),
  (pg_temp.id('co'), pg_temp.id('s_old'), pg_temp.id('shop'), 5000, -20000),
  (pg_temp.id('co'), pg_temp.id('s_in'), pg_temp.id('house'), 5000, -4000),
  (pg_temp.id('co'), pg_temp.id('s_in'), pg_temp.id('shop'), 5000, -4000);

select ok(not has_function_privilege('anon', 'private.project_category_entries_by_currency(uuid, date, date)', 'execute'),
  'anon cannot call the window form');

select tests.authenticate_as('pew_owner');

select set_eq(
  $$ select transaction_id from private.project_category_entries_by_currency(pg_temp.id('house'), '2026-03-01', '2026-10-01') $$,
  $$ select unnest(array[pg_temp.id('first'), pg_temp.id('last'), pg_temp.id('s_in')]) $$,
  'the window keeps the house''s own lines and its shared line from its first day to the day before its end');

select results_eq(
  $$ select transaction_id, amount_net, shared from private.project_category_entries_by_currency(pg_temp.id('house'), '2026-03-01', '2026-10-01') order by transaction_id $$,
  $$ select transaction_id, amount_net, shared from private.project_category_entries_by_currency(pg_temp.id('house'))
     where doc_date >= '2026-03-01' and doc_date < '2026-10-01' order by transaction_id $$,
  'each row is the one the all-time form gives for the same line (the shared line at the house''s share)');

select is(
  (select count(*)::integer from private.project_category_entries_by_currency(pg_temp.id('house'))),
  6,
  'the one-argument form still reads every line of the house');

select is(
  (select m.categories->0->'months_minor' from private.project_category_months_many(array[pg_temp.id('house')], 6, '2026-09-20') m),
  '[1000, 0, 0, 0, 4000, 0]'::jsonb,
  'the months read: March''s line and July''s share, nothing from January or February');

select is(
  (select (m.categories->0->>'this_month_minor')::bigint from private.project_category_months_many(array[pg_temp.id('house')], 6, '2026-09-20') m),
  2000::bigint,
  'this month counts its own line, not October''s');

select * from finish();
rollback;
