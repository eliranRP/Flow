-- FLOW-1313: public.month_forecast, the month-end forecast in one read (migration 20261123052117).
-- - Its build is the TypeScript builder's (packages/shared buildMonthForecast) over the same company's five reads:
--   each expected answer below is that builder's output for the reads of this fixture (ids written as @label@),
--   so the database and the app agree on a whole company, not only on the shared vectors
--   (vectors_month_forecast.test.sql runs those).
-- - p_today goes to expected_months, the one read that takes a date; null is today in Israel.
-- - Near midnight: the last evening of a month and the first minutes of the next are two forecasts, each for its own
--   month, with the charges seen in the month left out.
-- - Another company's member reads only their own company; a user with no company is refused.
-- Invented data only. Amounts are agorot. "Today" is 2026-09-20.

begin;

select plan(18);

do $users$
begin
  perform tests.create_supabase_user('mf_owner', 'mf-owner@example.com');
  perform tests.create_supabase_user('mf_other', 'mf-other@example.com');
  perform tests.create_supabase_user('mf_nobody', 'mf-nobody@example.com');
end
$users$;

create temp table mf (label text primary key, id uuid);
grant all on mf to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from pg_temp.mf where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

-- A text with @label@ for an id, or an id with its @label@.
create function pg_temp.fill(p_text text) returns text language plpgsql stable as $$
declare
  r record;
  out_text text := p_text;
begin
  for r in select label, id from pg_temp.mf loop
    out_text := replace(out_text, '@' || r.label || '@', r.id::text);
  end loop;
  return out_text;
end;
$$;
create function pg_temp.mask(p_text text) returns text language plpgsql stable as $$
declare
  r record;
  out_text text := p_text;
begin
  for r in select label, id from pg_temp.mf loop
    out_text := replace(out_text, r.id::text, '@' || r.label || '@');
  end loop;
  return out_text;
end;
$$;
grant execute on function pg_temp.fill(text), pg_temp.mask(text) to authenticated, service_role;

insert into mf (label, id) values ('co', tests.fixture_company('mf_owner', 'Example Month Forecast LLC'));
insert into mf (label, id) values ('other_co', tests.fixture_company('mf_other', 'Example Other Forecast LLC'));
insert into mf (label, id) values
  ('house', tests.fixture_project(pg_temp.id('co'), 'Example House')),
  ('office', tests.fixture_project(pg_temp.id('co'), 'Example Office')),
  ('refund', tests.fixture_category(pg_temp.id('co'), 'Utility refund', 'income')),
  ('other_house', tests.fixture_project(pg_temp.id('other_co'), 'Example Other House'));

-- Five recurring parties: a rent (no project), a power bill (the house; also paid on 3 September, so seen in
-- September), a small tea charge, a quarterly one (due in November) and a retainer (income). All three months back.
insert into public.suppliers (company_id, name) values
  (pg_temp.id('co'), 'Example Rent'), (pg_temp.id('co'), 'Example Power'), (pg_temp.id('co'), 'Example Tea'),
  (pg_temp.id('co'), 'Example Quarterly');
insert into public.customers (company_id, name) values (pg_temp.id('co'), 'Example Retainer');
insert into mf (label, id) select 'rent', id from public.suppliers where company_id = pg_temp.id('co') and name = 'Example Rent';
insert into mf (label, id) select 'power', id from public.suppliers where company_id = pg_temp.id('co') and name = 'Example Power';
insert into mf (label, id) select 'tea', id from public.suppliers where company_id = pg_temp.id('co') and name = 'Example Tea';
insert into mf (label, id) select 'quarterly', id from public.suppliers where company_id = pg_temp.id('co') and name = 'Example Quarterly';
insert into mf (label, id) select 'retainer', id from public.customers where company_id = pg_temp.id('co') and name = 'Example Retainer';

