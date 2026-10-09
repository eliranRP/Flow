-- FLOW-413 + FLOW-103, server PR 2: the cash view's MCP writes (decision 0168). Each wraps the
-- owner's own setter with the idempotency key, the write gate and an undo:
-- - mcp_set_category_cash, undo kind category_cash (id: the category);
-- - mcp_set_line_cash and mcp_set_lines_cash, undo kind line_cash (id: the line; the batch
--   undoes through undo_batch);
-- - mcp_set_cash_basis, undo kind cash_basis (id: the company).

begin;

set local lock_timeout = '5s';

create or replace function public.mcp_set_category_cash(p_idempotency_key text, p_category_id uuid, p_in_cash boolean)
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
  before boolean;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_category_id is null
    or p_in_cash is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'category_cash|' || p_category_id::text || '|' || p_in_cash::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  begin
    select c.in_cash into before
    from public.categories c
    where c.id = p_category_id and c.company_id = cid
    for update;

    if not found then
      response := private.mcp_refused('category not found');
    else
      perform public.set_category_cash(p_category_id, p_in_cash);
      insert into private.mcp_writes (token_id, user_id, kind, category_id, prior, created_at)
      values (
        token, auth.uid(), 'category_cash', p_category_id,
        jsonb_build_object('before', before, 'written', p_in_cash),
        clock_timestamp()
      );
      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
          'id', p_category_id,
          'in_cash', p_in_cash,
          'undo_kind', 'category_cash'
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

create or replace function public.mcp_set_line_cash(p_idempotency_key text, p_transaction_id uuid, p_in_cash boolean)
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
  before boolean;
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
  hash := 'line_cash|' || p_transaction_id::text || '|' || coalesce(p_in_cash::text, 'null');
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  begin
    select t.in_cash_override into before
    from public.transactions t
    where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null
    for update;

    if not found then
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
      written := public.set_transaction_cash(p_transaction_id, p_in_cash);
      -- clock_timestamp, so two writes to one line in one transaction still undo newest first.
      insert into private.mcp_writes (token_id, user_id, transaction_id, kind, prior, created_at)
      values (
        token, auth.uid(), p_transaction_id, 'line_cash',
        jsonb_build_object('before', before, 'written', p_in_cash),
        clock_timestamp()
      )
      returning id into write_id;
      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
          'transaction_id', p_transaction_id,
          'in_cash_override', p_in_cash,
          'cash_state', written->'cash_state',
          'undo_kind', 'line_cash',
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

create or replace function public.mcp_set_lines_cash(p_idempotency_key text, p_items jsonb)
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
  batch_id uuid := gen_random_uuid();
  item jsonb;
  ord int := 0;
  row_key text;
  row_result jsonb;
  results jsonb := '[]'::jsonb;
  row_writes jsonb := '[]'::jsonb;
  ok_count int := 0;
  error_count int := 0;
  response jsonb;
begin
  -- Row keys are key:ordinal, and mcp_set_line_cash caps keys at 128.
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 124
    or p_items is null
    or jsonb_typeof(p_items) <> 'array'
  then
    return private.mcp_error('validation', 'validation');
  end if;

  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 200 then
    return private.mcp_error('validation', 'validation');
  end if;

  if exists (
    select 1
    from (
      select elem->>'transaction_id' as tid
      from jsonb_array_elements(p_items) elem
      where jsonb_typeof(elem) = 'object' and elem->>'transaction_id' is not null
    ) listed
    group by tid
    having count(*) > 1
  ) then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'lines_cash|' || md5(p_items::text);
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    ord := ord + 1;
    row_key := p_idempotency_key || ':' || ord::text;
    row_result := null;

    if jsonb_typeof(item) <> 'object'
      or item->>'transaction_id' is null
      or (item->>'transaction_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or not item ? 'in_cash'
      or jsonb_typeof(item->'in_cash') not in ('boolean', 'null')
      or exists (select 1 from jsonb_object_keys(item) k where k not in ('transaction_id', 'in_cash'))
    then
      row_result := private.mcp_error('validation', 'validation');
    else
      begin
        row_result := public.mcp_set_line_cash(
          row_key,
          (item->>'transaction_id')::uuid,
          (item->>'in_cash')::boolean
        );
      exception
        when deadlock_detected or serialization_failure or lock_not_available then
          row_result := private.mcp_error('unavailable', 'retry');
        when others then
          row_result := private.mcp_refused(sqlerrm);
      end;
    end if;

    if row_result->>'ok' = 'true' then
      ok_count := ok_count + 1;
      results := results || jsonb_build_array(jsonb_build_object(
        'transaction_id', item->>'transaction_id',
        'ok', true,
        'cash_state', row_result->'data'->'cash_state',
        'undo_kind', 'line_cash'
      ));
      row_writes := row_writes || jsonb_build_array(jsonb_build_object(
        'ordinal', ord,
        'transaction_id', item->>'transaction_id',
        'undo_kind', 'line_cash',
        'undo_id', row_result->'data'->>'id',
        'write_id', row_result->'data'->>'write_id'
      ));
    else
      error_count := error_count + 1;
      results := results || jsonb_build_array(jsonb_build_object(
        'transaction_id', coalesce(
          case when jsonb_typeof(item) = 'object' then item->>'transaction_id' end,
          '00000000-0000-4000-8000-000000000000'
        ),
        'ok', false,
        'code', coalesce(row_result->'error'->>'code', 'refused')
      ));
    end if;
  end loop;

  response := jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'batch_key', batch_id,
      'ok_count', ok_count,
      'error_count', error_count,
      'results', results
    )
  );

  insert into private.mcp_batches (id, token_id, user_id, company_id, idempotency_key, row_writes)
  values (batch_id, token, auth.uid(), private.current_company_id(), p_idempotency_key, row_writes);

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

