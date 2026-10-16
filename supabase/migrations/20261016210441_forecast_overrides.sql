-- FLOW-141 server: the month-end forecast (צפי) and the user's corrections to it.
-- - public.forecast_overrides: one row per changed item of one company's month (an amount, a
--   day, or "not this month"). A row never edits the invoice, the bill or the recurring charge.
--   Rows name their month, so they expire with it: reads ask for one month, and a write to a
--   month that has ended is refused (month ended). Viewers read; writes go through the functions.
-- - private.forecast_apply: the one write path (the app's RPC and the MCP tool share it).
-- - public.forecast_overrides_for(month): the month's overrides for the caller's company.
-- - public.set_forecast_item(month, item, patch) and public.reset_forecast_month(month): the
--   app's RPCs (editors only).
-- - public.mcp_set_forecast_item and public.mcp_reset_forecast: the MCP writes (idempotency key,
--   undo kinds forecast_item and forecast_reset). mcp_undo gets both kinds.

begin;

set local lock_timeout = '5s';

create table public.forecast_overrides (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  item_key text not null check (char_length(item_key) between 1 and 200),
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  due_on date,
  moved_out boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, month, item_key),
  -- A row always changes something; an item back at Flow's numbers has no row.
  check (amount_minor is not null or due_on is not null or moved_out)
);

comment on table public.forecast_overrides is
  'FLOW-141: the user''s corrections to one month''s forecast, per company and item. Rows of a past month are inert (reads ask for one month) and writes to it are refused.';

create trigger forecast_overrides_touch
  before update on public.forecast_overrides
  for each row execute function private.touch_updated_at();

alter table public.forecast_overrides enable row level security;
create policy forecast_overrides_select on public.forecast_overrides
  for select to authenticated
  using (company_id = (select private.readable_company_id()));
revoke all on public.forecast_overrides from public, anon;
grant select on public.forecast_overrides to authenticated;
grant select, insert, update, delete on public.forecast_overrides to service_role;

-- The state of one item as JSON, or SQL null when it has no override (Flow's number).
create function private.forecast_state(p_company uuid, p_month text, p_item text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('amount_minor', f.amount_minor, 'due_on', f.due_on, 'moved_out', f.moved_out)
  from public.forecast_overrides f
  where f.company_id = p_company and f.month = p_month and f.item_key = p_item;
$$;

revoke all on function private.forecast_state(uuid, text, text) from public, anon, authenticated;

-- The one write path. A patch holds any of amount_minor, due_on, moved_out, or reset (alone).
-- Returns the item's state after the write (null when it is back at Flow's number). Raises
-- 'month ended' for a month before this one (Israel time), and 'validation' for a bad patch.
create function private.forecast_apply(p_company uuid, p_month text, p_item text, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  today text := to_char(private.flow_today(), 'YYYY-MM');
  before_state jsonb;
  new_amount bigint;
  new_due date;
  new_moved boolean;
begin
  if p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or p_item is null or char_length(p_item) < 1 or char_length(p_item) > 200
    or p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
    or exists (select 1 from jsonb_object_keys(p_patch) k where k not in ('amount_minor', 'due_on', 'moved_out', 'reset'))
    or (p_patch ? 'reset' and (p_patch->'reset' <> 'true'::jsonb or (select count(*) from jsonb_object_keys(p_patch)) <> 1))
    or (p_patch ? 'amount_minor' and jsonb_typeof(p_patch->'amount_minor') not in ('number', 'null'))
    or (p_patch ? 'amount_minor' and p_patch->>'amount_minor' is not null and (p_patch->>'amount_minor')::numeric < 0)
    or (p_patch ? 'due_on' and jsonb_typeof(p_patch->'due_on') not in ('string', 'null'))
    or (p_patch ? 'moved_out' and jsonb_typeof(p_patch->'moved_out') not in ('boolean', 'null'))
  then
    raise exception 'validation' using errcode = '22023';
  end if;
  if p_month < today then
    raise exception 'month ended' using errcode = '22023';
  end if;

  before_state := private.forecast_state(p_company, p_month, p_item);
  if p_patch ? 'reset' then
    delete from public.forecast_overrides f
    where f.company_id = p_company and f.month = p_month and f.item_key = p_item;
    return null;
  end if;

  new_amount := case when p_patch ? 'amount_minor' then (p_patch->>'amount_minor')::bigint
    else (before_state->>'amount_minor')::bigint end;
  new_due := case when p_patch ? 'due_on' then (p_patch->>'due_on')::date
    else (before_state->>'due_on')::date end;
  new_moved := case when p_patch ? 'moved_out' then coalesce((p_patch->>'moved_out')::boolean, false)
    else coalesce((before_state->>'moved_out')::boolean, false) end;

  if new_amount is null and new_due is null and not new_moved then
    delete from public.forecast_overrides f
    where f.company_id = p_company and f.month = p_month and f.item_key = p_item;
    return null;
  end if;

  insert into public.forecast_overrides (company_id, month, item_key, amount_minor, due_on, moved_out)
  values (p_company, p_month, p_item, new_amount, new_due, new_moved)
  on conflict (company_id, month, item_key) do update
  set amount_minor = excluded.amount_minor,
      due_on = excluded.due_on,
      moved_out = excluded.moved_out;
  return private.forecast_state(p_company, p_month, p_item);
end;
$$;

revoke all on function private.forecast_apply(uuid, text, text, jsonb) from public, anon, authenticated;

-- The month's overrides for the caller's company (viewers included). Other months are not read.
create function public.forecast_overrides_for(p_month text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'item_key', f.item_key,
    'amount_minor', f.amount_minor,
    'due_on', f.due_on,
    'moved_out', f.moved_out
  ) order by f.item_key), '[]'::jsonb)
  from public.forecast_overrides f
  where f.company_id = private.readable_company_id()
    and f.month = p_month;
