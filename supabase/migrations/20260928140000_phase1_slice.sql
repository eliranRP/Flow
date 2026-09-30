-- Phase 1 slice: onboarding, dashboard P&L, review, manual entry, SUMIT status.
-- Apply after 20260928080538_schema_v1.sql.
-- New functions are not executable until this file grants them.
-- Decision 0047 cash basis is the default. 0043 VAT. 0049 SUMIT refresh queue.

alter table public.companies
  add column vat_registered boolean not null default true;

comment on column public.companies.vat_registered is
  'Onboarding VAT mode. True is עוסק מורשה (vat_rate_bp 1800). False is עוסק פטור (vat_rate_bp 0).';

alter table public.sumit_connections
  add column last_sync_at timestamptz,
  add column last_error text;

create or replace view public.sumit_connection_status
with (security_invoker = true) as
select
  company_id,
  sumit_company_id,
  true as connected,
  last_sync_at,
  last_error
from public.sumit_connections;

comment on view public.sumit_connection_status is
  'Owner-visible SUMIT status. Ciphertext is not selected.';

-- Due rows only. The browser never reads this. sumit-sync claims them.
create table public.sumit_refresh_requests (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  requested_at timestamptz not null default now(),
  claimed_at timestamptz
);

create index sumit_refresh_open_idx
  on public.sumit_refresh_requests (company_id)
  where claimed_at is null;

alter table public.sumit_refresh_requests enable row level security;

comment on table public.sumit_refresh_requests is
  'Daily poll marker. No policy for authenticated: the service role writes and claims. Decision 0049.';

-- ---------------------------------------------------------------------------
-- Money. Same half-even rule as packages/shared netFromGrossAgorot.
-- ---------------------------------------------------------------------------

create or replace function private.net_from_gross(p_gross bigint, p_rate_bp integer)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  negative boolean;
  abs_gross bigint;
  denom bigint;
  net bigint;
  remainder bigint;
begin
  if p_rate_bp is null or p_rate_bp < 0 or p_rate_bp > 10000 then
    raise exception 'VAT rate is out of range';
  end if;
  if p_rate_bp = 0 or p_gross = 0 then
    return p_gross;
  end if;
  negative := p_gross < 0;
  abs_gross := abs(p_gross);
  denom := 10000 + p_rate_bp;
  net := (abs_gross * 10000) / denom;
  remainder := (abs_gross * 10000) % denom;
  if remainder * 2 > denom or (remainder * 2 = denom and net % 2 = 1) then
    net := net + 1;
  end if;
  if negative then
    return -net;
  end if;
  return net;
end;
$$;

