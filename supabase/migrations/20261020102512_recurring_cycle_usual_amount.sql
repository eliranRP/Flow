-- Decision 0199 (amends 0175's usual amount). A recurring charge that comes every 2 months, quarter or year
-- takes its usual amount and day only from the months on its cycle.
-- The owner's case: a supplier billed a small amount every month, then switched to a yearly plan (the switch
-- month carried a last monthly bill and the first yearly one). A year later the yearly bill came again, so
-- the pace is yearly and the next due month a year on, both right. But the usual amount was the median of
-- every month's total over 24 months, and the old monthly bills outnumbered the yearly ones, so the yearly
-- charge's usual amount was a monthly bill's.
-- - private.recurring_parties: for a pace other than month, the usual amount and day are the median (by size,
--   the direction's sign, as before) of the months on the charge's cycle, counted back from its last complete
--   month: last, last - pace, last - 2 x pace, ... within the 24-month window. A monthly charge is unchanged
--   (the last 6 months, else 24), the owner's amount still wins (typical_amount_source 'owner'), and a charge
--   the owner marked recurring with no complete month is unchanged. months_seen stays the months in 24.
--   The body is 20261019063254's otherwise; the return type is the same, so it is replaced in place.
--   Its readers follow: the arrivals and changes (recurring_this_month, recurring_changes), missing_bills,
--   payment_recurring, expected_months, the schedule, a line's charges, company_next_month_inputs.
-- - private.project_recurring_arrivals (the project's changes) computes its own median of the project's
--   share "as recurring_parties", so it takes the same cycle months. The body is 20261019063254's otherwise.
begin;
set local lock_timeout = '5s';

-- recurring_parties: a non-monthly charge's usual amount and day from its cycle's months (decision 0199).
create or replace function private.recurring_parties(p_company uuid, p_today date, p_overrides boolean DEFAULT true)
 RETURNS TABLE(direction txn_direction, party_id uuid, currency text, months_seen integer, typical_day integer, typical_amount_minor bigint, last_doc_date date, seen_this_month boolean, project_id uuid, category_id uuid, last_amount_minor bigint, source text, pace text, pace_source text, next_due_month date, typical_amount_source text)
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
      date_trunc('month', sl.doc_date)::date as month, true as posted
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
      d.months6, d.day6, d.amount6, d.months24, d.day24, d.amount24, d.last_month
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
  -- the direction's sign added in chosen.
  cycle as (
    select p.direction, p.party_id, p.currency, p.stream_project,
      percentile_disc(0.5) within group (order by g.first_day) as day_cycle,
      percentile_disc(0.5) within group (order by abs(g.amount)) as amount_cycle
    from parties p
    join gapped g on g.direction = p.direction and g.party_id = p.party_id and g.currency = p.currency
      and g.stream_project is not distinct from p.stream_project
    where p.pace <> 'month'
      and private.month_diff(p.last_month, g.month) % private.pace_months(p.pace) = 0
    group by p.direction, p.party_id, p.currency, p.stream_project
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
  seen as (
    select c.*,
      (select max(l.month) from lines l
       where l.direction = c.direction and l.party_id = c.party_id and l.currency = c.currency
         and l.stream_project is not distinct from c.stream_project) as last_seen_month
    from chosen c
  )
  select p.direction, p.party_id, p.currency, p.months_seen, p.typical_day, p.typical_amount_minor,
    last_bill.doc_date,
    p.last_seen_month = b.this_month,
    -- The charge's project is its stream's (null when none of the party's lines has one).
    p.stream_project,
    (select l.category_id from lines l
     where l.direction = p.direction and l.party_id = p.party_id and l.currency = p.currency
       and l.stream_project is not distinct from p.stream_project
       and l.category_id is not null
       and (p.pace <> 'month' or l.doc_date >= b.window6)
     group by l.category_id order by count(*) desc, max(l.doc_date) desc limit 1),
    last_bill.amount,
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
    p.amount_source
  from seen p
  cross join bounds b
  -- The last posted bill: its date, and every posted line of the charge on that date.
  left join lateral (
    select l.doc_date, sum(l.amount_net)::bigint as amount
    from lines l
    where l.posted and l.direction = p.direction and l.party_id = p.party_id and l.currency = p.currency
      and l.stream_project is not distinct from p.stream_project
    group by l.doc_date
    order by l.doc_date desc
    limit 1
  ) last_bill on true;
$function$;

revoke all on function private.recurring_parties(uuid, date, boolean) from public, anon, authenticated;

-- A project's arrivals compare with the median of the project's share over the same months recurring_parties
-- uses: for a non-monthly pace, the months on the charge's cycle (decision 0199).
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
  -- Each charge's last complete month (any project's share), the anchor of a non-monthly cycle.
  last_months as (
    select s.direction, s.party_id, s.currency, s.stream_project, max(s.month) as last_month
    from shares s, bounds b
    where s.posted and s.month < b.this_month
    group by s.direction, s.party_id, s.currency, s.stream_project
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
          else s.month >= b.window24 and private.month_diff(lm.last_month, s.month) % private.pace_months(s.pace) = 0
        end
      group by s.direction, s.party_id, s.currency, s.stream_project, s.month
      having sum(s.share) <> 0
    ) m
    group by m.direction, m.party_id, m.currency, m.stream_project
  ),
  this_month as (
    select s.direction, s.party_id, s.currency, s.stream_project, sum(s.share)::bigint as amount, count(*)::integer as line_count,
      (array_agg(s.id order by s.doc_date desc, s.created_at desc))[1] as transaction_id
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

commit;
