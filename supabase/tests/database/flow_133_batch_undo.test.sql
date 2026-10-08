-- FLOW-133. undo_batch undoes only the batch's own line_split / line_pnl write; split undo
-- keeps percent and rest; an assign_expenses parts[] row returns its parts.
-- Invented data only. Amounts are cents.

begin;

set constraints all immediate;

select plan(21);

do $users$
begin
  perform tests.create_supabase_user('fbu_owner', 'fbu-owner@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('fbu_owner'), 'Example Batch Undo LLC', false);

create temp table fbu (label text primary key, id uuid);
grant all on fbu to authenticated, service_role;
insert into fbu (label, id) select 'co', id from public.companies where name = 'Example Batch Undo LLC';

insert into public.projects (company_id, name, status)
values
  ((select id from fbu where label = 'co'), 'North', 'active'),
  ((select id from fbu where label = 'co'), 'South', 'active');
insert into fbu (label, id) select lower(name), id from public.projects
where name in ('North', 'South') and company_id = (select id from fbu where label = 'co');

insert into public.categories (company_id, name, kind, sort_order, is_default)
values
  ((select id from fbu where label = 'co'), 'Repairs', 'expense', 90, false),
  ((select id from fbu where label = 'co'), 'Supplies', 'expense', 91, false);
insert into fbu (label, id) select lower(name), id from public.categories
where name in ('Repairs', 'Supplies') and company_id = (select id from fbu where label = 'co');

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description,
  user_assigned, category_suggested
)
select (select id from fbu where label = 'co'), 'expense', 'expense', 'project', 'posted', 'USD',
  -10000, -10000, 10000, 0, 'source', '2026-06-10', '2026-06-10', 'manual', 'fbu:' || k,
  (select id from fbu where label = 'north'), (select id from fbu where label = 'repairs'), 'fbu:' || k, false, true
from unnest(array['a', 'b', 'c']) k;
-- The insert trigger clears category_suggested on a line with a category; mark the guess after.
update public.transactions set category_suggested = true where idempotency_key like 'fbu:%';
insert into fbu (label, id) select replace(idempotency_key, 'fbu:', 'txn_'), id
from public.transactions where idempotency_key like 'fbu:%';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('fbu_owner'), (select id from fbu where label = 'co'), 'hash-fbu-write', 'kid', array['write']::text[], '2099-01-01');
insert into fbu (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-fbu-write';

create or replace function pg_temp.as_mcp()
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := tests.get_supabase_uid('fbu_owner');
  tid uuid;
begin
  select id into tid from pg_temp.fbu where label = 'write';
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
as $$ select id from fbu where label = p_label $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;


-- 1. A batch split with a percent part and a rest part; the row returns its stored parts.
select pg_temp.as_mcp();
create temp table fbu_out as
select public.mcp_assign_expenses('fbu-1', jsonb_build_array(
  jsonb_build_object('transaction_id', pg_temp.id('txn_a'), 'parts', jsonb_build_array(
    jsonb_build_object('category_id', pg_temp.id('repairs'), 'project_id', pg_temp.id('north'), 'percent', 40),
    jsonb_build_object('category_id', pg_temp.id('supplies'), 'project_id', pg_temp.id('south'), 'rest', true)))
)) as r;
grant all on fbu_out to authenticated, service_role;
select is((select r -> 'data' -> 'results' -> 0 -> 'parts' from fbu_out) -> 0 ->> 'amount_minor', '4000',
  'a parts row returns its stored parts in cents');
select is(jsonb_array_length((select r -> 'data' -> 'results' -> 0 -> 'parts' from fbu_out)), 2, 'both parts are returned');

-- And a set_lines_pnl batch on another line.
create temp table fbu_pnl as
select public.mcp_set_lines_pnl('fbu-p1', jsonb_build_array(
  jsonb_build_object('transaction_id', pg_temp.id('txn_b'), 'in_pnl', false))) as r;
grant all on fbu_pnl to authenticated, service_role;
select is((select r -> 'data' ->> 'ok_count' from fbu_pnl), '1', 'the pnl batch row succeeds');

-- 2. A later single write on each line.
select is(public.mcp_split_line('fbu-s2', pg_temp.id('txn_a'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.id('repairs'), 'project_id', pg_temp.id('north'), 'amount_minor', 2500),
  jsonb_build_object('category_id', pg_temp.id('supplies'), 'project_id', pg_temp.id('south'), 'amount_minor', 7500))) ->> 'ok',
  'true', 'a later split_line on the same line');
select is(public.mcp_set_line_pnl('fbu-p2', pg_temp.id('txn_b'), true) ->> 'ok', 'true', 'a later set_line_pnl on the same line');

-- 3. undo_batch does not undo the later writes.
select is(
  public.mcp_undo_batch('fbu-u1', (select r -> 'data' ->> 'batch_key' from fbu_out)) -> 'data' -> 'results' -> 0 ->> 'code',
  'conflict', 'the split row is a conflict while a newer split on the line is live');
