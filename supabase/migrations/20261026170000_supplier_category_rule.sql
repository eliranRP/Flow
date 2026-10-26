-- FLOW-965 (owner, 2026-10-26; decision 0216): after a line's category changes, the owner can file
-- the supplier's next lines the same way. That is the supplier's remembered category, which a sync
-- already gives a new expense line from that supplier (0063, 0064); until now only an approval in
-- לאישור could set it.
-- 1. public.remember_line_category(p_id, p_category_id) remembers the line's category for its supplier.
--    An expense line with a supplier and a category of its own only: not a split, a shared line or a
--    loan category. p_category_id is the category the caller saw on the line; 'conflict' when the line
--    holds another one by now (an undo of the pick still saving, another tab, an MCP edit). It returns
--    the prior remembered category, so ביטול can put it back.
-- 2. public.forget_line_category(p_supplier_id, p_category_id, p_prior_category_id) is that ביטול:
--    the prior category comes back while the supplier still remembers what the write left.
-- 3. MCP remember_supplier_category does the same (undo kind supplier_category).
-- mcp_undo and the mcp_writes constraints are patched in place with counted anchors, as in
-- 20261025160000_transaction_thread.sql. The anchors sit at the start of each list, so another
-- migration that appends a kind at the end does not move them.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- The write both callers share. Raises with the refusal's words; the callers turn them into errors.
create function private.remember_line_category(p_company uuid, p_id uuid, p_category_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  line record;
  cat record;
  prior uuid;
  supplier_name text;
begin
  select t.direction, t.supplier_id, t.category_id, t.pnl_role into line
  from public.transactions t
  where t.id = p_id and t.company_id = p_company and t.removed_at is null;
  if not found then
    raise exception 'transaction not found';
  end if;
  if line.direction <> 'expense' or line.supplier_id is null then
    raise exception 'the line has no supplier';
  end if;
  if line.category_id is null then
    raise exception 'the line has no category';
  end if;
  if line.category_id is distinct from p_category_id then
    raise exception 'conflict';
  end if;
  if line.pnl_role = 'shared'
    or exists (select 1 from public.line_splits s where s.transaction_id = p_id)
  then
    raise exception 'a split line is not remembered';
  end if;

  select c.id, c.name, c.kind, c.loan_part into cat
  from public.categories c
  where c.id = line.category_id and c.company_id = p_company;
  if not found or cat.kind::text <> 'expense' then
    raise exception 'category not found';
  end if;
  if cat.loan_part is not null then
    raise exception 'a loan category is not remembered';
  end if;

  select s.remembered_category_id, s.name into prior, supplier_name
  from public.suppliers s
  where s.id = line.supplier_id and s.company_id = p_company
  for no key update;

  update public.suppliers s
  set remembered_category_id = cat.id
  where s.id = line.supplier_id and s.company_id = p_company;

  return jsonb_build_object(
    'supplier_id', line.supplier_id,
    'supplier_name', supplier_name,
    'category_id', cat.id,
    'category_name', cat.name,
    'prior_category_id', prior
  );
end;
$$;

-- Puts the prior category back while the supplier still remembers p_category_id; 'conflict' once it
-- changed since. A prior category that is gone (deleted, not an expense category, or a loan category)
-- puts back null.
create function private.forget_line_category(p_company uuid, p_supplier_id uuid, p_category_id uuid, p_prior_category_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_category uuid;
  restored uuid;
begin
  select s.remembered_category_id into current_category
  from public.suppliers s
  where s.id = p_supplier_id and s.company_id = p_company
  for no key update;
  if not found then
    raise exception 'supplier not found';
  end if;
  if current_category is distinct from p_category_id then
    raise exception 'conflict';
  end if;
  select c.id into restored
  from public.categories c
  where c.id = p_prior_category_id and c.company_id = p_company and c.kind::text = 'expense'
    and c.loan_part is null;
  update public.suppliers s
  set remembered_category_id = restored
  where s.id = p_supplier_id and s.company_id = p_company;
  return jsonb_build_object('supplier_id', p_supplier_id, 'remembered_category_id', restored);
end;
$$;

revoke all on function private.remember_line_category(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.forget_line_category(uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;

create function public.remember_line_category(p_id uuid, p_category_id uuid)
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
  if p_id is null or p_category_id is null then
    raise exception 'validation';
  end if;
  return private.remember_line_category(cid, p_id, p_category_id);
end;
$$;

create function public.forget_line_category(p_supplier_id uuid, p_category_id uuid, p_prior_category_id uuid)
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
  return private.forget_line_category(cid, p_supplier_id, p_category_id, p_prior_category_id);
end;
$$;

revoke all on function public.remember_line_category(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.forget_line_category(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.remember_line_category(uuid, uuid) to authenticated;
grant execute on function public.forget_line_category(uuid, uuid, uuid) to authenticated;
comment on function public.remember_line_category(uuid, uuid) is
  'FLOW-965: remember the line''s category for its supplier, so the supplier''s next lines get it. Decision 0216.';
comment on function public.forget_line_category(uuid, uuid, uuid) is
  'FLOW-965: undo remember_line_category while the supplier still remembers what it wrote. Decision 0216.';

create function public.mcp_remember_supplier_category(p_idempotency_key text, p_transaction_id uuid, p_category_id uuid)
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
  done jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_transaction_id is null
    or p_category_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'supplier_category|' || p_transaction_id::text || '|' || p_category_id::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  begin
    done := private.remember_line_category(cid, p_transaction_id, p_category_id);
    insert into private.mcp_writes (token_id, user_id, kind, transaction_id, prior, created_at)
    values (token, auth.uid(), 'supplier_category', p_transaction_id,
      jsonb_build_object(
        'supplier_id', done->'supplier_id',
        'before', jsonb_build_object('remembered_category_id', done->'prior_category_id'),
        'after', jsonb_build_object('remembered_category_id', done->'category_id')
      ), clock_timestamp());
    response := jsonb_build_object(
      'ok', true,
      'data', done || jsonb_build_object('undo_kind', 'supplier_category', 'id', p_transaction_id)
    );
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := case
        when sqlerrm = 'conflict' then private.mcp_error('conflict', 'conflict')
        when sqlerrm in ('the line has no supplier', 'the line has no category', 'a split line is not remembered', 'a loan category is not remembered')
          then private.mcp_error('refused', sqlerrm)
        else private.mcp_refused(sqlerrm)
      end;
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_remember_supplier_category(text, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_remember_supplier_category(text, uuid, uuid) to authenticated;
comment on function public.mcp_remember_supplier_category(text, uuid, uuid) is
  'MCP remember_supplier_category: file the supplier''s next lines in this line''s category (undo kind supplier_category). Decision 0216.';

-- private.mcp_writes: the supplier_category kind, and what its undo reads.
do $kinds$
declare
  def text;
  anchor text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$(ARRAY['review'::text, $a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, $n$(ARRAY['supplier_category'::text, 'review'::text, $n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if right(def, 2) <> '))' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'supplier_category'::text) AND (transaction_id IS NOT NULL) AND (prior ? 'supplier_id'::text) AND (prior ? 'before'::text) AND (prior ? 'after'::text))))$n$;
end
$kinds$;

-- mcp_undo: the kind in the allowed list and the lookup, and its branch.
do $undo$
declare
  def text;
  a_kinds constant text := $a$p_kind not in ('recurring_match', $a$;
  a_lookup constant text := $a$        (p_kind = 'invite' and w.kind = 'invite' and w.prior->>'invite_id' = p_id::text)$a$;
  a_branch constant text := $a$    elsif p_kind in ('invite', 'member_role', 'member_remove') then$a$;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, a_kinds) <> 1 or pg_temp.anchor_count(def, a_lookup) <> 1
    or pg_temp.anchor_count(def, a_branch) <> 1 then
    raise exception 'mcp_undo is not the expected definition';
  end if;

  def := replace(def, a_kinds, $n$p_kind not in ('supplier_category', 'recurring_match', $n$);
  def := replace(def, a_lookup, $n$        (p_kind = 'supplier_category' and w.kind = 'supplier_category' and w.transaction_id = p_id)
        or (p_kind = 'invite' and w.kind = 'invite' and w.prior->>'invite_id' = p_id::text)$n$);
  def := replace(def, a_branch, $n$    elsif p_kind = 'supplier_category' then
      -- FLOW-965. The supplier's prior category comes back while it still remembers what the write left.
      begin
        perform private.forget_line_category(
          cid,
          (rec.prior->>'supplier_id')::uuid,
          (rec.prior->'after'->>'remembered_category_id')::uuid,
          (rec.prior->'before'->>'remembered_category_id')::uuid
        );
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object('ok', true, 'data', jsonb_build_object('kind', p_kind, 'id', p_id));
      exception
        when others then
          if sqlerrm = 'conflict' then
            response := private.mcp_error('conflict', 'conflict');
          elsif sqlerrm = 'supplier not found' then
            response := private.mcp_error('not_found', 'not found');
          else
            raise;
          end if;
      end;
$n$ || a_branch);
  execute def;
end
$undo$;

drop function pg_temp.anchor_count(text, text);

commit;
