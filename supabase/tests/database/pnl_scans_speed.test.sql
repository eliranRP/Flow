-- Fewer pnl_lines passes, same results (20261019124024): get_profit_months (project and company),
-- company_pnl, get_dashboard, projects_cash_month, get_project's overhead share and kept_out, and
-- get_home give exactly what their previous bodies give. The previous bodies are kept below as
-- pg_temp references, or their formulas inline. The fixture has two after-overhead projects, ILS
-- and USD, receipts paid a month late, invoices, a refund, shared lines with allocations, split
-- lines, kept-out lines, pending lines, unpaid bills and unassigned lines. Invented data only.

begin;

select plan(22);

do $users$
begin
  perform tests.create_supabase_user('ps_owner', 'ps-owner@example.com');
  perform tests.create_supabase_user('ps_plain', 'ps-plain@example.com');
end
$users$;

create temp table ps (label text primary key, id uuid);
grant all on ps to authenticated, service_role;

do $fixture$
declare
  co uuid;
  lots uuid[] := '{}';
  office uuid;
  inc uuid; exp uuid; outc uuid;
  i int; m int; ln uuid; d date;
begin
  co := tests.fixture_company('ps_owner', 'Example Scans LLC');
  for i in 1..4 loop
    lots := lots || tests.fixture_project(co, 'Scan Lot ' || i);
  end loop;
  office := tests.fixture_project(co, 'Scan Office');
  update public.companies set overhead_project_id = office where id = co;
  update public.projects set after_overhead = true where id in (lots[1], lots[2]);
  inc := tests.fixture_category(co, 'Scan Sales', 'income');
  exp := tests.fixture_category(co, 'Scan Materials');
  outc := tests.fixture_category(co, 'Scan Personal', 'expense', true);
  insert into ps values ('co', co), ('lot1', lots[1]), ('lot2', lots[2]), ('lot3', lots[3]), ('office', office);
  for m in 0..5 loop
    d := ('2026-08-15'::date - make_interval(months => m))::date;
    for i in 1..4 loop
      -- Lots 3 and 4 earn the same on the same days, so the remainder pick falls to the name.
      ln := tests.fixture_line(co, 'ps:in:' || m || ':' || i, 400000 + least(i, 3) * 13000 + m * 700, 'income',
        lots[i], inc, d - least(i, 3), 'ILS', 'posted', 'manual', 'project', 'receipt');
      if i <= 2 and (i + m) % 3 = 0 then
        update public.transactions set cash_date = doc_date + 25 where id = ln;
      end if;
      perform tests.fixture_line(co, 'ps:ex:' || m || ':' || i, 150000 + i * 6100 + m * 300, 'expense',
        lots[i], exp, d - i, 'ILS', 'posted', 'manual', 'project', 'receipt');
    end loop;
    for i in 1..2 loop
      perform tests.fixture_line(co, 'ps:usd-in:' || m || ':' || i, 80000 + m * 500 + i * 3, 'income',
        lots[i], inc, d - 3, 'USD', 'posted', 'manual', 'project', 'invoice_receipt');
      perform tests.fixture_line(co, 'ps:usd-ex:' || m || ':' || i, 20000 + m * 100, 'expense',
        lots[i], exp, d - 4, 'USD', 'posted', 'manual', 'project', 'receipt');
    end loop;
    perform tests.fixture_line(co, 'ps:inv:' || m, 222223 + m * 77, 'income', lots[1 + m % 4], inc,
      d - 6, 'ILS', 'posted', 'manual', 'project', 'invoice');
    perform tests.fixture_line(co, 'ps:oh:' || m, 98765 + m * 91, 'expense', office, exp,
      d - 2, 'ILS', 'posted', 'manual', 'project', 'receipt');
    perform tests.fixture_line(co, 'ps:oh-usd:' || m, 34567 + m * 13, 'expense', office, exp,
      d - 5, 'USD', 'posted', 'manual', 'project', 'receipt');
    ln := tests.fixture_line(co, 'ps:shared:' || m, 100001 + m * 37, 'expense', null, exp,
      d - 7, 'ILS', 'posted', 'manual', 'shared', 'receipt');
    insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net) values
      (co, ln, lots[1], 5000, -div(100001 + m * 37, 2)),
      (co, ln, lots[3], 5000, -((100001 + m * 37) - div(100001 + m * 37, 2)));
    ln := tests.fixture_line(co, 'ps:split:' || m, 90000 + m * 11, 'expense', null, exp,
      d - 8, 'ILS', 'posted', 'manual', 'project', 'receipt');
    insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor) values
      (co, ln, 1, exp, lots[2], 40000),
      (co, ln, 2, exp, lots[4], 30000 + m * 11),
      (co, ln, 3, exp, office, 20000);
    perform tests.fixture_line(co, 'ps:out:' || m, 55555 + m, 'expense', lots[3], outc,
      d - 9, 'ILS', 'posted', 'manual', 'project', 'receipt');
    ln := tests.fixture_line(co, 'ps:out-in:' || m, 66666 + m, 'income', lots[4], inc,
      d - 9, 'ILS', 'posted', 'manual', 'project', 'receipt');
    update public.transactions set in_pnl_override = false where id = ln;
    perform tests.fixture_line(co, 'ps:pending:' || m, 44444 + m, 'expense', lots[1], exp,
      d - 10, 'ILS', 'pending', 'manual', 'project', 'receipt');
    -- An unpaid supplier invoice: counted on the invoiced basis only.
    ln := tests.fixture_line(co, 'ps:bill:' || m, 33333 + m, 'expense', lots[2], exp,
      d - 12, 'ILS', 'posted', 'manual', 'project', 'invoice');
    update public.transactions set cash_date = null where id = ln;
    perform tests.fixture_line(co, 'ps:un:' || m, 11111 + m, 'expense', null, null,
      d - 1, 'ILS', 'posted', 'manual', null, 'receipt');
    perform tests.fixture_line(co, 'ps:un-in:' || m, 77777 + m, 'income', null, inc,
      d - 11, 'ILS', 'posted', 'manual', null, 'receipt');
  end loop;
  -- A refund: an income-category line paid out, on a lot after overhead.
  perform tests.fixture_line(co, 'ps:refund', 25000, 'expense', lots[2], inc,
    '2026-07-20', 'ILS', 'posted', 'manual', 'project', 'receipt');
  -- December 2025: every share rounds up (9,000 to 10,000; 15,001 to 20,000), so the remainder
  -- goes by income, to Lot 4, not by rounding gap. January 2026: overhead and no income.
  -- February 2026: a refund larger than the month's income, so total income is negative.
  perform tests.fixture_line(co, 'ps:edge:in3', 90000, 'income', lots[3], inc, '2025-12-10');
  perform tests.fixture_line(co, 'ps:edge:in4', 150010, 'income', lots[4], inc, '2025-12-11');
  perform tests.fixture_line(co, 'ps:edge:oh12', 24001, 'expense', office, exp, '2025-12-12');
  perform tests.fixture_line(co, 'ps:edge:oh01', 50000, 'expense', office, exp, '2026-01-12');
  perform tests.fixture_line(co, 'ps:edge:refund', 300000, 'expense', lots[1], inc, '2026-02-10');
  perform tests.fixture_line(co, 'ps:edge:in2', 100000, 'income', lots[2], inc, '2026-02-11');
  perform tests.fixture_line(co, 'ps:edge:oh02', 70000, 'expense', office, exp, '2026-02-12');

  -- A company with no overhead project: its overhead is lines marked overhead.
  co := tests.fixture_company('ps_plain', 'Example Plain LLC');
  lots := array[tests.fixture_project(co, 'Plain Lot A'), tests.fixture_project(co, 'Plain Lot B')];
  inc := tests.fixture_category(co, 'Plain Sales', 'income');
  exp := tests.fixture_category(co, 'Plain Rent');
  insert into ps values ('plain', co);
  for m in 0..1 loop
    d := ('2026-08-15'::date - make_interval(months => m))::date;
    perform tests.fixture_line(co, 'pp:in:a' || m, 120000 + m, 'income', lots[1], inc, d);
    perform tests.fixture_line(co, 'pp:in:b' || m, 70000, 'income', lots[2], inc, d);
    perform tests.fixture_line(co, 'pp:oh:' || m, 33333 + m, 'expense', lots[1], exp, d, 'ILS', 'posted', 'manual', 'overhead');
  end loop;
