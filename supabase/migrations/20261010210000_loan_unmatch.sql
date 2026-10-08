-- FLOW-114 (loan match server items). Decision 0137.
-- 1. public.clear_loan_split(transaction): the owner takes a loan payment off its loan in one
--    call (the app's unmatch). The line keeps its project and category and counts whole again.
-- 2. public.mcp_detach_loan_payment: the same for MCP (idempotency key, write rate limit),
--    with undo kind loan_detach, which puts the parts back as they were.
-- 3. get_transaction returns loan_split (what get_loan_split returns), so the transaction
--    screen and MCP get_expense need no second read.
-- mcp_undo, mcp_refused, the mcp_writes checks and get_transaction are patched from their
-- current definitions, with counted anchors, so changes merged since stay.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- How many times an anchor appears in a text (each patch below needs an exact count).
create function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

create or replace function public.clear_loan_split(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  attached uuid;
  removed jsonb;
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (select 1 from public.company_viewers v where v.user_id = (select auth.uid())) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_transaction_id is null then
    raise exception 'validation';
  end if;

  select s.loan_id into attached
  from public.loan_splits s
  where s.transaction_id = p_transaction_id and s.company_id = cid
  limit 1;

  -- The loan first, then the line: the order every loan split write takes (no deadlock).
  if attached is not null then
    perform 1 from public.loans l where l.id = attached and l.company_id = cid for update;
  end if;
  perform 1
  from public.transactions t
  where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null
  for update;
  if not found then
    raise exception 'transaction not found';
  end if;
  -- Attached or detached by another write while this one waited for the locks: the caller
  -- retries (40001 is a retry, not a refusal, so MCP does not store it under its key).
  if (select s.loan_id from public.loan_splits s
      where s.transaction_id = p_transaction_id and s.company_id = cid limit 1)
     is distinct from attached then
    raise exception 'loan split changed' using errcode = '40001';
  end if;

  with gone as (
    delete from public.loan_splits s
    where s.transaction_id = p_transaction_id
      and s.company_id = cid
      and s.loan_id = attached
    returning s.loan_id, s.part, s.amount_minor, s.scheduled_minor, s.category_id, s.needs_review
  )
  select jsonb_agg(jsonb_build_object(
    'part', g.part,
    'amount_minor', g.amount_minor,
    'scheduled_minor', g.scheduled_minor,
    'category_id', g.category_id,
    'needs_review', g.needs_review
  ) order by g.part)
  into removed
  from gone g;

  if removed is null then
    raise exception 'line has no loan split';
  end if;

  return jsonb_build_object(
    'transaction_id', p_transaction_id,
    'loan_id', attached,
    'parts', removed
  );
end;
$$;

revoke all on function public.clear_loan_split(uuid) from public, anon, authenticated, service_role;
grant execute on function public.clear_loan_split(uuid) to authenticated;

comment on function public.clear_loan_split(uuid) is
  'Takes a loan payment off its loan (owner only). Returns the removed parts. Decision 0137.';

create or replace function public.mcp_detach_loan_payment(
  p_idempotency_key text,
  p_transaction_id uuid
)
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
  removed jsonb;
  response jsonb;
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
  hash := 'loan_detach|' || p_transaction_id::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  begin
    removed := public.clear_loan_split(p_transaction_id);
    -- clock_timestamp, as the other writes, so two detaches of one line undo newest first.
    insert into private.mcp_writes (token_id, user_id, loan_id, transaction_id, kind, prior, created_at)
    values (
      token, auth.uid(), (removed->>'loan_id')::uuid, p_transaction_id, 'loan_detach',
      jsonb_build_object('parts', removed->'parts'),
      clock_timestamp()
    );
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'transaction_id', p_transaction_id,
        'loan_id', removed->'loan_id',
        'parts', (
          select jsonb_agg(jsonb_build_object('part', e.value->'part', 'amount_minor', e.value->'amount_minor')
            order by case e.value->>'part' when 'interest' then 0 when 'escrow' then 1 when 'principal' then 2 else 3 end)
          from jsonb_array_elements(removed->'parts') e
        ),
        'undo_kind', 'loan_detach',
        'id', p_transaction_id
      )
    );
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

