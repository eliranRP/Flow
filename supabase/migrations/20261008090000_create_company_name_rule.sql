-- FLOW-606: create_company follows the FLOW-604 company-name rule.
-- It trimmed spaces only, had no 100-character limit and took control
-- characters, and the FLOW-604 trigger checks updates, not inserts. Such a
-- name could then never be restored by an MCP `undo` of a later rename.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function public.create_company(p_name text, p_vat_registered boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  clean text;
  problem text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if exists (
    select 1 from public.company_viewers v
    where v.user_id = (select auth.uid())
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  clean := private.trim_name(p_name);
  problem := private.company_name_problem(clean);
  if problem is not null then
    raise exception '%', problem;
  end if;
  if exists (select 1 from public.companies where owner_id = (select auth.uid())) then
    raise exception 'company already exists';
  end if;
  insert into public.companies (owner_id, name, vat_registered, vat_rate_bp)
  values (
    (select auth.uid()),
    clean,
    coalesce(p_vat_registered, true),
    case when coalesce(p_vat_registered, true) then 1800 else 0 end
  )
  returning id into cid;
  return cid;
end;
$$;

commit;
