-- expected_months names a recurring charge that pays a loan ('pays_loan'): any of the charge's lines
-- is split into loan parts. A servicer's usual amount is the whole payment, principal included, so
-- the next-month profit forecast leaves it out. Invented data only. Amounts are cents. "Today" is
-- 2026-10-20.

begin;

select plan(5);

do $users$
begin
  perform tests.create_supabase_user('pl_owner', 'pl-owner@example.com');
end
$users$;

create temp table pl (label text primary key, id uuid);
grant all on pl to authenticated, service_role;

insert into pl (label, id) values ('co', tests.fixture_company('pl_owner', 'Example Loan Forecast LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.pl where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into pl (label, id) values
  ('alder', tests.fixture_project(pg_temp.id('co'), 'Alder Ct')),
  ('birch', tests.fixture_project(pg_temp.id('co'), 'Birch Way'));

insert into public.suppliers (company_id, name)
values (pg_temp.id('co'), 'Example Servicing'), (pg_temp.id('co'), 'Example Water');
insert into pl (label, id)
select case s.name when 'Example Servicing' then 'servicer' else 'water' end, s.id
from public.suppliers s where s.company_id = pg_temp.id('co');

-- The servicer pays Alder's loan ($1,880: principal, interest and escrow) and bills Birch $900 that is
-- not split. Water bills Alder $120. All monthly, April to September.
create temp table pl_lines (key text, party text, project text, doc_date date, amount bigint);
insert into pl_lines
select 'alder:' || d::date, 'servicer', 'alder', d::date + 3, 188000 from generate_series('2026-04-01'::date, '2026-09-01', interval '1 month') d;
insert into pl_lines
select 'birch:' || d::date, 'servicer', 'birch', d::date + 5, 90000 from generate_series('2026-04-01'::date, '2026-09-01', interval '1 month') d;
insert into pl_lines
select 'water:' || d::date, 'water', 'alder', d::date + 17, 12000 from generate_series('2026-04-01'::date, '2026-09-01', interval '1 month') d;

insert into pl (label, id)
select l.key, tests.fixture_line(
  pg_temp.id('co'), 'pl:' || l.key, l.amount, 'expense', pg_temp.id(l.project), null, l.doc_date,
  p_currency => 'USD', p_pnl_role => null
)
from pl_lines l;
update public.transactions t set supplier_id = pg_temp.id(l.party)
from pl_lines l where t.id = pg_temp.id(l.key);

insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency)
values (pg_temp.id('co'), 'Example Alder Loan', 24000000, 60000, 360, '2026-01-01', 188000, 28000, 'USD');
insert into pl (label, id) select 'loan', l.id from public.loans l where l.company_id = pg_temp.id('co');

-- Only the latest payment is split: one split line is enough to name the charge.
insert into public.loan_splits (company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id, needs_review)
select pg_temp.id('co'), pg_temp.id('loan'), pg_temp.id('alder:2026-09-01'), v.part::public.loan_split_part, v.amount, v.amount,
  (select c.id from public.categories c where c.company_id = pg_temp.id('co') and c.kind = 'expense' order by c.sort_order limit 1),
  false
from (values ('principal', 42000), ('interest', 118000), ('escrow', 28000)) v(part, amount);

create or replace function pg_temp.charge(p_party text, p_project text)
returns jsonb
language sql
as $$
  select e from jsonb_array_elements(public.expected_months(2, null, '2026-10-20') -> 'recurring') e
  where (e ->> 'party_id')::uuid = pg_temp.id(p_party) and (e ->> 'project_id')::uuid = pg_temp.id(p_project);
$$;
grant execute on function pg_temp.charge(text, text) to authenticated, service_role;

select tests.authenticate_as('pl_owner');

-- 1-2. The loan's charge says so, and its usual amount is still the whole payment (cash).
select is((pg_temp.charge('servicer', 'alder') ->> 'pays_loan')::boolean, true, 'a charge with a split line pays a loan');
select is((pg_temp.charge('servicer', 'alder') ->> 'typical_amount_minor')::bigint, -188000::bigint, 'its usual amount is the whole payment');

-- 3-4. The same servicer's other project, and another supplier, do not.
select is((pg_temp.charge('servicer', 'birch') ->> 'pays_loan')::boolean, false, 'the servicer''s charge with no split line pays no loan');
select is((pg_temp.charge('water', 'alder') ->> 'pays_loan')::boolean, false, 'a utility pays no loan');

-- 5. The project read names it too.
select is(
  (select (e ->> 'pays_loan')::boolean
   from jsonb_array_elements(public.expected_months(2, pg_temp.id('alder'), '2026-10-20') -> 'recurring') e
   where (e ->> 'party_id')::uuid = pg_temp.id('servicer')),
  true,
  'expected_months for one project names its loan charge'
);

select * from finish();
rollback;
