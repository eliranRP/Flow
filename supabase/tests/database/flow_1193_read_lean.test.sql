-- FLOW-1193 (20261114090214): fields no app code reads are left out.
-- - projects_cash_month: projects[] has no profit_month_minor, and every figure the app reads is as it was (the
--   month's cash, the all-time profit and spend).
-- - expected_months: p_months 0 answers without months[]: the same today, project_id and recurring[] the full
--   form gives, for the company and for a project. From 1 to 13 months the answer is what it was (flow-mcp's
--   get_expected_months); 14 and a negative count are refused.
-- (get_project's lean answer is get_project_speed.test.sql's.) Invented data only. "Today" is 2026-09-20.
-- Amounts are agorot.

begin;

select plan(19);

do $users$
begin
  perform tests.create_supabase_user('lean_owner', 'lean-owner@example.com');
  perform tests.create_supabase_user('lean_other', 'lean-other@example.com');
end
$users$;

create temp table lean (label text primary key, id uuid);
grant all on lean to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from pg_temp.lean where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into lean (label, id) values ('co', tests.fixture_company('lean_owner', 'Example Lean Read LLC'));
insert into lean (label, id) values ('other_co', tests.fixture_company('lean_other', 'Example Other Lean Read LLC'));
insert into lean (label, id) values
  ('house', tests.fixture_project(pg_temp.id('co'), 'Example House')),
  ('barn', tests.fixture_project(pg_temp.id('co'), 'Example Barn')),
  ('paint', tests.fixture_category(pg_temp.id('co'), 'Paint')),
  ('sales', tests.fixture_category(pg_temp.id('co'), 'Sales', 'income'));

-- The house: 1,000.00 in and 400.00 out in September, 250.00 out in July (and its power bills below). The barn has nothing.
insert into lean (label, id) values
  ('in9', tests.fixture_line(pg_temp.id('co'), 'lean:in9', 100000, 'income', pg_temp.id('house'), pg_temp.id('sales'), '2026-09-03')),
  ('out9', tests.fixture_line(pg_temp.id('co'), 'lean:out9', 40000, 'expense', pg_temp.id('house'), pg_temp.id('paint'), '2026-09-05')),
  ('out7', tests.fixture_line(pg_temp.id('co'), 'lean:out7', 25000, 'expense', pg_temp.id('house'), pg_temp.id('paint'), '2026-07-09'));

-- A monthly supplier on the house (June to August: due in September) and a quarterly one with no project
-- (February, May and August: due in November).
insert into public.suppliers (company_id, name) values (pg_temp.id('co'), 'Example Power'), (pg_temp.id('co'), 'Example Quarterly');
insert into lean (label, id) select 'power', s.id from public.suppliers s where s.company_id = pg_temp.id('co') and s.name = 'Example Power';
insert into lean (label, id) select 'quarterly', s.id from public.suppliers s where s.company_id = pg_temp.id('co') and s.name = 'Example Quarterly';
create temp table lean_lines (label text, doc_date date, supplier text, project text);
insert into lean_lines values
  ('p06', '2026-06-05', 'power', 'house'), ('p07', '2026-07-05', 'power', 'house'), ('p08', '2026-08-05', 'power', 'house'),
  ('q02', '2026-02-05', 'quarterly', null), ('q05', '2026-05-05', 'quarterly', null), ('q08', '2026-08-06', 'quarterly', null);
insert into lean (label, id)
select l.label, tests.fixture_line(pg_temp.id('co'), 'lean:' || l.label, 9000, 'expense', pg_temp.id(l.project), null, l.doc_date,
  p_pnl_role => case when l.project is null then null else 'project' end)
from lean_lines l;
update public.transactions t set supplier_id = pg_temp.id(l.supplier) from lean_lines l where t.id = pg_temp.id(l.label);

-- The other company's line, so a read never crosses.
insert into lean (label, id) values ('other_house', tests.fixture_project(pg_temp.id('other_co'), 'Example Other House'));
select tests.fixture_line(pg_temp.id('other_co'), 'lean:other', 5000, 'income', pg_temp.id('other_house'), null, '2026-09-02');

create function pg_temp.cash(p_month date default '2026-09-01') returns jsonb language sql stable as $$
  select public.projects_cash_month(p_month, '2026-09-20');
$$;
grant execute on function pg_temp.cash(date) to authenticated;

create function pg_temp.row(p_cash jsonb, p_label text) returns jsonb language sql immutable as $$
  select r from jsonb_array_elements(p_cash->'projects') r where (r->>'id')::uuid = pg_temp.id(p_label);
$$;
grant execute on function pg_temp.row(jsonb, text) to authenticated;

select tests.authenticate_as('lean_owner');

-- projects_cash_month.
select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.row(pg_temp.cash(), 'house')) k),
  array['budget_minor', 'cash', 'created_at', 'deletable', 'finished_on', 'first_month', 'group_id', 'id', 'is_overhead',
    'name', 'pending_count', 'profit_all_minor', 'spent_minor', 'status', 'type'],
  'a project row has the fifteen fields the app reads, and no profit_month_minor');
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.cash()->'projects') r where r ? 'profit_month_minor')
    and not exists (select 1 from jsonb_array_elements(pg_temp.cash('2026-07-01')->'projects') r where r ? 'profit_month_minor'),
  'no project of any month carries it');
