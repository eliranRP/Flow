-- FLOW-106 part 1 (#132 review): closing a loan and splitting a payment on it run one
-- after the other (decision 0122), with two real sessions (dblink). The fixture is
-- committed by session a and deleted at the end. Fixed dates. @example.com only.

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

select is(pg_temp.connect('f106a'), 'connected', 'session a connects');
select is(pg_temp.connect('f106b'), 'connected', 'session b connects');

select extensions.dblink_exec('f106a', $setup$
  delete from public.companies where name = 'Example Close Lock Co';
  delete from auth.users where id = tests.get_supabase_uid('f106_lock');
  select tests.create_supabase_user('f106_lock', 'lock106@example.com');
  select tests.authenticate_as('f106_lock');
  select public.create_company('Example Close Lock Co', true);
  reset role;
  insert into public.loans (
    company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency
  )
  select id, 'Example Close Bank', 10000000, 60000, 360, '2026-01-01', 100000, 10000, 'USD'
  from public.companies where name = 'Example Close Lock Co';
  insert into public.transactions (
    company_id, direction, doc_kind, line_status, amount_gross, amount_net, amount_original,
    vat_amount, vat_status, doc_date, currency, source, idempotency_key, description
  )
  select c.id, 'expense', 'expense', 'posted', -100000, -100000, 100000, 0, 'unknown',
    '2026-02-01', 'USD', 'manual', v.key, 'Example loan payment'
  from public.companies c
  cross join (values ('f106lock:one'), ('f106lock:two')) as v(key)
  where c.name = 'Example Close Lock Co';
$setup$);

select extensions.dblink_exec('f106b', $fn$
  create function pg_temp.try(p_sql text) returns text language plpgsql as $body$
  begin
    execute p_sql;
    return 'ok';
  exception when others then
    return sqlstate || ' ' || sqlerrm;
  end;
  $body$;
$fn$);
select extensions.dblink_exec('f106a', $fn$
  create function pg_temp.try(p_sql text) returns text language plpgsql as $body$
  begin
    execute p_sql;
    return 'ok';
  exception when others then
    return sqlstate || ' ' || sqlerrm;
  end;
  $body$;
$fn$);

-- The app split of one line, dated 2026-02-01, with the deferred checks run now.
create or replace function pg_temp.split_sql(p_key text)
returns text
language sql
as $$
  select format($s$
    insert into public.loan_splits (company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id)
    select t.company_id, l.id, t.id, v.part::public.loan_split_part, v.amount, v.amount, c.id
    from public.transactions t
    join public.loans l on l.company_id = t.company_id
    cross join (values ('interest', 0::bigint), ('escrow', 0::bigint), ('principal', 100000::bigint)) as v(part, amount)
    join public.categories c
      on c.company_id = t.company_id and c.loan_part = v.part::public.loan_split_part and c.kind = 'expense'
    where t.idempotency_key = %L;
    set constraints all immediate;
  $s$, p_key);
$$;

create or replace function pg_temp.close_sql()
returns text
language sql
as $$
  select $s$
    update public.loans l set status = 'paid_off', closed_on = '2026-01-15'
    from public.companies c
    where c.id = l.company_id and c.name = 'Example Close Lock Co';
  $s$;
$$;

-- 3-4. A split that is not committed yet holds the loan, so a close waits for it.
select extensions.dblink_exec('f106b', 'begin');
select is(
  (select r from extensions.dblink('f106b', format('select pg_temp.try(%L)', pg_temp.split_sql('f106lock:one'))) as t(r text)),
  'ok',
  'session b splits a payment and does not commit yet'
);
select extensions.dblink_exec('f106a', 'begin');
select extensions.dblink_exec('f106a', $$set local lock_timeout = '300ms'$$);
select matches(
  (select r from extensions.dblink('f106a', format('select pg_temp.try(%L)', pg_temp.close_sql())) as t(r text)),
  '^55P03',
  'closing the loan waits for that split (lock timeout here)'
);
select extensions.dblink_exec('f106a', 'rollback');
select extensions.dblink_exec('f106b', 'rollback');

-- 5-6. A close that is not committed yet makes a split wait, and the split then sees it.
select extensions.dblink_exec('f106a', 'begin');
select is(
  (select r from extensions.dblink('f106a', format('select pg_temp.try(%L)', pg_temp.close_sql())) as t(r text)),
  'ok',
  'session a closes the loan on 2026-01-15 and does not commit yet'
);
select extensions.dblink_exec('f106b', 'begin');
select extensions.dblink_send_query('f106b', format('select pg_temp.try(%L)', pg_temp.split_sql('f106lock:two')));
select pg_sleep(0.3);
select extensions.dblink_exec('f106a', 'commit');
select matches(
  (select r from extensions.dblink_get_result('f106b') as t(r text)),
  '^23514 loan_closed',
  'the waiting split then reads the close and is refused'
);
select * from extensions.dblink_get_result('f106b') as t(r text);
select extensions.dblink_exec('f106b', 'rollback');

select extensions.dblink_exec('f106a', $cleanup$
  delete from public.companies where name = 'Example Close Lock Co';
  delete from auth.users where id = tests.get_supabase_uid('f106_lock');
$cleanup$);
select extensions.dblink_disconnect('f106a');
select extensions.dblink_disconnect('f106b');

select * from finish();

rollback;
