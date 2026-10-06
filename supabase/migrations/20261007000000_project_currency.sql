begin;

create or replace function private.project_category_entries_by_currency(p_project uuid)
returns table (
  category_id uuid,
  transaction_id uuid,
  description text,
  doc_date date,
  amount_net bigint,
  created_at timestamptz,
  shared boolean,
  currency text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.category_id, t.id, t.description, t.doc_date, t.amount_net, t.created_at, false, coalesce(t.currency, 'ILS')
  from public.transactions t
  where t.project_id = p_project
    and t.company_id = (select private.current_company_id())
    and t.direction = 'expense'
    and t.pnl_role = 'project'
    and t.removed_at is null
    and t.line_status = 'posted'
    and not t.category_suggested
    and not exists (
      select 1
      from public.review_queue q
      where q.transaction_id = t.id
        and q.company_id = t.company_id
        and q.status = 'open'
    )
  union all
  select t.category_id, t.id, t.description, t.doc_date, a.amount_net, t.created_at, true, coalesce(t.currency, 'ILS')
  from public.allocations a
  join public.transactions t on t.id = a.transaction_id
  where a.project_id = p_project
    and t.company_id = (select private.current_company_id())
    and t.direction = 'expense'
    and t.pnl_role = 'shared'
    and t.removed_at is null
    and t.line_status = 'posted'
    and not t.category_suggested
    and t.category_id is not null;
$$;

revoke all on function private.project_category_entries_by_currency(uuid) from public, anon;
grant execute on function private.project_category_entries_by_currency(uuid) to authenticated, service_role;

-- Project income follows the books basis exactly like public.company_pnl: the same
-- normalisation (anything but 'invoiced' is cash, null included) and the same doc kinds
-- (cash: receipt + invoice_receipt; invoiced: invoice + credit + invoice_receipt, credits
-- carry their own sign). get_project has no period, so no date field is involved.
create or replace function public.get_project(p_id uuid, p_basis text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  cid uuid;
  basis text;
  result jsonb;
  profit bigint;
  available boolean;
  share bigint;
  waiting jsonb;
begin
  select c.id into cid
    from public.companies c
    where c.owner_id = (select auth.uid());
  if cid is null then
    return null;
  end if;
  basis := case when p_basis = 'invoiced' then 'invoiced' else 'cash' end;

  waiting := public.project_waiting(p_id);

  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'status', p.status,
    'state_label', p.state_label,
    'budget_agorot', p.budget_agorot,
    'sumit_budget_section_id', p.sumit_budget_section_id,
    'after_overhead', coalesce(p.after_overhead, (select c.after_overhead from public.companies c where c.id = cid)),
    'income_agorot', coalesce((
      select sum(t.amount_net) from public.transactions t
      where t.project_id = p.id and t.direction = 'income'
        and t.removed_at is null
        and t.line_status = 'posted'
      and coalesce(t.currency, 'ILS') = 'ILS'
        and (
          (basis = 'cash' and t.doc_kind in ('receipt', 'invoice_receipt'))
          or (basis = 'invoiced' and t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
        )
    ), 0),
    'direct_agorot', -coalesce((
      select sum(t.amount_net) from public.transactions t
      where t.project_id = p.id and t.direction = 'expense' and t.pnl_role = 'project'
        and t.removed_at is null
        and t.line_status = 'posted'
      and coalesce(t.currency, 'ILS') = 'ILS'
    ), 0),
    'shared_agorot', -coalesce((
      select sum(a.amount_net) from public.allocations a
      join public.transactions t on t.id = a.transaction_id
      where a.project_id = p.id and t.pnl_role = 'shared' and t.removed_at is null
        and t.line_status = 'posted'
      and coalesce(t.currency, 'ILS') = 'ILS'
    ), 0),
    'by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', b.currency,
        'income_minor', b.income_minor,
        'direct_minor', b.direct_minor,
        'shared_minor', b.shared_minor,
        'profit_minor', b.income_minor - b.direct_minor - b.shared_minor
      ) order by b.currency)
      from (
        select
          parts.currency,
          coalesce(sum(parts.income_minor), 0)::bigint as income_minor,
          coalesce(sum(parts.direct_minor), 0)::bigint as direct_minor,
          coalesce(sum(parts.shared_minor), 0)::bigint as shared_minor
        from (
          select coalesce(t.currency, 'ILS') as currency,
            case when t.direction = 'income' and (
                (basis = 'cash' and t.doc_kind in ('receipt', 'invoice_receipt'))
                or (basis = 'invoiced' and t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
              ) then t.amount_net else 0 end as income_minor,
            case when t.direction = 'expense' and t.pnl_role = 'project' then -t.amount_net else 0 end as direct_minor,
            0::bigint as shared_minor
          from public.transactions t
          where t.project_id = p.id
            and t.removed_at is null
            and t.line_status = 'posted'
          union all
          select coalesce(t.currency, 'ILS') as currency,
            0::bigint,
            0::bigint,
            -a.amount_net as shared_minor
          from public.allocations a
          join public.transactions t on t.id = a.transaction_id
          where a.project_id = p.id
            and t.pnl_role = 'shared'
            and t.removed_at is null
            and t.line_status = 'posted'
        ) parts
        group by parts.currency
      ) b
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'amount_agorot', s.amount,
        'has_shared_share', s.shared
      ) order by s.amount desc, c.name)
      from (
        select e.category_id,
          (-sum(e.amount_net))::bigint as amount,
          bool_or(e.shared) as shared
        from private.project_category_entries(p.id) e
        group by e.category_id
      ) s
      left join public.categories c on c.id = s.category_id
    ), '[]'::jsonb),
    'categories_by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', s.currency,
        'id', c.id,
        'name', c.name,
        'amount_minor', s.amount,
        'has_shared_share', s.shared
      ) order by s.currency, s.amount desc, c.name)
      from (
        select e.currency,
          e.category_id,
          (-sum(e.amount_net))::bigint as amount,
          bool_or(e.shared) as shared
        from private.project_category_entries_by_currency(p.id) e
        group by e.currency, e.category_id
      ) s
      left join public.categories c on c.id = s.category_id
    ), '[]'::jsonb),
    'other_currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', bucket.currency,
        'income_minor', bucket.income_minor,
        'expense_minor', bucket.expense_minor,
        'count', bucket.line_count
      ) order by bucket.currency)
      from (
        select
          parts.currency,
          sum(parts.income_minor)::bigint as income_minor,
          sum(parts.expense_minor)::bigint as expense_minor,
          sum(parts.line_count)::integer as line_count
        from (
          select
            t.currency,
            case when t.direction = 'income' then t.amount_net else 0 end as income_minor,
            case when t.direction = 'expense' then t.amount_net else 0 end as expense_minor,
            1 as line_count
          from public.transactions t
          where t.project_id = p.id
            and t.removed_at is null
            and t.line_status = 'posted'
            and coalesce(t.currency, 'ILS') <> 'ILS'
            and (
              (t.direction = 'income' and (
                (basis = 'cash' and t.doc_kind in ('receipt', 'invoice_receipt'))
                or (basis = 'invoiced' and t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
              ))
              or (t.direction = 'expense' and t.pnl_role = 'project')
            )
          union all
          select t.currency, 0, a.amount_net, 1
          from public.allocations a
          join public.transactions t on t.id = a.transaction_id
          where a.project_id = p.id
            and t.pnl_role = 'shared'
            and t.removed_at is null
            and t.line_status = 'posted'
            and coalesce(t.currency, 'ILS') <> 'ILS'
            and t.project_id is distinct from p.id
        ) parts
        group by parts.currency
      ) bucket
    ), '[]'::jsonb),
    'pending_count', coalesce(jsonb_array_length(waiting), 0),
    'pending_agorot', coalesce((
      select (-sum(t.amount_net))::bigint
      from jsonb_array_elements(waiting) row
      join public.transactions t on t.id = (row->>'transaction_id')::uuid
      where coalesce(t.currency, 'ILS') = 'ILS'
    ), 0),
    'pending_other_currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', bucket.currency,
        'expense_minor', bucket.expense_minor,
        'count', bucket.line_count
      ) order by bucket.currency)
      from (
        select
          t.currency,
          sum(t.amount_net)::bigint as expense_minor,
          count(*)::integer as line_count
        from jsonb_array_elements(waiting) row
        join public.transactions t on t.id = (row->>'transaction_id')::uuid
        where coalesce(t.currency, 'ILS') <> 'ILS'
        group by t.currency
      ) bucket
    ), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'description', t.description,
        'doc_date', t.doc_date,
        'amount_net', t.amount_net,
        'currency', coalesce(t.currency, 'ILS'),
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
  profit :=
    (result->>'income_agorot')::bigint
    - (result->>'direct_agorot')::bigint
    - (result->>'shared_agorot')::bigint;
  select s.available, s.share_agorot into available, share
  from private.overhead_share(p_id) s;
  return result || jsonb_build_object(
    'profit_agorot', profit,
    'overhead_share_agorot', case when coalesce(available, false) then coalesce(share, 0) else null end,
    'overhead_weighted', coalesce(available, false),
    'profit_after_overhead_agorot', profit - case when coalesce(available, false) then coalesce(share, 0) else 0 end
  );
end;
$$;

revoke all on function public.get_project(uuid, text) from public, anon;
grant execute on function public.get_project(uuid, text) to authenticated, service_role;

-- The one-argument form keeps its signature, grants and SECURITY INVOKER (CREATE OR REPLACE)
-- and returns the invoiced basis, which is what it returned before and what the app's
-- get_dashboard call uses (decision 0060).
create or replace function public.get_project(p_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  return public.get_project(p_id, 'invoiced');
end;
$$;

commit;
