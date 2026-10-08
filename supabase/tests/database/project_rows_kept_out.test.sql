-- get_project transactions[] marks lines kept out of the P&L, so the project page's month
-- headers leave them out. Invented data only. Amounts are agorot.

begin;

select plan(8);

do $users$
begin
  perform tests.create_supabase_user('pko_owner', 'pko-owner@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('pko_owner'), 'Example Kept Out LLC', false);

create temp table pko (label text primary key, id uuid);
grant all on pko to authenticated, service_role;
insert into pko (label, id) select 'co', id from public.companies where name = 'Example Kept Out LLC';

insert into public.projects (company_id, name, status)
values ((select id from pko where label = 'co'), 'Harbor', 'active');
insert into pko (label, id) select 'harbor', id from public.projects
where name = 'Harbor' and company_id = (select id from pko where label = 'co');

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
values
  ((select id from pko where label = 'co'), 'Rent in', 'income', 90, false, false),
  ((select id from pko where label = 'co'), 'Owner deposit', 'income', 91, false, true);
insert into pko (label, id) select 'rent', id from public.categories
where name = 'Rent in' and company_id = (select id from pko where label = 'co');
insert into pko (label, id) select 'deposit', id from public.categories
where name = 'Owner deposit' and company_id = (select id from pko where label = 'co');

insert into public.transactions (
  company_id, direction, doc_kind, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description,
  user_assigned, category_assigned, category_suggested
)
select
  (select id from pko where label = 'co'), 'income', 'receipt', v.status::public.line_status, 'ILS',
  v.amount, v.amount, v.amount, 0, 'source', '2026-06-10', '2026-06-10', 'sumit', v.ikey,
  (select id from pko where label = 'harbor'), (select id from pko where label = v.category), v.ikey,
  true, true, false
from (values
  (5000, 'pko:rent', 'rent', 'posted'),
  (6000, 'pko:deposit', 'deposit', 'posted'),
  (7000, 'pko:taken_out', 'rent', 'posted'),
  (8000, 'pko:pending_deposit', 'deposit', 'pending'),
  (9000, 'pko:pending_rent', 'rent', 'pending')
) as v(amount, ikey, category, status);
update public.transactions set in_pnl_override = false where idempotency_key = 'pko:taken_out';

-- A split line: the Harbor part is in the kept-out category, the other part counts on Pier.
insert into public.projects (company_id, name, status)
values ((select id from pko where label = 'co'), 'Pier', 'active');
insert into pko (label, id) select 'pier', id from public.projects
where name = 'Pier' and company_id = (select id from pko where label = 'co');
insert into public.transactions (
  company_id, direction, doc_kind, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description,
  user_assigned, category_assigned, category_suggested
)
values (
  (select id from pko where label = 'co'), 'income', 'receipt', 'posted', 'ILS',
  4000, 4000, 4000, 0, 'source', '2026-06-11', '2026-06-11', 'sumit', 'pko:split',
  (select id from pko where label = 'harbor'), (select id from pko where label = 'rent'), 'pko:split',
  true, true, false
);
insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor)
select (select id from pko where label = 'co'), t.id, v.ordinal, (select id from pko where label = v.category),
  (select id from pko where label = v.project), v.amount
from public.transactions t
cross join (values (1, 'deposit', 'harbor', 1500), (2, 'rent', 'pier', 2500)) as v(ordinal, category, project, amount)
where t.idempotency_key = 'pko:split';

select tests.authenticate_as('pko_owner');

create or replace function pg_temp.kept_out(p_description text)
returns boolean
language sql
as $$
  select (row->>'kept_out')::boolean
  from jsonb_array_elements(
    public.get_project((select id from pg_temp.pko where label = 'harbor'), 'cash')->'transactions'
  ) row
  where row->>'description' = p_description;
$$;

select is(pg_temp.kept_out('pko:rent'), false, 'a line in the P&L is not kept out');
select is(pg_temp.kept_out('pko:deposit'), true, 'a line in a kept-out category is kept out');
select is(pg_temp.kept_out('pko:taken_out'), true, 'a line the owner took out is kept out');
select is(pg_temp.kept_out('pko:pending_deposit'), true, 'a pending line in a kept-out category is kept out');
select is(pg_temp.kept_out('pko:pending_rent'), false, 'a pending line in the P&L is not kept out');
select is(pg_temp.kept_out('pko:split'), true, 'a split line whose part here is kept out is kept out here');
select is(
  (select (row->>'kept_out')::boolean
   from jsonb_array_elements(
     public.get_project((select id from pko where label = 'pier'), 'cash')->'transactions') row
   where row->>'description' = 'pko:split'),
  false, 'and counts on the project whose part is in the P&L');
select is(
  (public.get_project((select id from pko where label = 'harbor'), 'cash')->>'income_agorot')::bigint,
  5000::bigint, 'the project income counts only the line not kept out');

select * from finish();
rollback;
