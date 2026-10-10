-- FLOW-436 (decision 0171, owner's word 2026-10-10 16:31Z): loan money counts in cash, and the
-- owner switches it off afterwards. The one-loan-money-category rule from FLOW-413 no longer takes
-- a company's own loan money category out of cash when it removes the seeded copy: the category
-- keeps the value it has, the owner's choice included. The rule runs only when called (it ran once,
-- in 20261013210638), so this changes no existing row.

begin;

set local lock_timeout = '5s';

create or replace function private.dedupe_loan_money_categories()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  create temporary table loan_money_dupes on commit drop as
  select s.company_id, s.id
  from public.categories s
  where s.kind = 'income'
    and s.is_default
    and s.name = 'כסף שהתקבל מהלוואות'
    and exists (
      select 1 from public.categories o
      where o.company_id = s.company_id
        and o.id <> s.id
        and private.loan_money_category(o.kind, o.excluded_from_pnl, o.name)
    );

  -- Nothing may point at a duplicate that goes: no line, part, loan, supplier, sub-category,
  -- review row, undo row, Jev row or MCP write. A duplicate that is used stays as it is.
  delete from loan_money_dupes d
  where exists (select 1 from public.transactions t where t.company_id = d.company_id and t.category_id = d.id)
    or exists (select 1 from public.line_splits s where s.company_id = d.company_id and s.category_id = d.id)
    or exists (select 1 from public.loan_splits s where s.company_id = d.company_id and s.category_id = d.id)
    or exists (
      select 1 from public.loans l
      where l.company_id = d.company_id
        and d.id in (l.interest_category_id, l.escrow_category_id, l.principal_category_id, l.fees_category_id)
    )
    or exists (select 1 from public.suppliers s where s.company_id = d.company_id and s.remembered_category_id = d.id)
    or exists (select 1 from public.categories c where c.company_id = d.company_id and c.parent_id = d.id)
    or exists (
      select 1 from public.review_queue q
      where q.company_id = d.company_id
        and d.id in (q.prior_category_id, q.paired_category_id, q.prior_remembered_category_id, q.written_remembered_category_id)
    )
    or exists (select 1 from public.reassign_undo r where r.prior_category_id = d.id)
    or exists (select 1 from public.jev_outcomes j where d.id in (j.final_category_id, j.suggested_category_id))
    or exists (select 1 from public.jev_prefills j where d.id in (j.category_id, j.prior_category_id))
    or exists (select 1 from private.mcp_writes w where w.category_id = d.id)
    or exists (select 1 from private.category_deletions x where x.category_id = d.id);

  -- FLOW-436: the company's own loan money category keeps whether it counts in cash; the
  -- owner switches it with set_category_cash.
  delete from public.categories c
  using loan_money_dupes d
  where c.company_id = d.company_id
    and c.id = d.id;
  get diagnostics removed = row_count;

  drop table loan_money_dupes;
  return removed;
end;
$$;

revoke all on function private.dedupe_loan_money_categories() from public, anon, authenticated, service_role;

commit;
