-- FLOW-1143 (decision 0265, amended): the owner's decision of 2026-11-09: utility refunds count only exact
-- matches, and Flow suggests nothing. A bill is refunded by itself only by a money-in line of its exact amount
-- (rule 1), or of the exact sum of several of the same month's bills of one category (rule 2), filed to the
-- bills' property and to their category. Rule 3 (the usual rent plus bills), amount-only matches in another
-- category and payments with no property are gone, and so is the usual-rent pass; there is no 'suggested'
-- state. Everything else is not refunded 30 days after the bill. The owner's own answers (a payment picked as
-- the refund, in any category, with its wrong-category note, the fix and להשאיר; seen; company-paid; refile;
-- undo) work as before.
-- Redefined from their current definitions: private.utility_refund_rows (20261109134430), public.list_utility_refunds
-- (20261109202321) and public.count_utility_refunds (20261109134430, suggested_count is always 0).
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

-- Every bill of a tenant-paid utility with its state as of p_today (FLOW-1143, the owner's decision of
-- 2026-11-09: exact matches only, no suggestions):
--   refunded: matched by the owner (source owner), or counted by itself (source auto): a money-in line of the
--     bill's exact amount (rule 1), or of the exact sum of several of the same month's bills of one category
--     (rule 2), filed to the bills' property and to their category, dated from one month before the bill to
--     p_today;
--   seen: closed by the owner; not_refunded: anything else 30 days or more after the bill; waiting: younger.
-- The bills the owner closed are left out first; the groups are every set of up to 3 of a month's open bills
-- of a property, currency and category (from its first 12), plus the whole month's of that category when it
-- has more; each group's total meets the money-in lines once, by equality. Bills are matched oldest first: a
-- group is owned by its oldest bill, a payment is the refund of one group, a bill is in one group, and a pair
-- the owner rejected is never matched. p_project only filters what is returned.
create or replace function private.utility_refund_rows(p_company uuid, p_today date, p_project uuid default null)
returns table (
  bill_id uuid, project_id uuid, supplier_id uuid, currency text, category_id uuid, doc_date date,
  amount bigint, state text, source text, rule smallint, payment_id uuid, group_ids uuid[], no_rent boolean
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  rent uuid[] := private.utility_category_ids(p_company, 'שכירות', 'income');
  bills private.utility_bill[];
  closed text[];
  closed_pay uuid[];
  owner_paid uuid[];
  done boolean[] := '{}';
  used boolean[] := '{}';
  res_rule smallint[] := '{}';
  res_pay uuid[] := '{}';
  res_owner integer[] := '{}';
  c record;
  cur integer := 0;
  taken boolean := false;
  o integer;
  clash boolean;
begin
  select coalesce(array_agg(x order by x.doc_date, x.id), '{}') into bills
  from private.utility_bills(p_company) x;
  if cardinality(bills) = 0 then
    return;
  end if;

  -- The owner's closing answers, by the bill's place in bills.
  select array_agg(a.state order by u.ord), array_agg(a.payment_transaction_id order by u.ord)
  into closed, closed_pay
  from unnest(bills) with ordinality as u(id, project_id, supplier_id, currency, category_id, doc_date, amount, ord)
  left join public.utility_refund_answers a
    on a.company_id = p_company and a.bill_transaction_id = u.id and a.state in ('matched', 'seen');
  owner_paid := array_remove(closed_pay, null);

  for c in
    with b as materialized (
      select u.ord::integer as ord, u.id, u.project_id, u.currency, u.category_id, u.doc_date, u.amount,
        date_trunc('month', u.doc_date)::date as month
      from unnest(bills) with ordinality as u(id, project_id, supplier_id, currency, category_id, doc_date, amount, ord)
      where closed[u.ord] is null and u.category_id is not null
    ),
    -- The pairs and triples are drawn from the first 12 open bills of a month and category.
    b12 as materialized (
      select x.* from (
        select b.*, row_number() over (partition by b.project_id, b.currency, b.category_id, b.month order by b.ord) as rn
        from b
      ) x
      where x.rn <= 12
    ),
    subs as materialized (
      select b1.ord as owner, array[b1.ord] as ords, b1.amount as total, 1 as size,
        b1.project_id, b1.currency, b1.category_id, b1.doc_date
      from b b1
      union all
      select b1.ord, array[b1.ord, b2.ord], b1.amount + b2.amount, 2, b1.project_id, b1.currency, b1.category_id, b1.doc_date
      from b12 b1
      join b12 b2 on b2.project_id = b1.project_id and b2.currency = b1.currency and b2.category_id = b1.category_id
        and b2.month = b1.month and b2.ord > b1.ord
      union all
      select b1.ord, array[b1.ord, b2.ord, b3.ord], b1.amount + b2.amount + b3.amount, 3,
        b1.project_id, b1.currency, b1.category_id, b1.doc_date
      from b12 b1
      join b12 b2 on b2.project_id = b1.project_id and b2.currency = b1.currency and b2.category_id = b1.category_id
        and b2.month = b1.month and b2.ord > b1.ord
      join b12 b3 on b3.project_id = b1.project_id and b3.currency = b1.currency and b3.category_id = b1.category_id
        and b3.month = b1.month and b3.ord > b2.ord
      union all
      -- The whole month's bills of a category, when it has more than 3.
      select min(b.ord), array_agg(b.ord order by b.ord), sum(b.amount)::bigint, count(*)::integer,
        b.project_id, b.currency, b.category_id, min(b.doc_date)
      from b
      group by b.project_id, b.currency, b.category_id, b.month
      having count(*) > 3
    ),
    pays as materialized (
      select p.id, p.currency, p.project_id, p.category_id, p.doc_date, p.amount_original as amount,
        (row_number() over ())::integer as pord
      from public.transactions p
      where p.company_id = p_company
        and p.direction = 'income'
        and p.removed_at is null
        and p.line_status = 'posted'
        and p.amount_original > 0
        and p.project_id is not null
        and p.category_id is not null
        and p.doc_date <= p_today
        and p.doc_date >= (select min(b.doc_date) from b) - 31
        and p.project_id in (select b.project_id from b)
        and not (p.id = any (owner_paid))
    )
    select s.owner, s.ords, s.size, p.id as pay_id, p.pord,
      abs(p.doc_date - s.doc_date) as days_apart,
      case when s.size = 1 then 1 else 2 end::smallint as rule
    from subs s
    join pays p
      on p.currency = s.currency and p.amount = s.total and p.project_id = s.project_id and p.category_id = s.category_id
    where p.doc_date >= (s.doc_date - interval '1 month')::date
      and not exists (
        select 1 from public.utility_refund_answers r
        where r.company_id = p_company and r.state = 'rejected' and r.payment_transaction_id = p.id
          and r.bill_transaction_id in (select (bills[q]).id from unnest(s.ords) q)
      )
    order by s.owner, rule, days_apart, s.size, p.id
  loop
    if c.owner <> cur then
      cur := c.owner;
      taken := false;
    end if;
    continue when taken or coalesce(done[c.owner], false) or coalesce(used[c.pord], false);
    clash := false;
    foreach o in array c.ords loop
      if coalesce(done[o], false) then
        clash := true;
        exit;
      end if;
    end loop;
    continue when clash;
    used[c.pord] := true;
    foreach o in array c.ords loop
      done[o] := true;
      res_rule[o] := c.rule;
      res_pay[o] := c.pay_id;
      res_owner[o] := c.owner;
    end loop;
    taken := true;
  end loop;

  return query
  with rent_months as (
    select distinct t.project_id, date_trunc('month', t.doc_date)::date as month
    from public.transactions t
    where t.company_id = p_company
      and t.direction = 'income'
      and t.removed_at is null
      and t.line_status = 'posted'
      and t.project_id is not null
      and t.category_id = any (rent)
  ),
  r as (
    select u.id, u.project_id, u.supplier_id, u.currency, u.category_id, u.doc_date, u.amount,
      closed[u.ord] as closing, closed_pay[u.ord] as closing_pay,
      case when closed[u.ord] is null then res_rule[u.ord] end as matched_rule,
      case when closed[u.ord] is null then res_pay[u.ord] end as matched_pay,
      case when closed[u.ord] is null and res_owner[u.ord] is not null then res_owner[u.ord] else -u.ord::integer end as grp,
      u.ord
    from unnest(bills) with ordinality as u(id, project_id, supplier_id, currency, category_id, doc_date, amount, ord)
  ),
  g as (
    select r.*, array_agg(r.id) over (partition by r.grp order by r.ord
      rows between unbounded preceding and unbounded following) as ids
    from r
  )
  select g.id, g.project_id, g.supplier_id, g.currency, g.category_id, g.doc_date, g.amount,
    case
      when g.closing = 'matched' then 'refunded'
      when g.closing = 'seen' then 'seen'
      when g.matched_pay is not null then 'refunded'
      when p_today - g.doc_date >= 30 then 'not_refunded'
      else 'waiting'
    end,
    case when g.closing is not null then 'owner' when g.matched_pay is not null then 'auto' end,
    g.matched_rule,
    coalesce(g.closing_pay, g.matched_pay),
    g.ids,
    rm.project_id is null
  from g
  left join rent_months rm on rm.project_id = g.project_id and rm.month = date_trunc('month', g.doc_date)::date
  where p_project is null or g.project_id = p_project
  order by g.ord;
end;
$$;

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
        'rule', case f.rule when 1 then 'bill' when 2 then 'bills' end,
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
      ) order by case f.state when 'not_refunded' then 0 when 'refunded' then 1 else 2 end,
        pr.name, f.doc_date, f.bill_id)
    from flagged f
    join public.projects pr on pr.id = f.project_id and pr.company_id = cid
    left join public.suppliers s on s.id = f.supplier_id and s.company_id = cid
    left join public.categories c on c.id = f.category_id and c.company_id = cid
    -- The app's list: what asks for an answer (a bill not refunded) and a refund the
    -- owner matched that sits in another category (the one-tap fix). p_all (the MCP): every bill.
    where coalesce(p_all, false)
      or f.state = 'not_refunded'
      or (f.state = 'refunded' and f.source = 'owner' and f.wrong_category)
  ), '[]'::jsonb));