$$;

revoke all on function public.forecast_overrides_for(text) from public, anon;
grant execute on function public.forecast_overrides_for(text) to authenticated, service_role;

-- The app's write (owner or editor). Returns the item's state after the write, or null.
create function public.set_forecast_item(p_month text, p_item_key text, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    if private.is_read_only() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  return private.forecast_apply(cid, p_month, p_item_key, p_patch);
end;
$$;

revoke all on function public.set_forecast_item(text, text, jsonb) from public, anon;
grant execute on function public.set_forecast_item(text, text, jsonb) to authenticated, service_role;

-- The app's "איפוס": every override of the month goes; returns how many went.
create function public.reset_forecast_month(p_month text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  removed integer;
begin
  cid := private.current_company_id();
  if cid is null then
    if private.is_read_only() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'validation' using errcode = '22023';
  end if;
  if p_month < to_char(private.flow_today(), 'YYYY-MM') then
    raise exception 'month ended' using errcode = '22023';
  end if;
  delete from public.forecast_overrides f
  where f.company_id = cid and f.month = p_month;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.reset_forecast_month(text) from public, anon;
grant execute on function public.reset_forecast_month(text) to authenticated, service_role;

-- MCP writes. The same shape as mcp_update_project: the gate, the idempotency key, one write row
-- for undo (kind forecast_item, or forecast_reset for the whole month), and a stored response.
create function public.mcp_set_forecast_item(p_idempotency_key text, p_month text, p_item_key text, p_patch jsonb)
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
  before_state jsonb;
  after_state jsonb;
  wid uuid;
  response jsonb;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) < 1 or char_length(p_idempotency_key) > 128
    or p_month is null or p_item_key is null or p_patch is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'forecast_item|' || p_month || '|' || p_item_key || '|' || p_patch::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  response := private.mcp_error('refused', 'The write was refused.');
  begin
    before_state := private.forecast_state(cid, p_month, p_item_key);
    after_state := private.forecast_apply(cid, p_month, p_item_key, p_patch);
    insert into private.mcp_writes (token_id, user_id, kind, prior, created_at)
    values (
      token, auth.uid(), 'forecast_item',
      jsonb_build_object('month', p_month, 'item_key', p_item_key, 'before', before_state, 'after', after_state),
      clock_timestamp()
    )
    returning id into wid;
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'id', wid,
        'month', p_month,
        'item_key', p_item_key,
        'amount_minor', after_state->'amount_minor',
        'due_on', after_state->'due_on',
        'moved_out', coalesce(after_state->'moved_out', 'false'::jsonb),
        'undo_kind', 'forecast_item'
      )
    );
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      if sqlerrm = 'validation' then
        response := private.mcp_error('validation', 'validation');
      elsif sqlerrm = 'month ended' then
        response := private.mcp_error('refused', 'month ended');
      else
        response := private.mcp_refused(sqlerrm);
      end if;
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_set_forecast_item(text, text, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.mcp_set_forecast_item(text, text, text, jsonb) to authenticated;

create function public.mcp_reset_forecast(p_idempotency_key text, p_month text)
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
  rows_before jsonb;
  wid uuid;
  response jsonb;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) < 1 or char_length(p_idempotency_key) > 128
    or p_month is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'forecast_reset|' || p_month;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  response := private.mcp_error('refused', 'The write was refused.');
  begin
    if p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
      raise exception 'validation' using errcode = '22023';
    end if;
    if p_month < to_char(private.flow_today(), 'YYYY-MM') then
      raise exception 'month ended' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'item_key', f.item_key, 'amount_minor', f.amount_minor, 'due_on', f.due_on, 'moved_out', f.moved_out
    )), '[]'::jsonb)
    into rows_before
    from public.forecast_overrides f
    where f.company_id = cid and f.month = p_month;
    delete from public.forecast_overrides f
    where f.company_id = cid and f.month = p_month;
    insert into private.mcp_writes (token_id, user_id, kind, prior, created_at)
    values (token, auth.uid(), 'forecast_reset', jsonb_build_object('month', p_month, 'rows', rows_before), clock_timestamp())
    returning id into wid;
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'id', wid,
        'month', p_month,
        'removed', jsonb_array_length(rows_before),
        'undo_kind', 'forecast_reset'
      )
    );
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      if sqlerrm = 'validation' then
        response := private.mcp_error('validation', 'validation');
      elsif sqlerrm = 'month ended' then
        response := private.mcp_error('refused', 'month ended');
      else
        response := private.mcp_refused(sqlerrm);
      end if;
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_reset_forecast(text, text) from public, anon, authenticated, service_role;
grant execute on function public.mcp_reset_forecast(text, text) to authenticated;

