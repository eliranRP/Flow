-- Today's auto-assigned rows. The filter matches auto_approved_today on list_review.

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
  left join public.suppliers s on s.id = filed.supplier_id
  left join public.projects p on p.id = filed.project_id
  left join public.categories c on c.id = filed.category_id
  where filed.company_id = (select private.current_company_id())
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
    );
$$;

revoke all on function public.list_auto_assigned_today() from public, anon;
grant execute on function public.list_auto_assigned_today() to authenticated, service_role;
