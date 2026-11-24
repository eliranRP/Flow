-- FLOW-1320 (20261123135127): company_forecast and project_forecast read the recurring charges once, through
-- private.forecast_gather, instead of expected_months(0) and company_next_month_inputs each reading them.
-- - private.recurring_charges is recurring_parties' query with every charge, its order, whether it is listed and its
--   lines; recurring_parties is its listed rows, so they agree row for row and in order.
-- - Its lines of the charges with a project are recurring_charge_lines_of_projects' lines (a charge that is over
--   included: it is not listed, but its lines are still left out of the general costs).
-- - forecast_gather gives company_next_month_inputs' answer ('rest', 'next'; 'general' its general costs) and
--   expected_months(0)'s charges without the handover and seen_this_month, in its order (a party with two
--   charges included), for the company and for one project.
-- - company_forecast and project_forecast answer as their bodies from before this change (pg_temp copies with the old
--   reads put back), for totals and rows, every project and the overhead one, on two days.
-- - forecast_gather: closed to anon, refuses a user with no company (42501) and a bad p_inputs (22023); security
--   definer with an empty search_path; recurring_charges is closed to the API roles.
-- Fixture as flow_1216_next_month_streams.test.sql, with an income charge, a charge that is over (FLOW-1266), a
-- party billing two projects, the overhead project's charge, an edit and a skip. Invented data only, @example.com
-- only. Amounts are agorot. "Today" is 2026-09-20 or 2026-10-05.

begin;

select plan(21);

do $users$
begin
  perform tests.create_supabase_user('ro_owner', 'ro-owner@example.com');
  perform tests.create_supabase_user('ro_nobody', 'ro-nobody@example.com');
end
$users$;

create temp table ro (label text primary key, id uuid);
grant all on ro to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable set search_path = '' as $$
  select id from pg_temp.ro where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into ro (label, id) values ('co', tests.fixture_company('ro_owner', 'Example Charges Once LLC'));
insert into ro (label, id) values
  ('site', tests.fixture_project(pg_temp.id('co'), 'Example Site')),
  ('site2', tests.fixture_project(pg_temp.id('co'), 'Example Second Site')),
  ('old', tests.fixture_project(pg_temp.id('co'), 'Example Old Site', 'finished')),
  ('office', tests.fixture_project(pg_temp.id('co'), 'Example Office')),
  ('util', tests.fixture_category(pg_temp.id('co'), 'Example Utility')),
  ('misc', tests.fixture_category(pg_temp.id('co'), 'Example Misc')),
  ('rent', tests.fixture_category(pg_temp.id('co'), 'Example Rent', 'income'));
update public.companies set overhead_project_id = pg_temp.id('office') where id = pg_temp.id('co');

insert into public.suppliers (company_id, name)
select pg_temp.id('co'), n
from unnest(array['Example Steady', 'Example Quarter', 'Example Annual', 'Example Forced', 'Example Ended',
  'Example Loose', 'Example Oldp', 'Example Three', 'Example Gone', 'Example Twice', 'Example Cleaner']) n;
insert into ro (label, id)
select lower(replace(s.name, 'Example ', '')), s.id from public.suppliers s where s.company_id = pg_temp.id('co');
insert into public.customers (company_id, name) values (pg_temp.id('co'), 'Example Tenant');
insert into ro (label, id)
select 'tenant', c.id from public.customers c where c.company_id = pg_temp.id('co');