revoke all on function private.net_from_gross(bigint, integer) from public, anon;
grant execute on function private.net_from_gross(bigint, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Onboarding. One company per owner. Existing owners skip this screen.
-- ---------------------------------------------------------------------------

create or replace function public.create_company(p_name text, p_vat_registered boolean)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cid uuid;
  clean text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  clean := btrim(coalesce(p_name, ''));
  if char_length(clean) < 2 then
    raise exception 'company name is too short';
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

revoke all on function public.create_company(text, boolean) from public, anon;
grant execute on function public.create_company(text, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- P&L. Expenses are stored negative. Costs in the payload are positive.
-- Null dates mean the whole ledger (the golden check). Decision 0047.
-- ---------------------------------------------------------------------------

create or replace function public.company_pnl(
  p_company_id uuid,
  p_from date,
  p_to date,
  p_basis text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  basis text;
  result jsonb;
begin
  if auth.uid() is not null and not exists (
    select 1 from public.companies
    where id = p_company_id and owner_id = (select auth.uid())
  ) then
    raise exception 'forbidden';
  end if;
  if p_company_id is null or not exists (select 1 from public.companies where id = p_company_id) then
    return null;
  end if;
  basis := case when p_basis = 'invoiced' then 'invoiced' else 'cash' end;

  with bounds as (
    select
      p_from as dfrom,
      p_to as dto,
      case
        when p_from is null or p_to is null then null
        else (p_from - ((p_to - p_from) + 1))
      end as pfrom,
      case when p_from is null or p_to is null then null else (p_from - 1) end as pto
  ),
  income as (
    select
      t.project_id,
      t.amount_net,
      case
        when (select dfrom from bounds) is null then true
        when basis = 'cash' then coalesce(t.cash_date, t.doc_date) between (select dfrom from bounds) and (select dto from bounds)
        else t.doc_date between (select dfrom from bounds) and (select dto from bounds)
      end as in_period,
      case
        when (select pfrom from bounds) is null then false
        when basis = 'cash' then coalesce(t.cash_date, t.doc_date) between (select pfrom from bounds) and (select pto from bounds)
        else t.doc_date between (select pfrom from bounds) and (select pto from bounds)
      end as in_prev
    from public.transactions t
    where t.company_id = p_company_id
      and t.direction = 'income'
      and (
        (basis = 'cash' and t.doc_kind in ('receipt', 'invoice_receipt'))
        or (basis = 'invoiced' and t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      )
  ),
  expense as (
    select
      t.id,
      t.project_id,
      t.pnl_role,
      t.amount_net,
      t.doc_date,
      case
        when (select dfrom from bounds) is null then true
        else t.doc_date between (select dfrom from bounds) and (select dto from bounds)
      end as in_period,
      case
        when (select pfrom from bounds) is null then false
        else t.doc_date between (select pfrom from bounds) and (select pto from bounds)
      end as in_prev
    from public.transactions t
    where t.company_id = p_company_id
      and t.direction = 'expense'
  ),
  shared_alloc as (
    select a.project_id, a.amount_net, e.in_period, e.in_prev
    from public.allocations a
    join expense e on e.id = a.transaction_id
    where e.pnl_role = 'shared'
  ),
  project_rows as (
    select
      p.id,
      p.name,
      p.status,
      p.state_label,
      p.budget_agorot,
      p.sumit_budget_section_id,
      coalesce((select sum(i.amount_net) from income i where i.project_id = p.id and i.in_period), 0) as income_net,
      coalesce((select sum(e.amount_net) from expense e where e.project_id = p.id and e.pnl_role = 'project' and e.in_period), 0) as direct_net,
      coalesce((select sum(s.amount_net) from shared_alloc s where s.project_id = p.id and s.in_period), 0) as shared_net
    from public.projects p
    where p.company_id = p_company_id
  )
  select jsonb_build_object(
    'company_id', c.id,
    'name', c.name,
    'vat_registered', c.vat_registered,
    'basis', basis,
    'from', p_from,
    'to', p_to,
    'income_agorot', coalesce((select sum(amount_net) from income where in_period), 0),
    'direct_agorot', -coalesce((select sum(amount_net) from expense where pnl_role = 'project' and in_period), 0),
    'shared_agorot', -coalesce((select sum(amount_net) from expense where pnl_role = 'shared' and in_period), 0),
    'overhead_agorot', -coalesce((select sum(amount_net) from expense where pnl_role = 'overhead' and in_period), 0),
    'expense_agorot', -coalesce((select sum(amount_net) from expense where in_period), 0),
    'net_profit_agorot',
      coalesce((select sum(amount_net) from income where in_period), 0)
      + coalesce((select sum(amount_net) from expense where in_period), 0),
    'prev_income_agorot', case when p_from is null then null else coalesce((select sum(amount_net) from income where in_prev), 0) end,
    'prev_expense_agorot', case when p_from is null then null else -coalesce((select sum(amount_net) from expense where in_prev), 0) end,
    'prev_net_agorot', case when p_from is null then null else
      coalesce((select sum(amount_net) from income where in_prev), 0)
      + coalesce((select sum(amount_net) from expense where in_prev), 0)
    end,
    'active_projects', (select count(*) from public.projects p where p.company_id = c.id and p.status = 'active'),
    'review_count', (select count(*) from public.review_queue q where q.company_id = c.id and q.status = 'open'),
    'projects', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'name', r.name,
          'status', r.status,
          'state_label', r.state_label,
          'budget_agorot', r.budget_agorot,
          'sumit_budget_section_id', r.sumit_budget_section_id,
          'income_agorot', r.income_net,
          'direct_agorot', -r.direct_net,
          'shared_agorot', -r.shared_net,
          'profit_before_shared_agorot', r.income_net + r.direct_net,
          'profit_agorot', r.income_net + r.direct_net + r.shared_net
        )
        order by (abs(r.income_net) + abs(r.direct_net)) desc, r.name
      )
      from project_rows r
    ), '[]'::jsonb)
  )
  into result
  from public.companies c
  where c.id = p_company_id;

  return result;
