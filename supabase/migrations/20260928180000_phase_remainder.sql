-- Remainder of phases 1, 2, 3, 6 and 7 that the slice left open.
-- Apply after 20260928140000_phase1_slice.sql.
-- Decisions 0051–0056. New functions are not executable until this file grants them.

-- ---------------------------------------------------------------------------
-- Tenancy: membership is the JWT claim source. owner_id stays the RLS key.
-- ---------------------------------------------------------------------------

create table public.company_member (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null,
  role text not null default 'owner' check (role = 'owner'),
  primary key (company_id, user_id)
);

create unique index company_member_user_uidx on public.company_member (user_id);

alter table public.company_member enable row level security;

create policy company_member_read on public.company_member
  for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function private.sync_company_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.company_member (company_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (company_id, user_id) do nothing;
  return new;
end;
$$;

create trigger companies_sync_member
  after insert or update of owner_id on public.companies
  for each row execute function private.sync_company_member();

insert into public.company_member (company_id, user_id, role)
select id, owner_id, 'owner' from public.companies
on conflict (company_id, user_id) do nothing;

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  uid uuid;
  cid uuid;
begin
  begin
    uid := (event ->> 'user_id')::uuid;
  exception
    when invalid_text_representation then
      return event;
  end;
  if uid is null then
    return event;
  end if;
  select m.company_id into cid
  from public.company_member m
  where m.user_id = uid
  limit 1;
  if cid is null then
    claims := claims - 'company_id';
  else
    claims := jsonb_set(claims, '{company_id}', to_jsonb(cid::text));
  end if;
  return jsonb_set(event, '{claims}', claims);
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'Supabase Custom Access Token hook. Adds company_id from company_member. Enable it in Authentication → Hooks. Decision 0051.';

revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
revoke all on function private.sync_company_member() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Dirty months, monthly aggregates, home snapshots.
-- ---------------------------------------------------------------------------

create table public.dirty_month (
  company_id uuid not null references public.companies (id) on delete cascade,
  ym date not null,
  primary key (company_id, ym)
);

create table public.agg_month (
  company_id uuid not null references public.companies (id) on delete cascade,
  ym date not null,
  basis text not null check (basis in ('cash', 'invoiced')),
  income_agorot bigint not null,
  expense_agorot bigint not null,
  net_profit_agorot bigint not null,
  primary key (company_id, ym, basis)
);

create table public.home_snapshot (
  company_id uuid not null references public.companies (id) on delete cascade,
  period_key text not null,
  version bigint not null default 1,
  payload jsonb not null,
  computed_at timestamptz not null default now(),
  primary key (company_id, period_key)
);

alter table public.dirty_month enable row level security;
alter table public.agg_month enable row level security;
alter table public.home_snapshot enable row level security;

create policy dirty_month_owner on public.dirty_month
  for all to authenticated
  using (company_id = (select private.current_company_id()))
  with check (company_id = (select private.current_company_id()));

create policy agg_month_owner on public.agg_month
  for select to authenticated
  using (company_id = (select private.current_company_id()));

create policy home_snapshot_owner on public.home_snapshot
  for select to authenticated
  using (company_id = (select private.current_company_id()));

create or replace function private.mark_transaction_dirty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row public.transactions;
begin
  row := case when tg_op = 'DELETE' then old else new end;
  if not exists (select 1 from public.companies c where c.id = row.company_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  insert into public.dirty_month (company_id, ym)
  values (row.company_id, date_trunc('month', row.doc_date)::date)
  on conflict do nothing;
  if row.cash_date is not null then
    insert into public.dirty_month (company_id, ym)
    values (row.company_id, date_trunc('month', row.cash_date)::date)
    on conflict do nothing;
  end if;
  if tg_op = 'UPDATE' and old.doc_date is distinct from new.doc_date then
    insert into public.dirty_month (company_id, ym)
    values (old.company_id, date_trunc('month', old.doc_date)::date)
    on conflict do nothing;
  end if;
  if tg_op = 'UPDATE' and old.cash_date is distinct from new.cash_date and old.cash_date is not null then
    insert into public.dirty_month (company_id, ym)
    values (old.company_id, date_trunc('month', old.cash_date)::date)
    on conflict do nothing;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger transactions_mark_dirty
  after insert or update or delete on public.transactions
  for each row execute function private.mark_transaction_dirty();

create or replace function private.mark_allocation_dirty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  doc date;
  cash date;
  txn uuid;
begin
  txn := case when tg_op = 'DELETE' then old.transaction_id else new.transaction_id end;
  cid := case when tg_op = 'DELETE' then old.company_id else new.company_id end;
  if not exists (select 1 from public.companies c where c.id = cid) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select t.doc_date, t.cash_date into doc, cash
  from public.transactions t
  where t.id = txn and t.company_id = cid;
  if doc is not null then
    insert into public.dirty_month (company_id, ym)
    values (cid, date_trunc('month', doc)::date)
    on conflict do nothing;
  end if;
  if cash is not null then
    insert into public.dirty_month (company_id, ym)
    values (cid, date_trunc('month', cash)::date)
    on conflict do nothing;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger allocations_mark_dirty
  after insert or update or delete on public.allocations
  for each row execute function private.mark_allocation_dirty();

create or replace function private.write_snapshot(
  p_company_id uuid,
  p_key text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.home_snapshot (company_id, period_key, version, payload)
  values (p_company_id, p_key, 1, p_payload)
  on conflict (company_id, period_key) do update
  set
    version = case
      when public.home_snapshot.payload = excluded.payload then public.home_snapshot.version
      else public.home_snapshot.version + 1
    end,
    payload = excluded.payload,
    computed_at = now();
end;
$$;

create or replace function public.refresh_company_months(
  p_company_id uuid,
  p_months date[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  month_start date;
  month_end date;
  cash jsonb;
  invoiced jsonb;
  today date;
  month_from date;
  last_from date;
  last_to date;
begin
  if p_company_id is null then
    return;
  end if;
  if auth.uid() is not null and not exists (
    select 1 from public.companies c
    where c.id = p_company_id and c.owner_id = (select auth.uid())
  ) then
    raise exception 'forbidden';
  end if;
  if p_months is not null then
    foreach month_start in array p_months loop
      month_start := date_trunc('month', month_start)::date;
      month_end := (month_start + interval '1 month' - interval '1 day')::date;
      cash := public.company_pnl(p_company_id, month_start, month_end, 'cash');
      invoiced := public.company_pnl(p_company_id, month_start, month_end, 'invoiced');
      insert into public.agg_month (
        company_id, ym, basis, income_agorot, expense_agorot, net_profit_agorot
      ) values
        (
          p_company_id, month_start, 'cash',
          (cash ->> 'income_agorot')::bigint,
          (cash ->> 'expense_agorot')::bigint,
          (cash ->> 'net_profit_agorot')::bigint
        ),
        (
          p_company_id, month_start, 'invoiced',
          (invoiced ->> 'income_agorot')::bigint,
          (invoiced ->> 'expense_agorot')::bigint,
          (invoiced ->> 'net_profit_agorot')::bigint
        )
      on conflict (company_id, ym, basis) do update
      set
        income_agorot = excluded.income_agorot,
        expense_agorot = excluded.expense_agorot,
        net_profit_agorot = excluded.net_profit_agorot;
      delete from public.dirty_month
      where company_id = p_company_id and ym = month_start;
    end loop;
  end if;

  today := (now() at time zone 'Asia/Jerusalem')::date;
  month_from := date_trunc('month', today)::date;
  last_from := (month_from - interval '1 month')::date;
  last_to := (month_from - interval '1 day')::date;
  perform private.write_snapshot(
    p_company_id, 'cash:this_month',
    public.company_pnl(p_company_id, month_from, today, 'cash')
  );
  perform private.write_snapshot(
    p_company_id, 'cash:last_month',
    public.company_pnl(p_company_id, last_from, last_to, 'cash')
  );
  perform private.write_snapshot(
    p_company_id, 'cash:all',
    public.company_pnl(p_company_id, null, null, 'cash')
  );
  perform private.write_snapshot(
    p_company_id, 'invoiced:all',
    public.company_pnl(p_company_id, null, null, 'invoiced')
  );
end;
$$;

create or replace function public.refresh_dirty(p_company_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  months date[];
  refreshed integer := 0;
begin
  if p_company_id is not null and auth.uid() is not null and not exists (
    select 1 from public.companies c
    where c.id = p_company_id and c.owner_id = (select auth.uid())
  ) then
    raise exception 'forbidden';
  end if;
  if p_company_id is null and auth.uid() is not null then
    p_company_id := private.current_company_id();
  end if;
  for cid, months in
    select d.company_id, array_agg(d.ym)
    from public.dirty_month d
    where p_company_id is null or d.company_id = p_company_id
    group by d.company_id
    limit 20
  loop
    perform public.refresh_company_months(cid, months);
    refreshed := refreshed + 1;
  end loop;
  return refreshed;
end;
$$;

create or replace function public.read_home_snapshot(p_known jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  cid uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    return '{}'::jsonb;
  end if;
  perform public.refresh_dirty(cid);
  return coalesce((
    select jsonb_object_agg(
      s.period_key,
      case
        when coalesce((p_known ->> s.period_key)::bigint, -1) = s.version
          then jsonb_build_object('unchanged', true, 'version', s.version)
        else jsonb_build_object('unchanged', false, 'version', s.version, 'payload', s.payload)
      end
    )
    from public.home_snapshot s
    where s.company_id = cid
  ), '{}'::jsonb);
end;
$$;

create or replace function public.get_dashboard(
  p_from date default null,
  p_to date default null,
  p_basis text default 'cash'
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  cid uuid;
  payload jsonb;
begin
  select c.id into cid
  from public.companies c
  where c.owner_id = (select auth.uid());
  if cid is null then
    return jsonb_build_object(
      'company_id', null,
      'name', null,
      'vat_registered', true,
      'basis', case when p_basis = 'invoiced' then 'invoiced' else 'cash' end,
      'from', p_from,
      'to', p_to,
      'income_agorot', 0,
      'direct_agorot', 0,
      'shared_agorot', 0,
      'overhead_agorot', 0,
      'expense_agorot', 0,
      'net_profit_agorot', 0,
      'prev_income_agorot', null,
      'prev_expense_agorot', null,
      'prev_net_agorot', null,
      'active_projects', 0,
      'review_count', 0,
      'projects', '[]'::jsonb
    );
  end if;
  perform public.refresh_dirty(cid);
  payload := public.company_pnl(cid, p_from, p_to, p_basis);
  return payload;
end;
$$;

-- ---------------------------------------------------------------------------
-- SUMIT call budget, refresh request, drift note.
-- ---------------------------------------------------------------------------

alter table public.sumit_connections
  add column calls_count integer not null default 0,
  add column calls_month date,
  add column calls_cap integer not null default 100,
  add column drift_fields text,
  add column hook_token uuid not null default gen_random_uuid();

alter table public.sumit_refresh_requests
  add column purpose text not null default 'daily';

create table public.sumit_call_log (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  purpose text not null,
  called_at timestamptz not null default now()
);

alter table public.sumit_call_log enable row level security;

create or replace function public.reserve_sumit_call(
  p_company_id uuid,
  p_purpose text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  cap integer;
  used integer;
  month date;
  ceiling integer;
begin
  if auth.uid() is not null then
    raise exception 'forbidden';
  end if;
  if p_purpose is null or p_purpose not in ('daily', 'weekly', 'app_open', 'pull', 'details', 'connect') then
    raise exception 'unknown purpose';
  end if;
  month := date_trunc('month', (now() at time zone 'Asia/Jerusalem'))::date;
  select
    s.calls_cap,
    case when s.calls_month = month then s.calls_count else 0 end
  into cap, used
  from public.sumit_connections s
  where s.company_id = p_company_id
  for update;
  if not found then
    return false;
  end if;
  ceiling := case
    when p_purpose in ('app_open', 'pull') then 70
    when p_purpose = 'weekly' then 90
    else cap
  end;
  if used >= least(cap, ceiling) then
    return false;
  end if;
  update public.sumit_connections
  set calls_count = used + 1, calls_month = month
  where company_id = p_company_id;
  insert into public.sumit_call_log (company_id, purpose)
  values (p_company_id, p_purpose);
  return true;
end;
$$;

create or replace function public.request_refresh(p_purpose text default 'app_open')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  wanted text;
  last_at timestamptz;
  gap interval;
  used integer;
  cap integer;
  month date;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  wanted := case
    when p_purpose = 'pull' then 'pull'
    when p_purpose = 'weekly' then 'weekly'
    else 'app_open'
  end;
  if not exists (select 1 from public.sumit_connections s where s.company_id = cid) then
    return jsonb_build_object('enqueued', false, 'reason', 'disconnected');
  end if;
  month := date_trunc('month', (now() at time zone 'Asia/Jerusalem'))::date;
  select
    case when s.calls_month = month then s.calls_count else 0 end,
    s.calls_cap
  into used, cap
  from public.sumit_connections s
  where s.company_id = cid;
  if wanted in ('app_open', 'pull') and used >= 70 then
    return jsonb_build_object('enqueued', false, 'reason', 'budget');
  end if;
  if wanted = 'weekly' and used >= 90 then
    return jsonb_build_object('enqueued', false, 'reason', 'budget');
  end if;
  if used >= cap then
    return jsonb_build_object('enqueued', false, 'reason', 'budget');
  end if;
  select max(r.requested_at) into last_at
  from public.sumit_refresh_requests r
  where r.company_id = cid and r.purpose = wanted;
  gap := case when wanted = 'pull' then interval '30 minutes' else interval '6 hours' end;
  if last_at is not null and now() - last_at < gap then
    return jsonb_build_object('enqueued', false, 'reason', 'recent');
  end if;
  insert into public.sumit_refresh_requests (company_id, purpose)
  values (cid, wanted);
  return jsonb_build_object('enqueued', true, 'reason', wanted);
end;
$$;

create or replace function public.sumit_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
begin
  cid := private.current_company_id();
  return coalesce(
    (
      select jsonb_build_object(
        'connected', true,
        'sumit_company_id', s.sumit_company_id,
        'last_sync_at', s.last_sync_at,
        'last_error', s.last_error,
        'drift_fields', s.drift_fields,
        'calls_used', case
          when s.calls_month = date_trunc('month', (now() at time zone 'Asia/Jerusalem'))::date
            then s.calls_count
          else 0
        end,
        'calls_cap', s.calls_cap
      )
      from public.sumit_connections s
      where s.company_id = cid
    ),
    jsonb_build_object(
      'connected', false,
      'sumit_company_id', null,
      'last_sync_at', null,
      'last_error', null,
      'drift_fields', null,
      'calls_used', 0,
      'calls_cap', 100
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Offline ops, export, push, notifications.
-- ---------------------------------------------------------------------------

create table public.applied_op (
  company_id uuid not null references public.companies (id) on delete cascade,
  client_op_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (company_id, client_op_id)
);

alter table public.applied_op enable row level security;

create policy applied_op_read on public.applied_op
  for select to authenticated
  using (company_id = (select private.current_company_id()));

create or replace function private.remember_op(
  p_company_id uuid,
  p_client_op_id uuid,
  p_result jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and p_company_id is distinct from private.current_company_id() then
    raise exception 'forbidden';
  end if;
  insert into public.applied_op (company_id, client_op_id, result)
  values (p_company_id, p_client_op_id, p_result)
  on conflict (company_id, client_op_id) do nothing;
end;
$$;

drop function public.create_manual_entry(text, text, bigint, date, text, uuid, uuid, boolean);

create or replace function public.create_manual_entry(
  p_direction text,
  p_kind text,
  p_gross_agorot bigint,
  p_doc_date date,
  p_description text,
  p_project_id uuid,
  p_category_id uuid,
  p_vat_exempt boolean,
  p_client_op_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cid uuid;
  rate integer;
  net bigint;
  vat bigint;
  kind public.doc_kind;
  role public.pnl_role;
  rid uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  if p_client_op_id is not null then
    select (o.result ->> 'id')::uuid into rid
    from public.applied_op o
    where o.company_id = cid and o.client_op_id = p_client_op_id;
    if rid is not null then
      return rid;
    end if;
  end if;
  if p_direction not in ('income', 'expense') then
    raise exception 'direction must be income or expense';
  end if;
  if p_gross_agorot is null or p_gross_agorot = 0 then
    raise exception 'amount is required';
  end if;
  if p_doc_date is null then
    raise exception 'date is required';
  end if;
  select c.vat_rate_bp into rate from public.companies c where c.id = cid;
  if p_direction = 'expense' and coalesce(p_vat_exempt, false) then
    rate := 0;
  end if;
  if p_direction = 'expense' and p_gross_agorot > 0 then
    p_gross_agorot := -p_gross_agorot;
  end if;
  if p_direction = 'income' and p_gross_agorot < 0 then
    p_gross_agorot := -p_gross_agorot;
  end if;
  net := private.net_from_gross(p_gross_agorot, rate);
  vat := p_gross_agorot - net;
  kind := case
    when p_direction = 'expense' then 'expense'::public.doc_kind
    when p_kind = 'invoice' then 'invoice'::public.doc_kind
    else 'invoice_receipt'::public.doc_kind
  end;
  role := case
    when p_direction = 'income' then null
    when p_project_id is null then 'overhead'::public.pnl_role
    else 'project'::public.pnl_role
  end;
  insert into public.transactions (
    company_id, direction, doc_kind, pnl_role,
    amount_gross, amount_net, vat_amount, vat_status,
    doc_date, cash_date, source, idempotency_key,
    project_id, category_id, description
  ) values (
    cid,
    p_direction::public.txn_direction,
    kind,
    role,
    p_gross_agorot,
    net,
    vat,
    case when rate = 0 and p_direction = 'expense' then 'derived'::public.vat_status else 'assumed'::public.vat_status end,
    p_doc_date,
    case when kind = 'invoice' then null else p_doc_date end,
    'manual',
    case
      when p_client_op_id is null then 'manual:' || gen_random_uuid()::text
      else 'op:' || p_client_op_id::text
    end,
    p_project_id,
    p_category_id,
    btrim(coalesce(p_description, ''))
  )
  returning id into rid;

  if role = 'project' and p_project_id is not null then
    insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
    values (cid, rid, p_project_id, 10000, net);
  end if;
  if role = 'overhead' then
    insert into public.overhead (company_id, transaction_id)
    values (cid, rid);
  end if;
  if p_client_op_id is not null then
    perform private.remember_op(cid, p_client_op_id, jsonb_build_object('id', rid));
  end if;
  return rid;
end;
$$;

create or replace function public.apply_queued_op(
  p_client_op_id uuid,
  p_name text,
  p_args jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cid uuid;
  remembered jsonb;
  rid uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  if p_client_op_id is null then
    raise exception 'client op id is required';
  end if;
  select o.result into remembered
  from public.applied_op o
  where o.company_id = cid and o.client_op_id = p_client_op_id;
  if remembered is not null then
    return remembered;
  end if;
  if p_name = 'create_manual_entry' then
    rid := public.create_manual_entry(
      p_args ->> 'p_direction',
      p_args ->> 'p_kind',
      (p_args ->> 'p_gross_agorot')::bigint,
      (p_args ->> 'p_doc_date')::date,
      p_args ->> 'p_description',
      nullif(p_args ->> 'p_project_id', '')::uuid,
      nullif(p_args ->> 'p_category_id', '')::uuid,
      coalesce((p_args ->> 'p_vat_exempt')::boolean, false),
      p_client_op_id
    );
    return jsonb_build_object('id', rid);
  elsif p_name = 'delete_transaction' then
    perform public.delete_transaction((p_args ->> 'p_id')::uuid);
    perform private.remember_op(cid, p_client_op_id, jsonb_build_object('deleted', p_args ->> 'p_id'));
    return jsonb_build_object('deleted', p_args ->> 'p_id');
  elsif p_name = 'resolve_review' then
    perform public.resolve_review(
      (p_args ->> 'p_id')::uuid,
      p_args ->> 'p_action',
      nullif(p_args ->> 'p_project_id', '')::uuid,
      nullif(p_args ->> 'p_category_id', '')::uuid
    );
    perform private.remember_op(cid, p_client_op_id, jsonb_build_object('resolved', p_args ->> 'p_id'));
    return jsonb_build_object('resolved', p_args ->> 'p_id');
  elsif p_name = 'set_category_hidden' then
    perform public.set_category_hidden(
      (p_args ->> 'p_id')::uuid,
      coalesce((p_args ->> 'p_hidden')::boolean, true)
    );
    perform private.remember_op(cid, p_client_op_id, jsonb_build_object('hidden', p_args ->> 'p_id'));
    return jsonb_build_object('hidden', p_args ->> 'p_id');
  else
    raise exception 'unknown queued op';
  end if;
end;
$$;

create or replace function public.export_ledger(
  p_from date default null,
  p_to date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.doc_date, x.description), '[]'::jsonb)
  from (
    select
      t.doc_date,
      t.direction,
      t.description,
      p.name as project_name,
      c.name as category_name,
      t.amount_net,
      t.vat_amount,
      t.amount_gross
    from public.transactions t
    left join public.projects p on p.id = t.project_id and p.company_id = t.company_id
    left join public.categories c on c.id = t.category_id and c.company_id = t.company_id
    where t.company_id = (select private.current_company_id())
      and (p_from is null or t.doc_date >= p_from)
      and (p_to is null or t.doc_date <= p_to)
    limit 5000
  ) x;
$$;

create table public.push_subscription (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_secret text not null,
  created_at timestamptz not null default now(),
  unique (company_id, endpoint)
);

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null check (kind in ('weekly', 'nudge')),
  title text not null,
  body text not null,
  url text not null,
  local_date date not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'sent', 'gone')),
  unique (company_id, kind, local_date)
);

create table public.rum_sample (
  id bigint generated always as identity primary key,
  company_id uuid references public.companies (id) on delete cascade,
  lcp_ms integer,
  path text,
  created_at timestamptz not null default now()
);

alter table public.push_subscription enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.rum_sample enable row level security;

create or replace function public.register_push(
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  if length(coalesce(p_endpoint, '')) < 12 or length(coalesce(p_p256dh, '')) < 8 then
    raise exception 'subscription is incomplete';
  end if;
  insert into public.push_subscription (company_id, endpoint, p256dh, auth_secret)
  values (cid, p_endpoint, p_p256dh, p_auth)
  on conflict (company_id, endpoint) do update
  set p256dh = excluded.p256dh, auth_secret = excluded.auth_secret;
end;
$$;

create or replace function public.unregister_push(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
begin
  cid := private.current_company_id();
  delete from public.push_subscription
  where company_id = cid and endpoint = p_endpoint;
end;
$$;

create or replace function public.push_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'subscribed', exists (
      select 1 from public.push_subscription p
      where p.company_id = (select private.current_company_id())
    )
  );
$$;

create or replace function public.dispatch_notifications(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  il timestamp;
  dow integer;
  hour integer;
  day_key date;
  week_from date;
  week_to date;
  company record;
  payload jsonb;
  alert text;
  waiting integer;
  minutes integer;
  queued integer := 0;
begin
  if auth.uid() is not null then
    raise exception 'forbidden';
  end if;
  il := p_now at time zone 'Asia/Jerusalem';
  dow := extract(dow from il)::integer;
  hour := extract(hour from il)::integer;
  day_key := il::date;
  if dow = 6 then
    return 0;
  end if;
  if not (dow = 0 and hour = 8) and hour <> 18 then
    return 0;
  end if;
  week_to := day_key - 1;
  week_from := week_to - 6;
  for company in select c.id, c.name from public.companies c loop
    if dow = 0 and hour = 8 then
      payload := public.company_pnl(company.id, week_from, week_to, 'cash');
      select pr.name into alert
      from jsonb_array_elements(coalesce(payload -> 'projects', '[]'::jsonb)) pr_row(value)
      cross join lateral (
        select
          pr_row.value ->> 'name' as name,
          (pr_row.value ->> 'profit_agorot')::bigint as profit
      ) pr
      where pr.profit < 0
      order by pr.profit asc
      limit 1;
      insert into public.notification_outbox (company_id, kind, title, body, url, local_date)
      values (
        company.id,
        'weekly',
        'השבוע ב-Flow',
        'רווח נקי במזומן ' || coalesce(payload ->> 'net_profit_agorot', '0')
          || case when alert is null then '' else '. פרויקט בהפסד: ' || alert end,
        '/',
        day_key
      )
      on conflict (company_id, kind, local_date) do nothing;
      queued := queued + 1;
    end if;
    if hour = 18 then
      select count(*)::integer into waiting
      from public.review_queue q
      where q.company_id = company.id and q.status = 'open';
      if waiting > 0 then
        minutes := waiting;
        insert into public.notification_outbox (company_id, kind, title, body, url, local_date)
        values (
          company.id,
          'nudge',
          'יש מה לאשר',
          waiting::text || ' פריטים ממתינים, בערך ' || minutes::text || ' דקות',
          '/review',
          day_key
        )
        on conflict (company_id, kind, local_date) do nothing;
        queued := queued + 1;
      end if;
    end if;
  end loop;
  return queued;
end;
$$;

create or replace function public.log_rum(p_lcp_ms integer, p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lcp_ms is null or p_lcp_ms < 0 or p_lcp_ms > 60000 then
    return;
  end if;
  insert into public.rum_sample (company_id, lcp_ms, path)
  values (private.current_company_id(), p_lcp_ms, left(coalesce(p_path, '/'), 80));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.mark_transaction_dirty() from public, anon;
revoke all on function private.mark_allocation_dirty() from public, anon;
grant execute on function private.mark_transaction_dirty() to authenticated, service_role;
grant execute on function private.mark_allocation_dirty() to authenticated, service_role;
revoke all on function private.write_snapshot(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function private.remember_op(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function private.remember_op(uuid, uuid, jsonb) to authenticated, service_role;

revoke all on function public.refresh_company_months(uuid, date[]) from public, anon;
revoke all on function public.refresh_dirty(uuid) from public, anon;
revoke all on function public.read_home_snapshot(jsonb) from public, anon;
revoke all on function public.get_dashboard(date, date, text) from public, anon;
revoke all on function public.reserve_sumit_call(uuid, text) from public, anon, authenticated;
revoke all on function public.request_refresh(text) from public, anon;
revoke all on function public.sumit_status() from public, anon;
revoke all on function public.create_manual_entry(text, text, bigint, date, text, uuid, uuid, boolean, uuid) from public, anon;
revoke all on function public.apply_queued_op(uuid, text, jsonb) from public, anon;
revoke all on function public.export_ledger(date, date) from public, anon;
revoke all on function public.register_push(text, text, text) from public, anon;
revoke all on function public.unregister_push(text) from public, anon;
revoke all on function public.push_status() from public, anon;
revoke all on function public.dispatch_notifications(timestamptz) from public, anon, authenticated;
revoke all on function public.log_rum(integer, text) from public, anon;

grant execute on function public.refresh_company_months(uuid, date[]) to authenticated, service_role;
grant execute on function public.refresh_dirty(uuid) to authenticated, service_role;
grant execute on function public.read_home_snapshot(jsonb) to authenticated, service_role;
grant execute on function public.get_dashboard(date, date, text) to authenticated, service_role;
grant execute on function public.reserve_sumit_call(uuid, text) to service_role;
grant execute on function public.request_refresh(text) to authenticated, service_role;
grant execute on function public.sumit_status() to authenticated, service_role;
grant execute on function public.create_manual_entry(text, text, bigint, date, text, uuid, uuid, boolean, uuid) to authenticated, service_role;
grant execute on function public.apply_queued_op(uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.export_ledger(date, date) to authenticated, service_role;
grant execute on function public.register_push(text, text, text) to authenticated, service_role;
grant execute on function public.unregister_push(text) to authenticated, service_role;
grant execute on function public.push_status() to authenticated, service_role;
grant execute on function public.dispatch_notifications(timestamptz) to service_role;
grant execute on function public.log_rum(integer, text) to authenticated, service_role;

grant select on public.company_member to authenticated;
grant select, insert, update, delete on public.dirty_month to authenticated;
grant select on public.agg_month to authenticated;
grant select on public.home_snapshot to authenticated;
grant select on public.applied_op to authenticated;

grant all on public.company_member to service_role;
grant all on public.dirty_month to service_role;
grant all on public.agg_month to service_role;
grant all on public.home_snapshot to service_role;
grant all on public.applied_op to service_role;
grant all on public.sumit_call_log to service_role;
grant all on public.push_subscription to service_role;
grant all on public.notification_outbox to service_role;
grant all on public.rum_sample to service_role;
grant usage, select on sequence public.sumit_call_log_id_seq to service_role;
grant usage, select on sequence public.rum_sample_id_seq to service_role;

revoke all on public.company_member from anon;
revoke insert, update, delete on public.company_member from authenticated;
revoke all on public.dirty_month from anon;
revoke insert, update, delete on public.dirty_month from authenticated;
revoke all on public.agg_month from anon;
revoke insert, update, delete on public.agg_month from authenticated;
revoke all on public.home_snapshot from anon;
revoke insert, update, delete on public.home_snapshot from authenticated;
revoke all on public.applied_op from anon;
revoke insert, update, delete on public.applied_op from authenticated;
revoke all on public.sumit_call_log from anon, authenticated;
revoke all on public.push_subscription from anon, authenticated;
revoke all on public.notification_outbox from anon, authenticated;
revoke all on public.rum_sample from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
  end if;
end;
$$;

-- Daily poll stays at 03:00 UTC. Weekly re-scan is Saturday 21:00 UTC.
-- Notification dispatch is hourly and writes the outbox only. No network.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('flow-sumit-weekly');
    exception when others then null;
    end;
    begin
      perform cron.unschedule('flow-notify-hourly');
    exception when others then null;
    end;
    perform cron.schedule(
      'flow-sumit-weekly',
      '0 21 * * 6',
      $cron$
        insert into public.sumit_refresh_requests (company_id, purpose)
        select s.company_id, 'weekly'
        from public.sumit_connections s
        where not exists (
          select 1 from public.sumit_refresh_requests r
          where r.company_id = s.company_id and r.claimed_at is null
        );
      $cron$
    );
    perform cron.schedule(
      'flow-notify-hourly',
      '5 * * * *',
      $cron$select public.dispatch_notifications(now());$cron$
    );
  end if;
end;
$$;
