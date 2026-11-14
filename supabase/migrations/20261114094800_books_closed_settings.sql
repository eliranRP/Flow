-- FLOW-1170 (the owner's decision of 2026-11-14, "Refuse it"): a setting that would move a figure in
-- a closed period is refused when a PERSON changes it, as an edit of a closed line is (FLOW-1166 part
-- 2a, 20261111080447_books_closed_lock.sql). It is refused only when at least one line the setting
-- reaches is closed, by private.books_closed_hit, the one definition of a line in the closed period
-- (posted, not removed, doc_date or a non-null cash_date on or before companies.books_closed_through).
-- A change to the value it already has is no change and passes. With no closed date (every company
-- on 2026-11-14) the guard reads nothing more than the row it fires on (the categories guard reads the
-- company's row by its key).
--
-- The five settings, the lines each one moves, and the index that serves the existence check:
-- 1. companies.cash_basis (set_cash_basis, mcp_set_cash_basis, their undos): the basis picks each
--    line's month and whether it is counted (breakdown_rows, cash_parts, overhead_shares, the cash
--    months). A line reads the same on both bases unless it is an income invoice, credit or receipt
--    (counted on one basis only), an invoice or credit with no payment date (unpaid: invoice basis
--    only, or no cash month), or a line whose payment date differs from its document date. Index:
--    transactions_company_date_idx and transactions_company_cash_idx, one existence query each.
-- 2. categories.excluded_from_pnl (set_category_excluded_from_pnl, mcp_set_category_pnl, the undo)
--    and 4. categories.ledger_account_id (mcp_set_category_account, the undo, mcp_merge_account and
--    its undo, which rebind every category of the merged account): legs_category_sync_tg re-posts
--    the category's lines, which moves their legs between the P&L and the kept-out account: the
--    lines filed to the category, and the lines with a split part or a loan part filed to it (the
--    same set the trigger re-posts). Index: transactions_company_id_category_id_fk_idx and
--    legs_company_id_category_id_fk_idx.
-- 3. categories.in_cash (set_category_cash, mcp_set_category_cash, the undo): the cash views read it
--    for the same lines, except a line with its own in_cash_override, which decides for all its parts.
--    The same indexes.
-- 5. companies.overhead_project_id (set_overhead_project, mcp_set_overhead_project, the undo; a
--    project delete sets it null): a cost filed to the old or the new overhead project turns between
--    the project's cost and overhead, and that project's income leaves or joins the weights that share
--    overhead out; a shared cost's allocation to it is counted with it. So: the lines of the old and
--    the new project (filed to it, a split part on it, or an allocation to it). Index:
--    transactions_company_id_project_id_fk_idx, legs_project_idx and allocations_company_idx.
--
-- The guards are BEFORE UPDATE row triggers on companies and categories, with a WHEN clause on these
-- columns, so every writer is covered without patching it: the owner RPCs, the MCP tools, mcp_undo and
-- the app's own undo (which calls the setter again). As the line lock does, they refuse only a
-- person (auth.uid() set); the service role and the jobs pass. No sync, job or edge function writes
-- these columns today: a category's flags are written by the RPCs above, by the category seeds on
-- insert (no line yet) and by category_restore (an undo, a person's); the basis and the overhead
-- project by their setters alone.
--
-- The message: `the books are closed through YYYY-MM-DD: this setting changes them`. It starts with
-- the line lock's words, so a reader that knows only those still finds the date; the app tells a
-- setting from a line by the suffix. private.mcp_refused passes it to the MCP envelope as `refused`.
--
-- A rename keeps a category's P&L flag. rename_category and the category_name undo set the name, which
-- can make categories_default_pnl exclude the category, and then wrote the flag back: a change and its
-- reversal that the guard would refuse in a closed period. They now name the category in the
-- transaction-local setting flow.rename_keeps_pnl while they rename, and categories_default_pnl leaves
-- the flag of the category named there; the write-back goes. A direct rename (none in the app) still
-- takes the default.
--
-- A bulk category action (merge, move, delete, restore) moves lines, and the line lock already refuses
-- it whole when it reaches a closed line.
--
-- Rows: triggers and functions only; nothing is rewritten or backfilled. Signatures do not change;
-- the patched functions keep their grants, restated below as they are. No client-callable function is
-- added.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- Replaces each anchor (found exactly once) in a function's definition and runs the result.
create or replace function pg_temp.patch(p_fn text, p_from text[], p_to text[])
returns void
language plpgsql
as $$
declare
  def text := pg_get_functiondef(p_fn::regprocedure);
  i integer;
begin
  for i in 1 .. cardinality(p_from) loop
    if pg_temp.anchor_count(def, p_from[i]) <> 1 then
      raise exception '% is not the expected definition (anchor %)', p_fn, i;
    end if;
    def := replace(def, p_from[i], p_to[i]);
  end loop;
  execute def;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 1. The guard.
-- ---------------------------------------------------------------------------------------------
create function private.books_closed_setting_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  closed date;
  hit boolean := false;
  projects uuid[];
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_table_name = 'companies' then
    cid := new.id;
    closed := new.books_closed_through;
  else
    cid := new.company_id;
    select c.books_closed_through into closed from public.companies c where c.id = cid;
  end if;
  if closed is null then
    return new;
  end if;

  if tg_table_name = 'companies' then
    if new.cash_basis is distinct from old.cash_basis then
      -- The lines that read differently on the two bases (see the header), dated in the closed
      -- period by their document or by their payment.
      hit := exists (
        select 1 from public.transactions t
        where t.company_id = cid and t.doc_date <= closed
          and ((t.direction = 'income' and t.doc_kind in ('invoice', 'credit', 'receipt'))
            or (t.doc_kind in ('invoice', 'credit') and t.cash_date is null)
            or t.cash_date <> t.doc_date)
          and private.books_closed_hit(closed, t, null)
      ) or exists (
        select 1 from public.transactions t
        where t.company_id = cid and t.cash_date <= closed
          and ((t.direction = 'income' and t.doc_kind in ('invoice', 'credit', 'receipt'))
            or t.cash_date <> t.doc_date)
          and private.books_closed_hit(closed, t, null)
      );
    end if;
    if not hit and new.overhead_project_id is distinct from old.overhead_project_id then
      projects := array_remove(array[old.overhead_project_id, new.overhead_project_id], null);
      hit := exists (
        select 1 from public.transactions t
        where t.company_id = cid and t.project_id = any (projects)
          and private.books_closed_hit(closed, t, null)
      ) or exists (
        select 1 from public.legs l
        join public.transactions t on t.company_id = l.company_id and t.id = l.transaction_id
        where l.project_id = any (projects) and l.company_id = cid and l.project_explicit
          and private.books_closed_hit(closed, t, null)
      ) or exists (
        select 1 from public.allocations a
        join public.transactions t on t.company_id = a.company_id and t.id = a.transaction_id
        where a.company_id = cid and a.project_id = any (projects)
          and private.books_closed_hit(closed, t, null)
      );
    end if;
  else
    -- The category's lines, as legs_category_sync_tg re-posts them. A change of the cash flag alone
    -- leaves a line with its own cash override as it is.
    hit := exists (
      select 1 from public.transactions t
      where t.company_id = cid and t.category_id = new.id
        and (new.excluded_from_pnl is distinct from old.excluded_from_pnl
          or new.ledger_account_id is distinct from old.ledger_account_id
          or t.in_cash_override is null)
        and private.books_closed_hit(closed, t, null)
    ) or exists (
      select 1 from public.legs l
      join public.transactions t on t.company_id = l.company_id and t.id = l.transaction_id
      where l.company_id = cid and l.category_id = new.id and (l.split_part or l.loan_id is not null)
        and (new.excluded_from_pnl is distinct from old.excluded_from_pnl
          or new.ledger_account_id is distinct from old.ledger_account_id
          or t.in_cash_override is null)
        and private.books_closed_hit(closed, t, null)
    );
  end if;

  if hit then
    raise exception '%: this setting changes them', private.prepaid_closed_reason(closed);
  end if;
  return new;
end;
$$;

comment on function private.books_closed_setting_guard() is
  'FLOW-1170: refuses a person''s change of the cash basis, the overhead project, or a category''s P&L flag, cash flag or account when it would move a line closed by private.books_closed_hit.';

-- Named to fire after categories_default_pnl (BEFORE row triggers fire by name), so the guard sees
-- the flag that trigger leaves.
create trigger categories_lock_closed_month
  before update on public.categories
  for each row
  when (old.excluded_from_pnl is distinct from new.excluded_from_pnl
    or old.in_cash is distinct from new.in_cash
    or old.ledger_account_id is distinct from new.ledger_account_id)
  execute function private.books_closed_setting_guard();

create trigger companies_lock_closed_month
  before update on public.companies
  for each row
  when (old.cash_basis is distinct from new.cash_basis
    or old.overhead_project_id is distinct from new.overhead_project_id)
  execute function private.books_closed_setting_guard();

-- ---------------------------------------------------------------------------------------------
-- 2. The MCP envelope passes the setting's refusal as it passes the line's.
-- ---------------------------------------------------------------------------------------------
select pg_temp.patch('private.mcp_refused(text)',
  array[$a$) or p_message ~ '^the books are closed through [0-9]{4}-[0-9]{2}-[0-9]{2}$' then p_message$a$],
  array[$n$) or p_message ~ '^the books are closed through [0-9]{4}-[0-9]{2}-[0-9]{2}(: this setting changes them)?$' then p_message$n$]);
