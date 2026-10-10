-- FLOW-432. A split line's parts on the cash list row: cash_month_lines and
-- project_cash_month_lines carry the parts each row counts and the whole line's amount.
-- Invented data only. Amounts are agorot.

begin;

select plan(8);

select tests.create_supabase_user('clp_owner', 'clp-owner@example.com');

create temp table clp (label text primary key, id uuid);
grant all on clp to authenticated, service_role;

insert into clp (label, id) values ('co', tests.fixture_company('clp_owner', 'Example Parts LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.clp where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into clp (label, id) values
  ('harbor', tests.fixture_project(pg_temp.id('co'), 'Harbor')),
  ('rent_cat', tests.fixture_category(pg_temp.id('co'), 'Rent', 'income')),
  ('power_cat', tests.fixture_category(pg_temp.id('co'), 'Power', 'expense')),
  ('water_cat', tests.fixture_category(pg_temp.id('co'), 'Water', 'expense'));

insert into clp (label, id) values
  ('deposit', tests.fixture_line(pg_temp.id('co'), 'clp:deposit', 200000, 'income', pg_temp.id('harbor'),
    pg_temp.id('rent_cat'), '2026-06-05', p_pnl_role => null, p_doc_kind => 'invoice_receipt')),
  ('bill', tests.fixture_line(pg_temp.id('co'), 'clp:bill', 30000, 'expense', pg_temp.id('harbor'),
    pg_temp.id('power_cat'), '2026-06-06')),
  ('pier', tests.fixture_project(pg_temp.id('co'), 'Pier')),
  ('repair', tests.fixture_line(pg_temp.id('co'), 'clp:repair', 50000, 'expense', pg_temp.id('harbor'),
    pg_temp.id('power_cat'), '2026-06-07'));

-- The deposit is rent plus two refunds: 1,700.00 + 120.00 + 180.00 = 2,000.00.
insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor) values
  (pg_temp.id('co'), pg_temp.id('deposit'), 1, pg_temp.id('rent_cat'), null, 170000),
  (pg_temp.id('co'), pg_temp.id('deposit'), 2, pg_temp.id('power_cat'), null, 12000),
  (pg_temp.id('co'), pg_temp.id('deposit'), 3, pg_temp.id('water_cat'), null, 18000),
  -- One category on two projects.
  (pg_temp.id('co'), pg_temp.id('repair'), 1, pg_temp.id('power_cat'), null, 30000),
  (pg_temp.id('co'), pg_temp.id('repair'), 2, pg_temp.id('power_cat'), pg_temp.id('pier'), 20000);

create or replace function pg_temp.row_of(p_page jsonb, p_description text)
returns jsonb
language sql
as $$ select r from jsonb_array_elements(p_page -> 'rows') r where r ->> 'description' = p_description; $$;
grant execute on function pg_temp.row_of(jsonb, text) to authenticated, service_role;

select tests.authenticate_as('clp_owner');

select is(
  pg_temp.row_of(public.cash_month_lines('2026-06-01', 'out'), 'clp:deposit') -> 'parts',
  '[{"name": "Water", "amount_minor": -18000}, {"name": "Power", "amount_minor": -12000}]'::jsonb,
  'under out, the row names the two refund parts it counts, largest first, signed like its amount'
);
select is(
  (pg_temp.row_of(public.cash_month_lines('2026-06-01', 'out'), 'clp:deposit') ->> 'amount_minor')::bigint,
  -30000::bigint,
  'the row''s amount is still the sum of those parts'
);
select is(
  (pg_temp.row_of(public.cash_month_lines('2026-06-01', 'out'), 'clp:deposit') ->> 'line_minor')::bigint,
  200000::bigint,
  'line_minor is the whole line'
);
select is(
  pg_temp.row_of(public.cash_month_lines('2026-06-01', 'in'), 'clp:deposit') -> 'parts',
  '[{"name": "Rent", "amount_minor": 170000}]'::jsonb,
  'under in, the row names the rent part'
);
select ok(
  pg_temp.row_of(public.cash_month_lines('2026-06-01', 'out'), 'clp:bill') -> 'parts' = 'null'::jsonb
    and pg_temp.row_of(public.cash_month_lines('2026-06-01', 'out'), 'clp:bill') -> 'line_minor' = 'null'::jsonb,
  'a line with no split carries neither'
);
select is(
  pg_temp.row_of(public.project_cash_month_lines(pg_temp.id('harbor'), '2026-06-01', 'out'), 'clp:deposit') -> 'parts',
  '[{"name": "Water", "amount_minor": -18000}, {"name": "Power", "amount_minor": -12000}]'::jsonb,
  'the project''s lines carry the parts too'
);

select is(
  pg_temp.row_of(public.cash_month_lines('2026-06-01', 'out'), 'clp:repair') -> 'parts',
  '[{"name": "Power", "amount_minor": 50000}]'::jsonb,
  'parts of one category on two projects are one entry'
);

-- A split that no longer sums to the line counts whole, so the row names no parts.
reset role;
update public.line_splits set amount_minor = 17000 where transaction_id = pg_temp.id('deposit') and ordinal = 1;
select tests.authenticate_as('clp_owner');
select is(
  pg_temp.row_of(public.cash_month_lines('2026-06-01', 'in'), 'clp:deposit') -> 'parts',
  'null'::jsonb,
  'an invalid split shows no parts'
);

select * from finish();
rollback;
