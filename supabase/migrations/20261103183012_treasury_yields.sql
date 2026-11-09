-- FLOW-1119: the US Treasury's daily 5 and 10 year yields, fetched every day, for the member share
-- report's expected rate (decision 0263).
--
-- public.treasury_yields holds the Treasury's published par yields by date, one table for every company
-- (public market data). The flow-treasury-yields job posts mercury-sync with {"kind":"treasury-yields"}
-- every four hours; the function reads last year's and this year's CSV and stores them with
-- store_treasury_yields (service role only). get_member_report returns them as treasury_yields; a yield
-- the owner typed in the company's setting wins over them for its date and tenor.

begin;

create table public.treasury_yields (
  on_date date primary key,
  y5_ppm integer check (y5_ppm is null or y5_ppm between 0 and 200000),
  y10_ppm integer check (y10_ppm is null or y10_ppm between 0 and 200000),
  fetched_at timestamptz not null default now(),
  check (y5_ppm is not null or y10_ppm is not null)
);
comment on table public.treasury_yields is
  'FLOW-1119: the US Treasury daily par yield curve, 5 and 10 years, in parts per million, by date. Public market data, written by the flow-treasury-yields job only.';

alter table public.treasury_yields enable row level security;
create policy treasury_yields_select on public.treasury_yields
  for select to authenticated
  using (true);
revoke all on public.treasury_yields from public, anon, authenticated;
grant select on public.treasury_yields to authenticated;
grant select, insert, update, delete on public.treasury_yields to service_role;

-- Stores the job's rows (service role only): a day's yields are replaced by the newest fetch, and a
-- tenor the fetch left empty keeps the stored one. Returns how many rows it wrote.
create function public.store_treasury_yields(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  written integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'validation';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) r
    where not private.json_date(r->'on_date')
      or (r ? 'y5_ppm' and jsonb_typeof(r->'y5_ppm') <> 'null' and not private.json_int_between(r->'y5_ppm', 0, 200000))
      or (r ? 'y10_ppm' and jsonb_typeof(r->'y10_ppm') <> 'null' and not private.json_int_between(r->'y10_ppm', 0, 200000))
      or (jsonb_typeof(coalesce(r->'y5_ppm', 'null'::jsonb)) = 'null' and jsonb_typeof(coalesce(r->'y10_ppm', 'null'::jsonb)) = 'null')
  ) then
    raise exception 'validation';
  end if;
  insert into public.treasury_yields as t (on_date, y5_ppm, y10_ppm, fetched_at)
  select distinct on ((r->>'on_date')::date)
    (r->>'on_date')::date, (r->>'y5_ppm')::integer, (r->>'y10_ppm')::integer, now()
  from jsonb_array_elements(p_rows) r
  order by (r->>'on_date')::date
  on conflict (on_date) do update set
    y5_ppm = coalesce(excluded.y5_ppm, t.y5_ppm),
    y10_ppm = coalesce(excluded.y10_ppm, t.y10_ppm),
    fetched_at = excluded.fetched_at;
  get diagnostics written = row_count;
  return written;
end;
$$;
revoke all on function public.store_treasury_yields(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.store_treasury_yields(jsonb) to service_role;
comment on function public.store_treasury_yields(jsonb) is
  'FLOW-1119: stores the US Treasury daily yields the flow-treasury-yields job fetched (service role only).';

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
    'can_edit', private.owner_company_id() is not distinct from cid
  );
end;
$$;
comment on function public.get_member_report() is
  'The member share report''s inputs: the setting (or null), each property''s value, selling cost and open loan balance, and the Treasury''s fetched yields. Decision 0263.';

-- flow-treasury-yields every four hours, posting mercury-sync (as flow-thread-files-purge does).
create function private.schedule_treasury_yields()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
  sync_url text;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
    or not exists (select 1 from pg_extension where extname = 'pg_net')
  then
    raise notice 'flow-treasury-yields skipped: pg_cron or pg_net is missing';
    return;
  end if;
  if exists (select 1 from cron.job j where j.jobname = 'flow-treasury-yields') then
    perform cron.unschedule('flow-treasury-yields');
  end if;
  begin
    execute $sql$
      select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1
    $sql$ into secret;
    execute $sql$
      select decrypted_secret from vault.decrypted_secrets where name = 'flow_sync_url' limit 1
    $sql$ into sync_url;
  exception
    when undefined_table or invalid_schema_name then
      secret := null;
      sync_url := null;
  end;
  if secret is null or btrim(secret) = '' or sync_url is null or position('/sumit-sync' in sync_url) = 0 then
    raise notice 'flow-treasury-yields skipped: cron_secret or flow_sync_url is missing';
    return;
  end if;

  perform cron.schedule(
    'flow-treasury-yields',
    '41 */4 * * *',
    $cron$
      select net.http_post(
        url := (
          select replace(decrypted_secret, '/sumit-sync', '/mercury-sync')
          from vault.decrypted_secrets
          where name = 'flow_sync_url'
          limit 1
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-flow-cron', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'cron_secret'
            limit 1
          )
        ),
        body := '{"kind":"treasury-yields"}'::jsonb
      )
      where exists (select 1 from public.member_reports);
    $cron$
  );
end;
$$;
revoke all on function private.schedule_treasury_yields() from public, anon, authenticated;
grant execute on function private.schedule_treasury_yields() to service_role;

do $schedule$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform private.schedule_treasury_yields();
end
$schedule$;

commit;