create or replace function public.mcp_set_cash_basis(p_idempotency_key text, p_basis text)
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
  before text;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_basis is null
    or p_basis not in ('paid', 'invoice')
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'cash_basis|' || p_basis;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  begin
    select c.cash_basis into before
    from public.companies c
    where c.id = cid
    for update;

    if not found then
      response := private.mcp_refused('no company');
    else
      perform public.set_cash_basis(p_basis);
      insert into private.mcp_writes (token_id, user_id, kind, company_id, prior, created_at)
      values (
        token, auth.uid(), 'cash_basis', cid,
        jsonb_build_object('before', before, 'written', p_basis),
        clock_timestamp()
      );
      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
          'basis', p_basis,
          'prior_basis', before,
          'undo_kind', 'cash_basis',
          'id', cid
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

revoke all on function public.mcp_set_category_cash(text, uuid, boolean) from public, anon;
revoke all on function public.mcp_set_line_cash(text, uuid, boolean) from public, anon;
revoke all on function public.mcp_set_lines_cash(text, jsonb) from public, anon;
revoke all on function public.mcp_set_cash_basis(text, text) from public, anon;
grant execute on function public.mcp_set_category_cash(text, uuid, boolean) to authenticated, service_role;
grant execute on function public.mcp_set_line_cash(text, uuid, boolean) to authenticated, service_role;
grant execute on function public.mcp_set_lines_cash(text, jsonb) to authenticated, service_role;
grant execute on function public.mcp_set_cash_basis(text, text) to authenticated, service_role;

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- The three undo kinds on mcp_writes, mcp_undo and undo_batch.
do $undo$
declare
  def text;
  anchor text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'jev_mode'::text$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, anchor || $n$, 'category_cash'::text, 'line_cash'::text, 'cash_basis'::text$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if pg_temp.anchor_count(def, $a$kind = 'jev_mode'::text$a$) <> 1 or right(def, 2) <> '))' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'category_cash'::text) AND (category_id IS NOT NULL) AND (prior ? 'before'::text) AND (prior ? 'written'::text))$n$
    || $n$ OR ((kind = 'line_cash'::text) AND (transaction_id IS NOT NULL) AND (prior ? 'before'::text) AND (prior ? 'written'::text))$n$
    || $n$ OR ((kind = 'cash_basis'::text) AND (company_id IS NOT NULL) AND (prior ? 'before'::text) AND (prior ? 'written'::text))))$n$;

  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  anchor := 'p_kind not in (';
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, anchor, $n$p_kind not in ('category_cash', 'line_cash', 'cash_basis', $n$);

  anchor := $a$(p_kind = 'review' and w.kind = 'review' and w.review_id = p_id)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo match is not the expected definition';
  end if;
  def := replace(def, anchor, $n$(p_kind = 'category_cash' and w.kind = 'category_cash' and w.category_id = p_id)
        or (p_kind = 'line_cash' and w.kind = 'line_cash' and w.transaction_id = p_id)
        or (p_kind = 'cash_basis' and w.kind = 'cash_basis' and w.company_id = p_id)
        or $n$ || anchor);

  anchor := $a$    elsif p_kind = 'company' then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo branches are not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind in ('category_cash', 'line_cash', 'cash_basis') then
      -- FLOW-413. A value changed since the write is a conflict; else the owner's own setter
      -- puts back the value from before.
      declare
        cur jsonb;
      begin
        if p_kind = 'category_cash' then
          select coalesce(to_jsonb(c.in_cash), 'null'::jsonb) into cur
          from public.categories c
          where c.id = p_id and c.company_id = cid
          for update;
        elsif p_kind = 'line_cash' then
          select coalesce(to_jsonb(t.in_cash_override), 'null'::jsonb) into cur
          from public.transactions t
          where t.id = p_id and t.company_id = cid and t.removed_at is null
          for update;
        else
          select coalesce(to_jsonb(c.cash_basis), 'null'::jsonb) into cur
          from public.companies c
          where c.id = p_id and c.id = cid
          for update;
        end if;
        if not found then
          response := private.mcp_error('not_found', 'not found');
        elsif cur is distinct from rec.prior->'written' then
          response := private.mcp_error('conflict', 'conflict');
        else
          if p_kind = 'category_cash' then
            perform public.set_category_cash(p_id, (rec.prior->>'before')::boolean);
          elsif p_kind = 'line_cash' then
            perform public.set_transaction_cash(p_id, (rec.prior->>'before')::boolean);
          else
            perform public.set_cash_basis(rec.prior->>'before');
          end if;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        end if;
      end;
$n$ || anchor);
  execute def;

  -- undo_batch undoes a set_lines_cash row by its own write, as it does set_lines_pnl's.
  def := pg_get_functiondef('public.mcp_undo_batch(text,text)'::regprocedure);
  anchor := $a$undo_kind in ('line_split', 'line_pnl')$a$;
  if pg_temp.anchor_count(def, anchor) <> 2 then
    raise exception 'mcp_undo_batch is not the expected definition';
  end if;
  execute replace(def, anchor, $n$undo_kind in ('line_split', 'line_pnl', 'line_cash')$n$);
end
$undo$;

drop function pg_temp.anchor_count(text, text);

commit;
