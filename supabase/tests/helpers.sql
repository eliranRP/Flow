-- Test helpers installed by `supabase db start` (see config.toml seed paths)
-- and by scripts/pgtap-local.sh. They are not part of the hosted migration.
-- Written here so CI does not depend on the basejump extension being preinstalled.
-- auth.uid() reads request.jwt.claim.sub and request.jwt.claims.
--
-- Do not load this file on the hosted project. `supabase db push --include-seed`
-- and `supabase db reset --linked` would install tests.create_supabase_user,
-- a definer that inserts into auth.users. The tests schema is not in api.schemas.
--
-- Load this after the migration. The migration revokes default EXECUTE from
-- PUBLIC with no schema limit, and `supabase test db` creates pgTAP only
-- after that. Creating the extension here, then granting execute on pgTAP's
-- own functions, is what lets anon and authenticated call is() and throws_ok().

set client_min_messages to warning;

create schema if not exists extensions;

create extension if not exists pgtap with schema extensions;

grant usage on schema extensions to anon, authenticated, service_role;

-- Only pgTAP. Other extensions in this schema stay ungranted.
do $pgtap_grant$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_depend d on d.objid = p.oid and d.deptype = 'e'
    join pg_extension e on e.oid = d.refobjid
    where e.extname = 'pgtap'
  loop
    execute format('grant execute on function %s to anon, authenticated', fn);
  end loop;
end
$pgtap_grant$;

create schema if not exists tests;

revoke all on schema tests from public, anon, authenticated;

create or replace function tests.create_supabase_user(identifier text, email text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_id uuid;
  user_email text;
begin
  user_id := gen_random_uuid();
  user_email := coalesce(email, identifier || '@test.flow');
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change,
    email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000',
    user_id,
    'authenticated',
    'authenticated',
    user_email,
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('test_identifier', identifier),
    now(),
    now(),
    '',
    '',
    '',
    ''
  );
  return user_id;
end;
$$;

create or replace function tests.get_supabase_uid(identifier text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
  from auth.users
  where raw_user_meta_data ->> 'test_identifier' = identifier
$$;

-- SECURITY INVOKER on purpose. Postgres rejects SET ROLE / set_config('role')
-- inside a SECURITY DEFINER function (42501, GUC_NOT_WHILE_SEC_REST).
create or replace function tests.authenticate_as(identifier text)
returns void
language plpgsql
as $$
declare
  uid uuid;
begin
  uid := tests.get_supabase_uid(identifier);
  if uid is null then
    raise exception 'User with identifier % not found', identifier;
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', uid,
      'role', 'authenticated',
      'aal', 'aal1'
    )::text,
    true
  );
end;
$$;

create or replace function tests.clear_authentication()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

revoke all on all functions in schema tests from public, anon, authenticated;
grant usage on schema tests to postgres, service_role, anon, authenticated;
grant execute on all functions in schema tests to postgres, service_role;
-- Switching helpers must stay callable after set_config('role', ...).
-- create_supabase_user stays postgres-only: it inserts into auth.users.
grant execute on function tests.authenticate_as(text) to anon, authenticated;
grant execute on function tests.clear_authentication() to anon, authenticated;
grant execute on function tests.get_supabase_uid(text) to anon, authenticated;

-- Shared invented fixtures (FLOW-808), so a test does not re-create the same company, project,
-- category and line inserts. Call them as postgres, before tests.authenticate_as. Each returns
-- the new row's id. Use invented names and @example.com emails only.

-- A company owned by a test user made with tests.create_supabase_user. The insert trigger adds
-- the default categories, including interest, escrow and principal (one per loan_part). A viewer
-- (company_viewers) needs p_demo true.
create or replace function tests.fixture_company(p_owner text, p_name text, p_demo boolean default false)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  owner uuid;
  company uuid;
begin
  owner := tests.get_supabase_uid(p_owner);
  if owner is null then
    raise exception 'User with identifier % not found', p_owner;
  end if;
  insert into public.companies (owner_id, name, is_demo)
  values (owner, p_name, p_demo)
  returning id into company;
  return company;
end;
$$;

create or replace function tests.fixture_project(p_company uuid, p_name text, p_status text default 'active')
returns uuid
language sql
set search_path = ''
as $$
  insert into public.projects (company_id, name, status)
  values (p_company, p_name, p_status::public.project_status)
  returning id;
$$;

-- A category after the company's last one. p_excluded keeps it out of the P&L.
create or replace function tests.fixture_category(
  p_company uuid,
  p_name text,
  p_kind text default 'expense',
  p_excluded boolean default false
)
returns uuid
language sql
set search_path = ''
as $$
  insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
  values (
    p_company, p_name, p_kind::public.category_kind,
    coalesce((select max(c.sort_order) + 1 from public.categories c where c.company_id = p_company), 1),
    false, p_excluded
  )
  returning id;
$$;

-- One ledger line. p_key is both its idempotency key and its description. p_amount is the
-- size in minor units; an expense is stored negative, income positive. The line is paid
-- (cash date = doc date), has no VAT, and is filed by the owner unless p_suggested, which
-- leaves the category a guess (set after the insert: the insert trigger clears it). A Mercury
-- line must be USD.
create or replace function tests.fixture_line(
  p_company uuid,
  p_key text,
  p_amount bigint,
  p_direction text default 'expense',
  p_project uuid default null,
  p_category uuid default null,
  p_doc_date date default '2026-06-10',
  p_currency text default 'ILS',
  p_line_status text default 'posted',
  p_source text default 'manual',
  p_pnl_role text default 'project',
  p_doc_kind text default 'receipt',
  p_suggested boolean default false
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  line uuid;
  signed bigint;
begin
  signed := case when p_direction = 'expense' then -abs(p_amount) else abs(p_amount) end;
  insert into public.transactions (
    company_id, direction, doc_kind, line_status, currency,
    amount_gross, amount_net, amount_original, vat_amount, vat_status,
    doc_date, cash_date, source, idempotency_key, project_id, category_id, description,
    user_assigned, category_assigned, category_suggested, pnl_role
  )
  values (
    p_company, p_direction::public.txn_direction, p_doc_kind::public.doc_kind,
    p_line_status::public.line_status, p_currency,
    signed, signed, abs(p_amount), 0, 'source',
    p_doc_date, p_doc_date, p_source::public.txn_source, p_key, p_project, p_category, p_key,
    not p_suggested, not p_suggested, false, p_pnl_role::public.pnl_role
  )
  returning id into line;
  if p_suggested then
    update public.transactions set category_suggested = true where id = line;
  end if;
  return line;
end;
$$;

-- Fixtures write as postgres only, like create_supabase_user.
revoke all on function tests.fixture_company(text, text, boolean) from public, anon, authenticated;
revoke all on function tests.fixture_project(uuid, text, text) from public, anon, authenticated;
revoke all on function tests.fixture_category(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function tests.fixture_line(uuid, text, bigint, text, uuid, uuid, date, text, text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function tests.fixture_company(text, text, boolean) to postgres, service_role;
grant execute on function tests.fixture_project(uuid, text, text) to postgres, service_role;
grant execute on function tests.fixture_category(uuid, text, text, boolean) to postgres, service_role;
grant execute on function tests.fixture_line(uuid, text, bigint, text, uuid, uuid, date, text, text, text, text, text, boolean)
  to postgres, service_role;