-- label, party, project, date, category
create temp table ro_lines (label text, party text, project text, doc_date date, category text);
insert into ro_lines values
  ('steady_03', 'steady', 'site', '2026-03-05', 'util'), ('steady_04', 'steady', 'site', '2026-04-05', 'util'),
  ('steady_05', 'steady', 'site', '2026-05-05', 'util'), ('steady_06', 'steady', null, '2026-06-05', 'util'),
  ('steady_07', 'steady', null, '2026-07-05', 'util'), ('steady_08', 'steady', null, '2026-08-05', 'util'),
  ('quarter_1125', 'quarter', 'site', '2025-11-10', 'util'), ('quarter_0226', 'quarter', 'site', '2026-02-10', 'util'),
  ('quarter_0526', 'quarter', 'site', '2026-05-10', 'util'), ('quarter_0826', 'quarter', null, '2026-08-10', 'util'),
  ('annual_2409', 'annual', 'site', '2024-09-12', 'util'), ('annual_2509', 'annual', 'site', '2025-09-12', 'util'),
  ('annual_2509u', 'annual', null, '2025-09-14', 'util'),
  ('forced_09', 'forced', 'site', '2026-09-02', 'util'),
  ('ended_03', 'ended', 'site', '2026-03-06', 'misc'), ('ended_04', 'ended', 'site', '2026-04-06', 'misc'),
  ('ended_05', 'ended', 'site', '2026-05-06', 'misc'), ('ended_06', 'ended', null, '2026-06-06', 'misc'),
  ('ended_07', 'ended', null, '2026-07-06', 'misc'), ('ended_08', 'ended', null, '2026-08-06', 'misc'),
  ('three_06', 'three', 'site', '2026-06-15', 'util'), ('three_07', 'three', 'site', '2026-07-15', 'util'),
  ('three_08', 'three', 'site', '2026-08-15', 'util'),
  ('oldp_03', 'oldp', 'old', '2026-03-08', 'misc'), ('oldp_04', 'oldp', 'old', '2026-04-08', 'misc'),
  ('oldp_05', 'oldp', 'old', '2026-05-08', 'misc'), ('oldp_06', 'oldp', null, '2026-06-08', 'misc'),
  ('oldp_07', 'oldp', null, '2026-07-08', 'misc'), ('oldp_08', 'oldp', null, '2026-08-08', 'misc'),
  -- Gone: monthly on the site (the last with no project), the owner's end date 2026-08-31 (FLOW-1266): detected,
  -- not listed; its line with no project is still not a general cost.
  ('gone_05', 'gone', 'site', '2026-05-11', 'util'), ('gone_06', 'gone', 'site', '2026-06-11', 'util'),
  ('gone_07', 'gone', 'site', '2026-07-11', 'util'), ('gone_08', 'gone', null, '2026-08-11', 'util'),
  -- Twice: one supplier, a monthly charge on each site (two charges with one name).
  ('twice_a6', 'twice', 'site', '2026-06-18', 'util'), ('twice_a7', 'twice', 'site', '2026-07-18', 'util'),
  ('twice_a8', 'twice', 'site', '2026-08-18', 'util'), ('twice_b6', 'twice', 'site2', '2026-06-19', 'misc'),
  ('twice_b7', 'twice', 'site2', '2026-07-19', 'misc'), ('twice_b8', 'twice', 'site2', '2026-08-19', 'misc'),
  -- Cleaner: monthly on the overhead project.
  ('cleaner_06', 'cleaner', 'office', '2026-06-21', 'misc'), ('cleaner_07', 'cleaner', 'office', '2026-07-21', 'misc'),
  ('cleaner_08', 'cleaner', 'office', '2026-08-21', 'misc');
insert into pg_temp.ro (label, id)
select 'loose_' || to_char(d, 'MM'), tests.fixture_line(pg_temp.id('co'), 'ro:loose_' || to_char(d, 'MM'), 10000,
  'expense', null, pg_temp.id('misc'), d::date + 7, p_pnl_role => null)
from generate_series('2026-03-01'::date, '2026-08-01'::date, interval '1 month') d;
update public.transactions t set supplier_id = pg_temp.id('loose')
where t.company_id = pg_temp.id('co') and t.idempotency_key like 'ro:loose_%';

insert into pg_temp.ro (label, id)
select l.label, tests.fixture_line(
  pg_temp.id('co'), 'ro:' || l.label, 10000 + 100 * (l.party = 'twice' and l.project = 'site2')::integer, 'expense',
  pg_temp.id(l.project), pg_temp.id(l.category), l.doc_date,
  p_pnl_role => case when l.project is null then null when l.project = 'office' then 'overhead' else 'project' end
)
from ro_lines l;
update public.transactions t
set supplier_id = pg_temp.id(l.party)
from ro_lines l
where t.id = pg_temp.id(l.label);

-- Rent: monthly income on the site.
insert into pg_temp.ro (label, id)
select 'rent_' || to_char(d, 'MM'), tests.fixture_line(pg_temp.id('co'), 'ro:rent_' || to_char(d, 'MM'), 400000,
  'income', pg_temp.id('site'), pg_temp.id('rent'), d::date, p_doc_kind => 'invoice')
