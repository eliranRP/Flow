-- FLOW-123 (#72 review follow-ups). Decision 0121.
-- 1. private.loan_splits_check locks the loan before the balance check, as the MCP
--    attach path does, so two app splits on one loan at once cannot both pass it.
--    The body is otherwise as in 20261007201111_loan_payment_checks.sql.
-- 2. A line that starts to count against a loan (it becomes posted, or a removed line
--    comes back) and takes the balance below zero gets its loan parts flagged for review,
--    like an amount change does. The bank sync and undo are not refused.
-- 3. An edit that lowers a loan's principal below the principal already paid is refused
--    ('loan balance exceeded').

begin;

set local lock_timeout = '5s';

-- Principal paid on a loan, by the public.loan_balances rule: posted principal parts
-- still on the books and not waiting for review.
create or replace function private.loan_paid_principal(p_loan_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(s.amount_minor), 0)::bigint
  from public.loan_splits s
  join public.transactions t
    on t.company_id = s.company_id
   and t.id = s.transaction_id
  where s.loan_id = p_loan_id
    and s.part = 'principal'::public.loan_split_part
    and t.line_status = 'posted'::public.line_status
    and t.removed_at is null
    and s.needs_review is not true;
$$;

revoke all on function private.loan_paid_principal(uuid) from public, anon, authenticated;

create or replace function private.loan_splits_check(txn uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  parts integer;
  loan_count integer;
  actual bigint;
  expected bigint;
  stale boolean;
  loan uuid;
begin
  select count(*)::integer,
         count(distinct s.loan_id)::integer,
         coalesce(sum(s.amount_minor), 0),
         bool_and(s.needs_review)
  into parts, loan_count, actual, stale
  from public.loan_splits s
  where s.transaction_id = txn;

  if parts = 0 then
    return;
  end if;

  if parts <> 3 or loan_count <> 1 then
    raise exception 'loan_split_incomplete' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.transactions t
    where t.id = txn
      and t.direction = 'income'::public.txn_direction
  ) then
    raise exception 'loan_split_income' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.loan_splits s
    join public.categories c
      on c.company_id = s.company_id
     and c.id = s.category_id
    where s.transaction_id = txn
      and (
        c.kind is distinct from 'expense'::public.category_kind
        or (
          s.part = 'interest'::public.loan_split_part
          and (c.loan_part is distinct from 'interest'::public.loan_split_part or c.excluded_from_pnl)
        )
        or (
          s.part = 'escrow'::public.loan_split_part
          and (c.loan_part is distinct from 'escrow'::public.loan_split_part or c.excluded_from_pnl)
        )
        or (
          s.part = 'principal'::public.loan_split_part
          and (c.loan_part is distinct from 'principal'::public.loan_split_part or c.excluded_from_pnl is distinct from true)
        )
      )
  ) then
    raise exception 'loan_split_category' using errcode = '23514';
  end if;

  -- Only the re-sync sets this, on every part. The sum and the currency wait.
  -- The owner has no grant on the column, so this cannot be used to skip the checks.
  if coalesce(stale, false) then
    return;
  end if;

  if exists (
    select 1
    from public.loan_splits s
    join public.loans l
      on l.company_id = s.company_id
     and l.id = s.loan_id
    join public.transactions t
      on t.company_id = s.company_id
     and t.id = s.transaction_id
    where s.transaction_id = txn
      and t.currency is distinct from l.currency
  ) then
    raise exception 'loan_split_currency' using errcode = '23514';
  end if;

  select t.amount_original
  into expected
  from public.transactions t
  where t.id = txn;

  if actual is distinct from expected then
    raise exception 'loan_split_sum' using errcode = '23514';
  end if;

  select s.loan_id into loan from public.loan_splits s where s.transaction_id = txn limit 1;

  -- Wait for any other write on this loan to commit, then read its parts too.
  -- The MCP attach path takes the same lock.
  perform 1 from public.loans l where l.id = loan for update;

  -- Same rule as public.loan_balances: posted principal still on the books,
  -- not waiting for review, may not pass the loan's principal.
  if exists (
    select 1
    from public.loans l
    where l.id = loan
      and l.principal_minor < private.loan_paid_principal(l.id)
  ) then
    raise exception 'loan_split_balance' using errcode = '23514';
  end if;
end;
$$;

revoke all on function private.loan_splits_check(uuid) from public, anon, authenticated;

-- A line that starts to count against a loan cannot be refused: the bank sync and undo
-- write it. If it takes the balance below zero, its parts wait for review instead, so the
-- balance leaves them out until the owner corrects the split (clear_loan_split_review
-- runs the balance check again).
create or replace function private.loan_line_counts_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  loan uuid;
begin
  select s.loan_id
  into loan
  from public.loan_splits s
  where s.company_id = new.company_id
    and s.transaction_id = new.id
    and s.part = 'principal'::public.loan_split_part
    and s.needs_review is not true
  limit 1;

  if loan is null then
    return null;
  end if;

  perform 1 from public.loans l where l.id = loan for update;

  if exists (
    select 1
    from public.loans l
    where l.id = loan
      and l.principal_minor < private.loan_paid_principal(l.id)
  ) then
    update public.loan_splits
       set needs_review = true
     where company_id = new.company_id
       and transaction_id = new.id
       and needs_review is distinct from true;
  end if;
  return null;
end;
$$;

revoke all on function private.loan_line_counts_check() from public, anon, authenticated;

create trigger transactions_loan_line_counts
  after update of line_status, removed_at on public.transactions
  for each row
  when (
    new.line_status = 'posted'::public.line_status
    and new.removed_at is null
    and (
      old.line_status is distinct from 'posted'::public.line_status
      or old.removed_at is not null
    )
  )
  execute function private.loan_line_counts_check();

-- Lowering the principal below what was already paid would take the balance below zero.
-- Raised as P0001, not 23514, so mcp_update_loan and mcp_undo return the message itself
-- ('loan balance exceeded') instead of 'invalid loan terms'.
create or replace function private.loans_principal_covers_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.principal_minor >= old.principal_minor then
    return new;
  end if;

  if new.principal_minor < private.loan_paid_principal(new.id) then
    raise exception 'loan balance exceeded';
  end if;
  return new;
end;
$$;

revoke all on function private.loans_principal_covers_paid() from public, anon, authenticated;

create trigger loans_principal_covers_paid
  before update of principal_minor on public.loans
  for each row
  execute function private.loans_principal_covers_paid();

commit;
