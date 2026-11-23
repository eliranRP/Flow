-- FLOW-1266: a recurring charge can have an end date (the owner's request, 2026-11-23).
-- - recurring_overrides.ends_on: the owner's last date for the charge. As the usual amount (decision 0189), it
--   is only the charge's own: a charge with no project reads it from the row with no project. It is one more
--   field of the owner's word, so a row may hold only it.
-- - private.recurring_due_date(month, day): the day a charge is due in a month, its usual day capped at the
--   month's last day.
-- - recurring_parties returns ends_on (appended last; the return type changes, so the function is dropped and
--   created again from its current body) and leaves out a charge that is over: its end date has passed, or
--   it has not come this month and its next due day is after its end date (nothing more is expected).
--   Every reader of the charges (the schedule, missing bills, arrivals, month lines, the line's state,
--   handovers, setup suggestions) follows.
-- - expected_months stops each charge's cells at its end date and returns ends_on on each charge, so the
--   app's month lists (dueInMonth) stop at the same month.
-- - recurring_schedule_json returns ends_on (yyyy-mm-dd or null).
-- - private.write_recurring_override takes the field ends_on; marking a charge recurring again clears an end
--   date that has passed, so the charge comes back.
-- - set_payment_end (the app) and mcp_set_line_end_date (MCP set_line_end_date, undo kind line_end) write it
--   for a line's charge, as set_payment_amount does.
begin;

set local lock_timeout = '5s';

alter table public.recurring_overrides add column ends_on date;
alter table public.recurring_overrides drop constraint recurring_overrides_something;
alter table public.recurring_overrides add constraint recurring_overrides_something
  check (recurring is not null or pace is not null or typical_amount_minor is not null or ends_on is not null);

comment on column public.recurring_overrides.ends_on is
  'FLOW-1266. The owner''s end date for the charge: it is not expected on a due day after it, and once it has passed the charge is not recurring. Null: no end.';

create or replace function private.recurring_due_date(p_month date, p_day integer)
returns date
language sql
immutable
set search_path to ''
as $$
  select make_date(extract(year from p_month)::integer, extract(month from p_month)::integer,
    greatest(1, least(coalesce(p_day, 1), extract(day from private.month_end(p_month))::integer)));
$$;

revoke all on function private.recurring_due_date(date, integer) from public, anon, authenticated;

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$
  select (length(p_def) - length(replace(p_def, p_anchor, ''))) / nullif(length(p_anchor), 0);
$$;

-- recurring_parties: the end date, and a charge that is over leaves.
do $parties$
declare
  def text;
  fn text := 'private.recurring_parties(uuid,date,boolean)';
  anchors text[] := array[
    E'this_month_line_count integer)',
    E'o.recurring, o.pace, o.typical_amount_minor\n',
    E'      coalesce(own.pace, pw.pace) as pace,\n',
    E'      w.recurring, w.pace as pace_override, w.amount as owner_amount,\n',
    E'      case when w.amount is null then ''computed'' else ''owner'' end as amount_source\n',
    E'      case when p.owner_amount is null then ''computed'' else ''owner'' end as amount_source\n',
    E'      f.months_seen, f.typical_day, f.typical_amount_minor, ''user'', f.amount_source\n',
    E'    p.this_month_line_count\n',
    E'  left join picks pk on pk.ord = p.ord\n'
  ];
  a text;
begin
  def := pg_get_functiondef(fn::regprocedure);
  foreach a in array anchors loop
    if pg_temp.anchor_count(def, a) <> 1 then
      raise exception '% is not the expected definition (%)', fn, a;
    end if;
  end loop;
  def := replace(def, anchors[1], E'this_month_line_count integer, ends_on date)');
  def := replace(def, anchors[2], E'o.recurring, o.pace, o.typical_amount_minor, o.ends_on\n');
  def := replace(def, anchors[3], anchors[3] || E'      coalesce(own.ends_on, case when s.stream_project is null then pw.ends_on end) as ends_on,\n');
  def := replace(def, anchors[4], E'      w.recurring, w.pace as pace_override, w.amount as owner_amount, w.ends_on,\n');
  def := replace(def, anchors[5], E'      case when w.amount is null then ''computed'' else ''owner'' end as amount_source,\n      w.ends_on\n');
  def := replace(def, anchors[6], E'      case when p.owner_amount is null then ''computed'' else ''owner'' end as amount_source,\n      p.ends_on\n');
  def := replace(def, anchors[7], E'      f.months_seen, f.typical_day, f.typical_amount_minor, ''user'', f.amount_source, f.ends_on\n');
  def := replace(def, anchors[8], E'    p.this_month_line_count,\n    p.ends_on\n');
  -- FLOW-1266: a charge that is over leaves: its end date has passed, or it has not come this month and its
  -- next due day is after its end date. A late charge is due from this month on, as expected_months counts it.
  def := replace(def, anchors[9], anchors[9] || $n$  where p.ends_on is null
    or (p.ends_on >= p_today
      and (p.last_seen_month = b.this_month
        or private.recurring_due_date(greatest(b.this_month, case
            when p.pace = 'month' then b.this_month
            else (p.last_seen_month + make_interval(months => private.pace_months(p.pace)))::date
          end), p.typical_day) <= p.ends_on))
$n$);
  execute 'drop function private.recurring_parties(uuid, date, boolean)';
  execute def;
end;
$parties$;

revoke all on function private.recurring_parties(uuid, date, boolean) from public, anon, authenticated;

-- expected_months: no cell after a charge's end date; each charge says its end date.
do $expected$
declare
  def text;
  fn text := 'public.expected_months(integer,uuid,date)';
  cell_anchor text := E'        -- A charge with a handover is not expected this month: its payment came under the other party.\n';
  json_anchor text := E'          ''handover'', r.handover\n';
begin
  def := pg_get_functiondef(fn::regprocedure);
  if pg_temp.anchor_count(def, cell_anchor) <> 1 or pg_temp.anchor_count(def, json_anchor) <> 1 then
    raise exception '% is not the expected definition', fn;
  end if;
  def := replace(def, cell_anchor, $n$        -- FLOW-1266: not after the charge's end date.
        and (r.ends_on is null or private.recurring_due_date(m.month, r.typical_day) <= r.ends_on)
$n$ || cell_anchor);
  json_anchor := E'        order by r.direction, coalesce(s.name, cu.name), r.party_id)';
  if pg_temp.anchor_count(def, json_anchor) <> 1 then
    raise exception '% is not the expected definition (json)', fn;
  end if;
  -- Only a charge with an end date says it, so every other charge's lean answer stays as it was.
  def := replace(def, json_anchor, E'        || case when r.ends_on is null then ''{}''::jsonb else jsonb_build_object(''ends_on'', r.ends_on) end\n' || json_anchor);
  execute def;
end;
$expected$;

-- recurring_schedule_json: each row says its end date.
do $schedule$
declare
  def text;
  fn text := 'private.recurring_schedule_json(uuid,date)';
  anchor text := E'      ''category_name'', c.name\n';
begin
  def := pg_get_functiondef(fn::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception '% is not the expected definition', fn;
  end if;
  def := replace(def, anchor, E'      ''category_name'', c.name,\n      ''ends_on'', x.ends_on\n');
  execute def;
end;
$schedule$;

-- Writes one field (recurring, pace, amount or ends_on) of one charge's row and returns its value before (json
-- null: no word). A null value clears the field, and the row goes when no field is left. Marking the charge
-- recurring clears an end date that has passed (FLOW-1266), so the charge comes back.
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
  if p_field is null or p_field not in ('recurring', 'pace', 'amount', 'ends_on') then
    raise exception 'validation';
  end if;
  select case p_field
      when 'recurring' then to_jsonb(o.recurring)
      when 'pace' then to_jsonb(o.pace)
      when 'ends_on' then to_jsonb(o.ends_on)
      else to_jsonb(o.typical_amount_minor)
    end into prior
  from public.recurring_overrides o
  where o.company_id = p_company and o.direction = p_direction and o.party_id = p_party_id
    and o.currency = p_currency and o.project_id is not distinct from p_project_id
  for update;
  prior := coalesce(prior, 'null'::jsonb);
  if not clear then
    insert into public.recurring_overrides as o
      (company_id, direction, party_id, currency, project_id, recurring, pace, typical_amount_minor, ends_on,
        set_by, set_at)
    values (p_company, p_direction, p_party_id, p_currency, p_project_id,
      case when p_field = 'recurring' then (p_value #>> '{}')::boolean end,
      case when p_field = 'pace' then p_value #>> '{}' end,
      case when p_field = 'amount' then (p_value #>> '{}')::bigint end,
      case when p_field = 'ends_on' then (p_value #>> '{}')::date end,
      auth.uid(), now())
    on conflict (company_id, direction, party_id, currency, project_id)
    do update set
      recurring = case when p_field = 'recurring' then excluded.recurring else o.recurring end,
      pace = case when p_field = 'pace' then excluded.pace else o.pace end,
      typical_amount_minor = case when p_field = 'amount' then excluded.typical_amount_minor else o.typical_amount_minor end,
      ends_on = case
        when p_field = 'ends_on' then excluded.ends_on
        when p_field = 'recurring' and excluded.recurring and o.ends_on < private.flow_today() then null
        else o.ends_on
      end,
      set_by = excluded.set_by, set_at = excluded.set_at;
  else
    delete from public.recurring_overrides o
    where o.company_id = p_company and o.direction = p_direction and o.party_id = p_party_id
      and o.currency = p_currency and o.project_id is not distinct from p_project_id
      and (p_field = 'recurring' or o.recurring is null)
      and (p_field = 'pace' or o.pace is null)
      and (p_field = 'amount' or o.typical_amount_minor is null)
      and (p_field = 'ends_on' or o.ends_on is null);
    update public.recurring_overrides o set
      recurring = case when p_field = 'recurring' then null else o.recurring end,
      pace = case when p_field = 'pace' then null else o.pace end,
      typical_amount_minor = case when p_field = 'amount' then null else o.typical_amount_minor end,
      ends_on = case when p_field = 'ends_on' then null else o.ends_on end,
      set_by = auth.uid(), set_at = now()
    where o.company_id = p_company and o.direction = p_direction and o.party_id = p_party_id
      and o.currency = p_currency and o.project_id is not distinct from p_project_id;
  end if;
  return prior;
end;
$$;

-- The owner's end date for a line's charge (FLOW-1266), or null for no end. p_project_id names one of the
-- line's charges when a split line feeds several (the charge page passes its own); else the line's own charge.
-- Returns the end date written, prior_ends_on for ביטול and override_project_id.
create or replace function public.set_payment_end(p_id uuid, p_ends_on date, p_project_id uuid default null)
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
begin
  -- An owner or an editor writes (decision 0167); a viewer member or the demo viewer is refused.
  cid := private.current_company_id();
  if cid is null then
    if private.is_read_only() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_ends_on is not null and (p_ends_on < date '2000-01-01' or p_ends_on > today + interval '50 years') then
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
  stream := private.line_charge_project(cid, p_id, p_project_id, today);
  prior := private.write_recurring_override(cid, party.direction, party.party_id, party.currency, stream,
    'ends_on', to_jsonb(p_ends_on));
  return jsonb_build_object(
    'transaction_id', p_id,
    'party', jsonb_build_object('direction', party.direction, 'id', party.party_id, 'name', party.name,
      'currency', party.currency),
    'project_id', stream,
    'ends_on', p_ends_on,
    'recurring', exists (
      select 1 from private.recurring_parties(cid, today) r
      where r.direction = party.direction and r.party_id = party.party_id and r.currency = party.currency
        and r.project_id is not distinct from stream
    ),
    'prior_ends_on', prior,
    'override_project_id', stream
  );
end;
$$;

revoke all on function public.set_payment_end(uuid, date, uuid) from public, anon;
grant execute on function public.set_payment_end(uuid, date, uuid) to authenticated, service_role;

-- MCP set_line_end_date: the end date of the line's charge (or the charge of project_id it feeds); undo kind
-- line_end keeps the charge's project, so it puts back the same row.
create or replace function public.mcp_set_line_end_date(p_idempotency_key text, p_transaction_id uuid, p_ends_on date,
  p_project_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
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
    -- From today (the app's date sheet starts there) to 50 years on, as set_payment_end allows.
    or (p_ends_on is not null and (p_ends_on < private.flow_today() or p_ends_on > private.flow_today() + interval '50 years'))
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'line_end|' || p_transaction_id::text || '|' || coalesce(p_ends_on::text, 'null')
    || coalesce('|' || p_project_id::text, '');
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
      written := public.set_payment_end(p_transaction_id, p_ends_on, p_project_id);
      -- clock_timestamp, so two writes to one line in one transaction still undo newest first.
      insert into private.mcp_writes (token_id, user_id, transaction_id, kind, prior, created_at)
      values (
        token, auth.uid(), p_transaction_id, 'line_end',
        jsonb_build_object('project', written->'override_project_id', 'before', written->'prior_ends_on',
          'written', to_jsonb(p_ends_on)),
        clock_timestamp()
      )
      returning id into write_id;
      response := jsonb_build_object(
        'ok', true,
        'data', (written - 'prior_ends_on' - 'override_project_id') || jsonb_build_object(
          'undo_kind', 'line_end',
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

revoke all on function public.mcp_set_line_end_date(text, uuid, date, uuid) from public, anon;
grant execute on function public.mcp_set_line_end_date(text, uuid, date, uuid) to authenticated, service_role;

-- The undo log takes the kind line_end.
do $writes$
declare
  def text;
  anchor text := $a$'held_change_left'::text])$a$;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, $n$'held_change_left'::text, 'line_end'::text])$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if right(def, 2) <> '))' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'line_end'::text) AND (transaction_id IS NOT NULL) AND (prior ? 'before'::text) AND (prior ? 'written'::text))))$n$;
