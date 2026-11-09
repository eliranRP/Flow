-- FLOW-1122: the owner (or an editor) refreshes the US Treasury yields by hand (decision 0263).
--
-- refresh_treasury_yields() posts mercury-sync with {"kind":"treasury-yields"}, as the flow-treasury-yields
-- job does, at most once every five minutes for everyone (private.treasury_refresh keeps the last ask).
-- The yields are public market data, so nothing of a company changes and there is nothing to undo;
-- MCP refresh_treasury_yields takes an idempotency key and the write rate limit. get_member_report
-- also returns treasury_fetched_at and treasury_requested_at, for the report's "updated" line.

begin;

create table private.treasury_refresh (
  id boolean primary key default true check (id),
  requested_at timestamptz not null
);
alter table private.treasury_refresh enable row level security;
revoke all on private.treasury_refresh from public, anon, authenticated;
grant select, insert, update on private.treasury_refresh to service_role;
comment on table private.treasury_refresh is
  'FLOW-1122: when the Treasury yields were last asked for by hand (one row).';

create function public.refresh_treasury_yields()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  last timestamptz;
  secret text;
  sync_url text;
begin
  cid := private.current_company_id();
  if cid is null then
    if private.readable_company_id() is not null then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  select r.requested_at into last from private.treasury_refresh r where r.id for update;
  if last is not null and last > now() - interval '5 minutes' then
    return jsonb_build_object('requested', false, 'reason', 'recent', 'requested_at', last);
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return jsonb_build_object('requested', false, 'reason', 'unavailable');
  end if;
  begin
    execute $sql$ select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1 $sql$ into secret;
    execute $sql$ select decrypted_secret from vault.decrypted_secrets where name = 'flow_sync_url' limit 1 $sql$ into sync_url;
  exception
    when undefined_table or invalid_schema_name then
      secret := null;
      sync_url := null;
  end;
  if secret is null or btrim(secret) = '' or sync_url is null or position('/sumit-sync' in sync_url) = 0 then
    return jsonb_build_object('requested', false, 'reason', 'unavailable');
  end if;
  execute $sql$
    select net.http_post(
      url := $1,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-flow-cron', $2),
      body := '{"kind":"treasury-yields"}'::jsonb
    )
  $sql$ using replace(sync_url, '/sumit-sync', '/mercury-sync'), secret;
  insert into private.treasury_refresh as r (id, requested_at) values (true, now())
  on conflict (id) do update set requested_at = excluded.requested_at;
  return jsonb_build_object('requested', true, 'requested_at', now());
end;
$$;
revoke all on function public.refresh_treasury_yields() from public, anon, authenticated, service_role;
grant execute on function public.refresh_treasury_yields() to authenticated;
comment on function public.refresh_treasury_yields() is
  'FLOW-1122: asks for the US Treasury yields now (owner or editor), at most once every five minutes. Decision 0263.';

create function public.mcp_refresh_treasury_yields(p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate jsonb;
  token uuid;
  prior jsonb;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
  then
    return private.mcp_error('validation', 'validation');
  end if;
  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, 'treasury_refresh');
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;
  begin
    response := jsonb_build_object('ok', true, 'data', public.refresh_treasury_yields());
  exception
    when others then
      response := private.mcp_refused(sqlerrm);
  end;
  perform private.mcp_idempotency_store(token, p_idempotency_key, 'treasury_refresh', response);
  return response;
end;
$$;
revoke all on function public.mcp_refresh_treasury_yields(text) from public, anon, authenticated, service_role;
grant execute on function public.mcp_refresh_treasury_yields(text) to authenticated;

create or replace function public.get_member_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  cfg jsonb;
  props jsonb;
  yields jsonb;
  since date;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select r.config into cfg from public.member_reports r where r.company_id = cid;
  select coalesce(jsonb_agg(jsonb_build_object(
      'project_id', p.id,
      'name', p.name,
      'currency', p.investment_currency,
      'value_minor', p.value_minor,
      'value_date', p.value_date,
      'selling_cost_bp', p.selling_cost_bp,
      'loan_balance_minor', coalesce((
        select sum(b.balance_minor)
        from public.loans l
        join public.loan_balances b on b.company_id = l.company_id and b.loan_id = l.id
        where l.company_id = cid and l.project_id = p.id
          and l.status = 'open'::public.loan_status and l.currency = p.investment_currency), 0)::bigint,
      'loans_other_currency', exists (
        select 1
        from public.loans l
        join public.loan_balances b on b.company_id = l.company_id and b.loan_id = l.id
        where l.company_id = cid and l.project_id = p.id
          and l.status = 'open'::public.loan_status and l.currency <> p.investment_currency
          and b.balance_minor <> 0)
    ) order by p.name), '[]'::jsonb)
  into props
  from public.projects p
  join public.companies c on c.id = p.company_id
  where p.company_id = cid
    and p.status = 'active'::public.project_status
    and p.id is distinct from c.overhead_project_id
    and (p.value_minor is not null or exists (
      select 1 from public.loans l
      where l.company_id = cid and l.project_id = p.id and l.status = 'open'::public.loan_status));
  -- FLOW-1119: the Treasury's yields from two weeks before the earliest date the report needs.
  select least(current_date, (
    select min(d) from (
      select (q->>'quoted_on')::date as d from jsonb_array_elements(coalesce(cfg->'quotes', '[]'::jsonb)) q
      union all select (cfg->>'quote_date')::date
    ) x)) - 14
  into since;
  select coalesce(jsonb_agg(jsonb_build_object('on_date', t.on_date, 'y5_ppm', t.y5_ppm, 'y10_ppm', t.y10_ppm)
    order by t.on_date), '[]'::jsonb)
  into yields
  from public.treasury_yields t
  where t.on_date between since and current_date;
  return jsonb_build_object(
    'config', cfg,
    'properties', props,
    'treasury_yields', yields,
    -- FLOW-1122: when the Treasury's yields were last stored, and last asked for by hand.
    'treasury_fetched_at', (select max(t.fetched_at) from public.treasury_yields t),
    'treasury_requested_at', (select r.requested_at from private.treasury_refresh r where r.id),
    'can_edit', private.owner_company_id() is not distinct from cid
  );
end;
$$;

commit;