revoke all on function public.mcp_detach_loan_payment(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_detach_loan_payment(text, uuid) to authenticated;

do $patch$
declare
  def text;
  anchor text;
begin
  -- private.mcp_writes: the loan_detach kind keeps the loan, the line and the parts.
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'invoice_paid'::text$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, anchor || $n$, 'loan_detach'::text$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if pg_temp.anchor_count(def, $a$kind = 'invoice_paid'::text$a$) <> 1 or right(def, 2) <> '))' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'loan_detach'::text) AND (loan_id IS NOT NULL) AND (transaction_id IS NOT NULL) AND (prior ? 'parts'::text))))$n$;

  -- private.mcp_refused: the unmatch refusal.
  def := pg_get_functiondef('private.mcp_refused(text)'::regprocedure);
  anchor := $a$'invoice not found'$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_refused is not the expected definition';
  end if;
  execute replace(def, anchor, anchor || $n$,
        -- FLOW-114 (decision 0137).
        'line has no loan split'$n$);

  -- public.mcp_undo: kind loan_detach puts the parts back.
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  anchor := $a$'line_pnl', 'loan_rate', 'invoice_paid'$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$, 'loan_detach'$n$);

  anchor := $a$or (p_kind = 'invoice_paid' and w.kind = 'invoice_paid' and w.transaction_id = p_id)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo lookup is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
        or (p_kind = 'loan_detach' and w.kind = 'loan_detach' and w.transaction_id = p_id)$n$);

  anchor := $a$    elsif p_kind = 'loan_split' then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo loan_split branch is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'loan_detach' then
      -- The loan first, then the line, as every loan split write.
      select l.kind, l.start_date into cur_loan
      from public.loans l
      where l.id = rec.loan_id and l.company_id = cid
      for update;
      cur_found := found;
      if cur_found then
        select t.doc_date into written
        from (
          select to_jsonb(t.doc_date) as doc_date
          from public.transactions t
          where t.id = p_id and t.company_id = cid and t.removed_at is null
          for update
        ) t;
        cur_found := written is not null;
      end if;
      if not cur_found then
        response := private.mcp_error('not_found', 'not found');
      elsif exists (
        select 1 from public.loan_splits s where s.transaction_id = p_id and s.company_id = cid
      ) then
        -- Matched again since (to this loan or another): leave it.
        response := private.mcp_error('conflict', 'conflict');
      elsif cur_loan.kind = 'demand'::public.loan_kind and (
        -- The demand order rules save_loan_split and attach_loan_payment apply (0132): interest
        -- runs from the last payment, so a payment attached since with a later date, or a
        -- start moved past this line, leaves no room to put this one back.
        (written #>> '{}')::date < cur_loan.start_date
        or exists (
          select 1
          from public.loan_splits s
          join public.transactions t on t.id = s.transaction_id and t.company_id = s.company_id
          where s.loan_id = rec.loan_id
            and s.company_id = cid
            and t.removed_at is null
            and not s.needs_review
            and t.doc_date > (written #>> '{}')::date
        )
      ) then
        response := private.mcp_error('conflict', 'conflict');
      else
        -- The line or the loan may have changed since (amount, balance, a part's category):
        -- parts that no longer fit are not put back, and the undo is a conflict.
        begin
          insert into public.loan_splits (
            company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id,
            needs_review
          )
          select cid, rec.loan_id, p_id, (e.value->>'part')::public.loan_split_part,
            (e.value->>'amount_minor')::bigint, (e.value->>'scheduled_minor')::bigint,
            (e.value->>'category_id')::uuid, coalesce((e.value->>'needs_review')::boolean, false)
          from jsonb_array_elements(rec.prior->'parts') e;
          perform private.loan_splits_check(p_id);
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id, 'loan_id', rec.loan_id)
          );
        exception
          when check_violation or foreign_key_violation or unique_violation then
            response := private.mcp_error('conflict', 'conflict');
        end;
      end if;
$n$ || anchor);
  execute def;

  -- get_transaction: the loan split, as get_loan_split returns it.
  def := pg_get_functiondef('public.get_transaction(uuid)'::regprocedure);
  anchor := $a$'pnl_state', private.line_pnl_state(t.id),$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'get_transaction is not the expected definition';
  end if;
  execute replace(def, anchor, $n$'loan_split', public.get_loan_split(t.id),
    $n$ || anchor);
end
$patch$;

drop function pg_temp.anchor_count(text, text);

commit;
