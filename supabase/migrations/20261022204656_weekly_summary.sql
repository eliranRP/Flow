-- FLOW-517: one company's week for the weekly summary sheet (the Sunday push opens it over Home).
-- A week runs Sunday to Saturday, Israel time; p_week_start is its Sunday.
--
-- The sums are the cash view's, in the base currency: in_minor and out_minor from
-- private.cash_parts on the company's cash basis, profit_minor as cash_months counts it (net, on
-- the company's P&L basis), and kept_out_minor = in − out − profit, so the four always add up.
-- Lines waiting for review count in them, as on Home (0050 amends 0006).
--
-- The counts are connector lines (bank, SUMIT) that came in during the week by created_at:
-- lines, how many have no review row at all (auto-approved, 0011, as filed_today_rows reads it),
-- and week_waiting (those with an open review row). waiting is the whole open queue now, as the
-- push and Home count it, so the sheet's button matches both.
--
-- alert is the active, non-overhead project most over budget (spent ÷ budget, as
-- projects_cash_month counts spent), and more_over_budget how many others are over. Which project
-- wins is an open question; the largest overrun in percent is the default until it is decided.
--
-- Security definer, as cash_months: private.cash_parts and private.pnl_lines are not granted to
-- authenticated. Invented data only.

begin;
set local lock_timeout = '5s';

create or replace function public.weekly_summary(p_week_start date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  basis text;
  pbasis text;
  base text;
  week_end date;
  prev_start date;
  prev_end date;
  from_at timestamptz;
  to_at timestamptz;
  cash_in bigint;
  cash_out bigint;
  profit bigint;
  prev_profit bigint;
  has_prev boolean;
  line_count integer;
  auto_count integer;
  week_waiting integer;
  open_count integer;
  over jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  if p_week_start is null or extract(dow from p_week_start) <> 0 or p_week_start > private.flow_today() then
    raise exception 'validation';
  end if;

  select c.cash_basis, c.base_currency into basis, base
  from public.companies c
  where c.id = cid;
  pbasis := private.pnl_basis(cid, null);

  week_end := p_week_start + 6;
  prev_start := p_week_start - 7;
  prev_end := p_week_start - 1;
  from_at := p_week_start::timestamp at time zone 'Asia/Jerusalem';
  to_at := (week_end + 1)::timestamp at time zone 'Asia/Jerusalem';

  select
    coalesce(sum(p.amount_minor) filter (where p.in_cash and p.kind = 'income'), 0)::bigint,
    coalesce(sum(-p.amount_minor) filter (where p.in_cash and p.kind = 'expense'), 0)::bigint
  into cash_in, cash_out
  from private.cash_parts(cid, basis, p_week_start, week_end) p
  where p.currency = base;

  -- The week's and the week before's net profit, as cash_months counts a month's.
  select
    coalesce(sum(l.amount_net) filter (
      where private.pnl_in_range(l.kind, pbasis, l.doc_date, l.cash_date, p_week_start, week_end)
    ), 0)::bigint,
    coalesce(sum(l.amount_net) filter (
      where private.pnl_in_range(l.kind, pbasis, l.doc_date, l.cash_date, prev_start, prev_end)
    ), 0)::bigint
  into profit, prev_profit
  from private.pnl_lines l
  where l.company_id = cid
    and l.currency = base
    and l.in_pnl
    and (pbasis = 'invoiced' or not l.unpaid)
    and (
      l.kind = 'expense'
      or l.direction = 'expense'
      or (pbasis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
      or (pbasis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
    );

  select exists (
    select 1 from private.pnl_lines l
    where l.company_id = cid and l.doc_date <= prev_end
  ) into has_prev;

  select
    count(*)::integer,
    (count(*) filter (where not exists (
      select 1 from public.review_queue q where q.transaction_id = t.id
    )))::integer,
    (count(*) filter (where exists (
      select 1 from public.review_queue q where q.transaction_id = t.id and q.status = 'open'
    )))::integer
  into line_count, auto_count, week_waiting
  from public.transactions t
  where t.company_id = cid
    and private.is_connector_source(t.source)
    and t.line_status = 'posted'
    and t.removed_at is null
    and t.created_at >= from_at
    and t.created_at < to_at;

  select count(*)::integer into open_count
  from public.review_queue q
  left join public.transactions rt on rt.id = q.transaction_id
  where q.company_id = cid
    and q.status = 'open'
    and (rt.id is null or (rt.removed_at is null and rt.line_status <> 'pending'));

  with projects as (
    select
      (p ->> 'id')::uuid as id,
      p ->> 'name' as name,
      (p ->> 'spent_minor')::bigint as spent_minor,
      (p ->> 'budget_minor')::bigint as budget_minor
    from jsonb_array_elements(coalesce(public.projects_cash_month() -> 'projects', '[]'::jsonb)) p
    where p ->> 'status' = 'active'
      and not coalesce((p ->> 'is_overhead')::boolean, false)
      and (p ->> 'budget_minor') is not null
      and (p ->> 'budget_minor')::bigint > 0
      and (p ->> 'spent_minor')::bigint > (p ->> 'budget_minor')::bigint
  ),
  ranked as (
    select r.*, row_number() over (order by r.spent_minor::numeric / r.budget_minor desc, r.name, r.id) as n
    from projects r
  )
  select jsonb_build_object(
    'alert', (
      select jsonb_build_object('project_id', r.id, 'name', r.name, 'spent_minor', r.spent_minor, 'budget_minor', r.budget_minor)
      from ranked r where r.n = 1
    ),
    'more', greatest((select count(*) from ranked) - 1, 0)
  ) into over;

  return jsonb_build_object(
    'week_start', to_char(p_week_start, 'YYYY-MM-DD'),
    'currency', base,
    'lines', line_count,
    'auto_approved', auto_count,
    'week_waiting', week_waiting,
    'waiting', open_count,
    'in_minor', cash_in,
    'out_minor', cash_out,
    'profit_minor', profit,
    'kept_out_minor', cash_in - cash_out - profit,
    'prev_profit_minor', case when has_prev then prev_profit end,
    'alert', over -> 'alert',
    'more_over_budget', (over ->> 'more')::integer
  );
end;
$$;

revoke all on function public.weekly_summary(date) from public, anon;
grant execute on function public.weekly_summary(date) to authenticated, service_role;

comment on function public.weekly_summary(date) is
  'FLOW-517: one company''s week (Sunday to Saturday, Israel time; p_week_start is the Sunday) for the weekly summary sheet: connector lines that came in, auto-approved, waiting; in, out, profit and kept out in the base currency; the week before''s profit; the project most over budget and how many more.';

commit;
