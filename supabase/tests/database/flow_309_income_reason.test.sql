-- FLOW-309 server item. Connector income with no project and a guessed category waits as
-- missing_category, not missing_project. Picking the category then queues missing_project
-- (unless the category keeps the line out of the P&L), and undo takes that row back.
-- Invented data only. Amounts are agorot.

begin;

select plan(11);

do $users$
begin
  perform tests.create_supabase_user('fir_owner', 'fir-owner@example.com');
end
$users$;

select tests.authenticate_as('fir_owner');
select public.create_company('Example Income Reason LLC', false);
reset role;

create temp table fir (label text primary key, id uuid);
grant all on fir to authenticated, service_role;
insert into fir (label, id) select 'co', id from public.companies where name = 'Example Income Reason LLC';

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
values
  ((select id from fir where label = 'co'), 'Example rent in', 'income', 90, false, false),
  ((select id from fir where label = 'co'), 'Example owner in', 'income', 91, false, true),
  ((select id from fir where label = 'co'), 'Example refunds', 'expense', 92, false, false);
insert into fir (label, id)
select case c.name when 'Example rent in' then 'rent' when 'Example owner in' then 'owner_in' else 'refunds' end, c.id
from public.categories c
where c.company_id = (select id from fir where label = 'co')
  and c.name in ('Example rent in', 'Example owner in', 'Example refunds');

-- Posted connector income with a guessed category and no project.
insert into public.transactions (
  company_id, direction, doc_kind, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, category_id, description
)
select
  (select id from fir where label = 'co'), 'income', 'receipt', 'posted', 'ILS',
  v.amount, v.amount, v.amount, 0, 'source', '2026-06-10', '2026-06-10', 'sumit', v.ikey,
  (select id from fir where label = 'rent'), v.ikey
from (values (5000, 'fir:a'), (6000, 'fir:b'), (7000, 'fir:c')) as v(amount, ikey);
insert into fir (label, id) select replace(idempotency_key, 'fir:', 'txn_'), id
from public.transactions where idempotency_key like 'fir:%';
-- The insert trigger clears category_suggested on a line with a category; mark the guess after.
update public.transactions set category_suggested = true where idempotency_key like 'fir:%';

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.fir where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

create or replace function pg_temp.sync()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.sync_review_queue(pg_temp.id('co'));
end;
$$;
grant execute on function pg_temp.sync() to service_role;

create or replace function pg_temp.open_reasons(p_label text)
returns text
language sql
as $$
  select coalesce(string_agg(coalesce(q.reason::text, 'null'), ',' order by q.reason::text), 'none')
  from public.review_queue q
  where q.transaction_id = pg_temp.id(p_label) and q.status = 'open';
$$;
grant execute on function pg_temp.open_reasons(text) to authenticated, service_role;

select pg_temp.sync();
reset role;

-- 1. The guess is not the owner's pick, so the category is the open question.
select is(pg_temp.open_reasons('txn_a'), 'missing_category',
  'income with a guessed category and no project waits as missing_category');
select is(pg_temp.open_reasons('txn_b'), 'missing_category', 'so does the second line');

-- 2. Picking an in-P&L income category leaves the project to ask for.
select tests.authenticate_as('fir_owner');
insert into fir (label, id) values ('undo_a', public.set_transaction_category(pg_temp.id('txn_a'), pg_temp.id('rent')));
reset role;
select is(pg_temp.open_reasons('txn_a'), 'missing_project',
  'after the category is picked, the line waits for its project');
select is(
  (select status::text from public.review_queue
   where transaction_id = pg_temp.id('txn_a') and reason = 'missing_category'),
  'changed', 'the missing_category row is resolved as changed');

-- A sync after the pick keeps one open row.
select pg_temp.sync();
reset role;
select is(pg_temp.open_reasons('txn_a'), 'missing_project', 'a sync does not add a second row');

-- 3. Undo puts the category question back and takes the project row with it.
select tests.authenticate_as('fir_owner');
select public.undo_reassign(pg_temp.id('undo_a'));
reset role;
select is(pg_temp.open_reasons('txn_a'), 'missing_category', 'undo reopens missing_category alone');
select is(
  (select count(*)::integer from public.review_queue
   where transaction_id = pg_temp.id('txn_a') and reason = 'missing_project'),
  0, 'and removes the missing_project row the pick queued');

-- 4. A kept-out category needs no project, so nothing is queued.
select tests.authenticate_as('fir_owner');
select public.set_transaction_category(pg_temp.id('txn_b'), pg_temp.id('owner_in'));
reset role;
select is(pg_temp.open_reasons('txn_b'), 'none', 'a kept-out income category leaves review');

-- An expense category on income is a reversal, which still needs a project.
select tests.authenticate_as('fir_owner');
select public.set_transaction_category(pg_temp.id('txn_c'), pg_temp.id('refunds'));
reset role;
select is(pg_temp.open_reasons('txn_c'), 'missing_project', 'a reversal category on income waits for its project');

-- 5. Without resolving (p_resolve false), the row is left as it was.
select tests.authenticate_as('fir_owner');
select public.set_transaction_category(pg_temp.id('txn_a'), pg_temp.id('rent'), false);
reset role;
select is(pg_temp.open_reasons('txn_a'), 'missing_category',
  'a category set without resolving queues no project row');
select is(
  (select count(*)::integer from public.review_queue
   where transaction_id in (pg_temp.id('txn_a'), pg_temp.id('txn_b'), pg_temp.id('txn_c')) and status = 'open' and reason is null),
  0, 'no open row is left without a reason');

select * from finish();
rollback;