select is(
  public.mcp_undo_batch('fbu-pu1', (select r -> 'data' ->> 'batch_key' from fbu_pnl)) -> 'data' -> 'results' -> 0 ->> 'code',
  'conflict', 'the pnl row is a conflict while a newer set_line_pnl on the line is live');
reset role;
select is(
  (select jsonb_agg(amount_minor order by ordinal) from public.line_splits where transaction_id = pg_temp.id('txn_a')),
  '[2500, 7500]'::jsonb, 'the later split is still in place');
select is((select in_pnl_override from public.transactions where id = pg_temp.id('txn_b')), true,
  'the later override is still in place');

-- 4. Undoing the later split brings back the batch's parts with their percent and rest markers.
select pg_temp.as_mcp();
select is(public.mcp_undo('fbu-su', 'line_split', pg_temp.id('txn_a')) ->> 'ok', 'true', 'undo the later split');
select is(public.mcp_undo('fbu-pu', 'line_pnl', pg_temp.id('txn_b')) ->> 'ok', 'true', 'undo the later override');
reset role;
select is(
  (select jsonb_agg(jsonb_build_array(amount_minor, percent, is_rest) order by ordinal)
   from public.line_splits where transaction_id = pg_temp.id('txn_a')),
  '[[4000, 40.0000, false], [6000, null, true]]'::jsonb, 'undo restores each part''s percent and rest');

-- 5. Now the batch's own writes are the newest: undo_batch undoes them.
select pg_temp.as_mcp();
select is(
  public.mcp_undo_batch('fbu-u2', (select r -> 'data' ->> 'batch_key' from fbu_out)) -> 'data' ->> 'ok_count',
  '1', 'the split row undoes once its own write is the newest');
select is(
  public.mcp_undo_batch('fbu-pu2', (select r -> 'data' ->> 'batch_key' from fbu_pnl)) -> 'data' ->> 'ok_count',
  '1', 'the pnl row undoes once its own write is the newest');
reset role;
select is((select count(*)::integer from public.line_splits where transaction_id = pg_temp.id('txn_a')), 0,
  'the line has no split again');
select is((select in_pnl_override from public.transactions where id = pg_temp.id('txn_b')), null::boolean,
  'the line follows its category again');

-- 6. A third undo_batch finds nothing to undo, and does not touch an unrelated newer write.
select pg_temp.as_mcp();
select public.mcp_split_line('fbu-s4', pg_temp.id('txn_a'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.id('repairs'), 'project_id', pg_temp.id('north'), 'amount_minor', 1000),
  jsonb_build_object('category_id', pg_temp.id('supplies'), 'project_id', pg_temp.id('south'), 'amount_minor', 9000)));
select is(
  public.mcp_undo_batch('fbu-u3', (select r -> 'data' ->> 'batch_key' from fbu_out)) -> 'data' -> 'results' -> 0 ->> 'code',
  'not_found', 'an undone batch row is not_found, not the newest write on the line');
reset role;
select is(
  (select jsonb_agg(amount_minor order by ordinal) from public.line_splits where transaction_id = pg_temp.id('txn_a')),
  '[1000, 9000]'::jsonb, 'the unrelated split stays');

-- 7. A batch stored before FLOW-133 has no write_id: its row still undoes the newest write
-- of that kind on the line, as before.
select pg_temp.as_mcp();
create temp table fbu_old as
select public.mcp_assign_expenses('fbu-o1', jsonb_build_array(
  jsonb_build_object('transaction_id', pg_temp.id('txn_c'), 'parts', jsonb_build_array(
    jsonb_build_object('category_id', pg_temp.id('repairs'), 'project_id', pg_temp.id('north'), 'amount_minor', 3000),
    jsonb_build_object('category_id', pg_temp.id('supplies'), 'project_id', pg_temp.id('south'), 'amount_minor', 7000)))
)) as r;
reset role;
update private.mcp_batches b
set row_writes = (select jsonb_agg(e - 'write_id') from jsonb_array_elements(b.row_writes) e)
where b.id = (select (r -> 'data' ->> 'batch_key')::uuid from fbu_old);
select is(
  (select count(*)::integer from private.mcp_batches b, jsonb_array_elements(b.row_writes) e
   where b.id = (select (r -> 'data' ->> 'batch_key')::uuid from fbu_old) and e ? 'write_id'),
  0, 'the stored batch row has no write_id, like one stored before FLOW-133');
select pg_temp.as_mcp();
select is(
  public.mcp_undo_batch('fbu-ou1', (select r -> 'data' ->> 'batch_key' from fbu_old)) -> 'data' ->> 'ok_count',
  '1', 'an old batch row still undoes through mcp_undo');
reset role;
select is((select count(*)::integer from public.line_splits where transaction_id = pg_temp.id('txn_c')), 0,
  'the old batch row put back no split');

select * from finish();
rollback;
