-- FLOW-1205 (20261114123417): get_project's lean answer (p_lines false, the app's) leaves out what no app reader has.
-- - investment.rehab_by_category[].hidden: no app reader (the returns screen reads the rest of the row, in the lean answer).
-- - from and to (the period echo), with no app reader.
-- With lines (flow-mcp's default) the answer is exactly what it was, rehab_by_category[].hidden, from and to included.
-- Checked against pg_temp.old_get_project, a copy of the previous body (20261113163849) made here: the lines answer
-- equals it, the lean one equals its lean answer less those keys. Invented data only. Amounts are agorot.

begin;

select plan(24);

do $users$
begin
  perform tests.create_supabase_user('lg_owner', 'lg-owner@example.com');
  perform tests.create_supabase_user('lg_other', 'lg-other@example.com');
end
$users$;

create temp table lg (label text primary key, id uuid);
grant all on lg to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from pg_temp.lg where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into lg (label, id) values ('co', tests.fixture_company('lg_owner', 'Example Lean Project LLC'));
insert into lg (label, id) values ('other_co', tests.fixture_company('lg_other', 'Example Other Lean LLC'));
insert into lg (label, id) values
  ('house', tests.fixture_project(pg_temp.id('co'), 'Example House')),
  ('barn', tests.fixture_project(pg_temp.id('co'), 'Example Barn')),
  ('shed', tests.fixture_project(pg_temp.id('co'), 'Example Shed')),
  ('other_house', tests.fixture_project(pg_temp.id('other_co'), 'Example Other House')),
  ('materials', tests.fixture_category(pg_temp.id('co'), 'Materials')),
  ('tiles', tests.fixture_category(pg_temp.id('co'), 'Tiles')),
  ('sales', tests.fixture_category(pg_temp.id('co'), 'Sales', 'income'));
update public.categories set parent_id = pg_temp.id('materials') where id = pg_temp.id('tiles');
-- Tiles is hidden (archived) but still has cost on the house: its rehab row says hidden.
update public.categories set hidden = true where id = pg_temp.id('tiles');

-- The house: materials, tiles, a line with no category, a pending one and income. The barn: dollars, and a share of
-- a shared line.
insert into lg (label, id) values
  ('m1', tests.fixture_line(pg_temp.id('co'), 'lg:m1', 100000, p_project => pg_temp.id('house'), p_category => pg_temp.id('materials'), p_doc_date => '2026-06-10')),
  ('t1', tests.fixture_line(pg_temp.id('co'), 'lg:t1', 25000, p_project => pg_temp.id('house'), p_category => pg_temp.id('tiles'), p_doc_date => '2026-07-10')),
  ('n1', tests.fixture_line(pg_temp.id('co'), 'lg:n1', 20000, p_project => pg_temp.id('house'), p_doc_date => '2026-06-20')),
  ('pend', tests.fixture_line(pg_temp.id('co'), 'lg:pend', 3000, p_project => pg_temp.id('house'), p_category => pg_temp.id('materials'), p_line_status => 'pending')),
  ('inc', tests.fixture_line(pg_temp.id('co'), 'lg:inc', 99900, 'income', pg_temp.id('house'), pg_temp.id('sales'))),
  ('usd', tests.fixture_line(pg_temp.id('co'), 'lg:usd', 5000, p_project => pg_temp.id('barn'), p_category => pg_temp.id('materials'), p_currency => 'USD')),
  ('s1', tests.fixture_line(pg_temp.id('co'), 'lg:s1', 40000, p_category => pg_temp.id('materials'), p_pnl_role => 'shared'));
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net) values
  (pg_temp.id('co'), pg_temp.id('s1'), pg_temp.id('house'), 2500, -10000),
  (pg_temp.id('co'), pg_temp.id('s1'), pg_temp.id('barn'), 7500, -30000);