end
$fixture$;

-- The previous bodies, as references.
-- overhead_share_for's base-currency overload (dropped by 20261019124024), as 20261014093004 left it.
create function pg_temp.ref_share_for(p_company uuid, p_project uuid, p_basis text, p_from date, p_to date, p_currency text)
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
  lines as (
    select l.project_id, l.kind, l.pnl_role, l.direction, l.doc_kind, l.amount_net
    from private.pnl_lines l
    where l.company_id = (select id from cid)
      and l.currency = p_currency
      and l.in_pnl
      and (l.kind = 'income' or l.pnl_role = 'overhead')
      and ((select basis from cid) = 'invoiced' or not l.unpaid)
      and private.pnl_in_range(l.kind, (select basis from cid), l.doc_date, l.cash_date, p_from, p_to)
      and l.transaction_id = any(array(
        select t.id
        from public.transactions t
        left join public.categories k on k.id = t.category_id
        where t.company_id = p_company
          and (t.direction = 'income' or k.kind = 'income' or t.pnl_role = 'overhead'
            or t.project_id = (select overhead_project from cid))
        union
        select s.transaction_id from public.line_splits s where s.company_id = p_company
        union
        select s.transaction_id from public.loan_splits s where s.company_id = p_company
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
$function$;

-- The live get_profit_months before 20261019124024 (20261009120000 as patched by 20261011120000 and
-- 20261014064928): two overhead_share_for passes per month.
create function pg_temp.ref_profit_months(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_basis text DEFAULT NULL::text, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  basis text;
  result jsonb;
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

  with src as (
    select
      l.*,
      case when l.kind = 'income' and basis = 'cash' then coalesce(l.cash_date, l.doc_date) else l.doc_date end as d
    from private.pnl_lines l
    where l.company_id = cid
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
  overhead as (
    select m.month, o.available, o.share_agorot
    from months m
    cross join lateral private.overhead_share_for(cid, p_project_id, basis, m.mfrom, m.mto) o
    where p_project_id is not null
  ),
  overhead_base as (
    select m.month, o.available, o.share_agorot
    from months m
    cross join lateral pg_temp.ref_share_for(cid, p_project_id, basis, m.mfrom, m.mto, private.company_base_currency(cid)) o
    where p_project_id is not null
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
$function$;

-- 20261018085732's company_pnl (without its caller check): six passes over pnl_lines.
create function pg_temp.ref_company_pnl(p_company_id uuid, p_from date, p_to date, p_basis text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  basis text;
  result jsonb;
begin
  if p_company_id is null or not exists (select 1 from public.companies where id = p_company_id) then
    return null;
  end if;
  basis := case when p_basis = 'invoiced' then 'invoiced' else 'cash' end;

  with bounds as (
    select
      p_from as dfrom,
      p_to as dto,
      case
        when p_from is null or p_to is null then null
        else (p_from - ((p_to - p_from) + 1))
      end as pfrom,
      case when p_from is null or p_to is null then null else (p_from - 1) end as pto
  ),
  income as (
    select
      l.project_id,
      l.amount_net,
      l.in_pnl,
      case
        when (select dfrom from bounds) is null then true
        when basis = 'cash' then coalesce(l.cash_date, l.doc_date) between (select dfrom from bounds) and (select dto from bounds)
        else l.doc_date between (select dfrom from bounds) and (select dto from bounds)
      end as in_period,
      case
        when (select pfrom from bounds) is null then false
        when basis = 'cash' then coalesce(l.cash_date, l.doc_date) between (select pfrom from bounds) and (select pto from bounds)
        else l.doc_date between (select pfrom from bounds) and (select pto from bounds)
      end as in_prev
    from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
    where l.company_id = p_company_id
      and l.currency = 'ILS'
      and l.kind = 'income'
      and (
        l.direction = 'expense'
        or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
        or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      )
  ),
  expense as (
    select
      l.transaction_id as id,
      l.project_id,
      l.pnl_role,
      l.amount_net,
      l.line_amount_net,
      l.in_pnl,
      l.unassigned,
      l.doc_date,
      case
        when (select dfrom from bounds) is null then true
        else l.doc_date between (select dfrom from bounds) and (select dto from bounds)
      end as in_period,
      case
        when (select pfrom from bounds) is null then false
        else l.doc_date between (select pfrom from bounds) and (select pto from bounds)
      end as in_prev
    from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
    where l.company_id = p_company_id
      and l.currency = 'ILS'
      and l.kind = 'expense'
  ),
  shared_alloc as (
    select
      a.project_id,
      coalesce(private.div_half_even(a.amount_net::numeric * e.amount_net, e.line_amount_net), 0) as amount_net,
      e.in_period,
      e.in_prev
    from public.allocations a
    join expense e on e.id = a.transaction_id
    where e.pnl_role = 'shared'
      and e.in_pnl
  ),
  income_all as (
    select
      l.project_id,
      l.currency,
      l.amount_net,
      l.in_pnl,
      l.unassigned,
      case
        when (select dfrom from bounds) is null then true
        when basis = 'cash' then coalesce(l.cash_date, l.doc_date) between (select dfrom from bounds) and (select dto from bounds)
        else l.doc_date between (select dfrom from bounds) and (select dto from bounds)
      end as in_period,
      case
        when (select pfrom from bounds) is null then false
        when basis = 'cash' then coalesce(l.cash_date, l.doc_date) between (select pfrom from bounds) and (select pto from bounds)
        else l.doc_date between (select pfrom from bounds) and (select pto from bounds)
      end as in_prev
    from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
    where l.company_id = p_company_id
      and l.kind = 'income'
      and (
        l.direction = 'expense'
        or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
        or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      )
  ),
  expense_all as (
    select
      l.transaction_id as id,
      l.project_id,
      l.pnl_role,
      l.currency,
      l.amount_net,
      l.line_amount_net,
      l.in_pnl,
      l.loan_split_fallback,
      l.unassigned,
      l.doc_date,
      case
        when (select dfrom from bounds) is null then true
        else l.doc_date between (select dfrom from bounds) and (select dto from bounds)
      end as in_period,
      case
        when (select pfrom from bounds) is null then false
        else l.doc_date between (select pfrom from bounds) and (select pto from bounds)
      end as in_prev
    from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
    where l.company_id = p_company_id
      and l.kind = 'expense'
  ),
  shared_alloc_all as (
    select
      a.project_id,
      e.currency,
      coalesce(private.div_half_even(a.amount_net::numeric * e.amount_net, e.line_amount_net), 0) as amount_net,
      e.in_period,
      e.in_prev
    from public.allocations a
    join expense_all e on e.id = a.transaction_id
    where e.pnl_role = 'shared'
      and e.in_pnl
  ),
  unassigned_by_currency as (
    select
      parts.currency,
      coalesce(sum(parts.income_net), 0)::bigint as unassigned_income_minor,
      -coalesce(sum(parts.expense_net), 0)::bigint as unassigned_expense_minor
    from (
      select i.currency, i.amount_net as income_net, 0::bigint as expense_net
      from income_all i
      where i.in_period and i.in_pnl and i.unassigned
      union all
      select e.currency, 0::bigint, e.amount_net
      from expense_all e
      where e.in_period and e.in_pnl and e.unassigned
    ) parts
    group by parts.currency
  ),
  fallback_by_currency as (
    select e.currency, count(distinct e.id)::integer as fallback_count
    from expense_all e
    where e.in_period and e.loan_split_fallback
    group by e.currency
  ),
  excluded_by_currency as (
    select
      parts.currency,
      coalesce(sum(parts.excluded_income), 0)::bigint as excluded_income_minor,
      coalesce(sum(parts.excluded_expense), 0)::bigint as excluded_expense_minor,
      coalesce(sum(parts.excluded_count), 0)::integer as excluded_count
    from (
      select i.currency, i.amount_net as excluded_income, 0::bigint as excluded_expense, 1 as excluded_count
      from income_all i
      where i.in_period and not i.in_pnl
      union all
      select e.currency, 0::bigint, (-e.amount_net)::bigint, 1
      from expense_all e
      where e.in_period and not e.in_pnl
    ) parts
    group by parts.currency
  ),
  prev_currency as (
    select
      parts.currency,
      coalesce(sum(parts.income_net), 0)::bigint as income_minor,
      -coalesce(sum(parts.expense_net), 0)::bigint as expense_minor
    from (
      select i.currency, i.amount_net as income_net, 0::bigint as expense_net
      from income_all i
      where i.in_prev and i.in_pnl
      union all
      select e.currency, 0::bigint, e.amount_net
      from expense_all e
      where e.in_prev and e.in_pnl
    ) parts
    group by parts.currency
  ),
  company_currency as (
    select
      parts.currency,
      coalesce(sum(parts.income_net), 0)::bigint as income_minor,
      -coalesce(sum(parts.direct_net), 0)::bigint as direct_minor,
      -coalesce(sum(parts.shared_net), 0)::bigint as shared_minor,
      -coalesce(sum(parts.overhead_net), 0)::bigint as overhead_minor,
      -coalesce(sum(parts.expense_net), 0)::bigint as expense_minor,
      (coalesce(sum(parts.income_net), 0) + coalesce(sum(parts.expense_net), 0))::bigint as net_profit_minor
    from (
      select i.currency, i.amount_net as income_net, 0::bigint as direct_net, 0::bigint as shared_net, 0::bigint as overhead_net, 0::bigint as expense_net
      from income_all i
      where i.in_period and i.in_pnl
      union all
      select
        e.currency,
        0::bigint,
        case when e.pnl_role = 'project' and not e.unassigned then e.amount_net else 0::bigint end,
        case when e.pnl_role = 'shared' and not e.unassigned then e.amount_net else 0::bigint end,
        case when e.pnl_role = 'overhead' then e.amount_net else 0::bigint end,
        e.amount_net
      from expense_all e
      where e.in_period and e.in_pnl
    ) parts
    group by parts.currency
  ),
  currency_line_counts as (
    select
      l.currency,
      count(distinct l.transaction_id)::integer as line_count
    from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
    where l.company_id = p_company_id
      and l.in_pnl
      and (
        (
          l.kind = 'income'
          and (
            l.direction = 'expense'
            or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
            or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
          )
          and (
            (select dfrom from bounds) is null
            or (basis = 'cash' and coalesce(l.cash_date, l.doc_date) between (select dfrom from bounds) and (select dto from bounds))
            or (basis = 'invoiced' and l.doc_date between (select dfrom from bounds) and (select dto from bounds))
          )
        )
        or (
          l.kind = 'expense'
          and (
            (select dfrom from bounds) is null
            or l.doc_date between (select dfrom from bounds) and (select dto from bounds)
          )
        )
      )
    group by l.currency
  ),
  project_currency as (
    select
      parts.project_id,
      parts.currency,
      coalesce(sum(parts.income_net), 0)::bigint as income_net,
      coalesce(sum(parts.direct_net), 0)::bigint as direct_net,
      coalesce(sum(parts.shared_net), 0)::bigint as shared_net
    from (
      select i.project_id, i.currency, i.amount_net as income_net, 0::bigint as direct_net, 0::bigint as shared_net
      from income_all i
      where i.in_period and i.in_pnl
      union all
      select e.project_id, e.currency, 0::bigint, e.amount_net, 0::bigint
      from expense_all e
      where e.in_period and e.in_pnl and e.pnl_role = 'project' and e.project_id is not null
      union all
      select s.project_id, s.currency, 0::bigint, 0::bigint, s.amount_net
      from shared_alloc_all s
      where s.in_period
    ) parts
    where parts.project_id is not null
    group by parts.project_id, parts.currency
    having coalesce(sum(parts.income_net), 0) <> 0
      or coalesce(sum(parts.direct_net), 0) <> 0
      or coalesce(sum(parts.shared_net), 0) <> 0
  ),
  project_rows as (
    select
      p.id,
      p.name,
      p.status,
      p.state_label,
      p.budget_agorot,
      p.sumit_budget_section_id,
      p.group_id,
      coalesce((select sum(i.amount_net) from income i where i.project_id = p.id and i.in_period and i.in_pnl), 0) as income_net,
      coalesce((select sum(e.amount_net) from expense e where e.project_id = p.id and e.pnl_role = 'project' and e.in_period and e.in_pnl), 0) as direct_net,
      coalesce((select sum(s.amount_net) from shared_alloc s where s.project_id = p.id and s.in_period), 0) as shared_net
    from public.projects p
    where p.company_id = p_company_id
  )
  select jsonb_build_object(
    'company_id', c.id,
    'name', c.name,
    'vat_registered', c.vat_registered,
    'basis', basis,
    'base_currency', c.base_currency,
    'from', p_from,
    'to', p_to,
    'income_agorot', coalesce((select sum(amount_net) from income where in_period and in_pnl), 0),
    'direct_agorot', -coalesce((select sum(amount_net) from expense where pnl_role = 'project' and not unassigned and in_period and in_pnl), 0),
    'shared_agorot', -coalesce((select sum(amount_net) from expense where pnl_role = 'shared' and not unassigned and in_period and in_pnl), 0),
    'overhead_agorot', -coalesce((select sum(amount_net) from expense where pnl_role = 'overhead' and in_period and in_pnl), 0),
    'expense_agorot', -coalesce((select sum(amount_net) from expense where in_period and in_pnl), 0),
    'net_profit_agorot',
      coalesce((select sum(amount_net) from income where in_period and in_pnl), 0)
      + coalesce((select sum(amount_net) from expense where in_period and in_pnl), 0),
    'unassigned_income_agorot', coalesce((select u.unassigned_income_minor from unassigned_by_currency u where u.currency = 'ILS'), 0),
    'unassigned_expense_agorot', coalesce((select u.unassigned_expense_minor from unassigned_by_currency u where u.currency = 'ILS'), 0),
    'overhead_project_id', c.overhead_project_id,
    'excluded_income_agorot', coalesce((select sum(amount_net) from income where in_period and not in_pnl), 0),
    'excluded_expense_agorot', coalesce((select -sum(amount_net) from expense where in_period and not in_pnl), 0),
    'prev_income_agorot', case when p_from is null then null else coalesce((select sum(amount_net) from income where in_prev and in_pnl), 0) end,
    'prev_expense_agorot', case when p_from is null then null else -coalesce((select sum(amount_net) from expense where in_prev and in_pnl), 0) end,
    'prev_net_agorot', case when p_from is null then null else
      coalesce((select sum(amount_net) from income where in_prev and in_pnl), 0)
      + coalesce((select sum(amount_net) from expense where in_prev and in_pnl), 0)
    end,
    'active_projects', (select count(*) from public.projects p where p.company_id = c.id and p.status = 'active'),
    'review_count', (
      select count(*)
      from public.review_queue q
      left join public.transactions rt on rt.id = q.transaction_id
      where q.company_id = c.id
        and q.status = 'open'
        and (rt.id is null or (rt.removed_at is null and rt.line_status <> 'pending'))
    ),
    'other_currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', bucket.currency,
        'income_minor', bucket.income_minor,
        'expense_minor', bucket.expense_minor,
        'count', bucket.line_count
      ) order by bucket.currency)
      from (
        select
          l.currency,
          coalesce(sum(l.amount_net) filter (where l.kind = 'income'), 0)::bigint as income_minor,
          coalesce(sum(l.amount_net) filter (where l.kind = 'expense'), 0)::bigint as expense_minor,
          count(distinct l.transaction_id)::integer as line_count
        from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
        where l.company_id = p_company_id
          and l.in_pnl
          and l.currency <> 'ILS'
          and (
            (
              l.kind = 'income'
              and (
                l.direction = 'expense'
                or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
                or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
              )
              and (
                (select dfrom from bounds) is null
                or (basis = 'cash' and coalesce(l.cash_date, l.doc_date) between (select dfrom from bounds) and (select dto from bounds))
                or (basis = 'invoiced' and l.doc_date between (select dfrom from bounds) and (select dto from bounds))
              )
            )
            or (
              l.kind = 'expense'
              and (
                (select dfrom from bounds) is null
                or l.doc_date between (select dfrom from bounds) and (select dto from bounds)
              )
            )
          )
        group by l.currency
      ) bucket
    ), '[]'::jsonb),
    'by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', k.currency,
        'income_minor', coalesce(cc.income_minor, 0),
        'direct_minor', coalesce(cc.direct_minor, 0),
        'shared_minor', coalesce(cc.shared_minor, 0),
        'overhead_minor', coalesce(cc.overhead_minor, 0),
        'expense_minor', coalesce(cc.expense_minor, 0),
        'net_profit_minor', coalesce(cc.net_profit_minor, 0),
        'excluded_income_minor', coalesce(ex.excluded_income_minor, 0),
        'excluded_expense_minor', coalesce(ex.excluded_expense_minor, 0),
        'excluded_count', coalesce(ex.excluded_count, 0),
        'count', coalesce(lc.line_count, 0),
        'loan_split_fallback_count', coalesce(fb.fallback_count, 0),
        'unassigned_income_minor', coalesce(un.unassigned_income_minor, 0),
        'unassigned_expense_minor', coalesce(un.unassigned_expense_minor, 0),
        'prev_income_minor', case when p_from is null then null else coalesce(pv.income_minor, 0) end,
        'prev_expense_minor', case when p_from is null then null else coalesce(pv.expense_minor, 0) end,
        'prev_net_profit_minor', case when p_from is null then null else coalesce(pv.income_minor, 0) - coalesce(pv.expense_minor, 0) end
      ) order by k.currency is distinct from c.base_currency, k.currency)
      from (
        select currency from company_currency
        union
        select currency from excluded_by_currency
        union
        select currency from prev_currency where p_from is not null
      ) k
      left join company_currency cc on cc.currency = k.currency
      left join currency_line_counts lc on lc.currency = k.currency
      left join excluded_by_currency ex on ex.currency = k.currency
      left join fallback_by_currency fb on fb.currency = k.currency
      left join unassigned_by_currency un on un.currency = k.currency
      left join prev_currency pv on pv.currency = k.currency
    ), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'name', r.name,
          'status', r.status,
          'state_label', r.state_label,
          'budget_agorot', r.budget_agorot,
          'sumit_budget_section_id', r.sumit_budget_section_id,
          'group_id', r.group_id,
          'is_overhead', r.id is not distinct from c.overhead_project_id,
          'income_agorot', r.income_net,
          'direct_agorot', -r.direct_net,
          'shared_agorot', -r.shared_net,
          'profit_before_shared_agorot', r.income_net + r.direct_net,
          'profit_agorot', r.income_net + r.direct_net + r.shared_net,
          'by_currency', coalesce((
            select jsonb_agg(jsonb_build_object(
              'currency', pc.currency,
              'income_minor', pc.income_net,
              'direct_minor', -pc.direct_net,
              'shared_minor', -pc.shared_net,
              'profit_minor', pc.income_net + pc.direct_net + pc.shared_net
            ) order by pc.currency is distinct from c.base_currency, pc.currency)
            from project_currency pc
            where pc.project_id = r.id
          ), '[]'::jsonb)
        )
        order by coalesce((
          select abs(pc.income_net) + abs(pc.direct_net)
          from project_currency pc
          where pc.project_id = r.id and pc.currency = c.base_currency
        ), 0) desc, r.name
      )
      from project_rows r
    ), '[]'::jsonb)
  )
  into result
  from public.companies c
  where c.id = p_company_id;

  if result is not null then
    result := result || jsonb_build_object(
      'groups', private.company_pnl_groups(result->'projects', p_company_id, result->>'base_currency')
    );
  end if;
  return result;
