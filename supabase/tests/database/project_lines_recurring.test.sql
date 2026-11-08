-- FLOW-1110. Each row of project_cash_month_lines says whether it belongs to a recurring charge, as
-- cash_month_lines' rows do (FLOW-1035): one that recurring_schedule lists for that month, matched as the
-- schedule matches its own lines (the party or the party it was answered the same as, direction, currency
-- and project; decision 0185). Without it a project page never listed its one-off lines.
-- Invented data only. Amounts are cents. The month read is October 2026, Alder's lines.

begin;

select plan(5);

do $users$
begin
  perform tests.create_supabase_user('plr_owner', 'plr-owner@example.com');
end
$users$;

create temp table plr (label text primary key, id uuid);
grant all on plr to authenticated, service_role;

insert into plr (label, id) values ('co', tests.fixture_company('plr_owner', 'Example Project Lines LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.plr where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into plr (label, id) values
  ('alder', tests.fixture_project(pg_temp.id('co'), 'Alder Ct')),
  ('birch', tests.fixture_project(pg_temp.id('co'), 'Birch Way'));

insert into public.suppliers (company_id, name)
select pg_temp.id('co'), n from unnest(array['Example Rent', 'Example Power', 'Example Power Co', 'Example Plumber']) n;
insert into plr (label, id)
select case s.name
    when 'Example Rent' then 'rent' when 'Example Power' then 'power'
    when 'Example Power Co' then 'alias' else 'plumber' end,
  s.id
from public.suppliers s where s.company_id = pg_temp.id('co');

-- Rent: $3,000 to Alder on the 1st, April to October, and one $800 bill to Birch in October.
-- Power: $250 to Alder on the 5th, April to September; October's bill came under another name the
-- owner answered is the same party. The plumber: one $1,200 bill in October.
create temp table plr_lines (key text, party text, project text, doc_date date, amount bigint);
insert into plr_lines
select 'rent:' || d::date, 'rent', 'alder', d::date, 300000
from generate_series('2026-04-01'::date, '2026-10-01', interval '1 month') d;
insert into plr_lines values ('rent-birch', 'rent', 'birch', '2026-10-14', 80000);
insert into plr_lines
select 'power:' || d::date, 'power', 'alder', d::date + 4, 25000
from generate_series('2026-04-01'::date, '2026-09-01', interval '1 month') d;
insert into plr_lines values
  ('power-alias', 'alias', 'alder', '2026-10-05', 25500),
  ('plumber-bill', 'plumber', 'alder', '2026-10-12', 120000);

insert into plr (label, id)
select l.key, tests.fixture_line(
  pg_temp.id('co'), 'plr:' || l.key, l.amount, 'expense', pg_temp.id(l.project), null, l.doc_date,
  p_currency => 'ILS', p_pnl_role => null
)
from plr_lines l;
update public.transactions t set supplier_id = pg_temp.id(l.party)
from plr_lines l
where t.id = pg_temp.id(l.key);

insert into public.recurring_matches (company_id, direction, party_id, match_party_id, same)
values (pg_temp.id('co'), 'expense', pg_temp.id('power'), pg_temp.id('alias'), true);

create or replace function pg_temp.rows_of(p_project text, p_side text)
returns setof jsonb
language sql
as $$
  select e from jsonb_array_elements(public.project_cash_month_lines(pg_temp.id(p_project), '2026-10-01', p_side, 'ILS', 100, 0) -> 'rows') e;
$$;
grant execute on function pg_temp.rows_of(text, text) to authenticated, service_role;

create or replace function pg_temp.row_of(p_project text, p_key text)
returns jsonb
language sql
as $$
  select e from pg_temp.rows_of(p_project, 'out') e where (e ->> 'transaction_id')::uuid = pg_temp.id(p_key);
$$;
grant execute on function pg_temp.row_of(text, text) to authenticated, service_role;

select tests.authenticate_as('plr_owner');

-- 1. A recurring charge's line on its project.
select is((pg_temp.row_of('alder', 'rent:2026-10-01') ->> 'recurring')::boolean, true, 'a recurring charge''s line reads recurring on its project');

-- 2. A one-off supplier's line: the project page lists it under the one-off group.
select is((pg_temp.row_of('alder', 'plumber-bill') ->> 'recurring')::boolean, false, 'a one-off supplier''s line is not recurring');

-- 3. A line of a party answered the same as a recurring one.
select is((pg_temp.row_of('alder', 'power-alias') ->> 'recurring')::boolean, true, 'a merged party''s line reads recurring');

-- 4. The recurring party's line on another project is not that charge (decision 0185).
select is((pg_temp.row_of('birch', 'rent-birch') ->> 'recurring')::boolean, false, 'a recurring party''s line on another project is not recurring');

-- 5. Every row says it, on the sides the project page reads too.
select is(
  (select count(*)::integer from (
     select e from pg_temp.rows_of('alder', 'out') e
     union all select e from pg_temp.rows_of('alder', 'in_profit') e
     union all select e from pg_temp.rows_of('alder', 'not_in_profit') e
   ) x(e)
   where jsonb_typeof(e -> 'recurring') is distinct from 'boolean'),
  0,
  'every row carries recurring as a boolean'
);

select * from finish();
rollback;