end
$writes$;

-- mcp_undo takes line_end: the charge's end date changed since the write is a conflict; else the end date
-- from before (null: none) goes back on the row of the charge the write was for.
do $undo$
declare
  def text;
  anchor text;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);

  anchor := $a$'line_amount', 'category_cash', $a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kind list is not the expected definition';
  end if;
  def := replace(def, anchor, $n$'line_amount', 'line_end', 'category_cash', $n$);

  anchor := $a$        or (p_kind = 'line_amount' and w.kind = 'line_amount' and w.transaction_id = p_id)
$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo line_amount lookup is not the expected definition';
  end if;
  def := replace(def, anchor, anchor
    || $n$        or (p_kind = 'line_end' and w.kind = 'line_end' and w.transaction_id = p_id)
$n$);

  anchor := $a$    elsif p_kind = 'line_amount' then
$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo line_amount branch is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'line_end' then
      -- FLOW-1266. The charge's end date changed since the write is a conflict; else the end date from
      -- before (null: none) goes back on the row of the charge the write was for.
      declare
        party record;
        cur jsonb;
      begin
        select * into party from private.payment_party(cid, p_id);
        if not found then
          response := private.mcp_error('not_found', 'not found');
        else
          select coalesce(
            (select to_jsonb(o.ends_on) from public.recurring_overrides o
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
              (rec.prior->>'project')::uuid, 'ends_on', rec.prior->'before');
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
