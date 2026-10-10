-- The project page's "לכל החודשים": project_cash_years and project_cash_year_months, FLOW-417's
-- history for one project on FLOW-419's rules. Invented data only. Amounts are agorot. Today is
-- 2026-06-15.

begin;

select plan(14);

do $users$
begin
  perform tests.create_supabase_user('pch_owner', 'pch-owner@example.com');
  perform tests.create_supabase_user('pch_other', 'pch-other@example.com');
end
$users$;

create temp table pch (label text primary key, id uuid);
grant all on pch to authenticated, service_role;

insert into pch (label, id) values
  ('co', tests.fixture_company('pch_owner', 'Example Project History LLC')),
  ('other_co', tests.fixture_company('pch_other', 'Example Elsewhere LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.pch where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

create or replace function pg_temp.cat(p_name text, p_kind text)
returns uuid
language sql
as $$
  select c.id from public.categories c
  where c.company_id = pg_temp.id('co') and c.name = p_name and c.kind = p_kind::public.category_kind;
$$;
grant execute on function pg_temp.cat(text, text) to authenticated, service_role;

insert into pch (label, id) values
  ('cedar', tests.fixture_project(pg_temp.id('co'), 'Cedar')),
  ('maple', tests.fixture_project(pg_temp.id('co'), 'Maple')),
  ('elsewhere', tests.fixture_project(pg_temp.id('other_co'), 'Elsewhere'));

-- Cedar: a cost in April 2024 (its first month), rent in 2025, a transfer (out of the view), a
-- shared bill in 2026 (60% Cedar) and a cost after this month. Maple: one cost in 2023.
insert into pch (label, id) values
  ('first', tests.fixture_line(pg_temp.id('co'), 'pch:first', 100000, 'expense', pg_temp.id('cedar'),
    pg_temp.cat('אחר', 'expense'), '2024-04-10')),
  ('rent25', tests.fixture_line(pg_temp.id('co'), 'pch:rent25', 500000, 'income', pg_temp.id('cedar'),
    pg_temp.cat('תקבול מלקוח', 'income'), '2025-02-05', p_pnl_role => null, p_doc_kind => 'invoice_receipt')),
  ('xfer25', tests.fixture_line(pg_temp.id('co'), 'pch:xfer25', 900000, 'expense', pg_temp.id('cedar'),
    pg_temp.cat('העברות', 'expense'), '2025-07-01')),
  ('shared', tests.fixture_line(pg_temp.id('co'), 'pch:shared', 100000, 'expense', null,
    pg_temp.cat('אחר', 'expense'), '2026-03-12', p_pnl_role => 'shared')),
  ('later', tests.fixture_line(pg_temp.id('co'), 'pch:later', 70000, 'expense', pg_temp.id('cedar'),
    pg_temp.cat('אחר', 'expense'), '2026-08-01')),
  ('maple_cost', tests.fixture_line(pg_temp.id('co'), 'pch:maple', 40000, 'expense', pg_temp.id('maple'),
    pg_temp.cat('אחר', 'expense'), '2023-05-01'));

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net) values
  (pg_temp.id('co'), pg_temp.id('shared'), pg_temp.id('cedar'), 6000, -60000),
  (pg_temp.id('co'), pg_temp.id('shared'), pg_temp.id('maple'), 4000, -40000);

create or replace function pg_temp.year_row(p_year integer)
returns jsonb
language sql
as $$
  select r
  from jsonb_array_elements(public.project_cash_years(pg_temp.id('cedar'), '2026-06-15') -> 'years') y
  cross join lateral jsonb_array_elements(y -> 'by_currency') r
  where (y ->> 'year')::integer = p_year and r ->> 'currency' = 'ILS';
$$;
grant execute on function pg_temp.year_row(integer) to authenticated, service_role;

select tests.authenticate_as('pch_owner');

-- 1-2. Cedar's years start at its own first month, not the company's (Maple's 2023).
select is(
  (select jsonb_agg((y ->> 'year')::integer) from jsonb_array_elements(public.project_cash_years(pg_temp.id('cedar'), '2026-06-15') -> 'years') y),
  '[2026, 2025, 2024]'::jsonb,
  'every year from the project''s first cash month to this one, newest first'
);
select is(public.project_cash_years(pg_temp.id('cedar'), '2026-06-15') ->> 'first_month', '2024-04-01', 'the project''s first cash month');

-- 3-5. A year's figures: the transfer is out of the view, a shared bill counts the project's share,
-- and a line after this month is not counted.
select is(
  pg_temp.year_row(2025),
  '{"currency": "ILS", "in_minor": 500000, "out_minor": 0, "net_minor": 500000}'::jsonb,
  '2025: rent in, the transfer left out'
);
select is((pg_temp.year_row(2026) ->> 'out_minor')::bigint, 60000::bigint, 'a shared bill counts the project''s 60%, a later cost none');
select is(
  public.project_cash_years(pg_temp.id('cedar'), '2026-06-15') -> 'by_currency' -> 0,
  '{"currency": "ILS", "in_minor": 500000, "out_minor": 160000, "net_minor": 340000}'::jsonb,
  'the total is every year''s money'
);

-- 6-9. One year's months.
select is(
  jsonb_array_length(public.project_cash_year_months(pg_temp.id('cedar'), 2025, '2026-06-15') -> 'months'),
  12,
  'a past year has its 12 months'
);
select is(
  (select jsonb_agg(m ->> 'month') from jsonb_array_elements(public.project_cash_year_months(pg_temp.id('cedar'), 2026, '2026-06-15') -> 'months') m),
  '["2026-06-01", "2026-05-01", "2026-04-01", "2026-03-01", "2026-02-01", "2026-01-01"]'::jsonb,
  'this year runs to this month'
);
select is(
  (select sum((r ->> 'net_minor')::bigint)
   from jsonb_array_elements(public.project_cash_year_months(pg_temp.id('cedar'), 2026, '2026-06-15') -> 'months') m
   cross join lateral jsonb_array_elements(m -> 'by_currency') r
   where r ->> 'currency' = 'ILS'),
  (pg_temp.year_row(2026) ->> 'net_minor')::numeric,
  'a year''s months add up to its row'
);
select throws_ok($$select public.project_cash_year_months(pg_temp.id('cedar'), 2027, '2026-06-15')$$, 'validation', 'a future year is refused');

-- 10-11. A project of another company, or none, reads nothing.
select is(public.project_cash_years(pg_temp.id('elsewhere'), '2026-06-15'), null, 'another company''s project reads null');
select throws_ok($$select public.project_cash_years(null, '2026-06-15')$$, 'validation', 'a project is required');

-- 12-13. A project with no lines has this year only, at zero.
select is(
  (select jsonb_agg((y ->> 'year')::integer) from jsonb_array_elements(public.project_cash_years(pg_temp.id('maple'), '2023-01-15') -> 'years') y),
  '[2023]'::jsonb,
  'a project with nothing yet has this year only'
);
select is(public.project_cash_years(pg_temp.id('maple'), '2023-01-15') ->> 'first_month', null, 'and no first month');

-- 14. Signed out, nothing.
select tests.clear_authentication();
select is(
  (select count(*)::integer from (values
    (has_function_privilege('anon', 'public.project_cash_years(uuid, date)', 'execute')),
    (has_function_privilege('anon', 'public.project_cash_year_months(uuid, integer, date)', 'execute'))
  ) v(allowed) where allowed),
  0,
  'anon cannot call the project history reads'
);

select * from finish();
rollback;
