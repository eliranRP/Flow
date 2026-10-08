-- FLOW-702 (app part): the owner can store mode auto, so Settings can turn Jev's auto fill on.
-- The job already fills only in auto (decisions 0084 and 0145); until now the check and the RPC
-- refused it. A viewer still cannot write (private.current_company_id() is null for a viewer).

alter table public.company_integrations
  drop constraint company_integrations_mode_chk;

alter table public.company_integrations
  add constraint company_integrations_mode_chk check (mode in ('off', 'shadow', 'auto'));

comment on column public.company_integrations.mode is
  'off, shadow, or auto. Either enabled false or mode off disables the connector. Decision 0084.';

create or replace function public.set_company_integration(
  p_enabled boolean,
  p_mode text default null,
  p_threshold numeric default null,
  p_provider text default 'jev'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  stored public.company_integrations%rowtype;
  next_mode text;
  next_threshold numeric;
begin
  if p_enabled is null or p_provider is distinct from 'jev' then
    raise exception 'validation';
  end if;
  if p_mode is not null and p_mode not in ('off', 'shadow', 'auto') then
    raise exception 'validation';
  end if;
  if p_threshold is not null and (p_threshold < 0.50 or p_threshold > 1) then
    raise exception 'validation';
  end if;

  cid := private.current_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into stored
  from public.company_integrations
  where company_id = cid and provider = p_provider;

  next_mode := coalesce(p_mode, stored.mode, 'shadow');
  next_threshold := coalesce(p_threshold, stored.threshold, 0.90);

  insert into public.company_integrations (company_id, provider, enabled, mode, threshold)
  values (cid, p_provider, p_enabled, next_mode, next_threshold)
  on conflict (company_id, provider) do update
    set enabled = excluded.enabled,
        mode = excluded.mode,
        threshold = excluded.threshold
  returning * into stored;

  return jsonb_build_object(
    'company_id', stored.company_id,
    'provider', stored.provider,
    'enabled', stored.enabled,
    'mode', stored.mode,
    'threshold', stored.threshold
  );
end;
$$;

revoke all on function public.set_company_integration(boolean, text, numeric, text) from public, anon;
grant execute on function public.set_company_integration(boolean, text, numeric, text) to authenticated;

comment on function public.set_company_integration(boolean, text, numeric, text) is
  'Member write for company_integrations. The company is private.current_company_id(). auto is allowed. Decision 0084.';
