-- 50 project and P&L readers: split and loan parts now come from the part views (decision 0232).

create or replace function public.get_project(p_id uuid, p_basis text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET plan_cache_mode TO 'force_generic_plan'
AS $function$
declare
  cid uuid;
  basis text;
  result jsonb;
  profit bigint;
  available boolean;
  share bigint;
  waiting jsonb;
  ids uuid[];
  pl_rows private.pnl_lines[];
  share_base bigint;
  available_base boolean;
  cats_ils jsonb;
  cats_in jsonb;
  cats_out jsonb;
  base text;
begin
  select c.id into cid
    from public.companies c
    where c.id = (select private.readable_company_id());
  if cid is null then
    return null;
  end if;
  if (p_from is null) <> (p_to is null) or p_from > p_to then
    raise exception 'invalid range' using errcode = '22023';
  end if;
  basis := private.pnl_basis(cid, p_basis);

  waiting := public.project_waiting(p_id);
  -- Every line this project can count: filed to it, shared to it, or split to it. The totals
  -- below read only these lines, so the page costs the project's lines, not the company's.
  ids := array(
    select t.id from public.transactions t where t.company_id = cid and t.project_id = p_id
    union
    select a.transaction_id from public.allocations a where a.company_id = cid and a.project_id = p_id
    union
    select s.transaction_id from private.split_parts s where s.company_id = cid and s.project_id = p_id
  );
  -- The project's lines, read once. Every total below reads this array instead of reading
  -- private.pnl_lines again with the same filter (eight times before).
  pl_rows := array(
    select u from private.pnl_lines u
    where u.transaction_id = any(ids) and (basis = 'invoiced' or not u.unpaid)
      and private.pnl_in_range(u.kind, basis, u.doc_date, u.cash_date, p_from, p_to)
  );
  -- One pass over the project's category entries feeds the three category lists (three before).
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'amount_agorot', s.amount,
      'has_shared_share', s.shared
    ) order by s.amount desc, c.name) filter (where s.in_pnl and s.currency = 'ILS'), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'currency', s.currency,
      'id', c.id,
      'name', c.name,
      'amount_minor', s.amount,
      'has_shared_share', s.shared
    ) order by s.currency, s.amount desc, c.name) filter (where s.in_pnl), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'currency', s.currency,
      'id', c.id,
      'name', c.name,
      'amount_minor', s.amount,
      'has_shared_share', s.shared
    ) order by s.currency, s.amount desc, c.name) filter (where not s.in_pnl), '[]'::jsonb)
  into cats_ils, cats_in, cats_out
  from (
    select e.currency,
      e.category_id,
      private.line_in_pnl(
        case when not exists (select 1 from private.loan_parts ls where ls.transaction_id = lt.id)
          then lt.in_pnl_override end,
        cat.excluded_from_pnl, cat.loan_part
      ) as in_pnl,
      (-sum(e.amount_net))::bigint as amount,
      bool_or(e.shared) as shared
    from private.project_category_entries_by_currency(p_id) e
    left join public.categories cat on cat.id = e.category_id
    join public.transactions lt on lt.id = e.transaction_id
    where (basis = 'invoiced' or not private.line_unpaid(lt.direction, lt.doc_kind, lt.cash_date))
      and private.pnl_in_range('expense', basis, e.doc_date, null, p_from, p_to)
    group by 1, 2, 3
  ) s
  left join public.categories c on c.id = s.category_id;

  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'status', p.status,
    'state_label', p.state_label,
    'budget_agorot', p.budget_agorot,
    'sumit_budget_section_id', p.sumit_budget_section_id,
    'is_overhead', p.id is not distinct from (select c.overhead_project_id from public.companies c where c.id = cid),
    'after_overhead', coalesce(p.after_overhead, (select c.after_overhead from public.companies c where c.id = cid)),
    'income_agorot', coalesce((
      select sum(l.amount_net) from unnest(pl_rows) l
      where l.project_id = p.id and l.kind = 'income'
        and l.in_pnl
        and l.currency = 'ILS'
        and (
          l.direction = 'expense'
          or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
          or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
        )
    ), 0),
    'direct_agorot', -coalesce((
      select sum(l.amount_net) from unnest(pl_rows) l
      where l.project_id = p.id and l.kind = 'expense' and l.pnl_role = 'project'
        and l.in_pnl
        and l.currency = 'ILS'
    ), 0),
    'shared_agorot', -coalesce((
      select sum(coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0))
      from unnest(pl_rows) l
      -- Lines first, then each line's share by index, so the allocations never drive the join.
      cross join lateral (
        select a.amount_net from public.allocations a
        where a.transaction_id = l.transaction_id and a.project_id = p.id
        offset 0 -- keeps this a per-line lookup
      ) a
      where l.kind = 'expense' and l.pnl_role = 'shared' and l.in_pnl
        and l.currency = 'ILS'
    ), 0),
    'by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', b.currency,
        'income_minor', b.income_minor,
        'direct_minor', b.direct_minor,
        'shared_minor', b.shared_minor,
        'profit_minor', b.income_minor - b.direct_minor - b.shared_minor
      ) order by b.currency)
      from (
        select
          parts.currency,
          coalesce(sum(parts.income_minor), 0)::bigint as income_minor,
          coalesce(sum(parts.direct_minor), 0)::bigint as direct_minor,
          coalesce(sum(parts.shared_minor), 0)::bigint as shared_minor
        from (
          select l.currency as currency,
            case when l.kind = 'income' and (
                l.direction = 'expense'
                or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
                or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
              ) then l.amount_net else 0 end as income_minor,
            case when l.kind = 'expense' and l.pnl_role = 'project' then -l.amount_net else 0 end as direct_minor,
            0::bigint as shared_minor
          from unnest(pl_rows) l
          where l.project_id = p.id
            and l.in_pnl
          union all
          select l.currency as currency,
            0::bigint,
            0::bigint,
            -coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0) as shared_minor
          from unnest(pl_rows) l
          -- Lines first, then each line's share by index, so the allocations never drive the join.
          cross join lateral (
            select a.amount_net from public.allocations a
            where a.transaction_id = l.transaction_id and a.project_id = p.id
            offset 0 -- keeps this a per-line lookup
          ) a
          where l.kind = 'expense' and l.pnl_role = 'shared'
            and l.in_pnl
        ) parts
        group by parts.currency
      ) b
    ), '[]'::jsonb),
    'categories', cats_ils,
    'categories_by_currency', cats_in,
    'excluded_categories_by_currency', cats_out,
    -- FLOW-121: income filed to this project that is out of the P&L, by category, on the
    -- same basis as income_agorot. Positive minor units.
    'excluded_income_by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', s.currency,
        'id', c.id,
        'name', c.name,
        'amount_minor', s.amount,
        'count', s.line_count
      ) order by s.currency, s.amount desc, c.name)
      from (
        select l.currency,
          l.category_id,
          sum(l.amount_net)::bigint as amount,
          count(distinct l.transaction_id)::integer as line_count
        from unnest(pl_rows) l
        where l.project_id = p.id
          and l.company_id = cid
          and l.kind = 'income'
          and not l.in_pnl
          and (
            l.direction = 'expense'
            or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
            or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
          )
        group by l.currency, l.category_id
      ) s
      left join public.categories c on c.id = s.category_id
    ), '[]'::jsonb),
    'other_currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', bucket.currency,
        'income_minor', bucket.income_minor,
        'expense_minor', bucket.expense_minor,
        'count', bucket.line_count
      ) order by bucket.currency)
      from (
        select
          parts.currency,
          sum(parts.income_minor)::bigint as income_minor,
          sum(parts.expense_minor)::bigint as expense_minor,
          count(distinct parts.transaction_id)::integer as line_count
        from (
          select
            l.currency,
            case when l.kind = 'income' then l.amount_net else 0 end as income_minor,
            case when l.kind = 'expense' then l.amount_net else 0 end as expense_minor,
            l.transaction_id
          from unnest(pl_rows) l
          where l.project_id = p.id
            and l.in_pnl
            and l.currency <> 'ILS'
            and (
              (l.kind = 'income' and (
                l.direction = 'expense'
                or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
                or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
              ))
              or (l.kind = 'expense' and l.pnl_role = 'project')
            )
          union all
          select l.currency, 0, coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0), l.transaction_id
          from unnest(pl_rows) l
          -- Lines first, then each line's share by index, so the allocations never drive the join.
          cross join lateral (
            select a.amount_net from public.allocations a
            where a.transaction_id = l.transaction_id and a.project_id = p.id
            offset 0 -- keeps this a per-line lookup
          ) a
          where l.kind = 'expense' and l.pnl_role = 'shared'
            and l.in_pnl
            and l.currency <> 'ILS'
        ) parts
        group by parts.currency
      ) bucket
    ), '[]'::jsonb),
    'pending_count', coalesce(jsonb_array_length(waiting), 0),
    'pending_agorot', coalesce((
      select (-sum(t.amount_net))::bigint
      from jsonb_array_elements(waiting) row
      join public.transactions t on t.id = (row->>'transaction_id')::uuid
      where coalesce(t.currency, 'ILS') = 'ILS'
    ), 0),
    'pending_other_currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', bucket.currency,
        'expense_minor', bucket.expense_minor,
        'count', bucket.line_count
      ) order by bucket.currency)
      from (
        select
          t.currency,
          sum(t.amount_net)::bigint as expense_minor,
          count(*)::integer as line_count
        from jsonb_array_elements(waiting) row
        join public.transactions t on t.id = (row->>'transaction_id')::uuid
        where coalesce(t.currency, 'ILS') <> 'ILS'
        group by t.currency
      ) bucket
    ), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'description', t.description,
        'doc_date', t.doc_date,
        'amount_net', t.amount_net,
        'currency', coalesce(t.currency, 'ILS'),
        'direction', t.direction,
        'source', t.source,
        'doc_kind', t.doc_kind,
        'line_status', t.line_status,
        'category', c.name,
        'kept_out', case
          when t.line_status = 'posted' then not coalesce((
            select bool_or(pl.in_pnl)
            from private.pnl_lines pl
            where pl.transaction_id = t.id
              and (pl.project_id = p.id or exists (
                select 1 from public.allocations a
                where a.transaction_id = t.id and a.project_id = p.id
              ))
          ), false)
          else not private.line_in_pnl(
            case when not exists (select 1 from private.loan_parts ls where ls.transaction_id = t.id)
              then t.in_pnl_override end,
            private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
            c.loan_part
          )
        end,
        'parts_minor', case when exists (
          select 1 from private.split_parts s0
          where s0.transaction_id = t.id and s0.company_id = cid
        ) then coalesce((
          select sum(case
              when pc.kind::text is not distinct from coalesce(
                (select lc.kind::text from public.categories lc
                 where lc.id = t.category_id and lc.company_id = t.company_id),
                t.direction::text) then s.amount_minor
              else -s.amount_minor
            end)
          from private.split_parts s
          left join public.categories pc on pc.id = s.category_id and pc.company_id = s.company_id
          where s.transaction_id = t.id
            and s.company_id = cid
            and coalesce(s.project_id, t.project_id) = p.id
        ), 0)::bigint end
      ) order by t.doc_date desc, t.created_at desc, t.id desc)
      from (
        select * from public.transactions t
        where t.company_id = cid
          and t.removed_at is null
          and t.line_status <> 'pending'
          and (t.project_id = p.id or exists (
            select 1 from public.allocations a
            where a.transaction_id = t.id and a.project_id = p.id
          ) or exists (
            select 1 from private.split_parts s
            where s.transaction_id = t.id and s.company_id = cid and s.project_id = p.id
          ))
          and private.pnl_in_range(t.direction::text, basis, t.doc_date, t.cash_date, p_from, p_to)
        order by t.doc_date desc, t.created_at desc, t.id desc
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
  base := private.company_base_currency(cid);
  -- The shekel and base-currency overhead shares in one pass over the company's lines. A
  -- currency with no row has no weighted share.
  select
    bool_or(s.available) filter (where s.currency = 'ILS'),
    max(s.share_agorot) filter (where s.currency = 'ILS'),
    bool_or(s.available) filter (where s.currency = base),
    max(s.share_agorot) filter (where s.currency = base)
  into available, share, available_base, share_base
  from private.overhead_shares(cid, p_id, basis, p_from, p_to, array['ILS', base], false) s;
  -- FLOW-406: parent_id on each category row and the parent roll-ups beside them.
  result := result || jsonb_build_object(
    'categories', private.category_rows_with_parent(result->'categories', cid),
    'categories_by_currency', private.category_rows_with_parent(result->'categories_by_currency', cid),
    'excluded_categories_by_currency', private.category_rows_with_parent(result->'excluded_categories_by_currency', cid),
    'category_rollups', private.category_rollup_rows(result->'categories', 'amount_agorot', cid),
    'category_rollups_by_currency', private.category_rollup_rows(result->'categories_by_currency', 'amount_minor', cid),
    'excluded_category_rollups_by_currency', private.category_rollup_rows(result->'excluded_categories_by_currency', 'amount_minor', cid)
  );
  return result || jsonb_build_object(
    'from', case when p_from is null or p_to is null then null else p_from end,
    'to', case when p_from is null or p_to is null then null else p_to end,
    'profit_agorot', profit,
    'overhead_share_agorot', case when coalesce(available, false) then coalesce(share, 0) else null end,
    'overhead_weighted', coalesce(available, false),
    'base_currency', base,
    'overhead_share_minor', case when coalesce(available_base, false) then coalesce(share_base, 0) else null end,
    'profit_after_overhead_agorot', profit - case when coalesce(available, false) then coalesce(share, 0) else 0 end,
    -- FLOW-404: purchase, ARV, value, rehab and equity. Nothing above reads them.
    'investment', private.project_investment(cid, p_id),
    -- FLOW-105: the loans filed under this project. Nothing above reads them.
    'loans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'name', l.name,
        'currency', l.currency,
        'balance_minor', b.balance_minor,
        'status', l.status,
        'closed_on', l.closed_on,
        'kind', l.kind,
        'principal_minor', l.principal_minor,
        'annual_rate_ppm', l.annual_rate_ppm,
        'term_months', l.term_months,
        'start_date', l.start_date,
        'payment_minor', l.payment_minor,
        'escrow_minor', l.escrow_minor,
        'interest_only_months', l.interest_only_months,
        'amortization_months', l.amortization_months,
        'rates', coalesce((
          select jsonb_agg(jsonb_build_object(
            'effective_date', r.effective_date,
            'annual_rate_ppm', r.annual_rate_ppm
          ) order by r.effective_date)
          from public.loan_rates r
          where r.company_id = l.company_id
            and r.loan_id = l.id
        ), '[]'::jsonb)
      ) order by l.name, l.id)
      from public.loans l
      join public.loan_balances b
        on b.company_id = l.company_id
       and b.loan_id = l.id
      where l.company_id = cid
        and l.project_id = p_id
    ), '[]'::jsonb)
  );
