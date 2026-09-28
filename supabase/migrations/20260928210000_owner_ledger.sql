-- Owner ledger. Sync may write only what SUMIT sent.
-- Direct authenticated DML on the ledger is revoked. Writes go through
-- SECURITY DEFINER RPCs. Decision 0063 amends 0059 and the undo in 0061.

alter table public.transactions
  add column user_assigned boolean not null default false,
  add column removed_at timestamptz;

comment on column public.transactions.user_assigned is
  'True after the owner approves, changes, merges, maps, or splits the row. Sync then leaves project, category, role, and shares alone.';

comment on column public.transactions.removed_at is
  'Set when a SUMIT document is absent from a complete sync. Reads skip the row. A later sync clears it.';

create index transactions_removed_idx
  on public.transactions (company_id)
  where removed_at is null;

alter table public.review_queue
  add column prior_project_id uuid,
  add column prior_category_id uuid,
  add column prior_pnl_role public.pnl_role,
  add column prior_user_assigned boolean,
  add column prior_allocations jsonb;

comment on column public.review_queue.prior_allocations is
  'Allocations before resolve_review, restored by reopen_review. Decision 0063.';

-- ---------------------------------------------------------------------------
-- Reads skip documents SUMIT no longer returns.
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
  if coalesce(auth.role(), '') is distinct from 'service_role'
    and not exists (
      select 1 from public.companies
      where id = p_company_id and owner_id = (select auth.uid())
    )
  then
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
      and t.removed_at is null
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
      and t.removed_at is null
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
    'review_count', (
      select count(*)
      from public.review_queue q
      left join public.transactions rt on rt.id = q.transaction_id
      where q.company_id = c.id
        and q.status = 'open'
        and (rt.id is null or rt.removed_at is null)
    ),
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
            and t.removed_at is null
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
        and t.removed_at is null
        and t.doc_kind in ('invoice', 'credit', 'invoice_receipt')
    ), 0),
    'direct_agorot', -coalesce((
      select sum(t.amount_net) from public.transactions t
      where t.project_id = p.id and t.direction = 'expense' and t.pnl_role = 'project'
        and t.removed_at is null
    ), 0),
    'shared_agorot', -coalesce((
      select sum(a.amount_net) from public.allocations a
      join public.transactions t on t.id = a.transaction_id
      where a.project_id = p.id and t.pnl_role = 'shared' and t.removed_at is null
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
          and t.removed_at is null
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
        'doc_kind', t.doc_kind,
        'category', c.name
      ) order by t.doc_date desc, t.created_at desc)
      from (
        select * from public.transactions t
        where t.company_id = cid
          and t.removed_at is null
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
          select sum(cred.amount_gross)::bigint
          from public.transactions cred
          where cred.company_id = inv.company_id
            and cred.removed_at is null
            and cred.doc_kind = 'credit'
            and cred.linked_external_id = inv.external_id
        ), 0)
        - coalesce((
          select sum(rec.amount_gross)::bigint
          from public.transactions rec
          where rec.company_id = inv.company_id
            and rec.removed_at is null
            and rec.doc_kind = 'receipt'
            and rec.linked_external_id = inv.external_id
        ), 0) as open_gross,
      inv.amount_net,
      inv.amount_gross as billed_gross
    from public.transactions inv
    left join public.projects p on p.id = inv.project_id
    left join public.customers cu on cu.id = inv.customer_id
    where inv.company_id = (select id from cid)
      and inv.removed_at is null
      and inv.doc_kind = 'invoice'
      and inv.external_id is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'description', d.description,
    'doc_date', d.doc_date,
    'project_name', d.project_name,
    'customer_name', d.customer_name,
    'open_gross_agorot', d.open_gross::bigint,
    'open_net_agorot', case
      when d.billed_gross = 0 then 0::bigint
      else (d.open_gross * d.amount_net) / d.billed_gross
    end
  ) order by d.doc_date, d.description), '[]'::jsonb)
  from open_docs d
  where d.open_gross <> 0;