end;
$function$;

-- 20261008100000's get_home: three passes.
create function pg_temp.ref_home()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(
    (
      select jsonb_build_object(
        'company_id', c.id,
        'name', c.name,
        'net_profit_agorot', coalesce((
          select sum(
            case
              when l.kind = 'income' and (l.direction = 'expense' or l.doc_kind in ('receipt', 'invoice_receipt')) then l.amount_net
              when l.kind = 'expense' then l.amount_net
              else 0
            end
          )::bigint
          from (select * from private.pnl_lines u where not u.unpaid) l
          where l.company_id = c.id
            and l.in_pnl
            and l.currency = 'ILS'
        ), 0),
        'other_currencies', coalesce((
          select jsonb_agg(jsonb_build_object(
            'currency', bucket.currency,
            'income_minor', bucket.income_minor,
            'expense_minor', bucket.expense_minor,
            'count', bucket.line_count
          ) order by bucket.currency)
          from (
            select
              l.currency,
              coalesce(sum(l.amount_net) filter (
                where l.kind = 'income' and (l.direction = 'expense' or l.doc_kind in ('receipt', 'invoice_receipt'))
              ), 0)::bigint as income_minor,
              coalesce(sum(l.amount_net) filter (where l.kind = 'expense'), 0)::bigint as expense_minor,
              count(distinct l.transaction_id) filter (
                where (l.kind = 'income' and (l.direction = 'expense' or l.doc_kind in ('receipt', 'invoice_receipt')))
                  or l.kind = 'expense'
              )::integer as line_count
            from (select * from private.pnl_lines u where not u.unpaid) l
            where l.company_id = c.id
              and l.in_pnl
              and l.currency <> 'ILS'
            group by l.currency
          ) bucket
          where bucket.line_count > 0
        ), '[]'::jsonb),
        'base_currency', c.base_currency,
        'net_profit_minor', coalesce((
          select sum(
            case
              when l.kind = 'income' and (l.direction = 'expense' or l.doc_kind in ('receipt', 'invoice_receipt')) then l.amount_net
              when l.kind = 'expense' then l.amount_net
              else 0
            end
          )::bigint
          from (select * from private.pnl_lines u where not u.unpaid) l
          where l.company_id = c.id
            and l.in_pnl
            and l.currency = c.base_currency
        ), 0),
        'is_demo', c.is_demo
      )
      from public.companies c
      where c.id = (select private.readable_company_id())
    ),
    jsonb_build_object(
      'company_id', null,
      'name', null,
      'net_profit_agorot', 0,
      'other_currencies', '[]'::jsonb,
      'base_currency', 'ILS',
      'net_profit_minor', 0,
      'is_demo', false
    )
  );