end;
$$;

revoke all on function public.company_pnl(uuid, date, date, text) from public, anon;
grant execute on function public.company_pnl(uuid, date, date, text) to authenticated, service_role;

create or replace function public.get_dashboard(
  p_from date default null,
  p_to date default null,
  p_basis text default 'cash'
)
returns jsonb
language plpgsql
stable
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
  payload := public.company_pnl(cid, p_from, p_to, p_basis);
  return payload;
end;
$$;

revoke all on function public.get_dashboard(date, date, text) from public, anon;
grant execute on function public.get_dashboard(date, date, text) to authenticated, service_role;

create or replace function public.get_home()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'company_id', c.id,
        'name', c.name,
        'net_profit_agorot', coalesce((
          select sum(
            case
              when t.direction = 'income' and t.doc_kind in ('receipt', 'invoice_receipt') then t.amount_net
              when t.direction = 'expense' then t.amount_net
              else 0
            end
          )::bigint
          from public.transactions t
          where t.company_id = c.id
        ), 0),
        'is_demo', c.is_demo
      )
      from public.companies c
      where c.owner_id = (select auth.uid())
    ),
    jsonb_build_object(
      'company_id', null,
      'name', null,
      'net_profit_agorot', 0,
      'is_demo', false
    )
  );
$$;

revoke all on function public.get_home() from public, anon;
grant execute on function public.get_home() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Project, unpaid, review, categories
-- ---------------------------------------------------------------------------

create or replace function public.get_project(p_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  cid uuid;
  result jsonb;
begin
  cid := private.current_company_id();
  if cid is null then
    return null;
  end if;
  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'status', p.status,
    'state_label', p.state_label,
    'budget_agorot', p.budget_agorot,
    'sumit_budget_section_id', p.sumit_budget_section_id,
    'income_agorot', coalesce((
      select sum(t.amount_net) from public.transactions t
      where t.project_id = p.id and t.direction = 'income'
        and t.doc_kind in ('invoice', 'credit', 'invoice_receipt')
    ), 0),
    'direct_agorot', -coalesce((
      select sum(t.amount_net) from public.transactions t
      where t.project_id = p.id and t.direction = 'expense' and t.pnl_role = 'project'
    ), 0),
    'shared_agorot', -coalesce((
      select sum(a.amount_net) from public.allocations a
      join public.transactions t on t.id = a.transaction_id
      where a.project_id = p.id and t.pnl_role = 'shared'
    ), 0),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'amount_agorot', s.amount
      ) order by s.amount desc, c.name)
      from (
        select t.category_id, (-sum(t.amount_net))::bigint as amount
        from public.transactions t
        where t.project_id = p.id and t.direction = 'expense' and t.pnl_role = 'project'
        group by t.category_id
      ) s
      left join public.categories c on c.id = s.category_id
    ), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'description', t.description,
        'doc_date', t.doc_date,
        'amount_net', t.amount_net,
        'direction', t.direction,
        'source', t.source,
        'category', c.name
      ) order by t.doc_date desc, t.created_at desc)
      from (
        select * from public.transactions t
        where t.company_id = cid
          and (t.project_id = p.id or exists (
            select 1 from public.allocations a
            where a.transaction_id = t.id and a.project_id = p.id
          ))
        order by t.doc_date desc, t.created_at desc
        limit 40
      ) t
      left join public.categories c on c.id = t.category_id
    ), '[]'::jsonb)
  )
  into result
  from public.projects p
  where p.id = p_id and p.company_id = cid;
  if result is null then
    return null;
  end if;
  return result || jsonb_build_object(
    'profit_agorot',
      (result->>'income_agorot')::bigint
      - (result->>'direct_agorot')::bigint
      - (result->>'shared_agorot')::bigint
  );
