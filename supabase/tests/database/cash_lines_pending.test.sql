-- FLOW-366. Each cash line row on cash_month_lines and project_cash_month_lines carries pending
-- (the row's transaction has an open review) and in_pnl (the row's part counts in profit).
-- Invented data only. Amounts are agorot.

begin;

select plan(7);

select tests.create_supabase_user('clp2_owner', 'clp2-owner@example.com');

create temp table clp2 (label text primary key, id uuid);
grant all on clp2 to authenticated, service_role;

insert into clp2 (label, id) values ('co', tests.fixture_company('clp2_owner', 'Example Pending LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.clp2 where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into clp2 (label, id) values
  ('harbor', tests.fixture_project(pg_temp.id('co'), 'Harbor')),
  ('supplies_cat', tests.fixture_category(pg_temp.id('co'), 'Supplies', 'expense')),
  ('reno_cat', tests.fixture_category(pg_temp.id('co'), 'Renovation', 'expense', true));

insert into clp2 (label, id) values
  ('open', tests.fixture_line(pg_temp.id('co'), 'clp2:open', 100000, 'expense', pg_temp.id('harbor'),
    pg_temp.id('supplies_cat'), '2026-06-03', p_doc_kind => 'expense')),
  ('done', tests.fixture_line(pg_temp.id('co'), 'clp2:done', 200000, 'expense', pg_temp.id('harbor'),
    pg_temp.id('supplies_cat'), '2026-06-04', p_doc_kind => 'expense')),
  ('reno', tests.fixture_line(pg_temp.id('co'), 'clp2:reno', 300000, 'expense', pg_temp.id('harbor'),
    pg_temp.id('reno_cat'), '2026-06-05', p_doc_kind => 'expense'));

-- One open review and one approved review, written as postgres like the other fixtures.
insert into public.review_queue (company_id, transaction_id, status)
values
  (pg_temp.id('co'), pg_temp.id('open'), 'open'),
  (pg_temp.id('co'), pg_temp.id('done'), 'approved');

create or replace function pg_temp.row(p_page jsonb, p_description text)
returns jsonb
language sql
as $$ select r from jsonb_array_elements(p_page -> 'rows') r where r ->> 'description' = p_description; $$;
grant execute on function pg_temp.row(jsonb, text) to authenticated, service_role;

select tests.authenticate_as('clp2_owner');

select is(
  (pg_temp.row(public.cash_month_lines('2026-06-01', 'out'), 'clp2:open') ->> 'pending')::boolean,
  true,
  'a row with an open review is pending'
);
select is(
  (pg_temp.row(public.cash_month_lines('2026-06-01', 'out'), 'clp2:done') ->> 'pending')::boolean,
  false,
  'a row with an approved review is not pending'
);
select is(
  (pg_temp.row(public.cash_month_lines('2026-06-01', 'out'), 'clp2:reno') ->> 'pending')::boolean,
  false,
  'a row with no review is not pending'
);
select is(
  (pg_temp.row(public.cash_month_lines('2026-06-01', 'out'), 'clp2:open') ->> 'in_pnl')::boolean,
  true,
  'a row in a P&L category counts in profit'
);
select is(
  (pg_temp.row(public.cash_month_lines('2026-06-01', 'out'), 'clp2:reno') ->> 'in_pnl')::boolean,
  false,
  'a row in a category kept out of profit does not count in profit'
);
select is(
  (pg_temp.row(public.project_cash_month_lines(pg_temp.id('harbor'), '2026-06-01', 'out'), 'clp2:open') ->> 'pending')::boolean,
  true,
  'the project lines carry pending too'
);
select is(
  (pg_temp.row(public.project_cash_month_lines(pg_temp.id('harbor'), '2026-06-01', 'out'), 'clp2:reno') ->> 'in_pnl')::boolean,
  false,
  'the project lines carry in_pnl too'
);

select * from finish();
rollback;
