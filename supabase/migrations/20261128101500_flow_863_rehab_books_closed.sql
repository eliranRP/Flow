-- FLOW-863 (the weekly security scan, 2026-11-28; the owner's choice the same day): a category's rehab
-- flag is a closed-period setting, as its P&L flag, cash flag and account are (FLOW-1170,
-- 20261115173100_books_closed_settings.sql). categories.rehab decides, for all time, whether a project's
-- posted, paid expense lines in the category count as rehab (private.project_investment), so a change
-- moves closed lines' part of the project's rehab and its forced equity. A person's change of it is now
-- refused, with the same words and errcode as the other settings
-- (`the books are closed through YYYY-MM-DD: this setting changes them`), when it would move a line
-- closed by private.books_closed_hit. private.mcp_refused already passes those words to the MCP
-- envelope as `refused`, so mcp_set_category_rehab and the category_rehab undo answer refused with no
-- change of their own. The service role and a company with no closed date pass, as for the others.
--
-- The lines a rehab change reaches are exactly the category's parts that private.project_investment
-- counts (20261113163849_get_project_speed.sql; it reads private.pnl_lines, the posted lines' item
-- legs): an item leg filed to the category, not a draft, of the expense kind, not unpaid
-- (private.line_unpaid); on a project that is not the company's overhead project (pnl_lines gives a
-- cost there the role overhead, which project_investment leaves out): the leg's own project, else the
-- line's when the line is filed to one; or the line is a shared cost with an allocation; and in the
-- cash view as project_investment reads it: the line's own cash choice, else the category's cash flag
-- (a guessed category does not take a line out; the category's flag is the row's current one, as a
-- change of the cash flag is guarded on its own). Of those, only a part whose rehab the change turns
-- (private.category_in_rehab before and after; the default follows the P&L flag and the loan part) is
-- counted, so setting true on a category counted by default, or false on one left out by default,
-- moves nothing and passes. Index: legs_company_id_category_id_fk_idx.
--
-- 1. private.books_closed_setting_guard: the category branch checks the existing three columns only
--    when one of them changes (a rehab change alone would otherwise reach every line with no cash
--    override), then the rehab lines above. The closed date is still read FOR SHARE (FLOW-856).
-- 2. The trigger categories_lock_closed_month also fires when rehab changes. Same name, so it still
--    fires after categories_default_pnl; still BEFORE UPDATE, for each row.
--
-- Rows: a trigger and one function; nothing is rewritten or backfilled. The signature does not change;
-- the guard keeps its grants, restated below as they are. No client-callable function is added.
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
-- 1. The guard's category branch.
-- ---------------------------------------------------------------------------------------------
select pg_temp.patch('private.books_closed_setting_guard()',
  array[$a$    -- The category's lines, as legs_category_sync_tg re-posts them. A change of the cash flag alone
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
$a$],
  array[$n$    if new.excluded_from_pnl is distinct from old.excluded_from_pnl
      or new.in_cash is distinct from old.in_cash
      or new.ledger_account_id is distinct from old.ledger_account_id
    then
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
    -- FLOW-863: the category's parts in a project's rehab, exactly as private.project_investment counts
    -- them (posted, paid expense parts in the cash view, on a project other than the overhead project
    -- or shared to one), whose rehab the change turns.
    if not hit and new.rehab is distinct from old.rehab then
      hit := exists (
        select 1 from public.legs l
        join public.transactions t on t.company_id = l.company_id and t.id = l.transaction_id
        where l.company_id = cid and l.category_id = new.id and l.leg_kind = 'item' and not l.draft
          and coalesce(new.kind::text, t.direction::text) = 'expense'
          and not private.line_unpaid(t.direction, t.doc_kind, t.cash_date)
          -- Not on the overhead project: pnl_lines gives that cost the role overhead.
          and case
            when l.project_explicit then l.project_id is not null
              and l.project_id is distinct from (select co.overhead_project_id from public.companies co where co.id = cid)
            when t.pnl_role = 'project' then t.project_id is not null
              and t.project_id is distinct from (select co.overhead_project_id from public.companies co where co.id = cid)
            when t.pnl_role = 'shared' then exists (
              select 1 from public.allocations a where a.company_id = cid and a.transaction_id = t.id)
            else false
          end
          -- In the cash view, as project_investment reads it (decision 0170).
          and coalesce(t.in_cash_override, not private.line_category_out(
            new.in_cash is false,
            t.category_suggested and l.category_id is not distinct from t.category_id,
            l.part
          ))
          and private.category_in_rehab(old.rehab, old.excluded_from_pnl, coalesce(old.loan_part, l.part))
            is distinct from private.category_in_rehab(new.rehab, new.excluded_from_pnl, coalesce(new.loan_part, l.part))
          and private.books_closed_hit(closed, t, null)
      );
    end if;
  end if;
$n$]);

comment on function private.books_closed_setting_guard() is
  'FLOW-1170, FLOW-863: refuses a person''s change of the cash basis, the overhead project, or a category''s P&L flag, cash flag, account or rehab flag when it would move a line closed by private.books_closed_hit.';

-- ---------------------------------------------------------------------------------------------
-- 2. The trigger fires on the rehab flag too.
-- ---------------------------------------------------------------------------------------------
drop trigger categories_lock_closed_month on public.categories;

-- Named to fire after categories_default_pnl (BEFORE row triggers fire by name), so the guard sees
-- the flag that trigger leaves.
create trigger categories_lock_closed_month
  before update on public.categories
  for each row
  when (old.excluded_from_pnl is distinct from new.excluded_from_pnl
    or old.in_cash is distinct from new.in_cash
    or old.ledger_account_id is distinct from new.ledger_account_id
    or old.rehab is distinct from new.rehab)
  execute function private.books_closed_setting_guard();

-- Privileges, restated as they are.
revoke all on function private.books_closed_setting_guard() from public, anon, authenticated;

-- The helpers are session-wide: a later migration in the same session can make its own.
drop function pg_temp.patch(text, text[], text[]);
drop function pg_temp.anchor_count(text, text);

commit;
