-- FLOW-1166 part 2a (decision 0266; the owner's decisions of 2026-11-10 and 2026-11-11 in the task):
-- the books-closed date locks a closed month against a PERSON's edits. The app, flow-mcp's tools (a
-- signed user JWT) and every owner RPC and undo are refused through the triggers below, with the
-- existing message `the books are closed through YYYY-MM-DD` (private.prepaid_closed_reason), which
-- private.mcp_refused already passes to the MCP envelope as `refused`. A write with no user (the bank
-- and SUMIT syncs, the daily jobs: service role, auth.uid() is null) is not touched here; holding a
-- sync's change to a closed line is part 2b.
--
-- 1. private.books_closed_hit(closed, old, new): the one definition of "this write touches a closed
--    period". A line is closed when it is in a report (line_status 'posted', removed_at null) and its
--    doc_date, or a non-null cash_date, is on or before the date (null: nothing is closed). A write is
--    a hit when the old or the new row is closed and a report column changes; an insert or a delete
--    changes them all. When only cash_date changes, only the old and the new cash_date are tested, so a
--    closed month's invoice can be marked paid in an open month. A pending line is in no report:
--    changing it is free, and it is a hit when it posts with a closed date.
--    The report columns are what private.pnl_lines, private.cash_parts, private.line_pnl_state(s) and
--    private.post_lines read, as transactions_prepaid_held lists them, plus vat_status and
--    category_suggested (post_lines and cash_parts keep a suggested category's line out by it).
-- 2. private.books_closed_guard(): before insert, update (WHEN a report column changes) and delete,
--    for each row, on transactions, allocations and overhead. For allocations and overhead the line
--    they belong to decides. It costs nothing when no report column changes (the WHEN clause), returns
--    at once when no person writes, and reads the company's row by its key once otherwise. A delete
--    that comes with its company (the company row is gone) finds no date and passes.
-- 3. A line's parts change its figures without touching the line: set_line_parts, set_loan_parts and
--    set_loan_parts_review (clear_loan_split_review) check the line through
--    private.books_closed_check, after the prepaid check in the first two.
-- 4. private.follow_invoice: when a person files an invoice in an open month, a receipt it pays that is
--    in a closed period keeps its stored filing instead of following (and refusing the filing).
--
-- Not locked here, as decided: settings that move a closed month's figures without touching a line
-- (the cash basis, a category's P&L or cash flag, account binding, the overhead project), and the
-- ledger rebuilds (post_lines, rebuild_legs, account merge, category-account binding). A bulk action
-- (a category merge, delete or move, a loan category change applied to past lines, a project delete
-- that clears its lines) that reaches a closed line is refused whole: the first closed row raises
-- and the statement rolls back.
--
-- Rows: triggers and functions only; no table is rewritten and nothing is backfilled. With
-- books_closed_through null for every company nothing is refused.
--
-- Signatures and privileges do not change: the patched functions keep their grants, restated below
-- as they are. No client-callable function is added.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- ---------------------------------------------------------------------------
-- 1. The predicate.
-- ---------------------------------------------------------------------------
-- p_old is null for an insert, p_new for a delete (or for "the line's parts change": the line as it
-- stands is tested).
create function private.books_closed_hit(p_closed date, p_old public.transactions, p_new public.transactions)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(case
    when p_closed is null then false
    when p_old is null then
      p_new.line_status = 'posted' and p_new.removed_at is null
        and (p_new.doc_date <= p_closed or p_new.cash_date <= p_closed)
    when p_new is null then
      p_old.line_status = 'posted' and p_old.removed_at is null
        and (p_old.doc_date <= p_closed or p_old.cash_date <= p_closed)
    when (p_old.direction, p_old.doc_kind, p_old.amount_gross, p_old.amount_net, p_old.vat_amount,
          p_old.vat_status, p_old.amount_original, p_old.category_id, p_old.category_suggested,
          p_old.project_id, p_old.pnl_role, p_old.in_pnl_override, p_old.in_cash_override,
          p_old.line_status, p_old.removed_at, p_old.doc_date, p_old.currency, p_old.company_id,
          p_old.user_assigned, p_old.category_assigned)
      is distinct from
         (p_new.direction, p_new.doc_kind, p_new.amount_gross, p_new.amount_net, p_new.vat_amount,
          p_new.vat_status, p_new.amount_original, p_new.category_id, p_new.category_suggested,
          p_new.project_id, p_new.pnl_role, p_new.in_pnl_override, p_new.in_cash_override,
          p_new.line_status, p_new.removed_at, p_new.doc_date, p_new.currency, p_new.company_id,
          p_new.user_assigned, p_new.category_assigned)
    then
      (p_old.line_status = 'posted' and p_old.removed_at is null
        and (p_old.doc_date <= p_closed or p_old.cash_date <= p_closed))
      or (p_new.line_status = 'posted' and p_new.removed_at is null
        and (p_new.doc_date <= p_closed or p_new.cash_date <= p_closed))
    -- Only cash_date changes: the old and the new payment date decide, not the document's date.
    when p_old.cash_date is distinct from p_new.cash_date then
      p_new.line_status = 'posted' and p_new.removed_at is null
        and (p_old.cash_date <= p_closed or p_new.cash_date <= p_closed)
    else false
  end, false);
$$;

comment on function private.books_closed_hit(date, public.transactions, public.transactions) is
  'FLOW-1166: whether a write from p_old to p_new (null: insert or delete) changes what a report shows for a period closed through p_closed.';

-- ---------------------------------------------------------------------------
-- 2. The guard.
-- ---------------------------------------------------------------------------
-- A person's write (auth.uid() set, as transactions_prepaid_held decides it) that touches a closed
-- period is refused. Transactions: the row itself. Allocations and overhead: the line they belong to.
create function private.books_closed_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  closed date;
  hit boolean;
begin
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    cid := new.company_id;
  else
    cid := old.company_id;
  end if;
  -- The company's row is gone in a delete that comes with it: no date, nothing refused.
  select c.books_closed_through into closed from public.companies c where c.id = cid;
  if closed is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_table_name = 'transactions' then
    if tg_op = 'INSERT' then
      hit := private.books_closed_hit(closed, null, new);
    elsif tg_op = 'DELETE' then
      hit := private.books_closed_hit(closed, old, null);
    else
      hit := private.books_closed_hit(closed, old, new);
    end if;
  elsif tg_op = 'INSERT' then
    hit := exists (
      select 1 from public.transactions t
      where t.company_id = cid and t.id = new.transaction_id and private.books_closed_hit(closed, t, null));
  elsif tg_op = 'DELETE' then
    -- A line deleted with its parts is gone by now; its own delete was checked.
    hit := exists (
      select 1 from public.transactions t
      where t.company_id = cid and t.id = old.transaction_id and private.books_closed_hit(closed, t, null));
  else
    hit := exists (
      select 1 from public.transactions t
      where t.company_id = cid and t.id in (old.transaction_id, new.transaction_id)
        and private.books_closed_hit(closed, t, null));
  end if;

  if hit then
    raise exception '%', private.prepaid_closed_reason(closed);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Named to fire after transactions_fill_amount_original and transactions_fill_category (BEFORE row
-- triggers fire by name), so the guard sees the row they leave.
create trigger transactions_lock_closed_month
  before insert or delete on public.transactions
  for each row
  execute function private.books_closed_guard();

create trigger transactions_lock_closed_month_update
  before update on public.transactions
  for each row
  when (old.direction is distinct from new.direction
    or old.doc_kind is distinct from new.doc_kind
    or old.amount_gross is distinct from new.amount_gross
    or old.amount_net is distinct from new.amount_net
    or old.vat_amount is distinct from new.vat_amount
    or old.vat_status is distinct from new.vat_status
    or old.amount_original is distinct from new.amount_original
    or old.category_id is distinct from new.category_id
    or old.category_suggested is distinct from new.category_suggested
    or old.project_id is distinct from new.project_id
    or old.pnl_role is distinct from new.pnl_role
    or old.in_pnl_override is distinct from new.in_pnl_override
    or old.in_cash_override is distinct from new.in_cash_override
    or old.line_status is distinct from new.line_status
    or old.removed_at is distinct from new.removed_at
    or old.doc_date is distinct from new.doc_date
    or old.cash_date is distinct from new.cash_date
    or old.currency is distinct from new.currency
    or old.company_id is distinct from new.company_id
    or old.user_assigned is distinct from new.user_assigned
    or old.category_assigned is distinct from new.category_assigned)
  execute function private.books_closed_guard();

create trigger allocations_lock_closed_month
  before insert or update or delete on public.allocations
  for each row
  execute function private.books_closed_guard();

create trigger overhead_lock_closed_month
  before insert or update or delete on public.overhead
  for each row
  execute function private.books_closed_guard();

-- ---------------------------------------------------------------------------
-- 3. A line's parts.
-- ---------------------------------------------------------------------------
create function private.books_closed_check(p_company uuid, p_txn uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  closed date;
begin
  if auth.uid() is null then
    return;
  end if;
  select c.books_closed_through into closed from public.companies c where c.id = p_company;
  if closed is not null and exists (
    select 1 from public.transactions t
    where t.company_id = p_company and t.id = p_txn and private.books_closed_hit(closed, t, null)
  ) then
    raise exception '%', private.prepaid_closed_reason(closed);
  end if;
end;
$$;

do $parts$
declare
  def text;
  anchor constant text := $a$  perform private.prepaid_line_check(p_company, p_txn);$a$;
  fn text;
begin
  foreach fn in array array['private.set_line_parts(uuid,uuid,jsonb)', 'private.set_loan_parts(uuid,uuid,uuid,jsonb)'] loop
    def := pg_get_functiondef(fn::regprocedure);
    if pg_temp.anchor_count(def, anchor) <> 1 then
      raise exception '% is not the expected definition', fn;
    end if;
    def := replace(def, anchor, anchor || $n$
  -- FLOW-1166: a line in a closed period keeps its parts when a person writes.
  perform private.books_closed_check(p_company, p_txn);$n$);
    execute def;
  end loop;
end
$parts$;

-- clear_loan_split_review: clearing the flag turns draft loan parts into the line's figures.
do $review$
declare
  def text;
  anchor constant text := $a$  if changed = 0 then
    return false;
  end if;$a$;
begin
  def := pg_get_functiondef('private.set_loan_parts_review(uuid,uuid,boolean)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'set_loan_parts_review is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
  -- FLOW-1166: a line in a closed period keeps its parts' state when a person writes.
  perform private.books_closed_check(p_company, p_txn);$n$);
  execute def;
end
$review$;

-- ---------------------------------------------------------------------------
-- 4. A receipt follows its invoice's filing, but not into a closed period's figures.
-- ---------------------------------------------------------------------------
-- The cascade runs in the person's statement (line_receipt_pairing is a row trigger), so auth.uid()
-- is theirs and the guard would refuse the invoice's filing for the closed receipt. The receipt keeps
-- what it has; a sync (no user) still moves it, as before.
do $follow$
declare
  def text;
  anchor constant text := $a$    for update skip locked
  loop
$a$;
begin
  def := pg_get_functiondef('private.follow_invoice(uuid,boolean)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'follow_invoice is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$    -- FLOW-1166: a receipt in a closed period keeps its stored filing when a person files.
    if auth.uid() is not null and exists (
      select 1 from public.transactions t
      join public.companies c on c.id = t.company_id
      where t.id = r.id and t.company_id = r.company_id
        and private.books_closed_hit(c.books_closed_through, t, null)
    ) then
      continue;
    end if;
$n$);
  execute def;
end
$follow$;

revoke all on function private.books_closed_hit(date, public.transactions, public.transactions) from public, anon, authenticated;
revoke all on function private.books_closed_guard() from public, anon, authenticated;
revoke all on function private.books_closed_check(uuid, uuid) from public, anon, authenticated;

revoke all on function private.set_line_parts(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.set_loan_parts(uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.set_loan_parts_review(uuid, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function private.follow_invoice(uuid, boolean) from public, anon, authenticated;
grant execute on function private.follow_invoice(uuid, boolean) to service_role;

drop function pg_temp.anchor_count(text, text);

commit;