create function pg_temp.old_get_project(p_id uuid, p_basis text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_lines boolean DEFAULT true)
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
      'amount_agorot', s.amount
    ) || case when p_lines then jsonb_build_object('has_shared_share', s.shared) else '{}'::jsonb end
    order by s.amount desc, c.name) filter (where s.in_pnl and s.currency = 'ILS'), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'currency', s.currency,
      'id', c.id,
      'name', c.name,
      'amount_minor', s.amount
    ) || case when p_lines then jsonb_build_object('has_shared_share', s.shared) else '{}'::jsonb end
    order by s.currency, s.amount desc, c.name) filter (where s.in_pnl), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'currency', s.currency,
      'id', c.id,
      'name', c.name,
      'amount_minor', s.amount
    ) || case when p_lines then jsonb_build_object('has_shared_share', s.shared) else '{}'::jsonb end
    order by s.currency, s.amount desc, c.name) filter (where not s.in_pnl), '[]'::jsonb)
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
    'pending_count', coalesce(jsonb_array_length(waiting), 0)
  ) || case when p_lines then jsonb_build_object(
    'sumit_budget_section_id', p.sumit_budget_section_id,
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
    'profit_after_overhead_agorot', profit - case when coalesce(available, false) then coalesce(share, 0) else 0 end,
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
$function$;
grant execute on function pg_temp.old_get_project(uuid, text, date, date, boolean) to authenticated;

create function pg_temp.new(p_project text, p_basis text, p_lines boolean, p_from date default null, p_to date default null)
returns jsonb language sql stable as $$
  select public.get_project(pg_temp.id(p_project), p_basis, p_from, p_to, p_lines);
$$;
grant execute on function pg_temp.new(text, text, boolean, date, date) to authenticated;

create function pg_temp.old(p_project text, p_basis text, p_lines boolean, p_from date default null, p_to date default null)
returns jsonb language sql stable as $$
  select pg_temp.old_get_project(pg_temp.id(p_project), p_basis, p_from, p_to, p_lines);
$$;
grant execute on function pg_temp.old(text, text, boolean, date, date) to authenticated;

-- The previous lean answer as the lean one gives it now: no from or to, and no hidden on the rehab rows.
create function pg_temp.as_lean(p_old jsonb) returns jsonb language sql immutable as $$
  select case when p_old is null then null
    else (p_old - 'from' - 'to') || jsonb_build_object('investment',
      jsonb_set(p_old->'investment', '{rehab_by_category}', coalesce(
        (select jsonb_agg(e - 'hidden' order by o) from jsonb_array_elements(p_old->'investment'->'rehab_by_category') with ordinality t(e, o)), '[]'::jsonb))) end;
$$;
grant execute on function pg_temp.as_lean(jsonb) to authenticated;

select tests.authenticate_as('lg_owner');

-- The lines form (flow-mcp's): exactly what it was.
select is(pg_temp.new('house', 'cash', true), pg_temp.old('house', 'cash', true), 'with lines: the house, cash, is the previous answer');
select is(pg_temp.new('house', 'invoiced', true), pg_temp.old('house', 'invoiced', true), 'the house, invoiced');
select is(pg_temp.new('barn', 'cash', true), pg_temp.old('barn', 'cash', true), 'the barn (a shared share, a cost in dollars)');
select is(pg_temp.new('shed', 'cash', true), pg_temp.old('shed', 'cash', true), 'the shed (no lines)');
select is(pg_temp.new('house', 'cash', true, '2026-06-01', '2026-06-30'), pg_temp.old('house', 'cash', true, '2026-06-01', '2026-06-30'),
  'a period: from and to are echoed, as before');
select is(public.get_project(pg_temp.id('house'), 'cash'), pg_temp.old('house', 'cash', true), 'the default (flow-mcp''s) is the lines form');
select ok(jsonb_array_length(pg_temp.new('house', 'cash', true)->'investment'->'rehab_by_category') = 3
    and (select bool_or((r->>'hidden')::boolean) and not bool_and((r->>'hidden')::boolean)
         from jsonb_array_elements(pg_temp.new('house', 'cash', true)->'investment'->'rehab_by_category') r),
  'the lines form has rehab_by_category (Materials, Tiles and the line with no category) with hidden on each row: the archived Tiles true, the rest false');
select is(pg_temp.new('house', 'cash', true)->'from', 'null'::jsonb, 'with lines and no period, from is null');
select is(pg_temp.new('house', 'cash', true, '2026-06-01', '2026-06-30')->>'to', '2026-06-30', 'and to is the period''s');

-- The lean form (the app's): the previous lean answer less the keys.
select is(pg_temp.new('house', 'cash', false), pg_temp.as_lean(pg_temp.old('house', 'cash', false)), 'lean: the house, cash, is the previous lean answer less from, to and hidden on the rehab rows');
select is(pg_temp.new('house', 'invoiced', false), pg_temp.as_lean(pg_temp.old('house', 'invoiced', false)), 'the house, invoiced');
select is(pg_temp.new('barn', 'cash', false), pg_temp.as_lean(pg_temp.old('barn', 'cash', false)), 'the barn');
select is(pg_temp.new('shed', 'cash', false), pg_temp.as_lean(pg_temp.old('shed', 'cash', false)), 'the shed');
select is(pg_temp.new('house', 'cash', false, '2026-06-01', '2026-06-30'),
  pg_temp.as_lean(pg_temp.old('house', 'cash', false, '2026-06-01', '2026-06-30')), 'a period');
select ok(not (pg_temp.new('house', 'cash', false, '2026-06-01', '2026-06-30') ?| array['from', 'to']),
  'the lean answer has no from or to, with a period or without');
select ok(jsonb_array_length(pg_temp.new('house', 'cash', false)->'investment'->'rehab_by_category') = 3
    and not exists (select 1 from jsonb_array_elements(pg_temp.new('house', 'cash', false)->'investment'->'rehab_by_category') r where r ? 'hidden')
    and (select array_agg(r->>'category_id' order by o) from jsonb_array_elements(pg_temp.new('house', 'cash', false)->'investment'->'rehab_by_category') with ordinality t(r, o))
      is not distinct from (select array_agg(r->>'category_id' order by o) from jsonb_array_elements(pg_temp.new('house', 'cash', true)->'investment'->'rehab_by_category') with ordinality t(r, o)),
  'the lean answer keeps the three rehab rows (category_id, name, amount_minor), in the same order, with no hidden');
select is(pg_temp.new('house', 'cash', false)->'investment'->'rehab_by_category'->0 ?& array['category_id', 'name', 'amount_minor'], true,
  'a lean rehab row has the three keys the returns screen reads');
select ok(octet_length(pg_temp.new('house', 'cash', false)::text) < octet_length(pg_temp.old('house', 'cash', false)::text),
  'the lean answer is smaller than the previous one');
select is(pg_temp.new('house', 'cash', false)->'investment'->>'rehab_minor', pg_temp.new('house', 'cash', true)->'investment'->>'rehab_minor',
  'rehab_minor is the same in both forms');
select is(pg_temp.new('house', 'cash', false)->>'profit_agorot', pg_temp.old('house', 'cash', true)->>'profit_agorot', 'profit is the same in both');

-- The other company's project, and a viewer-less company: refused as before.
select is(pg_temp.new('other_house', 'cash', false), null::jsonb, 'another company''s project is not read (lean)');
select is(pg_temp.new('other_house', 'cash', true), null::jsonb, 'and with lines');
select is(pg_temp.old('other_house', 'cash', true), null::jsonb, 'as before');

select tests.authenticate_as('lg_other');
select is(pg_temp.new('house', 'cash', true), null::jsonb, 'the other company''s owner does not read the house');

select * from finish();
rollback;
