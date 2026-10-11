-- FLOW-441. project_recurring_changes measures a recurring party's share on one project: a line
-- counts for its amount when it is the project's, or for its parts on the project when split.
-- Invented data only. Amounts are cents. "Today" is 2026-10-20.

begin;

select plan(9);

do $users$
begin
  perform tests.create_supabase_user('prc_owner', 'prc-owner@example.com');
  perform tests.create_supabase_user('prc_other', 'prc-other@example.com');
end
$users$;

create temp table prc (label text primary key, id uuid);
grant all on prc to authenticated, service_role;

insert into prc (label, id) values ('co', tests.fixture_company('prc_owner', 'Example Rentals LLC'));
insert into prc (label, id) values ('other_co', tests.fixture_company('prc_other', 'Example Other LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.prc where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into prc (label, id) values
  ('pine', tests.fixture_project(pg_temp.id('co'), 'Pine Street')),
  ('oak', tests.fixture_project(pg_temp.id('co'), 'Oak Avenue')),
  ('elsewhere', tests.fixture_project(pg_temp.id('other_co'), 'Elsewhere')),
  ('rent_cat', tests.fixture_category(pg_temp.id('co'), 'Rent', 'income')),
  ('water_cat', tests.fixture_category(pg_temp.id('co'), 'Water', 'expense'));

insert into public.customers (company_id, name) values (pg_temp.id('co'), 'Example Rent Platform');
insert into public.suppliers (company_id, name) values (pg_temp.id('co'), 'Example Water');
insert into prc (label, id)
select 'platform', c.id from public.customers c where c.company_id = pg_temp.id('co');
insert into prc (label, id)
select 'water', s.id from public.suppliers s where s.company_id = pg_temp.id('co');

-- The platform pays one rent a month, headed by Oak, split Pine $1,000 and Oak $2,000. In
-- October it pays $3,900: Pine $2,000 (twice its usual) and Oak $1,900 (5% less). Pine's water
-- bill, not split, is the same every month.
create temp table prc_lines (label text, party text, project text, doc_date date, amount bigint, pine bigint);
insert into prc_lines
select 'rent_' || to_char(d, 'MM'), 'platform', 'oak', d::date + 4, 300000, 100000
from generate_series('2026-04-01'::date, '2026-09-01'::date, interval '1 month') d;
insert into prc_lines values ('rent_10', 'platform', 'oak', '2026-10-05', 390000, 200000);
insert into prc_lines
select 'water_' || to_char(d, 'MM'), 'water', 'pine', d::date + 2, 8000, null
from generate_series('2026-04-01'::date, '2026-10-01'::date, interval '1 month') d;

insert into prc (label, id)
select l.label, tests.fixture_line(
  pg_temp.id('co'), 'prc:' || l.label, l.amount,
  case when l.party = 'platform' then 'income' else 'expense' end,
  pg_temp.id(l.project),
  case when l.party = 'platform' then pg_temp.id('rent_cat') else pg_temp.id('water_cat') end,
  l.doc_date, p_currency => 'USD',
  p_doc_kind => case when l.party = 'platform' then 'invoice' else 'receipt' end
)
from prc_lines l;
update public.transactions t
set customer_id = case when l.party = 'platform' then pg_temp.id('platform') end,
  supplier_id = case when l.party = 'water' then pg_temp.id('water') end
from prc_lines l
where t.id = pg_temp.id(l.label);

insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor)
select pg_temp.id('co'), pg_temp.id(l.label), o.ordinal, pg_temp.id('rent_cat'), pg_temp.id(o.project), o.amount
from prc_lines l
cross join lateral (values (1, 'pine', l.pine), (2, 'oak', l.amount - l.pine)) o(ordinal, project, amount)
where l.party = 'platform';

select tests.authenticate_as('prc_owner');

-- 1. Home still measures the platform company-wide: $3,900 against $3,000.
select is(
  (select (e ->> 'change_percent')::integer from jsonb_array_elements(public.recurring_changes('2026-10-20')) e
   where (e ->> 'party_id')::uuid = pg_temp.id('platform')),
  30,
  'Home keeps the company-wide change'
);

-- 2-6. Pine's own row: its $2,000 part against its usual $1,000, opening October's rent.
create or replace function pg_temp.pine_row()
returns jsonb
language sql
as $$
  select e from jsonb_array_elements(public.project_recurring_changes(pg_temp.id('pine'), '2026-10-20')) e
  where (e ->> 'party_id')::uuid = pg_temp.id('platform');
$$;
grant execute on function pg_temp.pine_row() to authenticated, service_role;

select is((pg_temp.pine_row() ->> 'amount_minor')::bigint, 200000::bigint, 'Pine counts its part of the split rent');
select is((pg_temp.pine_row() ->> 'typical_amount_minor')::bigint, 100000::bigint, 'Pine''s usual is its usual part');
select is((pg_temp.pine_row() ->> 'change_percent')::integer, 100, 'Pine''s change is its own');
select is((pg_temp.pine_row() ->> 'transaction_id')::uuid, pg_temp.id('rent_10'), 'the row opens October''s rent');
select is((pg_temp.pine_row() ->> 'project_id')::uuid, pg_temp.id('pine'), 'the row names Pine');

-- 7. Oak's part changed 5%, under the 20% line, and the water bill did not change: no rows.
select is(
  public.project_recurring_changes(pg_temp.id('oak'), '2026-10-20'),
  '[]'::jsonb,
  'Oak shows no change: its part moved 5%'
);

-- 8. Another company's project reads as nothing.
select is(
  public.project_recurring_changes(pg_temp.id('elsewhere'), '2026-10-20'),
  null::jsonb,
  'another company''s project is null'
);

-- 9. A dismissal on Home (the line's id) hides the project's row too.
select public.dismiss_recurring_alert('change', pg_temp.id('rent_10')::text);
select is(pg_temp.pine_row(), null::jsonb, 'a dismissed change is hidden on the project');

select * from finish();
rollback;
