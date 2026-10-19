-- Decision 0188 (amends 0185): the owner's "recurring" switch and its pace apply to the line's own charge,
-- the party's lines for the project its stream goes to, not only to the party's main charge.
-- The owner's case: one rent platform pays three properties' rent into one account (one customer, three
-- charges). "Recurring" on the second and third properties' lines did nothing: the switch was keyed by
-- party, and a party-wide "recurring" makes only the main charge recurring (0185, #712).
-- - recurring_overrides gains project_id: the charge the word is for. Null is the party-wide row, as every
--   row written before this. Existing rows are kept.
-- - recurring_parties reads each charge's own row first, field by field; else the party-wide row ("not
--   recurring" ends every charge, "recurring" only the main one, its pace every charge's). A charge marked
--   recurring with no complete month yet is read from its latest month, per charge.
-- - set_payment_recurring and set_payment_pace (the app, and the MCP writers through them) write the row of
--   the line's charge (private.line_stream_project), and return override_project_id with the prior value.
--   The MCP keeps that project in the undo, so mcp_undo puts back the same row even if the line moved.
-- - payment_recurring_state (payment_recurring, get_line_recurring) reports the word that applies to the
--   line's charge.
-- Readers through recurring_parties (missing bills, the schedule, arrivals, party_charges_json,
-- get_setup_suggestions, expected months) follow without a change. Signatures and grants are unchanged.
begin;
set local lock_timeout = '5s';

-- A delete of a project removes the words on its charge (cascade): set null would turn them into a
-- party-wide word, which may clash with one the party already has and would change every other charge.
alter table public.recurring_overrides add column project_id uuid;
alter table public.recurring_overrides drop constraint recurring_overrides_pkey;
alter table public.recurring_overrides add column id uuid not null default gen_random_uuid();
alter table public.recurring_overrides add constraint recurring_overrides_pkey primary key (id);
alter table public.recurring_overrides add constraint recurring_overrides_charge_key
  unique nulls not distinct (company_id, direction, party_id, currency, project_id);
alter table public.recurring_overrides add constraint recurring_overrides_project_fkey
  foreign key (company_id, project_id) references public.projects (company_id, id) on delete cascade;
create index recurring_overrides_project_idx on public.recurring_overrides (company_id, project_id);

comment on column public.recurring_overrides.project_id is
  'Decision 0188. The charge (the party''s lines for this project) the word is for; null is the party-wide word: false ends every charge, true makes the main charge recurring, its pace is every charge''s.';

-- The project of a line's recurring charge: its stream's (recurring_stream_lines). A line the streams leave
-- out (dated after today, outside the window, not posted, an income receipt) goes by the same rule: its own
-- project, else the party's project whose latest filed amount is closest.
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
  select sl.stream_project into stream
  from private.recurring_stream_lines(p_company, p_today) sl
  where sl.id = p_transaction_id;
  if found then
    return stream;
  end if;
  select t.project_id, t.amount_net into line
  from public.transactions t
  where t.id = p_transaction_id and t.company_id = p_company;
  if not found or line.project_id is not null then
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
    order by sl.project_id, sl.doc_date desc, sl.created_at desc
  ) f
  order by abs(f.amount - abs(line.amount_net)), f.doc_date desc, f.project_id
  limit 1;
  return stream;
end;
$$;

-- The owner's word that applies to one charge, as recurring_parties reads it: the charge's own row, field
-- by field, else the party-wide row (false for every charge, true for the main charge, its pace for all).
create or replace function private.recurring_override_for(p_company uuid, p_direction public.txn_direction,
  p_party_id uuid, p_currency text, p_stream uuid, p_today date)
returns table (recurring boolean, pace text)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select date_trunc('month', p_today)::date as this_month,
      (date_trunc('month', p_today) - interval '6 months')::date as window6
  ),
  lines as (
    select sl.stream_project, sl.doc_date, date_trunc('month', sl.doc_date)::date as month
    from private.recurring_stream_lines(p_company, p_today) sl
    where sl.direction = p_direction and sl.party_id = p_party_id and sl.currency = p_currency
  ),
  -- As in recurring_parties: the project billed in the most of the last six complete months, then the latest.
  main as (
    select l.stream_project
    from lines l, bounds b
    group by l.stream_project
    order by count(distinct l.month) filter (where l.month >= b.window6 and l.month < b.this_month) desc,
      max(l.doc_date) desc, l.stream_project nulls last
    limit 1
  ),
  own as (
    select o.recurring, o.pace from public.recurring_overrides o
    where o.company_id = p_company and o.direction = p_direction and o.party_id = p_party_id
      and o.currency = p_currency and o.project_id = p_stream
  ),
  party_wide as (
    select o.recurring, o.pace from public.recurring_overrides o
    where o.company_id = p_company and o.direction = p_direction and o.party_id = p_party_id
      and o.currency = p_currency and o.project_id is null
  )
  select
    coalesce((select own.recurring from own), case
      when (select pw.recurring from party_wide pw) is false then false
      when (select pw.recurring from party_wide pw)
        and (not exists (select 1 from main) or exists (select 1 from main m where m.stream_project is not distinct from p_stream))
        then true
    end),
    coalesce((select own.pace from own), (select pw.pace from party_wide pw));
