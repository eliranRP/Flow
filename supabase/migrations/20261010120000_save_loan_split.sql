-- Loan backend gaps from the FLOW-106 screens plan (plans/flow-106-loan-screens.md §9) and
-- FLOW-136 items 1 and 3.
-- 1. public.save_loan_split: the app's one write for a loan split. It attaches a payment, or
--    replaces the split of a line already attached to the same loan, in one transaction under
--    the loan lock (loan, then line, as mcp_attach_loan_payment), so a failure never leaves a
--    line half split. p_preview runs every check and returns the parts without writing. The
--    parts are checked like mcp_attach_loan_payment's: interest, escrow and principal once
--    each plus at most one fees part above zero, adding up to the line; principal within the
--    balance before this line; categories from the loan, else the keyed defaults, and fees
--    from the part, else the loan (no default, 0130). It does not file the line under the
--    loan's project (the app never did); the parts it writes are confirmed, so they never
--    wait for review.
-- 2. A demand loan's order checks run under that lock too: a line dated before the loan start
--    is refused (payment before the loan start), and so is a new line dated before another
--    payment already attached and not waiting for review, as flow-mcp counts payments (a later
--    payment is already attached). Correcting a line that is
--    already attached is not an order change, so it is allowed. mcp_attach_loan_payment runs
--    the same two checks under its loan lock (patched in place below), so two attaches on one
--    loan, from the app or MCP, wait for each other and cannot both take the same base.
-- 3. mcp_loan_payments reads the readable company, so a demo viewer sees the payments.
-- 4. FLOW-136 item 1: private.loan_line_closed_check reads the loan's status without a lock
--    first and returns when the loan is open, so a line on an open loan is never flagged
--    because another write held the loan.
-- 5. FLOW-136 item 3: a loan_rates row dated before its loan's start is refused in the
--    database (rate before the loan start), and so is moving a loan's start after a rate row.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function public.save_loan_split(
  p_transaction_id uuid,
  p_loan_id uuid,
  p_parts jsonb,
  p_preview boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  txn record;
  loan record;
  attached uuid;
  balance bigint;
  own_principal bigint := 0;
  parts_ok boolean;
  part jsonb;
  part_sum bigint := 0;
  principal_amt bigint := 0;
  has_fees boolean := false;
  call_fees_cat uuid;
  cat_interest uuid;
  cat_escrow uuid;
  cat_principal uuid;
  cat_fees uuid;
  result jsonb;
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (select 1 from public.company_viewers v where v.user_id = (select auth.uid())) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_transaction_id is null or p_loan_id is null
    or p_parts is null or jsonb_typeof(p_parts) <> 'array'
  then
    raise exception 'validation';
  end if;

  -- The loan first, then the line: the order every loan split write takes (no deadlock).
  select l.currency, l.kind, l.start_date, l.status, l.closed_on,
         l.interest_category_id, l.escrow_category_id, l.principal_category_id,
         l.fees_category_id
  into loan
  from public.loans l
  where l.id = p_loan_id and l.company_id = cid
  for update;
  if not found then
    raise exception 'loan not found';
  end if;

  select t.currency, t.amount_original, t.doc_date
  into txn
  from public.transactions t
  where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null
  for update;
  if not found then
    raise exception 'transaction not found';
  end if;

  select s.loan_id into attached
  from public.loan_splits s
  where s.transaction_id = p_transaction_id
  limit 1;
  if attached is not null and attached <> p_loan_id then
    raise exception 'loan already attached';
  end if;

  if loan.currency is distinct from txn.currency then
    raise exception 'loan currency mismatch';
  end if;
  if loan.status <> 'open'::public.loan_status and txn.doc_date > loan.closed_on then
    raise exception 'loan closed';
  end if;
  if loan.kind = 'demand'::public.loan_kind then
    if txn.doc_date < loan.start_date then
      raise exception 'payment before the loan start';
    end if;
    -- Interest runs from the last payment, so a new payment comes after every other one.
    if attached is null and exists (
      select 1
      from public.loan_splits s
      join public.transactions t on t.id = s.transaction_id and t.company_id = s.company_id
      where s.loan_id = p_loan_id
        and s.company_id = cid
        and t.removed_at is null
        and not s.needs_review
        and t.doc_date > txn.doc_date
    ) then
      raise exception 'a later payment is already attached';
    end if;
  end if;

  -- As in mcp_attach_loan_payment: interest, escrow and principal once each, plus at most one
  -- fees part above zero, as whole non-negative minor units. Only fees may name a category.
  select count(*) in (3, 4)
     and count(distinct e.value->>'part') = count(*)
     and count(*) filter (where e.value->>'part' in ('interest', 'escrow', 'principal')) = 3
     and bool_and(coalesce(
       jsonb_typeof(e.value) = 'object'
       and not exists (
         select 1 from jsonb_object_keys(e.value) k
         where k not in ('part', 'amount_minor', 'scheduled_minor', 'category_id')
       )
       and e.value->>'part' in ('interest', 'escrow', 'principal', 'fees')
       and jsonb_typeof(e.value->'amount_minor') = 'number'
       and jsonb_typeof(e.value->'scheduled_minor') = 'number'
       and (e.value->>'amount_minor') ~ '^[0-9]{1,15}$'
       and (e.value->>'scheduled_minor') ~ '^[0-9]{1,15}$'
       and (e.value->>'part' <> 'fees' or (e.value->>'amount_minor') !~ '^0+$')
       and (
         not (e.value ? 'category_id')
         or (
           e.value->>'part' = 'fees'
           and jsonb_typeof(e.value->'category_id') = 'string'
           and e.value->>'category_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         )
       ),
       false
     ))
  into parts_ok
  from jsonb_array_elements(p_parts) e;
  if not coalesce(parts_ok, false) then
    raise exception 'invalid loan parts';
  end if;

  for part in select value from jsonb_array_elements(p_parts)
  loop
    part_sum := part_sum + (part->>'amount_minor')::bigint;
    if part->>'part' = 'principal' then
      principal_amt := (part->>'amount_minor')::bigint;
    elsif part->>'part' = 'fees' then
      has_fees := true;
      call_fees_cat := (part->>'category_id')::uuid;
    end if;
  end loop;
  if part_sum is distinct from txn.amount_original then
    raise exception 'invalid loan parts';
  end if;

  -- The balance before this line: its own principal, when it is already attached, is added
  -- back. A part waiting for review lowers no balance, so it is not added back.
  select coalesce(sum(s.amount_minor), 0) into own_principal
  from public.loan_splits s
  where s.transaction_id = p_transaction_id
    and s.part = 'principal'::public.loan_split_part
    and not s.needs_review;
  select b.balance_minor into balance
  from public.loan_balances b
  where b.company_id = cid and b.loan_id = p_loan_id;
  balance := coalesce(balance, 0) + own_principal;
  if principal_amt > balance then
    raise exception 'loan balance exceeded';
  end if;

  if has_fees and call_fees_cat is not null then
    if not exists (select 1 from public.categories c where c.company_id = cid and c.id = call_fees_cat) then
      raise exception 'category not found';
    end if;
    if not private.loan_part_category_ok(cid, 'fees', call_fees_cat) then
      raise exception 'category does not fit the loan part';
    end if;
  end if;
  cat_fees := coalesce(call_fees_cat, loan.fees_category_id);
  if has_fees and cat_fees is null then
    raise exception 'fees category required';
  end if;

  cat_interest := coalesce(loan.interest_category_id, (
    select c.id from public.categories c
    where c.company_id = cid and c.loan_part = 'interest'::public.loan_split_part));
  cat_escrow := coalesce(loan.escrow_category_id, (
    select c.id from public.categories c
    where c.company_id = cid and c.loan_part = 'escrow'::public.loan_split_part));
  cat_principal := coalesce(loan.principal_category_id, (
    select c.id from public.categories c
    where c.company_id = cid and c.loan_part = 'principal'::public.loan_split_part));
  if cat_interest is null or cat_escrow is null or cat_principal is null then
    raise exception 'loan categories missing';
  end if;

  select jsonb_agg(jsonb_build_object(
    'part', e.value->>'part',
    'amount_minor', (e.value->>'amount_minor')::bigint,
    'scheduled_minor', (e.value->>'scheduled_minor')::bigint,
    'category_id', case e.value->>'part'
      when 'interest' then cat_interest
      when 'escrow' then cat_escrow
      when 'principal' then cat_principal
      when 'fees' then cat_fees
    end
  ) order by array_position(array['interest', 'escrow', 'principal', 'fees'], e.value->>'part'))
  into result
  from jsonb_array_elements(p_parts) e;

  result := jsonb_build_object(
    'transaction_id', p_transaction_id,
    'loan_id', p_loan_id,
    'replaced', attached is not null,
    'balance_after_minor', balance - principal_amt,
    'parts', result
  );
  if p_preview then
    return result;
  end if;

  delete from public.loan_splits
  where transaction_id = p_transaction_id and company_id = cid;
  insert into public.loan_splits (
    company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id
  )
  select cid, p_loan_id, p_transaction_id,
    (r->>'part')::public.loan_split_part,
    (r->>'amount_minor')::bigint,
    (r->>'scheduled_minor')::bigint,
    (r->>'category_id')::uuid
  from jsonb_array_elements(result->'parts') r;

  perform private.loan_splits_check(p_transaction_id);
  return result;
exception
  when check_violation then
    if sqlerrm = 'loan_split_balance' then
      raise exception 'loan balance exceeded';
    elsif sqlerrm = 'loan_closed' then
      raise exception 'loan closed';
    end if;
    raise;
end;
$$;

revoke all on function public.save_loan_split(uuid, uuid, jsonb, boolean) from public, anon;
grant execute on function public.save_loan_split(uuid, uuid, jsonb, boolean) to authenticated;

-- mcp_refused: as in 20261010090000_loan_kinds_rates.sql, plus the two demand order refusals.
create or replace function private.mcp_refused(p_message text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select private.mcp_error(
    'refused',
    case
      when p_message in (
        'no company',
        'unknown review action',
        'review item not found',
        'shared costs are split, not assigned to one project',
        'category is required',
        'project or category not found',
        'category kind must match the direction',
        'project and category are required',
        'transaction not found',
        'category not found',
        'project name is too short',
        'project already exists',
        'category name is too short',
        'category already exists',
        'unknown category kind',
        'in use',
        'loan not found',
        'loan currency mismatch',
        'loan already attached',
        'loan balance exceeded',
        'no schedule row for this date',
        'loan categories missing',
        'invalid loan terms',
        'loan category is fixed',
        'project not found',
        'parts must sum to the line',
        'line has a loan split',
        'line has a split by category',
        'line has an open review',
        'payment below interest',
        'invalid loan parts',
        'loan line is fixed',
        'parts exceed the line',
        'a part rounds to zero',
        'nothing is left for the rest',
        'line has no category for the rest',
        'a reversal part needs a project',
        'same category and project twice',
        'line amount is zero',
        -- FLOW-106 parts 1 and 2 (decisions 0122 and 0128).
        'closed_on required',
        'loan is open',
        'payments after closed_on',
        'loan closed',
        'category does not fit the loan part',
        -- FLOW-106 part 3 (decision 0130).
        'fees category required',
        -- FLOW-106 part 4 (decision 0132).
        'rate before the loan start',
        'rate not found',
        -- The demand order checks under the loan lock (FLOW-106 screens plan gap 3).
        'payment before the loan start',
        'a later payment is already attached'
      ) then p_message
      when p_message = 'loan_closed' then 'loan closed'
      else 'The write was refused.'
    end
  );
$$;

-- mcp_attach_loan_payment: as in 20261009200000_loan_fees_installments.sql, plus the demand
-- order checks under the loan lock (flow-mcp also checks them first, before reading the
-- accrual). Patched in place so the long body cannot drift.
do $attach$
declare
  def text;
  a1 constant text := 'select t.currency, t.amount_original';
  a2 constant text := 'select l.currency, l.project_id,';
  a3 constant text := $old$response := private.mcp_refused('loan currency mismatch');$old$;
begin
  def := pg_get_functiondef('public.mcp_attach_loan_payment(text,uuid,uuid,jsonb)'::regprocedure);
  if position(a1 in def) = 0 or position(a2 in def) = 0 or position(a3 in def) = 0
    or position('payment before the loan start' in def) > 0
  then
    raise exception 'mcp_attach_loan_payment is not the expected definition';
  end if;
  def := replace(def, a1, a1 || ', t.doc_date');
  def := replace(def, a2, a2 || ' l.kind, l.start_date,');
  def := replace(def, a3, a3 || $new$
      elsif loan.kind = 'demand'::public.loan_kind and txn.doc_date < loan.start_date then
        response := private.mcp_refused('payment before the loan start');
      elsif loan.kind = 'demand'::public.loan_kind and exists (
        select 1
        from public.loan_splits s
        join public.transactions t on t.id = s.transaction_id and t.company_id = s.company_id
        where s.loan_id = p_loan_id
          and s.company_id = cid
          and t.removed_at is null
          and not s.needs_review
          and t.doc_date > txn.doc_date
      ) then
        -- Interest runs from the last payment, so payments are attached in date order.
        response := private.mcp_refused('a later payment is already attached');$new$);
  execute def;
end
$attach$;

-- As in 20261010090000_loan_kinds_rates.sql; only the company changes, to the readable one.
create or replace function public.mcp_loan_payments(p_loan_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'transaction_id', p.transaction_id,
    'doc_date', p.doc_date,
    'line_status', p.line_status,
    'needs_review', p.needs_review,
    'interest_minor', p.interest_minor,
    'escrow_minor', p.escrow_minor,
    'principal_minor', p.principal_minor,
    'fees_minor', p.fees_minor
  ) order by p.doc_date, p.transaction_id), '[]'::jsonb)
  from (
    select
      s.transaction_id,
      t.doc_date,
      t.line_status,
      bool_or(s.needs_review) as needs_review,
      coalesce(sum(s.amount_minor) filter (where s.part::text = 'interest'), 0)::bigint as interest_minor,
      coalesce(sum(s.amount_minor) filter (where s.part::text = 'escrow'), 0)::bigint as escrow_minor,
      coalesce(sum(s.amount_minor) filter (where s.part::text = 'principal'), 0)::bigint as principal_minor,
      coalesce(sum(s.amount_minor) filter (where s.part::text = 'fees'), 0)::bigint as fees_minor
    from public.loan_splits s
    join public.transactions t
      on t.company_id = s.company_id
     and t.id = s.transaction_id
    where s.loan_id = p_loan_id
      and s.company_id = (select private.readable_company_id())
      and t.removed_at is null
    group by s.transaction_id, t.doc_date, t.line_status
  ) p;
