-- Decision 0185, review follow-ups. The owner's "recurring" switch makes only the party's main charge
-- recurring; a line's usual amount is its own charge's; a lender with several loans is one lender.
-- Invented data only. Amounts are agorot. "Today" is 2026-10-20.

begin;

select plan(8);

do $users$
begin
  perform tests.create_supabase_user('sr_owner', 'sr-owner@example.com');
end
$users$;

create temp table sr (label text primary key, id uuid);
grant all on sr to authenticated, service_role;

insert into sr (label, id) values ('co', tests.fixture_company('sr_owner', 'Example Review LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.sr where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into sr (label, id) values
  ('alder', tests.fixture_project(pg_temp.id('co'), 'Alder Ct')),
  ('birch', tests.fixture_project(pg_temp.id('co'), 'Birch Way'));

insert into public.suppliers (company_id, name) values
  (pg_temp.id('co'), 'Example Power'),
  (pg_temp.id('co'), 'Example Fees'),
  (pg_temp.id('co'), 'Example Main'),
  (pg_temp.id('co'), 'Example Alias'),
  (pg_temp.id('co'), 'Example Servicing');
insert into sr (label, id)
select lower(replace(s.name, 'Example ', '')), s.id from public.suppliers s where s.company_id = pg_temp.id('co');

-- Power: 30,000 to Alder every month from April to October, and one stray 90,000 bill filed to Birch in
-- January. Fees: 20,000 to Alder in August and September only (not recurring by the rule), and one
-- 50,000 to Birch in March. The owner marked both recurring.
-- Main: 70,000 to Alder, April to September. Alias, answered "the same" as Main: 40,000 to Birch.
-- Servicing: 400,000 to Alder and 250,000 to Birch, April to September.
create temp table sr_lines (key text, party text, project text, doc_date date, amount bigint);
insert into sr_lines
select 'power:' || d::date, 'power', 'alder', d::date, 30000 from generate_series('2026-04-05'::date, '2026-10-05', interval '1 month') d;
insert into sr_lines values ('power-stray', 'power', 'birch', '2026-01-12', 90000);
insert into sr_lines values
  ('fees:aug', 'fees', 'alder', '2026-08-10', 20000),
  ('fees:sep', 'fees', 'alder', '2026-09-10', 20000),
  ('fees-stray', 'fees', 'birch', '2026-03-10', 50000);
insert into sr_lines
select 'main:' || d::date, 'main', 'alder', d::date, 70000 from generate_series('2026-04-07'::date, '2026-09-07', interval '1 month') d;
insert into sr_lines
select 'alias:' || d::date, 'alias', 'birch', d::date, 40000 from generate_series('2026-04-08'::date, '2026-09-08', interval '1 month') d;
insert into sr_lines
select 'servicing-a:' || d::date, 'servicing', 'alder', d::date, 400000 from generate_series('2026-04-01'::date, '2026-09-01', interval '1 month') d;
insert into sr_lines
select 'servicing-b:' || d::date, 'servicing', 'birch', d::date, 250000 from generate_series('2026-04-02'::date, '2026-09-02', interval '1 month') d;

insert into sr (label, id)
select l.key, tests.fixture_line(
  pg_temp.id('co'), 'sr:' || l.key, l.amount, 'expense', pg_temp.id(l.project), null, l.doc_date, p_pnl_role => null
)
from sr_lines l;
update public.transactions t set supplier_id = pg_temp.id(l.party)
from sr_lines l
where t.id = pg_temp.id(l.key);

insert into public.recurring_overrides (company_id, direction, party_id, currency, recurring)
select pg_temp.id('co'), 'expense', pg_temp.id(p), 'ILS', true from unnest(array['power', 'fees']) p;
insert into public.recurring_matches (company_id, direction, party_id, match_party_id, same)
values (pg_temp.id('co'), 'expense', pg_temp.id('main'), pg_temp.id('alias'), true);

create or replace function pg_temp.charges(p_party text)
returns setof jsonb
language sql
as $$
  select e from jsonb_array_elements(public.recurring_schedule('2026-10-20')) e
  where (e ->> 'party_id')::uuid = pg_temp.id(p_party);
$$;
grant execute on function pg_temp.charges(text) to authenticated, service_role;

select tests.authenticate_as('sr_owner');

-- 1-2. A stray bill to another project is not a charge of its own, so no false late alert.
select is((select count(*)::integer from pg_temp.charges('power')), 1, 'a party marked recurring keeps one charge, not one per project it ever billed');
select is(
  (select count(*)::integer from jsonb_array_elements(public.missing_bills('2026-10-20')) e
   where (e ->> 'party_id')::uuid = pg_temp.id('power')),
  0,
  'the stray project raises no late bill'
);

-- 3-4. With no charge recurring by the rule, the switch makes the main project's charge recurring.
select is((select count(*)::integer from pg_temp.charges('fees')), 1, 'a party recurring by the switch alone is one charge');
select is(
  (select (e ->> 'project_id')::uuid from pg_temp.charges('fees') e),
  pg_temp.id('alder'),
  'that charge is the project the party bills most'
);

-- 5-6. A merged party with lines in two projects: the line page reads its own charge's usual amount.
select lives_ok(
  format('select public.party_charges(%L, %L)', pg_temp.id('main:2026-09-07'), '2026-10-20'),
  'party_charges reads a merged party with two charges'
);
select is(
  (public.party_charges(pg_temp.id('main:2026-09-07'), '2026-10-20') ->> 'typical_amount_minor')::bigint,
  -70000::bigint,
  'the usual amount is the line''s own charge'
);

-- 7-8. The setup's lenders: one per supplier, its loans summed.
select is(
  (select count(*)::integer from jsonb_array_elements(public.get_setup_suggestions('2026-10-20') -> 'lenders') e
   where e ->> 'name' = 'Example Servicing'),
  1,
  'a servicer paying two loans is one lender'
);
select is(
  (select (e ->> 'monthly_agorot')::bigint from jsonb_array_elements(public.get_setup_suggestions('2026-10-20') -> 'lenders') e
   where e ->> 'name' = 'Example Servicing'),
  650000::bigint,
  'its monthly amount is both loans together'
);

select * from finish();
rollback;
