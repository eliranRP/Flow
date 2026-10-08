-- FLOW-701 part 3 (Jev phase 1). Decision 0127.
-- Jev sees how the owner filed the same supplier before. For the suppliers of the lines in a
-- tag run, this returns the newest filed lines per supplier: lines whose current review (the
-- newest review_queue row) is approved or changed, not removed. Service role only; the
-- jev-tag job adds them to the request state. Jev still never approves a line (decision 0084).
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function public.jev_supplier_history(
  p_company uuid,
  p_suppliers uuid[],
  p_per integer default 5
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_company is null or p_per is null or p_per < 1 or p_per > 20
     or coalesce(cardinality(p_suppliers), 0) > 500 then
    raise exception 'validation';
  end if;

  with filed as (
    select t.supplier_id, t.id, t.doc_date, t.description, t.amount_net, t.project_id,
      t.category_id, t.pnl_role,
      exists (
        select 1 from public.line_splits ls
        where ls.company_id = t.company_id and ls.transaction_id = t.id
      ) as split,
      (select count(*) from public.allocations a
       where a.company_id = t.company_id and a.transaction_id = t.id) as allocation_count,
      row_number() over (partition by t.supplier_id order by t.doc_date desc, t.id desc) as n
    from public.transactions t
    where t.company_id = p_company
      and t.supplier_id = any (p_suppliers)
      and t.direction = 'expense'
      and t.removed_at is null
      and (
        select q.status from public.review_queue q
        where q.company_id = t.company_id and q.transaction_id = t.id
        order by q.created_at desc, q.updated_at desc, q.id desc
        limit 1
      ) in ('approved', 'changed')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'supplier_id', f.supplier_id,
      'doc_date', f.doc_date,
      'description', left(coalesce(f.description, ''), 120),
      'amount_net', f.amount_net,
      'project_id', f.project_id,
      'category_id', f.category_id,
      'pnl_role', f.pnl_role,
      'split', f.split or f.allocation_count > 1
    ) order by f.supplier_id, f.n), '[]'::jsonb)
  into result
  from filed f
  where f.n <= p_per;
  return result;
end;
$$;

revoke all on function public.jev_supplier_history(uuid, uuid[], integer) from public, anon, authenticated;
grant execute on function public.jev_supplier_history(uuid, uuid[], integer) to service_role;

commit;