end;
$function$

;

create or replace function public.get_profit_months(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_basis text DEFAULT NULL::text, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  basis text;
  result jsonb;
  ids uuid[];
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  if (p_from is null) <> (p_to is null) or p_from > p_to then
    raise exception 'invalid range' using errcode = '22023';
  end if;
  if p_from is not null and p_to >= (date_trunc('month', p_from) + interval '240 months')::date then
    raise exception 'range too long' using errcode = '22023';
  end if;
  if p_project_id is not null
    and not exists (select 1 from public.projects p where p.id = p_project_id and p.company_id = cid)
  then
    return null;
  end if;
  basis := private.pnl_basis(cid, p_basis);
  -- A project's months read only its lines: filed, shared or split to it (as get_project).
  if p_project_id is not null then
    ids := array(
      select t.id from public.transactions t where t.company_id = cid and t.project_id = p_project_id
      union
      select a.transaction_id from public.allocations a where a.company_id = cid and a.project_id = p_project_id
      union
      select s.transaction_id from private.split_parts s where s.company_id = cid and s.project_id = p_project_id
    );
  end if;

  with src as (
    select
      l.*,
      case when l.kind = 'income' and basis = 'cash' then coalesce(l.cash_date, l.doc_date) else l.doc_date end as d
    from private.pnl_lines l
    where l.company_id = cid
      and (p_project_id is null or l.transaction_id = any(ids))
      and l.in_pnl
      and (basis = 'invoiced' or not l.unpaid)
      and (
        l.kind = 'expense'
        or l.direction = 'expense'
        or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
        or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      )
      and private.pnl_in_range(l.kind, basis, l.doc_date, l.cash_date, p_from, p_to)
  ),
  parts as (
    select date_trunc('month', s.d)::date as month, s.currency,
      case when s.kind = 'income' then s.amount_net else 0 end as income_minor,
      case when s.kind = 'expense' then -s.amount_net else 0 end as expense_minor
    from src s
    where p_project_id is null
       or (s.project_id = p_project_id and (s.kind = 'income' or s.pnl_role = 'project'))
    union all
    select date_trunc('month', s.d)::date, s.currency,
      0,
      -coalesce(private.div_half_even(a.amount_net::numeric * s.amount_net, s.line_amount_net), 0)
    from src s
    join public.allocations a on a.transaction_id = s.transaction_id
    where p_project_id is not null
      and a.project_id = p_project_id
      and s.kind = 'expense'
      and s.pnl_role = 'shared'
  ),
  bounds as (
    select
      case when p_from is null then (select min(x.month) from parts x) else date_trunc('month', p_from)::date end as lo,
      case when p_from is null then greatest(
        date_trunc('month', current_date)::date,
        (select max(x.month) from parts x)
      ) else date_trunc('month', p_to)::date end as hi
  ),
  months as (
    select
      m::date as month,
      greatest(m::date, coalesce(p_from, m::date)) as mfrom,
      least((m + interval '1 month' - interval '1 day')::date, coalesce(p_to, (m + interval '1 month' - interval '1 day')::date)) as mto
    from bounds b
    cross join lateral generate_series(b.lo, b.hi, interval '1 month') m
    where b.lo is not null
  ),
  sums as (
    select x.month, x.currency, sum(x.income_minor)::bigint as income_minor, sum(x.expense_minor)::bigint as expense_minor
    from parts x
    group by x.month, x.currency
  ),
  cells as (
    select m.month, k.currency, coalesce(s.income_minor, 0) as income_minor, coalesce(s.expense_minor, 0) as expense_minor
    from months m
    cross join (select private.company_base_currency(cid) as currency union select x.currency from parts x) k
    left join sums s on s.month = m.month and s.currency = k.currency
    where k.currency = private.company_base_currency(cid) or s.month is not null
  ),
  -- The months run back to back, so the share of each is the share of its days in the whole
  -- span, bucketed by month: one pass for every month and both currencies.
  shares as (
    select o.month, o.currency, o.available, o.share_agorot
    from (select min(m.mfrom) as lo, max(m.mto) as hi from months m) r
    cross join lateral private.overhead_shares(
      cid, p_project_id, basis, r.lo, r.hi,
      array['ILS', private.company_base_currency(cid)], true
    ) o
    where p_project_id is not null
      and r.lo is not null
  ),
  overhead as (
    select s.month, s.available, s.share_agorot
    from shares s
    where s.currency = 'ILS'
  ),
  overhead_base as (
    select s.month, s.available, s.share_agorot
    from shares s
    where s.currency = private.company_base_currency(cid)
  )
  select jsonb_build_object(
    'basis', basis,
    'base_currency', private.company_base_currency(cid),
    'from', p_from,
    'to', p_to,
    'project_id', p_project_id,
    'after_overhead', case when p_project_id is null then null else (
      select coalesce(p.after_overhead, c.after_overhead)
      from public.projects p
      join public.companies c on c.id = p.company_id
      where p.id = p_project_id
    ) end,
    'months', coalesce((
      select jsonb_agg(jsonb_build_object(
        'month', to_char(m.month, 'YYYY-MM'),
        'from', m.mfrom,
        'to', m.mto,
        'open', current_date between m.month and (m.month + interval '1 month' - interval '1 day')::date,
        'by_currency', (
          select jsonb_agg(jsonb_build_object(
            'currency', c.currency,
            'income_minor', c.income_minor,
            'expense_minor', c.expense_minor,
            'profit_minor', c.income_minor - c.expense_minor
          ) order by c.currency <> private.company_base_currency(cid), c.currency)
          from cells c
          where c.month = m.month
        ),
        'overhead_weighted', case when p_project_id is null then null else coalesce(o.available, false) end,
        'overhead_share_agorot', case when coalesce(o.available, false) then coalesce(o.share_agorot, 0) else null end,
        'overhead_share_minor', case when coalesce(ob.available, false) then coalesce(ob.share_agorot, 0) else null end
      ) order by m.month desc)
      from months m
      left join overhead o on o.month = m.month
      left join overhead_base ob on ob.month = m.month
    ), '[]'::jsonb),
    'by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', t.currency,
        'income_minor', t.income_minor,
        'expense_minor', t.expense_minor,
        'profit_minor', t.income_minor - t.expense_minor
      ) order by t.currency <> private.company_base_currency(cid), t.currency)
      from (
        select c.currency, sum(c.income_minor)::bigint as income_minor, sum(c.expense_minor)::bigint as expense_minor
        from cells c
        group by c.currency
      ) t
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$function$

