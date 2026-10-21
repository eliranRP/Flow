-- FLOW-940 (decision 0204): a new company starts with Jev on, in auto (מילוי אוטומטי), at 90%.
-- create_company is the only way a user makes a company (20261004020000 revoked the direct insert),
-- so it writes the company's jev row in the same transaction: enabled true, mode auto, threshold
-- 0.90, the default daily call cap. on conflict do nothing, so it never overwrites a row.
-- Everything else in create_company is its 20261013175142_team_members.sql body, unchanged.
-- Existing companies are not touched: no row is inserted or updated for them, so a company with no
-- row is still off, and the owner can still turn Jev off or to shadow (set_company_integration, MCP
-- set_jev_mode). Auto still never approves a line (decisions 0084 and 0145).
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
  uid uuid := auth.uid();
  cid uuid;
  clean text;
  problem text;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if exists (
    select 1 from public.company_viewers v
    where v.user_id = uid
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  clean := private.trim_name(p_name);
  problem := private.company_name_problem(clean);
  if problem is not null then
    raise exception '%', problem;
  end if;
  -- One create at a time per user, so two taps cannot both pass the name check.
  perform pg_advisory_xact_lock(hashtextextended('create_company:' || uid::text, 0));
  if exists (select 1 from public.companies where owner_id = uid and name = clean) then
    raise exception 'company already exists';
  end if;
  insert into public.companies (owner_id, name, vat_registered, vat_rate_bp)
  values (
    uid,
    clean,
    coalesce(p_vat_registered, true),
    case when coalesce(p_vat_registered, true) then 1800 else 0 end
  )
  returning id into cid;
  -- Decision 0204: a new company starts with Jev on, auto, 90%.
  insert into public.company_integrations (company_id, provider, enabled, mode, threshold)
  values (cid, 'jev', true, 'auto', 0.90)
  on conflict (company_id, provider) do nothing;
  insert into public.active_companies (user_id, company_id)
  values (uid, cid)
  on conflict (user_id) do update set company_id = excluded.company_id, updated_at = now();
  return cid;
end;
$$;

revoke all on function public.create_company(text, boolean) from public, anon;
grant execute on function public.create_company(text, boolean) to authenticated, service_role;

comment on table public.company_integrations is
  'Optional connectors. A missing row is off. create_company writes a new company''s jev row on, auto, 0.90 (decision 0204); a company made before that has no row until a member saves one. Decision 0083.';

commit;
