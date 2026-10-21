-- FLOW-943: the main screens read faster, with the same results. Measured on the largest company
-- (about 800 lines), each Home, Projects, company profit and cash read spent most of its time in a
-- few shared pieces:
-- - private.pnl_lines (every P&L, cash and profit read scans it, often more than once) called three
--   small SQL helpers per line that Postgres could not inline, and ran two aggregates per line to
--   find the line's loan and line splits. The helpers become inlinable (below) and the split totals
--   are grouped once and hash joined. A pass over a company's lines takes about a third of the time.
-- - get_breakdown read private.breakdown_rows twice when grouping by category; the second read was
--   the same rows. It reads them once.
-- - recurring_changes and recurring_this_month read private.recurring_stream_lines three times, and
--   expected_months twice. recurring_parties now returns the facts its readers went back for (this
--   month's amount, latest line and line count; whether the charge pays a loan), and its last bill
--   comes from one grouped pass instead of a subquery per charge. Each reads the lines once.
-- - When two of a charge's lines this month share a date and entry time, the higher id is the latest, on
--   Home (recurring_arrivals) and on the project page (project_recurring_arrivals) alike.
-- Bodies are the latest live ones otherwise; supabase/tests/database/main_screens_speed.test.sql pins
-- their outputs on invented books.
begin;
set local lock_timeout = '5s';

-- Per-row helpers the planner can inline. Postgres inlines a SQL function into the query that calls
-- it only when the function sets no configuration, so `set search_path = ''` turned each of these
-- into a real call per row (about 5 microseconds each; private.pnl_lines made three per line, and
-- every P&L, cash and recurring read scans it). Each is one expression over its arguments, built
-- from pg_catalog operators and functions only (pg_catalog is searched first whatever the path),
-- with no table, view or private function in it, so the search path never changes what it means.
-- The bodies are unchanged.
alter function private.line_in_pnl(boolean, boolean, public.loan_split_part) reset search_path;
alter function private.line_category_out(boolean, boolean, public.loan_split_part) reset search_path;
alter function private.line_unpaid(public.txn_direction, public.doc_kind, date) reset search_path;
alter function private.pnl_in_range(text, text, date, date, date, date) reset search_path;
alter function private.category_in_rehab(boolean, boolean, public.loan_split_part) reset search_path;
alter function private.div_half_even(numeric, numeric) reset search_path;
alter function private.month_diff(date, date) reset search_path;
alter function private.month_end(date) reset search_path;
alter function private.pace_months(text) reset search_path;
alter function private.round_agorot_shekel_hundreds(numeric) reset search_path;
alter function private.category_flag(text, bigint, bigint, integer, integer, date) reset search_path;

-- The P&L's parts (decision 0104), as 20261013233845 built them: a loan split's parts, a line split's
-- parts, or the whole line. Only how each line's split totals are found changes.
create or replace view private.pnl_lines
with (security_invoker = true) as
select
  t.company_id,
  t.id as transaction_id,
  t.project_id,
  case
    when coalesce(c.kind::text, t.direction::text) = 'expense' and t.pnl_role = 'project' and t.project_id is not null
      and t.project_id = co.overhead_project_id
      then 'overhead'::public.pnl_role
    else t.pnl_role
  end as pnl_role,
  t.direction,
  t.doc_kind,
  t.doc_date,
  t.cash_date,
  coalesce(t.currency, 'ILS') as currency,
  s.category_id,
  s.part,
  case when t.direction = 'expense' then -s.amount_minor else s.amount_minor end as amount_net,
  t.amount_net as line_amount_net,
  -- By parts: a loan line, so its parts decide and the override does not apply.
  private.line_in_pnl(null, c.excluded_from_pnl, c.loan_part) as in_pnl,
  false as loan_split_fallback,
  case
    when coalesce(c.kind::text, t.direction::text) = 'income' then t.project_id is null
    else t.pnl_role is null or (t.pnl_role = 'project' and t.project_id is null)
      or (t.pnl_role = 'shared' and not exists (select 1 from public.allocations a where a.transaction_id = t.id))
  end as unassigned,
  coalesce(c.kind::text, t.direction::text) as kind,
  private.line_unpaid(t.direction, t.doc_kind, t.cash_date) as unpaid
from public.transactions t
join public.loan_splits s on s.transaction_id = t.id
join lateral (
  select
    count(*) as parts,
    sum(x.amount_minor) as parts_minor,
    bool_or(x.needs_review) as flagged
  from public.loan_splits x
  where x.transaction_id = t.id
) sp on sp.parts in (3, 4) and not sp.flagged
  and sp.parts_minor = abs(t.amount_net)
left join public.categories c on c.id = s.category_id
left join public.companies co on co.id = t.company_id
where t.removed_at is null
  and t.line_status = 'posted'
  and t.vat_amount = 0
union all
select
  t.company_id,
  t.id as transaction_id,
  coalesce(s.project_id, t.project_id) as project_id,
  case
    when coalesce(c.kind::text, t.direction::text) = 'expense' and s.project_id is not null
      and s.project_id = co.overhead_project_id
      then 'overhead'::public.pnl_role
    when coalesce(c.kind::text, t.direction::text) = 'expense' and s.project_id is not null
      then 'project'::public.pnl_role
    when coalesce(c.kind::text, t.direction::text) = 'expense' and t.pnl_role = 'project' and t.project_id is not null
      and t.project_id = co.overhead_project_id
      then 'overhead'::public.pnl_role
    else t.pnl_role
  end as pnl_role,
  t.direction,
  t.doc_kind,
  t.doc_date,
  t.cash_date,
  coalesce(t.currency, 'ILS') as currency,
  s.category_id,
  null::public.loan_split_part as part,
  case when t.direction = 'expense' then -s.amount_minor else s.amount_minor end as amount_net,
  t.amount_net as line_amount_net,
  private.line_in_pnl(t.in_pnl_override, c.excluded_from_pnl, c.loan_part) as in_pnl,
  false as loan_split_fallback,
  case
    when coalesce(c.kind::text, t.direction::text) = 'income' then coalesce(s.project_id, t.project_id) is null
    when s.project_id is not null then false
    else t.pnl_role is null or (t.pnl_role = 'project' and t.project_id is null)
      or (t.pnl_role = 'shared' and not exists (select 1 from public.allocations a where a.transaction_id = t.id))
  end as unassigned,
  coalesce(c.kind::text, t.direction::text) as kind,
  private.line_unpaid(t.direction, t.doc_kind, t.cash_date) as unpaid
from public.transactions t
join public.line_splits s on s.transaction_id = t.id
join lateral (
  select
    count(*) as parts,
    sum(x.amount_minor) as parts_minor
  from public.line_splits x
  where x.transaction_id = t.id
) lp on lp.parts >= 2
  and lp.parts_minor = abs(t.amount_net)
left join public.categories c on c.id = s.category_id
left join public.companies co on co.id = t.company_id
where t.removed_at is null
  and t.line_status = 'posted'
  and not exists (select 1 from public.loan_splits ls where ls.transaction_id = t.id)
union all
select
  t.company_id,
  t.id as transaction_id,
  t.project_id,
  case
    when coalesce(c.kind::text, t.direction::text) = 'expense' and t.pnl_role = 'project' and t.project_id is not null
      and t.project_id = co.overhead_project_id
      then 'overhead'::public.pnl_role
    else t.pnl_role
  end as pnl_role,
  t.direction,
  t.doc_kind,
  t.doc_date,
  t.cash_date,
  coalesce(t.currency, 'ILS') as currency,
  t.category_id,
  null::public.loan_split_part as part,
  t.amount_net,
  t.amount_net as line_amount_net,
  -- A line with a loan split stays fixed, even when it falls back to its own category.
  private.line_in_pnl(
    case when coalesce(sp.parts, 0) = 0 then t.in_pnl_override end,
    private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
    c.loan_part
  ) as in_pnl,
  coalesce(sp.parts, 0) > 0 as loan_split_fallback,
  case
    when coalesce(c.kind::text, t.direction::text) = 'income' then t.project_id is null
    else t.pnl_role is null or (t.pnl_role = 'project' and t.project_id is null)
      or (t.pnl_role = 'shared' and not exists (select 1 from public.allocations a where a.transaction_id = t.id))
  end as unassigned,
  coalesce(c.kind::text, t.direction::text) as kind,
  private.line_unpaid(t.direction, t.doc_kind, t.cash_date) as unpaid
from public.transactions t
left join public.categories c on c.id = t.category_id
left join public.companies co on co.id = t.company_id
-- FLOW-943: each line's loan and line split totals, grouped once and hash joined, instead of an
-- aggregate per line. Keyed by company and line, so a company filter (or one line's id) on the
-- view reaches the grouped rows too. A line with no split row has no group: its count is 0 and
-- its sums and flag are null, as the per-line aggregate gave.
left join (
  select x.company_id, x.transaction_id,
    count(*) as parts,
    sum(x.amount_minor) as parts_minor,
    bool_or(x.needs_review) as flagged
  from public.loan_splits x
  group by x.company_id, x.transaction_id
) sp on sp.company_id = t.company_id and sp.transaction_id = t.id
left join (
  select x.company_id, x.transaction_id,
    count(*) as parts,
    sum(x.amount_minor) as parts_minor
  from public.line_splits x
  group by x.company_id, x.transaction_id
) lp on lp.company_id = t.company_id and lp.transaction_id = t.id
where t.removed_at is null
  and t.line_status = 'posted'
  and (
    coalesce(sp.parts, 0) = 0 or sp.parts not in (3, 4) or sp.flagged or t.vat_amount <> 0
    or sp.parts_minor <> abs(t.amount_net)
  )
  and (
    coalesce(sp.parts, 0) > 0 or coalesce(lp.parts, 0) < 2
    or lp.parts_minor <> abs(t.amount_net)
  );

revoke all on private.pnl_lines from public, anon;
grant select on private.pnl_lines to authenticated, service_role;

-- get_breakdown as 20261007203000 built it (live body), reading breakdown_rows once by category.
create or replace function public.get_breakdown(p_direction text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_group_by text DEFAULT 'category'::text, p_basis text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  basis text;
  result jsonb;
begin
  cid := private.breakdown_company(p_direction, p_group_by, p_from, p_to);
  if cid is null then
    return null;
  end if;
  basis := private.pnl_basis(cid, p_basis);

  with r as (
    select * from private.breakdown_rows(cid, p_direction, p_from, p_to, basis, p_group_by)
  ),
  groups as (
    select
      r.currency,
      r.group_key,
      max(r.group_name) as group_name,
      sum(r.amount_minor)::bigint as amount_minor,
      count(distinct r.transaction_id)::integer as line_count,
      bool_or(r.shared) as shared,
      count(distinct r.project_id) filter (where r.project_id is not null)::integer as project_count
    from r
    where r.in_pnl
    group by r.currency, r.group_key
  ),
  -- Totals count each line or part once, so a shared line is the line, not its rounded shares.
  -- By category, r already holds those rows: they are read once, not twice (FLOW-943).
  by_line as (
    select * from r where p_group_by = 'category'
    union all
    select * from private.breakdown_rows(cid, p_direction, p_from, p_to, basis, 'category')
    where p_group_by is distinct from 'category'
  ),
  all_totals as (
    select b.currency, sum(b.amount_minor)::bigint as amount_minor, count(distinct b.transaction_id)::integer as line_count
    from by_line b
    where b.in_pnl
    group by b.currency
  ),
  excluded as (
    select r.currency, sum(r.amount_minor)::bigint as amount_minor, count(distinct r.transaction_id)::integer as line_count
    from by_line r
    where not r.in_pnl
    group by r.currency
  )
  select jsonb_build_object(
    'direction', p_direction,
    'basis', basis,
    'group_by', p_group_by,
    'from', p_from,
    'to', p_to,
    'totals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', t.currency, 'amount_minor', t.amount_minor, 'count', t.line_count
      ) order by (t.currency <> 'ILS'), t.currency)
      from all_totals t
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', g.group_key,
        'name', g.group_name,
        'currency', g.currency,
        'amount_minor', g.amount_minor,
        'count', g.line_count,
        'shared', g.shared,
        'projects', g.project_count
      ) order by (g.currency <> 'ILS'), g.currency, g.amount_minor desc, g.group_name nulls last, g.group_key)
      from groups g
    ), '[]'::jsonb),
    'excluded', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', e.currency, 'amount_minor', e.amount_minor, 'count', e.line_count
      ) order by (e.currency <> 'ILS'), e.currency)
      from excluded e
    ), '[]'::jsonb),
    'review_count', (
      select count(*)::integer
      from public.review_queue q
      join public.transactions t on t.id = q.transaction_id
      -- The side follows the category kind, like the totals (decision 0103).
      left join public.categories c on c.id = t.category_id
      where q.company_id = cid
        and q.status = 'open'
        and t.removed_at is null
        -- Only lines already in the totals: a pending bank line waiting in Review is not counted yet.
        and t.line_status = 'posted'
        and coalesce(c.kind::text, t.direction::text) = p_direction
        and (p_from is null or p_to is null or t.doc_date between p_from and p_to)
    )
  ) into result;

  return result;
