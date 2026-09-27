-- Test helpers installed by `supabase db start` (see config.toml seed paths)
-- and by scripts/pgtap-local.sh. They are not part of the hosted migration.
-- Written here so CI does not depend on the basejump extension being preinstalled.
-- auth.uid() reads request.jwt.claim.sub and request.jwt.claims.
--
-- Do not load this file on the hosted project. `supabase db push --include-seed`
-- and `supabase db reset --linked` would install tests.create_supabase_user,
-- a definer that inserts into auth.users. The tests schema is not in api.schemas.

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
