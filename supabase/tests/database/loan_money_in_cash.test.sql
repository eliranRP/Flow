-- FLOW-416 (decision 0171, amends 0168): loan money counts in the cash view by default. A new
-- company's seeded loan money category is in cash and still out of the P&L, a category created
-- with a loan money name starts in cash, and transfers and card bill payments still start out.
-- Invented data only. Amounts are agorot. Today is 2026-06-15.

begin;

select plan(9);

do $users$
begin
  perform tests.create_supabase_user('lmc_owner', 'lmc-owner@example.com');
end
$users$;

create temp table lmc (label text primary key, id uuid);
grant all on lmc to authenticated, service_role;

insert into lmc (label, id) values ('co', tests.fixture_company('lmc_owner', 'Example Loan Cash LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.lmc where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

create or replace function pg_temp.seeded()
returns uuid
language sql
as $$
  select c.id from public.categories c
  where c.company_id = pg_temp.id('co') and c.name = 'כסף שהתקבל מהלוואות' and c.kind = 'income';
$$;
grant execute on function pg_temp.seeded() to authenticated, service_role;

-- 1-2. The seed.
select ok(
  (select in_cash and excluded_from_pnl and is_default from public.categories where id = pg_temp.seeded()),
  'a new company''s loan money category counts in cash and stays out of the P&L'
);
select is(
  (select count(*)::integer from public.categories
   where company_id = pg_temp.id('co') and kind = 'income' and name = 'כסף שהתקבל מהלוואות'),
  1,
  'the seed adds it once'
);

-- 3-6. Defaults for a category created later.
insert into lmc (label, id) values
  ('proceeds', tests.fixture_category(pg_temp.id('co'), 'Loan proceeds', 'income', true)),
  ('xfer_in', tests.fixture_category(pg_temp.id('co'), 'Internal transfers in', 'income', true)),
  ('card', tests.fixture_category(pg_temp.id('co'), 'Credit card payments', 'expense', true));

select ok(
  (select in_cash from public.categories where id = pg_temp.id('proceeds')),
  'a new loan proceeds category starts in cash'
);
select ok(
  (select not in_cash from public.categories where id = pg_temp.id('xfer_in')),
  'a new internal transfers category still starts out of cash'
);
select ok(
  (select not in_cash from public.categories where id = pg_temp.id('card')),
  'a new credit card payments category still starts out of cash'
);
select ok(
  not private.non_cash_category('income', 'כסף שהתקבל מהלוואות')
    and not private.non_cash_category('income', 'Loan proceeds')
    and private.non_cash_category('income', 'העברות'),
  'the out-of-cash names no longer include loan money'
);

-- 7. A loan money category already out of cash keeps its setting, as an existing company's does.
insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl, in_cash)
values (pg_temp.id('co'), 'הלוואות שהתקבלו', 'income', 90, false, true, false);
select ok(
  (select not in_cash from public.categories where company_id = pg_temp.id('co') and name = 'הלוואות שהתקבלו'),
  'a category created out of cash stays out'
);

-- 8-9. The cash view counts the money received from a loan.
insert into lmc (label, id) values
  ('xfer_line', tests.fixture_line(pg_temp.id('co'), 'lmc:xfer', 1200000, 'income', null,
    pg_temp.id('xfer_in'), '2026-06-05', p_pnl_role => null, p_doc_kind => 'invoice_receipt')),
  ('loan_money', tests.fixture_line(pg_temp.id('co'), 'lmc:loan-money', 5000000, 'income', null,
    pg_temp.seeded(), '2026-06-03', p_pnl_role => null, p_doc_kind => 'invoice_receipt'));

select tests.authenticate_as('lmc_owner');

select is(
  (select (r ->> 'in_minor')::bigint
   from jsonb_array_elements(public.cash_months(1, '2026-06-15') -> 'months') m
   cross join lateral jsonb_array_elements(m -> 'by_currency') r
   where m ->> 'month' = '2026-06-01' and r ->> 'currency' = 'ILS'),
  5000000::bigint,
  'נכנס counts the loan money; the transfer in is left out'
);
select is(
  (select (r ->> 'excluded_in_minor')::bigint
   from jsonb_array_elements(public.cash_months(1, '2026-06-15') -> 'months') m
   cross join lateral jsonb_array_elements(m -> 'by_currency') r
   where m ->> 'month' = '2026-06-01' and r ->> 'currency' = 'ILS'),
  1200000::bigint,
  'only the transfer is left out'
);

select * from finish();
rollback;
