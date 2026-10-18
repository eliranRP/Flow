-- Review follow-ups to decision 0185 (one recurring charge per party and project):
-- - The owner's "recurring" switch is per party, so it now makes only the party's main charge recurring
--   (the project it billed in the most of the last six complete months, then the latest). Another project's lines count only when they recur on their own;
--   before, one stray bill filed to another project became a monthly charge with a late alert.
-- - party_charges_json reads the usual amount of the line's own charge. A party merged with another
--   ("the same", FLOW-430) or a loan filed to two projects has two charges, and the scalar read failed.
-- - get_setup_suggestions sums a lender's charges, so a servicer with several loans is one lender again.
-- Signatures and grants are unchanged.
begin;
set local lock_timeout = '5s';

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
  -- The party's main charge: the project it billed in the most of the last six complete months (then the
  -- latest). The
  -- owner's switch is per party, so it makes this charge recurring; another project's lines count only
  -- when they recur on their own (decision 0185).
  main as (
    select distinct on (l.direction, l.party_id, l.currency) l.direction, l.party_id, l.currency, l.stream_project
    from lines l, bounds b
    group by l.direction, l.party_id, l.currency, l.stream_project
    order by l.direction, l.party_id, l.currency,
      count(distinct l.month) filter (where l.month >= b.window6 and l.month < b.this_month) desc, max(l.doc_date) desc,
      l.stream_project nulls last
  ),
  parties as (
    select d.direction, d.party_id, d.currency, d.stream_project, d.auto_pace,
      coalesce(o.pace, d.auto_pace, 'month') as pace,
      o.recurring, o.pace as pace_override,
      d.months6, d.day6, d.amount6, d.months24, d.day24, d.amount24
    from detected d
    left join overrides o on o.direction = d.direction and o.party_id = d.party_id and o.currency = d.currency
    left join main mn on mn.direction = d.direction and mn.party_id = d.party_id and mn.currency = d.currency
    where case
      when o.recurring is false then false
      when d.auto_pace is not null then true
      else coalesce(o.recurring, false) and d.stream_project is not distinct from mn.stream_project
    end
  ),
  -- A party the owner marked recurring whose main charge has no complete posted month yet: its latest
  -- month, this one included, is its usual day and amount.
  forced_monthly as (
    select l.direction, l.party_id, l.currency, l.stream_project, l.month,
      sum(l.amount_net) as amount, min(extract(day from l.doc_date))::integer as first_day
    from lines l
    join overrides o on o.direction = l.direction and o.party_id = l.party_id and o.currency = l.currency
    join main mn on mn.direction = l.direction and mn.party_id = l.party_id and mn.currency = l.currency
      and mn.stream_project is not distinct from l.stream_project
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

create or replace function private.party_charges_json(p_company uuid, p_transaction_id uuid, p_today date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with line as (
    select t.id, t.amount_net, t.doc_date, date_trunc('month', t.doc_date)::date as anchor
    from public.transactions t
    where t.id = p_transaction_id and t.company_id = p_company and t.removed_at is null
      and t.line_status = 'posted'
  ),
  party as (
    select pp.direction, pp.party_id, pp.currency, pp.name, l.anchor,
      -- The usual amount as of the line's own month: this month's line reads today's usual.
      least(p_today, (l.anchor + interval '1 month' - interval '1 day')::date) as as_of
    from line l, private.payment_party(p_company, p_transaction_id) pp
  ),
  -- The line's own context: its loan when it pays one, else its project and category, so a supplier
  -- with two loans (or two projects) compares this one with its own earlier charges.
  scope as (
    select t.project_id, t.category_id,
      (select ls.loan_id from public.loan_splits ls where ls.transaction_id = t.id limit 1) as loan_id
    from line l
    join public.transactions t on t.id = l.id
  ),
  party_lines as (
    select t.id, t.doc_date, t.amount_net as amount, t.created_at,
      date_trunc('month', t.doc_date)::date as month,
      case
        when s.loan_id is not null then exists (
          select 1 from public.loan_splits ls where ls.transaction_id = t.id and ls.loan_id = s.loan_id
        )
        else t.project_id is not distinct from s.project_id and t.category_id is not distinct from s.category_id
          and not exists (select 1 from public.loan_splits ls where ls.transaction_id = t.id)
      end as in_scope
    from party p
    cross join scope s
    join public.transactions t
      on t.company_id = p_company and t.direction = p.direction and t.currency = p.currency
      and p.party_id = case when p.direction = 'expense' then t.supplier_id else t.customer_id end
    where t.removed_at is null
      and t.line_status = 'posted'
      and (t.direction = 'expense' or t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      and t.doc_date >= (p.anchor - interval '24 months')::date
      -- A line dated after today still reads its own month.
      and t.doc_date <= greatest(p_today, p.anchor + interval '1 month' - interval '1 day')
  ),
  lines as (
    select pl.id, pl.doc_date, pl.amount, pl.created_at, pl.month from party_lines pl where pl.in_scope
  ),
  recurring as (
    select r.typical_amount_minor as usual
    from party p, private.recurring_parties(p_company, p.as_of) r
    where r.direction = p.direction and r.party_id = p.party_id and r.currency = p.currency
      and r.typical_amount_minor <> 0
      -- As in recurring_arrivals: a party marked recurring with no complete month yet has no usual.
      and r.months_seen > 0
      -- The rule's usual is the whole party's; it stands for this context only when every one of the
      -- party's charges is in it.
      and not exists (select 1 from party_lines pl where not pl.in_scope)
      -- A party has one charge per project (decision 0185): the line's own charge. A line the streams
      -- leave out (dated after today, or an income receipt) reads its own project's.
      and r.project_id is not distinct from coalesce(
        (select sl.stream_project from private.recurring_stream_lines(p_company, p.as_of) sl
         where sl.id = p_transaction_id),
        (select s.project_id from scope s)
      )
  ),
  -- Otherwise: the median of the context's earlier complete months, at least 2 of the last 6.
  earlier as (
    select ((case when p.direction = 'expense' then -1 else 1 end)
        * percentile_disc(0.5) within group (order by abs(m.amount)))::bigint as usual
    from party p, (
      select l.month, sum(l.amount) as amount
      from lines l, party p
      where l.month >= (p.anchor - interval '6 months')::date and l.month < p.anchor
      group by l.month
    ) m
    group by p.direction
    having count(*) >= 2
  ),
  usual as (
    select coalesce((select r.usual from recurring r limit 1), (select nullif(e.usual, 0) from earlier e)) as amount,
      case
        when exists (select 1 from recurring) then 'recurring'
        when exists (select 1 from earlier e where e.usual <> 0) then 'earlier_months'
      end as source
  ),
  month_total as (
    select (select sum(l.amount)::bigint from lines l, party p where l.month = p.anchor) as amount,
      -- An income receipt is not one of the counted lines (its invoice is), so it gets no comparison.
      exists (select 1 from lines l where l.id = p_transaction_id) as counted
  ),
  -- The percent only when the month and the usual amount go the same way (a refund month gets none)
  -- and it fits a readable figure.
  change as (
    select case
      when u.amount is null or not mt.counted or mt.amount is null or sign(mt.amount) <> sign(u.amount) then null
      else round((abs(mt.amount) - abs(u.amount)) * 100.0 / abs(u.amount))
    end as percent
    from usual u, month_total mt
  )
  select case
    when not exists (select 1 from line) then null
    when not exists (select 1 from party) then jsonb_build_object(
      'transaction_id', p_transaction_id, 'party', null, 'month', null, 'month_amount_minor', null,
      'typical_amount_minor', null, 'typical_source', null, 'change_percent', null,
      'others', 0, 'months', '[]'::jsonb, 'charges', '[]'::jsonb
    )
    else (
      select jsonb_build_object(
        'transaction_id', p_transaction_id,
        'party', jsonb_build_object('direction', p.direction, 'id', p.party_id, 'name', p.name, 'currency', p.currency),
        'month', to_char(p.anchor, 'YYYY-MM'),
        'month_amount_minor', mt.amount,
        'typical_amount_minor', u.amount,
        'typical_source', u.source,
        'change_percent', case when abs(c.percent) < 100000 then c.percent::integer end,
        'others', (select count(*) from lines l where l.id <> p_transaction_id),
        'months', (
          select jsonb_agg(jsonb_build_object(
              'month', to_char(g.month, 'YYYY-MM'),
              'amount_minor', coalesce((select sum(l.amount)::bigint from lines l where l.month = g.month::date), 0)
            ) order by g.month)
          from generate_series(p.anchor - interval '5 months', p.anchor, interval '1 month') g(month)
        ),
        'charges', coalesce((
          select jsonb_agg(jsonb_build_object(
              'id', c.id, 'doc_date', c.doc_date, 'amount_minor', c.amount
            ) order by c.doc_date desc, c.created_at desc)
          -- The 12 newest up to the line's month, so an older line sits among its own neighbours.
          from (
            select * from lines l where l.month <= p.anchor order by l.doc_date desc, l.created_at desc limit 12
          ) c
        ), '[]'::jsonb)
      )
      from party p, usual u, month_total mt, change c
    )
  end;
$function$;

create or replace function public.get_setup_suggestions(p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
  cur text;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select c.base_currency into cur from public.companies c where c.id = cid;

  return jsonb_build_object(
    'projects', '[]'::jsonb,
    'lenders', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', s.name,
          'monthly_agorot', -r.typical_amount_minor,
          'since', f.first_doc_date
        )
        order by s.name, s.id
      )
      -- One lender per supplier: a servicer paying several loans has one charge per project (decision
      -- 0185), and its monthly amount is their sum.
      from (
        select rp.direction, rp.party_id, rp.currency, sum(rp.typical_amount_minor)::bigint as typical_amount_minor,
          max(rp.months_seen) as months_seen
        from private.recurring_parties(cid, today) rp
        where rp.months_seen >= 3
        group by rp.direction, rp.party_id, rp.currency
      ) r
      join public.suppliers s on s.company_id = cid and s.id = r.party_id
      join lateral (
        select min(t.doc_date) as first_doc_date
        from public.transactions t
        where t.company_id = cid
          and t.supplier_id = r.party_id
          and t.removed_at is null
          and t.line_status = 'posted'
      ) f on true
      where r.direction = 'expense'
        and r.currency = cur
        and r.months_seen >= 3
        and not exists (
          select 1 from public.loans l
          where l.company_id = cid
            and lower(btrim(l.name)) = lower(btrim(s.name))
        )
        and not exists (
          select 1
          from public.loan_splits ls
          join public.transactions lt on lt.company_id = cid and lt.id = ls.transaction_id
          where ls.company_id = cid
            and lt.supplier_id = r.party_id
        )
    ), '[]'::jsonb)
  );
end;
$function$;

commit;
