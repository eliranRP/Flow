-- FLOW-131: the loan lock order of decision 0121, with two real sessions (dblink).
-- Session a stands for the MCP attach, which holds the loan row. Session b is the app
-- split and the bank sync. The app split waits for the loan; the sync never waits and
-- flags the parts instead. The fixture is committed by session a and deleted at the end.
-- Fixed dates. @example.com only.

begin;

select plan(9);

create extension if not exists dblink with schema extensions;

-- Local runs connect as a superuser over the socket. On the Supabase CLI database the
-- postgres role is not a superuser, so dblink needs a password the server asks for:
-- 127.0.0.1 is trust there, the container's own address (the one pg_prove came in on)
-- asks for it.
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

select is(pg_temp.connect('f131a'), 'connected', 'session a connects');
select is(pg_temp.connect('f131b'), 'connected', 'session b connects');

-- A run that stopped half way may have left the fixture behind.
select extensions.dblink_exec('f131a', $setup$
  delete from public.companies where name = 'Example Lock Co';
  delete from auth.users where id = tests.get_supabase_uid('f131_lock');
  select tests.create_supabase_user('f131_lock', 'lock131@example.com');
  select tests.authenticate_as('f131_lock');
  select public.create_company('Example Lock Co', true);
  reset role;
  insert into public.loans (
    company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency
  )
  select id, 'Example Lock Bank', 10000000, 60000, 360, '2026-01-01', 100000, 10000, 'USD'
  from public.companies where name = 'Example Lock Co';
  insert into public.transactions (
    company_id, direction, doc_kind, line_status, amount_gross, amount_net, amount_original,
    vat_amount, vat_status, doc_date, currency, source, idempotency_key, description
  )
  select c.id, 'expense', 'expense', v.status::public.line_status, -100000, -100000, 100000, 0, 'unknown',
    '2026-02-01', 'USD', 'manual', v.key, 'Example loan payment'
  from public.companies c
  cross join (values ('f131lock:app', 'posted'), ('f131lock:sync', 'pending'), ('f131lock:free', 'pending')) as v(key, status)
  where c.name = 'Example Lock Co';
  insert into public.loan_splits (company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id)
  select t.company_id, l.id, t.id, v.part::public.loan_split_part, v.amount, v.amount, c.id
  from public.transactions t
  join public.loans l on l.company_id = t.company_id
  cross join (values
    ('interest', 'ריבית משכנתא', 0::bigint),
    ('escrow', 'מסים וביטוח', 0::bigint),
    ('principal', 'תשלומי הלוואה', 100000::bigint)
  ) as v(part, category, amount)
  join public.categories c on c.company_id = t.company_id and c.name = v.category and c.kind = 'expense'
  where t.idempotency_key in ('f131lock:sync', 'f131lock:free');
$setup$);

-- Session b runs each step and reports the SQLSTATE it ends with, or ok.
select extensions.dblink_exec('f131b', $fn$
  create function pg_temp.try(p_sql text) returns text language plpgsql as $body$
  begin
    execute p_sql;
    return 'ok';
  exception when others then
    return sqlstate;
  end;
  $body$;
$fn$);

create or replace function pg_temp.b(p_sql text)
returns text
language sql
as $$
  select r from extensions.dblink('f131b', format('select pg_temp.try(%L)', p_sql)) as t(r text);
$$;

create or replace function pg_temp.b_flagged(p_key text)
returns bigint
language sql
as $$
  select n from extensions.dblink('f131b', format(
    'select count(*) from public.loan_splits s join public.transactions t on t.id = s.transaction_id
     where t.idempotency_key = %L and s.needs_review', p_key
  )) as t(n bigint);
$$;

-- The app split of a posted line: insert the parts and run the deferred checks now.
create or replace function pg_temp.app_split_sql()
returns text
language sql
as $$
  select $s$
    insert into public.loan_splits (company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id)
    select t.company_id, l.id, t.id, v.part::public.loan_split_part, v.amount, v.amount, c.id
    from public.transactions t
    join public.loans l on l.company_id = t.company_id
    cross join (values
      ('interest', 'ריבית משכנתא', 0::bigint),
      ('escrow', 'מסים וביטוח', 0::bigint),
      ('principal', 'תשלומי הלוואה', 100000::bigint)
    ) as v(part, category, amount)
    join public.categories c on c.company_id = t.company_id and c.name = v.category and c.kind = 'expense'
    where t.idempotency_key = 'f131lock:app';
    set constraints all immediate;
  $s$;
$$;

-- Session a holds the loan as another app split's balance check does (for no key update).
-- Not for update: that also blocks the key-share lock the loan_splits foreign key takes,
-- so the app split below would time out on the insert even with no lock in the check.
select extensions.dblink_exec('f131a', 'begin');
select extensions.dblink_exec('f131a', $$
  do $lock$
  begin
    perform 1 from public.loans l
    join public.companies c on c.id = l.company_id
    where c.name = 'Example Lock Co'
    for no key update of l;
  end
  $lock$
$$);

select extensions.dblink_exec('f131b', 'begin');
select extensions.dblink_exec('f131b', $$set local lock_timeout = '300ms'$$);

select is(
  pg_temp.b(pg_temp.app_split_sql()),
  '55P03',
  'an app split waits for the loan another session holds (lock timeout here)'
);
select is(
  pg_temp.b($$update public.transactions set line_status = 'posted' where idempotency_key = 'f131lock:sync'$$),
  'ok',
  'the bank sync posts a split line without waiting for the loan'
);
select is(
  pg_temp.b_flagged('f131lock:sync'),
  3::bigint,
  'and flags its parts for review, though the payment fits the balance'
);

select extensions.dblink_exec('f131a', 'rollback');

select is(
  pg_temp.b($$update public.transactions set line_status = 'posted' where idempotency_key = 'f131lock:free'$$),
  'ok',
  'once the loan is free, the sync posts the next line'
);
select is(pg_temp.b_flagged('f131lock:free'), 0::bigint, 'and a line that fits is not flagged');
select is(pg_temp.b(pg_temp.app_split_sql()), 'ok', 'and the app split passes');
select is(pg_temp.b_flagged('f131lock:app'), 0::bigint, 'with nothing flagged');

select extensions.dblink_exec('f131b', 'rollback');

select extensions.dblink_exec('f131a', $cleanup$
  delete from public.companies where name = 'Example Lock Co';
  delete from auth.users where id = tests.get_supabase_uid('f131_lock');
$cleanup$);
select extensions.dblink_disconnect('f131a');
select extensions.dblink_disconnect('f131b');

select * from finish();

rollback;
