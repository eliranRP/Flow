-- FLOW-130: a lock timeout in an MCP write returns unavailable / retry like a deadlock and is
-- not stored under the idempotency key, so a retry with the same key runs again. In a batch
-- the timed-out row reads code unavailable.
-- A test-only trigger raises the lock timeout. Invented data only. @example.com only.

begin;

select plan(9);

select tests.create_supabase_user('ml_owner', 'ml-owner@example.com');

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('ml_owner'), 'Example Lock Retry LLC', false);

create temp table ml (label text primary key, id uuid);
grant all on ml to authenticated, service_role;

insert into ml (label, id)
select 'co', id from public.companies where name = 'Example Lock Retry LLC';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (
  tests.get_supabase_uid('ml_owner'), (select id from ml where label = 'co'),
  'hash-ml-write', 'pepper-1', array['read','write'], now() + interval '90 days'
);
insert into ml (label, id)
select 'write', id from private.mcp_credentials where token_hash = 'hash-ml-write';

-- Every MCP write that stores its response catches a lock timeout with the deadlock handler,
-- so none of them sends it to `when others`. Each `when ... then` clause that names a deadlock
-- or a serialization failure also names lock_not_available, in any order.
select is_empty(
  $$
    select p.proname::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'mcp\_%'
      and p.prosrc like '%mcp_idempotency_store%'
      and p.prosrc like '%when others%'
      and (
        p.prosrc not like '%lock_not_available%'
        or exists (
          select 1
          from regexp_matches(p.prosrc, 'when\s+(\w+(?:\s+or\s+\w+)*)\s+then', 'gi') m
          where m[1] ~* '(deadlock_detected|serialization_failure)'
            and m[1] !~* 'lock_not_available'
        )
      )
  $$,
  'every MCP write with an idempotency key handles a lock timeout as retry'
);

-- Test-only: raise a lock timeout on a category insert while ml.fail is set.
create function public.ml_fail_category_insert()
returns trigger
language plpgsql
as $$
begin
  if current_setting('ml.fail', true) = '55P03' then
    raise exception 'ml test lock timeout' using errcode = 'lock_not_available';
  end if;
  return new;
end;
$$;
create trigger ml_fail_category_insert
  before insert on public.categories
  for each row execute function public.ml_fail_category_insert();

create or replace function pg_temp.as_writer(p_fail text)
returns void
language plpgsql
as $$
declare
  uid uuid := tests.get_supabase_uid('ml_owner');
begin
  perform set_config('ml.fail', p_fail, true);
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', uid, 'role', 'authenticated', 'aal', 'aal1',
      'mcp_tid', (select id from pg_temp.ml where label = 'write')
    )::text,
    true
  );
end;
$$;

create or replace function pg_temp.create_category(p_key text, p_fail text)
returns jsonb
language plpgsql
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_writer(p_fail);
  result := public.mcp_create_category(p_key, 'Lock retry supplies', 'expense');
  perform set_config('ml.fail', '', true);
  return result;
end;
$$;

create or replace function pg_temp.create_categories(p_key text, p_fail text)
returns jsonb
language plpgsql
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_writer(p_fail);
  result := public.mcp_create_categories(
    p_key, '[{"name": "Lock retry batch", "kind": "expense"}]'::jsonb
  );
  perform set_config('ml.fail', '', true);
  return result;
end;
$$;

select is(
  pg_temp.create_category('ml-cat', '55P03')->'error',
  '{"code": "unavailable", "message": "retry"}'::jsonb,
  'a lock timeout in create_category returns unavailable'
);
reset role;
select is(
  (select count(*)::int from public.categories
   where company_id = (select id from ml where label = 'co') and name = 'Lock retry supplies'),
  0,
  'the timed-out create_category added no category'
);

select is(
  pg_temp.create_category('ml-cat', '')->>'ok',
  'true',
  'a retry with the timed-out key runs again'
);
reset role;
select is(
  (select count(*)::int from public.categories
   where company_id = (select id from ml where label = 'co') and name = 'Lock retry supplies'),
  1,
  'the retried create_category added the category'
);

select is(
  pg_temp.create_categories('ml-batch', '55P03')->'data'->'results'->0->>'code',
  'unavailable',
  'a lock timeout in a create_categories row reads unavailable'
);
reset role;

-- The test above times out inside mcp_create_category's own handler. Time out the row's
-- idempotency store instead: that is outside the row's handler, so only the batch handler
-- in mcp_create_categories turns it into unavailable.
create function public.ml_fail_row_store()
returns trigger
language plpgsql
as $$
begin
  if new.idempotency_key = current_setting('ml.fail_store', true) then
    raise exception 'ml test lock timeout' using errcode = 'lock_not_available';
  end if;
  return new;
end;
$$;
create trigger ml_fail_row_store
  before insert on private.mcp_idempotency
  for each row execute function public.ml_fail_row_store();

create or replace function pg_temp.create_categories_store_fail(p_key text)
returns jsonb
language plpgsql
as $$
declare
  result jsonb;
begin
  perform set_config('ml.fail_store', p_key || ':1', true);
  perform pg_temp.as_writer('');
  result := public.mcp_create_categories(
    p_key, '[{"name": "Lock retry store", "kind": "expense"}]'::jsonb
  );
  perform set_config('ml.fail_store', '', true);
  return result;
end;
$$;

select is(
  pg_temp.create_categories_store_fail('ml-batch-3')->'data'->'results'->0->>'code',
  'unavailable',
  'a lock timeout outside the row handler reads unavailable in the create_categories row'
);
reset role;
select is(
  (select count(*)::int from public.categories
   where company_id = (select id from ml where label = 'co') and name = 'Lock retry store'),
  0,
  'the timed-out batch row added no category'
);

-- Positive control: the same batch with a new key and no lock timeout adds the row.
select is(
  pg_temp.create_categories('ml-batch-2', '')->'data'->'results'->0->>'ok',
  'true',
  'positive control: the batch row is added without a lock timeout'
);
reset role;

select * from finish();

rollback;