$$;

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
    'doc_kind', t.doc_kind,
    'amount_net', t.amount_net,
    'vat_agorot', t.vat_amount,
    'direction', t.direction,
    'reason', q.reason,
    'project_id', t.project_id,
    'category_id', t.category_id,
    'project_name', p.name,
    'category_name', c.name,
    'confidence', null,
    'supplier_name', s.name,
    'auto_approved_today', (
      select count(*)::int
      from public.transactions filed
      where filed.company_id = q.company_id
        and filed.source = 'sumit'
        and filed.removed_at is null
        and filed.created_at >= (date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem')
        and filed.category_id is not null
        and (
          coalesce(filed.pnl_role, 'project') <> 'project'
          or filed.project_id is not null
          or filed.direction <> 'expense'
        )
        and not exists (
          select 1
          from public.review_queue open_row
          where open_row.transaction_id = filed.id
            and open_row.status = 'open'
        )
    )
  ) order by t.doc_date, q.created_at), '[]'::jsonb)
  from public.review_queue q
  join public.transactions t on t.id = q.transaction_id
  left join public.suppliers s on s.id = t.supplier_id
  left join public.projects p on p.id = t.project_id
  left join public.categories c on c.id = t.category_id
  where q.company_id = (select private.current_company_id())
    and q.status = 'open'
    and t.removed_at is null;
$$;

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
    and t.removed_at is null
    and t.company_id = (select private.current_company_id());
$$;

-- ---------------------------------------------------------------------------
-- Write RPCs. security definer, search_path empty, company check.
-- ---------------------------------------------------------------------------

create or replace function public.create_company(p_name text, p_vat_registered boolean)
returns uuid
language plpgsql
security definer
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

create or replace function public.upsert_project(
  p_id uuid default null,
  p_name text default null,
  p_budget_agorot bigint default null,
  p_status text default null
)
returns uuid
language plpgsql
security definer
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

create or replace function public.resolve_review(
  p_id uuid,
  p_action text,
  p_project_id uuid default null,
  p_category_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  txn uuid;
  next_status public.review_status;
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_shares jsonb;
  supplier uuid;
  net bigint;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
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

  select t.project_id, t.category_id, t.pnl_role, t.user_assigned, t.supplier_id, t.amount_net
  into prior_project, prior_category, prior_role, prior_assigned, supplier, net
  from public.transactions t
  where t.id = txn and t.company_id = cid
  for update;

  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', a.project_id,
    'share_bp', a.share_bp,
    'amount_net', a.amount_net
  )), '[]'::jsonb)
  into prior_shares
  from public.allocations a
  where a.transaction_id = txn;

  if next_status <> 'skipped' then
    if p_project_id is null or p_category_id is null then
      raise exception 'project and category are required';
    end if;
    if not exists (
      select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
    ) or not exists (
      select 1 from public.categories c where c.id = p_category_id and c.company_id = cid
    ) then
      raise exception 'project or category not found';
    end if;
    delete from public.allocations where transaction_id = txn and company_id = cid;
    delete from public.overhead where transaction_id = txn and company_id = cid;
    update public.transactions
    set project_id = p_project_id,
        category_id = p_category_id,
        pnl_role = 'project',
        user_assigned = true
    where id = txn and company_id = cid;
    insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
    values (cid, txn, p_project_id, 10000, net);
    if supplier is not null then
      update public.suppliers
      set remembered_category_id = p_category_id
      where id = supplier and company_id = cid;
    end if;
  end if;

  update public.review_queue
  set status = next_status,
      resolved_at = now(),
      prior_project_id = prior_project,
      prior_category_id = prior_category,
      prior_pnl_role = prior_role,
      prior_user_assigned = prior_assigned,
      prior_allocations = prior_shares
  where id = p_id and company_id = cid;
end;
$$;

