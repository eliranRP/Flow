-- Review card fields: VAT, the suggestion names, and how many rows were filed without a queue item today.
-- confidence stays null until AI tagging exists. A rule-based name is still a suggestion.

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
    and q.status = 'open';
$$;

revoke all on function public.list_review() from public, anon;
grant execute on function public.list_review() to authenticated, service_role;
