-- Decision 0070. Append-only.
-- A category Flow suggested, and the owner has not confirmed, stays out of
-- the project's category breakdown. The project totals still include it.

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
  profit bigint;
  available boolean;
  share bigint;
begin
  select c.id into cid
  from public.companies c
  where c.owner_id = (select auth.uid());
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
    'after_overhead', coalesce(p.after_overhead, (select c.after_overhead from public.companies c where c.id = cid)),
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
          and not t.category_suggested
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

