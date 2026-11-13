-- FLOW-1171 (perf queue, decision 0230): the project page read, faster, the same figures.
--
-- 1. private.project_investment called private.line_in_cash per line: a SQL function that is not
--    inlined and re-reads the line (RLS checked) for every row, 0.29 ms each. The costs query now
--    joins the line once and reads the same rule from it (the owner's switch on the line, else the
--    category; a guessed category does not take a line out). The direct branch read the whole
--    company's lines through private.pnl_lines; it now reads the project's own, as the shared
--    branch does. private.line_in_cash has no other caller and is dropped.
-- 2. get_project(uuid, text, date, date, boolean): p_lines (default true) false leaves out what
--    the app never reads: transactions (the 40 newest lines), the roll-up arrays,
--    excluded_categories_by_currency, pending_agorot and pending_other_currencies. The default
--    answer, which flow-mcp gets, is exactly today's. The four-argument signature is replaced.

begin;

create or replace function private.project_investment(p_company_id uuid, p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  p record;
  cur text;
  rehab bigint;
  rehab_other jsonb;
  rehab_rows jsonb;
  loan_balance bigint;
  loan_other jsonb;
begin
  select pr.investment_currency, pr.purchase_minor, pr.arv_minor, pr.value_minor, pr.value_date into p
  from public.projects pr
  where pr.id = p_project_id and pr.company_id = p_company_id;
  if not found then
    return null;
  end if;
  cur := p.investment_currency;

  with costs as (
    select l.currency, l.category_id, l.amount_net
    from private.pnl_lines l
    join public.transactions t on t.id = l.transaction_id
    left join public.categories c on c.id = l.category_id
    -- The lines this project can have as its own: filed to it, or one part given to it.
    where l.transaction_id = any(array(
        select t0.id from public.transactions t0
        where t0.company_id = p_company_id and t0.project_id = p_project_id
        union
        select g.transaction_id from public.legs g
        where g.company_id = p_company_id and g.project_explicit and g.project_id = p_project_id
      ))
      and l.company_id = p_company_id
      and l.project_id = p_project_id
      and l.kind = 'expense'
      and l.pnl_role = 'project'
      and not l.unpaid
      and private.category_in_rehab(c.rehab, c.excluded_from_pnl, coalesce(c.loan_part, l.part))
      -- As the cash view counts the part (decision 0170): the owner's switch on the line, else the
      -- category; a guessed category does not take a line out. Read from the joined line, not per row.
      and coalesce(t.in_cash_override, not private.line_category_out(
        c.in_cash is false and c.company_id = t.company_id,
        t.category_suggested and l.category_id is not distinct from t.category_id,
        l.part
      ))
    union all
    select l.currency, l.category_id, coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0)
    from private.pnl_lines l
    cross join lateral (
      select a.amount_net from public.allocations a
      where a.transaction_id = l.transaction_id and a.project_id = p_project_id
      offset 0 -- keeps this a per-line lookup
    ) a
    join public.transactions t on t.id = l.transaction_id
    left join public.categories c on c.id = l.category_id
    where l.transaction_id = any(array(
        select a2.transaction_id from public.allocations a2
        where a2.company_id = p_company_id and a2.project_id = p_project_id
      ))
      and l.company_id = p_company_id
      and l.kind = 'expense'
      and l.pnl_role = 'shared'
      and not l.unpaid
      and private.category_in_rehab(c.rehab, c.excluded_from_pnl, coalesce(c.loan_part, l.part))
      -- As the cash view counts the part (decision 0170): the owner's switch on the line, else the
      -- category; a guessed category does not take a line out. Read from the joined line, not per row.
      and coalesce(t.in_cash_override, not private.line_category_out(
        c.in_cash is false and c.company_id = t.company_id,
        t.category_suggested and l.category_id is not distinct from t.category_id,
        l.part
      ))
  ),
  by_currency as (
    select x.currency, (-sum(x.amount_net))::bigint as amount_minor
    from costs x
    group by x.currency
  ),
  -- FLOW-404: the project-currency total by category, from the same lines, so the list adds
  -- up to rehab_minor. A line with no category is one row with a null id.
  by_category as (
    select x.category_id, (-sum(x.amount_net))::bigint as amount_minor
    from costs x
    where x.currency = cur
    group by x.category_id
  )
  select
    coalesce((select b.amount_minor from by_currency b where b.currency = cur), 0),
    coalesce((
      select jsonb_agg(jsonb_build_object('currency', b.currency, 'amount_minor', b.amount_minor) order by b.currency)
      from by_currency b
      where b.currency <> cur and b.amount_minor <> 0
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'category_id', g.category_id,
        'name', c.name,
        'hidden', coalesce(c.hidden, false),
        'amount_minor', g.amount_minor
      ) order by g.amount_minor desc, c.name nulls last, g.category_id)
      from by_category g
      left join public.categories c on c.id = g.category_id and c.company_id = p_company_id
      where g.amount_minor <> 0
    ), '[]'::jsonb)
  into rehab, rehab_other, rehab_rows;

  select coalesce(sum(b.balance_minor), 0)::bigint into loan_balance
  from public.loans l
  join public.loan_balances b on b.company_id = l.company_id and b.loan_id = l.id
  where l.company_id = p_company_id
    and l.project_id = p_project_id
    and l.status = 'open'::public.loan_status
    and l.currency = cur;

  select coalesce(jsonb_agg(jsonb_build_object('currency', x.currency, 'balance_minor', x.balance_minor)
           order by x.currency), '[]'::jsonb)
  into loan_other
  from (
    select l.currency, sum(b.balance_minor)::bigint as balance_minor
    from public.loans l
    join public.loan_balances b on b.company_id = l.company_id and b.loan_id = l.id
    where l.company_id = p_company_id
      and l.project_id = p_project_id
      and l.status = 'open'::public.loan_status
      and l.currency <> cur
    group by l.currency
    having sum(b.balance_minor) <> 0
  ) x;

  return jsonb_build_object(
    'currency', cur,
    'purchase_minor', p.purchase_minor,
    'arv_minor', p.arv_minor,
    'value_minor', p.value_minor,
    'value_date', p.value_date,
    'rehab_minor', rehab,
    'rehab_by_category', rehab_rows,
    'rehab_other_currencies', rehab_other,
    'loan_balance_minor', loan_balance,
    'loan_balance_other_currencies', loan_other,
    'forced_equity_minor', case when rehab_other = '[]'::jsonb then p.arv_minor - p.purchase_minor - rehab end,
    'current_equity_minor', case when loan_other = '[]'::jsonb then p.value_minor - loan_balance end
  );
