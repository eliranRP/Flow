-- FLOW-127. Income with a project and a guessed loan category is not queued for review: a loan
-- category is out of the P&L even as a guess, so there is nothing to confirm. A guessed
-- kept-out category that is not a loan category still waits (FLOW-126). Invented data only.
-- Amounts are agorot.

begin;

select plan(5);

do $users$
begin
  perform tests.create_supabase_user('korf_owner', 'korf-owner@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('korf_owner'), 'Example Loan Queue LLC', false);

create temp table korf (label text primary key, id uuid);
grant all on korf to authenticated, service_role;
insert into korf (label, id) select 'co', id from public.companies where name = 'Example Loan Queue LLC';

insert into public.projects (company_id, name, status)
values ((select id from korf where label = 'co'), 'North', 'active');
insert into korf (label, id) select 'north', id from public.projects
where company_id = (select id from korf where label = 'co');

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
values ((select id from korf where label = 'co'), 'Deposit back', 'income', 91, false, true);
insert into korf (label, id) select 'cat_back', id from public.categories
where name = 'Deposit back' and company_id = (select id from korf where label = 'co');

-- The loan principal category, kept out and keyed by loan_part.
insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl, loan_part)
select (select id from korf where label = 'co'), 'Loan principal', 'expense', 92, false, true, 'principal'
where not exists (
  select 1 from public.categories c
  where c.company_id = (select id from korf where label = 'co') and c.loan_part = 'principal'
);
insert into korf (label, id) select 'cat_principal', id from public.categories
where company_id = (select id from korf where label = 'co') and loan_part = 'principal';

-- Two posted connector income lines on the project; both categories are then marked as guesses.
insert into public.transactions (
  company_id, direction, doc_kind, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description
)
select
  (select id from korf where label = 'co'), 'income', 'invoice_receipt', 'posted', 'ILS',
  v.amount, v.amount, v.amount, 0, 'source', '2026-06-10', '2026-06-10', 'sumit', v.ikey,
  (select id from korf where label = 'north'),
  (select id from korf where label = v.cat),
  v.ikey
from (values
  (5000, 'korf:loan_guess', 'cat_principal'),
  (6000, 'korf:back_guess', 'cat_back')
) as v(amount, ikey, cat);
insert into korf (label, id) select replace(idempotency_key, 'korf:', 'txn_'), id
from public.transactions where idempotency_key like 'korf:%';

update public.transactions
set category_suggested = true
where id in (select id from korf where label in ('txn_loan_guess', 'txn_back_guess'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.korf where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

create or replace function pg_temp.open_reason(p_label text)
returns text
language sql
as $$
  select coalesce(max(q.reason), case when count(*) > 0 then 'open' else 'none' end)
  from public.review_queue q
  where q.transaction_id = pg_temp.id(p_label) and q.status = 'open';
$$;
grant execute on function pg_temp.open_reason(text) to authenticated, service_role;

create or replace function pg_temp.sync() returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.sync_review_queue(pg_temp.id('co'));
end;
$$;
grant execute on function pg_temp.sync() to service_role;

select is(
  (select count(*)::integer from public.transactions
   where id in (pg_temp.id('txn_loan_guess'), pg_temp.id('txn_back_guess')) and category_suggested),
  2,
  'setup: both lines carry a guessed category'
);

-- The loan guess is already out of the P&L; only the deposit guess counts.
select tests.authenticate_as('korf_owner');
select is(
  (public.get_project(pg_temp.id('north'), 'cash')->>'income_agorot')::bigint,
  6000::bigint,
  'a guessed loan category is out of the P&L, a guessed deposit category counts'
);
reset role;

set local role service_role;
select pg_temp.sync();
reset role;

select is(pg_temp.open_reason('txn_loan_guess'), 'none',
  'income with a project and a guessed loan category is not queued');
select is(pg_temp.open_reason('txn_back_guess'), 'suggested',
  'positive control: a guessed kept-out category that is not a loan category still waits');

set local role service_role;
select pg_temp.sync();
reset role;
select is(
  (select count(*)::integer from public.review_queue where transaction_id = pg_temp.id('txn_loan_guess')),
  0,
  'a second sync still does not queue the loan guess'
);

select * from finish();
rollback;
