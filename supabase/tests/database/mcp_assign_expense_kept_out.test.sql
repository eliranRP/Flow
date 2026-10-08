-- FLOW-205. MCP assign_expense without a project: only an income category kept out of the
-- P&L takes it; anything else is validation up front. Invented data only. Amounts are agorot.

begin;

select plan(9);

do $users$
begin
  perform tests.create_supabase_user('aeko_owner', 'aeko-owner@example.com');
  perform tests.create_supabase_user('aeko_other', 'aeko-other@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values
  (tests.get_supabase_uid('aeko_owner'), 'Example Kept LLC', false),
  (tests.get_supabase_uid('aeko_other'), 'Example Elsewhere LLC', false);

create temp table aeko (label text primary key, id uuid);
grant all on aeko to authenticated, service_role;
insert into aeko (label, id) select 'co', id from public.companies where name = 'Example Kept LLC';
insert into aeko (label, id) select 'other_co', id from public.companies where name = 'Example Elsewhere LLC';

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
values
  ((select id from aeko where label = 'co'), 'Rent in', 'income', 90, false, false),
  ((select id from aeko where label = 'co'), 'Deposit back', 'income', 91, false, true),
  ((select id from aeko where label = 'co'), 'Transfers out', 'expense', 92, false, true),
  ((select id from aeko where label = 'other_co'), 'Deposit back', 'income', 91, false, true);
insert into aeko (label, id) select 'cat_rent', id from public.categories
where name = 'Rent in' and company_id = (select id from aeko where label = 'co');
insert into aeko (label, id) select 'cat_back', id from public.categories
where name = 'Deposit back' and company_id = (select id from aeko where label = 'co');
insert into aeko (label, id) select 'cat_transfer', id from public.categories
where name = 'Transfers out' and company_id = (select id from aeko where label = 'co');
insert into aeko (label, id) select 'cat_back_other', id from public.categories
where name = 'Deposit back' and company_id = (select id from aeko where label = 'other_co');

insert into public.transactions (
  company_id, direction, doc_kind, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description
)
select
  (select id from aeko where label = 'co'), v.direction::public.txn_direction, v.doc_kind::public.doc_kind, 'posted', 'ILS',
  v.amount, v.amount, abs(v.amount), 0, 'source', '2026-06-10', '2026-06-10', 'sumit', v.ikey,
  null, (select id from aeko where label = 'cat_rent'), v.ikey
from (values
  ('income', 'invoice_receipt', 5000, 'aeko:review'),
  ('income', 'invoice_receipt', 6000, 'aeko:plain'),
  ('expense', 'expense', -7000, 'aeko:out')
) as v(direction, doc_kind, amount, ikey);
insert into aeko (label, id) select replace(idempotency_key, 'aeko:', 'txn_'), id
from public.transactions where idempotency_key like 'aeko:%';

-- One line waits in review; the other has none.
insert into public.review_queue (company_id, transaction_id, status, reason)
values ((select id from aeko where label = 'co'), (select id from aeko where label = 'txn_review'), 'open', 'missing_project');
delete from public.review_queue
where transaction_id in (select id from aeko where label in ('txn_plain', 'txn_out')) and status = 'open';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('aeko_owner'), (select id from aeko where label = 'co'), 'hash-aeko-write', 'kid', array['write']::text[], '2099-01-01');
insert into aeko (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-aeko-write';

create or replace function pg_temp.as_mcp()
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := tests.get_supabase_uid('aeko_owner');
  tid uuid;
begin
  select id into tid from pg_temp.aeko where label = 'write';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp() to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid
language sql
as $$ select id from aeko where label = p_label $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

select pg_temp.as_mcp();
select is(
  public.mcp_assign_expense('aeko-1', pg_temp.id('txn_review'), null, pg_temp.id('cat_back')) -> 'data' ->> 'undo_kind',
  'review', 'kept-out income with an open review: no project needed, the review closes');
select is(
  public.mcp_assign_expense('aeko-2', pg_temp.id('txn_plain'), null, pg_temp.id('cat_back')) ->> 'ok',
  'true', 'kept-out income without a review: no project needed');
select is(
  public.mcp_assign_expense('aeko-3', pg_temp.id('txn_out'), null, pg_temp.id('cat_transfer')) -> 'error' ->> 'code',
  'validation', 'a kept-out expense category still needs a project: validation, not refused');
select is(
  public.mcp_assign_expense('aeko-4', pg_temp.id('txn_plain'), null, pg_temp.id('cat_rent')) -> 'error' ->> 'code',
  'validation', 'income counted in the P&L needs a project');
select is(
  public.mcp_assign_expense('aeko-5', pg_temp.id('txn_plain'), null, pg_temp.id('cat_back_other')) -> 'error' ->> 'code',
  'validation', 'another company''s kept-out income category is validation');

reset role;
select is(
  (select jsonb_build_array(project_id, category_id) from public.transactions where id = pg_temp.id('txn_review')),
  jsonb_build_array(null, pg_temp.id('cat_back')), 'the reviewed line has the kept-out category and no project');
select is(
  (select status from public.review_queue where transaction_id = pg_temp.id('txn_review') order by created_at desc limit 1),
  'approved', 'its review is approved');
select is(
  (select jsonb_build_array(project_id, category_id) from public.transactions where id = pg_temp.id('txn_plain')),
  jsonb_build_array(null, pg_temp.id('cat_back')), 'the other line has the kept-out category and no project');
select is(
  (select category_id from public.transactions where id = pg_temp.id('txn_out')),
  pg_temp.id('cat_rent'), 'the refused line is unchanged');

select * from finish();
rollback;