from generate_series('2026-04-01'::date, '2026-09-01'::date, interval '1 month') d;
update public.transactions t set customer_id = pg_temp.id('tenant')
where t.company_id = pg_temp.id('co') and t.idempotency_key like 'ro:rent_%';

insert into public.recurring_overrides (company_id, direction, party_id, currency, project_id, recurring, ends_on)
values (pg_temp.id('co'), 'expense', pg_temp.id('forced'), 'ILS', pg_temp.id('site'), true, null),
  (pg_temp.id('co'), 'expense', pg_temp.id('ended'), 'ILS', null, false, null),
  (pg_temp.id('co'), 'expense', pg_temp.id('gone'), 'ILS', pg_temp.id('site'), null, '2026-08-31');

-- An edit from October, an added line from November, and a skip of the steady charge in November.
insert into public.project_forecast_edits (company_id, project_id, kind, row_key, category_id, direction, amount_minor, pace, start_month)
values (pg_temp.id('co'), pg_temp.id('site'), 'change', 'rec:expense:' || pg_temp.id('steady'), null, null, 12000, 'month', '2026-10'),
  (pg_temp.id('co'), pg_temp.id('site2'), 'add', null, pg_temp.id('misc'), 'expense', 5000, 'month', '2026-11');
insert into public.forecast_overrides (company_id, month, item_key, amount_minor, due_on, moved_out)
values (pg_temp.id('co'), '2026-11', 'party:expense:' || pg_temp.id('steady') || ':ILS:' || pg_temp.id('site'), null, null, true);

-- The two reads' bodies from before this change: today's with company_next_month_inputs and expected_months put back.
do $old$
declare
  def text;