create temp table mf_lines (label text, amount bigint, direction text, doc_date date, party text, project text);
insert into mf_lines values
  ('rent6', 250000, 'expense', '2026-06-05', 'rent', null), ('rent7', 250000, 'expense', '2026-07-05', 'rent', null), ('rent8', 250000, 'expense', '2026-08-05', 'rent', null),
  ('pow6', 12000, 'expense', '2026-06-07', 'power', 'house'), ('pow7', 12000, 'expense', '2026-07-07', 'power', 'house'),
  ('pow8', 12000, 'expense', '2026-08-07', 'power', 'house'), ('pow9', 12000, 'expense', '2026-09-03', 'power', 'house'),
  ('tea6', 3000, 'expense', '2026-06-12', 'tea', null), ('tea7', 3000, 'expense', '2026-07-12', 'tea', null), ('tea8', 3000, 'expense', '2026-08-12', 'tea', null),
  ('q2', 20000, 'expense', '2026-02-20', 'quarterly', null), ('q5', 20000, 'expense', '2026-05-20', 'quarterly', null), ('q8', 20000, 'expense', '2026-08-20', 'quarterly', null),
  ('ret6', 800000, 'income', '2026-06-10', 'retainer', null), ('ret7', 800000, 'income', '2026-07-10', 'retainer', null), ('ret8', 800000, 'income', '2026-08-10', 'retainer', null);
insert into mf (label, id)
select l.label, tests.fixture_line(pg_temp.id('co'), 'mf:' || l.label, l.amount, l.direction, pg_temp.id(l.project), null, l.doc_date,
  p_pnl_role => case when l.project is null then null else 'project' end,
  p_doc_kind => case when l.direction = 'income' then 'invoice' else 'receipt' end)
from mf_lines l;
update public.transactions t set supplier_id = pg_temp.id(l.party) from mf_lines l where t.id = pg_temp.id(l.label) and l.direction = 'expense';
update public.transactions t set customer_id = pg_temp.id(l.party) from mf_lines l where t.id = pg_temp.id(l.label) and l.direction = 'income';

-- A customer's charge recurs from invoices, so the retainer's lines above are invoices, paid (no external id, so not open).
-- Open documents: a customer invoice, a supplier invoice, and one in dollars (left out of a shekel company's forecast).
insert into mf (label, id) values
  ('inv', tests.fixture_line(pg_temp.id('co'), 'mf:inv', 300000, 'income', null, null, '2026-09-02', p_doc_kind => 'invoice', p_pnl_role => null)),
  ('supinv', tests.fixture_line(pg_temp.id('co'), 'mf:supinv', 45000, 'expense', null, null, '2026-09-04', p_doc_kind => 'invoice', p_pnl_role => null)),
  ('usdinv', tests.fixture_line(pg_temp.id('co'), 'mf:usdinv', 100000, 'income', null, null, '2026-09-05', p_currency => 'USD', p_doc_kind => 'invoice', p_pnl_role => null));
update public.transactions set external_id = idempotency_key where company_id = pg_temp.id('co') and idempotency_key in ('mf:inv', 'mf:supinv', 'mf:usdinv');

-- The other company has one open invoice of its own.
insert into mf (label, id) values
  ('other_inv', tests.fixture_line(pg_temp.id('other_co'), 'mf:other_inv', 77000, 'income', null, null, '2026-09-06', p_doc_kind => 'invoice', p_pnl_role => null));
update public.transactions set external_id = idempotency_key where company_id = pg_temp.id('other_co') and doc_kind = 'invoice';

-- The owner's word, written straight into the tables (the app's writes refuse a month that has ended, and these
-- cases are September 2026): an overhead project; the retainer raised and a line added on the house by edits; the rent
-- changed, the supplier invoice moved out and the retainer's day set by overrides (an override beats an edit).
update public.companies set overhead_project_id = pg_temp.id('office') where id = pg_temp.id('co');
with e as (
  insert into public.project_forecast_edits (company_id, project_id, kind, category_id, direction, amount_minor, pace, start_month)
  values (pg_temp.id('co'), pg_temp.id('house'), 'add', pg_temp.id('refund'), 'income', 17176, 'month', '2026-09')
  returning id)
insert into mf (label, id) select 'edit_add', id from e;
insert into public.project_forecast_edits (company_id, project_id, kind, row_key, amount_minor, start_month) values
  (pg_temp.id('co'), pg_temp.id('office'), 'change', 'rec:income:' || pg_temp.id('retainer'), 820000, '2026-09'),
  (pg_temp.id('co'), pg_temp.id('office'), 'change', 'rec:expense:' || pg_temp.id('rent'), 255000, '2026-09');