$function$;

-- projects_cash_month before: per project, the base-currency row of company_pnl's month and
-- all-time projects, and its first month from its own pnl_lines read. Everything else in the
-- payload is as it was.
create function pg_temp.ref_cash_month(p_new jsonb, p_cid uuid)
returns jsonb
language sql
as $$
  with k as (
    select (p_new->>'month')::date as month_start, c.cash_basis as basis, c.base_currency as base
    from public.companies c
    where c.id = p_cid
  ),
  pnl as (
    select
      pg_temp.ref_company_pnl(p_cid, k.month_start, (k.month_start + interval '1 month' - interval '1 day')::date, k.basis) as month_pnl,
      pg_temp.ref_company_pnl(p_cid, null, null, k.basis) as all_pnl,
      k.base
    from k
  ),
  month_rows as (
    select (x->>'id')::uuid as id, bc->>'currency' as currency, (bc->>'profit_minor')::bigint as profit_minor
    from pnl
    cross join lateral jsonb_array_elements(coalesce(pnl.month_pnl->'projects', '[]'::jsonb)) x
    cross join lateral jsonb_array_elements(coalesce(x->'by_currency', '[]'::jsonb)) bc
  ),
  all_rows as (
    select
      (x->>'id')::uuid as id,
      bc->>'currency' as currency,
      (bc->>'profit_minor')::bigint as profit_minor,
      (bc->>'direct_minor')::bigint + (bc->>'shared_minor')::bigint as spent_minor
    from pnl
    cross join lateral jsonb_array_elements(coalesce(pnl.all_pnl->'projects', '[]'::jsonb)) x
    cross join lateral jsonb_array_elements(coalesce(x->'by_currency', '[]'::jsonb)) bc
  )
  select jsonb_set(p_new, '{projects}', coalesce((
    select jsonb_agg(p.r || jsonb_build_object(
      'spent_minor', coalesce((select r.spent_minor from all_rows r where r.id = (p.r->>'id')::uuid and r.currency = (select base from pnl)), 0),
      'profit_month_minor', coalesce((select r.profit_minor from month_rows r where r.id = (p.r->>'id')::uuid and r.currency = (select base from pnl)), 0),
      'profit_all_minor', coalesce((select r.profit_minor from all_rows r where r.id = (p.r->>'id')::uuid and r.currency = (select base from pnl)), 0),
      'first_month', (
        select to_char(date_trunc('month', min(l.doc_date)), 'YYYY-MM-DD')
        from private.pnl_lines l
        where l.company_id = p_cid
          and l.transaction_id = any(private.project_line_ids(p_cid, (p.r->>'id')::uuid))
      )
    ) order by p.ord)
    from jsonb_array_elements(p_new->'projects') with ordinality p(r, ord)
  ), '[]'::jsonb));
