-- FLOW-998. private.recurring_parties picks each charge's category in one grouped pass over the charges'
-- lines, not a subquery per charge (each of which scanned every line of the charge and ran two
-- correlated lookups into the cycle months per line). Same rule: the category of most of the charge's
-- counted lines, then of its latest line; a full tie (same count, same latest date) now takes the lowest
-- id, where it was arbitrary before. Same signature, grants and answers otherwise.
-- The rest of the body is the latest live one (20261028093217_ledger_only.sql).
begin;
set local lock_timeout = '5s';

create or replace function private.recurring_parties(p_company uuid, p_today date, p_overrides boolean DEFAULT true)
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
      select 1 from private.loan_parts ls
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
  ),
  -- Each charge's category, for every charge in one pass (FLOW-998; a subquery per charge before): the
  -- category of most of its lines, then of its latest line, then the lowest id (a tie on both was arbitrary
  -- before). A monthly charge's category is from its last 6 months; any other pace's from its cycle's months
  -- and this month (decision 0199), so the old monthly bills before a switch don't name it. A charge with no
  -- cycle months (marked recurring before a complete month) reads all its lines.
  cycle_charges as (
    select distinct cm.direction, cm.party_id, cm.currency, cm.stream_project
    from cycle_months cm
  ),
  picks as (
    select distinct on (p.ord) p.ord, l.category_id
    from seen p
    cross join bounds b
    join lines l on l.direction = p.direction and l.party_id = p.party_id and l.currency = p.currency
      and l.stream_project is not distinct from p.stream_project
    left join cycle_months cm on cm.direction = p.direction and cm.party_id = p.party_id and cm.currency = p.currency
      and cm.stream_project is not distinct from p.stream_project and cm.month = l.month
    left join cycle_charges cc on cc.direction = p.direction and cc.party_id = p.party_id and cc.currency = p.currency
      and cc.stream_project is not distinct from p.stream_project
    where l.category_id is not null
      and case
        when p.pace = 'month' then l.doc_date >= b.window6
        else l.month >= b.this_month or cm.month is not null or cc.party_id is null
      end
    group by p.ord, l.category_id
    order by p.ord, count(*) desc, max(l.doc_date) desc, l.category_id
  )
  select p.direction, p.party_id, p.currency, p.months_seen, p.typical_day, p.typical_amount_minor,
    p.last_doc_date,
    p.last_seen_month = b.this_month,
    -- The charge's project is its stream's (null when none of the party's lines has one).
    p.stream_project,
    pk.category_id,
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
  left join picks pk on pk.ord = p.ord
  order by p.ord;
$function$;

commit;
