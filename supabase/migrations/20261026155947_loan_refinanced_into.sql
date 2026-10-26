-- FLOW-962 (owner, 2026-10-26; decision 0214): a loan closed for a refinance can name the loan that
-- replaced it.
-- 1. public.loans gains refinanced_into_id: another loan of the same company, or null. It never names
--    the loan itself. Deleting the new loan clears the link (on delete set null). RLS is the loans
--    table's own: the column is read and written with the row.
-- 2. MCP set_loan_refinance names or clears the link (undo kind loan_refinance puts back what it was
--    while the link still reads as written).
--    It refuses (validation) a loan that is still open, the loan itself, and a two-loan cycle.
-- 3. mcp_list_loans returns refinanced_into_id.
-- 4. Reopening clears the link, in mcp_update_loan as in the app; its undo (loan_update) puts the link
--    back while the loan it named still exists and the link is still empty.
-- 5. delete_loan keeps, in its snapshot, the loans that named the deleted one ('referrers'), and
--    loan_restore relinks them while they are still unlinked; a restored loan whose new loan was
--    deleted since comes back with no link, as on delete set null would have left it.
-- mcp_undo, mcp_list_loans, mcp_update_loan, delete_loan, loan_restore and the mcp_writes
-- constraints are patched in place with counted anchors, as in 20261025160000_transaction_thread.sql.
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
  cur_status public.loan_status;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_loan_id is null
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
    select l.refinanced_into_id, l.status into cur, cur_status
    from public.loans l
    where l.id = p_loan_id and l.company_id = cid
    for no key update;

    if not found then
      response := private.mcp_refused('loan not found');
    elsif p_new_loan_id is not null and not exists (
      select 1 from public.loans n where n.id = p_new_loan_id and n.company_id = cid
    ) then
      response := private.mcp_refused('loan not found');
    elsif p_new_loan_id = p_loan_id
      -- After the lookups, so another company's loan reads as not found before the shape checks.
      -- Only a closed loan names a new one, and two loans never name each other.
      or (p_new_loan_id is not null and cur_status = 'open'::public.loan_status)
      or exists (
        select 1 from public.loans n
        where n.id = p_new_loan_id and n.company_id = cid and n.refinanced_into_id = p_loan_id
      )
    then
      response := private.mcp_error('validation', 'validation');
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

-- mcp_update_loan: reopening clears the link, and the write keeps the link it had for the undo.
do $update$
declare
  def text;
  a_before constant text := $a$      before := jsonb_build_object(
        'name', cur.name,$a$;
  a_set constant text := $a$        closed_on = new_closed,$a$;
begin
  def := pg_get_functiondef('public.mcp_update_loan(text,uuid,jsonb)'::regprocedure);
  if pg_temp.anchor_count(def, a_before) <> 1 or pg_temp.anchor_count(def, a_set) <> 1 then
    raise exception 'mcp_update_loan is not the expected definition';
  end if;
  def := replace(def, a_before, $n$      before := jsonb_build_object(
        'refinanced_into_id', (select rf.refinanced_into_id from public.loans rf where rf.id = p_loan_id and rf.company_id = cid),
        'name', cur.name,$n$);
  def := replace(def, a_set, a_set || $n$
        refinanced_into_id = case when new_status = 'open'::public.loan_status then null else l.refinanced_into_id end,$n$);
  execute def;
end
$update$;

-- mcp_undo (loan_update): a reopen's undo puts the link back while the loan it named still exists
-- and the link is still empty.
do $undo_update$
declare
  def text;
  anchor constant text := $a$          closed_on = case when before ? 'status'
            then (before->>'closed_on')::date else l.closed_on end,$a$;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo loan_update is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
          refinanced_into_id = case
            when l.refinanced_into_id is null and exists (
              select 1 from public.loans rf
              where rf.id = (before->>'refinanced_into_id')::uuid and rf.company_id = cid and rf.id <> l.id
            )
            then (before->>'refinanced_into_id')::uuid
            else l.refinanced_into_id
          end,$n$);
  execute def;
end
$undo_update$;

-- delete_loan: the loans that named the deleted one, kept before on delete set null clears them.
do $delete$
declare
  def text;
  a_declare constant text := $a$  deletion uuid;
begin$a$;
  a_delete constant text := $a$  -- The parts and rates go with the loan (on delete cascade).$a$;
  a_snapshot constant text := $a$jsonb_build_object('loan', to_jsonb(loan_row), 'rates', rates, 'parts', parts))$a$;
begin
  def := pg_get_functiondef('public.delete_loan(uuid)'::regprocedure);
  if pg_temp.anchor_count(def, a_declare) <> 1 or pg_temp.anchor_count(def, a_delete) <> 1
    or pg_temp.anchor_count(def, a_snapshot) <> 1 then
    raise exception 'delete_loan is not the expected definition';
  end if;
  def := replace(def, a_declare, $n$  deletion uuid;
  referrers jsonb;
begin$n$);
  def := replace(def, a_delete, $n$  -- FLOW-962: the loans that name this one as their refinance, for the restore to relink.
  select coalesce(jsonb_agg(r.id order by r.id), '[]'::jsonb)
  into referrers
  from public.loans r
  where r.company_id = cid and r.refinanced_into_id = p_loan_id;

$n$ || a_delete);
  def := replace(def, a_snapshot,
    $n$jsonb_build_object('loan', to_jsonb(loan_row), 'rates', rates, 'parts', parts, 'referrers', referrers))$n$);
  execute def;
end
$delete$;

-- loan_restore: no link to a loan deleted since; relink the loans that named this one.
do $restore$
declare
  def text;
  a_fees constant text := $a$    loan_row.fees_category_id := null;
  end if;$a$;
  a_checks constant text := $a$  foreach line in array lines loop
    perform private.loan_splits_check(line);
  end loop;$a$;
begin
  def := pg_get_functiondef('private.loan_restore(uuid,jsonb)'::regprocedure);
  if pg_temp.anchor_count(def, a_fees) <> 1 or pg_temp.anchor_count(def, a_checks) <> 1 then
    raise exception 'loan_restore is not the expected definition';
  end if;
  def := replace(def, a_fees, a_fees || $n$
  -- FLOW-962: a new loan deleted since leaves no link, as its on delete set null would have.
  if loan_row.refinanced_into_id is not null and not exists (
    select 1 from public.loans l where l.id = loan_row.refinanced_into_id and l.company_id = p_company_id
  ) then
    loan_row.refinanced_into_id := null;
  end if;$n$);
  def := replace(def, a_checks, a_checks || $n$
  -- FLOW-962: the loans that named this one before the delete, while they are still unlinked.
  update public.loans l
  set refinanced_into_id = loan_row.id
  where l.company_id = p_company_id
    and l.refinanced_into_id is null
    and l.id <> loan_row.id
    and l.id in (
      select e.value::uuid from jsonb_array_elements_text(coalesce(p_snapshot->'referrers', '[]'::jsonb)) e
    );$n$);
  execute def;
end
$restore$;

drop function pg_temp.anchor_count(text, text);

commit;