$$;

-- get_project before: the overhead share from overhead_share_for (shekels, then the base
-- currency), and each posted transaction's kept_out from its own pnl_lines read.
create function pg_temp.ref_project(p_new jsonb, p_cid uuid, p_id uuid, p_basis text, p_from date, p_to date)
returns jsonb
language sql
as $$
  with b as (
    select private.pnl_basis(p_cid, p_basis) as basis, private.company_base_currency(p_cid) as base
  ),
  s as (
    select o.available, o.share_agorot
    from b cross join lateral private.overhead_share_for(p_cid, p_id, b.basis, p_from, p_to) o
  ),
  sb as (
    select o.available, o.share_agorot
    from b cross join lateral pg_temp.ref_share_for(p_cid, p_id, b.basis, p_from, p_to, b.base) o
  )
  select p_new || jsonb_build_object(
    'overhead_share_agorot', (select case when coalesce(s.available, false) then coalesce(s.share_agorot, 0) else null end from s),
    'overhead_weighted', (select coalesce(s.available, false) from s),
    'overhead_share_minor', (select case when sb.available then coalesce(sb.share_agorot, 0) else null end from sb),
    'profit_after_overhead_agorot', (p_new->>'profit_agorot')::bigint
      - (select case when coalesce(s.available, false) then coalesce(s.share_agorot, 0) else 0 end from s),
    'transactions', coalesce((
      select jsonb_agg(x.r || jsonb_build_object('kept_out', case
        when t.line_status = 'posted' then not coalesce((
          select bool_or(pl.in_pnl)
          from private.pnl_lines pl
          where pl.transaction_id = t.id
            and (pl.project_id = p_id or exists (
              select 1 from public.allocations a
              where a.transaction_id = t.id and a.project_id = p_id
            ))
        ), false)
        else (x.r->>'kept_out')::boolean
      end) order by x.ord)
      from jsonb_array_elements(p_new->'transactions') with ordinality x(r, ord)
      join public.transactions t on t.id = (x.r->>'id')::uuid
    ), '[]'::jsonb)
  );