select is((pg_temp.row(pg_temp.cash(), 'house')->>'profit_all_minor')::bigint, 8000::bigint,
  'the house''s all-time profit: 1,000.00 in, 400.00, 250.00 and three power bills of 90.00 out');
select is((pg_temp.row(pg_temp.cash(), 'house')->>'spent_minor')::bigint, 92000::bigint, 'its all-time spend is 920.00');
select is(pg_temp.row(pg_temp.cash(), 'house')->'cash',
  '[{"currency": "ILS", "in_minor": 100000, "out_minor": 40000, "net_minor": 60000}]'::jsonb,
  'September''s cash is still the month''s: 1,000.00 in, 400.00 out');
select is((pg_temp.row(pg_temp.cash('2026-07-01'), 'house')->>'profit_all_minor')::bigint, 8000::bigint,
  'another month, the same all-time profit');
select is((pg_temp.row(pg_temp.cash(), 'barn')->>'profit_all_minor')::bigint, 0::bigint, 'a project with no lines: zero, as before');
select is(pg_temp.row(pg_temp.cash(), 'house')->>'first_month', '2026-06-01', 'the first month is still there');

-- expected_months.
create function pg_temp.em(p_months integer, p_project text default null) returns jsonb language sql stable as $$
  select public.expected_months(p_months, pg_temp.id(p_project), '2026-09-20');
$$;
grant execute on function pg_temp.em(integer, text) to authenticated;

select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.em(0)) k), array['project_id', 'recurring', 'today'],
  'p_months 0: today, project_id and recurring[], with no months key');
select is(pg_temp.em(0)->>'today', pg_temp.em(3)->>'today', 'the lean today is the full answer''s');
select ok(jsonb_array_length(pg_temp.em(0)->'recurring') = 2 and pg_temp.em(0)->'recurring' = pg_temp.em(3)->'recurring'
    and pg_temp.em(0)->'recurring' = pg_temp.em(13)->'recurring',
  'the lean recurring[] (both charges) is the one 3 and 13 months give');
select is(pg_temp.em(0, 'house') - 'months', pg_temp.em(2, 'house') - 'months',
  'for a project: the lean answer is the full one without months, project_id too');
select is(jsonb_array_length(pg_temp.em(0, 'house')->'recurring'), 1, 'and only the house''s charge');
select is(pg_temp.em(13) - 'months', pg_temp.em(0), 'the full answer less months[] is the lean one');
select is((select array_agg(jsonb_array_length(pg_temp.em(n)->'months') order by n) from generate_series(1, 13) n),
  array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], 'from 1 to 13 months the answer keeps its months[], as flow-mcp reads it');
select is(jsonb_array_length(public.expected_months(p_today => '2026-09-20')->'months'), 3, 'the default is still 3 months');
select throws_ok($$ select public.expected_months(14, null, '2026-09-20') $$, 'validation', 'fourteen months is refused');
select throws_ok($$ select public.expected_months(-1, null, '2026-09-20') $$, 'validation', 'a negative count is refused');

select tests.authenticate_as('lean_other');
select is(public.expected_months(0, null, '2026-09-20')->'recurring', '[]'::jsonb, 'another company reads only its own charges');

select * from finish();
rollback;
