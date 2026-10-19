-- Decision 0189. A recurring charge counts only its own parts of a split line, and the owner can set a
-- charge's usual amount.
-- The owner's case: one rent platform pays several properties' rent in one transfer, and the owner splits
-- each transfer into parts (rent, electricity, water; or a tenant deposit, one property's rent and another
-- property's rent). The charge counted the whole transfer, so its usual amount and this month's arrival
-- were the transfer, not the rent.
-- - private.recurring_line_parts: the lines recurring charges are read from, a split line (line_splits, as
--   pnl_lines counts it: two or more parts that sum to the line, no loan split) as its parts. Parts in a
--   kept-out category (excluded_from_pnl: deposits, loan principal) never count. Of a line's counted parts
--   for one project, the charge takes one: the part in the line's own category, else the largest. A part
--   for another project feeds the party's charge there. An unsplit line is as before.
-- - recurring_stream_lines reads those parts, so recurring_parties (monthly amounts, the last bill), the
--   arrivals and changes, the schedule, missing bills and expected months follow. party_charges_json
--   (get_line_charges) and project_recurring_arrivals read the same parts.
-- - recurring_overrides.typical_amount_minor: the owner's usual amount for one charge (positive, in the
--   charge's currency). recurring_parties uses it, with the direction's sign, in place of the computed
--   median; typical_amount_source says owner or computed. A charge with an owner amount and the switch on
--   recurs with no complete month yet, and its arrival is compared with the owner's amount.
-- - set_payment_amount (the app) and mcp_set_line_usual_amount (MCP set_line_usual_amount, undo kind
--   line_amount) write it for a line's charge through private.write_recurring_override.
begin;
set local lock_timeout = '5s';

alter table public.recurring_overrides add column typical_amount_minor bigint;
alter table public.recurring_overrides add constraint recurring_overrides_amount_check
  check (typical_amount_minor > 0 and typical_amount_minor <= 999999999999);
alter table public.recurring_overrides drop constraint recurring_overrides_something;
alter table public.recurring_overrides add constraint recurring_overrides_something
  check (recurring is not null or pace is not null or typical_amount_minor is not null);

comment on column public.recurring_overrides.typical_amount_minor is
  'Decision 0189. The owner''s usual amount for the charge, positive, in its currency; null: computed from its months. Only a row with a project, or the row of a charge with no project, carries one.';

-- The lines a recurring charge is read from, a split line as its parts (decision 0189).
create or replace function private.recurring_line_parts(p_company uuid, p_from date, p_to date)
returns table(id uuid, direction public.txn_direction, party_id uuid, line_party_id uuid, currency text,
  doc_date date, created_at timestamptz, amount_net bigint, project_id uuid, category_id uuid, split boolean)
language sql
stable
security definer
set search_path = ''
as $function$
  with lines as (
    select t.id, t.direction, coalesce(mm.party_id, t.supplier_id, t.customer_id) as party_id,
      coalesce(t.supplier_id, t.customer_id) as line_party_id, t.currency,
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
      and t.doc_date >= p_from
      and t.doc_date <= p_to
  ),
  -- A split the P&L counts (pnl_lines, decision 0104): two or more parts that sum to the line, no loan split.
  split as (
    select l.id
    from lines l
    join public.line_splits s on s.company_id = p_company and s.transaction_id = l.id
    where not exists (select 1 from public.loan_splits ls where ls.transaction_id = l.id)
    group by l.id, l.amount_net
    having count(*) >= 2 and sum(s.amount_minor) = abs(l.amount_net)
  ),
  -- The counted parts (a kept-out category never counts), each with the project it is for: its own, else
  -- the line's. Of a line's parts for one project the charge takes one: the line's own category, else the
  -- largest part.
  parts as (
    select l.id, l.direction, l.party_id, l.line_party_id, l.currency, l.doc_date, l.created_at,
      (sign(l.amount_net) * s.amount_minor)::bigint as amount_net,
      coalesce(s.project_id, l.project_id) as project_id, s.category_id,
      row_number() over (
        partition by l.id, coalesce(s.project_id, l.project_id)
        order by (s.category_id = l.category_id) desc, s.amount_minor desc, s.ordinal
      ) as pick
    from lines l
    join split sp on sp.id = l.id
    join public.line_splits s on s.company_id = p_company and s.transaction_id = l.id
    join public.categories c on c.company_id = p_company and c.id = s.category_id
    where not c.excluded_from_pnl
  )
  select l.id, l.direction, l.party_id, l.line_party_id, l.currency, l.doc_date, l.created_at, l.amount_net,
    l.project_id, l.category_id, false
  from lines l
  where not exists (select 1 from split sp where sp.id = l.id)
  union all
  select p.id, p.direction, p.party_id, p.line_party_id, p.currency, p.doc_date, p.created_at, p.amount_net,
    p.project_id, p.category_id, true
  from parts p
  where p.pick = 1;
$function$;

revoke all on function private.recurring_line_parts(uuid, date, date) from public, anon, authenticated;

-- The stream lines (decision 0185) now read the parts: a split line gives one row per project it has a
-- counted part for, with that part's amount, project and category (decision 0189).
create or replace function private.recurring_stream_lines(p_company uuid, p_today date)
returns table(id uuid, direction public.txn_direction, party_id uuid, currency text, doc_date date,
  created_at timestamptz, amount_net bigint, project_id uuid, category_id uuid, stream_project uuid)
language sql
stable
security definer
set search_path = ''
as $function$
  with lines as (
    select lp.id, lp.direction, lp.party_id, lp.currency, lp.doc_date, lp.created_at, lp.amount_net,
      lp.project_id, lp.category_id
    from private.recurring_line_parts(p_company, (date_trunc('month', p_today) - interval '24 months')::date, p_today) lp
  ),
  -- Each project a party's filed lines went to, with its latest filed amount (of one line's parts, the largest).
  filed as (
    select distinct on (l.direction, l.party_id, l.currency, l.project_id)
      l.direction, l.party_id, l.currency, l.project_id, abs(l.amount_net) as amount, l.doc_date
    from lines l
    where l.project_id is not null
    order by l.direction, l.party_id, l.currency, l.project_id, l.doc_date desc, l.created_at desc, abs(l.amount_net) desc
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

-- The project of a line's recurring charge. A split line can feed several charges; its own is the part for
-- the line's own project, else its largest part (decision 0189). The rest is 20261019005147's.
create or replace function private.line_stream_project(p_company uuid, p_transaction_id uuid, p_today date)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  stream uuid;
  line record;
  party record;
begin
  select t.project_id, t.amount_net into line
  from public.transactions t
  where t.id = p_transaction_id and t.company_id = p_company;
  if not found then
    return null;
  end if;
  select sl.stream_project into stream
  from private.recurring_stream_lines(p_company, p_today) sl
  where sl.id = p_transaction_id
  order by (sl.project_id is not distinct from line.project_id) desc, abs(sl.amount_net) desc, sl.stream_project
  limit 1;
  if found then
    return stream;
  end if;
  if line.project_id is not null then
    return line.project_id;
  end if;
  select * into party from private.payment_party(p_company, p_transaction_id);
  if not found then
    return null;
  end if;
  select f.project_id into stream
  from (
    select distinct on (sl.project_id) sl.project_id, abs(sl.amount_net) as amount, sl.doc_date
    from private.recurring_stream_lines(p_company, p_today) sl
    where sl.direction = party.direction and sl.party_id = party.party_id and sl.currency = party.currency
      and sl.project_id is not null
    order by sl.project_id, sl.doc_date desc, sl.created_at desc, abs(sl.amount_net) desc
  ) f
  order by abs(f.amount - abs(line.amount_net)), f.doc_date desc, f.project_id
  limit 1;
  return stream;
end;
$$;

-- Writes one field (recurring, pace or amount) of one charge's row and returns its value before (json null:
-- no word). A null value clears the field, and the row goes when no field is left (decision 0189 adds amount).
create or replace function private.write_recurring_override(p_company uuid, p_direction public.txn_direction,
  p_party_id uuid, p_currency text, p_project_id uuid, p_field text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  prior jsonb;
  clear boolean := p_value is null or p_value = 'null'::jsonb;
begin
  if p_field is null or p_field not in ('recurring', 'pace', 'amount') then
    raise exception 'validation';
  end if;
  select case p_field
      when 'recurring' then to_jsonb(o.recurring)
      when 'pace' then to_jsonb(o.pace)
      else to_jsonb(o.typical_amount_minor)
    end into prior
  from public.recurring_overrides o
  where o.company_id = p_company and o.direction = p_direction and o.party_id = p_party_id
    and o.currency = p_currency and o.project_id is not distinct from p_project_id
  for update;
  prior := coalesce(prior, 'null'::jsonb);
  if not clear then
    insert into public.recurring_overrides as o
      (company_id, direction, party_id, currency, project_id, recurring, pace, typical_amount_minor, set_by, set_at)
    values (p_company, p_direction, p_party_id, p_currency, p_project_id,
      case when p_field = 'recurring' then (p_value #>> '{}')::boolean end,
      case when p_field = 'pace' then p_value #>> '{}' end,
      case when p_field = 'amount' then (p_value #>> '{}')::bigint end,
      auth.uid(), now())
    on conflict (company_id, direction, party_id, currency, project_id)
    do update set
      recurring = case when p_field = 'recurring' then excluded.recurring else o.recurring end,
      pace = case when p_field = 'pace' then excluded.pace else o.pace end,
      typical_amount_minor = case when p_field = 'amount' then excluded.typical_amount_minor else o.typical_amount_minor end,
      set_by = excluded.set_by, set_at = excluded.set_at;
  else
    delete from public.recurring_overrides o
    where o.company_id = p_company and o.direction = p_direction and o.party_id = p_party_id
      and o.currency = p_currency and o.project_id is not distinct from p_project_id
      and (p_field = 'recurring' or o.recurring is null)
      and (p_field = 'pace' or o.pace is null)
      and (p_field = 'amount' or o.typical_amount_minor is null);
    update public.recurring_overrides o set
      recurring = case when p_field = 'recurring' then null else o.recurring end,
      pace = case when p_field = 'pace' then null else o.pace end,
      typical_amount_minor = case when p_field = 'amount' then null else o.typical_amount_minor end,
      set_by = auth.uid(), set_at = now()
    where o.company_id = p_company and o.direction = p_direction and o.party_id = p_party_id
      and o.currency = p_currency and o.project_id is not distinct from p_project_id;
  end if;
  return prior;
end;
$$;

-- recurring_parties gains typical_amount_source (owner or computed): the owner's usual amount wins over the
-- computed median (decision 0189). The body is 20261019005147's otherwise. The new column changes the
-- return type, so the function is dropped and created again.
drop function private.recurring_parties(uuid, date, boolean);
create function private.recurring_parties(p_company uuid, p_today date, p_overrides boolean DEFAULT true)
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
      d.months6, d.day6, d.amount6, d.months24, d.day24, d.amount24
    from detected d
    left join words w on w.direction = d.direction and w.party_id = d.party_id and w.currency = d.currency
      and w.stream_project is not distinct from d.stream_project
    where case
      when w.recurring is false then false
      when d.auto_pace is not null then true
      else coalesce(w.recurring, false)
    end
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
      case when p.pace = 'month' and p.months6 > 0 then p.day6 else p.day24 end::integer as typical_day,
      -- The owner's amount, else the median by size, with the direction's sign, so an even count does not
      -- lean one way.
      ((case when p.direction = 'expense' then -1 else 1 end)
        * coalesce(p.owner_amount, case when p.pace = 'month' and p.months6 > 0 then p.amount6 else p.amount24 end))::bigint
        as typical_amount_minor,
      case when p.recurring is null then 'auto' else 'user' end as source,
      case when p.owner_amount is null then 'computed' else 'owner' end as amount_source
    from parties p
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

-- The arrivals: a charge with the owner's usual amount compares this month with it even before its first
-- complete month (decision 0189). The body is 20261018111500's otherwise.
create or replace function private.recurring_arrivals(p_company uuid, p_today date)
 RETURNS TABLE(direction txn_direction, party_id uuid, currency text, amount_minor bigint, typical_amount_minor bigint, change_percent integer, typical_day integer, transaction_id uuid, project_id uuid, category_id uuid, source text, pace text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with r as (
    select * from private.recurring_parties(p_company, p_today) rp
    -- A party with no complete month yet has its usual amount from this month itself, unless the owner set it.
    where rp.seen_this_month and rp.typical_amount_minor <> 0
      and (rp.months_seen > 0 or rp.typical_amount_source = 'owner')
  ),
  -- This month's lines of each charge: its party and its project (recurring_stream_lines), a split line's
  -- own parts only (decision 0189).
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

-- A project's arrivals: each charge's lines in this project, a split line's counted parts for it (the
-- stream lines carry them since decision 0189), against the owner's usual amount when set, else the median
-- of its complete months. The body is 20261018111500's otherwise.
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
    where rp.seen_this_month and (rp.months_seen > 0 or rp.typical_amount_source = 'owner')
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

-- The schedule rows say where the usual amount comes from: typical_amount_source, owner or computed
-- (decision 0189). The body is 20261018111500's otherwise.
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
      'typical_amount_source', x.typical_amount_source,
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

-- A line's charges (get_line_charges, the line page's "לעומת הרגיל") read the same parts: a split line counts
-- only its part in the context (its project and category, decision 0189), never the whole transfer. The
-- recurring usual amount stands for the context when every line of the line's own project is in it (the
-- charge is per project since 0185), and a charge with the owner's amount has it even before its first
-- complete month. The body is 20261018122104's otherwise.
create or replace function private.party_charges_json(p_company uuid, p_transaction_id uuid, p_today date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with line as (
    select t.id, t.amount_net, t.doc_date, t.project_id, t.category_id,
      date_trunc('month', t.doc_date)::date as anchor
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
  -- The party's lines in the window, a split line as its counted parts (recurring_line_parts).
  pieces as (
    select lp.*
    from party p,
      private.recurring_line_parts(p_company, (p.anchor - interval '24 months')::date,
        -- A line dated after today still reads its own month.
        greatest(p_today, (p.anchor + interval '1 month' - interval '1 day')::date)) lp
    where lp.direction = p.direction and lp.line_party_id = p.party_id and lp.currency = p.currency
  ),
  -- The line's own context: its loan when it pays one, else the project and category of its own part (a
  -- split line's part for its own project, else its largest), so a supplier with two loans (or two
  -- projects) compares this one with its own earlier charges.
  scope as (
    select
      case when own.id is not null then own.project_id else l.project_id end as project_id,
      case when own.id is not null then own.category_id else l.category_id end as category_id,
      (select ls.loan_id from public.loan_splits ls where ls.transaction_id = l.id limit 1) as loan_id
    from line l
    left join lateral (
      select pc.id, pc.project_id, pc.category_id
      from pieces pc
      where pc.id = l.id
      order by (pc.project_id is not distinct from l.project_id) desc, abs(pc.amount_net) desc
      limit 1
    ) own on true
  ),
  party_lines as (
    select pc.id, pc.doc_date, pc.amount_net as amount, pc.created_at, pc.project_id,
      date_trunc('month', pc.doc_date)::date as month,
      case
        when s.loan_id is not null then exists (
          select 1 from public.loan_splits ls where ls.transaction_id = pc.id and ls.loan_id = s.loan_id
        )
        else pc.project_id is not distinct from s.project_id and pc.category_id is not distinct from s.category_id
          and not exists (select 1 from public.loan_splits ls where ls.transaction_id = pc.id)
      end as in_scope
    from pieces pc
    cross join scope s
  ),
  lines as (
    select pl.id, pl.doc_date, pl.amount, pl.created_at, pl.month from party_lines pl where pl.in_scope
  ),
  recurring as (
    select r.typical_amount_minor as usual
    from party p, private.recurring_parties(p_company, p.as_of) r
    where r.direction = p.direction and r.party_id = p.party_id and r.currency = p.currency
      and r.typical_amount_minor <> 0
      -- As in recurring_arrivals: a party marked recurring with no complete month yet has no usual,
      -- unless the owner set it.
      and (r.months_seen > 0 or r.typical_amount_source = 'owner')
      -- The charge's usual stands for this context only when every one of its project's lines is in it.
      and not exists (
        select 1 from party_lines pl, scope s
        where not pl.in_scope and pl.project_id is not distinct from s.project_id
      )
      -- A party has one charge per project (decision 0185): the line's own charge. A line the streams
      -- leave out (dated after today, or an income receipt) reads its own project's.
      and r.project_id is not distinct from coalesce(
        (select sl.stream_project from private.recurring_stream_lines(p_company, p.as_of) sl, line l
         where sl.id = p_transaction_id
         order by (sl.project_id is not distinct from l.project_id) desc, abs(sl.amount_net) desc
         limit 1),
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

-- A line's recurring state reports where its charge's usual amount comes from (typical_amount_source:
-- owner or computed; null when not recurring) and the owner's amount on that charge (owner_amount_minor,
-- positive; null when none), decision 0189. The body is 20261019005147's otherwise.
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
  usual_source text;
  owner_amount bigint;
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
      'typical_amount_source', null,
      'owner_amount_minor', null,
      'pace', null,
      'pace_override', null,
      'detected_pace', null,
      'next_due_month', null
    );
  end if;
  -- The line's own charge: its party and the project its stream goes to (recurring_stream_lines).
  stream := private.line_stream_project(p_company, p_transaction_id, p_today);
  -- The owner's word that applies to that charge (decision 0188).
  select w.recurring, w.pace into override, override_pace
  from private.recurring_override_for(p_company, party.direction, party.party_id, party.currency, stream, p_today) w;
  -- The owner's usual amount is the charge's own (decision 0189).
  select o.typical_amount_minor into owner_amount
  from public.recurring_overrides o
  where o.company_id = p_company and o.direction = party.direction and o.party_id = party.party_id
    and o.currency = party.currency and o.project_id is not distinct from stream;
  select r.pace into auto_pace
  from private.recurring_parties(p_company, p_today, false) r
  where r.direction = party.direction and r.party_id = party.party_id and r.currency = party.currency
    and r.project_id is not distinct from stream;
  detected := auto_pace is not null;
  select r.typical_day, r.typical_amount_minor, r.typical_amount_source, r.pace, r.next_due_month
  into usual_day, usual_amount, usual_source, chosen_pace, due
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
    'typical_amount_source', usual_source,
    'owner_amount_minor', owner_amount,
    'pace', coalesce(chosen_pace, override_pace, auto_pace),
    'pace_override', override_pace,
    'detected_pace', auto_pace,
    'next_due_month', to_char(due, 'YYYY-MM')
  );
end;
$$;

-- The newest line of a charge prefers a line whose own part is that charge's (an unsplit line, or a split
-- line's part for its own project), so the charge page writes through a line of its own (decision 0189).
-- The body is 20261018111500's otherwise.
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
    join public.transactions t on t.id = sl.id
    where sl.direction = p_direction::public.txn_direction
      and sl.party_id = p_party_id
      and sl.currency = p_currency
      and sl.stream_project = p_project_id
    order by (sl.project_id is not distinct from t.project_id) desc, sl.doc_date desc, sl.created_at desc
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

-- The owner's usual amount for a line's charge (decision 0189): positive minor units in the charge's
-- currency, or null to go back to the computed amount. p_project_id names one of the line's charges when a
-- split line feeds several (the charge page passes its own); else the line's own charge. Returns the
-- charge's usual amount after the write, prior_amount for ביטול and override_project_id.
create or replace function public.set_payment_amount(p_id uuid, p_amount_minor bigint, p_project_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  today date := private.flow_today();
  party record;
  stream uuid;
  prior jsonb;
  charge record;
begin
  -- An owner or an editor writes (decision 0167); a viewer member or the demo viewer is refused.
  cid := private.current_company_id();
  if cid is null then
    if private.is_read_only() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_amount_minor is not null and (p_amount_minor <= 0 or p_amount_minor > 999999999999) then
    raise exception 'validation';
  end if;
  if not exists (
    select 1 from public.transactions t
    where t.id = p_id and t.company_id = cid and t.removed_at is null
  ) then
    raise exception 'transaction not found';
  end if;
  select * into party from private.payment_party(cid, p_id);
  if not found then
    raise exception 'no supplier or customer';
  end if;
  stream := private.line_stream_project(cid, p_id, today);
  if p_project_id is not null and p_project_id is distinct from stream then
    if not exists (
      select 1 from private.recurring_stream_lines(cid, today) sl
      where sl.id = p_id and sl.stream_project = p_project_id
    ) then
      raise exception 'validation';
    end if;
    stream := p_project_id;
  end if;
  prior := private.write_recurring_override(cid, party.direction, party.party_id, party.currency, stream,
    'amount', to_jsonb(p_amount_minor));
  select r.typical_amount_minor, r.typical_amount_source into charge
  from private.recurring_parties(cid, today) r
  where r.direction = party.direction and r.party_id = party.party_id and r.currency = party.currency
    and r.project_id is not distinct from stream;
  return jsonb_build_object(
    'transaction_id', p_id,
    'party', jsonb_build_object('direction', party.direction, 'id', party.party_id, 'name', party.name,
      'currency', party.currency),
    'project_id', stream,
    'owner_amount_minor', p_amount_minor,
    'recurring', charge.typical_amount_source is not null,
    'typical_amount_minor', charge.typical_amount_minor,
    'typical_amount_source', charge.typical_amount_source,
    'prior_amount', prior,
    'override_project_id', stream
  );
end;
$$;

revoke all on function public.set_payment_amount(uuid, bigint, uuid) from public, anon;
grant execute on function public.set_payment_amount(uuid, bigint, uuid) to authenticated, service_role;

-- MCP set_line_usual_amount: the owner's usual amount for the line's charge; undo kind line_amount keeps the
-- charge's project, so it puts back the same row.
create or replace function public.mcp_set_line_usual_amount(p_idempotency_key text, p_transaction_id uuid, p_amount_minor bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  written jsonb;
  response jsonb;
  write_id uuid;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_transaction_id is null
    or (p_amount_minor is not null and (p_amount_minor <= 0 or p_amount_minor > 999999999999))
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'line_amount|' || p_transaction_id::text || '|' || coalesce(p_amount_minor::text, 'null');
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  begin
    if not exists (
      select 1 from public.transactions t
      where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null
    ) then
      response := private.mcp_refused('transaction not found');
    else
      written := public.set_payment_amount(p_transaction_id, p_amount_minor);
      -- clock_timestamp, so two writes to one line in one transaction still undo newest first.
      insert into private.mcp_writes (token_id, user_id, transaction_id, kind, prior, created_at)
      values (
        token, auth.uid(), p_transaction_id, 'line_amount',
        jsonb_build_object('project', written->'override_project_id', 'before', written->'prior_amount', 'written', to_jsonb(p_amount_minor)),
        clock_timestamp()
      )
      returning id into write_id;
      response := jsonb_build_object(
        'ok', true,
        'data', (written - 'prior_amount' - 'override_project_id') || jsonb_build_object(
          'undo_kind', 'line_amount',
          'id', p_transaction_id,
          'write_id', write_id
        )
      );
    end if;
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$function$;

revoke all on function public.mcp_set_line_usual_amount(text, uuid, bigint) from public, anon;
grant execute on function public.mcp_set_line_usual_amount(text, uuid, bigint) to authenticated, service_role;

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- The undo log takes the kind line_amount.
do $writes$
declare
  def text;
  anchor text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'project_forecast'::text]$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, $n$'project_forecast'::text, 'line_amount'::text]$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if right(def, 2) <> '))' or pg_temp.anchor_count(def, $a$(kind = 'project_forecast'::text)$a$) <> 1 then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'line_amount'::text) AND (transaction_id IS NOT NULL) AND (prior ? 'before'::text) AND (prior ? 'written'::text))))$n$;