create or replace function public.reopen_review(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  txn uuid;
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_shares jsonb;
  item jsonb;
  updated int;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select q.transaction_id, q.prior_project_id, q.prior_category_id, q.prior_pnl_role,
         q.prior_user_assigned, q.prior_allocations
  into txn, prior_project, prior_category, prior_role, prior_assigned, prior_shares
  from public.review_queue q
  where q.id = p_id
    and q.company_id = cid
    and q.status in ('approved', 'skipped', 'changed')
  for update;
  if txn is null then
    raise exception 'review item not found';
  end if;

  update public.transactions
  set project_id = prior_project,
      category_id = prior_category,
      pnl_role = prior_role,
      user_assigned = coalesce(prior_assigned, false)
  where id = txn and company_id = cid;
  get diagnostics updated = row_count;
  if updated = 0 then
    raise exception 'review item not found';
  end if;

  delete from public.allocations where transaction_id = txn and company_id = cid;
  if prior_shares is not null and jsonb_typeof(prior_shares) = 'array' then
    for item in select value from jsonb_array_elements(prior_shares)
    loop
      insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
      values (
        cid,
        txn,
        (item->>'project_id')::uuid,
        (item->>'share_bp')::integer,
        (item->>'amount_net')::bigint
      );
    end loop;
  end if;

  delete from public.overhead where transaction_id = txn and company_id = cid;
  if prior_role = 'overhead' then
    insert into public.overhead (company_id, transaction_id) values (cid, txn);
  end if;

  update public.review_queue
  set status = 'open',
      resolved_at = null
  where id = p_id and company_id = cid;
end;
$$;

create or replace function public.set_category_hidden(p_id uuid, p_hidden boolean)
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
  update public.categories
  set hidden = p_hidden
  where id = p_id and company_id = cid;
  if not found then
    raise exception 'category not found';
  end if;
end;
$$;

create or replace function public.merge_category(p_from uuid, p_into uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  from_kind public.category_kind;
  into_kind public.category_kind;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  if p_from = p_into then
    raise exception 'pick a different category';
  end if;
  select kind into from_kind from public.categories where company_id = cid and id = p_from;
  select kind into into_kind from public.categories where company_id = cid and id = p_into and hidden = false;
  if from_kind is null or into_kind is null then
    raise exception 'category not found';
  end if;
  if from_kind is distinct from into_kind then
    raise exception 'categories must be the same kind';
  end if;
  update public.transactions
  set category_id = p_into,
      user_assigned = true
  where company_id = cid and category_id = p_from;
  update public.categories
  set hidden = true
  where id = p_from and company_id = cid;
end;
$$;

create or replace function public.create_manual_entry(
  p_direction text,
  p_kind text,
  p_gross_agorot bigint,
  p_doc_date date,
  p_description text,
  p_project_id uuid default null,
  p_category_id uuid default null,
  p_vat_exempt boolean default false
)
returns uuid
language plpgsql
security definer
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
  if p_project_id is not null and not exists (
    select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
  ) then
    raise exception 'project not found';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.categories c where c.id = p_category_id and c.company_id = cid
  ) then
    raise exception 'category not found';
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
    project_id, category_id, description, user_assigned
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
    btrim(coalesce(p_description, '')),
    true
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

create or replace function public.delete_transaction(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  removed uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  delete from public.transactions
  where id = p_id
    and company_id = cid
    and source = 'manual'
  returning id into removed;
  if removed is null then
    raise exception 'only a manual entry can be deleted';
  end if;
end;
$$;

create or replace function public.save_split(p_transaction_id uuid, p_shares jsonb)
returns void
language plpgsql
security definer
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
  if cid is null then
    raise exception 'no company';
  end if;
  select t.amount_net into txn_net
  from public.transactions t
  where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null
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
  delete from public.overhead
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
      project_id = case when count_shares = 1 then first_project else null end,
      user_assigned = true
  where id = p_transaction_id and company_id = cid;
end;
$$;

create or replace function public.map_budget_section(
  p_section_id bigint,
  p_project_id uuid default null,
  p_name text default null
)
returns uuid
language plpgsql
security definer
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
      pnl_role = coalesce(t.pnl_role, 'project'::public.pnl_role),
      user_assigned = true
  where t.company_id = cid
    and t.removed_at is null
    and t.user_assigned = false
    and t.pnl_role = 'project'
    and t.project_id is null
    and clean is not null
    and t.description like '%' || clean || '%';
  return rid;
end;
$$;

create or replace function public.set_supplier_settings(p_id uuid, p_vat_exempt boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  rate integer;
  row public.transactions%rowtype;
  net bigint;
  assigned bigint;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  update public.suppliers
  set vat_exempt = coalesce(p_vat_exempt, false)
  where id = p_id and company_id = cid;
  if not found then
    raise exception 'supplier not found';
  end if;
  select c.vat_rate_bp into rate from public.companies c where c.id = cid;
  if coalesce(p_vat_exempt, false) then
    rate := 0;
  end if;
  for row in
    select *
    from public.transactions t
    where t.company_id = cid
      and t.supplier_id = p_id
      and t.direction = 'expense'
      and t.removed_at is null
      and t.vat_status in ('assumed', 'derived')
    for update
  loop
    net := private.net_from_gross(row.amount_gross, rate);
    update public.transactions
    set amount_net = net,
        vat_amount = row.amount_gross - net,
        vat_status = case when rate = 0 then 'derived'::public.vat_status else 'assumed'::public.vat_status end
    where id = row.id;
    update public.allocations
    set amount_net = (net * share_bp) / 10000
    where transaction_id = row.id;
    select coalesce(sum(amount_net), 0) into assigned
    from public.allocations
    where transaction_id = row.id;
    if assigned <> 0 and assigned <> net then
      update public.allocations
      set amount_net = amount_net + (net - assigned)
      where id = (
        select a.id from public.allocations a
        where a.transaction_id = row.id
        order by a.project_id
        limit 1
      );
    end if;
  end loop;
end;
$$;

create or replace function public.sync_review_queue(p_company_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  insert into public.review_queue (company_id, transaction_id, status, reason)
  select
    t.company_id,
    t.id,
    'open',
    case
      when t.category_id is null then 'missing_category'
      when t.direction = 'expense' and t.pnl_role = 'shared' then 'unallocated_shared'
      else 'missing_project'
    end
  from public.transactions t
  where t.company_id = p_company_id
    and t.source = 'sumit'
    and t.removed_at is null
    and (
      t.category_id is null
      or (
        t.direction = 'expense'
        and t.pnl_role = 'shared'
        and not exists (
          select 1 from public.allocations a where a.transaction_id = t.id
        )
      )
      or (
        t.direction = 'expense'
        and coalesce(t.pnl_role, 'project') = 'project'
        and t.project_id is null
      )
    )
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id and q.status = 'open'
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

-- One transaction for a full SUMIT page set. Service role only.
-- On conflict, amounts and document fields update. Project, category, role,
-- and allocations update only while user_assigned is false.
create or replace function public.upsert_sumit_documents(p_company uuid, p_docs jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  doc jsonb;
  seen text[] := array[]::text[];
  key text;
  party_name text;
  party_kind text;
  party_external bigint;
  section_name text;
  section_id bigint;
  project uuid;
  supplier uuid;
  customer uuid;
  remembered uuid;
  role public.pnl_role;
  direction public.txn_direction;
  kind public.doc_kind;
  gross bigint;
  net bigint;
  vat bigint;
  txn uuid;
  assigned boolean;
  written integer := 0;
  part bigint;
  allocated bigint;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_company is null or not exists (select 1 from public.companies c where c.id = p_company) then
    raise exception 'no company';
  end if;
  if jsonb_typeof(p_docs) <> 'array' then
    raise exception 'documents must be an array';
  end if;

  perform 1 from public.companies where id = p_company for update;

  for doc in select value from jsonb_array_elements(p_docs)
  loop
    key := doc->>'idempotency_key';
    if key is null or key = '' then
      raise exception 'document is missing an idempotency key';
    end if;
    seen := array_append(seen, key);
    direction := (doc->>'direction')::public.txn_direction;
    kind := (doc->>'doc_kind')::public.doc_kind;
    role := nullif(doc->>'pnl_role', '')::public.pnl_role;
    gross := (doc->>'amount_gross')::bigint;
    net := (doc->>'amount_net')::bigint;
    vat := (doc->>'vat_amount')::bigint;
    if gross is null or net is null or vat is null or gross <> net + vat then
      raise exception 'document amounts do not balance';
    end if;

    section_name := nullif(btrim(coalesce(doc->>'budget_section_name', '')), '');
    section_id := nullif(doc->>'budget_section_id', '')::bigint;
    project := null;
    if section_name is not null then
      insert into public.projects (company_id, name, sumit_budget_section_id)
      values (p_company, section_name, section_id)
      on conflict (company_id, name) do update
        set sumit_budget_section_id = excluded.sumit_budget_section_id
      returning id into project;
    end if;

    party_name := nullif(btrim(coalesce(doc->>'party_name', '')), '');
    party_kind := doc->>'party_kind';
    party_external := nullif(doc->>'party_external_id', '')::bigint;
    supplier := null;
    customer := null;
    remembered := null;
    if party_name is not null and party_kind = 'supplier' then
      insert into public.suppliers (company_id, name, sumit_external_id)
      values (p_company, party_name, party_external)
      on conflict (company_id, name) do update
        set sumit_external_id = coalesce(excluded.sumit_external_id, public.suppliers.sumit_external_id)
      returning id, remembered_category_id into supplier, remembered;
    elsif party_name is not null and party_kind = 'customer' then
      insert into public.customers (company_id, name, sumit_external_id)
      values (p_company, party_name, party_external)
      on conflict (company_id, name) do update
        set sumit_external_id = coalesce(excluded.sumit_external_id, public.customers.sumit_external_id)
      returning id into customer;
    end if;

    if role is distinct from 'project' then
      project := null;
    end if;

    insert into public.transactions (
      company_id, direction, doc_kind, pnl_role,
      amount_gross, amount_net, vat_amount, vat_status,
      doc_date, cash_date, source, external_id, idempotency_key,
      project_id, customer_id, supplier_id, category_id,
      description, linked_external_id, user_assigned, removed_at
    ) values (
      p_company,
      direction,
      kind,
      role,
      gross,
      net,
      vat,
      (doc->>'vat_status')::public.vat_status,
      (doc->>'doc_date')::date,
      nullif(doc->>'cash_date', '')::date,
      'sumit',
      nullif(doc->>'external_id', ''),
      key,
      project,
      customer,
      supplier,
      case when direction = 'expense' then remembered else null end,
      coalesce(doc->>'description', ''),
      nullif(doc->>'linked_external_id', ''),
      false,
      null
    )
    on conflict (company_id, idempotency_key) do update
      set direction = excluded.direction,
          doc_kind = excluded.doc_kind,
          amount_gross = excluded.amount_gross,
          amount_net = excluded.amount_net,
          vat_amount = excluded.vat_amount,
          vat_status = excluded.vat_status,
          doc_date = excluded.doc_date,
          cash_date = excluded.cash_date,
          external_id = excluded.external_id,
          description = excluded.description,
          linked_external_id = excluded.linked_external_id,
          customer_id = excluded.customer_id,
          supplier_id = excluded.supplier_id,
          removed_at = null,
          project_id = case
            when public.transactions.user_assigned then public.transactions.project_id
            else excluded.project_id
          end,
          category_id = case
            when public.transactions.user_assigned then public.transactions.category_id
            else excluded.category_id
          end,
          pnl_role = case
            when public.transactions.user_assigned then public.transactions.pnl_role
            else excluded.pnl_role
          end
    returning id, user_assigned, project_id, pnl_role, amount_net
    into txn, assigned, project, role, net;

    if assigned then
      update public.allocations
      set amount_net = (net * share_bp) / 10000
      where transaction_id = txn;
      select coalesce(sum(a.amount_net), 0) into allocated
      from public.allocations a
      where a.transaction_id = txn;
      if allocated <> 0 and allocated <> net then
        update public.allocations
        set amount_net = amount_net + (net - allocated)
        where id = (
          select a.id from public.allocations a
          where a.transaction_id = txn
          order by a.project_id
          limit 1
        );
      end if;
    else
      delete from public.allocations where transaction_id = txn;
      delete from public.overhead where transaction_id = txn;
      if role = 'project' and project is not null then
        insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
        values (p_company, txn, project, 10000, net);
      elsif role = 'overhead' then
        insert into public.overhead (company_id, transaction_id)
        values (p_company, txn);
      end if;
    end if;

    written := written + 1;
  end loop;

  update public.transactions t
  set removed_at = now()
  where t.company_id = p_company
    and t.source = 'sumit'
    and t.removed_at is null
    and not (t.idempotency_key = any(seen));

  perform public.sync_review_queue(p_company);
  return written;
end;
$$;

-- The daily cron inserts a marker. It does not call SUMIT.
-- pg_net is not required. sumit-sync drains unclaimed rows when it is called
-- with the x-flow-cron header. A failed sync clears claimed_at so the row retries.
comment on table public.sumit_refresh_requests is
  'Daily poll marker. pg_cron inserts rows. sumit-sync claims them when called with x-flow-cron. No pg_net call. Decision 0049 and 0063.';

revoke insert, update, delete on
  public.categories,
  public.projects,
  public.customers,
  public.suppliers,
  public.transactions,
  public.allocations,
  public.split_rules,
  public.split_rule_targets,
  public.overhead,
  public.review_queue
from authenticated;

revoke all on public.sumit_refresh_requests from authenticated, anon;
revoke all on sequence public.sumit_refresh_requests_id_seq from authenticated, anon;

revoke all on function public.upsert_sumit_documents(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_sumit_documents(uuid, jsonb) to service_role;

revoke all on function public.set_supplier_settings(uuid, boolean) from public, anon;
grant execute on function public.set_supplier_settings(uuid, boolean) to authenticated, service_role;

revoke all on function public.sync_review_queue(uuid) from public, anon, authenticated;
grant execute on function public.sync_review_queue(uuid) to service_role;
