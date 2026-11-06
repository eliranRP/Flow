-- FLOW-1066 (decision 0260): the forecast reaches 12 months after the current one. "Today" is 2026-11-06, so the
-- forecast runs from December 2026 to November 2027.
-- - company_next_month_inputs' rest_edits holds every edit that applies to a month of the forecast (no longer
--   only the rest of the year), and an added line's matches for those months only.
-- - expected_months takes 13 months (this month and the 12); 14 is refused. Its recurring[] is every charge
--   whatever p_months is, so the app builds a month a year ahead from p_months 2.
-- Invented data only. Amounts are agorot.

begin;

select plan(12);

do $users$
begin
  perform tests.create_supabase_user('fam_owner', 'fam-owner@example.com');
  perform tests.create_supabase_user('fam_other', 'fam-other@example.com');
end
$users$;

create temp table fam (label text primary key, id uuid);
grant all on fam to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from pg_temp.fam where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into fam (label, id) values ('co', tests.fixture_company('fam_owner', 'Example Horizon LLC'));
insert into fam (label, id) values ('other_co', tests.fixture_company('fam_other', 'Example Other Horizon LLC'));
insert into fam (label, id) values
  ('house', tests.fixture_project(pg_temp.id('co'), 'Example House')),
  ('office', tests.fixture_category(pg_temp.id('co'), 'Office')),
  ('other_house', tests.fixture_project(pg_temp.id('other_co'), 'Example Other House'));

-- A quarterly supplier: February, May and August, so next due in November, then every three months.
insert into public.suppliers (company_id, name) values (pg_temp.id('co'), 'Example Quarterly');
insert into fam (label, id) select 'quarterly', s.id from public.suppliers s where s.company_id = pg_temp.id('co') and s.name = 'Example Quarterly';
create temp table fam_lines (label text, doc_date date);
insert into fam_lines values ('q02', '2026-02-05'), ('q05', '2026-05-05'), ('q08', '2026-08-05');
insert into fam (label, id)
select l.label, tests.fixture_line(pg_temp.id('co'), 'fam:' || l.label, 90000, 'expense', null, null, l.doc_date,
  p_pnl_role => null, p_doc_kind => 'receipt')
from fam_lines l;
update public.transactions t set supplier_id = pg_temp.id('quarterly') from fam_lines l where t.id = pg_temp.id(l.label);
-- A line for the added edit's matches.
insert into fam (label, id) values ('m04', tests.fixture_line(pg_temp.id('co'), 'fam:m04', 4000, 'income', null, null, '2026-10-01', p_pnl_role => null));
insert into fam (label, id) values ('m12', tests.fixture_line(pg_temp.id('co'), 'fam:m12', 4000, 'income', null, null, '2026-10-02', p_pnl_role => null));

-- Edits: one in March 2027 (after December), one in the forecast's last month, one a month past it, one for this
-- month (not a later month), and a yearly one from January 2026 (January 2027); the other company's in March.
insert into public.project_forecast_edits (company_id, project_id, kind, row_key, amount_minor, pace, start_month)
values
  (pg_temp.id('co'), pg_temp.id('house'), 'change', 'avg:march', 1000, 'once', '2027-03'),
  (pg_temp.id('co'), pg_temp.id('house'), 'change', 'avg:last', 2000, 'once', '2027-11'),
  (pg_temp.id('co'), pg_temp.id('house'), 'change', 'avg:past', 3000, 'once', '2027-12'),
  (pg_temp.id('co'), pg_temp.id('house'), 'change', 'avg:now', 4000, 'once', '2026-11'),
  (pg_temp.id('co'), pg_temp.id('house'), 'change', 'avg:yearly', 5000, 'year', '2026-01'),
  (pg_temp.id('other_co'), pg_temp.id('other_house'), 'change', 'avg:other', 6000, 'once', '2027-03');
-- An added monthly line from February 2027, matched in April 2027 and in December 2027 (past the forecast).
insert into public.project_forecast_edits (company_id, project_id, kind, category_id, direction, amount_minor, pace, start_month)
values (pg_temp.id('co'), pg_temp.id('house'), 'add', pg_temp.id('office'), 'income', 4000, 'month', '2027-02');
insert into fam (label, id) select 'add_edit', e.id from public.project_forecast_edits e where e.company_id = pg_temp.id('co') and e.kind = 'add';
insert into public.forecast_line_matches (company_id, edit_id, month, transaction_id, expected_minor)
values
  (pg_temp.id('co'), pg_temp.id('add_edit'), '2027-04', pg_temp.id('m04'), 4000),
  (pg_temp.id('co'), pg_temp.id('add_edit'), '2027-12', pg_temp.id('m12'), 4000);

create function pg_temp.inputs() returns jsonb language sql stable as $$
  select public.company_next_month_inputs('2026-11-06');
$$;
grant execute on function pg_temp.inputs() to authenticated;

select tests.authenticate_as('fam_owner');

-- 1-5. company_next_month_inputs over the forecast's months.
select is(pg_temp.inputs()->>'month', '2026-12', 'next month is still next month');
select is((select array_agg(x->>'row_key' order by x->>'row_key') from jsonb_array_elements(pg_temp.inputs()->'rest_edits') x),
  array['avg:last', 'avg:march', 'avg:yearly', null],
  'rest_edits: every edit that applies to a month from December 2026 to November 2027, not past it or this month''s');
select is((select x->'matches' from jsonb_array_elements(pg_temp.inputs()->'rest_edits') x where x->>'kind' = 'add'),
  jsonb_build_object('2027-04', pg_temp.id('m04')::text),
  'an added line''s matches by month, only for the forecast''s months');
select is(jsonb_array_length(pg_temp.inputs()->'edits'), 0, 'edits stay next month''s (none applies to December)');
select is((select array_agg(x->>'row_key' order by x->>'row_key') from jsonb_array_elements(public.company_next_month_inputs('2026-01-15')->'rest_edits') x),
  array['avg:now', 'avg:yearly'],
  'in January the forecast runs to January next year: November''s edit and the yearly one (January 2027), not March 2027''s');

-- 6-11. expected_months: 13 months at most; recurring[] does not depend on p_months.
select is(jsonb_array_length(public.expected_months(13, null, '2026-11-06')->'months'), 13, 'thirteen months: this one and the forecast''s 12');
select is((public.expected_months(13, null, '2026-11-06')->'months'->12->>'month'), '2027-11', 'the last is the forecast''s last month');
select ok((public.expected_months(13, null, '2026-11-06')->'months'->12->'by_currency'->0->>'expense_minor')::bigint <> 0,
  'the quarterly charge comes again in November 2027');
select is((public.expected_months(13, null, '2026-11-06')->'months'->11->'by_currency'), '[]'::jsonb, 'and not in October 2027');
select is(
  (select e->>'pace' || ' ' || (e->>'next_due_month') from jsonb_array_elements(public.expected_months(2, null, '2026-11-06')->'recurring') e
   where (e->>'party_id')::uuid = pg_temp.id('quarterly')),
  'quarter 2026-11',
  'months 2 still lists every charge with its pace and next due month, so any later month can be built from it');
select throws_ok($$ select public.expected_months(14, null, '2026-11-06') $$, 'validation', 'fourteen months is refused');

-- 12. Another company reads its own.
select tests.authenticate_as('fam_other');
select is((select array_agg(x->>'row_key') from jsonb_array_elements(pg_temp.inputs()->'rest_edits') x),
  array['avg:other'], 'another company reads only its own later edits');

select * from finish();
rollback;
