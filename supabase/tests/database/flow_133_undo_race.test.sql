-- FLOW-133 (#155 review): undo_batch against other writes on the same line, with two real
-- sessions (dblink). undo_batch and mcp_undo('line_split') on one line run one after the other
-- in either order (both lock the write row, then the line), and a split_line another token has
-- not committed yet makes undo_batch wait and then report a conflict. The fixture is committed
-- by session a and deleted at the end; a failed run leaves it until the next run's setup deletes
-- it by name. @example.com only. Amounts are cents.

begin;

select plan(12);

create extension if not exists dblink with schema extensions;

-- As in mcp_undo_race.test.sql: a superuser socket locally, a password on the CLI database.
create or replace function pg_temp.connect(p_name text)
returns text
language plpgsql
as $$
declare
  candidate text;
  errors text := '';
begin
  foreach candidate in array array[
    format('dbname=%s', current_database()),
    format('host=%s port=%s dbname=%s user=postgres password=postgres',
      host(inet_server_addr()), inet_server_port(), current_database()),
    format('host=127.0.0.1 port=5432 dbname=%s user=postgres password=postgres', current_database())
  ] loop
    begin
      perform extensions.dblink_connect(p_name, candidate);
      return 'connected';
    exception when others then
      errors := errors || ' | ' || sqlerrm;
    end;
  end loop;
  return 'no connection:' || errors;
end;
$$;

select is(pg_temp.connect('fur_a'), 'connected', 'session a connects');
select is(pg_temp.connect('fur_b'), 'connected', 'session b connects');

select extensions.dblink_exec('fur_a', $setup$
  do $d$
  declare
    co uuid;
  begin
    delete from private.mcp_credentials where token_hash in ('hash-fur-one', 'hash-fur-two');
    delete from public.companies where name = 'Example Undo Line Race Co';
    delete from auth.users where id = tests.get_supabase_uid('fur_owner');
    perform tests.create_supabase_user('fur_owner', 'fur-owner@example.com');
    insert into public.companies (owner_id, name, is_demo)
    values (tests.get_supabase_uid('fur_owner'), 'Example Undo Line Race Co', false)
    returning id into co;
    insert into public.projects (company_id, name, status)
    values (co, 'Example North', 'active'), (co, 'Example South', 'active');
    insert into public.categories (company_id, name, kind, sort_order, is_default)
    values (co, 'Example Repairs', 'expense', 90, false), (co, 'Example Supplies', 'expense', 91, false);
    insert into public.transactions (
      company_id, direction, doc_kind, pnl_role, line_status, currency,
      amount_gross, amount_net, amount_original, vat_amount, vat_status,
      doc_date, cash_date, source, idempotency_key, project_id, category_id, description
    )
    select co, 'expense', 'expense', 'project', 'posted', 'USD',
      -10000, -10000, 10000, 0, 'source', '2026-06-10', '2026-06-10', 'manual', 'fur:' || k,
      (select id from public.projects where company_id = co and name = 'Example North'),
      (select id from public.categories where company_id = co and name = 'Example Repairs'),
      'fur:' || k
    from unnest(array['a', 'b', 'c']) k;
    -- Two write tokens of the same owner: another write to the line comes from the second.
    insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
    values
      (tests.get_supabase_uid('fur_owner'), co, 'hash-fur-one', 'kid', array['write']::text[], '2099-01-01'),
      (tests.get_supabase_uid('fur_owner'), co, 'hash-fur-two', 'kid', array['write']::text[], '2099-01-01');
  end
  $d$;
$setup$);

-- Each session acts as an MCP token in its own transaction and returns the response as text.
select extensions.dblink_exec(s, $fn$
  create function pg_temp.mcp(p_token text, p_sql text) returns text language plpgsql as $body$
  declare
    uid uuid := tests.get_supabase_uid('fur_owner');
    tid uuid := (select id from private.mcp_credentials where token_hash = p_token);
    result text;
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', uid::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object(
      'sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text, true);
    execute p_sql into result;
    reset role;
    return result;
  exception when others then
    reset role;
    return json_build_object('sqlstate', sqlstate, 'message', sqlerrm)::text;
  end;
  $body$;
$fn$)
from unnest(array['fur_a', 'fur_b']) s;

create temp table fur (label text primary key, id uuid);
insert into fur (label, id)
select replace(t.idempotency_key, 'fur:', 'txn_'), t.id
from public.transactions t
join public.companies c on c.id = t.company_id
where c.name = 'Example Undo Line Race Co';
insert into fur (label, id)
select lower(replace(name, 'Example ', '')), id from public.projects
where company_id = (select id from public.companies where name = 'Example Undo Line Race Co');
insert into fur (label, id)
select lower(replace(name, 'Example ', '')), id from public.categories
where company_id = (select id from public.companies where name = 'Example Undo Line Race Co')
  and name in ('Example Repairs', 'Example Supplies');

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.fur where label = p_label; $$;

-- A statement session a or b runs as a token.
create or replace function pg_temp.as_token(p_token text, p_sql text)
returns text
language sql
as $$ select format('select pg_temp.mcp(%L, %L)', p_token, p_sql); $$;

-- One committed batch split per line, each by token one.
create temp table fur_batch (label text primary key, batch_key text);
select extensions.dblink_exec('fur_a', 'begin');
insert into fur_batch (label, batch_key)
select k, (r::jsonb) -> 'data' ->> 'batch_key'
from unnest(array['a', 'b', 'c']) k,
lateral extensions.dblink('fur_a', pg_temp.as_token('hash-fur-one', format(
  $s$select public.mcp_assign_expenses(%L, %L::jsonb)::text$s$,
  'fur-batch-' || k,
  jsonb_build_array(jsonb_build_object('transaction_id', pg_temp.id('txn_' || k), 'parts', jsonb_build_array(
    jsonb_build_object('category_id', pg_temp.id('repairs'), 'project_id', pg_temp.id('north'), 'amount_minor', 4000),
    jsonb_build_object('category_id', pg_temp.id('supplies'), 'project_id', pg_temp.id('south'), 'amount_minor', 6000)
  )))::text
))) as t(r text);
select extensions.dblink_exec('fur_a', 'commit');
select is((select count(*)::integer from fur_batch where batch_key is not null), 3, 'setup: each line has a committed batch split');

create or replace function pg_temp.undo_batch_sql(p_key text, p_line text)
returns text
language sql
as $$
  select pg_temp.as_token('hash-fur-one', format(
    $s$select public.mcp_undo_batch(%L, %L)::text$s$,
    p_key, (select batch_key from pg_temp.fur_batch where label = p_line)));
$$;

create or replace function pg_temp.undo_line_sql(p_token text, p_key text, p_line text)
returns text
language sql
as $$
  select pg_temp.as_token(p_token, format(
    $s$select public.mcp_undo(%L, 'line_split', %L::uuid)::text$s$, p_key, pg_temp.id('txn_' || p_line)));
$$;

-- The batch row's code, or ok.
create or replace function pg_temp.row_code(p_response text)
returns text
language sql
as $$
  select coalesce(
    p_response::jsonb -> 'data' -> 'results' -> 0 ->> 'code',
    case when p_response::jsonb -> 'data' -> 'results' -> 0 ->> 'ok' = 'true' then 'ok' end,
    p_response);
$$;

-- 1. mcp_undo on the line first, undo_batch second: the batch waits, then finds its write undone.
select extensions.dblink_exec('fur_b', 'begin');
select * from extensions.dblink('fur_b', pg_temp.undo_line_sql('hash-fur-two', 'fur-u-b1', 'a')) as t(r text);
select extensions.dblink_exec('fur_a', 'begin');
select extensions.dblink_exec('fur_a', $$set local lock_timeout = '10s'$$);
select extensions.dblink_send_query('fur_a', pg_temp.undo_batch_sql('fur-ub-a1', 'a'));
select pg_sleep(0.3);
select is(extensions.dblink_is_busy('fur_a'), 1, 'undo_batch waits for an undo of the same line');
select extensions.dblink_exec('fur_b', 'commit');
select is(
  (select pg_temp.row_code(r) from extensions.dblink_get_result('fur_a') as t(r text)),
  'not_found',
  'then finds the write already undone, without a deadlock'
);
select * from extensions.dblink_get_result('fur_a') as t(r text);
select extensions.dblink_exec('fur_a', 'commit');

-- 2. undo_batch first, mcp_undo on the line second: the undo waits, then has nothing to undo.
select extensions.dblink_exec('fur_a', 'begin');
select * from extensions.dblink('fur_a', pg_temp.undo_batch_sql('fur-ub-a2', 'b')) as t(r text);
select extensions.dblink_exec('fur_b', 'begin');
select extensions.dblink_exec('fur_b', $$set local lock_timeout = '10s'$$);
select extensions.dblink_send_query('fur_b', pg_temp.undo_line_sql('hash-fur-two', 'fur-u-b2', 'b'));
select pg_sleep(0.3);
select is(extensions.dblink_is_busy('fur_b'), 1, 'an undo of the line waits for undo_batch');
select extensions.dblink_exec('fur_a', 'commit');
select is(
  (select (r::jsonb) -> 'error' ->> 'code' from extensions.dblink_get_result('fur_b') as t(r text)),
  'not_found',
  'then finds nothing left to undo, without a deadlock'
);
select * from extensions.dblink_get_result('fur_b') as t(r text);
select extensions.dblink_exec('fur_b', 'commit');
select is(
  (select count(*)::integer from public.line_splits where transaction_id in (pg_temp.id('txn_a'), pg_temp.id('txn_b'))),
  0, 'both lines are back to no split, undone once each');

-- 3. Another token's split_line on the line, not yet committed: undo_batch waits, then sees
-- the newer split and leaves it.
select extensions.dblink_exec('fur_b', 'begin');
select is(
  (select (r::jsonb) ->> 'ok' from extensions.dblink('fur_b', pg_temp.as_token('hash-fur-two', format(
    $s$select public.mcp_split_line(%L, %L::uuid, %L::jsonb)::text$s$,
    'fur-split-b3', pg_temp.id('txn_c'),
    jsonb_build_array(
      jsonb_build_object('category_id', pg_temp.id('repairs'), 'project_id', pg_temp.id('north'), 'amount_minor', 2500),
      jsonb_build_object('category_id', pg_temp.id('supplies'), 'project_id', pg_temp.id('south'), 'amount_minor', 7500)
    )::text))) as t(r text)),
  'true', 'the second token splits the line again');
select extensions.dblink_exec('fur_a', 'begin');
select extensions.dblink_exec('fur_a', $$set local lock_timeout = '10s'$$);
select extensions.dblink_send_query('fur_a', pg_temp.undo_batch_sql('fur-ub-a3', 'c'));
select pg_sleep(0.3);
select is(extensions.dblink_is_busy('fur_a'), 1, 'undo_batch waits for the uncommitted split');
select extensions.dblink_exec('fur_b', 'commit');
select is(
  (select pg_temp.row_code(r) from extensions.dblink_get_result('fur_a') as t(r text)),
  'conflict',
  'then reports a conflict with the newer split'
);
select * from extensions.dblink_get_result('fur_a') as t(r text);
select extensions.dblink_exec('fur_a', 'commit');
select is(
  (select jsonb_agg(amount_minor order by ordinal) from public.line_splits where transaction_id = pg_temp.id('txn_c')),
  '[2500, 7500]'::jsonb, 'and the newer split stays');

select extensions.dblink_exec('fur_a', $cleanup$
  delete from private.mcp_credentials where token_hash in ('hash-fur-one', 'hash-fur-two');
  delete from public.companies where name = 'Example Undo Line Race Co';
  delete from auth.users where id = tests.get_supabase_uid('fur_owner');
$cleanup$);
select extensions.dblink_disconnect('fur_a');
select extensions.dblink_disconnect('fur_b');

select * from finish();

rollback;
