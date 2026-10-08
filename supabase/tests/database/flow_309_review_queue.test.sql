-- FLOW-309. A pending income line that posts takes a real review reason or leaves review; a
-- row resolved as changed is not queued again. Invented data only. Amounts are agorot.

begin;

select plan(7);

do $users$
begin
  perform tests.create_supabase_user('frq_owner', 'frq-owner@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('frq_owner'), 'Example Queue Post LLC', false);

create temp table frq (label text primary key, id uuid);
grant all on frq to authenticated, service_role;
insert into frq (label, id) select 'co', id from public.companies where name = 'Example Queue Post LLC';

insert into public.projects (company_id, name, status)
values ((select id from frq where label = 'co'), 'Harbor', 'active');
insert into frq (label, id) select 'harbor', id from public.projects
where name = 'Harbor' and company_id = (select id from frq where label = 'co');

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
values ((select id from frq where label = 'co'), 'Rent in', 'income', 90, false, false);
insert into frq (label, id) select 'rent', id from public.categories
where name = 'Rent in' and company_id = (select id from frq where label = 'co');

-- Pending connector income: one unfiled, one already filed and confirmed by the owner.
insert into public.transactions (
  company_id, direction, doc_kind, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description
)
select
  (select id from frq where label = 'co'), 'income', 'receipt', 'pending', 'ILS',
  v.amount, v.amount, v.amount, 0, 'source', '2026-06-10', '2026-06-10', 'sumit', v.ikey,
  (select id from frq where label = v.project), (select id from frq where label = 'rent'), v.ikey
from (values
  (5000, 'frq:open', null),
  (6000, 'frq:filed', 'harbor'),
  (7000, 'frq:changed', null)
) as v(amount, ikey, project);
insert into frq (label, id) select replace(idempotency_key, 'frq:', 'txn_'), id
from public.transactions where idempotency_key like 'frq:%';
update public.transactions
set user_assigned = true, category_assigned = true, category_suggested = false
where id = (select id from frq where label = 'txn_filed');

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.frq where label = p_label; $$;
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

create or replace function pg_temp.open_reason(p_label text)
returns text
language sql
as $$
  select coalesce(max(coalesce(q.reason, 'null')), case when count(*) > 0 then 'open' else 'none' end)
  from public.review_queue q
  where q.transaction_id = pg_temp.id(p_label) and q.status = 'open';
$$;
grant execute on function pg_temp.open_reason(text) to authenticated, service_role;

select pg_temp.sync();
reset role;
select is(pg_temp.open_reason('txn_open'), 'pending_income', 'setup: a pending income line waits as pending_income');
select is(pg_temp.open_reason('txn_filed'), 'pending_income', 'setup: so does the filed one');

-- The owner resolves the third as changed, then all three post.
update public.review_queue set status = 'changed', resolved_at = now()
where transaction_id = pg_temp.id('txn_changed') and status = 'open';
update public.transactions set line_status = 'posted' where idempotency_key like 'frq:%';

select pg_temp.sync();
reset role;
select is(pg_temp.open_reason('txn_open'), 'missing_project', 'a posted unfiled line takes a real reason, not null');
select is(pg_temp.open_reason('txn_filed'), 'none', 'a posted line the owner already filed leaves review');
select is(pg_temp.open_reason('txn_changed'), 'none', 'a row resolved as changed is not queued again');
select is(
  (select count(*)::integer from public.review_queue where transaction_id = pg_temp.id('txn_changed')),
  1, 'the changed row stays as it was');
select is(
  (select count(*)::integer from public.review_queue where reason is null and status = 'open'
   and company_id = pg_temp.id('co')),
  0, 'no open row is left without a reason');

select * from finish();
rollback;
