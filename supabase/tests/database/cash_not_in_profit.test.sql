-- FLOW-418 (decision 0173). What profit leaves out of the month's cash: cash_months'
-- not_in_profit_minor and not_in_profit_categories, and cash_month_lines' 'not_in_profit' side.
-- Invented data only. Amounts are agorot. Today is 2026-06-15.

begin;

select plan(13);

select tests.create_supabase_user('cnp_owner', 'cnp-owner@example.com');
select tests.create_supabase_user('cnp_other', 'cnp-other@example.com');

create temp table cnp (label text primary key, id uuid);
grant all on cnp to authenticated, service_role;

insert into cnp (label, id) values
  ('co', tests.fixture_company('cnp_owner', 'Example Profit LLC')),
  ('other', tests.fixture_company('cnp_other', 'Example Other LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.cnp where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into cnp (label, id) values
  ('harbor', tests.fixture_project(pg_temp.id('co'), 'Harbor')),
  ('rent_cat', tests.fixture_category(pg_temp.id('co'), 'Rent', 'income')),
  ('repairs_cat', tests.fixture_category(pg_temp.id('co'), 'Repairs', 'expense')),
  ('reno_cat', tests.fixture_category(pg_temp.id('co'), 'Renovation', 'expense', true)),
  ('capital_cat', tests.fixture_category(pg_temp.id('co'), 'Owner capital', 'income', true));

insert into cnp (label, id) values
  ('rent', tests.fixture_line(pg_temp.id('co'), 'cnp:rent', 1000000, 'income', pg_temp.id('harbor'),
    pg_temp.id('rent_cat'), '2026-06-05', p_pnl_role => null, p_doc_kind => 'invoice_receipt')),
  ('repairs', tests.fixture_line(pg_temp.id('co'), 'cnp:repairs', 300000, 'expense', pg_temp.id('harbor'),
    pg_temp.id('repairs_cat'), '2026-06-06')),
  ('reno', tests.fixture_line(pg_temp.id('co'), 'cnp:reno', 500000, 'expense', pg_temp.id('harbor'),
    pg_temp.id('reno_cat'), '2026-06-07')),
  ('capital', tests.fixture_line(pg_temp.id('co'), 'cnp:capital', 200000, 'income', null,
    pg_temp.id('capital_cat'), '2026-06-02', p_pnl_role => null, p_doc_kind => 'invoice_receipt'));

create or replace function pg_temp.june()
returns jsonb
language sql
as $$
  select r
  from jsonb_array_elements(public.cash_months(1, '2026-06-15') -> 'months') m
  cross join lateral jsonb_array_elements(m -> 'by_currency') r
  where m ->> 'month' = '2026-06-01' and r ->> 'currency' = 'ILS';
$$;
grant execute on function pg_temp.june() to authenticated, service_role;

select tests.authenticate_as('cnp_owner');

-- 1-4. The month's figures.
select is((pg_temp.june() ->> 'net_minor')::bigint, 400000::bigint, 'cash net counts every line in the view');
select is((pg_temp.june() ->> 'profit_minor')::bigint, 700000::bigint, 'profit leaves the kept-out lines out');
select is(
  (pg_temp.june() ->> 'not_in_profit_minor')::bigint,
  -300000::bigint,
  'not_in_profit_minor is net minus profit, so the two add up to the month'
);
select is(
  pg_temp.june() -> 'not_in_profit_categories',
  '[{"name": "Renovation", "amount_minor": -500000}, {"name": "Owner capital", "amount_minor": 200000}]'::jsonb,
  'not_in_profit_categories lists the kept-out cash by category, signed like net, largest first'
);

-- 5-8. The lines behind it.
select is(
  jsonb_array_length(public.cash_month_lines('2026-06-01', 'not_in_profit') -> 'rows'),
  2,
  'the not_in_profit side lists only the lines profit leaves out'
);
select is(
  (select jsonb_agg(jsonb_build_array(r ->> 'description', r ->> 'side', (r ->> 'amount_minor')::bigint) order by r ->> 'description')
   from jsonb_array_elements(public.cash_month_lines('2026-06-01', 'not_in_profit') -> 'rows') r),
  '[["cnp:capital", "in", 200000], ["cnp:reno", "out", 500000]]'::jsonb,
  'each line is positive on its side'
);
select is(
  jsonb_array_length(public.cash_month_lines('2026-06-01', 'out') -> 'rows'),
  2,
  'the out side still lists every expense in the view'
);
select is(
  (select jsonb_agg(jsonb_build_array(r ->> 'description', r ->> 'side', (r ->> 'amount_minor')::bigint) order by r ->> 'description')
   from jsonb_array_elements(public.cash_month_lines('2026-06-01', 'in_profit') -> 'rows') r),
  '[["cnp:rent", "in", 1000000], ["cnp:repairs", "out", 300000]]'::jsonb,
  'FLOW-438: the in_profit side lists money in and out that profit counts, and none it leaves out'
);
select throws_ok(
  $$ select public.cash_month_lines('2026-06-01', 'sideways') $$,
  'validation',
  'an unknown side is still refused'
);

-- 9. A line taken out of the view is in neither list.
reset role;
update public.transactions set in_cash_override = false where id = pg_temp.id('reno');
select tests.authenticate_as('cnp_owner');
select is(
  pg_temp.june() -> 'not_in_profit_categories',
  '[{"name": "Owner capital", "amount_minor": 200000}]'::jsonb,
  'a kept-out line out of the cash view leaves the categories'
);

-- 10-11. Another company sees none of it.
select tests.authenticate_as('cnp_other');
select is(
  coalesce(pg_temp.june() -> 'not_in_profit_categories', '[]'::jsonb),
  '[]'::jsonb,
  'another company''s month lists none of these categories'
);
select is(
  jsonb_array_length(public.cash_month_lines('2026-06-01', 'not_in_profit') -> 'rows'),
  0,
  'another company''s not_in_profit side lists none of these lines'
);

-- 12. The parts behind both stay private.
reset role;
select ok(
  not has_function_privilege('authenticated', 'private.cash_parts(uuid,text,date,date)', 'execute'),
  'private.cash_parts is not callable by app users'
);

select * from finish();
rollback;