end;
$function$;

revoke all on function public.get_breakdown(text, date, date, text, text) from public, anon;
grant execute on function public.get_breakdown(text, date, date, text, text) to authenticated, service_role;

-- recurring_parties, faster, with the same rows (FLOW-943):
-- - each charge's last bill and last month seen come from one grouped pass over its lines, not a
--   subquery per charge;
-- - it also returns what its readers read the stream lines again for: whether the charge pays a loan
--   (any of its lines is split into loan parts; expected_months), and this month's amount, latest line
--   and line count (recurring_arrivals). So recurring_changes and recurring_this_month read the stream
--   lines once instead of three times, and expected_months once instead of twice.
-- The body is 20261020102512's otherwise.
drop function private.recurring_parties(uuid, date, boolean);
create function private.recurring_parties(p_company uuid, p_today date, p_overrides boolean DEFAULT true)
 RETURNS TABLE(direction txn_direction, party_id uuid, currency text, months_seen integer, typical_day integer, typical_amount_minor bigint, last_doc_date date, seen_this_month boolean, project_id uuid, category_id uuid, last_amount_minor bigint, source text, pace text, pace_source text, next_due_month date, typical_amount_source text, pays_loan boolean, this_month_minor bigint, this_month_transaction_id uuid, this_month_line_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with bounds as (
    select date_trunc('month', p_today)::date as this_month,
      (date_trunc('month', p_today) - interval '6 months')::date as window6
  ),
  -- One recurring charge per party and project (recurring_stream_lines): a servicer paying two
  -- loans, or a utility billing two properties, is two charges, each with its own usual amount.
  -- A split line counts only its parts for the charge (decision 0189).
  lines as (
    select sl.direction, sl.party_id, sl.currency, sl.stream_project,
      sl.doc_date, sl.amount_net, sl.project_id, sl.category_id,
      date_trunc('month', sl.doc_date)::date as month, true as posted,
      sl.id, sl.created_at
    from private.recurring_stream_lines(p_company, p_today) sl
  ),
  -- The owner's words: a row with a project is that charge's; a row with none is the party's (decision 0188).
  overrides as (
    select o.direction, o.party_id, o.currency, o.project_id, o.recurring, o.pace, o.typical_amount_minor
    from public.recurring_overrides o
    where o.company_id = p_company and p_overrides
  ),
  monthly as (
    select l.direction, l.party_id, l.currency, l.stream_project, l.month,
      sum(l.amount_net) as amount, min(extract(day from l.doc_date))::integer as first_day
    from lines l, bounds b
    where l.month < b.this_month and l.posted
    group by l.direction, l.party_id, l.currency, l.stream_project, l.month
  ),
  gapped as (
    select m.*,
      private.month_diff(m.month, lag(m.month) over w) as gap,
      row_number() over (partition by m.direction, m.party_id, m.currency, m.stream_project order by m.month desc) as back
    from monthly m
    window w as (partition by m.direction, m.party_id, m.currency, m.stream_project order by m.month)
  ),
  stats as (
    select g.direction, g.party_id, g.currency, g.stream_project,
      (count(*) filter (where g.month >= b.window6))::integer as months6,
      coalesce(bool_or(g.month >= (b.this_month - interval '2 months')::date), false) as recent,
      percentile_disc(0.5) within group (order by g.first_day) filter (where g.month >= b.window6) as day6,
      percentile_disc(0.5) within group (order by abs(g.amount)) filter (where g.month >= b.window6) as amount6,
      count(*)::integer as months24,
      percentile_disc(0.5) within group (order by g.first_day) as day24,
      percentile_disc(0.5) within group (order by abs(g.amount)) as amount24,
      max(g.month) as last_month,
      max(g.gap) filter (where g.back = 1) as gap_last,
      max(g.gap) filter (where g.back = 2) as gap_prev
    from gapped g, bounds b
    group by g.direction, g.party_id, g.currency, g.stream_project
  ),
  detected as (
    select s.*,
      case
        when s.months24 >= 3 and s.gap_last = 2 and s.gap_prev = 2
          and private.month_diff(b.this_month, s.last_month) <= 4 then '2months'
        when s.months24 >= 3 and s.gap_last = 3 and s.gap_prev = 3
          and private.month_diff(b.this_month, s.last_month) <= 6 then 'quarter'
        when s.months6 >= 3 and s.recent then 'month'
        when s.months24 >= 2 and s.gap_last between 11 and 13
          and private.month_diff(b.this_month, s.last_month) <= 13 then 'year'
      end as auto_pace
    from stats s, bounds b
  ),
  -- The party's main charge: the project it billed in the most of the last six complete months (then the
  -- latest). A party-wide "recurring" (a row with no project) makes only this charge recurring (decision 0185).
  main as (
    select distinct on (l.direction, l.party_id, l.currency) l.direction, l.party_id, l.currency, l.stream_project
    from lines l, bounds b
    group by l.direction, l.party_id, l.currency, l.stream_project
    order by l.direction, l.party_id, l.currency,
      count(distinct l.month) filter (where l.month >= b.window6 and l.month < b.this_month) desc, max(l.doc_date) desc,
      l.stream_project nulls last
  ),
  -- The owner's word on each charge (decision 0188). The charge's own row wins, field by field. Else the
  -- party-wide row: "not recurring" ends every charge, "recurring" makes the main charge recurring, and its
  -- pace is every charge's. The usual amount is only the charge's own (decision 0189): a charge with no
  -- project reads it from the row with no project.
  words as (
    select s.direction, s.party_id, s.currency, s.stream_project,
      coalesce(own.recurring, case
        when pw.recurring is false then false
        when pw.recurring and s.stream_project is not distinct from mn.stream_project then true
      end) as recurring,
      coalesce(own.pace, pw.pace) as pace,
      coalesce(own.typical_amount_minor, case when s.stream_project is null then pw.typical_amount_minor end) as amount
    from (select distinct l.direction, l.party_id, l.currency, l.stream_project from lines l) s
    left join main mn on mn.direction = s.direction and mn.party_id = s.party_id and mn.currency = s.currency
    left join overrides own on own.direction = s.direction and own.party_id = s.party_id and own.currency = s.currency
      and own.project_id = s.stream_project
    left join overrides pw on pw.direction = s.direction and pw.party_id = s.party_id and pw.currency = s.currency
      and pw.project_id is null
  ),
  parties as (
    select d.direction, d.party_id, d.currency, d.stream_project, d.auto_pace,
      coalesce(w.pace, d.auto_pace, 'month') as pace,
      w.recurring, w.pace as pace_override, w.amount as owner_amount,
      d.months6, d.day6, d.amount6, d.months24, d.day24, d.amount24, d.last_month, d.gap_last
    from detected d
    left join words w on w.direction = d.direction and w.party_id = d.party_id and w.currency = d.currency
      and w.stream_project is not distinct from d.stream_project
    where case
      when w.recurring is false then false
      when d.auto_pace is not null then true
      else coalesce(w.recurring, false)
    end
  ),
  -- A charge that comes every 2 months, quarter or year (decision 0199): its usual day and amount come only
  -- from the months on its cycle, counted back from its last complete month (last, last - pace, last - 2 x
  -- pace, ... within the 24 months the lines cover). The months before a switch to yearly billing (the old
  -- monthly bills) and an off-cycle extra no longer pull the median down. The same median rule: by size,
  -- the direction's sign added in chosen. A yearly charge steps by its last gap when that is 11 to 13 months,
  -- the drift the yearly rule allows (0175), so a bill a month early or late still finds last year's.
  cycle_months as (
    select p.direction, p.party_id, p.currency, p.stream_project, g.month, g.first_day, g.amount
    from parties p
    join gapped g on g.direction = p.direction and g.party_id = p.party_id and g.currency = p.currency
      and g.stream_project is not distinct from p.stream_project
    where p.pace <> 'month'
      and private.month_diff(p.last_month, g.month)
        % case when p.pace = 'year' and p.gap_last between 11 and 13 then p.gap_last else private.pace_months(p.pace) end = 0
  ),
  cycle as (
    select cm.direction, cm.party_id, cm.currency, cm.stream_project,
      percentile_disc(0.5) within group (order by cm.first_day) as day_cycle,
      percentile_disc(0.5) within group (order by abs(cm.amount)) as amount_cycle
    from cycle_months cm
    group by cm.direction, cm.party_id, cm.currency, cm.stream_project
  ),
  -- A charge the owner marked recurring with no complete posted month yet: its latest month, this one
  -- included, is its usual day and amount (the owner's amount, when set).
  forced_monthly as (
    select l.direction, l.party_id, l.currency, l.stream_project, l.month,
      sum(l.amount_net) as amount, min(extract(day from l.doc_date))::integer as first_day
    from lines l
    join words w on w.direction = l.direction and w.party_id = l.party_id and w.currency = l.currency
      and w.stream_project is not distinct from l.stream_project
    where w.recurring
      and not exists (
        select 1 from stats s
        where s.direction = l.direction and s.party_id = l.party_id and s.currency = l.currency
          and s.stream_project is not distinct from l.stream_project
      )
    group by l.direction, l.party_id, l.currency, l.stream_project, l.month
  ),
  forced as (
    select distinct on (fm.direction, fm.party_id, fm.currency, fm.stream_project)
      fm.direction, fm.party_id, fm.currency, fm.stream_project, coalesce(w.pace, 'month') as pace, w.pace as pace_override,
      0 as months_seen, fm.first_day as typical_day,
      coalesce((case when fm.direction = 'expense' then -1 else 1 end) * w.amount, fm.amount)::bigint as typical_amount_minor,
      case when w.amount is null then 'computed' else 'owner' end as amount_source
    from forced_monthly fm
    join words w on w.direction = fm.direction and w.party_id = fm.party_id and w.currency = fm.currency
      and w.stream_project is not distinct from fm.stream_project
    order by fm.direction, fm.party_id, fm.currency, fm.stream_project, fm.month desc
  ),
  chosen as (
    select p.direction, p.party_id, p.currency, p.stream_project, p.pace, p.pace_override,
      case when p.pace = 'month' and p.months6 > 0 then p.months6 else p.months24 end as months_seen,
      case
        when p.pace = 'month' and p.months6 > 0 then p.day6
        -- The last month is always on its own cycle, so every known pace has cycle months; the fallback
        -- to the 24 months is only for a pace pace_months does not know.
        when p.pace <> 'month' then coalesce(c.day_cycle, p.day24)
        else p.day24
      end::integer as typical_day,
      -- The owner's amount, else the median by size (of the last 6 months for a monthly charge, of the
      -- cycle's months for any other pace), with the direction's sign, so an even count does not lean one way.
      ((case when p.direction = 'expense' then -1 else 1 end)
        * coalesce(p.owner_amount, case
            when p.pace = 'month' and p.months6 > 0 then p.amount6
            when p.pace <> 'month' then coalesce(c.amount_cycle, p.amount24)
            else p.amount24
          end))::bigint
        as typical_amount_minor,
      case when p.recurring is null then 'auto' else 'user' end as source,
      case when p.owner_amount is null then 'computed' else 'owner' end as amount_source
    from parties p
    left join cycle c on c.direction = p.direction and c.party_id = p.party_id and c.currency = p.currency
      and c.stream_project is not distinct from p.stream_project
    union all
    select f.direction, f.party_id, f.currency, f.stream_project, f.pace, f.pace_override,
      f.months_seen, f.typical_day, f.typical_amount_minor, 'user', f.amount_source
    from forced f
  ),
  -- The charges in the order they come out of chosen, kept to the end: the joins below may reorder
  -- them, and readers that list charges with equal sort keys keep the order they had.
  ordered as (
    select c.*, row_number() over () as ord
    from chosen c
  ),
  -- Each charge's last posted bill: its date and every posted line of the charge on that date, read for
  -- every charge in one pass (FLOW-943; a subquery per charge before). Every stream line is posted, so the
  -- bill's month is also the last month the charge was seen.
  bills as (
    select distinct on (l.direction, l.party_id, l.currency, l.stream_project)
      l.direction, l.party_id, l.currency, l.stream_project, l.doc_date, sum(l.amount_net)::bigint as amount
    from lines l
    where l.posted
    group by l.direction, l.party_id, l.currency, l.stream_project, l.doc_date
    order by l.direction, l.party_id, l.currency, l.stream_project, l.doc_date desc
  ),
  -- This month's lines of each charge: their sum, the latest (by date, then entry, then id) and how many.
  this_month as (
    select l.direction, l.party_id, l.currency, l.stream_project, sum(l.amount_net)::bigint as amount,
      (array_agg(l.id order by l.doc_date desc, l.created_at desc, l.id desc))[1] as transaction_id,
      count(*)::integer as line_count
    from lines l, bounds b
    where l.doc_date >= b.this_month
    group by l.direction, l.party_id, l.currency, l.stream_project
  ),
  -- The charges that pay a loan: any of the charge's lines is split into loan parts.
  loan_charges as (
    select distinct l.direction, l.party_id, l.currency, l.stream_project
    from lines l
    where exists (
      select 1 from public.loan_splits ls
      where ls.company_id = p_company and ls.transaction_id = l.id
    )
  ),
  seen as (
    select c.*,
      date_trunc('month', bl.doc_date)::date as last_seen_month,
      bl.doc_date as last_doc_date,
      bl.amount as last_amount,
      lc.direction is not null as pays_loan,
      tm.amount as this_month_minor,
      tm.transaction_id as this_month_transaction_id,
      coalesce(tm.line_count, 0) as this_month_line_count
    from ordered c
    left join bills bl on bl.direction = c.direction and bl.party_id = c.party_id and bl.currency = c.currency
      and bl.stream_project is not distinct from c.stream_project
    left join loan_charges lc on lc.direction = c.direction and lc.party_id = c.party_id and lc.currency = c.currency
      and lc.stream_project is not distinct from c.stream_project
    left join this_month tm on tm.direction = c.direction and tm.party_id = c.party_id and tm.currency = c.currency
      and tm.stream_project is not distinct from c.stream_project
  )
  select p.direction, p.party_id, p.currency, p.months_seen, p.typical_day, p.typical_amount_minor,
    p.last_doc_date,
    p.last_seen_month = b.this_month,
    -- The charge's project is its stream's (null when none of the party's lines has one).
    p.stream_project,
    (select l.category_id from lines l
     where l.direction = p.direction and l.party_id = p.party_id and l.currency = p.currency
       and l.stream_project is not distinct from p.stream_project
       and l.category_id is not null
       -- A monthly charge's category is from its last 6 months; any other pace's from its cycle's months
       -- and this month (decision 0199), so the old monthly bills before a switch don't name it. A charge
       -- with no cycle months (marked recurring before a complete month) reads all its lines.
       and case
         when p.pace = 'month' then l.doc_date >= b.window6
         else l.month >= b.this_month
           or exists (
             select 1 from cycle_months cm
             where cm.direction = p.direction and cm.party_id = p.party_id and cm.currency = p.currency
               and cm.stream_project is not distinct from p.stream_project and cm.month = l.month)
           or not exists (
             select 1 from cycle_months cm
             where cm.direction = p.direction and cm.party_id = p.party_id and cm.currency = p.currency
               and cm.stream_project is not distinct from p.stream_project)
       end
     group by l.category_id order by count(*) desc, max(l.doc_date) desc limit 1),
    p.last_amount,
    p.source,
    p.pace,
    case when p.pace_override is null then 'auto' else 'user' end,
    -- Monthly: this month until its bill comes, then next month. Otherwise one pace after the
    -- last month it was seen (earlier than this month when it is late).
    case
      when p.pace = 'month' then
        case when p.last_seen_month = b.this_month then (b.this_month + interval '1 month')::date else b.this_month end
      else (p.last_seen_month + make_interval(months => private.pace_months(p.pace)))::date
    end,
    p.amount_source,
    p.pays_loan,
    p.this_month_minor,
    p.this_month_transaction_id,
    p.this_month_line_count
  from seen p
  cross join bounds b
  order by p.ord;
$function$;

revoke all on function private.recurring_parties(uuid, date, boolean) from public, anon, authenticated;

-- recurring_arrivals takes each charge's lines this month (sum, latest line, count) from recurring_parties
-- instead of reading every stream line again, and also returns the count (line_count), so
-- recurring_arrivals_json no longer reads the stream lines a third time to count them (FLOW-943). The
-- same lines: the charge's own this month. When two of them share the latest date and entry time, the
-- higher id is now the latest (it was whichever came first). Bodies are 20261019063254's otherwise.
drop function private.recurring_arrivals(uuid, date);
create function private.recurring_arrivals(p_company uuid, p_today date)
 RETURNS TABLE(direction txn_direction, party_id uuid, currency text, amount_minor bigint, typical_amount_minor bigint, change_percent integer, typical_day integer, transaction_id uuid, project_id uuid, category_id uuid, source text, pace text, first_month boolean, line_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- Each charge with lines this month: their sum, latest line and count come with the charge from
  -- recurring_parties (its party and its project, a split line's own parts only, decision 0189).
  select r.direction, r.party_id, r.currency, r.this_month_minor, r.typical_amount_minor,
    round((abs(r.this_month_minor) - abs(r.typical_amount_minor)) * 100.0 / abs(r.typical_amount_minor))::integer,
    r.typical_day, r.this_month_transaction_id, r.project_id, r.category_id, r.source, r.pace, r.months_seen = 0,
    r.this_month_line_count
  from private.recurring_parties(p_company, p_today) r
  -- A party with no complete month yet has its usual amount from this month itself, unless the owner set it.
  where r.seen_this_month and r.typical_amount_minor <> 0
    and (r.months_seen > 0 or r.typical_amount_source = 'owner')
    and r.this_month_line_count > 0;
$function$;

revoke all on function private.recurring_arrivals(uuid, date) from public, anon, authenticated;

create or replace function private.recurring_arrivals_json(p_company uuid, p_today date, p_changes boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
      'direction', a.direction,
      'party_id', a.party_id,
      'party_name', coalesce(s.name, cu.name),
      'supplier_id', s.id,
      'supplier_name', s.name,
      'currency', a.currency,
      'amount_minor', a.amount_minor,
      'typical_amount_minor', a.typical_amount_minor,
      'change_percent', a.change_percent,
      'changed', a.changed,
      'typical_day', a.typical_day,
      'transaction_id', a.transaction_id,
      'project_id', a.project_id,
      'project_name', p.name,
      'category_id', a.category_id,
      'category_name', c.name,
      'source', a.source,
      'pace', a.pace,
      'alert_key', a.transaction_id::text,
      -- FLOW-913: how many of this month's lines make up the amount: the charge's own (its party and project).
      'line_count', a.line_count
    ) order by
      case when p_changes then abs(a.change_percent) end desc,
      a.direction = 'income', coalesce(s.name, cu.name), p.name, a.party_id), '[]'::jsonb)
  from (
    select ar.*,
      -- An owner's usual amount in the charge's first month seen is no change (decision 0189).
      abs(abs(ar.amount_minor) - abs(ar.typical_amount_minor)) * 5 >= abs(ar.typical_amount_minor)
        and not ar.first_month as changed
    from private.recurring_arrivals(p_company, p_today) ar
  ) a
  left join public.suppliers s on a.direction = 'expense' and s.company_id = p_company and s.id = a.party_id
  left join public.customers cu on a.direction = 'income' and cu.company_id = p_company and cu.id = a.party_id
  left join public.projects p on p.company_id = p_company and p.id = a.project_id
  left join public.categories c on c.company_id = p_company and c.id = a.category_id
  where coalesce(s.id, cu.id) is not null
    and (not p_changes or (a.changed and not exists (
      select 1 from public.recurring_dismissals x
      where x.user_id = auth.uid() and x.company_id = p_company and x.kind = 'change'
        and x.alert_key = a.transaction_id::text
    )));
$function$;

revoke all on function private.recurring_arrivals_json(uuid, date, boolean) from public, anon, authenticated;

-- A project's arrivals pick the latest line this month the way recurring_parties does: by date, then entry,
-- then the higher id. Home's recurring_changes and the project page's project_recurring_changes key a change
-- alert, and its dismissal, on that line, so two lines with the same date and entry time (one bank sync) now
-- give both screens the same key (FLOW-943). The body is 20261020102512's otherwise.
create or replace function private.project_recurring_arrivals(p_company uuid, p_project uuid, p_today date)
 RETURNS TABLE(direction txn_direction, party_id uuid, currency text, amount_minor bigint, typical_amount_minor bigint, change_percent integer, typical_day integer, transaction_id uuid, line_count integer, category_id uuid, source text, pace text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with bounds as (
    select date_trunc('month', p_today)::date as this_month,
      (date_trunc('month', p_today) - interval '6 months')::date as window6,
      (date_trunc('month', p_today) - interval '24 months')::date as window24
  ),
  r as (
    select rp.* from private.recurring_parties(p_company, p_today) rp
    -- A first month raises no change on the project either (decision 0189), the owner's amount or not.
    where rp.seen_this_month and rp.months_seen > 0
  ),
  -- Each charge's lines (its party and project, recurring_stream_lines) and their share in this project.
  shares as (
    select r.direction, r.party_id, r.currency, r.project_id as stream_project, r.pace, sl.id, sl.doc_date, sl.created_at,
      date_trunc('month', sl.doc_date)::date as month, true as posted,
      case when sl.project_id = p_project then sl.amount_net else 0 end as share
    from r
    join private.recurring_stream_lines(p_company, p_today) sl
      on sl.direction = r.direction and sl.party_id = r.party_id and sl.currency = r.currency
      and sl.stream_project is not distinct from r.project_id
  ),
  -- Each charge's last complete month (any project's share), the anchor of a non-monthly cycle, and its step:
  -- the pace's months, or for a yearly charge its last gap when that is 11 to 13 (as recurring_parties).
  last_months as (
    select m.direction, m.party_id, m.currency, m.stream_project, m.months[1] as last_month,
      case when m.pace = 'year' and private.month_diff(m.months[1], m.months[2]) between 11 and 13
        then private.month_diff(m.months[1], m.months[2]) else private.pace_months(m.pace) end as step
    from (
      select s.direction, s.party_id, s.currency, s.stream_project, s.pace,
        array_agg(distinct s.month order by s.month desc) as months
      from shares s, bounds b
      where s.posted and s.month < b.this_month
      group by s.direction, s.party_id, s.currency, s.stream_project, s.pace
    ) m
  ),
  usual as (
    -- As recurring_parties: complete posted months, the last 6 for a monthly party; for any other pace the
    -- months on its cycle counted back from its last complete month, within 24 (decision 0199).
    select m.direction, m.party_id, m.currency, m.stream_project,
      percentile_disc(0.5) within group (order by abs(m.amount)) as amount
    from (
      select s.direction, s.party_id, s.currency, s.stream_project, s.month, sum(s.share) as amount
      from shares s
      cross join bounds b
      join last_months lm on lm.direction = s.direction and lm.party_id = s.party_id and lm.currency = s.currency
        and lm.stream_project is not distinct from s.stream_project
      where s.posted and s.month < b.this_month
        and case
          when s.pace = 'month' then s.month >= b.window6
          else s.month >= b.window24 and private.month_diff(lm.last_month, s.month) % lm.step = 0
        end
      group by s.direction, s.party_id, s.currency, s.stream_project, s.month
      having sum(s.share) <> 0
    ) m
    group by m.direction, m.party_id, m.currency, m.stream_project
  ),
  this_month as (
    select s.direction, s.party_id, s.currency, s.stream_project, sum(s.share)::bigint as amount, count(*)::integer as line_count,
      (array_agg(s.id order by s.doc_date desc, s.created_at desc, s.id desc))[1] as transaction_id
    from shares s, bounds b
    where s.share <> 0 and s.doc_date >= b.this_month
    group by s.direction, s.party_id, s.currency, s.stream_project
  ),
  -- The usual amount: the owner's (the charge's own, decision 0189), else the median of this project's share.
  usual_amount as (
    select r.direction, r.party_id, r.currency, r.project_id,
      case when r.typical_amount_source = 'owner' then abs(r.typical_amount_minor) else u.amount end as amount
    from r
    left join usual u on u.direction = r.direction and u.party_id = r.party_id and u.currency = r.currency
      and u.stream_project is not distinct from r.project_id
  )
  select r.direction, r.party_id, r.currency, m.amount,
    ((case when r.direction = 'expense' then -1 else 1 end) * u.amount)::bigint,
    round((abs(m.amount) - u.amount) * 100.0 / u.amount)::integer,
    r.typical_day, m.transaction_id, m.line_count, r.category_id, r.source, r.pace
  from r
  join this_month m on m.direction = r.direction and m.party_id = r.party_id and m.currency = r.currency
    and m.stream_project is not distinct from r.project_id
  join usual_amount u on u.direction = r.direction and u.party_id = r.party_id and u.currency = r.currency
    and u.project_id is not distinct from r.project_id
  where m.amount <> 0 and u.amount <> 0;
$function$;

revoke all on function private.project_recurring_arrivals(uuid, uuid, date) from public, anon, authenticated;

-- expected_months reads pays_loan from recurring_parties instead of reading the stream lines again
-- (FLOW-943). The body is 20261018164154's otherwise.
CREATE OR REPLACE FUNCTION public.expected_months(p_months integer DEFAULT 3, p_project_id uuid DEFAULT NULL::uuid, p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_months is null or p_months < 1 or p_months > 12 then
    raise exception 'validation';
  end if;
  return (
    with r as (
      select * from private.recurring_parties(cid, today) rp
      where p_project_id is null or rp.project_id = p_project_id
    ),
    months as (
      select n, (date_trunc('month', today) + make_interval(months => n))::date as month
      from generate_series(0, p_months - 1) n
    ),
    cells as (
      select m.month, r.currency, r.direction, r.typical_amount_minor as amount
      from months m
      join r on m.month >= greatest(r.next_due_month, date_trunc('month', today)::date)
        and private.month_diff(m.month, greatest(r.next_due_month, date_trunc('month', today)::date))
          % private.pace_months(r.pace) = 0
    ),
    per_month as (
      select m.month,
        coalesce((
          select jsonb_agg(jsonb_build_object(
              'currency', c.currency,
              'income_minor', c.income,
              'expense_minor', c.expense
            ) order by c.currency <> 'ILS', c.currency)
          from (
            select cl.currency,
              coalesce(sum(cl.amount) filter (where cl.direction = 'income'), 0)::bigint as income,
              coalesce(sum(cl.amount) filter (where cl.direction = 'expense'), 0)::bigint as expense
            from cells cl where cl.month = m.month
            group by cl.currency
          ) c
        ), '[]'::jsonb) as by_currency
      from months m
    )
    select jsonb_build_object(
      'today', today,
      'project_id', p_project_id,
      'months', (select jsonb_agg(jsonb_build_object(
          'month', to_char(pm.month, 'YYYY-MM'),
          'open', pm.month = date_trunc('month', today)::date,
          'by_currency', pm.by_currency
        ) order by pm.month) from per_month pm),
      'recurring', coalesce((select jsonb_agg(jsonb_build_object(
          'direction', r.direction,
          'party_id', r.party_id,
          'name', coalesce(s.name, cu.name),
          'currency', r.currency,
          'typical_amount_minor', r.typical_amount_minor,
          'typical_day', r.typical_day,
          'months_seen', r.months_seen,
          'seen_this_month', r.seen_this_month,
          'project_id', r.project_id,
          'category_id', r.category_id,
          'source', r.source,
          'pace', r.pace,
          'next_due_month', to_char(r.next_due_month, 'YYYY-MM'),
          -- Any of the charge's stream lines is split into loan parts (recurring_parties says).
          'pays_loan', r.pays_loan
        ) order by r.direction, coalesce(s.name, cu.name), r.party_id)
        from r
        left join public.suppliers s on r.direction = 'expense' and s.company_id = cid and s.id = r.party_id
        left join public.customers cu on r.direction = 'income' and cu.company_id = cid and cu.id = r.party_id
      ), '[]'::jsonb)
    )
  );
end;
$function$;

revoke all on function public.expected_months(integer, uuid, date) from public, anon;
grant execute on function public.expected_months(integer, uuid, date) to authenticated, service_role;

commit;
