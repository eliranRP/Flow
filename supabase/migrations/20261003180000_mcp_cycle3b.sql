-- MCP cycle 3b. Decision 0080.
-- approve_review_item locks the transaction, then the review, matching the
-- MCP wrappers. A deadlock or serialization failure inside resolve_review is
-- re-raised so the caller can retry instead of storing a refused result.
-- שויכו היום is today's SUMIT filings plus this user's assistant approvals.

create or replace function private.note_lock_step(p_step text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  log text;
begin
  log := current_setting('flow.test_lock_log', true);
  if log is null or (log <> 'on' and left(log, 3) is distinct from 'on>') then
    return;
  end if;
  perform set_config('flow.test_lock_log', log || '>' || p_step, true);
end;
$$;

revoke all on function private.note_lock_step(text) from public, anon, authenticated;

-- One row per transaction on שויכו היום. assistant is true when this user's
-- assistant approved it today and the approval is not undone.
create or replace function private.filed_today_rows()
returns table (id uuid, assistant boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select (date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem') as start_at
  ),
  assistant_rows as (
    select distinct w.transaction_id as id
    from private.mcp_writes w
    join public.transactions t on t.id = w.transaction_id
    cross join bounds
    where w.user_id = auth.uid()
      and w.kind = 'review'
      and w.undone_at is null
      and w.transaction_id is not null
      and w.created_at >= bounds.start_at
      and t.company_id = private.current_company_id()
      and t.removed_at is null
      and not exists (
        select 1
        from public.review_queue open_row
        where open_row.transaction_id = t.id
          and open_row.status = 'open'
      )
  ),
  sumit_rows as (
    select filed.id
    from public.transactions filed
    cross join bounds
    where filed.company_id = private.current_company_id()
      and filed.source = 'sumit'
      and filed.removed_at is null
      and filed.created_at >= bounds.start_at
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
  select ids.id, (assistant_rows.id is not null) as assistant
  from (
    select sumit_rows.id from sumit_rows
    union
    select assistant_rows.id from assistant_rows
  ) ids
  left join assistant_rows on assistant_rows.id = ids.id;
$$;

revoke all on function private.filed_today_rows() from public, anon;
grant execute on function private.filed_today_rows() to authenticated, service_role;

create or replace function public.approve_review_item(
  p_id uuid,
  p_project_id uuid,
  p_category_id uuid,
  p_remember boolean default false,
  p_shown_project_id uuid default null,
  p_shown_category_id uuid default null,
  p_check_shown boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  txn uuid;
  item_company uuid;
  item_status public.review_status;
  cur_project uuid;
  cur_category uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    return private.mcp_refused('no company');
  end if;
  if p_id is null then
    return private.mcp_error('not_found', 'not found');
  end if;

  select q.company_id, q.transaction_id
  into item_company, txn
  from public.review_queue q
  where q.id = p_id;

  if item_company is null or item_company is distinct from cid then
    return private.mcp_error('not_found', 'not found');
  end if;

  -- The expense, then the review. The MCP wrappers and the sync use this order.
  perform private.note_lock_step('transactions');
  select t.project_id, t.category_id
  into cur_project, cur_category
  from public.transactions t
  where t.id = txn
    and t.company_id = cid
  for update;

  perform private.note_lock_step('review_queue');
  select q.company_id, q.status
  into item_company, item_status
  from public.review_queue q
  where q.id = p_id
  for update;

  if item_company is null or item_company is distinct from cid then
    return private.mcp_error('not_found', 'not found');
  end if;
  if item_status is distinct from 'open' then
    return private.mcp_error('already_closed', 'already closed');
  end if;

  if coalesce(p_check_shown, false)
    and (
      cur_project is distinct from p_shown_project_id
      or cur_category is distinct from p_shown_category_id
    )
  then
    return private.mcp_error('stale', 'stale');
  end if;

  begin
    perform public.resolve_review(
      p_id,
      'approved',
      p_project_id,
      p_category_id,
      coalesce(p_remember, false),
      true
    );
  exception
    when others then
      if sqlstate in ('40P01', '40001') then
        raise;
      end if;
      return private.mcp_refused(sqlerrm);
  end;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.approve_review_item(uuid, uuid, uuid, boolean, uuid, uuid, boolean) from public, anon, authenticated, service_role;

grant execute on function public.approve_review_item(uuid, uuid, uuid, boolean, uuid, uuid, boolean) to authenticated;

create or replace function public.list_auto_assigned_today()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', filed.id,
    'description', filed.description,
    'doc_date', filed.doc_date,
    'amount_net', filed.amount_net,
    'direction', filed.direction,
    'supplier_name', s.name,
    'project_name', p.name,
    'category_name', c.name
  ) order by filed.created_at desc), '[]'::jsonb)
  from public.transactions filed
  join private.filed_today_rows() ids on ids.id = filed.id
  left join public.suppliers s on s.id = filed.supplier_id
  left join public.projects p on p.id = filed.project_id
  left join public.categories c on c.id = filed.category_id;
$$;

revoke all on function public.list_auto_assigned_today() from public, anon;
grant execute on function public.list_auto_assigned_today() to authenticated, service_role;

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
    'pnl_role', t.pnl_role,
    'share_count', (
      select count(*)::int
      from public.allocations a
      where a.transaction_id = t.id
    ),
    'project_id', t.project_id,
    'category_id', t.category_id,
    'project_name', p.name,
    'category_name', c.name,
    'category_suggested', t.category_suggested,
    'project_suggested', (
      t.project_id is not null
      and not t.user_assigned
      and not t.project_assigned
      and coalesce(t.pnl_role, 'project') is distinct from 'shared'
      and (
        select count(*)
        from public.allocations a
        where a.transaction_id = t.id
          and a.company_id = t.company_id
      ) <= 1
      and not exists (
        select 1
        from public.suppliers sp
        where sp.id = t.supplier_id
          and sp.company_id = t.company_id
          and sp.remembered_project_id = t.project_id
      )
    ),
    'confidence', null,
    'supplier_name', s.name,
    'auto_approved_today', (select count(*)::int from private.filed_today_rows()),
    'assistant_filed_today', coalesce((select bool_or(filed.assistant) from private.filed_today_rows() filed), false)
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

revoke all on function public.list_review() from public, anon;
grant execute on function public.list_review() to authenticated, service_role;
