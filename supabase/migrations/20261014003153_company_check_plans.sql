-- Company checks keep their query plans. private.company_role, private.active_company_for and
-- private.readable_company_id were SQL functions with SECURITY DEFINER and SET search_path, so
-- Postgres could not inline them and planned their queries again on every call. Row security
-- calls private.readable_company_id once per table a query reads, so get_project paid for
-- about 200 fresh plans per request. As plpgsql functions their plans are cached for the
-- connection. The queries inside are exactly as in 20261013175142_team_members.sql.

create or replace function private.active_company_for(p_user uuid, p_hint uuid default null)
returns uuid
language plpgsql
stable security definer
set search_path = ''
as $$
begin
  return (
    select coalesce(
      (select p_hint where private.company_role(p_hint, p_user) is not null),
      (
        select a.company_id from public.active_companies a
        where a.user_id = p_user and private.company_role(a.company_id, p_user) is not null
      ),
      (
        select c.id from public.companies c
        where c.owner_id = p_user
        order by c.created_at, c.id
        limit 1
      ),
      (
        select m.company_id from public.company_members m
        where m.user_id = p_user
        order by m.created_at, m.company_id
        limit 1
      )
    )
  );
end;
$$;

create or replace function private.company_role(p_company uuid, p_user uuid)
returns text
language plpgsql
stable security definer
set search_path = ''
as $$
begin
  return (
    select case
      when p_company is null or p_user is null then null
      when exists (
        select 1 from public.companies c where c.id = p_company and c.owner_id = p_user
      ) then 'owner'
      else (
        select m.role from public.company_members m
        where m.company_id = p_company and m.user_id = p_user
      )
    end
  );
end;
$$;

create or replace function private.readable_company_id()
returns uuid
language plpgsql
stable security definer
set search_path = ''
as $$
begin
  return (
    select coalesce(
      private.active_company(),
      (
        select v.company_id
        from public.company_viewers v
        join public.companies c on c.id = v.company_id
        where v.user_id = (select auth.uid())
          and c.is_demo
      )
    )
  );
end;
$$;
