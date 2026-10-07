-- FLOW-108 review. The override covers every part of a line split by category, and a
-- forced-in line still never counts a loan category part. Invented data only.

begin;

select plan(6);

do $users$
begin
  perform tests.create_supabase_user('lpp_owner', 'lpp-owner@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('lpp_owner'), 'Example Parts LLC', false);

create temp table lpp (label text primary key, id uuid);
grant all on lpp to authenticated, service_role;
insert into lpp (label, id) select 'co', id from public.companies where name = 'Example Parts LLC';

insert into public.projects (company_id, name, status)
values ((select id from lpp where label = 'co'), 'South', 'active');
insert into lpp (label, id) select 'south', id from public.projects where name = 'South';

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
values
  ((select id from lpp where label = 'co'), 'Fittings', 'expense', 91, false, false),
  ((select id from lpp where label = 'co'), 'Kept deposits', 'expense', 92, false, true);
insert into lpp (label, id) select 'cat_' || lower(replace(name, ' ', '_')), id
from public.categories where name in ('Fittings', 'Kept deposits');
insert into lpp (label, id)
select 'cat_principal', id from public.categories
where company_id = (select id from lpp where label = 'co') and loan_part = 'principal';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description
)
values (
  (select id from lpp where label = 'co'), 'expense', 'expense', 'project', 'posted', 'ILS',
  -60000, -60000, 60000, 0, 'source', '2026-06-10', '2026-06-10', 'manual', 'lpp:split',
  (select id from lpp where label = 'south'), (select id from lpp where label = 'cat_fittings'), 'lpp:split'
);
insert into lpp (label, id) select 'txn', id from public.transactions where idempotency_key = 'lpp:split';

-- Three parts: an ordinary category, a kept-out category, and the loan principal category.
insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor)
values
  ((select id from lpp where label = 'co'), (select id from lpp where label = 'txn'), 1, (select id from lpp where label = 'cat_fittings'), null, 20000),
  ((select id from lpp where label = 'co'), (select id from lpp where label = 'txn'), 2, (select id from lpp where label = 'cat_kept_deposits'), null, 10000),
  ((select id from lpp where label = 'co'), (select id from lpp where label = 'txn'), 3, (select id from lpp where label = 'cat_principal'), null, 30000);

-- The sum of the line's parts that count.
create or replace function pg_temp.counted()
returns bigint
language sql
as $$
  select coalesce(sum(l.amount_net) filter (where l.in_pnl), 0)::bigint
  from private.pnl_lines l
  where l.transaction_id = (select id from pg_temp.lpp where label = 'txn');
$$;
grant execute on function pg_temp.counted() to authenticated, service_role;

select tests.authenticate_as('lpp_owner');
select is(pg_temp.counted(), -20000::bigint, 'baseline: only the ordinary part counts');

select lives_ok(
  $$select public.set_transaction_pnl((select id from pg_temp.lpp where label = 'txn'), false)$$,
  'the owner takes the split line out'
);
select is(pg_temp.counted(), 0::bigint, 'out: every part of the split line leaves the P&L');

select lives_ok(
  $$select public.set_transaction_pnl((select id from pg_temp.lpp where label = 'txn'), true)$$,
  'the owner forces the split line in'
);
select is(
  pg_temp.counted(), -30000::bigint,
  'forced in: the kept-out part counts, the loan principal part does not'
);
select is(
  (select l.in_pnl from private.pnl_lines l
   where l.transaction_id = (select id from pg_temp.lpp where label = 'txn')
     and l.category_id = (select id from pg_temp.lpp where label = 'cat_principal')),
  false,
  'forced in: principal never becomes an expense'
);

reset role;
select * from finish();
rollback;
