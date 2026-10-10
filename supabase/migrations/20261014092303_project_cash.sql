-- FLOW-417 (owner's option A "Like Home", 2026-10-10; decision 0172): a project opens on its cash.
-- - private.project_cash_parts: private.cash_parts' parts that are the project's. A part filed or
--   split to the project counts whole; a shared line counts its allocation's share (share_bp of
--   the part's gross), so a project shows its own part of a bill, never the whole bank amount.
-- - public.project_cash_months(p_project, p_months, p_today): cash_months' shape for one project.
--   profit_minor is the project's profit for the month on the company's basis (get_project's
--   income, direct and shared lines), before the overhead share.
-- - public.project_cash_month_lines(p_project, ...): cash_month_lines' shape for one project; a
--   shared line's amount is the project's share.

begin;

set local lock_timeout = '5s';

create or replace function private.project_cash_parts(
  p_company uuid,
  p_project uuid,
  p_basis text,
  p_from date,
  p_to date
)
returns table (
  transaction_id uuid,
  part public.loan_split_part,
  currency text,
  kind text,
  category_id uuid,
  project_id uuid,
  pnl_role public.pnl_role,
  month_date date,
  amount_minor bigint,
  in_cash boolean
)
language sql
stable
set search_path = ''
as $$
  select
    p.transaction_id,
    p.part,
    p.currency,
    p.kind,
    p.category_id,
    p_project,
    p.pnl_role,
    p.month_date,
    case
      when p.pnl_role = 'shared' then private.div_half_even(p.amount_minor::numeric * a.share_bp, 10000)
      else p.amount_minor
    end::bigint,
    p.in_cash
  from private.cash_parts(p_company, p_basis, p_from, p_to) p
  left join public.allocations a
    on p.pnl_role = 'shared'
    and a.transaction_id = p.transaction_id
    and a.project_id = p_project
  where (p.pnl_role is distinct from 'shared' and p.project_id = p_project)
    or a.transaction_id is not null;
$$;

revoke all on function private.project_cash_parts(uuid, uuid, text, date, date) from public, anon, authenticated;

-- The project's months, newest first, the current month included, in cash_months' shape. Null
-- when no company is readable or the project is not the company's.
create or replace function public.project_cash_months(
  p_project uuid,
  p_months integer default 4,
  p_today date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
  this_month date;
  first_month date;
  last_day date;
  basis text;
  pbasis text;
  base text;
  ids uuid[];
  result jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  if p_project is null or p_months is null or p_months < 1 or p_months > 24 then
    raise exception 'validation';
  end if;
  if not exists (select 1 from public.projects pr where pr.id = p_project and pr.company_id = cid) then
    return null;
  end if;
  select c.cash_basis, c.base_currency into basis, base
  from public.companies c
  where c.id = cid;
  pbasis := private.pnl_basis(cid, null);

  this_month := date_trunc('month', today)::date;
  first_month := (this_month - make_interval(months => p_months - 1))::date;
  last_day := (this_month + interval '1 month' - interval '1 day')::date;
  -- The lines the project's profit can count, as get_project reads them.
  ids := array(
    select t.id from public.transactions t where t.company_id = cid and t.project_id = p_project
    union
    select a.transaction_id from public.allocations a where a.company_id = cid and a.project_id = p_project
    union
    select s.transaction_id from public.line_splits s where s.company_id = cid and s.project_id = p_project
  );

  with parts as (
    select * from private.project_cash_parts(cid, p_project, basis, first_month, last_day)
  ),
  cash as (
    select
      date_trunc('month', p.month_date)::date as month,
      p.currency,
      coalesce(sum(p.amount_minor) filter (where p.in_cash and p.kind = 'income'), 0)::bigint as in_minor,
      coalesce(sum(-p.amount_minor) filter (where p.in_cash and p.kind = 'expense'), 0)::bigint as out_minor,
      (count(distinct p.transaction_id) filter (where not p.in_cash))::integer as excluded_count,
      coalesce(sum(p.amount_minor) filter (where not p.in_cash and p.kind = 'income'), 0)::bigint as excluded_in_minor,
      coalesce(sum(-p.amount_minor) filter (where not p.in_cash and p.kind = 'expense'), 0)::bigint as excluded_out_minor
    from parts p
    group by 1, 2
  ),
  -- The project's profit per month on the company's basis: its own lines, and its share of the
  -- shared ones (get_project's income, direct and shared figures).
  lines as (
    select l.*
    from private.pnl_lines l
    where l.transaction_id = any(ids)
      and l.in_pnl
      and (pbasis = 'invoiced' or not l.unpaid)
      and (
        l.kind = 'expense'
        or l.direction = 'expense'
        or (pbasis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
        or (pbasis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      )
      and private.pnl_in_range(l.kind, pbasis, l.doc_date, l.cash_date, first_month, last_day)
  ),
  profit as (
    select
      date_trunc('month', case when x.kind = 'income' and pbasis = 'cash' then coalesce(x.cash_date, x.doc_date) else x.doc_date end)::date as month,
      x.currency,
      sum(x.amount)::bigint as profit_minor
    from (
      select l.kind, l.cash_date, l.doc_date, l.currency, l.amount_net as amount
      from lines l
      where l.project_id = p_project
        and (l.kind = 'income' or l.pnl_role = 'project')
      union all
      select l.kind, l.cash_date, l.doc_date, l.currency,
        coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0)
      from lines l
      cross join lateral (
        select a.amount_net from public.allocations a
        where a.transaction_id = l.transaction_id and a.project_id = p_project
        offset 0 -- keeps this a per-line lookup
      ) a
      where l.kind = 'expense' and l.pnl_role = 'shared'
    ) x
    group by 1, 2
  ),
  months as (
    select m::date as month
    from generate_series(this_month, first_month, interval '-1 month') m
  ),
  keys as (
    select m.month, base as currency from months m
    union
    select c.month, c.currency from cash c
    union
    select p.month, p.currency from profit p
  )
  select jsonb_build_object(
    'basis', basis,
    'base_currency', base,
    'months', (
      select jsonb_agg(jsonb_build_object(
        'month', to_char(m.month, 'YYYY-MM-DD'),
        'by_currency', (
          select jsonb_agg(jsonb_build_object(
            'currency', k.currency,
            'in_minor', coalesce(c.in_minor, 0),
            'out_minor', coalesce(c.out_minor, 0),
            'net_minor', coalesce(c.in_minor, 0) - coalesce(c.out_minor, 0),
            'profit_minor', coalesce(p.profit_minor, 0),
            'excluded_count', coalesce(c.excluded_count, 0),
            'excluded_in_minor', coalesce(c.excluded_in_minor, 0),
            'excluded_out_minor', coalesce(c.excluded_out_minor, 0)
          ) order by k.currency is distinct from base, k.currency)
          from keys k
          left join cash c on c.month = k.month and c.currency = k.currency
          left join profit p on p.month = k.month and p.currency = k.currency
          where k.month = m.month
        )
      ) order by m.month desc)
      from months m
    )
  ) into result;

  return result;
end;
$$;

-- One month's נכנס ('in'), יצא ('out') or kept-out ('excluded') lines for the project, in
-- cash_month_lines' shape. A shared line's amount is the project's share, marked 'shared'.
create or replace function public.project_cash_month_lines(
  p_project uuid,
  p_month date,
  p_side text,
  p_currency text default null,
  p_limit integer default 40,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  basis text;
  base text;
  month_start date;
  lim integer;
  off integer;
  result jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  if p_project is null or p_month is null or p_side is null or p_side not in ('in', 'out', 'excluded') then
    raise exception 'validation';
  end if;
  if not exists (select 1 from public.projects pr where pr.id = p_project and pr.company_id = cid) then
    return null;
  end if;
  select c.cash_basis, c.base_currency into basis, base
  from public.companies c
  where c.id = cid;
  month_start := date_trunc('month', p_month)::date;
  lim := least(greatest(coalesce(p_limit, 40), 1), 200);
  off := greatest(coalesce(p_offset, 0), 0);

  with r as (
    select
      p.*,
      case when p.kind = 'income' then 'in' else 'out' end as side,
      case when p.kind = 'income' then p.amount_minor else -p.amount_minor end as side_minor
    from private.project_cash_parts(cid, p_project, basis, month_start, (month_start + interval '1 month' - interval '1 day')::date) p
    where p.currency = coalesce(p_currency, base)
      and (
        (p_side = 'excluded' and not p.in_cash)
        or (p_side = 'in' and p.in_cash and p.kind = 'income')
        or (p_side = 'out' and p.in_cash and p.kind = 'expense')
      )
  ),
  merged as (
    select
      r.transaction_id,
      r.part,
      r.side,
      bool_or(r.pnl_role = 'shared') as shared,
      max(r.month_date) as month_date,
      sum(r.side_minor)::bigint as amount_minor,
      case when count(distinct r.category_id) = 1 and count(r.category_id) = count(*) then min(r.category_id::text)::uuid end as category_id
    from r
    group by r.transaction_id, r.part, r.side
  ),
  page as (
    select
      m.*,
      t.description,
      t.source,
      t.doc_date,
      sup.name as supplier_name,
      c.name as category_name,
      row_number() over (order by m.month_date desc, m.transaction_id, m.part, m.side) as n
    from merged m
    join public.transactions t on t.id = m.transaction_id
    left join public.suppliers sup on sup.id = t.supplier_id
    left join public.categories c on c.id = m.category_id
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'transaction_id', pg.transaction_id,
        'part', pg.part,
        'description', pg.description,
        'supplier_name', pg.supplier_name,
        'project_name', null,
        'category_name', pg.category_name,
        'doc_date', pg.doc_date,
        'cash_month_date', pg.month_date,
        'currency', coalesce(p_currency, base),
        'amount_minor', pg.amount_minor,
        'side', pg.side,
        'shared', pg.shared,
        'source', pg.source,
        'kept_out', p_side = 'excluded'
      ) order by pg.n)
      from page pg
      where pg.n > off and pg.n <= off + lim
    ), '[]'::jsonb),
    'has_more', exists (select 1 from page pg where pg.n > off + lim)
  ) into result;

  return result;
end;
$$;

revoke all on function public.project_cash_months(uuid, integer, date) from public, anon;
revoke all on function public.project_cash_month_lines(uuid, date, text, text, integer, integer) from public, anon;
grant execute on function public.project_cash_months(uuid, integer, date) to authenticated, service_role;
grant execute on function public.project_cash_month_lines(uuid, date, text, text, integer, integer) to authenticated, service_role;

comment on function public.project_cash_months(uuid, integer, date) is
  'FLOW-417: one project''s cash per month (cash_months'' shape); a shared line counts the project''s share. profit_minor is the project''s profit on the company''s basis, before overhead.';
comment on function public.project_cash_month_lines(uuid, date, text, text, integer, integer) is
  'FLOW-417: one project''s lines behind a month''s נכנס, יצא or kept-out (cash_month_lines'' shape); a shared line shows the project''s share.';

commit;