revoke all on function private.mcp_refused(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. A rename keeps the P&L flag without changing it and back.
-- ---------------------------------------------------------------------------------------------
select pg_temp.patch('private.categories_default_pnl()',
  array[$a$    and not private.non_pnl_category(old.kind, old.name)$a$],
  array[$n$    and not private.non_pnl_category(old.kind, old.name)
    -- FLOW-1170: rename_category and the category_name undo keep the flag of the category they rename.
    and coalesce(current_setting('flow.rename_keeps_pnl', true), '') is distinct from new.id::text$n$]);
revoke all on function private.categories_default_pnl() from public, anon, authenticated, service_role;

select pg_temp.patch('public.rename_category(uuid,text)',
  array[$a$  was_excluded boolean;
$a$,
    $a$  select c.name, c.kind, c.excluded_from_pnl into before, cat_kind, was_excluded$a$,
    $a$  update public.categories c
  set name = clean
  where c.id = p_category_id and c.company_id = cid and c.name is distinct from clean;
  -- The categories_default_pnl trigger may set excluded_from_pnl from the new name;
  -- a rename keeps the flag. This update leaves the name alone, so the trigger stays quiet.
  update public.categories c
  set excluded_from_pnl = was_excluded
  where c.id = p_category_id and c.company_id = cid and c.excluded_from_pnl is distinct from was_excluded;
$a$],
  array['',
    $n$  select c.name, c.kind into before, cat_kind$n$,
    $n$  -- A rename keeps the P&L flag: categories_default_pnl leaves the category named here (FLOW-1170).
  perform set_config('flow.rename_keeps_pnl', p_category_id::text, true);
  update public.categories c
  set name = clean
  where c.id = p_category_id and c.company_id = cid and c.name is distinct from clean;
  perform set_config('flow.rename_keeps_pnl', '', true);
$n$]);
revoke all on function public.rename_category(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.rename_category(uuid, text) to authenticated;

select pg_temp.patch('public.mcp_undo(text,text,uuid)',
  array[$a$        -- Keep excluded_from_pnl: the name trigger may set it from the old name.
        declare
          was_excluded boolean;
        begin
          select c.excluded_from_pnl into was_excluded
          from public.categories c
          where c.id = p_id and c.company_id = cid;
          update public.categories c
          set name = rec.prior->>'before'
          where c.id = p_id and c.company_id = cid;
          update public.categories c
          set excluded_from_pnl = was_excluded
          where c.id = p_id and c.company_id = cid and c.excluded_from_pnl is distinct from was_excluded;
        end;
$a$],
  array[$n$        -- Keep excluded_from_pnl: categories_default_pnl leaves the category named here (FLOW-1170).
        perform set_config('flow.rename_keeps_pnl', p_id::text, true);
        update public.categories c
        set name = rec.prior->>'before'
        where c.id = p_id and c.company_id = cid;
        perform set_config('flow.rename_keeps_pnl', '', true);
$n$]);
revoke all on function public.mcp_undo(text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_undo(text, text, uuid) to authenticated;

revoke all on function private.books_closed_setting_guard() from public, anon, authenticated;

-- The helpers are session-wide: a later migration in the same session can make its own.
drop function pg_temp.patch(text, text[], text[]);
drop function pg_temp.anchor_count(text, text);

commit;
