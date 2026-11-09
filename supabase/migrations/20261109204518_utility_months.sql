-- FLOW-1144 (decision 0265): a property's utility bills by month. public.list_utility_months(p_project,
-- p_today) gives the property's months, newest first, from its first tenant-paid utility bill or first rent
-- line to the as-of month. Each month has the rent that came in (rent_in, the rent lines: income under the
-- rent root, as the matching reads it), the tenant-paid bills dated in it (bills_paid), the part of them not
-- refunded and not closed by the owner (not_refunded), and the lines of each (rent_lines, bills, with each
-- bill's state from private.utility_refund_rows). Company-paid utilities are left out, as the matching leaves
-- them out. Any member reads it; another company's project is refused.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

create function public.list_utility_months(p_project uuid, p_today date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid := private.readable_company_id();
  today date := coalesce(p_today, private.flow_today());
  rent uuid[];
begin
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_project is null or not exists (
    select 1 from public.projects p where p.id = p_project and p.company_id = cid
  ) then
    raise exception 'project not found';
  end if;
  rent := private.utility_category_ids(cid, 'שכירות', 'income');

  return jsonb_build_object('project_id', p_project, 'as_of', today, 'months', coalesce((
    with bills as materialized (
      select r.bill_id, r.doc_date, r.amount, r.currency, r.state, s.name as supplier_name, c.name as category_name,
        date_trunc('month', r.doc_date)::date as month
      from private.utility_refund_rows(cid, today, p_project) r
      left join public.suppliers s on s.id = r.supplier_id and s.company_id = cid
      left join public.categories c on c.id = r.category_id and c.company_id = cid
      where r.doc_date <= today
    ),
    rents as materialized (
      select t.id, t.doc_date, t.amount_original as amount, t.currency,
        coalesce(cu.name, nullif(t.description, '')) as party, c.name as category_name,
        date_trunc('month', t.doc_date)::date as month
      from public.transactions t
      left join public.customers cu on cu.id = t.customer_id and cu.company_id = cid
      left join public.categories c on c.id = t.category_id and c.company_id = cid
      where t.company_id = cid
        and t.project_id = p_project
        and t.direction = 'income'
        and t.removed_at is null
        and t.line_status = 'posted'
        and t.category_id = any (rent)
        and t.doc_date <= today
    ),
    months as (
      select g::date as month
      from generate_series(
        least((select min(b.month) from bills b), (select min(r.month) from rents r)),
        date_trunc('month', today)::date,
        interval '1 month'
      ) g
    )
    select jsonb_agg(jsonb_build_object(
        'month', m.month,
        'rent_in', coalesce((select sum(r.amount) from rents r where r.month = m.month), 0),
        'bills_paid', coalesce((select sum(b.amount) from bills b where b.month = m.month), 0),
        'not_refunded', coalesce((
          select sum(b.amount) from bills b where b.month = m.month and b.state not in ('refunded', 'seen')
        ), 0),
        'rent_lines', coalesce((
          select jsonb_agg(jsonb_build_object(
              'transaction_id', r.id, 'doc_date', r.doc_date, 'amount_minor', r.amount, 'currency', r.currency,
              'party', r.party, 'category_name', r.category_name
            ) order by r.doc_date, r.id)
          from rents r where r.month = m.month
        ), '[]'::jsonb),
        'bills', coalesce((
          select jsonb_agg(jsonb_build_object(
              'bill_transaction_id', b.bill_id, 'doc_date', b.doc_date, 'amount_minor', b.amount, 'currency', b.currency,
              'supplier_name', b.supplier_name, 'category_name', b.category_name, 'state', b.state
            ) order by b.doc_date, b.bill_id)
          from bills b where b.month = m.month
        ), '[]'::jsonb)
      ) order by m.month desc)
    from months m
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.list_utility_months(uuid, date) from public, anon, authenticated;
grant execute on function public.list_utility_months(uuid, date) to authenticated;
comment on function public.list_utility_months(uuid, date) is
  'FLOW-1144 (decision 0265): a property''s months, newest first, from its first tenant-paid utility bill or rent line to the as-of month: the rent in, the bills paid, the part not refunded, and the lines of each. Company-paid utilities are left out. Any member.';

commit;