begin
  def := pg_get_functiondef('public.company_forecast(text[], text, date)'::regprocedure);
  if position('private.forecast_gather(' in def) = 0 then
    raise exception 'company_forecast does not read forecast_gather';
  end if;
  def := replace(def, E'  gathered jsonb;\n', E'  expected jsonb;\n');
  def := replace(def, $a$  -- FLOW-1320: company_next_month_inputs' answer and expected_months(0)'s charges in one read, the charges read once.
  gathered := private.forecast_gather(today, null,
    case when exists (select 1 from unnest(p_months) m where m <> next_month) then 'rest' else 'next' end);
  inputs := gathered -> 'inputs';$a$, $b$  inputs := public.company_next_month_inputs(today, exists (select 1 from unnest(p_months) m where m <> next_month));
  expected := public.expected_months(0, null, today);$b$);
  def := replace(def, $a$coalesce(gathered -> 'recurring'$a$, $b$coalesce(expected -> 'recurring'$b$);
  if position('gathered' in def) > 0 then
    raise exception 'company_forecast: the old body was not put back';
  end if;
  execute replace(def, 'public.company_forecast(', 'pg_temp.old_cf_1320(');

  def := pg_get_functiondef('public.project_forecast(uuid, text, date, text)'::regprocedure);
  def := replace(def, E'  gathered jsonb;\n', '');
  def := replace(def, $a$  -- FLOW-1320: the charges (expected_months(0)'s, of the project unless it is the general costs) and the general
  -- costs' months (company_next_month_inputs') in one read, the charges read once.
  gathered := private.forecast_gather(today, case when general then null else p_project end,
    case when general then 'general' end);
  if general then
    months := gathered -> 'inputs' -> 'general';$a$, $b$  if general then
    months := public.company_next_month_inputs(today, false) -> 'general';$b$);
  def := replace(def, $a$    'recurring', coalesce(gathered -> 'recurring', '[]'::jsonb),$a$,
    $b$    'recurring', coalesce(public.expected_months(0, case when general then null else p_project end, today) -> 'recurring', '[]'::jsonb),$b$);
  if position('gathered' in def) > 0 then
    raise exception 'project_forecast: the old body was not put back';
  end if;
  execute replace(def, 'public.project_forecast(', 'pg_temp.old_pf_1320(');
end
$old$;
grant execute on function pg_temp.old_cf_1320(text[], text, date) to authenticated;
grant execute on function pg_temp.old_pf_1320(uuid, text, date, text) to authenticated;

-- Privileges and shape.
select ok(not has_function_privilege('anon', 'private.recurring_charges(uuid, date, boolean, boolean)', 'execute')
    and not has_function_privilege('authenticated', 'private.recurring_charges(uuid, date, boolean, boolean)', 'execute'),
  'recurring_charges is closed to the API roles');
select ok(has_function_privilege('authenticated', 'private.forecast_gather(date, uuid, text)', 'execute')
    and not has_function_privilege('anon', 'private.forecast_gather(date, uuid, text)', 'execute'),
  'forecast_gather: authenticated may execute it (the reads are security invoker), anon may not');
select is(
  (select p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p
   where p.oid = 'private.forecast_gather(date, uuid, text)'::regprocedure),
  true,
  'forecast_gather is security definer with an empty search_path');

-- recurring_parties is the listed rows of recurring_charges, in order, on both days.
select is(
  (select string_agg((r.direction, r.party_id, r.currency, r.months_seen, r.typical_day, r.typical_amount_minor,
       r.last_doc_date, r.seen_this_month, r.project_id, r.category_id, r.last_amount_minor, r.source, r.pace,
       r.pace_source, r.next_due_month, r.typical_amount_source, r.pays_loan, r.this_month_minor,
       r.this_month_transaction_id, r.this_month_line_count, r.ends_on)::text, E'\n' order by d, r.n)
   from unnest(array['2026-09-20', '2026-10-05']::date[]) d,
     private.recurring_parties(pg_temp.id('co'), d) with ordinality r(direction, party_id, currency, months_seen,
       typical_day, typical_amount_minor, last_doc_date, seen_this_month, project_id, category_id, last_amount_minor,
       source, pace, pace_source, next_due_month, typical_amount_source, pays_loan, this_month_minor,
       this_month_transaction_id, this_month_line_count, ends_on, n)),
  (select string_agg((c.direction, c.party_id, c.currency, c.months_seen, c.typical_day, c.typical_amount_minor,
       c.last_doc_date, c.seen_this_month, c.project_id, c.category_id, c.last_amount_minor, c.source, c.pace,
       c.pace_source, c.next_due_month, c.typical_amount_source, c.pays_loan, c.this_month_minor,
       c.this_month_transaction_id, c.this_month_line_count, c.ends_on)::text, E'\n' order by d, c.ord)
   from unnest(array['2026-09-20', '2026-10-05']::date[]) d,
     private.recurring_charges(pg_temp.id('co'), d, true, true) c
   where c.listed),
  'recurring_parties is the listed rows of recurring_charges, in its order');
select ok(
  exists (select 1 from private.recurring_charges(pg_temp.id('co'), '2026-09-20', true, true) c
    where c.party_id = pg_temp.id('gone') and not c.listed)
  and (select count(*) from private.recurring_charges(pg_temp.id('co'), '2026-09-20', true, true) c
    where c.party_id = pg_temp.id('twice') and c.listed) = 2
  and not exists (select 1 from private.recurring_charges(pg_temp.id('co'), '2026-09-20', true, false) c
    where c.line_ids is not null),
  'the fixture has a charge that is over (not listed) and a party with two listed charges; no lines unless asked');

-- The charges' lines with a project are recurring_charge_lines_of_projects' lines.
select is(
  (select array_agg(l.id order by l.id) from private.recurring_charges(pg_temp.id('co'), '2026-09-20', true, true) c
   cross join unnest(c.line_ids) l(id) where c.project_id is not null),
  (select array_agg(h.id order by h.id) from private.recurring_charge_lines_of_projects(pg_temp.id('co'), '2026-09-20') h),
  'the lines of the charges with a project are recurring_charge_lines_of_projects'' lines (2026-09-20)');
select is(
  (select array_agg(l.id order by l.id) from private.recurring_charges(pg_temp.id('co'), '2026-10-05', true, true) c
   cross join unnest(c.line_ids) l(id) where c.project_id is not null),
  (select array_agg(h.id order by h.id) from private.recurring_charge_lines_of_projects(pg_temp.id('co'), '2026-10-05') h),
  'and on 2026-10-05');
select ok(
  (select bool_and(l.id = any(array(select h.id from private.recurring_charge_lines_of_projects(pg_temp.id('co'), '2026-09-20') h)))
   from unnest(array[pg_temp.id('gone_08'), pg_temp.id('twice_b8'), pg_temp.id('forced_09'), pg_temp.id('cleaner_08')]) l(id)),
  'the lines include the over charge''s, both charges of the party billing two projects, the forced one and the overhead one');

select tests.authenticate_as('ro_owner');

-- forecast_gather's inputs are company_next_month_inputs' answer.
select is(
  (select jsonb_agg(private.forecast_gather(d, null, 'rest') -> 'inputs' order by d)
   from unnest(array['2026-09-20', '2026-10-05']::date[]) d),
  (select jsonb_agg(public.company_next_month_inputs(d, true) order by d)
   from unnest(array['2026-09-20', '2026-10-05']::date[]) d),
  'forecast_gather ''rest'' gives company_next_month_inputs(today, true)');
select is(
  (select jsonb_agg(private.forecast_gather(d, null, 'next') -> 'inputs' order by d)
   from unnest(array['2026-09-20', '2026-10-05']::date[]) d),
  (select jsonb_agg(public.company_next_month_inputs(d, false) order by d)
   from unnest(array['2026-09-20', '2026-10-05']::date[]) d),
  'forecast_gather ''next'' gives company_next_month_inputs(today, false)');
select is(
  (select jsonb_agg(private.forecast_gather(d, null, 'general') -> 'inputs' order by d)
   from unnest(array['2026-09-20', '2026-10-05']::date[]) d),
  (select jsonb_agg(jsonb_build_object('general', public.company_next_month_inputs(d, false) -> 'general') order by d)
   from unnest(array['2026-09-20', '2026-10-05']::date[]) d),
  'forecast_gather ''general'' gives its general costs only');
select ok(
  jsonb_array_length(public.company_next_month_inputs('2026-09-20', false) -> 'general') > 0
  and jsonb_array_length(public.company_next_month_inputs('2026-09-20', true) -> 'rest_edits') > 0
  and public.company_next_month_inputs('2026-10-05', true) -> 'skips' ? '2026-11',
  'the inputs have general costs, later edits and a skip');

-- Its charges are expected_months(0)'s without the handover and seen_this_month: the same charges, in expected_months'
-- order by direction, name and party (one party's several charges, a tie, in the charges' order: the order of a tie
-- in expected_months depends on its plan, and neither build's answer depends on it).
select is(
  (select jsonb_agg((select coalesce(jsonb_agg(e order by e::text), '[]'::jsonb)
       from jsonb_array_elements(private.forecast_gather(d, p, null) -> 'recurring') e) order by d, p)
   from unnest(array['2026-09-20', '2026-10-05']::date[]) d,
     unnest(array[null, pg_temp.id('site'), pg_temp.id('site2'), pg_temp.id('office')]) p),
  (select jsonb_agg((select coalesce(jsonb_agg(e - 'handover' - 'seen_this_month' order by (e - 'handover' - 'seen_this_month')::text), '[]'::jsonb)
       from jsonb_array_elements(public.expected_months(0, p, d) -> 'recurring') e) order by d, p)
   from unnest(array['2026-09-20', '2026-10-05']::date[]) d,
     unnest(array[null, pg_temp.id('site'), pg_temp.id('site2'), pg_temp.id('office')]) p),
  'forecast_gather''s charges are expected_months(0)''s, for the company and for a project');
select is(
  (select count(*)::integer
   from unnest(array['2026-09-20', '2026-10-05']::date[]) d,
     unnest(array[null, pg_temp.id('site'), pg_temp.id('site2'), pg_temp.id('office')]) p,
     lateral (select e, n, lag(e) over (order by n) as prev
       from jsonb_array_elements(private.forecast_gather(d, p, null) -> 'recurring') with ordinality x(e, n)) w
   where w.prev is not null
     and ((w.prev ->> 'direction')::public.txn_direction, w.prev ->> 'name', (w.prev ->> 'party_id')::uuid)
       > ((w.e ->> 'direction')::public.txn_direction, w.e ->> 'name', (w.e ->> 'party_id')::uuid)),
  0,
  'in expected_months'' order: by direction, name and party');

-- The reads answer as before.
select is(
  (select jsonb_agg(public.company_forecast(m, t, d) order by d, ord)
   from unnest(array['2026-09-20', '2026-10-05']::date[]) d,
     lateral (select array(select to_char(x, 'YYYY-MM') from generate_series(date_trunc('month', d) + interval '1 month',
       date_trunc('month', d) + interval '12 months', interval '1 month') x) as hz) h,
     lateral (values (1, h.hz[1:1], 'totals'), (2, h.hz, 'totals'), (3, array[h.hz[3], h.hz[1]], 'totals')) v(ord, m, t)),
  (select jsonb_agg(pg_temp.old_cf_1320(m, t, d) order by d, ord)
   from unnest(array['2026-09-20', '2026-10-05']::date[]) d,
     lateral (select array(select to_char(x, 'YYYY-MM') from generate_series(date_trunc('month', d) + interval '1 month',
       date_trunc('month', d) + interval '12 months', interval '1 month') x) as hz) h,
     lateral (values (1, h.hz[1:1], 'totals'), (2, h.hz, 'totals'), (3, array[h.hz[3], h.hz[1]], 'totals')) v(ord, m, t)),
  'company_forecast totals: as before (next month, the 12 months, two months out of order)');
select is(
  (select jsonb_agg(public.company_forecast(array[m], 'rows', d) order by d, m)
   from unnest(array['2026-09-20', '2026-10-05']::date[]) d,
     lateral (select to_char(date_trunc('month', d) + make_interval(months => k), 'YYYY-MM') m from unnest(array[1, 2, 12]) k) mm),
  (select jsonb_agg(pg_temp.old_cf_1320(array[m], 'rows', d) order by d, m)
   from unnest(array['2026-09-20', '2026-10-05']::date[]) d,
     lateral (select to_char(date_trunc('month', d) + make_interval(months => k), 'YYYY-MM') m from unnest(array[1, 2, 12]) k) mm),
  'company_forecast rows: as before (months 1, 2 and 12)');
select ok(
  (select bool_and(jsonb_array_length(public.company_forecast(array[to_char(date_trunc('month', d) + interval '1 month', 'YYYY-MM')], 'rows', d)
     -> 'months' -> 0 -> 'parts') >= 3) from unnest(array['2026-09-20', '2026-10-05']::date[]) d),
  'the rows list the sites'' parts and the general costs');
select is(
  (select jsonb_agg(public.project_forecast(p, m, d, c) order by d, p, m, c)
   from unnest(array['2026-09-20', '2026-10-05']::date[]) d,
     unnest(array[pg_temp.id('site'), pg_temp.id('site2'), pg_temp.id('old'), pg_temp.id('office')]) p,
     lateral (select to_char(date_trunc('month', d) + make_interval(months => k), 'YYYY-MM') m from unnest(array[1, 2, 12]) k) mm,
     unnest(array[null, 'USD']) c),
  (select jsonb_agg(pg_temp.old_pf_1320(p, m, d, c) order by d, p, m, c)
   from unnest(array['2026-09-20', '2026-10-05']::date[]) d,
     unnest(array[pg_temp.id('site'), pg_temp.id('site2'), pg_temp.id('old'), pg_temp.id('office')]) p,
     lateral (select to_char(date_trunc('month', d) + make_interval(months => k), 'YYYY-MM') m from unnest(array[1, 2, 12]) k) mm,
     unnest(array[null, 'USD']) c),
  'project_forecast: as before, for each project and the overhead one');
select ok(
  jsonb_array_length(public.project_forecast(pg_temp.id('site'), '2026-10', '2026-09-20') -> 'charges') >= 4
  and jsonb_array_length(public.project_forecast(pg_temp.id('office'), '2026-10', '2026-09-20') -> 'rows') >= 2,
  'the site has its charges and the general costs their rows');

-- Refusals.
select throws_ok($$select private.forecast_gather('2026-09-20', null, 'all')$$, '22023', 'validation',
  'forecast_gather refuses an unknown p_inputs');

select tests.authenticate_as('ro_nobody');
select throws_ok($$select private.forecast_gather('2026-09-20', null, 'rest')$$, '42501', 'forbidden',
  'forecast_gather refuses a user with no company');

select * from finish();
rollback;
