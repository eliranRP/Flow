-- FLOW-962 (owner, 2026-10-26; decision 0214): a loan closed for a refinance can name the loan that
-- replaced it.
-- 1. public.loans gains refinanced_into_id: another loan of the same company, or null. It never names
--    the loan itself. Deleting the new loan clears the link (on delete set null). RLS is the loans
--    table's own: the column is read and written with the row.
-- 2. MCP set_loan_refinance names or clears the link (undo kind loan_refinance puts back what it was
--    while the link still reads as written).
-- 3. mcp_list_loans returns refinanced_into_id.
-- mcp_undo, mcp_list_loans and the mcp_writes constraints are patched in place with counted anchors,
-- as in 20261025160000_transaction_thread.sql.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

alter table public.loans
  add column refinanced_into_id uuid,
  add constraint loans_refinanced_into_fkey foreign key (company_id, refinanced_into_id)
    references public.loans (company_id, id) on delete set null (refinanced_into_id),
  add constraint loans_refinanced_into_chk check (refinanced_into_id is null or refinanced_into_id <> id);

comment on column public.loans.refinanced_into_id is
  'FLOW-962: the loan that replaced this one in a refinance (same company), or null. Decision 0214.';

create index loans_refinanced_into_idx on public.loans (company_id, refinanced_into_id)
  where refinanced_into_id is not null;

create function public.mcp_set_loan_refinance(
  p_idempotency_key text,
  p_loan_id uuid,
  p_new_loan_id uuid
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
  cur uuid;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_loan_id is null
    or p_new_loan_id = p_loan_id
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'loan_refinance|' || p_loan_id::text || '|' || coalesce(p_new_loan_id::text, 'null');
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
    select l.refinanced_into_id into cur
    from public.loans l
    where l.id = p_loan_id and l.company_id = cid
    for no key update;

    if not found then
      response := private.mcp_refused('loan not found');
    elsif p_new_loan_id is not null and not exists (
      select 1 from public.loans n where n.id = p_new_loan_id and n.company_id = cid
    ) then
      response := private.mcp_refused('loan not found');
    else
      update public.loans l
      set refinanced_into_id = p_new_loan_id
      where l.id = p_loan_id and l.company_id = cid;

      insert into private.mcp_writes (token_id, user_id, kind, loan_id, prior, created_at)
      values (token, auth.uid(), 'loan_refinance', p_loan_id,
        jsonb_build_object(
          'before', jsonb_build_object('refinanced_into_id', cur),
          'after', jsonb_build_object('refinanced_into_id', p_new_loan_id)
        ), clock_timestamp());

      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
          'loan_id', p_loan_id,
          'refinanced_into_id', p_new_loan_id,
          'previous', jsonb_build_object('refinanced_into_id', cur),
          'undo_kind', 'loan_refinance'
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

revoke all on function public.mcp_set_loan_refinance(text, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_set_loan_refinance(text, uuid, uuid) to authenticated;
comment on function public.mcp_set_loan_refinance(text, uuid, uuid) is
  'MCP set_loan_refinance: name the loan that replaced this one in a refinance, or clear it (undo kind loan_refinance). Decision 0214.';

-- private.mcp_writes: the loan_refinance kind, and what its undo reads.
do $kinds$
declare
  def text;
  anchor text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'file_remove'::text])$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, $n$'file_remove'::text, 'loan_refinance'::text])$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if right(def, 2) <> '))' or position($a$(kind = 'file_remove'::text)$a$ in def) = 0 then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'loan_refinance'::text) AND (loan_id IS NOT NULL) AND (prior ? 'before'::text) AND (prior ? 'after'::text))))$n$;
end
$kinds$;

-- mcp_undo: the kind in the allowed list and the lookup, and its branch.
do $undo$
declare
  def text;
  a_kinds constant text := $a$'note_add', 'note_edit', 'note_remove', 'file_remove'
    )$a$;
  a_lookup constant text := $a$        or (p_kind = 'file_remove' and w.kind = 'file_remove' and w.prior->>'file_id' = p_id::text)
      )$a$;
  a_branch constant text := $a$    elsif p_kind = 'book_line' then$a$;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, a_kinds) <> 1 or pg_temp.anchor_count(def, a_lookup) <> 1
    or pg_temp.anchor_count(def, a_branch) <> 1 then
    raise exception 'mcp_undo is not the expected definition';
  end if;

  def := replace(def, a_kinds, $n$'note_add', 'note_edit', 'note_remove', 'file_remove', 'loan_refinance'
    )$n$);
  def := replace(def, a_lookup, $n$        or (p_kind = 'file_remove' and w.kind = 'file_remove' and w.prior->>'file_id' = p_id::text)
        or (p_kind = 'loan_refinance' and w.kind = 'loan_refinance' and w.loan_id = p_id)
      )$n$);
  def := replace(def, a_branch, $n$    elsif p_kind = 'loan_refinance' then
      -- FLOW-962. The link goes back while it still reads as the write left it.
      declare
        link uuid;
      begin
        select l.refinanced_into_id into link
        from public.loans l
        where l.id = p_id and l.company_id = cid
        for no key update;
        if not found then
          response := private.mcp_error('not_found', 'not found');
        elsif link is distinct from (rec.prior->'after'->>'refinanced_into_id')::uuid then
          response := private.mcp_error('conflict', 'conflict');
        elsif rec.prior->'before'->>'refinanced_into_id' is not null and not exists (
          select 1 from public.loans n
          where n.id = (rec.prior->'before'->>'refinanced_into_id')::uuid and n.company_id = cid
        ) then
          response := private.mcp_error('conflict', 'conflict');
        else
          update public.loans l
          set refinanced_into_id = (rec.prior->'before'->>'refinanced_into_id')::uuid
          where l.id = p_id and l.company_id = cid;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object('ok', true, 'data', jsonb_build_object('kind', p_kind, 'id', p_id));
        end if;
      end;
$n$ || a_branch);
  execute def;
end
$undo$;

-- mcp_list_loans: the link.
do $list$
declare
  def text;
  anchor text := $a$'rate_margin_ppm', l.rate_margin_ppm,$a$;
begin
  def := pg_get_functiondef('public.mcp_list_loans()'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_list_loans is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
    'refinanced_into_id', l.refinanced_into_id,$n$);
  execute def;
end
$list$;

drop function pg_temp.anchor_count(text, text);

commit;
