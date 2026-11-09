-- FLOW-1142: each bill's payment on the utility refunds list names its project (project_name) and, when it is
-- split by category, its parts (parts: category, project and amount of each, in part order; [] when the line
-- is not split), so a suggestion card shows where the money is filed. list_utility_refunds is redefined from
-- its current definition (20261109134430_utility_refunds.sql); every other key and rule stays.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

create or replace function public.list_utility_refunds(
  p_project_id uuid default null, p_today date default null, p_all boolean default false
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
begin
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_project_id is not null and not exists (
    select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
  ) then
    raise exception 'project not found';
  end if;
  return jsonb_build_object('as_of', today, 'bills', coalesce((
    with r as materialized (
      select * from private.utility_refund_rows(cid, today, p_project_id)
    ),
    paid as materialized (
      select r.bill_id, pt.id, pt.doc_date, pt.amount_original, pt.currency, pt.description, pt.project_id,
        pt.category_id, coalesce(cu.name, ps.name) as party, pc.name as category_name,
        exists (select 1 from private.split_parts x where x.transaction_id = pt.id) as split,
        exists (select 1 from private.split_parts x
                where x.transaction_id = pt.id and x.category_id = r.category_id and not x.draft) as part_in_bill,
        x.keep_category, x.refile is not null as refiled,
        pp.name as project_name,
        -- FLOW-1142: the line's parts when it is split by category, in part order (a part with no project of
        -- its own is on the line's project).
        coalesce((
          select jsonb_agg(jsonb_build_object(
              'category_id', sp.category_id,
              'category_name', spc.name,
              'project_id', coalesce(sp.project_id, pt.project_id),
              'project_name', spp.name,
              'amount_minor', sp.amount_minor
            ) order by sp.ordinal)
          from private.split_parts sp
          left join public.categories spc on spc.id = sp.category_id and spc.company_id = cid
          left join public.projects spp on spp.id = coalesce(sp.project_id, pt.project_id) and spp.company_id = cid
          where sp.transaction_id = pt.id and sp.company_id = cid and not sp.draft
        ), '[]'::jsonb) as parts
      from r
      join public.transactions pt on pt.id = r.payment_id and pt.company_id = cid
      left join public.customers cu on cu.id = pt.customer_id and cu.company_id = cid
      left join public.suppliers ps on ps.id = pt.supplier_id and ps.company_id = cid
      left join public.categories pc on pc.id = pt.category_id and pc.company_id = cid
      left join public.projects pp on pp.id = pt.project_id and pp.company_id = cid
      left join public.utility_refund_answers x
        on x.company_id = cid and x.bill_transaction_id = r.bill_id and x.state = 'matched' and x.payment_transaction_id = pt.id
    ),
    -- A payment filed elsewhere: neither its category (unsplit) nor one of its parts is the bill's, and the
    -- owner did not keep it as it is.
    flagged as (
      select r.*, p.bill_id is not null as has_payment, p.id as pay_id, p.doc_date as pay_date,
        p.amount_original as pay_amount, p.currency as pay_currency, p.description as pay_description,
        p.party as pay_party, p.project_id as pay_project_id, p.category_id as pay_category_id,
        p.category_name as pay_category_name, coalesce(p.split, false) as pay_split,
        p.project_name as pay_project_name, p.parts as pay_parts,
        coalesce(p.refiled, false) as refiled,
        coalesce(p.keep_category, false) as keep_category,
        p.bill_id is not null and r.category_id is not null and not coalesce(p.keep_category, false)
          and not (p.category_id is not distinct from r.category_id and not p.split)
          and not p.part_in_bill as wrong_category
      from r
      left join paid p on p.bill_id = r.bill_id
    )
    select jsonb_agg(jsonb_build_object(
        'bill_transaction_id', f.bill_id,
        'project_id', f.project_id,
        'project_name', pr.name,
        'supplier_id', f.supplier_id,
        'supplier_name', s.name,
        'currency', f.currency,
        'category_id', f.category_id,
        'category_name', c.name,
        'amount_minor', f.amount,
        'doc_date', f.doc_date,
        'days', today - f.doc_date,
        'state', f.state,
        'source', f.source,
        'rule', case f.rule when 1 then 'bill' when 2 then 'bills' when 3 then 'rent_and_bills' end,
        'group_bill_transaction_ids', to_jsonb(f.group_ids),
        'no_rent', f.no_rent,
        'payment', case when f.has_payment then jsonb_build_object(
          'transaction_id', f.pay_id,
          'doc_date', f.pay_date,
          'amount_minor', f.pay_amount,
          'currency', f.pay_currency,
          'description', f.pay_description,
          'party', f.pay_party,
          'project_id', f.pay_project_id,
          'category_id', f.pay_category_id,
          'category_name', f.pay_category_name,
          'split', f.pay_split,
          'project_name', f.pay_project_name,
          'parts', f.pay_parts
        ) end,
        'wrong_category', f.wrong_category,
        'keep_category', f.keep_category,
        'refiled', f.refiled
      ) order by case f.state when 'suggested' then 0 when 'not_refunded' then 1 when 'refunded' then 2 else 3 end,
        pr.name, f.doc_date, f.bill_id)
    from flagged f
    join public.projects pr on pr.id = f.project_id and pr.company_id = cid
    left join public.suppliers s on s.id = f.supplier_id and s.company_id = cid
    left join public.categories c on c.id = f.category_id and c.company_id = cid
    -- The app's list: what asks for an answer (a suggestion, a bill not refunded) and a refund the
    -- owner matched that sits in another category (the one-tap fix). p_all (the MCP): every bill.
    where coalesce(p_all, false)
      or f.state in ('suggested', 'not_refunded')
      or (f.state = 'refunded' and f.source = 'owner' and f.wrong_category)
  ), '[]'::jsonb));
end;
$$;

comment on function public.list_utility_refunds(uuid, date, boolean) is
  'FLOW-1134 (decision 0265): utility bills the tenant has not paid back, and the suggested refunds, as of p_today (default Israel''s today). p_project_id limits it to a property; p_all lists every bill with its state. FLOW-1142: the payment carries project_name and its split parts.';

commit;