end;
$$;

revoke all on function public.get_project(uuid) from public, anon;
grant execute on function public.get_project(uuid) to authenticated, service_role;

create or replace function public.upsert_project(
  p_id uuid,
  p_name text,
  p_budget_agorot bigint,
  p_status text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cid uuid;
  clean text;
  next_status public.project_status;
  rid uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  clean := btrim(coalesce(p_name, ''));
  if char_length(clean) < 2 then
    raise exception 'project name is too short';
  end if;
  next_status := case when p_status = 'finished' then 'finished'::public.project_status else 'active'::public.project_status end;
  if p_id is null then
    insert into public.projects (company_id, name, budget_agorot, status)
    values (cid, clean, p_budget_agorot, next_status)
    returning id into rid;
    return rid;
  end if;
  update public.projects
  set name = clean,
      budget_agorot = p_budget_agorot,
      status = next_status
  where id = p_id and company_id = cid
  returning id into rid;
  if rid is null then
    raise exception 'project not found';
  end if;
  return rid;
end;
$$;

revoke all on function public.upsert_project(uuid, text, bigint, text) from public, anon;
grant execute on function public.upsert_project(uuid, text, bigint, text) to authenticated, service_role;

create or replace function public.list_unpaid()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with cid as (
    select private.current_company_id() as id
  ),
  open_docs as (
    select
      inv.id,
      inv.description,
      inv.doc_date,
      inv.external_id,
      p.name as project_name,
      cu.name as customer_name,
      inv.amount_gross
        + coalesce((
          select sum(cred.amount_gross)
          from public.transactions cred
          where cred.company_id = inv.company_id
            and cred.doc_kind = 'credit'
            and cred.linked_external_id = inv.external_id
        ), 0)
        - coalesce((
          select sum(rec.amount_gross)
          from public.transactions rec
          where rec.company_id = inv.company_id
            and rec.doc_kind = 'receipt'
            and rec.linked_external_id = inv.external_id
        ), 0) as open_gross,
      inv.amount_net,
      inv.amount_gross as billed_gross
    from public.transactions inv
    left join public.projects p on p.id = inv.project_id
    left join public.customers cu on cu.id = inv.customer_id
    where inv.company_id = (select id from cid)
      and inv.doc_kind = 'invoice'
      and inv.external_id is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'description', d.description,
    'doc_date', d.doc_date,
    'project_name', d.project_name,
    'customer_name', d.customer_name,
    'open_gross_agorot', d.open_gross,
    'open_net_agorot', case
      when d.billed_gross = 0 then 0
      else (d.open_gross * d.amount_net) / d.billed_gross
    end
  ) order by d.doc_date, d.description), '[]'::jsonb)
  from open_docs d
  where d.open_gross <> 0;
$$;

revoke all on function public.list_unpaid() from public, anon;
grant execute on function public.list_unpaid() to authenticated, service_role;

create or replace function public.list_review()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'transaction_id', t.id,
    'description', t.description,
    'doc_date', t.doc_date,
    'amount_net', t.amount_net,
    'direction', t.direction,
    'reason', q.reason,
    'project_id', t.project_id,
    'category_id', t.category_id,
    'supplier_name', s.name
  ) order by t.doc_date, q.created_at), '[]'::jsonb)
  from public.review_queue q
  join public.transactions t on t.id = q.transaction_id
  left join public.suppliers s on s.id = t.supplier_id
  where q.company_id = (select private.current_company_id())
    and q.status = 'open';
