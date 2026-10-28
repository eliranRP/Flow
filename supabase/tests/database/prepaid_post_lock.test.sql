-- FLOW-155 (#852 review): the daily prepaid run skips a month another session holds, and posts it on
-- the next run; a company with a posted month is deleted whole. Two real sessions (dblink); the fixture
-- is committed by session a and deleted at the end. Invented data only, @example.com.

begin;

select plan(6);

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

select is(pg_temp.connect('pp155a'), 'connected', 'session a connects');
select is(pg_temp.connect('pp155b'), 'connected', 'session b connects');

-- A schedule of two months from this month: the first is due, nothing posted yet.
select extensions.dblink_exec('pp155a', $setup$
  delete from public.companies where name = 'Example Prepaid Lock Co';
  delete from auth.users where id = tests.get_supabase_uid('pp155_lock');
  select tests.create_supabase_user('pp155_lock', 'lock155@example.com');
  do $fx$
  declare
    co uuid := tests.fixture_company('pp155_lock', 'Example Prepaid Lock Co');
    cat uuid := tests.fixture_category(co, 'Example insurance', 'expense');
    acct uuid;
    line uuid;
    sid uuid;
  begin
    insert into public.accounts (company_id, name, type, excluded_from_pnl) values (co, 'Prepaid expenses', 'asset', true)
    returning id into acct;
    line := tests.fixture_line(co, 'pp155:lock', 20000, 'expense', null, private.ledger_mirror_category(co, acct, true), current_date);
    insert into public.prepaid_schedules (company_id, transaction_id, prepaid_account_id, prepaid_category_id,
      expense_category_id, currency, total_minor, start_month, months, day_of_month, description, prior)
    values (co, line, acct, private.ledger_mirror_category(co, acct, true), cat, 'ILS', 20000,
      date_trunc('month', current_date)::date, 2, 1, 'Example Insurance Co policy', '{}')
    returning id into sid;
    perform private.prepaid_respread(co, sid);
  end
  $fx$;
$setup$);

create or replace function pg_temp.first_posted()
returns boolean
language sql
as $$
  select r from extensions.dblink('pp155a', $q$
    select r.entry_id is not null from public.prepaid_rows r
    join public.companies c on c.id = r.company_id
    where c.name = 'Example Prepaid Lock Co' and r.seq = 1
  $q$) as t(r boolean);
$$;

-- Session b holds the due month; session a's run skips it without waiting.
select extensions.dblink_exec('pp155b', 'begin');
select extensions.dblink_exec('pp155b', $hold$
  do $h$ begin
    perform 1 from public.prepaid_rows r join public.companies c on c.id = r.company_id
    where c.name = 'Example Prepaid Lock Co' and r.seq = 1 for update of r;
  end $h$
$hold$);
select extensions.dblink_exec('pp155a', $$set lock_timeout = '2s'$$);
select * from extensions.dblink('pp155a', 'select private.prepaid_post_due()') as t(n integer);
select is(pg_temp.first_posted(), false, 'the run skips the month another session holds');
select extensions.dblink_exec('pp155b', 'rollback');
select * from extensions.dblink('pp155a', 'select private.prepaid_post_due()') as t(n integer);
select is(pg_temp.first_posted(), true, 'and the next run posts it');

-- The company goes with its schedule, its posted month and its lines.
select extensions.dblink_exec('pp155a', $cleanup$
  delete from public.companies where name = 'Example Prepaid Lock Co';
$cleanup$);
select is((select r from extensions.dblink('pp155a', $q$
  select count(*)::integer from public.prepaid_schedules s
  where not exists (select 1 from public.companies c where c.id = s.company_id)
$q$) as t(r integer)), 0, 'deleting the company removes its schedule');
select is((select r from extensions.dblink('pp155a', $q$
  select count(*)::integer from public.companies where name = 'Example Prepaid Lock Co'
$q$) as t(r integer)), 0, 'and the company is gone');
select extensions.dblink_exec('pp155a', $cleanup$
  delete from auth.users where id = tests.get_supabase_uid('pp155_lock');
$cleanup$);
select extensions.dblink_disconnect('pp155a');
select extensions.dblink_disconnect('pp155b');

select * from finish();

rollback;
