-- FLOW-305. list_review also returns the line's source (sumit, mercury, manual, photo),
-- so the review list's statement row can show where a line came from. line_status was
-- already returned. Same body as 20261003200000_connector_l1a_filed_today.sql plus 'source'.

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
    'amount_original', t.amount_original,
    'currency', t.currency,
    'vat_agorot', t.vat_amount,
    'direction', t.direction,
    'line_status', t.line_status,
    'source', t.source,
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
