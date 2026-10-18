-- A recurring charge is a party's charges for one project (decision 0185). A servicer that pays several
-- loans, or a utility that bills several properties, showed as one charge: its months summed every
-- property's payment, it took the most common project, and its change percent compared mixed months.
-- recurring_stream_lines gives each line the project its charge belongs to; recurring_parties and every
-- reader keyed by party now key by party and project (project_id is the charge's project).
-- Signatures and grants are unchanged, except recurring_party_line, which takes p_project_id.

-- The lines a recurring charge is read from, with the project each one's charge belongs to. A party's
-- filed lines go to their own project, so a servicer paying several loans, or a utility billing several
-- properties, is one charge per project (the owner's report, 2026-10-18: one servicer's payments for three
-- properties added up as one charge). A line not filed yet joins the party's project whose latest filed
-- amount is closest to it; a party with no filed line has one charge, with no project.
create or replace function private.recurring_stream_lines(p_company uuid, p_today date)
returns table(id uuid, direction public.txn_direction, party_id uuid, currency text, doc_date date,
  created_at timestamptz, amount_net bigint, project_id uuid, category_id uuid, stream_project uuid)
language sql
stable
security definer
set search_path = ''
as $function$
  with lines as (
    select t.id, t.direction, coalesce(mm.party_id, t.supplier_id, t.customer_id) as party_id, t.currency,
      t.doc_date, t.created_at, t.amount_net::bigint as amount_net, t.project_id, t.category_id
    from public.transactions t
    -- FLOW-430: a party answered "the same" counts as the recurring one.
    left join public.recurring_matches mm
      on mm.company_id = t.company_id and mm.direction = t.direction and mm.same
      and mm.match_party_id = coalesce(t.supplier_id, t.customer_id)
    where t.company_id = p_company
      and t.removed_at is null
      and t.line_status = 'posted'
      and ((t.direction = 'expense' and t.supplier_id is not null)
        or (t.direction = 'income' and t.customer_id is not null
          and t.doc_kind in ('invoice', 'credit', 'invoice_receipt')))
      and t.doc_date >= (date_trunc('month', p_today) - interval '24 months')::date
      and t.doc_date <= p_today
  ),
  -- Each project a party's filed lines went to, with its latest filed amount.
  filed as (
    select distinct on (l.direction, l.party_id, l.currency, l.project_id)
      l.direction, l.party_id, l.currency, l.project_id, abs(l.amount_net) as amount, l.doc_date
    from lines l
    where l.project_id is not null
    order by l.direction, l.party_id, l.currency, l.project_id, l.doc_date desc, l.created_at desc
  )
  select l.id, l.direction, l.party_id, l.currency, l.doc_date, l.created_at, l.amount_net, l.project_id, l.category_id,
    coalesce(l.project_id, (
      select f.project_id from filed f
      where f.direction = l.direction and f.party_id = l.party_id and f.currency = l.currency
      order by abs(f.amount - abs(l.amount_net)), f.doc_date desc, f.project_id
      limit 1
    )) as stream_project
  from lines l;
$function$;

revoke all on function private.recurring_stream_lines(uuid, date) from public, anon, authenticated;

create or replace function private.recurring_parties(p_company uuid, p_today date, p_overrides boolean DEFAULT true)
 RETURNS TABLE(direction txn_direction, party_id uuid, currency text, months_seen integer, typical_day integer, typical_amount_minor bigint, last_doc_date date, seen_this_month boolean, project_id uuid, category_id uuid, last_amount_minor bigint, source text, pace text, pace_source text, next_due_month date)
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
  lines as (
    select sl.direction, sl.party_id, sl.currency, sl.stream_project,
      sl.doc_date, sl.amount_net, sl.project_id, sl.category_id,
      date_trunc('month', sl.doc_date)::date as month, true as posted
    from private.recurring_stream_lines(p_company, p_today) sl
  ),
  overrides as (
    select o.direction, o.party_id, o.currency, o.recurring, o.pace
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
  parties as (
    select d.direction, d.party_id, d.currency, d.stream_project, d.auto_pace,
      coalesce(o.pace, d.auto_pace, 'month') as pace,
      o.recurring, o.pace as pace_override,
      d.months6, d.day6, d.amount6, d.months24, d.day24, d.amount24
    from detected d
    left join overrides o on o.direction = d.direction and o.party_id = d.party_id and o.currency = d.currency
    where coalesce(o.recurring, d.auto_pace is not null)
  ),
  -- A party the owner marked recurring with no complete posted month yet: its latest month,
  -- this one included, is its usual day and amount.
  forced_monthly as (
    select l.direction, l.party_id, l.currency, l.stream_project, l.month,
      sum(l.amount_net) as amount, min(extract(day from l.doc_date))::integer as first_day
    from lines l
    join overrides o on o.direction = l.direction and o.party_id = l.party_id and o.currency = l.currency
    where o.recurring
      and not exists (
        select 1 from stats s
        where s.direction = l.direction and s.party_id = l.party_id and s.currency = l.currency
          and s.stream_project is not distinct from l.stream_project
      )
    group by l.direction, l.party_id, l.currency, l.stream_project, l.month
  ),
  forced as (
    select distinct on (fm.direction, fm.party_id, fm.currency, fm.stream_project)
      fm.direction, fm.party_id, fm.currency, fm.stream_project, coalesce(o.pace, 'month') as pace, o.pace as pace_override,
      0 as months_seen, fm.first_day as typical_day, fm.amount::bigint as typical_amount_minor
    from forced_monthly fm
    join overrides o on o.direction = fm.direction and o.party_id = fm.party_id and o.currency = fm.currency
    order by fm.direction, fm.party_id, fm.currency, fm.stream_project, fm.month desc
  ),
  chosen as (
    select p.direction, p.party_id, p.currency, p.stream_project, p.pace, p.pace_override,
      case when p.pace = 'month' and p.months6 > 0 then p.months6 else p.months24 end as months_seen,
      case when p.pace = 'month' and p.months6 > 0 then p.day6 else p.day24 end::integer as typical_day,
      -- The median by size, with the direction's sign, so an even count does not lean one way.
      ((case when p.direction = 'expense' then -1 else 1 end)
        * case when p.pace = 'month' and p.months6 > 0 then p.amount6 else p.amount24 end)::bigint
        as typical_amount_minor,
      case when p.recurring is null then 'auto' else 'user' end as source
    from parties p
    union all
    select f.direction, f.party_id, f.currency, f.stream_project, f.pace, f.pace_override,
      f.months_seen, f.typical_day, f.typical_amount_minor, 'user'
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
    end
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

create or replace function private.recurring_arrivals(p_company uuid, p_today date)
 RETURNS TABLE(direction txn_direction, party_id uuid, currency text, amount_minor bigint, typical_amount_minor bigint, change_percent integer, typical_day integer, transaction_id uuid, project_id uuid, category_id uuid, source text, pace text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with r as (
    select * from private.recurring_parties(p_company, p_today) rp
    -- A party with no complete month yet has its usual amount from this month itself.
    where rp.seen_this_month and rp.typical_amount_minor <> 0 and rp.months_seen > 0
  ),
  -- This month's lines of each charge: its party and its project (recurring_stream_lines).
  this_month as (
    select r.direction, r.party_id, r.currency, r.project_id, sum(sl.amount_net)::bigint as amount,
      (array_agg(sl.id order by sl.doc_date desc, sl.created_at desc))[1] as transaction_id
    from r
    join private.recurring_stream_lines(p_company, p_today) sl
      on sl.direction = r.direction and sl.party_id = r.party_id and sl.currency = r.currency
      and sl.stream_project is not distinct from r.project_id
    where sl.doc_date >= date_trunc('month', p_today)::date
    group by r.direction, r.party_id, r.currency, r.project_id
  )
  select r.direction, r.party_id, r.currency, m.amount, r.typical_amount_minor,
    round((abs(m.amount) - abs(r.typical_amount_minor)) * 100.0 / abs(r.typical_amount_minor))::integer,
    r.typical_day, m.transaction_id, r.project_id, r.category_id, r.source, r.pace
  from r
  join this_month m on m.direction = r.direction and m.party_id = r.party_id and m.currency = r.currency
    and m.project_id is not distinct from r.project_id;
$function$;

create or replace function private.recurring_arrivals_json(p_company uuid, p_today date, p_changes boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with lines as (
    select * from private.recurring_stream_lines(p_company, p_today)
  )
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
      'line_count', n.line_count
    ) order by
      case when p_changes then abs(a.change_percent) end desc,
      a.direction = 'income', coalesce(s.name, cu.name), p.name, a.party_id), '[]'::jsonb)
  from (
    select ar.*,
      abs(abs(ar.amount_minor) - abs(ar.typical_amount_minor)) * 5 >= abs(ar.typical_amount_minor) as changed
    from private.recurring_arrivals(p_company, p_today) ar
  ) a
  left join public.suppliers s on a.direction = 'expense' and s.company_id = p_company and s.id = a.party_id
  left join public.customers cu on a.direction = 'income' and cu.company_id = p_company and cu.id = a.party_id
  left join public.projects p on p.company_id = p_company and p.id = a.project_id
  left join public.categories c on c.company_id = p_company and c.id = a.category_id
  -- FLOW-913: how many of this month's lines make up the amount: the charge's own (its party and project).
  cross join lateral (
    select count(*)::integer as line_count
    from lines sl
    where sl.direction = a.direction and sl.party_id = a.party_id and sl.currency = a.currency
      and sl.stream_project is not distinct from a.project_id
      and sl.doc_date >= date_trunc('month', p_today)::date
  ) n
  where coalesce(s.id, cu.id) is not null
    and (not p_changes or (a.changed and not exists (
      select 1 from public.recurring_dismissals x
      where x.user_id = auth.uid() and x.company_id = p_company and x.kind = 'change'
        and x.alert_key = a.transaction_id::text
    )));
$function$;

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
    where rp.seen_this_month and rp.months_seen > 0
  ),
  -- Each charge's lines (its party and project, recurring_stream_lines) and their share in this project.
  shares as (
    select r.direction, r.party_id, r.currency, r.project_id as stream_project, r.pace, sl.id, sl.doc_date, sl.created_at,
      date_trunc('month', sl.doc_date)::date as month, true as posted,
      case
        when exists (select 1 from public.line_splits s where s.company_id = p_company and s.transaction_id = sl.id)
          then sign(sl.amount_net)::bigint * (
            select coalesce(sum(s.amount_minor), 0) from public.line_splits s
            where s.company_id = p_company and s.transaction_id = sl.id
              and coalesce(s.project_id, sl.project_id) = p_project)
        when sl.project_id = p_project then sl.amount_net
        else 0
      end as share
    from r
    join private.recurring_stream_lines(p_company, p_today) sl
      on sl.direction = r.direction and sl.party_id = r.party_id and sl.currency = r.currency
      and sl.stream_project is not distinct from r.project_id
  ),
  usual as (
    -- As recurring_parties: complete posted months, the last 6 for a monthly party, else 24.
    select m.direction, m.party_id, m.currency, m.stream_project,
      percentile_disc(0.5) within group (order by abs(m.amount)) as amount
    from (
      select s.direction, s.party_id, s.currency, s.stream_project, s.month, sum(s.share) as amount
      from shares s, bounds b
      where s.posted and s.month < b.this_month
        and s.month >= case when s.pace = 'month' then b.window6 else b.window24 end
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
  )
  select r.direction, r.party_id, r.currency, m.amount,
    ((case when r.direction = 'expense' then -1 else 1 end) * u.amount)::bigint,
    round((abs(m.amount) - u.amount) * 100.0 / u.amount)::integer,
    r.typical_day, m.transaction_id, m.line_count, r.category_id, r.source, r.pace
  from r
  join this_month m on m.direction = r.direction and m.party_id = r.party_id and m.currency = r.currency
    and m.stream_project is not distinct from r.project_id
  join usual u on u.direction = r.direction and u.party_id = r.party_id and u.currency = r.currency
    and u.stream_project is not distinct from r.project_id
  where m.amount <> 0 and u.amount <> 0;
$function$;

create or replace function private.recurring_schedule_json(p_company uuid, p_today date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with lines as (
    select * from private.recurring_stream_lines(p_company, p_today)
  ),
  this_month as (
    select date_trunc('month', p_today)::date as month_start
  ),
  due as (
    select r.*,
      make_date(extract(year from r.next_due_month)::integer, extract(month from r.next_due_month)::integer,
        least(r.typical_day + 5, extract(day from private.month_end(r.next_due_month))::integer)) as expected_by
    from private.recurring_parties(p_company, p_today) r
  ),
  rows as (
    select d.*,
      case
        when d.seen_this_month then 'arrived'
        when d.next_due_month > (select month_start from this_month) then 'later'
        when p_today > d.expected_by
          or (p_today = d.expected_by and d.expected_by = private.month_end(d.next_due_month)) then 'late'
        else 'soon'
      end as state
    from due d
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'direction', x.direction,
      'party_id', x.party_id,
      'party_name', coalesce(s.name, cu.name),
      'currency', x.currency,
      'state', x.state,
      'typical_amount_minor', x.typical_amount_minor,
      'amount_minor', case when x.seen_this_month then ma.amount end,
      'typical_day', x.typical_day,
      'pace', x.pace,
      'next_due_month', to_char(x.next_due_month, 'YYYY-MM'),
      'expected_by', x.expected_by,
      'project_id', x.project_id,
      'project_name', p.name,
      'category_id', x.category_id,
      'category_name', c.name
    ) order by
      case x.state when 'arrived' then 0 when 'late' then 1 when 'soon' then 2 else 3 end,
      x.direction = 'income', x.typical_day, coalesce(s.name, cu.name), p.name, x.party_id), '[]'::jsonb)
  from rows x
  -- This month's lines of the charge (its party and project), the same sum recurring_arrivals takes.
  left join lateral (
    select sum(sl.amount_net)::bigint as amount
    from lines sl
    where sl.direction = x.direction and sl.party_id = x.party_id and sl.currency = x.currency
      and sl.stream_project is not distinct from x.project_id
      and sl.doc_date >= date_trunc('month', p_today)::date
  ) ma on x.seen_this_month
  left join public.suppliers s on x.direction = 'expense' and s.company_id = p_company and s.id = x.party_id
  left join public.customers cu on x.direction = 'income' and cu.company_id = p_company and cu.id = x.party_id
  left join public.projects p on p.company_id = p_company and p.id = x.project_id
  left join public.categories c on c.company_id = p_company and c.id = x.category_id
  where coalesce(s.id, cu.id) is not null;
$function$;

create or replace function public.missing_bills(p_today date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (
    with due as (
      select r.*,
        make_date(extract(year from r.next_due_month)::integer, extract(month from r.next_due_month)::integer,
          least(r.typical_day + 5, extract(day from private.month_end(r.next_due_month))::integer)) as expected_by,
        -- A party with one charge keeps the key it always had; a party split by project adds its project.
        r.direction || ':' || r.party_id || ':' || r.currency || ':' || to_char(r.next_due_month, 'YYYY-MM')
          || case when r.charges > 1 then ':' || coalesce(r.project_id::text, 'none') else '' end as alert_key
      from (
        select rp.*, count(*) over (partition by rp.direction, rp.party_id, rp.currency) as charges
        from private.recurring_parties(cid, today) rp
      ) r
      where r.next_due_month <= date_trunc('month', today)::date
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'direction', d.direction,
        'party_id', d.party_id,
        'party_name', coalesce(s.name, cu.name),
        'supplier_id', s.id,
        'supplier_name', s.name,
        'currency', d.currency,
        'typical_amount_minor', d.typical_amount_minor,
        'typical_day', d.typical_day,
        'due_month', to_char(d.next_due_month, 'YYYY-MM'),
        'expected_by', d.expected_by,
        'months_seen', d.months_seen,
        'last_doc_date', d.last_doc_date,
        'last_amount_minor', d.last_amount_minor,
        'project_id', d.project_id,
        'project_name', p.name,
        'category_id', d.category_id,
        'category_name', c.name,
        'source', d.source,
        'pace', d.pace,
        'pace_source', d.pace_source,
        'alert_key', d.alert_key,
        'suggestion', private.recurring_match_suggestion(cid, d.direction, d.party_id, d.currency,
          d.next_due_month, d.typical_amount_minor, today)
      ) order by d.direction = 'income', d.typical_day, coalesce(s.name, cu.name), p.name, d.party_id), '[]'::jsonb)
    from due d
    left join public.suppliers s on d.direction = 'expense' and s.company_id = cid and s.id = d.party_id
    left join public.customers cu on d.direction = 'income' and cu.company_id = cid and cu.id = d.party_id
    left join public.projects p on p.company_id = cid and p.id = d.project_id
    left join public.categories c on c.company_id = cid and c.id = d.category_id
    where coalesce(s.id, cu.id) is not null
      -- A deadline past the month's end falls on its last day.
      and (today > d.expected_by or (today = d.expected_by and d.expected_by = private.month_end(d.next_due_month)))
      and not exists (
        select 1 from public.recurring_dismissals x
        where x.user_id = auth.uid() and x.company_id = cid and x.kind = 'missing' and x.alert_key = d.alert_key
      )
  );