;

create or replace function public.projects_cash_month(p_month date DEFAULT NULL::date, p_today date DEFAULT NULL::date, p_project uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
  month_start date;
  month_end date;
  basis text;
  base text;
  overhead_id uuid;
  pnl_basis text;
  result jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  if p_project is not null and not exists (
    select 1 from public.projects p where p.id = p_project and p.company_id = cid
  ) then
    return null;
  end if;
  select c.cash_basis, c.base_currency, c.overhead_project_id
  into basis, base, overhead_id
  from public.companies c
  where c.id = cid;
  month_start := date_trunc('month', coalesce(p_month, today))::date;
  month_end := (month_start + interval '1 month' - interval '1 day')::date;
  -- The project totals below count as company_pnl(cid, month, basis) and
  -- company_pnl(cid, all time, basis) count their projects' by_currency, and company_pnl reads
  -- anything but 'invoiced' as the cash basis.
  pnl_basis := case when basis = 'invoiced' then 'invoiced' else 'cash' end;

  with parts as (
    select * from private.cash_parts(cid, basis, month_start, month_end)
    where in_cash
  ),
  direct_parts as (
    select p.transaction_id, p.currency, p.kind, p.project_id as owner_id, p.amount_minor
    from parts p
    where p.pnl_role is distinct from 'shared' and p.project_id is not null
  ),
  unfiled_parts as (
    select p.transaction_id, p.currency, p.kind, null::uuid as owner_id, p.amount_minor
    from parts p
    where p.pnl_role is distinct from 'shared' and p.project_id is null
  ),
  shared_parts as (
    select
      p.transaction_id, p.part, p.category_id, p.project_id as part_project_id, p.currency, p.kind, p.amount_minor,
      least(coalesce(sum(a.share_bp), 0), 10000) as total_bp
    from parts p
    left join public.allocations a on a.transaction_id = p.transaction_id and a.company_id = cid
    where p.pnl_role = 'shared'
    group by p.transaction_id, p.part, p.category_id, p.project_id, p.currency, p.kind, p.amount_minor
  ),
  shared_alloc as (
    select
      sp.transaction_id, sp.part, sp.category_id, sp.part_project_id, sp.currency, sp.kind, sp.amount_minor,
      a.project_id,
      a.share_bp,
      private.div_half_even(sp.amount_minor::numeric * a.share_bp, 10000::numeric) as share_minor,
      private.div_half_even(sp.amount_minor::numeric * sp.total_bp, 10000::numeric) as alloc_total
    from shared_parts sp
    join public.allocations a on a.transaction_id = sp.transaction_id and a.company_id = cid
  ),
  shared_owned as (
    select
      x.transaction_id, x.currency, x.kind, x.project_id as owner_id,
      (x.share_minor + case
        when row_number() over (partition by x.transaction_id, x.part, x.category_id, x.part_project_id, x.amount_minor order by x.share_bp desc, x.project_id) = 1
          then x.alloc_total - sum(x.share_minor) over (partition by x.transaction_id, x.part, x.category_id, x.part_project_id, x.amount_minor)
        else 0
      end)::bigint as amount_minor
    from shared_alloc x
  ),
  shared_unassigned as (
    select
      sp.transaction_id, sp.currency, sp.kind, null::uuid as owner_id,
      (sp.amount_minor - private.div_half_even(sp.amount_minor::numeric * sp.total_bp, 10000::numeric))::bigint as amount_minor
    from shared_parts sp
  ),
  attributed as (
    select * from direct_parts
    union all select * from unfiled_parts
    union all select * from shared_owned
    union all select * from shared_unassigned
  ),
  project_cash as (
    select
      a.owner_id, a.currency,
      coalesce(sum(a.amount_minor) filter (where a.kind = 'income'), 0)::bigint as in_minor,
      coalesce(sum(-a.amount_minor) filter (where a.kind = 'expense'), 0)::bigint as out_minor
    from attributed a
    where a.owner_id is not null
    group by a.owner_id, a.currency
  ),
  unassigned_cash as (
    select
      a.currency,
      coalesce(sum(a.amount_minor) filter (where a.kind = 'income'), 0)::bigint as in_minor,
      coalesce(sum(-a.amount_minor) filter (where a.kind = 'expense'), 0)::bigint as out_minor
    from attributed a
    where a.owner_id is null
    group by a.currency
  ),
  unassigned_lines as (
    select count(distinct a.transaction_id)::integer as n
    from attributed a
    where a.owner_id is null and a.amount_minor <> 0
  ),
  -- The company's lines, read once: the project totals and every project's first month.
  pnl as materialized (
    select
      l.transaction_id, l.project_id, l.kind, l.pnl_role, l.direction, l.doc_kind, l.currency,
      l.amount_net, l.line_amount_net, l.in_pnl, l.unpaid, l.doc_date, l.cash_date
    from private.pnl_lines l
    where l.company_id = cid
  ),
  pnl_counted as (
    select
      l.transaction_id, l.project_id, l.kind, l.pnl_role, l.currency, l.amount_net, l.line_amount_net,
      coalesce(
        case when l.kind = 'income' and pnl_basis = 'cash' then coalesce(l.cash_date, l.doc_date) else l.doc_date end
          between month_start and month_end,
        false
      ) as in_month
    from pnl l
    where l.in_pnl
      and (pnl_basis = 'invoiced' or not l.unpaid)
      and (
        l.kind = 'expense'
        or (
          l.kind = 'income'
          and (
            l.direction = 'expense'
            or (pnl_basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
            or (pnl_basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
          )
        )
      )
  ),
  pnl_parts as (
    select l.project_id, l.currency, l.in_month, l.amount_net as income_net, 0::bigint as direct_net, 0::bigint as shared_net
    from pnl_counted l
    where l.kind = 'income'
    union all
    select l.project_id, l.currency, l.in_month, 0::bigint, l.amount_net, 0::bigint
    from pnl_counted l
    where l.kind = 'expense' and l.pnl_role = 'project' and l.project_id is not null
    union all
    select a.project_id, l.currency, l.in_month, 0::bigint, 0::bigint,
      coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0)
    from pnl_counted l
    join public.allocations a on a.transaction_id = l.transaction_id
    where l.kind = 'expense' and l.pnl_role = 'shared'
  ),
  -- Per project and currency, company_pnl's income_net, direct_net and shared_net for the month
  -- and for all time.
  pnl_sums as (
    select
      x.project_id,
      x.currency,
      coalesce(sum(x.income_net) filter (where x.in_month), 0)::bigint as month_income,
      coalesce(sum(x.direct_net) filter (where x.in_month), 0)::bigint as month_direct,
      coalesce(sum(x.shared_net) filter (where x.in_month), 0)::bigint as month_shared,
      coalesce(sum(x.income_net), 0)::bigint as all_income,
      coalesce(sum(x.direct_net), 0)::bigint as all_direct,
      coalesce(sum(x.shared_net), 0)::bigint as all_shared
    from pnl_parts x
    where x.project_id is not null
    group by x.project_id, x.currency
  ),
  pnl_projects as (
    select
      s.project_id,
      s.currency,
      s.month_income + s.month_direct + s.month_shared as profit_month,
      s.all_income + s.all_direct + s.all_shared as profit_all,
      (-s.all_direct) + (-s.all_shared) as spent_all
    from pnl_sums s
  ),
  -- Every project's lines (filed, shared or split to it, as private.project_line_ids lists them)
  -- and the month of the earliest.
  project_lines as (
    select t.project_id, t.id as transaction_id
    from public.transactions t
    where t.company_id = cid and t.project_id is not null
    union
    select a.project_id, a.transaction_id
    from public.allocations a
    where a.company_id = cid
    union
    select s.project_id, s.transaction_id
    from private.split_parts s
    where s.company_id = cid and s.project_id is not null
  ),
  first_months as (
    select pl.project_id, to_char(date_trunc('month', min(l.doc_date)), 'YYYY-MM-DD') as first_month
    from project_lines pl
    join pnl l on l.transaction_id = pl.transaction_id
    group by pl.project_id
  ),
  project_rows as (
    select
      p.id,
      p.name,
      p.state_label as type,
      p.status::text as status,
      p.id is not distinct from overhead_id as is_overhead,
      p.group_id,
      p.created_at,
      p.finished_on,
      p.budget_agorot as budget_minor,
      coalesce((select r.spent_all from pnl_projects r where r.project_id = p.id and r.currency = base), 0) as spent_minor,
      coalesce((select r.profit_month from pnl_projects r where r.project_id = p.id and r.currency = base), 0) as profit_month_minor,
      coalesce((select r.profit_all from pnl_projects r where r.project_id = p.id and r.currency = base), 0) as profit_all_minor,
      (select f.first_month from first_months f where f.project_id = p.id) as first_month,
      jsonb_array_length(public.project_waiting(p.id)) as pending_count,
      private.project_is_empty(cid, p.id) as deletable,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'currency', pc.currency,
          'in_minor', pc.in_minor,
          'out_minor', pc.out_minor,
          'net_minor', pc.in_minor - pc.out_minor
        ) order by pc.currency is distinct from base, pc.currency)
        from project_cash pc
        where pc.owner_id = p.id
      ), '[]'::jsonb) as cash
    from public.projects p
    where p.company_id = cid
      and (p_project is null or p.id = p_project)
  )
  select jsonb_build_object(
    'month', to_char(month_start, 'YYYY-MM-DD'),
    'base_currency', base,
    'basis', basis,
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'name', r.name,
        'type', r.type,
        'status', r.status,
        'is_overhead', r.is_overhead,
        'group_id', r.group_id,
        'created_at', r.created_at,
        'finished_on', r.finished_on,
        'budget_minor', r.budget_minor,
        'spent_minor', r.spent_minor,
        'cash', r.cash,
        'profit_month_minor', r.profit_month_minor,
        'profit_all_minor', r.profit_all_minor,
        'first_month', r.first_month,
        'pending_count', r.pending_count,
        'deletable', r.deletable
      ) order by r.name)
      from project_rows r
    ), '[]'::jsonb),
    'unassigned', jsonb_build_object(
      'count', (select n from unassigned_lines),
      'cash', coalesce((
        select jsonb_agg(jsonb_build_object(
          'currency', uc.currency,
          'in_minor', uc.in_minor,
          'out_minor', uc.out_minor,
          'net_minor', uc.in_minor - uc.out_minor
        ) order by uc.currency is distinct from base, uc.currency)
        from unassigned_cash uc
      ), '[]'::jsonb)
    )
  )
  into result;

  return result;