$$;

create temp table got (label text primary key, val jsonb);
grant all on got to authenticated, service_role;

-- What the new bodies give, as the owner; then what the previous ones give.
create function pg_temp.read_new(p_suffix text)
returns void
language sql
as $$
  insert into got
  select 'gpm_projects' || p_suffix, jsonb_agg(jsonb_build_array(
    public.get_profit_months(null, null, 'cash', p.id),
    public.get_profit_months('2026-03-10', '2026-07-20', 'invoiced', p.id),
    public.get_profit_months(null, null, null, p.id)
  ) order by p.name)
  from public.projects p where p.company_id = (select id from ps where label = 'co');
  insert into got values ('gpm_company' || p_suffix, jsonb_build_array(
    public.get_profit_months(null, null, 'cash', null),
    public.get_profit_months('2026-03-10', '2026-07-20', 'invoiced', null)
  ));
  insert into got
  select 'company_pnl' || p_suffix, jsonb_agg(public.company_pnl((select id from ps where label = 'co'), r.f, r.t, b.b) order by r.n, b.b)
  from (values (1, '2026-07-01'::date, '2026-07-31'::date), (2, null, null), (3, '2026-03-10', '2026-06-20')) r(n, f, t)
  cross join (values ('cash'), ('invoiced')) b(b);
  insert into got values ('dashboard' || p_suffix, jsonb_build_array(
    public.get_dashboard('2026-07-01', '2026-07-31'),
    public.get_dashboard()
  ));
  insert into got values ('cash_month' || p_suffix, jsonb_build_array(
    public.projects_cash_month('2026-07-01'),
    public.projects_cash_month('2026-05-01', null, (select id from ps where label = 'lot1'))
  ));
  insert into got
  select 'project' || p_suffix, jsonb_agg(jsonb_build_array(
    public.get_project(p.id, b.b),
    public.get_project(p.id, b.b, '2026-04-05', '2026-07-25')
  ) order by p.name, b.b)
  from public.projects p
  cross join (values ('cash'), ('invoiced'), (null)) b(b)
  where p.company_id = (select id from ps where label = 'co');
  insert into got values ('home' || p_suffix, public.get_home());
