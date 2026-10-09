-- FLOW-413 follow-up: one loan money category per company. Decision 0168.
--
-- #370 gave every company an income category for money received from a loan
-- ('כסף שהתקבל מהלוואות', out of the P&L and out of cash) unless it already had one by that exact
-- name or 'loan proceeds'. A company that kept its loan money in a category of its own, under
-- another name, got a second one. From here on:
-- - a company already has loan money when an income category kept out of the P&L has a loan in
--   its name ('loan', or the stem 'הלווא' of הלוואה and הלוואות);
-- - the new-company seed skips such a company;
-- - the duplicate the backfill made is removed while nothing uses it, and the company's own
--   loan money category is taken out of cash in its place, as the seeded one was. A duplicate
--   that is already in use stays: the owner merges it by hand.

begin;

set local lock_timeout = '5s';

-- Whether an income category kept out of the P&L holds money received from a loan.
create function private.loan_money_category(p_kind public.category_kind, p_excluded boolean, p_name text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_kind = 'income'
    and coalesce(p_excluded, false)
    and (
      private.pnl_name_key(p_name) ~ '(^| )loan( |$)'
      or private.pnl_name_key(p_name) like '%הלווא%'
    );
$$;

revoke all on function private.loan_money_category(public.category_kind, boolean, text) from public, anon, authenticated;

create or replace function private.seed_loan_money_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl, in_cash)
  select new.id, 'כסף שהתקבל מהלוואות', 'income',
    coalesce((select max(c.sort_order) + 1 from public.categories c where c.company_id = new.id and c.kind = 'income'), 1),
    true, true, false
  where not exists (
    select 1 from public.categories c
    where c.company_id = new.id
      and c.kind = 'income'
      and (
        private.pnl_name_key(c.name) in (
          private.pnl_name_key('כסף שהתקבל מהלוואות'), private.pnl_name_key('loan proceeds')
        )
        or private.loan_money_category(c.kind, c.excluded_from_pnl, c.name)
      )
  );
  return new;
end;
$$;

-- The seeded duplicates: the default loan money category of a company that has another loan
-- money category of its own. Returns how many went. Kept as a function so the test runs it.
create function private.dedupe_loan_money_categories()
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

  -- The company's own loan money category takes the seeded one's place out of cash.
  update public.categories o
  set in_cash = false
  where o.in_cash
    and o.company_id in (select d.company_id from loan_money_dupes d)
    and o.id not in (select d.id from loan_money_dupes d)
    and private.loan_money_category(o.kind, o.excluded_from_pnl, o.name);

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

select private.dedupe_loan_money_categories();

commit;