$$;

-- As in 20261010090000_loan_kinds_rates.sql, plus the unlocked read of an open loan first.
create or replace function private.loan_line_closed_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  loan uuid;
  cur_status public.loan_status;
  loan_closed_on date;
begin
  select s.loan_id
  into loan
  from public.loan_splits s
  where s.company_id = new.company_id
    and s.transaction_id = new.id
    and s.needs_review is not true
  limit 1;

  if loan is null then
    return null;
  end if;

  -- FLOW-136: an open loan takes any date, so its line is never flagged, even while another
  -- write holds the loan. Closing a loan refuses a payment after closed_on, so a loan closed
  -- after this read cannot leave this line behind.
  select l.status into cur_status from public.loans l where l.id = loan;
  if cur_status = 'open'::public.loan_status then
    return null;
  end if;

  select l.status, l.closed_on
  into cur_status, loan_closed_on
  from public.loans l
  where l.id = loan
  for no key update skip locked;

  if not found
     or (cur_status <> 'open'::public.loan_status and new.doc_date > loan_closed_on)
  then
    update public.loan_splits
       set needs_review = true
     where company_id = new.company_id
       and transaction_id = new.id
       and needs_review is distinct from true;
  end if;
  return null;
end;
$$;

-- FLOW-136 item 3. A rate takes effect on or after its loan's start.
create or replace function private.loan_rates_start_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.loans l
    where l.company_id = new.company_id
      and l.id = new.loan_id
      and new.effective_date < l.start_date
  ) then
    raise exception 'rate before the loan start' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.loan_rates_start_check() from public, anon, authenticated;

create trigger loan_rates_start_check
  before insert or update of effective_date, loan_id on public.loan_rates
  for each row execute function private.loan_rates_start_check();

create or replace function private.loans_rates_start_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.loan_rates r
    where r.company_id = new.company_id
      and r.loan_id = new.id
      and r.effective_date < new.start_date
  ) then
    raise exception 'rate before the loan start' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.loans_rates_start_check() from public, anon, authenticated;

create trigger loans_rates_start_check
  before update of start_date on public.loans
  for each row
  when (new.start_date > old.start_date)
  execute function private.loans_rates_start_check();

commit;
