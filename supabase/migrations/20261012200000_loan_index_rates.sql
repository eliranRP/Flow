-- FLOW-137 (Flow MCP agent request, decision 0160): prime-linked loan rates.
-- 1. public.loans gains rate_index ('il_prime', the Bank of Israel prime rate) and
--    rate_margin_ppm (the loan's margin over that index, may be negative). Both or neither.
-- 2. MCP set_loan_index links a loan to an index with its margin, or unlinks it (undo kind
--    loan_index puts back what it was while the link still reads as written).
-- 3. MCP set_index_rate records a new index rate from a date: every loan linked to that index
--    gets a loan_rates row on that date at index plus margin (clamped to 0..100%), the same row
--    set_loan_rate writes. A loan that starts after the date is skipped and listed. One undo
--    (kind index_rate, the write id) puts every row back, all or nothing: a conflict when any
--    of those rows changed since.
-- 4. mcp_list_loans shows rate_index and rate_margin_ppm.
-- The numbers stay in SQL; the index value is what the caller enters (decision 0084).
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

alter table public.loans
  add column rate_index text,
  add column rate_margin_ppm integer,
  add constraint loans_rate_index_chk check (rate_index is null or rate_index in ('il_prime')),
  add constraint loans_rate_index_margin_chk check ((rate_index is null) = (rate_margin_ppm is null)),
  add constraint loans_rate_margin_chk check (
    rate_margin_ppm is null or (rate_margin_ppm >= -1000000 and rate_margin_ppm <= 1000000)
  );

comment on column public.loans.rate_index is
  'FLOW-137: the index this loan''s rate follows (il_prime), or null. set_index_rate writes its dated rates.';
comment on column public.loans.rate_margin_ppm is
  'FLOW-137: the margin over rate_index in ppm (8250 = 0.825%), may be negative; set with rate_index.';

create index loans_rate_index_idx on public.loans (company_id, rate_index) where rate_index is not null;

create function public.mcp_set_loan_index(
  p_idempotency_key text,
  p_loan_id uuid,
  p_rate_index text,
  p_margin_ppm integer
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
  cid uuid;
  response jsonb;
  cur record;
  before jsonb;
  after jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_loan_id is null
    or (p_rate_index is null) <> (p_margin_ppm is null)
    or (p_rate_index is not null
      and (p_rate_index <> 'il_prime' or p_margin_ppm < -1000000 or p_margin_ppm > 1000000))
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'loan_index|' || p_loan_id::text || '|' || coalesce(p_rate_index, 'null') || '|'
    || coalesce(p_margin_ppm::text, 'null');
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
    select l.rate_index, l.rate_margin_ppm into cur
    from public.loans l
    where l.id = p_loan_id and l.company_id = cid
    for no key update;

    if not found then
      response := private.mcp_refused('loan not found');
    else
      before := jsonb_build_object('rate_index', cur.rate_index, 'rate_margin_ppm', cur.rate_margin_ppm);
      after := jsonb_build_object('rate_index', p_rate_index, 'rate_margin_ppm', p_margin_ppm);
      update public.loans l
      set rate_index = p_rate_index, rate_margin_ppm = p_margin_ppm
      where l.id = p_loan_id and l.company_id = cid;

      insert into private.mcp_writes (token_id, user_id, kind, loan_id, prior, created_at)
      values (token, auth.uid(), 'loan_index', p_loan_id,
        jsonb_build_object('before', before, 'after', after), clock_timestamp());

      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
          'loan_id', p_loan_id,
          'rate_index', p_rate_index,
          'rate_margin_ppm', p_margin_ppm,
          'previous', before,
          'undo_kind', 'loan_index'
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

revoke all on function public.mcp_set_loan_index(text, uuid, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_set_loan_index(text, uuid, text, integer) to authenticated;
comment on function public.mcp_set_loan_index(text, uuid, text, integer) is
  'MCP set_loan_index: link a loan to a rate index with its margin, or unlink it (undo kind loan_index). Decision 0160.';

create function public.mcp_set_index_rate(
  p_idempotency_key text,
  p_rate_index text,
  p_effective_date date,
  p_annual_rate_ppm integer
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
  cid uuid;
  response jsonb;
  loan record;
  cur record;
  target integer;
  rate_id uuid;
  written_rows jsonb := '[]'::jsonb;
  shown jsonb := '[]'::jsonb;
  skipped jsonb := '[]'::jsonb;
  write_id uuid;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_rate_index is distinct from 'il_prime'
    or p_effective_date is null
    or p_annual_rate_ppm is null
    or p_annual_rate_ppm < 0
    or p_annual_rate_ppm > 1000000
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'index_rate|' || p_rate_index || '|' || p_effective_date::text || '|' || p_annual_rate_ppm::text;
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
    -- The loans first, in id order, as every loan write does (0121); then each rate row.
    for loan in
      select l.id, l.name, l.start_date, l.rate_margin_ppm
      from public.loans l
      where l.company_id = cid and l.rate_index = p_rate_index
      order by l.id
      for no key update
    loop
      if p_effective_date < loan.start_date then
        skipped := skipped || jsonb_build_object(
          'loan_id', loan.id, 'name', loan.name, 'reason', 'rate before the loan start');
        continue;
      end if;
      target := greatest(0, least(1000000, p_annual_rate_ppm + loan.rate_margin_ppm));

      select r.id, r.annual_rate_ppm into cur
      from public.loan_rates r
      where r.loan_id = loan.id and r.effective_date = p_effective_date
      for update;

      if not found then
        insert into public.loan_rates (company_id, loan_id, effective_date, annual_rate_ppm)
        values (cid, loan.id, p_effective_date, target)
        returning id into rate_id;
      else
        rate_id := cur.id;
        update public.loan_rates set annual_rate_ppm = target where id = cur.id;
      end if;

      written_rows := written_rows || jsonb_build_object(
        'loan_id', loan.id, 'rate_id', rate_id,
        'before', cur.annual_rate_ppm, 'written', target);
      shown := shown || jsonb_build_object(
        'loan_id', loan.id, 'name', loan.name, 'rate_id', rate_id,
        'annual_rate_ppm', target, 'previous_rate_ppm', cur.annual_rate_ppm);
    end loop;

    if jsonb_array_length(written_rows) = 0 then
      response := private.mcp_refused(
        case when jsonb_array_length(skipped) = 0 then 'no loan linked to this index'
        else 'every linked loan starts after this date' end);
    else
      insert into private.mcp_writes (token_id, user_id, kind, company_id, prior, created_at)
      values (
        token, auth.uid(), 'index_rate', cid,
        jsonb_build_object(
          'rate_index', p_rate_index,
          'effective_date', p_effective_date,
          'index_rate_ppm', p_annual_rate_ppm,
          'rows', written_rows
        ),
        clock_timestamp()
      )
      returning id into write_id;

      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
          'id', write_id,
          'rate_index', p_rate_index,
          'effective_date', p_effective_date,
          'index_rate_ppm', p_annual_rate_ppm,
          'loans', shown,
          'skipped', skipped,
          'undo_kind', 'index_rate'
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

revoke all on function public.mcp_set_index_rate(text, text, date, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_set_index_rate(text, text, date, integer) to authenticated;
comment on function public.mcp_set_index_rate(text, text, date, integer) is
  'MCP set_index_rate: a dated index rate written as index plus margin on every linked loan (undo kind index_rate, all or nothing). Decision 0160.';

do $patch$
declare
  def text;
  anchor text;
begin
  -- private.mcp_writes: the loan_index and index_rate kinds.
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'jev_mode'::text$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, anchor || $n$, 'loan_index'::text, 'index_rate'::text$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if pg_temp.anchor_count(def, $a$kind = 'jev_mode'::text$a$) <> 1 or right(def, 2) <> '))' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'loan_index'::text) AND (loan_id IS NOT NULL) AND (prior ? 'before'::text) AND (prior ? 'after'::text))$n$
    || $n$ OR ((kind = 'index_rate'::text) AND (company_id IS NOT NULL) AND (prior ? 'effective_date'::text) AND (prior ? 'rows'::text))))$n$;

  -- public.mcp_undo: the two kinds.
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  anchor := $a$'jev_mode'
    )$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, anchor, $n$'jev_mode', 'loan_index', 'index_rate'
    )$n$);

  anchor := $a$        or (p_kind = 'jev_mode' and w.kind = 'jev_mode' and w.company_id = p_id)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo lookup is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
        or (p_kind = 'loan_index' and w.kind = 'loan_index' and w.loan_id = p_id)
        or (p_kind = 'index_rate' and w.kind = 'index_rate' and w.id = p_id)$n$);

  anchor := $a$    elsif p_kind = 'jev_mode' then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo jev_mode branch is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'loan_index' then
      declare
        link record;
      begin
        select l.rate_index, l.rate_margin_ppm into link
        from public.loans l
        where l.id = p_id and l.company_id = cid
        for no key update;
        if not found then
          response := private.mcp_error('not_found', 'not found');
        elsif jsonb_build_object('rate_index', link.rate_index, 'rate_margin_ppm', link.rate_margin_ppm)
            is distinct from rec.prior->'after' then
          response := private.mcp_error('conflict', 'conflict');
        else
          update public.loans l
          set rate_index = rec.prior->'before'->>'rate_index',
              rate_margin_ppm = (rec.prior->'before'->>'rate_margin_ppm')::integer
          where l.id = p_id and l.company_id = cid;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        end if;
      end;
    elsif p_kind = 'index_rate' then
      -- All or nothing: every row must still hold what the write put there.
      declare
        row_item record;
        held integer;
        changed boolean := false;
        on_date date := (rec.prior->>'effective_date')::date;
      begin
        perform 1 from public.loans l
        where l.company_id = cid
          and l.id in (select (x->>'loan_id')::uuid from jsonb_array_elements(rec.prior->'rows') x)
        order by l.id
        for no key update;
        for row_item in select x.value as item from jsonb_array_elements(rec.prior->'rows') x loop
          select r.annual_rate_ppm into held
          from public.loan_rates r
          where r.company_id = cid
            and r.loan_id = (row_item.item->>'loan_id')::uuid
            and r.effective_date = on_date
          for update;
          if not found or held is distinct from (row_item.item->>'written')::integer then
            changed := true;
          end if;
        end loop;
        if changed then
          response := private.mcp_error('conflict', 'conflict');
        else
          for row_item in select x.value as item from jsonb_array_elements(rec.prior->'rows') x loop
            if row_item.item->>'before' is null then
              delete from public.loan_rates r
              where r.company_id = cid
                and r.loan_id = (row_item.item->>'loan_id')::uuid
                and r.effective_date = on_date;
            else
              update public.loan_rates r
              set annual_rate_ppm = (row_item.item->>'before')::integer
              where r.company_id = cid
                and r.loan_id = (row_item.item->>'loan_id')::uuid
                and r.effective_date = on_date;
            end if;
          end loop;
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

  -- private.mcp_refused: the two reasons set_index_rate gives.
  def := pg_get_functiondef('private.mcp_refused(text)'::regprocedure);
  anchor := $a$'a loan uses this category for a part the other category cannot take'
      ) then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_refused is not the expected definition';
  end if;
  def := replace(def, anchor, $n$'a loan uses this category for a part the other category cannot take',
        -- FLOW-137 (decision 0160).
        'no loan linked to this index',
        'every linked loan starts after this date'
      ) then$n$);
  execute def;

  -- mcp_list_loans: the index and margin.
  def := pg_get_functiondef('public.mcp_list_loans()'::regprocedure);
  anchor := $a$'amortization_months', l.amortization_months,$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_list_loans is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
    'rate_index', l.rate_index,
    'rate_margin_ppm', l.rate_margin_ppm,$n$);
  execute def;
end
$patch$;

drop function pg_temp.anchor_count(text, text);

commit;
