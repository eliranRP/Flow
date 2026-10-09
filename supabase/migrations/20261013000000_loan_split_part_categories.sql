-- FLOW-114 server follow-up from #252. save_loan_split took category_id only on the fees part,
-- so an edit of a split, or the undo of an unmatch, filed interest, escrow and principal under
-- the loan's categories (or the keyed defaults) again, even when the owner had moved a part to
-- another fitting category. Every part may now name its category, checked like fees by
-- private.loan_part_category_ok (decisions 0128 and 0130): the company's own, an expense
-- category, and in or out of the P&L as the part needs. A part that names none takes the loan's
-- category, else the keyed default, as before.
-- Otherwise as in 20261010120000_save_loan_split.sql. Grants are kept by create or replace.
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
  call_interest_cat uuid;
  call_escrow_cat uuid;
  call_principal_cat uuid;
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
    -- Interest runs from the last payment, so a new payment comes after every other one. A
    -- line whose parts all wait for review counts as no payment, so confirming it is new too.
    if not exists (
      select 1 from public.loan_splits s
      where s.transaction_id = p_transaction_id and not s.needs_review
    ) and exists (
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
  -- fees part above zero, as whole non-negative minor units. Unlike the MCP attach, which names
  -- only a fees category, any part here may name one.
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
           jsonb_typeof(e.value->'category_id') = 'string'
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
      call_principal_cat := (part->>'category_id')::uuid;
    elsif part->>'part' = 'interest' then
      call_interest_cat := (part->>'category_id')::uuid;
    elsif part->>'part' = 'escrow' then
      call_escrow_cat := (part->>'category_id')::uuid;
    elsif part->>'part' = 'fees' then
      has_fees := true;
      call_fees_cat := (part->>'category_id')::uuid;
    end if;
  end loop;
  if part_sum is distinct from txn.amount_original then
    raise exception 'invalid loan parts';
  end if;

  -- The balance before this line: its own principal, when it is already attached, is added
  -- back. A part waiting for review, or on a line not posted, lowers no balance
  -- (public.loan_balances), so it is not added back.
  select coalesce(sum(s.amount_minor), 0) into own_principal
  from public.loan_splits s
  join public.transactions t on t.id = s.transaction_id and t.company_id = s.company_id
  where s.transaction_id = p_transaction_id
    and s.part = 'principal'::public.loan_split_part
    and not s.needs_review
    and t.line_status = 'posted'::public.line_status;
  select b.balance_minor into balance
  from public.loan_balances b
  where b.company_id = cid and b.loan_id = p_loan_id;
  balance := coalesce(balance, 0) + own_principal;
  -- As in mcp_attach_loan_payment: a paid-off balance takes no payment, not even one of 0.
  if balance <= 0 or principal_amt > balance then
    raise exception 'loan balance exceeded';
  end if;

  -- A category named on a part must be the company's and fit that part (0128, 0130), so a part
  -- the owner moved to another fitting category keeps it through an edit or an unmatch undo.
  for part in select value from jsonb_array_elements(p_parts) where value ? 'category_id'
  loop
    if not exists (
      select 1 from public.categories c
      where c.company_id = cid and c.id = (part->>'category_id')::uuid
    ) then
      raise exception 'category not found';
    end if;
    if not private.loan_part_category_ok(
      cid, (part->>'part')::public.loan_split_part, (part->>'category_id')::uuid
    ) then
      raise exception 'category does not fit the loan part';
    end if;
  end loop;
  cat_fees := coalesce(call_fees_cat, loan.fees_category_id);
  if has_fees and cat_fees is null then
    raise exception 'fees category required';
  end if;

  cat_interest := coalesce(call_interest_cat, loan.interest_category_id, (
    select c.id from public.categories c
    where c.company_id = cid and c.loan_part = 'interest'::public.loan_split_part));
  cat_escrow := coalesce(call_escrow_cat, loan.escrow_category_id, (
    select c.id from public.categories c
    where c.company_id = cid and c.loan_part = 'escrow'::public.loan_split_part));
  cat_principal := coalesce(call_principal_cat, loan.principal_category_id, (
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

commit;
