-- FLOW-151 (decision 0231): three bugs the MCP agent hit after FLOW-148 and FLOW-149.
-- 1. A journal entry that books income counted in no P&L read. Every income reader counts an income
--    line by its document kind (receipt on the cash basis; invoice, credit or invoice_receipt on the
--    invoiced basis), and an entry's line was written as 'other'. An entry's line is now
--    invoice_receipt when it is income, so it counts on both bases in the month of its date; an
--    expense entry stays 'other' (an expense line counts whatever its kind). It stays out of the cash
--    view by in_cash_override, as before. No income entry exists yet, so no line is rewritten.
-- 2. A leg on a kept-out category with no balance-sheet binding landed on Suspense, silently (0210
--    binds a category by its English name only). create_journal_entry now refuses it ('the category
--    posts to Suspense'), and MCP set_category_account (public.mcp_set_category_account) binds a
--    kept-out category to a balance-sheet account, or back to the default. The categories trigger
--    re-posts its lines, so their legs move and no P&L figure does. Undo kind category_account.
-- 3. Re-attaching a payment after detach_loan_payment was refused with no reason: the first
--    attach's loan_split write stayed open, and mcp_writes_loan_split_open_idx (one open loan_split
--    write per user and line) refused the second. The attach runs only on a line with no loan split,
--    so an open loan_split write on it is stale: it is superseded first, as a review write is.
-- Functions written before this one are patched in place with counted anchors, as in
-- 20261027203804_journal_entries.sql.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- 1. An income entry's line is invoice_receipt.
do $core$
declare
  def text;
  anchor constant text := $a$case when current_setting('flow.journal_entry', true) = 'on' then 'other' else 'receipt' end::public.doc_kind,$a$;
begin
  def := pg_get_functiondef(
    'private.book_line_core(uuid,text,date,text,text,jsonb,uuid,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'book_line_core is not the expected definition';
  end if;
  def := replace(def, anchor, $n$case
        when current_setting('flow.journal_entry', true) <> 'on' then 'receipt'
        -- FLOW-151: income counts by its document kind, and invoice_receipt counts on both bases.
        when p_direction = 'income' then 'invoice_receipt'
        else 'other'
      end::public.doc_kind,$n$);
  execute def;
end
$core$;

-- 2. A journal entry refuses a leg that would land on Suspense.
do $je$
declare
  def text;
  anchor constant text := $a$        counter := counter || jsonb_build_object(
          'account_id', private.kept_out_account(cid, cat.id, cat.loan_part),$a$;
begin
  def := pg_get_functiondef('public.mcp_create_journal_entry(text,date,text,text,text,jsonb)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_create_journal_entry is not the expected definition';
  end if;
  def := replace(def, anchor, $n$        -- FLOW-151: a category with no balance-sheet account would land on Suspense; bind it
        -- (set_category_account) or book the balance-sheet system account itself.
        if private.kept_out_account(cid, cat.id, cat.loan_part) = (
          select a.id from public.accounts a
          where a.company_id = cid and a.category_id is null and a.name = 'Suspense'
        ) then
          raise exception 'the category posts to Suspense';
        end if;
$n$ || anchor);
  execute def;
end
$je$;

-- 3. Bind a kept-out category to a balance-sheet account.
create function public.mcp_set_category_account(
  p_idempotency_key text,
  p_category_id uuid,
  p_account_id uuid default null
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
  cat record;
  acct record;
  posts uuid;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_category_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'category_account|' || p_category_id::text || '|' || coalesce(p_account_id::text, '');
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
    select c.id, c.excluded_from_pnl, c.loan_part, c.ledger_account_id into cat
    from public.categories c
    where c.id = p_category_id and c.company_id = cid
    for update;
    if not found then
      raise exception 'category not found';
    end if;
    if not coalesce(cat.excluded_from_pnl, false) then
      raise exception 'the category is counted in the P&L';
    end if;
    if cat.loan_part is not null then
      raise exception 'a loan part category posts by its part';
    end if;
    if p_account_id is not null then
      select a.id, a.type, a.is_bank, a.name, a.category_id into acct
      from public.accounts a
      where a.id = p_account_id and a.company_id = cid;
      if not found then
        raise exception 'account not found';
      end if;
      -- The balance-sheet system accounts book_line takes: not the bank, Suspense or VAT control.
      if acct.category_id is not null or acct.type not in ('asset', 'liability') or acct.is_bank
        or acct.name in ('Suspense', 'VAT control')
      then
        raise exception 'a category posts only to a balance-sheet account';
      end if;
    end if;

    -- The categories trigger re-posts the category's lines: their legs move, no P&L figure does.
    update public.categories c set ledger_account_id = p_account_id
    where c.id = p_category_id and c.company_id = cid
      and c.ledger_account_id is distinct from p_account_id;
    posts := private.kept_out_account(cid, p_category_id, null);

    insert into private.mcp_writes (token_id, user_id, company_id, kind, category_id, prior)
    values (token, auth.uid(), cid, 'category_account', p_category_id,
      jsonb_build_object('before', cat.ledger_account_id, 'after', p_account_id));

    response := jsonb_build_object('ok', true, 'data', jsonb_build_object(
      'category_id', p_category_id,
      'account_id', p_account_id,
      'posts_to', posts,
      'posts_to_name', (select a.name from public.accounts a where a.id = posts and a.company_id = cid),
      'previous_account_id', cat.ledger_account_id,
      'undo_kind', 'category_account'
    ));
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
revoke all on function public.mcp_set_category_account(text, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_set_category_account(text, uuid, uuid) to authenticated;
comment on function public.mcp_set_category_account(text, uuid, uuid) is
  'MCP set_category_account: binds a kept-out category to a balance-sheet account (null: the default); its legs move, no P&L figure; undo kind category_account. Decision 0231.';

do $kinds$
declare
  def text;
  anchor constant text := $a$'journal_entry'::text])$a$;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, $n$'journal_entry'::text, 'category_account'::text])$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if right(def, 2) <> '))' or position($a$(kind = 'journal_entry'::text)$a$ in def) = 0 then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'category_account'::text) AND (category_id IS NOT NULL) AND (prior ? 'after'::text))))$n$;