insert into public.forecast_overrides (company_id, month, item_key, amount_minor, due_on, moved_out) values
  (pg_temp.id('co'), '2026-09', 'party:expense:' || pg_temp.id('rent') || ':ILS', 260000, null, false),
  (pg_temp.id('co'), '2026-09', 'invoice:' || pg_temp.id('supinv'), null, null, true),
  (pg_temp.id('co'), '2026-09', 'party:income:' || pg_temp.id('retainer') || ':ILS', null, '2026-09-15', false);


-- The TypeScript builder's answer for each case's reads (the reads' output run through buildMonthForecast), ids as @label@,
-- with each item as month_forecast sends it: no currency, expected_on or late_days, and no null field (absent = null).
create temp table mf_ts (tag text primary key, doc text);
grant all on mf_ts to authenticated, service_role;
insert into mf_ts values ('sep20', $ts$
{"items": [
  {"key": "party:income:@retainer@:ILS", "direction": "income", "kind": "recurring", "name": "Example Retainer", "usual": 820000, "day": 10, "pace": "month", "minor": 820000, "due_on": "2026-09-15", "moved_out": false, "overridden": true},
  {"key": "party:expense:@rent@:ILS", "direction": "expense", "kind": "recurring", "name": "Example Rent", "usual": 255000, "day": 5, "pace": "month", "minor": 260000, "moved_out": false, "overridden": true},
  {"key": "party:expense:@tea@:ILS", "direction": "expense", "kind": "recurring", "name": "Example Tea", "usual": 3000, "day": 12, "pace": "month", "minor": 3000, "moved_out": false, "overridden": false},
  {"key": "invoice:@inv@", "direction": "income", "kind": "invoice", "name": "mf:inv", "usual": 300000, "description": "mf:inv", "minor": 300000, "moved_out": false, "overridden": false},
  {"key": "invoice:@supinv@", "direction": "expense", "kind": "invoice", "name": "mf:supinv", "usual": 45000, "description": "mf:supinv", "minor": 45000, "moved_out": true, "overridden": true},
  {"key": "added:@edit_add@", "direction": "income", "kind": "added", "name": "Utility refund", "usual": 17176, "category_id": "@refund@", "project_id": "@house@", "pace": "month", "line_start": "2026-09", "minor": 17176, "moved_out": false, "overridden": false}
],
 "income": ["party:income:@retainer@:ILS", "invoice:@inv@", "added:@edit_add@"],
 "expense": ["party:expense:@rent@:ILS"],
 "moved": ["invoice:@supinv@"],
 "small": ["party:expense:@tea@:ILS"],
 "incomeTotal": 1137176, "expenseTotal": 263000, "changed": 3}
$ts$);
insert into mf_ts values ('sep30', $ts$
{"items": [
  {"key": "party:income:@retainer@:ILS", "direction": "income", "kind": "recurring", "name": "Example Retainer", "usual": 820000, "day": 10, "pace": "month", "minor": 820000, "due_on": "2026-09-15", "moved_out": false, "overridden": true},
  {"key": "party:expense:@rent@:ILS", "direction": "expense", "kind": "recurring", "name": "Example Rent", "usual": 255000, "day": 5, "pace": "month", "minor": 260000, "moved_out": false, "overridden": true},
  {"key": "party:expense:@tea@:ILS", "direction": "expense", "kind": "recurring", "name": "Example Tea", "usual": 3000, "day": 12, "pace": "month", "minor": 3000, "moved_out": false, "overridden": false},
  {"key": "invoice:@inv@", "direction": "income", "kind": "invoice", "name": "mf:inv", "usual": 300000, "description": "mf:inv", "minor": 300000, "moved_out": false, "overridden": false},
  {"key": "invoice:@supinv@", "direction": "expense", "kind": "invoice", "name": "mf:supinv", "usual": 45000, "description": "mf:supinv", "minor": 45000, "moved_out": true, "overridden": true},
  {"key": "added:@edit_add@", "direction": "income", "kind": "added", "name": "Utility refund", "usual": 17176, "category_id": "@refund@", "project_id": "@house@", "pace": "month", "line_start": "2026-09", "minor": 17176, "moved_out": false, "overridden": false}
],
 "income": ["party:income:@retainer@:ILS", "invoice:@inv@", "added:@edit_add@"],
 "expense": ["party:expense:@rent@:ILS"],
 "moved": ["invoice:@supinv@"],
 "small": ["party:expense:@tea@:ILS"],
 "incomeTotal": 1137176, "expenseTotal": 263000, "changed": 3}
$ts$);
insert into mf_ts values ('oct01', $ts$
{"items": [
  {"key": "party:income:@retainer@:ILS", "direction": "income", "kind": "recurring", "name": "Example Retainer", "usual": 800000, "day": 10, "pace": "month", "minor": 800000, "moved_out": false, "overridden": false},
  {"key": "party:expense:@power@:ILS", "direction": "expense", "kind": "recurring", "name": "Example Power", "usual": 12000, "day": 7, "project_id": "@house@", "pace": "month", "minor": 12000, "moved_out": false, "overridden": false},
  {"key": "party:expense:@rent@:ILS", "direction": "expense", "kind": "recurring", "name": "Example Rent", "usual": 250000, "day": 5, "pace": "month", "minor": 250000, "moved_out": false, "overridden": false},
  {"key": "party:expense:@tea@:ILS", "direction": "expense", "kind": "recurring", "name": "Example Tea", "usual": 3000, "day": 12, "pace": "month", "minor": 3000, "moved_out": false, "overridden": false},
  {"key": "invoice:@inv@", "direction": "income", "kind": "invoice", "name": "mf:inv", "usual": 300000, "description": "mf:inv", "minor": 300000, "moved_out": false, "overridden": false},
  {"key": "invoice:@supinv@", "direction": "expense", "kind": "invoice", "name": "mf:supinv", "usual": 45000, "description": "mf:supinv", "minor": 45000, "moved_out": false, "overridden": false},
  {"key": "added:@edit_add@", "direction": "income", "kind": "added", "name": "Utility refund", "usual": 17176, "category_id": "@refund@", "project_id": "@house@", "pace": "month", "line_start": "2026-09", "minor": 17176, "moved_out": false, "overridden": false}
],
 "income": ["party:income:@retainer@:ILS", "invoice:@inv@", "added:@edit_add@"],
 "expense": ["party:expense:@rent@:ILS", "invoice:@supinv@", "party:expense:@power@:ILS"],
 "moved": [],
 "small": ["party:expense:@tea@:ILS"],
 "incomeTotal": 1117176, "expenseTotal": 310000, "changed": 0}
$ts$);

-- Israel's today, read as the database (authenticated cannot execute private.flow_today()).
create temp table mf_clock (today date);
grant all on mf_clock to authenticated, service_role;
insert into mf_clock values (private.flow_today());

create function pg_temp.ts(p_tag text) returns jsonb language sql stable as $$
  select pg_temp.fill(doc)::jsonb from pg_temp.mf_ts where tag = p_tag;
$$;
create function pg_temp.build(p_month text, p_today date default null) returns jsonb language sql stable as $$
  select (public.month_forecast(p_month, p_today)->'build');
$$;
create function pg_temp.keys(p_build jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(i->>'key' order by o), '{}') from jsonb_array_elements(p_build->'items') with ordinality t(i, o);
$$;
grant execute on function pg_temp.fill(text), pg_temp.ts(text), pg_temp.build(text, date), pg_temp.keys(jsonb) to authenticated, service_role;

select tests.authenticate_as('mf_owner');

-- The same company, the TypeScript builder's answer for its five reads: items, the four lists, totals, changed.
select is(pg_temp.build('2026-09', '2026-09-20'), pg_temp.ts('sep20'),
  'September, on the 20th: equal to buildMonthForecast over the same reads (an edit and an override on the rent, a retainer raised by an edit, an invoice moved out, a small charge, an added line, a dollar invoice left out)');
select is(pg_temp.build('2026-09', '2026-09-30'), pg_temp.ts('sep30'), 'September, on the 30th: equal');
select is(pg_temp.build('2026-10', '2026-10-01'), pg_temp.ts('oct01'), 'October, on the 1st: equal (the power bill paid in September is due again; no override or one-time edit applies)');

-- Near midnight (Israel): the last evening of September and the first minute of October are two forecasts.
select ok(not ('party:expense:' || pg_temp.id('power') || ':ILS' = any (pg_temp.keys(pg_temp.build('2026-09', '2026-09-30')))),
  'on 30 September the power bill is seen (paid on the 3rd) and left out');
select ok('party:expense:' || pg_temp.id('power') || ':ILS' = any (pg_temp.keys(pg_temp.build('2026-10', '2026-10-01'))),
  'one date later it is due again');
select is(
  (select array_agg(p->>'party_id' order by p->>'name') from jsonb_array_elements(public.expected_months(0, null, '2026-09-30')->'recurring') p where (p->>'seen_this_month')::boolean),
  array[pg_temp.id('power')::text],
  'the date reaches expected_months, the one read that takes it: only the power bill is seen in September');

-- p_today null is today in Israel.
select is(public.month_forecast(to_char((select today from mf_clock), 'YYYY-MM'), null),
  public.month_forecast(to_char((select today from mf_clock), 'YYYY-MM'), (select today from mf_clock)),
  'no date is the date private.flow_today() gives');
select is(public.expected_months(0, null, null)->>'today', (select today::text from mf_clock), 'and expected_months, which the date goes to, answers with that same today');

-- The answer's other parts: the currency and the month's overrides, as the app reads them.
select is(public.month_forecast('2026-09', '2026-09-20') - 'build',
  jsonb_build_object('month', '2026-09', 'base', 'ILS', 'overrides', public.forecast_overrides_for('2026-09')),
  'month, base and the overrides come with the build');
select is(jsonb_array_length(public.month_forecast('2026-09', '2026-09-20')->'overrides'), 3, 'the three overrides of the month');

select ok(not exists (select 1 from jsonb_array_elements(public.month_forecast('2026-09', '2026-09-20')->'build'->'items') i
    where i ? 'currency' or i ? 'expected_on' or i ? 'late_days' or jsonb_strip_nulls(i) <> i),
  'no item carries currency, expected_on, late_days or a null field');
select throws_ok($$ select public.month_forecast('2026-13', '2026-09-20') $$, '22023', 'validation', 'a month that is not one is refused');
select throws_ok($$ select public.month_forecast(null, '2026-09-20') $$, '22023', 'validation', 'so is none');

-- Another company's member reads only their own company; a user with no company reads nothing.
select tests.authenticate_as('mf_other');
select is(pg_temp.keys(pg_temp.build('2026-09', '2026-09-20')), array['invoice:' || pg_temp.id('other_inv')],
  'the other company''s forecast holds its own open invoice and nothing of the first');
select ok(position(pg_temp.id('rent')::text in public.month_forecast('2026-09', '2026-09-20')::text) = 0
    and position(pg_temp.id('inv')::text in public.month_forecast('2026-09', '2026-09-20')::text) = 0
    and public.month_forecast('2026-09', '2026-09-20')->'overrides' = '[]'::jsonb,
  'none of the first company''s ids or overrides is in it');

select tests.authenticate_as('mf_nobody');
select throws_ok($$ select public.month_forecast('2026-09', '2026-09-20') $$, '42501', 'forbidden', 'a user with no company is refused');

-- The functions: invoker and immutable, closed to anon, open to authenticated (the build reads no table).
reset role;
select ok(
  (select not prosecdef and provolatile = 's' from pg_proc where oid = 'public.month_forecast(text, date)'::regprocedure)
  and (select not prosecdef and provolatile = 'i' from pg_proc where oid = 'private.month_forecast_build(jsonb)'::regprocedure),
  'month_forecast is a stable invoker; the build is an immutable one');
select ok(
  has_function_privilege('authenticated', 'public.month_forecast(text, date)', 'execute')
  and has_function_privilege('authenticated', 'private.month_forecast_build(jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.month_forecast(text, date)', 'execute')
  and not has_function_privilege('anon', 'public.month_forecast(text, date)', 'execute')
  and not has_function_privilege('anon', 'private.month_forecast_build(jsonb)', 'execute'),
  'authenticated executes both, service_role the read, anon neither');

select * from finish();
rollback;
