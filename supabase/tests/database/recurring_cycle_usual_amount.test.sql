-- Decision 0199. A recurring charge that comes every 2 months, quarter or year takes its usual amount and
-- day only from the months on its cycle (private.recurring_parties, private.project_recurring_arrivals),
-- counted back from its last complete month. Monthly charges and the owner's amount are unchanged.
-- Invented data only. Amounts are agorot. "Today" is 2026-10-20.

begin;

select plan(11);

do $users$
begin
  perform tests.create_supabase_user('cy_owner', 'cy-owner@example.com');
end
$users$;

create temp table cy (label text primary key, id uuid);
grant all on cy to authenticated, service_role;

insert into cy (label, id) values ('co', tests.fixture_company('cy_owner', 'Example Cycle LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.cy where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into cy (label, id) values ('site', tests.fixture_project(pg_temp.id('co'), 'Example Site'));

insert into public.suppliers (company_id, name)
select pg_temp.id('co'), n
from unnest(array['Example Switch', 'Example Steady', 'Example Annual']) n;
insert into cy (label, id)
select lower(replace(s.name, 'Example ', '')), s.id from public.suppliers s where s.company_id = pg_temp.id('co');

-- label, party, project, date, amount
create temp table cy_lines (label text, party text, project text, doc_date date, amount bigint);
-- Switch: 20.00 a month from April to June 2025, then in July 2025 a last monthly bill and the first
-- yearly one (40.00 + 400.00), and the yearly bill again in July 2026 (450.00).
insert into cy_lines values
  ('switch_2504', 'switch', null, '2025-04-09', 2000),
  ('switch_2505', 'switch', null, '2025-05-09', 2000),
  ('switch_2506', 'switch', null, '2025-06-09', 2000),
  ('switch_2507a', 'switch', null, '2025-07-09', 4000),
  ('switch_2507b', 'switch', null, '2025-07-09', 40000),
  ('switch_2607', 'switch', null, '2026-07-12', 45000);
-- Steady: monthly, 100.00 for the last six months, and one large bill a year before.
insert into cy_lines
select 'steady_' || to_char(d, 'YYMM'), 'steady', null, d::date + 4, 10000
from generate_series('2026-04-01'::date, '2026-09-01'::date, interval '1 month') d;
insert into cy_lines values ('steady_2509', 'steady', null, '2025-09-05', 90000);
-- Annual, on the project, marked yearly by the owner: 600.00 in October 2024 and 2025, small monthly bills
-- in between, and this October's bill of 660.00 (10% more than the yearly one).
insert into cy_lines values
  ('annual_2410', 'annual', 'site', '2024-10-03', 60000),
  ('annual_2510', 'annual', 'site', '2025-10-03', 60000),
  ('annual_2610', 'annual', 'site', '2026-10-03', 66000);
insert into cy_lines
select 'annual_' || to_char(d, 'YYMM'), 'annual', 'site', d::date + 2, 3000
from generate_series('2024-11-01'::date, '2025-06-01'::date, interval '1 month') d;

insert into cy (label, id)
select l.label, tests.fixture_line(
  pg_temp.id('co'), 'cy:' || l.label, l.amount, 'expense', pg_temp.id(l.project), null, l.doc_date,
  p_pnl_role => case when l.project is null then null else 'project' end
)
from cy_lines l;
update public.transactions t
set supplier_id = pg_temp.id(l.party)
from cy_lines l
where t.id = pg_temp.id(l.label);

insert into public.recurring_overrides (company_id, direction, party_id, currency, project_id, recurring, pace)
values (pg_temp.id('co'), 'expense', pg_temp.id('annual'), 'ILS', pg_temp.id('site'), true, 'year');

create or replace function pg_temp.charge(p_party text)
returns jsonb
language sql
as $$
  select to_jsonb(rp) - 'party_id' - 'project_id' - 'category_id' - 'last_doc_date' - 'last_amount_minor'
  from private.recurring_parties(pg_temp.id('co'), '2026-10-20') rp
  where rp.party_id = pg_temp.id(p_party);
$$;

-- 1-4. The switch to yearly billing: the yearly amount, not the old monthly bills.
select is(
  pg_temp.charge('switch') ->> 'pace',
  'year',
  'a party that switched from monthly to yearly billing is yearly'
);
select is(
  (pg_temp.charge('switch') ->> 'next_due_month')::date,
  '2027-07-01'::date,
  'its next bill is due a year after the last one'
);
select is(
  (pg_temp.charge('switch') ->> 'typical_amount_minor')::bigint,
  -44000::bigint,
  'its usual amount is the median of its yearly months only (July 2025 and July 2026), not of every month'
);
select is(
  (pg_temp.charge('switch') ->> 'typical_day')::integer,
  9,
  'its usual day comes from the same months'
);

-- 5. A reader follows: the line page's recurring state.
select tests.authenticate_as('cy_owner');
select is(
  (public.payment_recurring(pg_temp.id('switch_2607'), '2026-10-20') ->> 'typical_amount_minor')::bigint,
  -44000::bigint,
  'payment_recurring shows the yearly usual amount'
);
reset role;

-- 6. A monthly charge keeps the last six months' median.
select is(
  (pg_temp.charge('steady') ->> 'typical_amount_minor')::bigint,
  -10000::bigint,
  'a monthly charge is unchanged: the median of its last six months'
);

-- 7-8. A yearly charge the owner marked, on a project: the cycle's months (October 2024 and 2025).
select is(
  (pg_temp.charge('annual') ->> 'typical_amount_minor')::bigint,
  -60000::bigint,
  'a yearly charge with small bills between its yearly ones takes the yearly months'
);
select is(
  (select jsonb_build_object('usual', a.typical_amount_minor, 'percent', a.change_percent)
   from private.project_recurring_arrivals(pg_temp.id('co'), pg_temp.id('site'), '2026-10-20') a
   where a.party_id = pg_temp.id('annual')),
  jsonb_build_object('usual', -60000, 'percent', 10),
  'the project''s arrival compares this October with the yearly months, so it is 10% more'
);

-- 9-10. The owner's amount still wins.
update public.recurring_overrides set typical_amount_minor = 50000
where company_id = pg_temp.id('co') and party_id = pg_temp.id('annual');
select is(
  jsonb_build_array(pg_temp.charge('annual') -> 'typical_amount_minor', pg_temp.charge('annual') -> 'typical_amount_source'),
  '[-50000, "owner"]'::jsonb,
  'the owner''s usual amount wins over the cycle''s median'
);
select is(
  (select a.typical_amount_minor
   from private.project_recurring_arrivals(pg_temp.id('co'), pg_temp.id('site'), '2026-10-20') a
   where a.party_id = pg_temp.id('annual')),
  -50000::bigint,
  'and the project''s arrival compares with it'
);

-- 11. expected_months counts the yearly charge only in its due month, at the yearly amount.
select tests.authenticate_as('cy_owner');
select is(
  (select jsonb_agg(jsonb_build_array(m ->> 'month', m -> 'by_currency' -> 0 -> 'expense_minor') order by m ->> 'month')
   from jsonb_array_elements(public.expected_months(12, null, '2026-10-20') -> 'months') m
   where m ->> 'month' in ('2027-06', '2027-07')),
  '[["2027-06", -10000], ["2027-07", -54000]]'::jsonb,
  'July 2027 expects the yearly bill (440.00) beside the monthly one (100.00)'
);
reset role;

select * from finish();

rollback;
