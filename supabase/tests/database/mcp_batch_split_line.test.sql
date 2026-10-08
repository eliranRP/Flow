-- FLOW-312 item 5. assign_expenses rows with parts[] run split_line; undo_batch undoes them.
-- Invented data only. Amounts are cents.

begin;

set constraints all immediate;

select plan(16);

do $users$
begin
  perform tests.create_supabase_user('mbs_owner', 'mbs-owner@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('mbs_owner'), 'Example Batch Split LLC', false);

create temp table mbs (label text primary key, id uuid);
grant all on mbs to authenticated, service_role;
insert into mbs (label, id) select 'co', id from public.companies where name = 'Example Batch Split LLC';

insert into public.projects (company_id, name, status)
values
  ((select id from mbs where label = 'co'), 'North', 'active'),
  ((select id from mbs where label = 'co'), 'South', 'active');
insert into mbs (label, id) select lower(name), id from public.projects
where name in ('North', 'South') and company_id = (select id from mbs where label = 'co');

insert into public.categories (company_id, name, kind, sort_order, is_default)
values
  ((select id from mbs where label = 'co'), 'Repairs', 'expense', 90, false),
  ((select id from mbs where label = 'co'), 'Supplies', 'expense', 91, false);
insert into mbs (label, id) select lower(name), id from public.categories
where name in ('Repairs', 'Supplies') and company_id = (select id from mbs where label = 'co');

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description,
  user_assigned, category_suggested
)
select (select id from mbs where label = 'co'), 'expense', 'expense', 'project', 'posted', 'USD',
  -10000, -10000, 10000, 0, 'source', '2026-06-10', '2026-06-10', 'manual', 'mbs:' || k,
  (select id from mbs where label = 'north'), (select id from mbs where label = 'repairs'), 'mbs:' || k, false, true
from unnest(array['a', 'b', 'c']) k;
insert into mbs (label, id) select replace(idempotency_key, 'mbs:', 'txn_'), id
from public.transactions where idempotency_key like 'mbs:%';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('mbs_owner'), (select id from mbs where label = 'co'), 'hash-mbs-write', 'kid', array['write']::text[], '2099-01-01');
insert into mbs (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-mbs-write';

create or replace function pg_temp.as_mcp()
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := tests.get_supabase_uid('mbs_owner');
  tid uuid;
begin
  select id into tid from pg_temp.mbs where label = 'write';
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
as $$ select id from mbs where label = p_label $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

create function pg_temp.items() returns jsonb
language sql
as $$
  select jsonb_build_array(
    jsonb_build_object('transaction_id', pg_temp.id('txn_a'), 'parts', jsonb_build_array(
      jsonb_build_object('category_id', pg_temp.id('repairs'), 'project_id', pg_temp.id('north'), 'amount_minor', 4000),
      jsonb_build_object('category_id', pg_temp.id('supplies'), 'project_id', pg_temp.id('south'), 'percent', 60))),
    jsonb_build_object('transaction_id', pg_temp.id('txn_b'), 'parts', jsonb_build_array(
      jsonb_build_object('category_id', pg_temp.id('repairs'), 'project_id', pg_temp.id('north'), 'amount_minor', 4000),
      jsonb_build_object('category_id', pg_temp.id('supplies'), 'project_id', pg_temp.id('south'), 'amount_minor', 5000))),
    jsonb_build_object('transaction_id', pg_temp.id('txn_c'), 'category_id', pg_temp.id('supplies'))
  )
$$;
grant execute on function pg_temp.items() to authenticated, service_role;

select pg_temp.as_mcp();
create temp table mbs_out as
select public.mcp_assign_expenses('mbs-1', pg_temp.items()) as r;
grant all on mbs_out to authenticated, service_role;

select is((select r -> 'data' ->> 'ok_count' from mbs_out), '2', 'two rows succeed');
select is((select r -> 'data' ->> 'error_count' from mbs_out), '1', 'one row fails');
select is((select r -> 'data' -> 'results' -> 0 ->> 'undo_kind' from mbs_out), 'line_split', 'a parts row is a line split');
select is((select r -> 'data' -> 'results' -> 1 ->> 'code' from mbs_out), 'refused', 'parts that miss the line are refused');
select is((select r -> 'data' -> 'results' -> 2 ->> 'undo_kind' from mbs_out), 'reassign', 'a plain row still files the line');

reset role;
select is(
  (select jsonb_agg(amount_minor order by ordinal) from public.line_splits where transaction_id = pg_temp.id('txn_a')),
  '[4000, 6000]'::jsonb, 'the split row stored its parts in cents');
select is((select count(*)::integer from public.line_splits where transaction_id = pg_temp.id('txn_b')), 0,
  'the refused row wrote nothing');
select is(
  (select jsonb_build_array(user_assigned, category_suggested) from public.transactions where id = pg_temp.id('txn_a')),
  '[true, false]'::jsonb, 'the split line is no longer a suggestion');

select pg_temp.as_mcp();
select is(public.mcp_assign_expenses('mbs-1', pg_temp.items()), (select r from mbs_out), 'a retry replays the batch');
select is(
  public.mcp_assign_expenses('mbs-1', jsonb_build_array(jsonb_build_object('transaction_id', pg_temp.id('txn_a'), 'parts', '[]'::jsonb))) -> 'error' ->> 'code',
  'conflict', 'the same key with other rows is a conflict');
select is(
  public.mcp_assign_expenses('mbs-bad', jsonb_build_array(jsonb_build_object(
    'transaction_id', pg_temp.id('txn_b'), 'parts', '[]'::jsonb, 'category_id', pg_temp.id('repairs')))) -> 'data' -> 'results' -> 0 ->> 'code',
  'validation', 'a parts row with another field is validation');
select is(
  public.mcp_assign_expenses('mbs-bad2', jsonb_build_array(jsonb_build_object(
    'transaction_id', pg_temp.id('txn_b'), 'parts', '{}'::jsonb))) -> 'data' -> 'results' -> 0 ->> 'code',
  'validation', 'parts that are not an array are validation');

-- undo_batch undoes the split row and the category row.
select is(
  public.mcp_undo_batch('mbs-u1', (select r -> 'data' ->> 'batch_key' from mbs_out)) -> 'data' ->> 'ok_count',
  '2', 'undo_batch undoes both rows');
reset role;
select is((select count(*)::integer from public.line_splits where transaction_id = pg_temp.id('txn_a')), 0,
  'the split is gone');
select is(
  (select jsonb_build_array(user_assigned, category_suggested) from public.transactions where id = pg_temp.id('txn_a')),
  '[false, false]'::jsonb, 'and the line''s flags are back as split_line undo leaves them');

-- A batch that clears a split with parts [].
select pg_temp.as_mcp();
select public.mcp_split_line('mbs-s', pg_temp.id('txn_a'), pg_temp.items() -> 0 -> 'parts');
select is(
  public.mcp_assign_expenses('mbs-2', jsonb_build_array(jsonb_build_object('transaction_id', pg_temp.id('txn_a'), 'parts', '[]'::jsonb))) -> 'data' ->> 'ok_count',
  '1', 'parts [] in a batch clears the split');

select * from finish();
rollback;
