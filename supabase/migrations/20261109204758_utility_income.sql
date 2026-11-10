-- FLOW-1159 (decision 0265): the income around a utility bill. public.list_utility_income(p_bill_transaction_id,
-- p_months, p_today) gives a tenant-paid utility bill (with its state, as list_utility_refunds reads it) and the
-- money that came in on its property within p_months months before and after the bill's date (clamped to 1..6,
-- default 2), newest first: each posted, not removed money-in line with its split parts on the property and the
-- utility bills it is the refund of. A line is listed when the line itself is on the property or one of its
-- non-draft parts is (a part with no project of its own is on the line's); its parts are only those on the
-- property. Any member reads it; another company's bill, or a line that is not a tenant-paid utility bill, is
-- refused ("transaction not found").
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

create function public.list_utility_income(
  p_bill_transaction_id uuid, p_months integer default 2, p_today date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid := private.readable_company_id();
  today date := coalesce(p_today, private.flow_today());
  span integer := least(greatest(coalesce(p_months, 2), 1), 6);
  result jsonb;
begin
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- A cheap refusal first: not the company's money-out line.
  if not exists (
    select 1 from public.transactions t
    where t.id = p_bill_transaction_id and t.company_id = cid and t.direction = 'expense'
  ) then
    raise exception 'transaction not found';
  end if;

  -- Every bill's state on the whole company: a line on this property may refund another property's bill.
  with r as materialized (
    select * from private.utility_refund_rows(cid, today)
  ),
  b as (
    select r.*, (r.doc_date - make_interval(months => span))::date as win_from,
      (r.doc_date + make_interval(months => span))::date as win_to
    from r
    where r.bill_id = p_bill_transaction_id
  )
  select jsonb_build_object(
    'as_of', today,
    'months', span,
    'from', b.win_from,
    'to', b.win_to,
    'bill', jsonb_build_object(
      'bill_transaction_id', b.bill_id,
      'doc_date', b.doc_date,
      'amount_minor', b.amount,
      'currency', b.currency,
      'category_id', b.category_id,
      'category_name', c.name,
      'supplier_name', s.name,
      'project_id', b.project_id,
      'project_name', p.name,
      'state', b.state,
      'days', today - b.doc_date,
      'payment_transaction_id', b.payment_id
    ),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
          'transaction_id', t.id,
          'doc_date', t.doc_date,
          'amount_minor', t.amount_original,
          'currency', t.currency,
          'party', coalesce(cu.name, ps.name),
          'description', t.description,
          'project_id', t.project_id,
          'category_id', t.category_id,
          'category_name', tc.name,
          -- The line's non-draft parts on the bill's property, in part order; [] for a line that is not split.
          'parts', coalesce((
            select jsonb_agg(jsonb_build_object(
                'category_id', sp.category_id,
                'category_name', spc.name,
                'amount_minor', sp.amount_minor
              ) order by sp.ordinal)
            from private.split_parts sp
            left join public.categories spc on spc.id = sp.category_id and spc.company_id = cid
            where sp.transaction_id = t.id and sp.company_id = cid and not sp.draft
              and coalesce(sp.project_id, t.project_id) = b.project_id
          ), '[]'::jsonb),
          -- The utility bills this line is the refund of (Flow's exact match or the owner's), oldest first.
          'refunded_bills', coalesce((
            select jsonb_agg(jsonb_build_object(
                'bill_transaction_id', x.bill_id,
                'doc_date', x.doc_date,
                'amount_minor', x.amount,
                'category_id', x.category_id,
                'category_name', xc.name
              ) order by x.doc_date, x.bill_id)
            from r x
            left join public.categories xc on xc.id = x.category_id and xc.company_id = cid
            where x.payment_id = t.id and x.state = 'refunded'
          ), '[]'::jsonb)
        ) order by t.doc_date desc, t.id)
      from public.transactions t
      left join public.customers cu on cu.id = t.customer_id and cu.company_id = cid
      left join public.suppliers ps on ps.id = t.supplier_id and ps.company_id = cid
      left join public.categories tc on tc.id = t.category_id and tc.company_id = cid
      where t.company_id = cid
        and t.direction = 'income'
        and t.removed_at is null
        and t.line_status = 'posted'
        and t.doc_date between b.win_from and b.win_to
        and (t.project_id = b.project_id or exists (
          select 1 from private.split_parts y
          where y.transaction_id = t.id and y.company_id = cid and not y.draft
            and coalesce(y.project_id, t.project_id) = b.project_id
        ))
    ), '[]'::jsonb)
  )
  into result
  from b
  join public.projects p on p.id = b.project_id and p.company_id = cid
  left join public.categories c on c.id = b.category_id and c.company_id = cid
  left join public.suppliers s on s.id = b.supplier_id and s.company_id = cid;

  -- Not a tenant-paid utility bill (a company-paid one, or any other money-out line).
  if result is null then
    raise exception 'transaction not found';
  end if;
  return result;
end;
$$;

revoke all on function public.list_utility_income(uuid, integer, date) from public, anon, authenticated;
grant execute on function public.list_utility_income(uuid, integer, date) to authenticated;
comment on function public.list_utility_income(uuid, integer, date) is
  'FLOW-1159 (decision 0265): a tenant-paid utility bill (with its state) and the money in on its property within p_months months (1..6, default 2) before and after it, newest first: each line with its parts on the property and the bills it refunds. A line counts when it or one of its parts is on the property. Any member; another company''s bill or a non-bill is refused.';

commit;
