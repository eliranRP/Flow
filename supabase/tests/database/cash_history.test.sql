-- FLOW-417 (decision 0174). The cash view's whole history: cash_years (the net since the first
-- cash month and per year) and cash_year_months (one year's months in cash_months' shape).
-- Invented data only. Amounts are agorot (cents for USD). Today is 2026-06-15.

begin;

select plan(18);

do $users$
begin
  perform tests.create_supabase_user('chy_owner', 'chy-owner@example.com');
  perform tests.create_supabase_user('chy_other', 'chy-other@example.com');
end
$users$;

create temp table chy (label text primary key, id uuid);
grant all on chy to authenticated, service_role;

insert into chy (label, id) values ('co', tests.fixture_company('chy_owner', 'Example History LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.chy where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

create or replace function pg_temp.cat(p_name text, p_kind text)
returns uuid
language sql
as $$
  select c.id from public.categories c
  where c.company_id = pg_temp.id('co') and c.name = p_name and c.kind = p_kind::public.category_kind;
$$;
grant execute on function pg_temp.cat(text, text) to authenticated, service_role;

-- One year's row for one currency, from cash_years(2026-06-15).
create or replace function pg_temp.year_row(p_year integer, p_currency text)
returns jsonb
language sql
as $$
  select r
  from jsonb_array_elements(public.cash_years('2026-06-15') -> 'years') y
  cross join lateral jsonb_array_elements(y -> 'by_currency') r
  where (y ->> 'year')::integer = p_year and r ->> 'currency' = p_currency;
$$;
grant execute on function pg_temp.year_row(integer, text) to authenticated, service_role;

-- March 2023 is the first cash month; 2024 has nothing; 2025 has rent, a cost and a transfer
-- (out of the view); 2026 has rent, a USD cost, and a cost dated after this month.
insert into chy (label, id) values
  ('first', tests.fixture_line(pg_temp.id('co'), 'chy:first', 100000, 'expense', null,
    pg_temp.cat('אחר', 'expense'), '2023-03-10', p_pnl_role => null)),
  ('rent25', tests.fixture_line(pg_temp.id('co'), 'chy:rent25', 500000, 'income', null,
    pg_temp.cat('הכנסה מלקוחות', 'income'), '2025-02-05', p_pnl_role => null, p_doc_kind => 'invoice_receipt')),
  ('cost25', tests.fixture_line(pg_temp.id('co'), 'chy:cost25', 200000, 'expense', null,
    pg_temp.cat('אחר', 'expense'), '2025-11-20', p_pnl_role => null)),
  ('xfer25', tests.fixture_line(pg_temp.id('co'), 'chy:xfer25', 900000, 'expense', null,
    pg_temp.cat('העברות', 'expense'), '2025-07-01', p_pnl_role => null)),
  ('rent26', tests.fixture_line(pg_temp.id('co'), 'chy:rent26', 300000, 'income', null,
    pg_temp.cat('הכנסה מלקוחות', 'income'), '2026-05-05', p_pnl_role => null, p_doc_kind => 'invoice_receipt')),
  ('usd26', tests.fixture_line(pg_temp.id('co'), 'chy:usd26', 5000, 'expense', null,
    pg_temp.cat('אחר', 'expense'), '2026-01-15', p_pnl_role => null, p_currency => 'USD', p_source => 'mercury')),
  ('later', tests.fixture_line(pg_temp.id('co'), 'chy:later', 70000, 'expense', null,
    pg_temp.cat('אחר', 'expense'), '2026-08-01', p_pnl_role => null));

select tests.authenticate_as('chy_owner');

-- 1-4. The years, newest first, from the first cash month's year; an empty year is listed.
select is(
  (select jsonb_agg((y ->> 'year')::integer) from jsonb_array_elements(public.cash_years('2026-06-15') -> 'years') y),
  '[2026, 2025, 2024, 2023]'::jsonb,
  'every year from the first cash month to this one, newest first'
);
select is(public.cash_years('2026-06-15') ->> 'first_month', '2023-03-01', 'the first cash month');
select is(public.cash_years('2026-06-15') ->> 'this_month', '2026-06-01', 'this month');
select is(
  pg_temp.year_row(2024, 'ILS'),
  '{"currency": "ILS", "in_minor": 0, "out_minor": 0, "net_minor": 0}'::jsonb,
  'a year with nothing in it shows zeros in the base currency'
);

-- 5-7. A year's figures: the transfer is out of the view; a line after this month is not counted.
select is(
  pg_temp.year_row(2025, 'ILS'),
  '{"currency": "ILS", "in_minor": 500000, "out_minor": 200000, "net_minor": 300000}'::jsonb,
  '2025: rent in, the cost out, the transfer left out'
);
select is((pg_temp.year_row(2026, 'ILS') ->> 'out_minor')::bigint, 0::bigint, 'a cost dated after this month is not counted');
select is((pg_temp.year_row(2026, 'USD') ->> 'out_minor')::bigint, 5000::bigint, 'another currency has its own row');

-- 8-9. The total since the first month, the base currency first.
select is(
  public.cash_years('2026-06-15') -> 'by_currency' -> 0,
  '{"currency": "ILS", "in_minor": 800000, "out_minor": 300000, "net_minor": 500000}'::jsonb,
  'the total is every year''s money, base currency first'
);
select is(
  public.cash_years('2026-06-15') -> 'by_currency' -> 1 ->> 'currency',
  'USD',
  'then the other currencies'
);

-- 10-13. One year's months.
select is(
  jsonb_array_length(public.cash_year_months(2025, '2026-06-15') -> 'months'),
  12,
  'a past year has its 12 months'
);
select is(
  public.cash_year_months(2025, '2026-06-15') -> 'months' -> 0 ->> 'month',
  '2025-12-01',
  'newest first'
);
select is(
  (select jsonb_agg(m ->> 'month') from jsonb_array_elements(public.cash_year_months(2026, '2026-06-15') -> 'months') m),
  '["2026-06-01", "2026-05-01", "2026-04-01", "2026-03-01", "2026-02-01", "2026-01-01"]'::jsonb,
  'this year runs to this month'
);
select is(
  (select sum((r ->> 'net_minor')::bigint)
   from jsonb_array_elements(public.cash_year_months(2025, '2026-06-15') -> 'months') m
   cross join lateral jsonb_array_elements(m -> 'by_currency') r
   where r ->> 'currency' = 'ILS'),
  (pg_temp.year_row(2025, 'ILS') ->> 'net_minor')::numeric,
  'a year''s months add up to its row'
);

-- 14-15. A year after this one, or a missing one, is refused.
select throws_ok($$select public.cash_year_months(2027, '2026-06-15')$$, 'validation', 'a future year is refused');
select throws_ok($$select public.cash_year_months(null, '2026-06-15')$$, 'validation', 'a year is required');

-- 16-17. Another company sees none of it.
select tests.authenticate_as('chy_other');
select lives_ok($$select public.create_company('Other History LLC', false)$$, 'another company');
select is(
  public.cash_years('2026-06-15') - 'basis',
  '{"base_currency": "ILS", "this_month": "2026-06-01", "first_month": null, "by_currency": [{"currency": "ILS", "in_minor": 0, "out_minor": 0, "net_minor": 0}], "years": [{"year": 2026, "by_currency": [{"currency": "ILS", "in_minor": 0, "out_minor": 0, "net_minor": 0}]}]}'::jsonb,
  'a company with no lines has this year only, at zero'
);

-- 18. Signed out, nothing.
select tests.clear_authentication();
select is(
  (select count(*)::integer from (values
    (has_function_privilege('anon', 'public.cash_years(date)', 'execute')),
    (has_function_privilege('anon', 'public.cash_year_months(integer, date)', 'execute'))
  ) v(allowed) where allowed),
  0,
  'anon cannot call the history reads'
);

select * from finish();
rollback;
