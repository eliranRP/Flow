-- FLOW-205: two undos of one MCP write run one after the other (the mcp_writes row lock),
-- with two real sessions (dblink). The fixture is committed by session a and deleted at the
-- end; a failed run leaves it until the next run's setup deletes it by name. @example.com only.

begin;

select plan(5);

create extension if not exists dblink with schema extensions;

-- As in loan_lock_order.test.sql: a superuser socket locally, a password on the CLI database.
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

select is(pg_temp.connect('mur_a'), 'connected', 'session a connects');
select is(pg_temp.connect('mur_b'), 'connected', 'session b connects');

select extensions.dblink_exec('mur_a', $setup$
  do $d$
  begin
    delete from public.companies where name = 'Example Undo Race Co';
    delete from auth.users where id = tests.get_supabase_uid('mur_owner');
    perform tests.create_supabase_user('mur_owner', 'mur-owner@example.com');
    perform tests.authenticate_as('mur_owner');
    perform public.create_company('Example Undo Race Co', true);
    reset role;
    perform public.store_mcp_credential(
      tests.get_supabase_uid('mur_owner'), 'hash-mur-write-01', array['read','write'], now() + interval '90 days', 'pepper-1'
    );
  end
  $d$;
$setup$);

-- Each session acts as the MCP token in its own transaction.
select extensions.dblink_exec(s, $fn$
  create function pg_temp.mcp(p_sql text) returns text language plpgsql as $body$
  declare
    uid uuid := tests.get_supabase_uid('mur_owner');
    tid uuid := (select id from private.mcp_credentials where token_hash = 'hash-mur-write-01');
    result text;
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', uid::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object(
      'sub', uid, 'role', 'authenticated',
      'mcp_tid', tid)::text, true);
    execute p_sql into result;
    reset role;
    return result;
  exception when others then
    return sqlstate || ' ' || sqlerrm;
  end;
  $body$;
$fn$)
from unnest(array['mur_a', 'mur_b']) s;

-- Two projects made through MCP and committed.
select extensions.dblink_exec('mur_a', 'begin');
select * from extensions.dblink('mur_a', $$select pg_temp.mcp($s$select public.mcp_create_project('mur-p1', 'Example Race One')::text$s$)$$) as t(r text);
select * from extensions.dblink('mur_a', $$select pg_temp.mcp($s$select public.mcp_create_project('mur-p2', 'Example Race Two')::text$s$)$$) as t(r text);
select extensions.dblink_exec('mur_a', 'commit');

create or replace function pg_temp.undo_sql(p_key text, p_project text)
returns text
language sql
as $$
  select format(
    $q$select pg_temp.mcp(%L)$q$,
    format($s$select r->>'ok' || ' ' || coalesce(r->'error'->>'code', '')
      from (select public.mcp_undo(%L, 'project', (select id from public.projects where name = %L)) as r) u$s$,
      p_key, p_project));
$$;

-- 3. While session b's undo is not committed, session a's undo of the same write waits.
select extensions.dblink_exec('mur_b', 'begin');
select * from extensions.dblink('mur_b', pg_temp.undo_sql('mur-u-b1', 'Example Race One')) as t(r text);
select extensions.dblink_exec('mur_a', 'begin');
select extensions.dblink_exec('mur_a', $$set local lock_timeout = '300ms'$$);
select is(
  (select r from extensions.dblink('mur_a', pg_temp.undo_sql('mur-u-a1', 'Example Race One')) as t(r text)),
  'false unavailable',
  'a second undo of the same write waits for the first (retry when it times out)'
);
select extensions.dblink_exec('mur_a', 'rollback');
select extensions.dblink_exec('mur_b', 'rollback');

-- 4-5. Once the first undo commits, the waiting one finds the write already undone.
select extensions.dblink_exec('mur_b', 'begin');
select * from extensions.dblink('mur_b', pg_temp.undo_sql('mur-u-b2', 'Example Race Two')) as t(r text);
select extensions.dblink_exec('mur_a', 'begin');
select extensions.dblink_send_query('mur_a', pg_temp.undo_sql('mur-u-a2', 'Example Race Two'));
select pg_sleep(0.3);
select is(extensions.dblink_is_busy('mur_a'), 1, 'session a waits for session b');
select extensions.dblink_exec('mur_b', 'commit');
select is(
  (select r from extensions.dblink_get_result('mur_a') as t(r text)),
  'false not_found',
  'then finds the write already undone, and removes nothing twice'
);
select * from extensions.dblink_get_result('mur_a') as t(r text);
select extensions.dblink_exec('mur_a', 'rollback');

select extensions.dblink_exec('mur_a', $cleanup$
  delete from public.companies where name = 'Example Undo Race Co';
  delete from auth.users where id = tests.get_supabase_uid('mur_owner');
$cleanup$);
select extensions.dblink_disconnect('mur_a');
select extensions.dblink_disconnect('mur_b');

select * from finish();

rollback;
