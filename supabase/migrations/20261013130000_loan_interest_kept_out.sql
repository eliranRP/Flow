-- FLOW-414 (decision 0166): interest and escrow may sit in a kept-out expense category, as fees
-- already may (0130). A hard-money rehab or flip loan's interest is a carrying cost the owner keeps
-- out of profit; until now update_loan, attach_loan_payment and save_loan_split refused it
-- (category does not fit the loan part). Principal still needs a kept-out category, and a keyed
-- loan category still takes only its own part. The P&L needs no change: each part already counts
-- by its own category's flag (private.pnl_lines, private.line_in_pnl).
-- private.categories_loan_pnl_check now guards principal and built-in loan categories in use: any
-- other category holding interest or escrow may move to either side of the P&L, and the parts
-- follow it, like fees.
-- Otherwise as in 20261009200000_loan_fees_installments.sql. Grants are kept by create or replace.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- Whether a category of the company may hold a loan part. Interest, escrow and fees: any expense
-- category, in the P&L or kept out (0130, 0166). Principal: a kept-out one. A keyed category takes
-- only its own part, and fees also the keyed interest one.
create or replace function private.loan_part_category_ok(
  p_company_id uuid,
  p_part public.loan_split_part,
  p_category_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.categories c
    where c.company_id = p_company_id
      and c.id = p_category_id
      and c.kind = 'expense'::public.category_kind
      and (
        c.loan_part is null
        or c.loan_part = p_part
        or (p_part::text = 'fees' and c.loan_part::text = 'interest')
      )
      and (p_part::text <> 'principal' or c.excluded_from_pnl)
  );
$$;

-- A category that holds principal, or that a loan names for principal, stays kept out: counting
-- it would make a repayment an expense. A built-in loan category in use keeps its side. Other
-- categories holding interest, escrow or fees may sit on either side, and each part follows its
-- category's flag (0130, 0166).
create or replace function private.categories_loan_pnl_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.excluded_from_pnl is distinct from old.excluded_from_pnl
     and (
       exists (
         select 1 from public.loan_splits s
         where s.company_id = new.company_id
           and s.category_id = new.id
           and (
             new.loan_part is not null
             or (s.part = 'principal'::public.loan_split_part and not new.excluded_from_pnl)
           )
       )
       or exists (
         select 1 from public.loans l
         where l.company_id = new.company_id
           and (
             (l.principal_category_id = new.id and not new.excluded_from_pnl)
             or (
               new.loan_part is not null
               and new.id in (l.interest_category_id, l.escrow_category_id, l.principal_category_id)
             )
           )
       )
     )
  then
    raise exception 'loan category is fixed' using errcode = '23514';
  end if;
  return new;
end;
$$;

commit;