end;
$function$;

drop function private.line_in_cash(uuid, uuid, public.loan_split_part);

drop function public.get_project(uuid, text, date, date);

create function public.get_project(p_id uuid, p_basis text, p_from date default null::date, p_to date default null::date, p_lines boolean default true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET plan_cache_mode TO 'force_generic_plan'
AS $$
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
    'pending_count', coalesce(jsonb_array_length(waiting), 0)
  ) || case when p_lines then jsonb_build_object(
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
  ) else '{}'::jsonb end
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
    'categories_by_currency', private.category_rows_with_parent(result->'categories_by_currency', cid)
  );
  -- FLOW-1171: the app reads none of these. It asks with p_lines false; flow-mcp keeps the default.
  if p_lines then
    result := result || jsonb_build_object(
      'excluded_categories_by_currency', private.category_rows_with_parent(cats_out, cid),
      'category_rollups', private.category_rollup_rows(cats_ils, 'amount_agorot', cid),
      'category_rollups_by_currency', private.category_rollup_rows(cats_in, 'amount_minor', cid),
      'excluded_category_rollups_by_currency', private.category_rollup_rows(cats_out, 'amount_minor', cid)
    );
  end if;
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
$$;

revoke all on function public.get_project(uuid, text, date, date, boolean) from public, anon;
grant execute on function public.get_project(uuid, text, date, date, boolean) to authenticated, service_role;

commit;