$$;

revoke all on function public.list_review() from public, anon;
grant execute on function public.list_review() to authenticated, service_role;

create or replace function public.resolve_review(
  p_id uuid,
  p_action text,
  p_project_id uuid,
  p_category_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cid uuid;
  txn uuid;
  next_status public.review_status;
begin
  cid := private.current_company_id();
  if p_action not in ('approved', 'skipped', 'changed') then
    raise exception 'unknown review action';
  end if;
  next_status := p_action::public.review_status;
  select q.transaction_id into txn
  from public.review_queue q
  where q.id = p_id and q.company_id = cid and q.status = 'open';
  if txn is null then
    raise exception 'review item not found';
  end if;
  if next_status <> 'skipped' then
    if p_project_id is null or p_category_id is null then
      raise exception 'project and category are required';
    end if;
    update public.transactions
    set project_id = p_project_id,
        category_id = p_category_id,
        pnl_role = 'project'
    where id = txn and company_id = cid;
    insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
    select cid, txn, p_project_id, 10000, t.amount_net
    from public.transactions t
    where t.id = txn
    on conflict (transaction_id, project_id) do update
      set share_bp = excluded.share_bp,
          amount_net = excluded.amount_net;
  end if;
  update public.review_queue
  set status = next_status,
      resolved_at = now()
  where id = p_id and company_id = cid;
end;
$$;

revoke all on function public.resolve_review(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.resolve_review(uuid, text, uuid, uuid) to authenticated, service_role;

create or replace function public.list_categories()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'kind', c.kind,
    'hidden', c.hidden,
    'is_default', c.is_default
  ) order by c.kind, c.sort_order, c.name), '[]'::jsonb)
  from public.categories c
  where c.company_id = (select private.current_company_id());
$$;

revoke all on function public.list_categories() from public, anon;
grant execute on function public.list_categories() to authenticated, service_role;

create or replace function public.set_category_hidden(p_id uuid, p_hidden boolean)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.categories
  set hidden = p_hidden
  where id = p_id and company_id = (select private.current_company_id());
  if not found then
    raise exception 'category not found';
  end if;
end;
$$;

revoke all on function public.set_category_hidden(uuid, boolean) from public, anon;
grant execute on function public.set_category_hidden(uuid, boolean) to authenticated, service_role;

create or replace function public.merge_category(p_from uuid, p_into uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cid uuid;
begin
  cid := private.current_company_id();
  if p_from = p_into then
    raise exception 'pick a different category';
  end if;
  if not exists (
    select 1 from public.categories
    where company_id = cid and id = p_from
  ) or not exists (
    select 1 from public.categories
    where company_id = cid and id = p_into and hidden = false
  ) then
    raise exception 'category not found';
  end if;
  update public.transactions
  set category_id = p_into
  where company_id = cid and category_id = p_from;
  update public.categories
  set hidden = true
  where id = p_from and company_id = cid;
end;
$$;

revoke all on function public.merge_category(uuid, uuid) from public, anon;
grant execute on function public.merge_category(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Manual entry and splits. SUMIT rows are not deleted here.
-- ---------------------------------------------------------------------------

create or replace function public.create_manual_entry(
  p_direction text,
  p_kind text,
  p_gross_agorot bigint,
  p_doc_date date,
  p_description text,
  p_project_id uuid,
  p_category_id uuid,
  p_vat_exempt boolean
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
    'manual:' || gen_random_uuid()::text,
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
  return rid;
end;
$$;

revoke all on function public.create_manual_entry(text, text, bigint, date, text, uuid, uuid, boolean) from public, anon;
grant execute on function public.create_manual_entry(text, text, bigint, date, text, uuid, uuid, boolean) to authenticated, service_role;

create or replace function public.get_transaction(p_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id,
    'description', t.description,
    'direction', t.direction,
    'doc_kind', t.doc_kind,
    'doc_date', t.doc_date,
    'amount_gross', t.amount_gross,
    'amount_net', t.amount_net,
    'vat_amount', t.vat_amount,
    'vat_status', t.vat_status,
    'source', t.source,
    'project_id', t.project_id,
    'project_name', p.name,
    'category_id', t.category_id,
    'category_name', c.name,
    'supplier_name', s.name,
    'customer_name', cu.name,
    'allocations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'project_id', a.project_id,
        'project_name', ap.name,
        'share_bp', a.share_bp,
        'amount_net', a.amount_net
      ) order by ap.name)
      from public.allocations a
      join public.projects ap on ap.id = a.project_id
      where a.transaction_id = t.id
    ), '[]'::jsonb)
  )
  from public.transactions t
  left join public.projects p on p.id = t.project_id
  left join public.categories c on c.id = t.category_id
  left join public.suppliers s on s.id = t.supplier_id
  left join public.customers cu on cu.id = t.customer_id
  where t.id = p_id
    and t.company_id = (select private.current_company_id());