end;
$$;

create or replace function public.count_utility_refunds(p_today date default null)
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
  return (
    with r as materialized (select * from private.utility_refund_rows(cid, today))
    select jsonb_build_object(
      'as_of', today,
      'not_refunded_count', (select count(*) from r where r.state = 'not_refunded'),
      'not_refunded_by_currency', coalesce((
        select jsonb_agg(jsonb_build_object('currency', x.currency, 'amount_minor', x.total) order by x.currency)
        from (select r.currency, sum(r.amount)::bigint as total from r where r.state = 'not_refunded' group by r.currency) x
      ), '[]'::jsonb),
      -- FLOW-1143: Flow suggests nothing any more; the key stays, always 0, for the app's reader.
      'suggested_count', 0
    )
  );
end;
$$;

comment on function public.list_utility_refunds(uuid, date, boolean) is
  'FLOW-1134 (decision 0265): utility bills the tenant has not paid back, as of p_today (default Israel''s today); only exact matches count (FLOW-1143). p_project_id limits it to a property; p_all lists every bill with its state. FLOW-1142: the payment carries project_name and its split parts.';
comment on function public.count_utility_refunds(date) is
  'FLOW-1134 (decision 0265): for Home''s row, the bills not refunded (count and sum per currency), as of p_today. suggested_count is always 0 (FLOW-1143).';

commit;