end;
$function$

;

create or replace function public.company_next_month_inputs(p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
  this_month date;
  first_month date;
  next_month text;
  overhead uuid;
  projects jsonb;
  general jsonb;
  edits jsonb;
  rest_edits jsonb;
  rest_months text[];
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  this_month := date_trunc('month', today)::date;
  first_month := (this_month - interval '6 months')::date;
  next_month := to_char(this_month + interval '1 month', 'YYYY-MM');
  -- The months left in this year after this one: none in December.
  rest_months := array(
    select to_char(m, 'YYYY-MM')
    from generate_series(this_month + interval '1 month', date_trunc('year', today) + interval '11 months', interval '1 month') m
  );
  select c.overhead_project_id into overhead from public.companies c where c.id = cid;

  -- Every active project's category months in one pass (FLOW-977), not one project_category_months
  -- call per project.
  select coalesce(jsonb_agg(jsonb_build_object(
      'project_id', p.id,
      'categories', coalesce(m.categories, '[]'::jsonb)
    ) order by p.id), '[]'::jsonb)
  into projects
  from public.projects p
  left join private.project_category_months_many(array(
    select ap.id from public.projects ap
    where ap.company_id = cid and ap.status = 'active' and ap.id is distinct from overhead
  ), 6, today) m on m.project_id = p.id
  where p.company_id = cid
    and p.status = 'active'
    and p.id is distinct from overhead;

  with streams as (
    -- The lines of each recurring charge of an active project but the overhead one: that project counts them.
    select sl.id
    from private.recurring_stream_lines(cid, today) sl
    join private.recurring_parties(cid, today) rp
      on rp.direction = sl.direction and rp.party_id = sl.party_id and rp.currency = sl.currency
      and rp.project_id = sl.stream_project
    join public.projects sp on sp.id = sl.stream_project and sp.status = 'active'
    where sl.stream_project is not null
      and sl.stream_project is distinct from overhead
  ),
  entries as (
    select l.category_id, l.currency, date_trunc('month', l.doc_date)::date as month, -l.amount_net as amount
    from private.pnl_lines l
    join public.transactions lt on lt.id = l.transaction_id
    left join public.categories cat on cat.id = l.category_id
    where l.company_id = cid
      and l.kind = 'expense'
      and (l.unassigned or l.pnl_role = 'overhead')
      and not lt.category_suggested
      and not exists (
        select 1 from public.review_queue q
        where q.transaction_id = lt.id and q.company_id = lt.company_id and q.status = 'open'
      )
      and l.doc_date >= first_month
      and l.doc_date < this_month
      and not exists (select 1 from streams st where st.id = lt.id)
      and private.line_in_pnl(
        case when not exists (select 1 from private.loan_parts ls where ls.transaction_id = lt.id)
          then lt.in_pnl_override end,
        cat.excluded_from_pnl, cat.loan_part
      )
  ),
  sums as (
    select e.category_id, e.currency, e.month, sum(e.amount)::bigint as amount
    from entries e
    group by e.category_id, e.currency, e.month
  ),
  keys as (
    select distinct s.category_id, s.currency from sums s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', k.category_id,
      'name', c.name,
      'currency', k.currency,
      'months_minor', (
        select jsonb_agg(coalesce(s.amount, 0) order by m)
        from generate_series(first_month, this_month - interval '1 month', interval '1 month') m
        left join sums s on s.category_id is not distinct from k.category_id
          and s.currency = k.currency and s.month = m::date
      )
    ) order by k.currency, c.name), '[]'::jsonb)
  into general
  from keys k
  left join public.categories c on c.id = k.category_id;

  select coalesce(jsonb_agg(
      private.pfe_json(e.*)
        || jsonb_build_object('project_id', e.project_id, 'category_name', c.name)
        || case when e.kind = 'add' then jsonb_build_object('matched_transaction_id', m.transaction_id) else '{}'::jsonb end
      order by e.created_at, e.id), '[]'::jsonb)
  into edits
  from public.project_forecast_edits e
  left join public.categories c on c.id = e.category_id
  left join public.forecast_line_matches m on m.edit_id = e.id and m.month = next_month and m.company_id = e.company_id
  join public.projects p on p.id = e.project_id
  where e.company_id = cid
    and (p.status = 'active' or p.id = overhead)
    and private.pfe_hits(e.start_month, e.pace, next_month);

  -- The rest of the year's edits: every edit (of the same projects) that applies to any month left in the
  -- year, with each added edit's matched line by month, so the year's forecast applies each month's own.
  select coalesce(jsonb_agg(
      private.pfe_json(e.*)
        || jsonb_build_object('project_id', e.project_id, 'category_name', c.name)
        || case when e.kind = 'add' then jsonb_build_object('matches', coalesce((
          select jsonb_object_agg(m.month, m.transaction_id order by m.month)
          from public.forecast_line_matches m
          where m.edit_id = e.id and m.company_id = e.company_id and m.month = any(rest_months)
        ), '{}'::jsonb)) else '{}'::jsonb end
      order by e.created_at, e.id), '[]'::jsonb)
  into rest_edits
  from public.project_forecast_edits e
  left join public.categories c on c.id = e.category_id
  join public.projects p on p.id = e.project_id
  where e.company_id = cid
    and (p.status = 'active' or p.id = overhead)
    and exists (select 1 from unnest(rest_months) rm where private.pfe_hits(e.start_month, e.pace, rm));

  return jsonb_build_object(
    'today', today,
    'month', next_month,
    'overhead_project_id', overhead,
    'projects', projects,
    'general', general,
    'edits', edits,
    'rest_edits', rest_edits
  );
