-- FLOW-514. get_setup_suggestions (the setup's steps 3 and 4): a lender is a recurring supplier in
-- the company's currency, seen in three months, that no loan carries by name. Projects stay empty.
-- Invented data only. Amounts are agorot. "Today" is 2026-10-20.

begin;

select plan(9);

do $users$
begin
  perform tests.create_supabase_user('su_owner', 'su-owner@example.com');
  perform tests.create_supabase_user('su_outsider', 'su-outsider@example.com');
end
$users$;

create temp table su (label text primary key, id uuid);
grant all on su to authenticated, service_role;

insert into su (label, id) values ('co', tests.fixture_company('su_owner', 'Example Setup LLC'));
update public.companies set base_currency = 'ILS' where id = (select id from su where label = 'co');

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.su where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

-- lantern: a lender, ILS, six months. ridgeway: the same in USD. once: one month only.
-- northline: ILS, three months, and a loan of the same name exists.
insert into public.suppliers (company_id, name)
select pg_temp.id('co'), n
from unnest(array['Lantern Home Loans', 'Ridgeway Lending', 'Once Only Co', 'Northline Supply']) n;

insert into su (label, id)
select case s.name
    when 'Lantern Home Loans' then 'lantern' when 'Ridgeway Lending' then 'ridgeway'
    when 'Once Only Co' then 'once' else 'northline' end,
  s.id
from public.suppliers s where s.company_id = pg_temp.id('co');

-- label, party, date, amount, currency
create temp table su_lines (label text, party text, doc_date date, amount bigint, currency text);
insert into su_lines
select 'lantern_' || to_char(d, 'MM'), 'lantern', d::date + 6, 524000, 'ILS'
from generate_series('2026-04-01'::date, '2026-09-01'::date, interval '1 month') d;
insert into su_lines
select 'ridgeway_' || to_char(d, 'MM'), 'ridgeway', d::date + 6, 90000, 'USD'
from generate_series('2026-04-01'::date, '2026-09-01'::date, interval '1 month') d;
insert into su_lines values
  ('once_line', 'once', '2026-08-03', 12000, 'ILS'),
  ('northline_07', 'northline', '2026-07-02', 150000, 'ILS'),
  ('northline_08', 'northline', '2026-08-02', 150000, 'ILS'),
  ('northline_09', 'northline', '2026-09-02', 150000, 'ILS');

insert into su (label, id)
select l.label, tests.fixture_line(
  pg_temp.id('co'), 'su:' || l.label, l.amount, 'expense', null, null, l.doc_date,
  p_currency => l.currency, p_pnl_role => null
)
from su_lines l;

update public.transactions t
set supplier_id = pg_temp.id(l.party)
from su_lines l
where t.id = pg_temp.id(l.label);

-- A loan with the same name as northline: its supplier is not a lender.
insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency)
values (pg_temp.id('co'), 'Northline Supply', 30000000, 60000, 240, '2026-03-01', 180000, 0, 'ILS');

-- 1-2. The lender: its name, its monthly amount in agorot and the first month's line.
select tests.authenticate_as('su_owner');
select is(
  jsonb_array_length(public.get_setup_suggestions('2026-10-20') -> 'lenders'),
  1,
  'only one lender: the recurring ILS supplier no loan carries'
);
select is(
  public.get_setup_suggestions('2026-10-20') -> 'lenders' -> 0,
  jsonb_build_object('name', 'Lantern Home Loans', 'monthly_agorot', 524000, 'since', '2026-04-07'),
  'the lender has its name, its monthly amount (positive) and the date of its first line'
);

-- 3. Projects are empty until a bank source is chosen.
select is(public.get_setup_suggestions('2026-10-20') -> 'projects', '[]'::jsonb, 'no project suggestions yet');

-- 4-6. What is left out, and why.
select ok(
  not (public.get_setup_suggestions('2026-10-20') -> 'lenders')::text like '%Ridgeway%',
  'a supplier paid in another currency is not a lender'
);
select ok(
  not (public.get_setup_suggestions('2026-10-20') -> 'lenders')::text like '%Once Only%',
  'a supplier seen in one month only is not a lender'
);
select ok(
  not (public.get_setup_suggestions('2026-10-20') -> 'lenders')::text like '%Northline%',
  'a supplier with a loan of the same name is not a lender'
);

-- 7. The read works without a date (today, Israel time).
select is(jsonb_typeof(public.get_setup_suggestions()), 'object', 'the read takes no date and returns an object');

-- 8. Another company's owner gets nothing: the read refuses a user with no company.
select tests.authenticate_as('su_outsider');
select throws_ok(
  'select public.get_setup_suggestions(''2026-10-20'')',
  '42501',
  null,
  'a user with no company is refused'
);

-- 9. Anonymous callers cannot run it.
reset role;
select ok(
  not has_function_privilege('anon', 'public.get_setup_suggestions(date)', 'execute'),
  'anon cannot execute the setup suggestions'
);

select * from finish();
rollback;