$$;

-- Writes one field (recurring or pace) of one charge's row and returns its value before (json null: no
-- word). A null value clears the field, and the row goes when neither field is left.
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
  if p_field is null or p_field not in ('recurring', 'pace') then
    raise exception 'validation';
  end if;
  select case when p_field = 'recurring' then to_jsonb(o.recurring) else to_jsonb(o.pace) end into prior
  from public.recurring_overrides o
  where o.company_id = p_company and o.direction = p_direction and o.party_id = p_party_id
    and o.currency = p_currency and o.project_id is not distinct from p_project_id
  for update;
  prior := coalesce(prior, 'null'::jsonb);
  if not clear then
    insert into public.recurring_overrides as o
      (company_id, direction, party_id, currency, project_id, recurring, pace, set_by, set_at)
    values (p_company, p_direction, p_party_id, p_currency, p_project_id,
      case when p_field = 'recurring' then (p_value #>> '{}')::boolean end,
      case when p_field = 'pace' then p_value #>> '{}' end,
      auth.uid(), now())
    on conflict (company_id, direction, party_id, currency, project_id)
    do update set
      recurring = case when p_field = 'recurring' then excluded.recurring else o.recurring end,
      pace = case when p_field = 'pace' then excluded.pace else o.pace end,
      set_by = excluded.set_by, set_at = excluded.set_at;
  else
    update public.recurring_overrides o set
      recurring = case when p_field = 'recurring' then null else o.recurring end,
      pace = case when p_field = 'pace' then null else o.pace end,
      set_by = auth.uid(), set_at = now()
    where o.company_id = p_company and o.direction = p_direction and o.party_id = p_party_id
      and o.currency = p_currency and o.project_id is not distinct from p_project_id
      and (case when p_field = 'recurring' then o.pace else o.recurring::text end) is not null;
    delete from public.recurring_overrides o
    where o.company_id = p_company and o.direction = p_direction and o.party_id = p_party_id
      and o.currency = p_currency and o.project_id is not distinct from p_project_id
      and (case when p_field = 'recurring' then o.pace else o.recurring::text end) is null;
  end if;
  return prior;
end;
$$;

revoke all on function private.line_stream_project(uuid, uuid, date) from public, anon, authenticated;
revoke all on function private.recurring_override_for(uuid, public.txn_direction, uuid, text, uuid, date) from public, anon, authenticated;
revoke all on function private.write_recurring_override(uuid, public.txn_direction, uuid, text, uuid, text, jsonb) from public, anon, authenticated;

-- recurring_parties: each charge takes its own word (decision 0188); the body is 20261018122104's otherwise.
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
  -- The owner's words: a row with a project is that charge's; a row with none is the party's (decision 0188).
  overrides as (
    select o.direction, o.party_id, o.currency, o.project_id, o.recurring, o.pace
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
  -- pace is every charge's.
  words as (
    select s.direction, s.party_id, s.currency, s.stream_project,
      coalesce(own.recurring, case
        when pw.recurring is false then false
        when pw.recurring and s.stream_project is not distinct from mn.stream_project then true
      end) as recurring,
      coalesce(own.pace, pw.pace) as pace
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
      w.recurring, w.pace as pace_override,
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
  -- included, is its usual day and amount.
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
      0 as months_seen, fm.first_day as typical_day, fm.amount::bigint as typical_amount_minor
    from forced_monthly fm
    join words w on w.direction = fm.direction and w.party_id = fm.party_id and w.currency = fm.currency
      and w.stream_project is not distinct from fm.stream_project
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
  -- The line's own charge: its party and the project its stream goes to (recurring_stream_lines).
  stream := private.line_stream_project(p_company, p_transaction_id, p_today);
  -- The owner's word that applies to that charge (decision 0188).
  select w.recurring, w.pace into override, override_pace
  from private.recurring_override_for(p_company, party.direction, party.party_id, party.currency, stream, p_today) w;
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

-- The recurring switch of the line's charge (decision 0188); it keeps the pace, and null clears only the
-- switch. prior_override is that charge's own word before (null: none); override_project_id is its project.
create or replace function public.set_payment_recurring(p_id uuid, p_recurring boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  party record;
  stream uuid;
  prior jsonb;
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
  stream := private.line_stream_project(cid, p_id, private.flow_today());
  prior := private.write_recurring_override(cid, party.direction, party.party_id, party.currency, stream,
    'recurring', to_jsonb(p_recurring));
  return private.payment_recurring_state(cid, p_id, private.flow_today())
    || jsonb_build_object('prior_override', prior, 'override_project_id', stream);
end;
$$;

-- The pace of the line's charge (decision 0188): month, 2months, quarter or year; null goes back to the
-- party-wide pace, else the detected one. Returns the state, prior_pace for ביטול and override_project_id.
create or replace function public.set_payment_pace(p_id uuid, p_pace text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  party record;
  stream uuid;
  prior jsonb;
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
  stream := private.line_stream_project(cid, p_id, private.flow_today());
  prior := private.write_recurring_override(cid, party.direction, party.party_id, party.currency, stream,
    'pace', to_jsonb(p_pace));
  return private.payment_recurring_state(cid, p_id, private.flow_today())
    || jsonb_build_object('prior_pace', prior, 'override_project_id', stream);
end;
$$;

create or replace function public.mcp_set_line_recurring(p_idempotency_key text, p_transaction_id uuid, p_recurring boolean)
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
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'line_recurring|' || p_transaction_id::text || '|' || coalesce(p_recurring::text, 'null');
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
      if exists (
        select 1 from public.review_queue q
        where q.id = p_transaction_id and q.company_id = cid
      ) then
        response := private.mcp_error(
          'validation',
          'id is not a transaction; list_review.id is the review id'
        );
      else
        response := private.mcp_refused('transaction not found');
      end if;
    else
      written := public.set_payment_recurring(p_transaction_id, p_recurring);
      -- clock_timestamp, so two writes to one line in one transaction still undo newest first.
      insert into private.mcp_writes (token_id, user_id, transaction_id, kind, prior, created_at)
      values (
        token, auth.uid(), p_transaction_id, 'line_recurring',
        -- The charge the write was for (decision 0188), so the undo puts back the same row.
        jsonb_build_object('project', written->'override_project_id', 'before', written->'prior_override', 'written', to_jsonb(p_recurring)),
        clock_timestamp()
      )
      returning id into write_id;
      response := jsonb_build_object(
        'ok', true,
        'data', (written - 'prior_override' - 'override_project_id') || jsonb_build_object(
          'undo_kind', 'line_recurring',
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

create or replace function public.mcp_set_line_pace(p_idempotency_key text, p_transaction_id uuid, p_pace text)
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
        -- The charge the write was for (decision 0188), so the undo puts back the same row.
        jsonb_build_object('project', written->'override_project_id', 'before', written->'prior_pace', 'written', to_jsonb(p_pace)),
        clock_timestamp()
      )
      returning id into write_id;
      response := jsonb_build_object(
        'ok', true,
        'data', (written - 'prior_pace' - 'override_project_id') || jsonb_build_object(
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
$function$;

revoke all on function public.mcp_set_line_recurring(text, uuid, boolean) from public, anon;
grant execute on function public.mcp_set_line_recurring(text, uuid, boolean) to authenticated, service_role;
revoke all on function public.mcp_set_line_pace(text, uuid, text) from public, anon;
grant execute on function public.mcp_set_line_pace(text, uuid, text) to authenticated, service_role;

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- The undo kinds line_recurring and line_pace read and write the row of the charge the write was for: the
-- project kept in prior (decision 0188). A write from before this has none, so it undoes the party-wide row.
do $undo$
declare
  def text;
  anchor text;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);

  anchor := $a$               and o.party_id = party.party_id and o.currency = party.currency
             for update),$a$;
  if pg_temp.anchor_count(def, anchor) <> 2 then
    raise exception 'mcp_undo override reads are not the expected definition';
  end if;
  def := replace(def, anchor, $n$               and o.party_id = party.party_id and o.currency = party.currency
               and o.project_id is not distinct from (rec.prior->>'project')::uuid
             for update),$n$);

  anchor := $a$perform public.set_payment_recurring(p_id, (rec.prior->>'before')::boolean);$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo line_recurring write is not the expected definition';
  end if;
  def := replace(def, anchor, $n$perform private.write_recurring_override(cid, party.direction, party.party_id, party.currency,
              (rec.prior->>'project')::uuid, 'recurring', rec.prior->'before');$n$);

  anchor := $a$perform public.set_payment_pace(p_id, rec.prior->>'before');$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo line_pace write is not the expected definition';
  end if;
  def := replace(def, anchor, $n$perform private.write_recurring_override(cid, party.direction, party.party_id, party.currency,
              (rec.prior->>'project')::uuid, 'pace', rec.prior->'before');$n$);

  execute def;
end;
$undo$;

drop function pg_temp.anchor_count(text, text);

commit;
