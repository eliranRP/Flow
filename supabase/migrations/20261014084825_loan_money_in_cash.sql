-- FLOW-416: loan money counts in cash by default. Decision 0171 (amends 0168).
--
-- #370 gave every new company an income category for money received from a loan
-- ('כסף שהתקבל מהלוואות'), out of the P&L and out of the cash view (תזרים). The owner chose that
-- a new company counts that money in cash: it is money that came into the bank. From here on:
-- - the new-company seed inserts the category in cash (still out of the P&L);
-- - a category created with a loan money name ('loan proceeds', 'כסף שהתקבל מהלוואות') no longer
--   starts out of cash, so private.non_cash_category drops those two names. Transfers and credit
--   card bill payments still start out.
-- Existing categories are not touched: a company whose loan money is out of cash keeps it out
-- until the owner switches it (set_category_cash or the app).

begin;

set local lock_timeout = '5s';

create or replace function private.non_cash_category(p_kind public.category_kind, p_name text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select exists (
    select 1
    from (
      values
        ('income', 'העברות'),
        ('income', 'internal transfers in'),
        ('expense', 'העברות'),
        ('expense', 'internal transfers out'),
        ('expense', 'credit card payments')
    ) as d(kind, name)
    where d.kind = p_kind::text
      and private.pnl_name_key(d.name) = private.pnl_name_key(p_name)
  );
$$;

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
    true, true, true
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

revoke all on function private.non_cash_category(public.category_kind, text) from public, anon, authenticated;
revoke all on function private.seed_loan_money_category() from public, anon, authenticated;

commit;