-- private.mcp_writes: the two kinds, with the fields their undo reads (anchors checked: each
-- must occur once in the live definition, as in 20261014184227_projects_tab.sql).
create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $kinds$
declare
  def text;
  anchor text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'document_attach'::text]$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, $n$'document_attach'::text, 'forecast_item'::text, 'forecast_reset'::text]$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if right(def, 2) <> '))' or pg_temp.anchor_count(def, $a$(kind = 'recurring_match'::text)$a$) <> 1 then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'forecast_item'::text) AND (prior ? 'before'::text) AND (prior ? 'after'::text)) OR ((kind = 'forecast_reset'::text) AND (prior ? 'rows'::text))))$n$;
end
$kinds$;

-- public.mcp_undo: the two kinds, looked up by the write's id, and their branches (the branches
-- go in front of recurring_match's, and their declarations after cur_project_row's).
do $undo$
declare
  def text;
  anchor text;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);

  anchor := $a$'loan_index', 'index_rate', 'project_update', 'project_delete'$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, anchor, $n$'loan_index', 'index_rate', 'project_update', 'project_delete', 'forecast_item', 'forecast_reset'$n$);

  anchor := $a$        or (p_kind in ('project_update', 'project_delete') and w.kind = p_kind and w.project_id = p_id)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo lookup is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
        or (p_kind in ('forecast_item', 'forecast_reset') and w.kind = p_kind and w.id = p_id)$n$);

  anchor := $a$    elsif p_kind = 'recurring_match' then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo recurring_match branch is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'forecast_item' then
      -- The item goes back to the state it had before the write, when nothing changed since.
      if coalesce(private.forecast_state(cid, rec.prior->>'month', rec.prior->>'item_key'), 'null'::jsonb)
        is distinct from coalesce(rec.prior->'after', 'null'::jsonb)
      then
        response := private.mcp_error('conflict', 'conflict');
      else
        begin
          delete from public.forecast_overrides f
          where f.company_id = cid and f.month = rec.prior->>'month' and f.item_key = rec.prior->>'item_key';
          if rec.prior->'before' is not null and jsonb_typeof(rec.prior->'before') = 'object' then
            insert into public.forecast_overrides (company_id, month, item_key, amount_minor, due_on, moved_out)
            values (
              cid, rec.prior->>'month', rec.prior->>'item_key',
              (rec.prior->'before'->>'amount_minor')::bigint,
              (rec.prior->'before'->>'due_on')::date,
              coalesce((rec.prior->'before'->>'moved_out')::boolean, false)
            );
          end if;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object('ok', true, 'data', jsonb_build_object('kind', p_kind, 'id', p_id));
        exception
          when sqlstate '23505' or sqlstate '23514' or sqlstate '22023' then
            response := private.mcp_error('conflict', 'conflict');
        end;
      end if;
    elsif p_kind = 'forecast_reset' then
      -- The month's overrides come back, when none was set since the reset.
      if exists (select 1 from public.forecast_overrides f where f.company_id = cid and f.month = rec.prior->>'month') then
        response := private.mcp_error('conflict', 'conflict');
      else
        begin
          insert into public.forecast_overrides (company_id, month, item_key, amount_minor, due_on, moved_out)
          select cid, rec.prior->>'month', x->>'item_key', (x->>'amount_minor')::bigint,
            (x->>'due_on')::date, coalesce((x->>'moved_out')::boolean, false)
          from jsonb_array_elements(rec.prior->'rows') x;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object('ok', true, 'data', jsonb_build_object('kind', p_kind, 'id', p_id));
        exception
          when sqlstate '23505' or sqlstate '23514' then
            response := private.mcp_error('conflict', 'conflict');
        end;
      end if;
$n$ || anchor);

  execute def;
end
$undo$;

drop function pg_temp.anchor_count(text, text);

commit;