end
$kinds$;

do $undo$
declare
  def text;
  a_kinds constant text := $a$'loan_part_category', 'loan_category_from', 'journal_entry'
    )$a$;
  a_lookup constant text := $a$        or (p_kind = 'journal_entry' and w.kind = 'journal_entry' and w.transaction_id = p_id)
      )$a$;
  a_branch constant text := $a$    elsif p_kind = 'book_line' then$a$;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, a_kinds) <> 1 or pg_temp.anchor_count(def, a_lookup) <> 1
    or pg_temp.anchor_count(def, a_branch) <> 1 then
    raise exception 'mcp_undo is not the expected definition';
  end if;
  def := replace(def, a_kinds, $n$'loan_part_category', 'loan_category_from', 'journal_entry', 'category_account'
    )$n$);
  def := replace(def, a_lookup, $n$        or (p_kind = 'journal_entry' and w.kind = 'journal_entry' and w.transaction_id = p_id)
        or (p_kind = 'category_account' and w.kind = 'category_account' and w.category_id = p_id)
      )$n$);
  def := replace(def, a_branch, $n$    elsif p_kind = 'category_account' then
      -- FLOW-151 (decision 0231): the binding goes back while it is still the one written.
      perform 1 from public.categories c
      where c.id = p_id and c.company_id = cid
        and c.ledger_account_id is not distinct from (rec.prior->>'after')::uuid
      for update;
      if not found then
        response := private.mcp_error('conflict', 'conflict');
      else
        update public.categories c set ledger_account_id = (rec.prior->>'before')::uuid
        where c.id = p_id and c.company_id = cid
          and c.ledger_account_id is distinct from (rec.prior->>'before')::uuid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object('ok', true, 'data', jsonb_build_object('kind', p_kind, 'id', p_id));
      end if;
$n$ || a_branch);
  execute def;
end
$undo$;

-- 4. A re-attach supersedes the stale loan_split write of a detached line.
do $attach$
declare
  def text;
  anchor constant text := $a$              insert into private.mcp_writes (
                token_id, user_id, kind, loan_id, transaction_id, reassign_id, prior
              )$a$;
begin
  def := pg_get_functiondef('public.mcp_attach_loan_payment(text,uuid,uuid,jsonb)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_attach_loan_payment is not the expected definition';
  end if;
  def := replace(def, anchor, $n$              -- FLOW-151: the line had no loan split, so an open loan_split write on it is stale
              -- (detach_loan_payment leaves it open). Supersede it, as a review write is, so the
              -- one open write per line is this attach, which undo targets.
              update private.mcp_writes
              set undone_at = clock_timestamp()
              where user_id = auth.uid()
                and kind = 'loan_split'
                and transaction_id = p_transaction_id
                and undone_at is null;

$n$ || anchor);
  execute def;
end
$attach$;

-- 5. The new reasons, in words.
do $refused$
declare
  def text;
  anchor constant text := $a$        'a journal entry must change the P&L'
      ) then p_message$a$;
begin
  def := pg_get_functiondef('private.mcp_refused(text)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_refused is not the expected definition';
  end if;
  def := replace(def, anchor, $n$        'a journal entry must change the P&L',
        -- FLOW-151 (decision 0231).
        'the category posts to Suspense',
        'the category is counted in the P&L',
        'a loan part category posts by its part',
        'a category posts only to a balance-sheet account'
      ) then p_message$n$);
  execute def;
end
$refused$;

commit;