end;
$$;

create or replace function private.payment_recurring_state(p_company uuid, p_transaction_id uuid, p_today date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  party record;
  override boolean;
  override_pace text;
  detected boolean;
  auto_pace text;
  usual_day integer;
  usual_amount bigint;
  chosen_pace text;
  due date;
  stream uuid;
begin
  if not exists (
    select 1 from public.transactions t
    where t.id = p_transaction_id and t.company_id = p_company and t.removed_at is null
  ) then
    return null;
  end if;
  select * into party from private.payment_party(p_company, p_transaction_id);
  if not found then
    return jsonb_build_object(
      'transaction_id', p_transaction_id,
      'party', null,
      'recurring', false,
      'override', null,
      'detected', false,
      'typical_day', null,
      'typical_amount_minor', null,
      'pace', null,
      'pace_override', null,
      'detected_pace', null,
      'next_due_month', null
    );
  end if;
  -- The line's own charge: its party and the project its stream goes to (recurring_stream_lines); a line
  -- outside the window reads its own project.
  select sl.stream_project into stream
  from private.recurring_stream_lines(p_company, p_today) sl
  where sl.id = p_transaction_id;
  if not found then
    select t.project_id into stream from public.transactions t where t.id = p_transaction_id;
  end if;
  select o.recurring, o.pace into override, override_pace
  from public.recurring_overrides o
  where o.company_id = p_company and o.direction = party.direction
    and o.party_id = party.party_id and o.currency = party.currency;
  select r.pace into auto_pace
  from private.recurring_parties(p_company, p_today, false) r
  where r.direction = party.direction and r.party_id = party.party_id and r.currency = party.currency
    and r.project_id is not distinct from stream;
  detected := auto_pace is not null;
  select r.typical_day, r.typical_amount_minor, r.pace, r.next_due_month
  into usual_day, usual_amount, chosen_pace, due
  from private.recurring_parties(p_company, p_today) r
  where r.direction = party.direction and r.party_id = party.party_id and r.currency = party.currency
    and r.project_id is not distinct from stream;
  return jsonb_build_object(
    'transaction_id', p_transaction_id,
    'party', jsonb_build_object(
      'direction', party.direction,
      'id', party.party_id,
      'name', party.name,
      'currency', party.currency
    ),
    'recurring', coalesce(override, detected),
    'override', override,
    'detected', detected,
    'typical_day', usual_day,
    'typical_amount_minor', usual_amount,
    'pace', coalesce(chosen_pace, override_pace, auto_pace),
    'pace_override', override_pace,
    'detected_pace', auto_pace,
    'next_due_month', to_char(due, 'YYYY-MM')
  );
end;
$$;

drop function public.recurring_party_line(text, uuid, text, date);

create or replace function public.recurring_party_line(p_direction text, p_party_id uuid, p_currency text, p_today date DEFAULT NULL::date, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  line_id uuid;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_direction is null or p_direction not in ('income', 'expense') then
    raise exception 'validation';
  end if;
  -- A party split by project: the newest line of that project's charge (recurring_stream_lines).
  if p_project_id is not null then
    select sl.id into line_id
    from private.recurring_stream_lines(cid, coalesce(p_today, private.flow_today())) sl
    where sl.direction = p_direction::public.txn_direction
      and sl.party_id = p_party_id
      and sl.currency = p_currency
      and sl.stream_project = p_project_id
    order by sl.doc_date desc, sl.created_at desc
    limit 1;
    return line_id;
  end if;
  select t.id into line_id
  from public.transactions t
  where t.company_id = cid
    and t.direction = p_direction::public.txn_direction
    and t.currency = p_currency
    and p_party_id = case when t.direction = 'expense' then t.supplier_id else t.customer_id end
    and t.removed_at is null
    and t.line_status = 'posted'
    and (t.direction = 'expense' or t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
    and t.doc_date <= coalesce(p_today, private.flow_today())
  order by t.doc_date desc, t.created_at desc
  limit 1;
  return line_id;
end;
$function$;

revoke all on function public.recurring_party_line(text, uuid, text, date, uuid) from public, anon;
grant execute on function public.recurring_party_line(text, uuid, text, date, uuid) to authenticated, service_role;