$$;

revoke all on function public.get_transaction(uuid) from public, anon;
grant execute on function public.get_transaction(uuid) to authenticated, service_role;

create or replace function public.delete_transaction(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  removed uuid;
begin
  delete from public.transactions
  where id = p_id
    and company_id = (select private.current_company_id())
    and source = 'manual'
  returning id into removed;
  if removed is null then
    raise exception 'only a manual entry can be deleted';
  end if;
end;
$$;

revoke all on function public.delete_transaction(uuid) from public, anon;
grant execute on function public.delete_transaction(uuid) to authenticated, service_role;

create or replace function public.save_split(p_transaction_id uuid, p_shares jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cid uuid;
  txn_net bigint;
  total_share integer;
  item jsonb;
  share integer;
  project uuid;
  assigned bigint := 0;
  part bigint;
  first_project uuid;
  count_shares integer := 0;
begin
  cid := private.current_company_id();
  select t.amount_net into txn_net
  from public.transactions t
  where t.id = p_transaction_id and t.company_id = cid
  for update;
  if txn_net is null then
    raise exception 'transaction not found';
  end if;
  if jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) = 0 then
    raise exception 'at least one share is required';
  end if;
  select coalesce(sum((value->>'share_bp')::integer), 0)
  into total_share
  from jsonb_array_elements(p_shares);
  if total_share <> 10000 then
    raise exception 'allocation shares must sum to 10000';
  end if;

  delete from public.allocations
  where transaction_id = p_transaction_id and company_id = cid;

  for item in select value from jsonb_array_elements(p_shares)
  loop
    share := (item->>'share_bp')::integer;
    project := (item->>'project_id')::uuid;
    if share is null or share < 1 or share > 10000 then
      raise exception 'share is out of range';
    end if;
    if not exists (
      select 1 from public.projects p where p.id = project and p.company_id = cid
    ) then
      raise exception 'project not found';
    end if;
    part := (txn_net * share) / 10000;
    assigned := assigned + part;
    count_shares := count_shares + 1;
    if first_project is null then
      first_project := project;
    end if;
    insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
    values (cid, p_transaction_id, project, share, part);
  end loop;

  if assigned <> txn_net and first_project is not null then
    update public.allocations
    set amount_net = amount_net + (txn_net - assigned)
    where transaction_id = p_transaction_id and project_id = first_project;
  end if;

  update public.transactions
  set pnl_role = case when count_shares > 1 then 'shared'::public.pnl_role else 'project'::public.pnl_role end,
      project_id = case when count_shares = 1 then first_project else null end
  where id = p_transaction_id and company_id = cid;
end;
$$;

revoke all on function public.save_split(uuid, jsonb) from public, anon;
grant execute on function public.save_split(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- SUMIT status. The key never leaves sumit_connections.
-- ---------------------------------------------------------------------------

create or replace function public.sumit_status()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'connected', true,
        'sumit_company_id', s.sumit_company_id,
        'last_sync_at', s.last_sync_at,
        'last_error', s.last_error
      )
      from public.sumit_connections s
      where s.company_id = (select private.current_company_id())
    ),
    jsonb_build_object(
      'connected', false,
      'sumit_company_id', null,
      'last_sync_at', null,
      'last_error', null
    )
  );
