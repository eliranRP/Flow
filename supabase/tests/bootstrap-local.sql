-- Quiet the membership notices on a second run of this file.
set client_min_messages to warning;

-- Local stand-in for the pieces `supabase db start` provides before migrations.
-- scripts/pgtap-local.sh loads this first. CI does not: the pgtap job uses
-- the Supabase CLI, which already has these roles and the auth schema.
-- pgTAP itself is created later, in helpers.sql, after the migration.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant anon, authenticated, service_role to postgres;

create schema if not exists auth;
create schema if not exists extensions;

create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key default gen_random_uuid(),
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  confirmation_token text,
  recovery_token text,
  email_change text,
  email_change_token_new text
);

revoke all on table auth.users from public, anon, authenticated;
grant select, insert, update, delete on table auth.users to service_role;

-- auth.uid() reads the same settings the test helpers set.
-- An empty claims string is not valid jsonb, so it is ignored.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select (
    case
      when coalesce(current_setting('request.jwt.claim.sub', true), '') <> ''
        then current_setting('request.jwt.claim.sub', true)
      when coalesce(current_setting('request.jwt.claims', true), '') <> ''
        then current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
      else null
    end
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to public, anon, authenticated, service_role;

grant usage on schema extensions to public, anon, authenticated, service_role;

-- Supabase grants these before the first migration. Without them, the
-- migration's revoke all / default-privilege revoke removes nothing, and
-- "anon cannot read" still passes if those lines are deleted.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;
