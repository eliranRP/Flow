-- Decision 0074, O16. Append-only.
-- A category line says whether it includes this project's share of a shared
-- cost. The screen shows "כולל חלק מהוצאות משותפות" only then.
--
-- 20260929260000, recorded here so the applied file stays unchanged.
-- A rule restore confirms a guess made before the rule existed: the category
-- matches the supplier's remembered rule, so category_suggested goes back to
-- false. The audit row is written once, with the company owner as the actor.
-- restore_rule stores the flag from before the restore (category_suggested
-- true). The row itself ends false, so that audit is the one restore and not
-- a new suggestion. A second run writes nothing. The net of the row is not a
-- guess.

drop function private.project_category_entries(uuid);

create function private.project_category_entries(p_project uuid)
returns table (
  category_id uuid,
  transaction_id uuid,
  description text,
  doc_date date,
  amount_net bigint,
  created_at timestamptz,
  shared boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.category_id, t.id, t.description, t.doc_date, t.amount_net, t.created_at, false
  from public.transactions t
  where t.project_id = p_project
    and t.company_id = (select private.current_company_id())
    and t.direction = 'expense'
    and t.pnl_role = 'project'
    and t.removed_at is null
    and not t.category_suggested
    and not exists (
      select 1
      from public.review_queue q
      where q.transaction_id = t.id
        and q.company_id = t.company_id
        and q.status = 'open'
    )
  union all
  select t.category_id, t.id, t.description, t.doc_date, a.amount_net, t.created_at, true
  from public.allocations a
  join public.transactions t on t.id = a.transaction_id
  where a.project_id = p_project
    and t.company_id = (select private.current_company_id())
    and t.direction = 'expense'
    and t.pnl_role = 'shared'
    and t.removed_at is null
    and not t.category_suggested
    and t.category_id is not null;
$$;

revoke all on function private.project_category_entries(uuid) from public, anon;
grant execute on function private.project_category_entries(uuid) to authenticated, service_role;

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
  waiting jsonb;
begin
  select c.id into cid
    from public.companies c
    where c.owner_id = (select auth.uid());
  if cid is null then
    return null;
  end if;

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
    'pending_count', coalesce(jsonb_array_length(waiting), 0),
    'pending_agorot', coalesce((
      select (-sum((row->>'amount_net')::bigint))::bigint
      from jsonb_array_elements(waiting) row
    ), 0),
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