$$;
grant execute on function pg_temp.read_new(text) to authenticated, service_role;

create function pg_temp.check_old(p_suffix text, p_note text)
returns setof text
language plpgsql
as $$
declare
  co uuid := (select id from ps where label = 'co');
begin
  return next is((select val from got where label = 'gpm_projects' || p_suffix), (
    select jsonb_agg(jsonb_build_array(
      pg_temp.ref_profit_months(null, null, 'cash', p.id),
      pg_temp.ref_profit_months('2026-03-10', '2026-07-20', 'invoiced', p.id),
      pg_temp.ref_profit_months(null, null, null, p.id)
    ) order by p.name)
    from public.projects p where p.company_id = co
  ), 'get_profit_months: every project, each month''s overhead share as overhead_share_for gives it' || p_note);
  return next is((select val from got where label = 'gpm_company' || p_suffix), jsonb_build_array(
    pg_temp.ref_profit_months(null, null, 'cash', null),
    pg_temp.ref_profit_months('2026-03-10', '2026-07-20', 'invoiced', null)
  ), 'get_profit_months: the company months are unchanged' || p_note);
  return next is((select val from got where label = 'company_pnl' || p_suffix), (
    select jsonb_agg(pg_temp.ref_company_pnl(co, r.f, r.t, b.b) order by r.n, b.b)
    from (values (1, '2026-07-01'::date, '2026-07-31'::date), (2, null, null), (3, '2026-03-10', '2026-06-20')) r(n, f, t)
    cross join (values ('cash'), ('invoiced')) b(b)
  ), 'company_pnl from one read equals the six-read body: a month, all time, a range, both bases' || p_note);
  return next is((select val from got where label = 'dashboard' || p_suffix), jsonb_build_array(
    pg_temp.ref_company_pnl(co, '2026-07-01', '2026-07-31', private.pnl_basis(co, null))
      || jsonb_build_object('after_overhead', coalesce((select c.after_overhead from public.companies c where c.id = co), false)),
    pg_temp.ref_company_pnl(co, null, null, private.pnl_basis(co, null))
      || jsonb_build_object('after_overhead', coalesce((select c.after_overhead from public.companies c where c.id = co), false))
  ), 'get_dashboard follows company_pnl unchanged' || p_note);
  return next is((select val from got where label = 'cash_month' || p_suffix), (
    select jsonb_agg(pg_temp.ref_cash_month(x, co) order by n)
    from jsonb_array_elements((select val from got where label = 'cash_month' || p_suffix)) with ordinality e(x, n)
  ), 'projects_cash_month: spent, month and all-time profit and first month as two company_pnl calls gave them' || p_note);
  return next is((select val from got where label = 'project' || p_suffix), (
    select jsonb_agg(jsonb_build_array(
      pg_temp.ref_project(x->0, co, p.id, b.b, null, null),
      pg_temp.ref_project(x->1, co, p.id, b.b, '2026-04-05', '2026-07-25')
    ) order by p.name, b.b)
    from public.projects p
    cross join (values ('cash'), ('invoiced'), (null)) b(b)
    join lateral (
      select e.x
      from jsonb_array_elements((select val from got where label = 'project' || p_suffix)) with ordinality e(x, n)
      where (e.x->0->>'id')::uuid = p.id
      order by e.n
      offset (case when b.b = 'cash' then 0 when b.b = 'invoiced' then 1 else 2 end)
      limit 1
    ) x on true
    where p.company_id = co
  ), 'get_project: overhead share, profit after overhead and kept_out as before' || p_note);
  return next is((select val from got where label = 'home' || p_suffix), pg_temp.ref_home(),
    'get_home grouped once equals its three reads' || p_note);