end;
$function$

;

create or replace function private.overhead_shares(p_company uuid, p_project uuid, p_basis text, p_from date, p_to date, p_currencies text[], p_by_month boolean)
 RETURNS TABLE(month date, currency text, available boolean, share_agorot bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with cid as (
    select
      p_company as id,
      (select c.overhead_project_id from public.companies c where c.id = p_company) as overhead_project,
      case when p_basis = 'invoiced' then 'invoiced' else 'cash' end as basis
  ),
  -- One pass over the company's income and overhead lines, as overhead_share_for reads them.
  lines as (
    select
      case when p_by_month then date_trunc('month',
        case when l.kind = 'income' and (select basis from cid) = 'cash' then coalesce(l.cash_date, l.doc_date) else l.doc_date end
      )::date end as month,
      l.currency,
      l.project_id,
      l.kind,
      l.pnl_role,
      l.amount_net,
      l.kind = 'income'
        and (
          l.direction = 'expense'
          or ((select basis from cid) = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
          or ((select basis from cid) = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
        )
        and l.project_id is not null
        and l.project_id is distinct from (select overhead_project from cid) as is_income
    from private.pnl_lines l
    where l.company_id = (select id from cid)
      and l.currency = any(p_currencies)
      and l.in_pnl
      and (l.kind = 'income' or l.pnl_role = 'overhead')
      and ((select basis from cid) = 'invoiced' or not l.unpaid)
      and private.pnl_in_range(l.kind, (select basis from cid), l.doc_date, l.cash_date, p_from, p_to)
      -- Only lines that can be income or overhead reach the view's per-line work, as in
      -- overhead_share_for (20261014093004): a line of an income kind or direction, filed to
      -- the overhead project, or split (its parts can be either). A superset: the filters
      -- above still decide.
      and l.transaction_id = any(array(
        select t.id
        from public.transactions t
        left join public.categories k on k.id = t.category_id
        where t.company_id = p_company
          and (t.direction = 'income' or k.kind = 'income' or t.pnl_role = 'overhead'
            or t.project_id = (select overhead_project from cid))
        union
        select s.transaction_id from private.split_parts s where s.company_id = p_company
        union
        select s.transaction_id from private.loan_parts s where s.company_id = p_company
      ))
  ),
  totals as (
    select
      l.month,
      l.currency,
      coalesce(sum(l.amount_net) filter (where l.is_income), 0)::bigint as total_income,
      coalesce(-(sum(l.amount_net) filter (where l.kind = 'expense' and l.pnl_role = 'overhead'))::bigint, 0) as overhead_cost
    from lines l
    group by l.month, l.currency
  ),
  project_income as (
    select l.month, l.currency, l.project_id, sum(l.amount_net)::bigint as income
    from lines l
    where l.is_income
    group by l.month, l.currency, l.project_id
    having sum(l.amount_net) > 0
  ),
  -- Only the months and currencies where the project has a weighted share need the rounding;
  -- elsewhere its share is 0.
  rounded as (
    select
      s.month,
      s.currency,
      p.id as project_id,
      p.name as project_name,
      s.income,
      t.overhead_cost,
      t.overhead_cost::numeric * s.income / t.total_income as exact,
      private.round_agorot_shekel_hundreds(t.overhead_cost::numeric * s.income / t.total_income) as rounded
    from project_income s
    join totals t on t.month is not distinct from s.month and t.currency = s.currency
    join public.projects p on p.id = s.project_id
    where p.company_id = (select id from cid)
      and t.total_income <> 0
      and exists (
        select 1 from project_income x
        where x.month is not distinct from s.month and x.currency = s.currency and x.project_id = p_project
      )
  ),
  spread as (
    select
      r.*,
      max(r.exact - r.rounded) over (partition by r.month, r.currency) as max_gap,
      coalesce(sum(r.rounded) over (partition by r.month, r.currency), 0) as rounded_sum
    from rounded r
  ),
  -- The remainder goes to one project, picked as overhead_share_for picks it.
  ranked as (
    select
      s.*,
      row_number() over (
        partition by s.month, s.currency
        order by
          case when s.max_gap > 0 then (s.exact - s.rounded) end desc nulls last,
          case when s.max_gap <= 0 then s.income end desc nulls last,
          s.project_name asc
      ) as pick
    from spread s
  )
  select
    t.month,
    t.currency,
    (select id from cid) is not null and t.total_income <> 0,
    case
      when (select id from cid) is null or t.total_income = 0 then null::bigint
      else coalesce((
        select (k.rounded + case when k.pick = 1 then k.overhead_cost - k.rounded_sum else 0 end)::bigint
        from ranked k
        where k.month is not distinct from t.month and k.currency = t.currency and k.project_id = p_project
      ), 0)
    end
  from totals t;
$function$

;

create or replace function private.overhead_share_for(p_company uuid, p_project uuid, p_basis text, p_from date, p_to date)
 RETURNS TABLE(available boolean, share_agorot bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with cid as (
    select
      p_company as id,
      (select c.overhead_project_id from public.companies c where c.id = p_company) as overhead_project,
      case when p_basis = 'invoiced' then 'invoiced' else 'cash' end as basis
  ),
  -- One pass over the company's lines feeds both the income weights and the overhead cost.
  lines as (
    select l.project_id, l.kind, l.pnl_role, l.direction, l.doc_kind, l.amount_net
    from private.pnl_lines l
    where l.company_id = (select id from cid)
      and l.currency = 'ILS'
      and l.in_pnl
      -- Only income and overhead lines feed the share. Filtering on them here lets the planner
      -- drop the company's project costs before it looks up any line's splits.
      and (l.kind = 'income' or l.pnl_role = 'overhead')
      and ((select basis from cid) = 'invoiced' or not l.unpaid)
      and private.pnl_in_range(l.kind, (select basis from cid), l.doc_date, l.cash_date, p_from, p_to)
      -- Only lines that can be income or overhead reach the view's per-line work: a line of an
      -- income kind or direction, filed to the overhead project, or split (its parts can be
      -- either). A superset: the filters above still decide.
      and l.transaction_id = any(array(
        select t.id
        from public.transactions t
        left join public.categories k on k.id = t.category_id
        where t.company_id = p_company
          and (t.direction = 'income' or k.kind = 'income' or t.pnl_role = 'overhead'
            or t.project_id = (select overhead_project from cid))
        union
        select s.transaction_id from private.split_parts s where s.company_id = p_company
        union
        select s.transaction_id from private.loan_parts s where s.company_id = p_company
      ))
  ),
  income as (
    select l.project_id, l.amount_net
    from lines l
    where l.kind = 'income'
      and (
        l.direction = 'expense'
        or ((select basis from cid) = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
        or ((select basis from cid) = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      )
      and l.project_id is not null
      and l.project_id is distinct from (select overhead_project from cid)
  ),
  totals as (
    select
      coalesce((select sum(i.amount_net) from income i), 0)::bigint as total_income,
      coalesce((
        select -sum(l.amount_net)::bigint
        from lines l
        where l.kind = 'expense' and l.pnl_role = 'overhead'
      ), 0) as overhead_cost
  ),
  rounded as (
    select
      p.id as project_id,
      p.name as project_name,
      s.income,
      (select overhead_cost from totals)::numeric * s.income / (select total_income from totals) as exact,
      private.round_agorot_shekel_hundreds(
        (select overhead_cost from totals)::numeric * s.income / (select total_income from totals)
      ) as rounded
    from public.projects p
    join (
      select i.project_id, sum(i.amount_net)::bigint as income
      from income i
      group by i.project_id
      having sum(i.amount_net) > 0
    ) s on s.project_id = p.id
    where p.company_id = (select id from cid)
      and (select id from cid) is not null
      and (select total_income from totals) <> 0
  ),
  chosen as (
    select r.project_id
    from rounded r
    order by
      case when (select max(x.exact - x.rounded) from rounded x) > 0 then (r.exact - r.rounded) end desc nulls last,
      case when (select max(x.exact - x.rounded) from rounded x) <= 0 then r.income end desc nulls last,
      r.project_name asc
    limit 1
  ),
  adjusted as (
    select
      r.project_id,
      r.rounded + case
        when r.project_id = (select c.project_id from chosen c)
          then (select overhead_cost from totals) - (select coalesce(sum(x.rounded), 0) from rounded x)
        else 0
      end as share
    from rounded r
  )
  select
    (select id from cid) is not null and (select total_income from totals) <> 0,
    case
      when (select id from cid) is null or (select total_income from totals) = 0 then null::bigint
      else coalesce((select a.share from adjusted a where a.project_id = p_project), 0)
    end;
$function$

;

create or replace function private.project_category_entries_by_currency(p_project uuid)
 RETURNS TABLE(category_id uuid, transaction_id uuid, description text, doc_date date, amount_net bigint, created_at timestamp with time zone, shared boolean, currency text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  -- Each branch reads the project's lines first and looks up each line's own rows by index
  -- (lateral, offset 0 so the planner can't flatten it), whatever row counts it guesses.
  select l.category_id, l.transaction_id, t.description, l.doc_date, l.amount_net, t.created_at, false, l.currency
  from private.pnl_lines l
  cross join lateral (
    select t.description, t.created_at
    from public.transactions t
    where t.id = l.transaction_id
      and not t.category_suggested
      and not exists (
        select 1
        from public.review_queue q
        where q.transaction_id = t.id
          and q.company_id = t.company_id
          and q.status = 'open'
      )
    offset 0
  ) t
  where l.project_id = p_project
    and l.transaction_id = any(array(
      select t2.id from public.transactions t2 where t2.project_id = p_project
      union
      select s2.transaction_id from private.split_parts s2 where s2.project_id = p_project
    ))
    and l.company_id = (select private.readable_company_id())
    and l.kind = 'expense'
    and l.pnl_role = 'project'
  union all
  select l.category_id, l.transaction_id, t.description, l.doc_date,
    case
      when l.part is null and l.amount_net = l.line_amount_net then a.amount_net
      else coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0)
    end,
    t.created_at, true, l.currency
  from private.pnl_lines l
  cross join lateral (
    select a.amount_net from public.allocations a
    where a.transaction_id = l.transaction_id and a.project_id = p_project
    offset 0
  ) a
  cross join lateral (
    select t.description, t.created_at
    from public.transactions t
    where t.id = l.transaction_id
      and not t.category_suggested
    offset 0
  ) t
  where l.transaction_id = any(array(
      select a2.transaction_id from public.allocations a2 where a2.project_id = p_project
    ))
    and l.company_id = (select private.readable_company_id())
    and l.kind = 'expense'
    and l.pnl_role = 'shared'
    and l.category_id is not null;
$function$

;

create or replace function private.project_category_months_many(p_projects uuid[], p_months integer, p_today date)
 RETURNS TABLE(project_id uuid, categories jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with bounds as (
    select date_trunc('month', p_today)::date as this_month,
      (date_trunc('month', p_today)::date - make_interval(months => p_months))::date as first_month,
      private.company_base_currency((select private.readable_company_id())) as base_currency
  ),
  entries as (
    select pr.id as project_id, e.category_id, e.currency, date_trunc('month', e.doc_date)::date as month,
      extract(day from e.doc_date)::integer as day, -e.amount_net as amount
    from bounds b
    cross join unnest(p_projects) pr(id)
    cross join lateral private.project_category_entries_by_currency(pr.id) e
    left join public.categories cat on cat.id = e.category_id
    join public.transactions lt on lt.id = e.transaction_id
    where e.doc_date >= b.first_month
      and e.doc_date < (b.this_month + interval '1 month')::date
      and private.line_in_pnl(
        case when not exists (select 1 from private.loan_parts ls where ls.transaction_id = lt.id)
          then lt.in_pnl_override end,
        cat.excluded_from_pnl, cat.loan_part
      )
  ),
  sums as (
    select e.project_id, e.category_id, e.currency, e.month, sum(e.amount)::bigint as amount
    from entries e
    group by e.project_id, e.category_id, e.currency, e.month
  ),
  keys as (
    select s.project_id, s.category_id, s.currency,
      coalesce(sum(s.amount) filter (where s.month = b.this_month), 0)::bigint as this_month_minor
    from sums s, bounds b
    group by s.project_id, s.category_id, s.currency
  ),
  per_month as (
    select k.project_id, k.category_id, k.currency, m::date as month, coalesce(s.amount, 0)::bigint as amount
    from keys k
    cross join bounds b
    cross join generate_series(b.first_month, b.this_month - interval '1 month', interval '1 month') m
    left join sums s on s.project_id = k.project_id and s.category_id is not distinct from k.category_id
      and s.currency = k.currency and s.month = m::date
  ),
  -- A month counts as seen only with a positive cost, so a refund-only month is not a cost.
  past as (
    select pm.project_id, pm.category_id, pm.currency,
      jsonb_agg(pm.amount order by pm.month) as months_minor,
      (count(*) filter (where pm.amount > 0))::integer as months_seen,
      round(percentile_cont(0.5) within group (order by pm.amount) filter (where pm.amount > 0))::bigint as median_minor
    from per_month pm
    group by pm.project_id, pm.category_id, pm.currency
  ),
  days as (
    select e.project_id, e.category_id, e.currency,
      round(percentile_cont(0.5) within group (order by e.day))::integer as typical_day
    from entries e, bounds b
    where e.month < b.this_month
    group by e.project_id, e.category_id, e.currency
  ),
  rows as (
    select k.project_id, k.category_id, k.currency, k.this_month_minor, p.months_minor, p.months_seen,
      p.median_minor, d.typical_day
    from keys k
    join past p on p.project_id = k.project_id and p.category_id is not distinct from k.category_id
      and p.currency = k.currency
    left join days d on d.project_id = k.project_id and d.category_id is not distinct from k.category_id
      and d.currency = k.currency
  )
  select r.project_id, jsonb_agg(jsonb_build_object(
      'id', r.category_id,
      'name', c.name,
      'group_name', c.group_name,
      'parent_id', c.parent_id,
      'currency', r.currency,
      'this_month_minor', r.this_month_minor,
      'months_minor', r.months_minor,
      'months_seen', r.months_seen,
      'expected_minor', case when r.months_seen >= 3 then r.median_minor end,
      'typical_day', r.typical_day,
      'flag', private.category_flag(
        r.currency, r.this_month_minor,
        case when r.months_seen >= 3 then r.median_minor end,
        r.months_seen, r.typical_day, p_today
      )
    ) order by r.currency is distinct from b.base_currency, r.currency, r.this_month_minor desc, c.name)
  from rows r
  cross join bounds b
  left join public.categories c on c.id = r.category_id
  group by r.project_id;
$function$

;

create or replace function private.project_is_empty(p_company uuid, p_project uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select not exists (
    select 1 from public.transactions t
    where t.company_id = p_company and t.project_id = p_project
  ) and not exists (
    select 1 from public.allocations a
    where a.company_id = p_company and a.project_id = p_project
  ) and not exists (
    select 1 from private.split_parts s
    where s.company_id = p_company and s.project_id = p_project
  ) and not exists (
    select 1 from public.split_rule_targets r
    where r.company_id = p_company and r.project_id = p_project
  ) and not exists (
    select 1 from public.suppliers sup
    where sup.company_id = p_company and sup.remembered_project_id = p_project
  ) and not exists (
    select 1 from public.loans l
    where l.company_id = p_company and l.project_id = p_project
  );
$function$

;

create or replace function private.project_line_ids(p_company uuid, p_project uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select array(
    select t.id from public.transactions t where t.company_id = p_company and t.project_id = p_project
    union
    select a.transaction_id from public.allocations a where a.company_id = p_company and a.project_id = p_project
    union
    select s.transaction_id from private.split_parts s where s.company_id = p_company and s.project_id = p_project
  );
$function$

;