end
$writes$;

-- mcp_undo takes line_amount: the charge's amount changed since the write is a conflict; else it puts back
-- the amount from before (null: computed) on the row of the charge the write was for.
do $undo$
declare
  def text;
  anchor text;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);

  anchor := $a$p_kind not in ('recurring_match', 'line_pace', 'line_recurring', $a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kind list is not the expected definition';
  end if;
  def := replace(def, anchor, $n$p_kind not in ('recurring_match', 'line_pace', 'line_recurring', 'line_amount', $n$);

  anchor := $a$        or (p_kind = 'line_recurring' and w.kind = 'line_recurring' and w.transaction_id = p_id)
$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo line_recurring lookup is not the expected definition';
  end if;
  def := replace(def, anchor, anchor
    || $n$        or (p_kind = 'line_amount' and w.kind = 'line_amount' and w.transaction_id = p_id)
$n$);

  anchor := $a$    elsif p_kind = 'line_recurring' then
$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo line_recurring branch is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'line_amount' then
      -- Decision 0189. The charge's usual amount changed since the write is a conflict; else the amount
      -- from before (null: computed) goes back on the row of the charge the write was for.
      declare
        party record;
        cur jsonb;
      begin
        select * into party from private.payment_party(cid, p_id);
        if not found then
          response := private.mcp_error('not_found', 'not found');
        else
          select coalesce(
            (select to_jsonb(o.typical_amount_minor) from public.recurring_overrides o
             where o.company_id = cid and o.direction = party.direction
               and o.party_id = party.party_id and o.currency = party.currency
               and o.project_id is not distinct from (rec.prior->>'project')::uuid
             for update),
            'null'::jsonb
          ) into cur;
          if cur is distinct from rec.prior->'written' then
            response := private.mcp_error('conflict', 'conflict');
          else
            perform private.write_recurring_override(cid, party.direction, party.party_id, party.currency,
              (rec.prior->>'project')::uuid, 'amount', rec.prior->'before');
            update private.mcp_writes
            set undone_at = clock_timestamp()
            where id = rec.id and user_id = auth.uid() and undone_at is null;
            response := jsonb_build_object(
              'ok', true,
              'data', jsonb_build_object('kind', p_kind, 'id', p_id)
            );
          end if;
        end if;
      end;
$n$ || anchor);

  execute def;
end;
$undo$;

drop function pg_temp.anchor_count(text, text);

commit;