end;
$$;

select tests.authenticate_as('ps_owner');
-- These RPCs are not granted to authenticated (decision 0193): the test calls them as service_role
-- with the user's claims, and each still checks the caller's company.
set local role service_role;
select pg_temp.read_new('');
set local role authenticated;
reset role;
select * from pg_temp.check_old('', '');

-- A company kept in dollars on the invoice basis: the base-currency share and the projects tab's
-- basis (company_pnl reads 'invoice' as cash) follow too.
update public.companies set base_currency = 'USD', cash_basis = 'invoice' where id = (select id from ps where label = 'co');
select tests.authenticate_as('ps_owner');
set local role service_role;
select pg_temp.read_new('_usd');
set local role authenticated;
reset role;
select * from pg_temp.check_old('_usd', ' (dollars, invoice basis)');

select tests.authenticate_as('ps_owner');
select ok(
  (select count(*) from jsonb_array_elements((select val from got where label = 'gpm_projects') -> 0 -> 0 -> 'months') m
   where (m->>'overhead_weighted')::boolean) = 7,
  'the fixture weighs overhead in each of the first lot''s seven months'
);
select ok(
  (select count(*) from jsonb_array_elements((select val from got where label = 'gpm_projects') -> 0 -> 0 -> 'months') m
   where (m->>'overhead_share_agorot')::bigint > 0) > 0,
  'the fixture gives the first lot an overhead share'
);

reset role;
-- The edge months, read from the first round (cash, all time; projects in name order).
create function pg_temp.month_of(p_lot int, p_month text)
returns jsonb
language sql
as $$
  select m from jsonb_array_elements((select val from got where label = 'gpm_projects') -> (p_lot - 1) -> 0 -> 'months') m
  where m->>'month' = p_month;
$$;
select is(
  (select jsonb_build_array(pg_temp.month_of(3, '2025-12')->'overhead_share_agorot', pg_temp.month_of(4, '2025-12')->'overhead_share_agorot')),
  '[10000, 14001]'::jsonb,
  'every share rounds up: the larger income takes the remainder'
);
select is(pg_temp.month_of(3, '2026-01')->'overhead_weighted', 'false'::jsonb, 'a month of overhead and no income weighs nothing');
select is(
  (select jsonb_build_array(pg_temp.month_of(2, '2026-02')->'overhead_weighted', pg_temp.month_of(2, '2026-02')->'overhead_share_agorot')),
  '[true, 70000]'::jsonb,
  'a month with negative total income still weighs its overhead'
);

-- The company with no overhead project, and another company's owner asking for this one's share.
select tests.authenticate_as('ps_plain');
insert into got
select 'plain_gpm', jsonb_agg(jsonb_build_array(
  public.get_profit_months(null, null, 'cash', p.id), public.get_profit_months(null, null, 'invoiced', p.id)
) order by p.name)
from public.projects p where p.company_id = (select id from ps where label = 'plain');
insert into got
select 'plain_project', jsonb_agg(public.get_project(p.id, 'cash') order by p.name)
from public.projects p where p.company_id = (select id from ps where label = 'plain');
select is(
  (select count(*)::integer from private.overhead_shares(
    (select id from ps where label = 'co'), (select id from ps where label = 'lot1'), 'cash', null, null, array['ILS', 'USD'], true)),
  0,
  'overhead_shares gives another company''s owner nothing'
);
reset role;
select is((select val from got where label = 'plain_gpm'), (
  select jsonb_agg(jsonb_build_array(
    pg_temp.ref_profit_months(null, null, 'cash', p.id), pg_temp.ref_profit_months(null, null, 'invoiced', p.id)
  ) order by p.name)
  from public.projects p where p.company_id = (select id from ps where label = 'plain')
), 'get_profit_months with no overhead project equals the previous body');
select is((select val from got where label = 'plain_project'), (
  select jsonb_agg(pg_temp.ref_project(x, (select id from ps where label = 'plain'), (x->>'id')::uuid, 'cash', null, null) order by n)
  from jsonb_array_elements((select val from got where label = 'plain_project')) with ordinality e(x, n)
), 'get_project with no overhead project: overhead share as before');

select * from finish();
rollback;
