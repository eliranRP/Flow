-- Decision 0071 points 4 and 6, and 0072 point 14. Append-only.
-- A category line and list_project_category use the same rows: confirmed
-- expenses in that category, including this project's share of a shared cost.
-- project_waiting is the waiting line and the /review?project= list.
-- The backfill does not read audit meta. Historical rows stored '{}'.

create or replace function private.project_category_entries(p_project uuid)
returns table (
  category_id uuid,
  transaction_id uuid,
  description text,
  doc_date date,
  amount_net bigint,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.category_id, t.id, t.description, t.doc_date, t.amount_net, t.created_at
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
  select t.category_id, t.id, t.description, t.doc_date, a.amount_net, t.created_at
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

create or replace function public.project_waiting(p_project uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(item order by item->>'doc_date', item->>'description'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'review_id', q.id,
      'transaction_id', t.id,
      'description', t.description,
      'doc_date', t.doc_date,
      'amount_net', t.amount_net,
      'direction', t.direction,
      'reason', q.reason,
      'project_id', t.project_id,
      'category_id', t.category_id,
      'category_name', c.name,
      'supplier_name', s.name
    ) as item
    from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    left join public.categories c on c.id = t.category_id
    left join public.suppliers s on s.id = t.supplier_id
    where q.company_id = (select private.current_company_id())
      and q.status = 'open'
      and t.removed_at is null
      and t.project_id = p_project
      and t.direction = 'expense'
      and t.pnl_role = 'project'
    union all
    select jsonb_build_object(
      'review_id', null,
      'transaction_id', t.id,
      'description', t.description,
      'doc_date', t.doc_date,
      'amount_net', t.amount_net,
      'direction', t.direction,
      'reason', 'suggested',
      'project_id', t.project_id,
      'category_id', t.category_id,
      'category_name', c.name,
      'supplier_name', s.name
    )
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    left join public.suppliers s on s.id = t.supplier_id
    where t.company_id = (select private.current_company_id())
      and t.project_id = p_project
      and t.direction = 'expense'
      and t.pnl_role = 'project'
      and t.removed_at is null
      and t.category_suggested
      and not exists (
        select 1
        from public.review_queue q
        where q.transaction_id = t.id
          and q.company_id = t.company_id
          and q.status = 'open'
      )
  ) held;
$$;

revoke all on function public.project_waiting(uuid) from public, anon;
grant execute on function public.project_waiting(uuid) to authenticated, service_role;

create or replace function public.list_project_category(
  p_project uuid,
  p_category uuid,
  p_offset integer default 0,
  p_limit integer default 40
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  cid uuid;
  off integer;
  lim integer;
  total bigint;
  n bigint;
  listed jsonb;
begin
  cid := private.current_company_id();
  if cid is null then
    return null;
  end if;
  if not exists (
    select 1 from public.projects p where p.id = p_project and p.company_id = cid
  ) or not exists (
    select 1 from public.categories c where c.id = p_category and c.company_id = cid
  ) then
    return null;
  end if;
  off := greatest(coalesce(p_offset, 0), 0);
  lim := least(greatest(coalesce(p_limit, 40), 1), 100);
  select coalesce((-sum(e.amount_net))::bigint, 0), count(*)::bigint
    into total, n
  from private.project_category_entries(p_project) e
  where e.category_id = p_category;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', page.transaction_id,
    'description', page.description,
    'doc_date', page.doc_date,
    'amount_net', page.amount_net
  ) order by page.doc_date desc, page.created_at desc, page.transaction_id), '[]'::jsonb)
  into listed
  from (
    select e.transaction_id, e.description, e.doc_date, e.amount_net, e.created_at
    from private.project_category_entries(p_project) e
    where e.category_id = p_category
    order by e.doc_date desc, e.created_at desc, e.transaction_id
    offset off
    limit lim
  ) page;
  return jsonb_build_object(
    'category_name', (select c.name from public.categories c where c.id = p_category),
    'project_name', (select p.name from public.projects p where p.id = p_project),
    'total_agorot', total,
    'rows', listed,
    'next_offset', case when n > off + lim then off + lim else null end
  );
end;
$$;

revoke all on function public.list_project_category(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.list_project_category(uuid, uuid, integer, integer) to authenticated, service_role;

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
        'amount_agorot', s.amount
      ) order by s.amount desc, c.name)
      from (
        select e.category_id, (-sum(e.amount_net))::bigint as amount
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

-- The audit branch in 20260929240000 matches nothing: meta on older rows is
-- '{}', and this backfill runs with no auth.uid() so it writes no audit rows.
-- Drop that branch. Cover an undone guess with no review, a reopened
-- missing-project approval, and a pending undo that would otherwise restore false.
create or replace function private.restore_undone_suggestions()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.review_queue q
  set prior_category_suggested = true
  where q.reason = 'suggested'
    and q.prior_category_id is not null
    and q.prior_category_suggested is null;

  update public.reassign_undo u
  set prior_category_suggested = true
  from public.review_queue q
  where q.id = u.prior_review_id
    and q.company_id = u.company_id
    and q.reason = 'suggested'
    and u.prior_category_suggested is null;

  -- A guess that was undone without a suggested review. The prior was not an
  -- owner confirmation, so the category was a suggestion.
  update public.reassign_undo u
  set prior_category_suggested = true
  where u.prior_category_suggested is null
    and u.prior_user_assigned = false
    and u.prior_category_id is not null
    and (
      u.prior_review_id is null
      or not exists (
        select 1
        from public.review_queue q
        where q.id = u.prior_review_id
          and q.company_id = u.company_id
          and q.reason = 'suggested'
      )
    );

  -- A reopened missing-project approval still showing the guessed category.
  -- A never-resolved row has no prior category, so it is left alone.
  update public.review_queue q
  set prior_category_suggested = true
  where q.reason = 'missing_project'
    and q.status = 'open'
    and q.prior_category_id is not null
    and coalesce(q.prior_user_assigned, false) = false
    and q.prior_category_suggested is null;

  update public.transactions t
  set category_suggested = true
  where t.category_suggested = false
    and t.user_assigned = false
    and t.category_id is not null
    and t.removed_at is null
    and (
      exists (
        select 1
        from public.review_queue q
        where q.company_id = t.company_id
          and q.transaction_id = t.id
          and q.reason = 'suggested'
          and q.status = 'open'
          and q.prior_category_id is not distinct from t.category_id
      )
      or exists (
        select 1
        from public.reassign_undo u
        where u.company_id = t.company_id
          and u.transaction_id = t.id
          and u.undone_at is not null
          and u.prior_category_id is not distinct from t.category_id
          and (
            u.prior_category_suggested is true
            or (
              u.prior_user_assigned = false
              and u.prior_category_id is not null
              and (
                u.prior_review_id is null
                or not exists (
                  select 1
                  from public.review_queue q
                  where q.id = u.prior_review_id
                    and q.company_id = u.company_id
                    and q.reason = 'suggested'
                )
              )
            )
          )
      )
      or exists (
        select 1
        from public.review_queue q
        where q.company_id = t.company_id
          and q.transaction_id = t.id
          and q.reason = 'missing_project'
          and q.status = 'open'
          and q.prior_category_id is not null
          and q.prior_category_id is not distinct from t.category_id
          and coalesce(q.prior_user_assigned, false) = false
      )
    );
end;
$$;

revoke all on function private.restore_undone_suggestions() from public, anon, authenticated;

select private.restore_undone_suggestions();
