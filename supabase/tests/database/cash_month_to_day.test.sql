-- FLOW-364: cash_month_to_day, one month's cash up to a day of it (Home's same-day comparison).
-- Invented data only. Amounts are agorot. June 2026 has 30 days.

begin;

select plan(15);

select tests.create_supabase_user('cmtd_owner', 'cmtd-owner@example.com');
select tests.create_supabase_user('cmtd_other', 'cmtd-other@example.com');

create temp table cmtd (label text primary key, id uuid);
grant all on cmtd to authenticated, service_role;

insert into cmtd (label, id) values
  ('co', tests.fixture_company('cmtd_owner', 'Example Same Day LLC')),
  ('other', tests.fixture_company('cmtd_other', 'Example Same Day Other LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.cmtd where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into cmtd (label, id) values
  ('rent_cat', tests.fixture_category(pg_temp.id('co'), 'Rent', 'income')),
  ('repairs_cat', tests.fixture_category(pg_temp.id('co'), 'Repairs', 'expense'));

-- Owner's lines in June: money in on the 3rd and the 30th (ILS), money out on the 11th and the 20th (ILS),
-- and money in on the 5th in USD.
insert into cmtd (label, id) values
  ('in_3', tests.fixture_line(pg_temp.id('co'), 'cmtd:in3', 100000, 'income', null,
    pg_temp.id('rent_cat'), '2026-06-03', p_pnl_role => null, p_doc_kind => 'invoice_receipt')),
  ('out_11', tests.fixture_line(pg_temp.id('co'), 'cmtd:out11', 40000, 'expense', null,
    pg_temp.id('repairs_cat'), '2026-06-11')),
  ('out_20', tests.fixture_line(pg_temp.id('co'), 'cmtd:out20', 70000, 'expense', null,
    pg_temp.id('repairs_cat'), '2026-06-20')),
  ('in_30', tests.fixture_line(pg_temp.id('co'), 'cmtd:in30', 50000, 'income', null,
    pg_temp.id('rent_cat'), '2026-06-30', p_pnl_role => null, p_doc_kind => 'invoice_receipt')),
  ('usd_5', tests.fixture_line(pg_temp.id('co'), 'cmtd:usd5', 9000, 'income', null,
    pg_temp.id('rent_cat'), '2026-06-05', p_currency => 'USD', p_pnl_role => null, p_doc_kind => 'invoice_receipt')),
  ('other_3', tests.fixture_line(pg_temp.id('other'), 'cmtd:other3', 999900, 'income', null, null, '2026-06-03',
    p_pnl_role => null, p_doc_kind => 'invoice_receipt'));

create or replace function pg_temp.to_day(p_day integer)
returns table (currency text, in_minor bigint, out_minor bigint)
language sql
stable
as $$ select * from public.cash_month_to_day('2026-06-01', p_day) $$;
grant execute on function pg_temp.to_day(integer) to authenticated, service_role;

create or replace function pg_temp.ils(p_day integer, p_column text)
returns bigint
language sql
stable
as $$
  select case p_column when 'in' then in_minor else out_minor end
  from pg_temp.to_day(p_day) where currency = 'ILS';
$$;
grant execute on function pg_temp.ils(integer, text) to authenticated, service_role;

select tests.authenticate_as('cmtd_owner');

-- 1-4. Day 11 counts the 3rd and the 11th only, per currency.
select is(pg_temp.ils(11, 'in'), 100000::bigint, 'money in up to the 11th counts the 3rd, not the 30th');
select is(pg_temp.ils(11, 'out'), 40000::bigint, 'money out up to the 11th counts the 11th, not the 20th');
select is(
  (select in_minor from pg_temp.to_day(11) where currency = 'USD'),
  9000::bigint,
  'each currency comes back on its own row'
);
select is((select count(*)::integer from pg_temp.to_day(11)), 2, 'day 11 has one row per currency that moved');

-- 5-6. Days before the first line and the day just before the 20th.
select is((select count(*)::integer from pg_temp.to_day(2)), 0, 'a day before every line has no rows');
select is(pg_temp.ils(19, 'out'), 40000::bigint, 'the 20th is not counted on the 19th');

-- 7-8. Day 31 in a 30-day month clamps to the 30th.
select is(pg_temp.ils(31, 'in'), 150000::bigint, 'day 31 in June is the 30th: both money-in lines count');
select is(pg_temp.ils(31, 'out'), 110000::bigint, 'day 31 in June counts both money-out lines');

-- 9-11. The day is 1 to 31, and not null.
select throws_ok(
  $$ select public.cash_month_to_day('2026-06-01', 0) $$,
  'validation',
  'a day below 1 is refused'
);
select throws_ok(
  $$ select public.cash_month_to_day('2026-06-01', 32) $$,
  'validation',
  'a day above 31 is refused'
);
select throws_ok(
  $$ select public.cash_month_to_day('2026-06-01', null) $$,
  'validation',
  'a null day is refused'
);

-- 12. A date anywhere in the month reads the same month.
select is(
  (select in_minor from public.cash_month_to_day('2026-06-17', 11) where currency = 'ILS'),
  100000::bigint,
  'any date in the month reads that month'
);

-- 13-14. Another company's lines never show.
select is(pg_temp.ils(31, 'in'), 150000::bigint, 'the owner does not see the other company\'s money in');

reset role;
select tests.authenticate_as('cmtd_other');
select is(pg_temp.ils(31, 'in'), 999900::bigint, 'the other company sees only its own money in');

-- 15. App users can call it; anonymous ones cannot.
select ok(
  has_function_privilege('authenticated', 'public.cash_month_to_day(date,integer)', 'execute')
    and not has_function_privilege('anon', 'public.cash_month_to_day(date,integer)', 'execute'),
  'the read is granted to app users, not to anon'
);

select * from finish();
rollback;
