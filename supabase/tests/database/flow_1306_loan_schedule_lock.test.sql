-- FLOW-1306 (#1283 review): two writes to one loan's terms in two sessions (dblink) rebuild its schedule one after the
-- other. private.loan_schedule_rebuild locks the loan first (for no key update), so the second waits for the first to
-- commit and then builds from both writes; without the lock it hit loan_schedule_rows_pkey with the first's rows. The
-- fixture is committed by session a and deleted at the end. Fixed dates. @example.com only.

begin;

select plan(7);

create extension if not exists dblink with schema extensions;

-- As in loan_status_lock.test.sql: a superuser socket locally, a password on the CLI database.
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

select is(pg_temp.connect('f1306a'), 'connected', 'session a connects');
select is(pg_temp.connect('f1306b'), 'connected', 'session b connects');

select extensions.dblink_exec('f1306a', $setup$
  delete from public.companies where name = 'Example Schedule Lock Co';
  delete from auth.users where id = tests.get_supabase_uid('f1306_lock');
  select tests.create_supabase_user('f1306_lock', 'lock1306@example.com');
  select tests.fixture_company('f1306_lock', 'Example Schedule Lock Co');
  insert into public.loans (
    company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency
  )
  select id, 'Example Lock Bank', 12000000, 60000, 24, '2026-01-01', 532000, 0, 'USD'
  from public.companies where name = 'Example Schedule Lock Co';
$setup$);

select extensions.dblink_exec(s, $fn$
  create function pg_temp.try(p_sql text) returns text language plpgsql as $body$
  begin
    execute p_sql;
    return 'ok';
  exception when others then
    return sqlstate || ' ' || sqlerrm;
  end;
  $body$;
$fn$) from unnest(array['f1306a', 'f1306b']) s;

create or replace function pg_temp.rate_sql(p_date date, p_ppm integer)
returns text
language sql
as $$
  select format($s$
    insert into public.loan_rates (company_id, loan_id, effective_date, annual_rate_ppm)
    select l.company_id, l.id, %L, %s
    from public.loans l join public.companies c on c.id = l.company_id
    where c.name = 'Example Schedule Lock Co';
  $s$, p_date, p_ppm);
$$;

-- 3. Session b adds a rate and does not commit: the rebuild holds the loan.
select extensions.dblink_exec('f1306b', 'begin');
select is(
  (select r from extensions.dblink('f1306b', format('select pg_temp.try(%L)', pg_temp.rate_sql('2026-07-01', 72000)))
    as t(r text)),
  'ok',
  'session b adds a rate and does not commit yet'
);

-- 4. Session a adds another rate to the same loan: its rebuild waits for b (a lock timeout here).
select extensions.dblink_exec('f1306a', 'begin');
select extensions.dblink_exec('f1306a', $$set local lock_timeout = '300ms'$$);
select matches(
  (select r from extensions.dblink('f1306a', format('select pg_temp.try(%L)', pg_temp.rate_sql('2026-10-01', 48000)))
    as t(r text)),
  '^55P03',
  'session a''s rebuild of the same loan waits for session b'
);
select extensions.dblink_exec('f1306a', 'rollback');

-- 5-7. Without the timeout, a waits, b commits, and a then rebuilds from both rates.
select extensions.dblink_exec('f1306a', 'begin');
select extensions.dblink_send_query('f1306a', format('select pg_temp.try(%L)', pg_temp.rate_sql('2026-10-01', 48000)));
select pg_sleep(0.3);
select extensions.dblink_exec('f1306b', 'commit');
select is(
  (select r from extensions.dblink_get_result('f1306a') as t(r text)),
  'ok',
  'session a''s write goes through once b commits (no duplicate schedule row)'
);
select * from extensions.dblink_get_result('f1306a') as t(r text);
select extensions.dblink_exec('f1306a', 'commit');

select is(
  (select r from extensions.dblink('f1306a', $q$
    select (
      select coalesce(jsonb_agg(jsonb_build_object(
        'period', s.period, 'dueDate', to_char(s.due_date, 'YYYY-MM-DD'), 'interestMinor', s.interest_minor,
        'escrowMinor', s.escrow_minor, 'principalMinor', s.principal_minor, 'paymentMinor', s.payment_minor,
        'balanceMinor', s.balance_minor) order by s.period), '[]')
      from public.loan_schedule_rows s where s.loan_id = l.id
    ) = private.loan_schedule(jsonb_build_object(
      'principalMinor', 12000000, 'annualRatePpm', 60000, 'termMonths', 24, 'startDate', '2026-01-01',
      'paymentMinor', 532000, 'escrowMinor', 0,
      'rates', '[{"effectiveDate": "2026-07-01", "annualRatePpm": 72000},
                 {"effectiveDate": "2026-10-01", "annualRatePpm": 48000}]'::jsonb
    )) -> 'rows'
    from public.loans l join public.companies c on c.id = l.company_id
    where c.name = 'Example Schedule Lock Co'
  $q$) as t(r boolean)),
  true,
  'the committed rows are the schedule with both rates'
);
select is(
  (select r from extensions.dblink('f1306a', $q$
    select m.state from public.loan_schedule_meta m join public.loans l on l.id = m.loan_id
    join public.companies c on c.id = l.company_id where c.name = 'Example Schedule Lock Co'
  $q$) as t(r text)),
  'built',
  'the meta row is the second build''s'
);

select extensions.dblink_exec('f1306a', $cleanup$
  delete from public.companies where name = 'Example Schedule Lock Co';
  delete from auth.users where id = tests.get_supabase_uid('f1306_lock');
$cleanup$);
select extensions.dblink_disconnect('f1306a');
select extensions.dblink_disconnect('f1306b');

select * from finish();

rollback;
