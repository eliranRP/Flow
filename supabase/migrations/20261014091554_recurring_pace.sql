-- FLOW-415, server PR 2 (decision 0175): a recurring charge's pace, per-user dismissals of
-- the recurring alerts, and recurring income. Builds on 20261014090534_recurring_charges.sql.

begin;

-- 1. The pace. The owner's override row now holds either switch, or both: recurring (null: the
-- rule decides) and pace (null: the detected pace).
alter table public.recurring_overrides alter column recurring drop not null;
alter table public.recurring_overrides
  add column pace text check (pace in ('month', '2months', 'quarter', 'year')),
  add constraint recurring_overrides_something check (recurring is not null or pace is not null);

comment on column public.recurring_overrides.pace is
  'FLOW-415. The owner''s pace for this party: month, 2months, quarter or year; null uses the detected pace. Decision 0175.';

create or replace function private.pace_months(p_pace text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_pace when 'month' then 1 when '2months' then 2 when 'quarter' then 3 when 'year' then 12 end;
$$;

-- Whole months from p_from to p_to (both firsts of a month).
create or replace function private.month_diff(p_to date, p_from date)
returns integer
language sql
immutable
set search_path = ''
as $$
  select ((extract(year from p_to) - extract(year from p_from)) * 12
    + extract(month from p_to) - extract(month from p_from))::integer;
$$;

revoke all on function private.pace_months(text) from public, anon, authenticated;
revoke all on function private.month_diff(date, date) from public, anon, authenticated;

-- 2. The per-user dismissals. A row hides one alert from one user: kind missing with the key
-- direction:party:currency:YYYY-MM of the due month (the next cycle's bill shows again), or kind
-- change with the payment's line id. Only the functions below read and write it, always for the
-- caller.
create table public.recurring_dismissals (
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null check (kind in ('missing', 'change')),
  alert_key text not null check (char_length(alert_key) <= 200),
  dismissed_at timestamptz not null default now(),
  primary key (user_id, company_id, kind, alert_key)
);

create index recurring_dismissals_company_idx on public.recurring_dismissals (company_id);

comment on table public.recurring_dismissals is
  'FLOW-415. One user''s dismissed recurring alerts (a late bill for its due month, a change for its payment). Read and written only for the caller, through the functions. Decision 0175.';

alter table public.recurring_dismissals enable row level security;
revoke all on public.recurring_dismissals from public, anon, authenticated;

-- 3. The rule, with pace and income. Same columns as before plus pace, pace_source and
-- next_due_month, so it is dropped and made again.
drop function private.recurring_parties(uuid, date, boolean);

-- One row per supplier (expense) or customer (income) and currency that recurs as of p_today.
-- Monthly: a posted line in at least 3 of the last 6 complete months and in one of the last 2.
-- Every 2 months or quarterly: its last two gaps between complete months are both 2 (or 3), and
-- it is at most one cycle behind. Yearly: its last gap is 11 to 13 months and it is at most a
-- month behind. The owner's override wins: recurring true or false, and pace.
-- p_overrides false gives the automatic rule alone.
create function private.recurring_parties(p_company uuid, p_today date, p_overrides boolean default true)
returns table (
  direction public.txn_direction,
  party_id uuid,
  currency text,
  months_seen integer,
  typical_day integer,
  typical_amount_minor bigint,
  last_doc_date date,
  seen_this_month boolean,
  project_id uuid,
  category_id uuid,
  last_amount_minor bigint,
  source text,
  pace text,
  pace_source text,
  next_due_month date
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select date_trunc('month', p_today)::date as this_month,
      (date_trunc('month', p_today) - interval '6 months')::date as window6,
      (date_trunc('month', p_today) - interval '24 months')::date as window24
  ),
  lines as (
    select t.direction, coalesce(t.supplier_id, t.customer_id) as party_id, t.currency,
      t.doc_date, t.amount_net, t.project_id, t.category_id,
      date_trunc('month', t.doc_date)::date as month, t.line_status = 'posted' as posted
    from public.transactions t, bounds b
    where t.company_id = p_company
      and t.removed_at is null
      and t.line_status <> 'void'
      and ((t.direction = 'expense' and t.supplier_id is not null)
        or (t.direction = 'income' and t.customer_id is not null
          and t.doc_kind in ('invoice', 'credit', 'invoice_receipt')))
      and t.doc_date >= b.window24
      and t.doc_date <= p_today
  ),
  overrides as (
    select o.direction, o.party_id, o.currency, o.recurring, o.pace
    from public.recurring_overrides o
    where o.company_id = p_company and p_overrides
  ),
  monthly as (
    select l.direction, l.party_id, l.currency, l.month,
      sum(l.amount_net) as amount, min(extract(day from l.doc_date))::integer as first_day
    from lines l, bounds b
    where l.month < b.this_month and l.posted
    group by l.direction, l.party_id, l.currency, l.month
  ),
  gapped as (
    select m.*,
      private.month_diff(m.month, lag(m.month) over w) as gap,
      row_number() over (partition by m.direction, m.party_id, m.currency order by m.month desc) as back
    from monthly m
    window w as (partition by m.direction, m.party_id, m.currency order by m.month)
  ),
  stats as (
    select g.direction, g.party_id, g.currency,
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
    group by g.direction, g.party_id, g.currency
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
    select d.direction, d.party_id, d.currency, d.auto_pace,
      coalesce(o.pace, d.auto_pace, 'month') as pace,
      o.recurring, o.pace as pace_override,
      d.months6, d.day6, d.amount6, d.months24, d.day24, d.amount24
    from detected d
    left join overrides o on o.direction = d.direction and o.party_id = d.party_id and o.currency = d.currency
    where coalesce(o.recurring, d.auto_pace is not null)
  ),
  -- A party the owner marked recurring with no complete posted month yet: its latest month,
  -- this one and pending lines included, is its usual day and amount.
  forced_monthly as (
    select l.direction, l.party_id, l.currency, l.month,
      sum(l.amount_net) as amount, min(extract(day from l.doc_date))::integer as first_day
    from lines l
    join overrides o on o.direction = l.direction and o.party_id = l.party_id and o.currency = l.currency
    where o.recurring
      and not exists (
        select 1 from stats s
        where s.direction = l.direction and s.party_id = l.party_id and s.currency = l.currency
      )
    group by l.direction, l.party_id, l.currency, l.month
  ),
  forced as (
    select distinct on (fm.direction, fm.party_id, fm.currency)
      fm.direction, fm.party_id, fm.currency, coalesce(o.pace, 'month') as pace, o.pace as pace_override,
      0 as months_seen, fm.first_day as typical_day, fm.amount::bigint as typical_amount_minor
    from forced_monthly fm
    join overrides o on o.direction = fm.direction and o.party_id = fm.party_id and o.currency = fm.currency
    order by fm.direction, fm.party_id, fm.currency, fm.month desc
  ),
  chosen as (
    select p.direction, p.party_id, p.currency, p.pace, p.pace_override,
      case when p.pace = 'month' and p.months6 > 0 then p.months6 else p.months24 end as months_seen,
      case when p.pace = 'month' and p.months6 > 0 then p.day6 else p.day24 end::integer as typical_day,
      -- The median by size, with the direction's sign, so an even count does not lean one way.
      ((case when p.direction = 'expense' then -1 else 1 end)
        * case when p.pace = 'month' and p.months6 > 0 then p.amount6 else p.amount24 end)::bigint
        as typical_amount_minor,
      case when p.recurring is null then 'auto' else 'user' end as source
    from parties p
    union all
    select f.direction, f.party_id, f.currency, f.pace, f.pace_override,
      f.months_seen, f.typical_day, f.typical_amount_minor, 'user'
    from forced f
  ),
  seen as (
    select c.*,
      (select max(l.month) from lines l
       where l.direction = c.direction and l.party_id = c.party_id and l.currency = c.currency) as last_seen_month
    from chosen c
  )
  select p.direction, p.party_id, p.currency, p.months_seen, p.typical_day, p.typical_amount_minor,
    last_bill.doc_date,
    p.last_seen_month = b.this_month,
    (select l.project_id from lines l
     where l.direction = p.direction and l.party_id = p.party_id and l.currency = p.currency
       and l.project_id is not null
       and (p.pace <> 'month' or l.doc_date >= b.window6)
     group by l.project_id order by count(*) desc, max(l.doc_date) desc limit 1),
    (select l.category_id from lines l
     where l.direction = p.direction and l.party_id = p.party_id and l.currency = p.currency
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
  -- The last posted bill: its date, and every posted line of the party on that date.
  left join lateral (
    select l.doc_date, sum(l.amount_net)::bigint as amount
    from lines l
    where l.posted and l.direction = p.direction and l.party_id = p.party_id and l.currency = p.currency
    group by l.doc_date
    order by l.doc_date desc
    limit 1
  ) last_bill on true;
$$;

revoke all on function private.recurring_parties(uuid, date, boolean) from public, anon, authenticated;

create or replace function private.month_end(p_month date)
returns date
language sql
immutable
set search_path = ''
as $$ select (date_trunc('month', p_month) + interval '1 month - 1 day')::date; $$;

revoke all on function private.month_end(date) from public, anon, authenticated;

-- 4. Late bills: recurring suppliers and customers whose due month has come with no line yet,
-- past their usual day plus 5 days in the due month (or that month's last day), less what the
-- caller dismissed.
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
        r.direction || ':' || r.party_id || ':' || r.currency || ':' || to_char(r.next_due_month, 'YYYY-MM') as alert_key
      from private.recurring_parties(cid, today) r
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
        'alert_key', d.alert_key
      ) order by d.direction = 'income', d.typical_day, coalesce(s.name, cu.name), d.party_id), '[]'::jsonb)
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

-- 5. This month's arrivals: every recurring party seen this month with a usual amount from
-- complete months, this month's amount so far (posted and pending lines), and the change.
create function private.recurring_arrivals(p_company uuid, p_today date)
returns table (
  direction public.txn_direction,
  party_id uuid,
  currency text,
  amount_minor bigint,
  typical_amount_minor bigint,
  change_percent integer,
  typical_day integer,
  transaction_id uuid,
  project_id uuid,
  category_id uuid,
  source text,
  pace text
)
language sql
stable
security definer
set search_path = ''
as $$
  with r as (
    select * from private.recurring_parties(p_company, p_today) rp
    -- A party with no complete month yet has its usual amount from this month itself.
    where rp.seen_this_month and rp.typical_amount_minor <> 0 and rp.months_seen > 0
  ),
  this_month as (
    select r.direction, r.party_id, r.currency, sum(t.amount_net)::bigint as amount,
      (array_agg(t.id order by t.doc_date desc, t.created_at desc))[1] as transaction_id
    from r
    join public.transactions t
      on t.company_id = p_company and t.direction = r.direction and t.currency = r.currency
      and r.party_id = case when r.direction = 'expense' then t.supplier_id else t.customer_id end
    where t.removed_at is null
      and t.line_status <> 'void'
      and (t.direction = 'expense' or t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      and t.doc_date >= date_trunc('month', p_today)::date
      and t.doc_date <= p_today
    group by r.direction, r.party_id, r.currency
  )
  select r.direction, r.party_id, r.currency, m.amount, r.typical_amount_minor,
    round((abs(m.amount) - abs(r.typical_amount_minor)) * 100.0 / abs(r.typical_amount_minor))::integer,
    r.typical_day, m.transaction_id, r.project_id, r.category_id, r.source, r.pace
  from r
  join this_month m on m.direction = r.direction and m.party_id = r.party_id and m.currency = r.currency;
$$;

revoke all on function private.recurring_arrivals(uuid, date) from public, anon, authenticated;

-- The arrivals as the app and the MCP read them, with names. p_changes keeps only the changes
-- of 20% or more, either way, that the caller did not dismiss.
create function private.recurring_arrivals_json(p_company uuid, p_today date, p_changes boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
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
      'alert_key', a.transaction_id::text
    ) order by
      case when p_changes then abs(a.change_percent) end desc,
      a.direction = 'income', coalesce(s.name, cu.name), a.party_id), '[]'::jsonb)
  from (
    select ar.*,
      abs(abs(ar.amount_minor) - abs(ar.typical_amount_minor)) * 5 >= abs(ar.typical_amount_minor) as changed
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
$$;

revoke all on function private.recurring_arrivals_json(uuid, date, boolean) from public, anon, authenticated;

-- הגיעו החודש: every recurring supplier and customer seen this month, with its change.
create function public.recurring_this_month(p_today date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return private.recurring_arrivals_json(cid, coalesce(p_today, private.flow_today()), false);
end;
$$;

-- Home: the arrivals 20% or more off their usual amount, less what the caller dismissed.
-- Largest change first.
create or replace function public.recurring_changes(p_today date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return private.recurring_arrivals_json(cid, coalesce(p_today, private.flow_today()), true);
end;
$$;

-- 6. Dismiss and bring back one alert, for the caller only. p_key is the row's alert_key.
create function public.dismiss_recurring_alert(p_kind text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
begin
  cid := private.readable_company_id();
  if cid is null or auth.uid() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_kind is null or p_key is null or not (
    (p_kind = 'missing' and p_key ~ '^(expense|income):[0-9a-f-]{36}:[A-Z]{3}:[0-9]{4}-[0-9]{2}$')
    or (p_kind = 'change' and p_key ~ '^[0-9a-f-]{36}$')
  ) then
    raise exception 'validation';
  end if;
  insert into public.recurring_dismissals (user_id, company_id, kind, alert_key)
  values (auth.uid(), cid, p_kind, p_key)
  on conflict do nothing;
  return jsonb_build_object('kind', p_kind, 'alert_key', p_key, 'dismissed', true);
end;
$$;

create function public.undismiss_recurring_alert(p_kind text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
begin
  cid := private.readable_company_id();
  if cid is null or auth.uid() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_kind is null or p_key is null or p_kind not in ('missing', 'change') then
    raise exception 'validation';
  end if;
  delete from public.recurring_dismissals x
  where x.user_id = auth.uid() and x.company_id = cid and x.kind = p_kind and x.alert_key = p_key;
  return jsonb_build_object('kind', p_kind, 'alert_key', p_key, 'dismissed', false);
end;
$$;

-- 7. One payment's state, now with its pace.
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
  select o.recurring, o.pace into override, override_pace
  from public.recurring_overrides o
  where o.company_id = p_company and o.direction = party.direction
    and o.party_id = party.party_id and o.currency = party.currency;
  select r.pace into auto_pace
  from private.recurring_parties(p_company, p_today, false) r
  where r.direction = party.direction and r.party_id = party.party_id and r.currency = party.currency;
  detected := auto_pace is not null;
  select r.typical_day, r.typical_amount_minor, r.pace, r.next_due_month
  into usual_day, usual_amount, chosen_pace, due
  from private.recurring_parties(p_company, p_today) r
  where r.direction = party.direction and r.party_id = party.party_id and r.currency = party.currency;
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

-- The recurring switch keeps the pace: null clears only the switch.
create or replace function public.set_payment_recurring(p_id uuid, p_recurring boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  party record;
  prior boolean;
begin
  -- An owner or an editor writes (decision 0167); a viewer member or the demo viewer is refused.
  cid := private.current_company_id();
  if cid is null then
    if private.is_read_only() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
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
  select o.recurring into prior
  from public.recurring_overrides o
  where o.company_id = cid and o.direction = party.direction
    and o.party_id = party.party_id and o.currency = party.currency
  for update;
  insert into public.recurring_overrides as o (company_id, direction, party_id, currency, recurring, set_by, set_at)
  select cid, party.direction, party.party_id, party.currency, p_recurring, auth.uid(), now()
  where p_recurring is not null
  on conflict (company_id, direction, party_id, currency)
  do update set recurring = excluded.recurring, set_by = excluded.set_by, set_at = excluded.set_at;
  if p_recurring is null then
    update public.recurring_overrides o set recurring = null, set_by = auth.uid(), set_at = now()
    where o.company_id = cid and o.direction = party.direction
      and o.party_id = party.party_id and o.currency = party.currency and o.pace is not null;
    delete from public.recurring_overrides o
    where o.company_id = cid and o.direction = party.direction
      and o.party_id = party.party_id and o.currency = party.currency and o.pace is null;
  end if;
  return private.payment_recurring_state(cid, p_id, private.flow_today())
    || jsonb_build_object('prior_override', prior);
end;
$$;

-- The pace switch: month, 2months, quarter or year for the payment's supplier (or customer) in
-- its currency; null goes back to the detected pace. Returns the state and prior_pace for ביטול.
create function public.set_payment_pace(p_id uuid, p_pace text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  party record;
  prior text;
begin
  cid := private.current_company_id();
  if cid is null then
    if private.is_read_only() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_pace is not null and private.pace_months(p_pace) is null then
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
  select o.pace into prior
  from public.recurring_overrides o
  where o.company_id = cid and o.direction = party.direction
    and o.party_id = party.party_id and o.currency = party.currency
  for update;
  insert into public.recurring_overrides as o (company_id, direction, party_id, currency, pace, set_by, set_at)
  select cid, party.direction, party.party_id, party.currency, p_pace, auth.uid(), now()
  where p_pace is not null
  on conflict (company_id, direction, party_id, currency)
  do update set pace = excluded.pace, set_by = excluded.set_by, set_at = excluded.set_at;
  if p_pace is null then
    update public.recurring_overrides o set pace = null, set_by = auth.uid(), set_at = now()
    where o.company_id = cid and o.direction = party.direction
      and o.party_id = party.party_id and o.currency = party.currency and o.recurring is not null;
    delete from public.recurring_overrides o
    where o.company_id = cid and o.direction = party.direction
      and o.party_id = party.party_id and o.currency = party.currency and o.recurring is null;
  end if;
  return private.payment_recurring_state(cid, p_id, private.flow_today())
    || jsonb_build_object('prior_pace', prior);
end;
$$;

revoke all on function public.recurring_this_month(date) from public, anon;
revoke all on function public.dismiss_recurring_alert(text, text) from public, anon;
revoke all on function public.undismiss_recurring_alert(text, text) from public, anon;
revoke all on function public.set_payment_pace(uuid, text) from public, anon;
grant execute on function public.recurring_this_month(date) to authenticated, service_role;
grant execute on function public.dismiss_recurring_alert(text, text) to authenticated, service_role;
grant execute on function public.undismiss_recurring_alert(text, text) to authenticated, service_role;
grant execute on function public.set_payment_pace(uuid, text) to authenticated, service_role;

-- 8. The MCP's pace switch: set_payment_pace with the idempotency key, the write gate and an
-- undo (kind line_pace, id: the transaction).
create or replace function public.mcp_set_line_pace(p_idempotency_key text, p_transaction_id uuid, p_pace text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    or (p_pace is not null and private.pace_months(p_pace) is null)
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'line_pace|' || p_transaction_id::text || '|' || coalesce(p_pace, 'null');
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
      written := public.set_payment_pace(p_transaction_id, p_pace);
      insert into private.mcp_writes (token_id, user_id, transaction_id, kind, prior, created_at)
      values (
        token, auth.uid(), p_transaction_id, 'line_pace',
        jsonb_build_object('before', written->'prior_pace', 'written', to_jsonb(p_pace)),
        clock_timestamp()
      )
      returning id into write_id;
      response := jsonb_build_object(
        'ok', true,
        'data', (written - 'prior_pace') || jsonb_build_object(
          'undo_kind', 'line_pace',
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
$$;

revoke all on function public.mcp_set_line_pace(text, uuid, text) from public, anon;
grant execute on function public.mcp_set_line_pace(text, uuid, text) to authenticated, service_role;

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- 9. The undo kind line_pace on mcp_writes and mcp_undo.
do $undo$
declare
  def text;
  anchor text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'line_recurring'::text$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, anchor || $n$, 'line_pace'::text$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if pg_temp.anchor_count(def, $a$kind = 'line_recurring'::text$a$) <> 1 or right(def, 2) <> '))' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'line_pace'::text) AND (transaction_id IS NOT NULL) AND (prior ? 'before'::text) AND (prior ? 'written'::text))))$n$;

  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  anchor := $a$p_kind not in ('line_recurring', $a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, anchor, $n$p_kind not in ('line_pace', 'line_recurring', $n$);

  anchor := $a$(p_kind = 'line_recurring' and w.kind = 'line_recurring' and w.transaction_id = p_id)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo match is not the expected definition';
  end if;
  def := replace(def, anchor, $n$(p_kind = 'line_pace' and w.kind = 'line_pace' and w.transaction_id = p_id)
        or $n$ || anchor);

  anchor := $a$    elsif p_kind = 'line_recurring' then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo branches are not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'line_pace' then
      -- FLOW-415. The party's pace changed since the write is a conflict; else set_payment_pace
      -- puts back the pace from before (null: the detected pace).
      declare
        party record;
        cur jsonb;
      begin
        select * into party from private.payment_party(cid, p_id);
        if not found then
          response := private.mcp_error('not_found', 'not found');
        else
          select coalesce(
            (select to_jsonb(o.pace) from public.recurring_overrides o
             where o.company_id = cid and o.direction = party.direction
               and o.party_id = party.party_id and o.currency = party.currency
             for update),
            'null'::jsonb
          ) into cur;
          if cur is distinct from rec.prior->'written' then
            response := private.mcp_error('conflict', 'conflict');
          else
            perform public.set_payment_pace(p_id, rec.prior->>'before');
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
end
$undo$;

-- 10. expected_months counts a party in its due months only, and names its pace.
do $expected$
declare
  def text := pg_get_functiondef('public.expected_months(integer,uuid,date)'::regprocedure);
  anchor text;
begin
  anchor := $a$join r on m.n > 0 or not r.seen_this_month$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'expected_months cells are not the expected definition';
  end if;
  -- From the due month (this month when it is late), every pace months.
  def := replace(def, anchor, $n$join r on m.month >= greatest(r.next_due_month, date_trunc('month', today)::date)
        and private.month_diff(m.month, greatest(r.next_due_month, date_trunc('month', today)::date))
          % private.pace_months(r.pace) = 0$n$);
  anchor := $a$'source', r.source$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'expected_months is not the expected definition';
  end if;
  execute replace(def, anchor, anchor || $n$,
          'pace', r.pace,
          'next_due_month', to_char(r.next_due_month, 'YYYY-MM')$n$);
end
$expected$;

drop function pg_temp.anchor_count(text, text);

commit;