$$;

revoke all on function public.sumit_status() from public, anon;
grant execute on function public.sumit_status() to authenticated, service_role;

create or replace function public.disconnect_sumit()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select c.id into cid from public.companies c where c.owner_id = (select auth.uid());
  if cid is null then
    raise exception 'no company';
  end if;
  delete from public.sumit_connections where company_id = cid;
end;
$$;

revoke all on function public.disconnect_sumit() from public, anon;
grant execute on function public.disconnect_sumit() to authenticated, service_role;

create or replace function public.sync_review_queue(p_company_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted integer;
begin
  insert into public.review_queue (company_id, transaction_id, status, reason)
  select
    t.company_id,
    t.id,
    'open',
    case
      when t.project_id is null and coalesce(t.pnl_role, 'project') = 'project' then 'missing_project'
      else 'missing_category'
    end
  from public.transactions t
  where t.company_id = p_company_id
    and t.source = 'sumit'
    and (
      t.category_id is null
      or (coalesce(t.pnl_role, 'project') = 'project' and t.project_id is null and t.direction = 'expense')
    )
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id and q.status = 'open'
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function public.sync_review_queue(uuid) from public, anon, authenticated;
grant execute on function public.sync_review_queue(uuid) to service_role;

-- Map a SUMIT budget section onto a project. The owner can change the name.
create or replace function public.map_budget_section(
  p_section_id bigint,
  p_project_id uuid,
  p_name text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cid uuid;
  rid uuid;
  clean text;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  clean := nullif(btrim(coalesce(p_name, '')), '');
  if p_project_id is not null then
    update public.projects
    set sumit_budget_section_id = p_section_id,
        name = coalesce(clean, name)
    where id = p_project_id and company_id = cid
    returning id into rid;
    if rid is null then
      raise exception 'project not found';
    end if;
  else
    if clean is null then
      raise exception 'project name is too short';
    end if;
    insert into public.projects (company_id, name, sumit_budget_section_id)
    values (cid, clean, p_section_id)
    on conflict (company_id, name) do update
      set sumit_budget_section_id = excluded.sumit_budget_section_id
    returning id into rid;
  end if;
  update public.transactions t
  set project_id = rid,
      pnl_role = coalesce(t.pnl_role, 'project'::public.pnl_role)
  where t.company_id = cid
    and t.pnl_role = 'project'
    and t.project_id is null
    and t.description like '%' || clean || '%';
  return rid;
end;
$$;

revoke all on function public.map_budget_section(bigint, uuid, text) from public, anon;
grant execute on function public.map_budget_section(bigint, uuid, text) to authenticated, service_role;

grant select (last_sync_at, last_error) on public.sumit_connections to authenticated;
grant select, insert, update, delete on public.sumit_refresh_requests to service_role;
grant usage, select on sequence public.sumit_refresh_requests_id_seq to service_role;

-- Daily marker at 03:00 UTC. No network call. Decision 0049.
-- Missing pg_cron (local pgTAP, some Free projects) does not fail the migration.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('flow-sumit-daily');
    exception
      when others then
        null;
    end;
    perform cron.schedule(
      'flow-sumit-daily',
      '0 3 * * *',
      $cron$
        insert into public.sumit_refresh_requests (company_id)
        select s.company_id
        from public.sumit_connections s
        where not exists (
          select 1 from public.sumit_refresh_requests r
          where r.company_id = s.company_id and r.claimed_at is null
        );
      $cron$
    );
  end if;
end;
$$;
