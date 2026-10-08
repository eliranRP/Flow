-- FLOW-106 part 2 (review): a loan part filed under a category and a flip of that
-- category's P&L side run one after the other (decision 0128), with two real sessions
-- (dblink). The fixture is committed by session a and deleted at the end.
-- Fixed dates. @example.com only.

begin;

select plan(7);

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

select is(pg_temp.connect('f127a'), 'connected', 'session a connects');
select is(pg_temp.connect('f127b'), 'connected', 'session b connects');

select extensions.dblink_exec('f127a', $setup$
  delete from public.companies where name = 'Example Category Lock Co';
  delete from auth.users where id = tests.get_supabase_uid('f127_lock');
  select tests.create_supabase_user('f127_lock', 'lock127@example.com');
  select tests.authenticate_as('f127_lock');
  select public.create_company('Example Category Lock Co', true);
  reset role;
  insert into public.loans (
    company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency
  )
  select id, 'Example Category Bank', 10000000, 60000, 360, '2026-01-01', 100000, 10000, 'USD'
  from public.companies where name = 'Example Category Lock Co';
  insert into public.categories (company_id, name, kind, sort_order)
  select id, 'Example lock interest', 'expense', 900
  from public.companies where name = 'Example Category Lock Co';
  insert into public.transactions (
    company_id, direction, doc_kind, line_status, amount_gross, amount_net, amount_original,
    vat_amount, vat_status, doc_date, currency, source, idempotency_key, description
  )
  select c.id, 'expense', 'expense', 'posted', -100000, -100000, 100000, 0, 'unknown',
    '2026-02-01', 'USD', 'manual', 'f127lock:one', 'Example loan payment'
  from public.companies c
  where c.name = 'Example Category Lock Co';
$setup$);

select extensions.dblink_exec('f127a', $fn$
  create function pg_temp.try(p_sql text) returns text language plpgsql as $body$
  begin
    execute p_sql;
    return 'ok';
  exception when others then
    return sqlstate || ' ' || sqlerrm;
  end;
  $body$;
$fn$);
select extensions.dblink_exec('f127b', $fn$
  create function pg_temp.try(p_sql text) returns text language plpgsql as $body$
  begin
    execute p_sql;
    return 'ok';
  exception when others then
    return sqlstate || ' ' || sqlerrm;
  end;
  $body$;
$fn$);

create or replace function pg_temp.run(p_conn text, p_sql text)
returns text
language sql
as $$
  select r from extensions.dblink(p_conn, format('select pg_temp.try(%L)', p_sql)) as t(r text);
$$;

-- Keep the category out of the P&L, as set_category_pnl does.
create or replace function pg_temp.flip_sql()
returns text
language sql
as $$
  select $s$
    update public.categories c set excluded_from_pnl = true
    from public.companies co
    where co.id = c.company_id and co.name = 'Example Category Lock Co' and c.name = 'Example lock interest';
  $s$;
$$;

-- The loan names the category for its interest.
create or replace function pg_temp.name_sql()
returns text
language sql
as $$
  select $s$
    update public.loans l set interest_category_id = c.id
    from public.categories c
    join public.companies co on co.id = c.company_id
    where co.name = 'Example Category Lock Co' and c.name = 'Example lock interest' and l.company_id = co.id;
  $s$;
$$;

-- The app files the line's interest under the category, with the deferred checks run now.
create or replace function pg_temp.split_sql()
returns text
language sql
as $$
  select $s$
    insert into public.loan_splits (company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id)
    select t.company_id, l.id, t.id, v.part::public.loan_split_part, v.amount, v.amount,
      case when v.part = 'interest' then mine.id else c.id end
    from public.transactions t
    join public.loans l on l.company_id = t.company_id
    join public.categories mine on mine.company_id = t.company_id and mine.name = 'Example lock interest'
    cross join (values ('interest', 50000::bigint), ('escrow', 10000::bigint), ('principal', 40000::bigint)) as v(part, amount)
    join public.categories c
      on c.company_id = t.company_id and c.loan_part = v.part::public.loan_split_part and c.kind = 'expense'
    where t.idempotency_key = 'f127lock:one';
    set constraints all immediate;
  $s$;
$$;

-- 3. A flip that is not committed yet makes a loan naming the category wait.
select extensions.dblink_exec('f127a', 'begin');
select pg_temp.run('f127a', pg_temp.flip_sql()) = 'ok' as flipped;
select extensions.dblink_exec('f127b', 'begin');
select extensions.dblink_exec('f127b', $$set local lock_timeout = '300ms'$$);
select matches(pg_temp.run('f127b', pg_temp.name_sql()), '^55P03', 'naming the category waits for the flip (lock timeout here)');
select extensions.dblink_exec('f127b', 'rollback');

-- 4. And so does a split filing interest under it.
select extensions.dblink_exec('f127b', 'begin');
select extensions.dblink_exec('f127b', $$set local lock_timeout = '300ms'$$);
select matches(pg_temp.run('f127b', pg_temp.split_sql()), '^55P03', 'filing interest under it waits for the flip too');
select extensions.dblink_exec('f127b', 'rollback');
select extensions.dblink_exec('f127a', 'rollback');

-- 5. A loan naming the category, not committed yet, makes a flip wait; the flip then sees it.
select extensions.dblink_exec('f127b', 'begin');
select is(pg_temp.run('f127b', pg_temp.name_sql()), 'ok', 'session b names the category and does not commit yet');
select extensions.dblink_exec('f127a', 'begin');
select extensions.dblink_send_query('f127a', format('select pg_temp.try(%L)', pg_temp.flip_sql()));
select pg_sleep(0.3);
select extensions.dblink_exec('f127b', 'commit');
select matches(
  (select r from extensions.dblink_get_result('f127a') as t(r text)),
  '^23514 loan category is fixed',
  'the waiting flip then reads the loan and is refused'
);
select * from extensions.dblink_get_result('f127a') as t(r text);
select extensions.dblink_exec('f127a', 'rollback');

-- 7. The category kept its side.
select is(
  (select r from extensions.dblink('f127a', $q$
     select c.excluded_from_pnl::text from public.categories c
     join public.companies co on co.id = c.company_id
     where co.name = 'Example Category Lock Co' and c.name = 'Example lock interest'
   $q$) as t(r text)),
  'false',
  'the category is still counted in the P&L'
);

select extensions.dblink_exec('f127a', $cleanup$
  delete from public.companies where name = 'Example Category Lock Co';
  delete from auth.users where id = tests.get_supabase_uid('f127_lock');
$cleanup$);
select extensions.dblink_disconnect('f127a');
select extensions.dblink_disconnect('f127b');

select * from finish();

rollback;
