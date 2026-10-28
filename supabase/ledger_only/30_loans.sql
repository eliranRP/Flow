-- ===========================================================================
-- 30 loans. Loan payment parts are legs (decision 0232): the loan writers go through
-- private.set_loan_parts / set_loan_parts_review, the readers read private.loan_parts.
-- ===========================================================================

-- Move one part of a line's loan payment to another category: the line's parts are read, the
-- part's category changed, and the whole set written back (the writer checks and posts the line).
create or replace function private.set_loan_part_category(
  p_company uuid, p_txn uuid, p_part public.loan_split_part, p_category uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  loan uuid;
  parts jsonb;
begin
  select min(s.loan_id::text)::uuid,
    jsonb_agg(jsonb_build_object(
      'part', s.part,
      'amount_minor', s.amount_minor,
      'scheduled_minor', s.scheduled_minor,
      'category_id', case when s.part = p_part then p_category else s.category_id end,
      'needs_review', s.needs_review
    ) order by s.part)
  into loan, parts
  from private.loan_parts s
  where s.company_id = p_company and s.transaction_id = p_txn;
  if loan is null then
    raise exception 'line has no loan split';
  end if;
  perform private.set_loan_parts(p_company, p_txn, loan, parts);
end;
$$;

revoke all on function private.set_loan_part_category(uuid, uuid, public.loan_split_part, uuid)
  from public, anon, authenticated, service_role;

comment on function private.set_loan_part_category(uuid, uuid, public.loan_split_part, uuid) is
  'Decision 0232. Sets the category of one part of a line''s loan payment through set_loan_parts '
  '(the loan rules are checked and the line posted). Used by the MCP loan category writes and their undo.';

create or replace function public.save_loan_split(p_transaction_id uuid, p_loan_id uuid, p_parts jsonb, p_preview boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    if exists (select 1 where private.is_read_only()) then
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
  from private.loan_parts s
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
      select 1 from private.loan_parts s
      where s.transaction_id = p_transaction_id and not s.needs_review
    ) and exists (
      select 1
      from private.loan_parts s
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
  from private.loan_parts s
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
  cat_fees := coalesce(call_fees_cat,
    private.loan_part_category_on(cid, p_loan_id, 'fees', txn.doc_date));
  if has_fees and cat_fees is null then
    raise exception 'fees category required';
  end if;

  cat_interest := coalesce(call_interest_cat,
    private.loan_part_category_on(cid, p_loan_id, 'interest', txn.doc_date));
  cat_escrow := coalesce(call_escrow_cat,
    private.loan_part_category_on(cid, p_loan_id, 'escrow', txn.doc_date));
  cat_principal := coalesce(call_principal_cat,
    private.loan_part_category_on(cid, p_loan_id, 'principal', txn.doc_date));
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

  -- The new parts replace the line's (none flagged), checked and posted by the writer.
  perform private.set_loan_parts(cid, p_transaction_id, p_loan_id, result->'parts');
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
$function$;

create or replace function public.clear_loan_split(p_transaction_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  attached uuid;
  removed jsonb;
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (select 1 where private.is_read_only()) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_transaction_id is null then
    raise exception 'validation';
  end if;

  select s.loan_id into attached
  from private.loan_parts s
  where s.transaction_id = p_transaction_id and s.company_id = cid
  limit 1;

  -- The loan first, then the line: the order every loan split write takes (no deadlock).
  if attached is not null then
    perform 1 from public.loans l where l.id = attached and l.company_id = cid for update;
  end if;
  perform 1
  from public.transactions t
  where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null
  for update;
  if not found then
    raise exception 'transaction not found';
  end if;
  -- Attached or detached by another write while this one waited for the locks: the caller
  -- retries (40001 is a retry, not a refusal, so MCP does not store it under its key).
  if (select s.loan_id from private.loan_parts s
      where s.transaction_id = p_transaction_id and s.company_id = cid limit 1)
     is distinct from attached then
    raise exception 'loan split changed' using errcode = '40001';
  end if;

  select jsonb_agg(jsonb_build_object(
    'part', s.part,
    'amount_minor', s.amount_minor,
    'scheduled_minor', s.scheduled_minor,
    'category_id', s.category_id,
    'needs_review', s.needs_review
  ) order by s.part)
  into removed
  from private.loan_parts s
  where s.transaction_id = p_transaction_id
    and s.company_id = cid
    and s.loan_id = attached;

  if removed is null then
    raise exception 'line has no loan split';
  end if;

  -- The line posts whole again.
  perform private.set_loan_parts(cid, p_transaction_id, attached, null);

  return jsonb_build_object(
    'transaction_id', p_transaction_id,
    'loan_id', attached,
    'parts', removed
  );
end;
$function$;

create or replace function public.clear_loan_split_review(p_transaction_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  company uuid;
  parts integer;
begin
  company := private.current_company_id();
  if company is null then
    raise exception 'loan_split_review_denied' using errcode = '42501';
  end if;

  select count(*)::integer
  into parts
  from private.loan_parts s
  where s.transaction_id = p_transaction_id
    and s.company_id = company;

  if parts = 0 then
    raise exception 'loan_split_review_denied' using errcode = '42501';
  end if;

  -- Clearing the flag re-checks the closed loan and the loan rules, and posts the line.
  perform private.set_loan_parts_review(company, p_transaction_id, false);
end;
$function$;

create or replace function public.mcp_attach_loan_payment(p_idempotency_key text, p_transaction_id uuid, p_loan_id uuid, p_parts jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  response jsonb;
  txn record;
  loan record;
  balance bigint;
  part jsonb;
  part_sum bigint := 0;
  principal_amt bigint := 0;
  parts_ok boolean;
  written jsonb;
  cat_interest uuid;
  cat_escrow uuid;
  cat_principal uuid;
  cat_fees uuid;
  call_fees_cat uuid;
  call_interest_cat uuid;
  call_escrow_cat uuid;
  call_principal_cat uuid;
  has_fees boolean := false;
  line record;
  inherited boolean := false;
  inherit_reason text;
  reassign_id uuid;
  write_prior jsonb;
  cur_role public.pnl_role;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_transaction_id is null
    or p_loan_id is null
    or p_parts is null
    or jsonb_typeof(p_parts) <> 'array'
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'loan_split|' || p_transaction_id::text || '|' || p_loan_id::text || '|' || p_parts::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  response := private.mcp_error('refused', 'The write was refused.');
  begin
    -- Lock the loan before the transaction: every loan part write takes its locks in
    -- that order (loan, then transaction), so the reverse deadlocks.
    perform 1 from public.loans l
    where l.id = p_loan_id
      and l.company_id = cid
    for update;

    select t.currency, t.amount_original, t.doc_date
    into txn
    from public.transactions t
    where t.id = p_transaction_id
      and t.company_id = cid
      and t.removed_at is null
    for update;

    if not found then
      response := private.mcp_refused('transaction not found');
    elsif exists (
      select 1 from private.loan_parts s where s.transaction_id = p_transaction_id
    ) then
      response := private.mcp_refused('loan already attached');
    else
      select l.currency, l.project_id, l.kind, l.start_date,
             l.interest_category_id, l.escrow_category_id, l.principal_category_id,
             l.fees_category_id
      into loan
      from public.loans l
      where l.id = p_loan_id
        and l.company_id = cid
      for update;

      if not found then
        response := private.mcp_refused('loan not found');
      elsif loan.currency is distinct from txn.currency then
        response := private.mcp_refused('loan currency mismatch');
      elsif loan.kind = 'demand'::public.loan_kind and txn.doc_date < loan.start_date then
        response := private.mcp_refused('payment before the loan start');
      elsif loan.kind = 'demand'::public.loan_kind and exists (
        select 1
        from private.loan_parts s
        join public.transactions t on t.id = s.transaction_id and t.company_id = s.company_id
        where s.loan_id = p_loan_id
          and s.company_id = cid
          and t.removed_at is null
          and not s.needs_review
          and t.doc_date > txn.doc_date
      ) then
        -- Interest runs from the last payment, so payments are attached in date order.
        response := private.mcp_refused('a later payment is already attached');
      else
        select b.balance_minor into balance
        from public.loan_balances b
        where b.company_id = cid and b.loan_id = p_loan_id;

        if coalesce(balance, 0) <= 0 then
          response := private.mcp_refused('loan balance exceeded');
        else
          -- Exactly interest, escrow and principal, once each, plus at most one fees part
          -- above zero (0130), as whole non-negative minor units. Only the fees part may
          -- name a category_id (a uuid string): this payment's fees category.
          select count(*) in (3, 4)
             and count(distinct e.value->>'part') = count(*)
             and count(*) filter (where e.value->>'part' in ('interest', 'escrow', 'principal')) = 3
             -- coalesce: a missing key is null, and bool_and would skip it.
             and bool_and(coalesce(
               jsonb_typeof(e.value) = 'object'
               and e.value->>'part' in ('interest', 'escrow', 'principal', 'fees')
               and jsonb_typeof(e.value->'amount_minor') = 'number'
               and jsonb_typeof(e.value->'scheduled_minor') = 'number'
               and (e.value->>'amount_minor') ~ '^[0-9]{1,18}$'
               and (e.value->>'scheduled_minor') ~ '^[0-9]{1,18}$'
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

          if coalesce(parts_ok, false) then
            for part in select value from jsonb_array_elements(p_parts)
            loop
              part_sum := part_sum + (part->>'amount_minor')::bigint;
              if part->>'part' = 'principal' then
                principal_amt := (part->>'amount_minor')::bigint;
              end if;
              if part->>'part' = 'fees' then
                has_fees := true;
                call_fees_cat := (part->>'category_id')::uuid;
              end if;
              if part->>'part' = 'interest' then
                call_interest_cat := (part->>'category_id')::uuid;
              elsif part->>'part' = 'escrow' then
                call_escrow_cat := (part->>'category_id')::uuid;
              elsif part->>'part' = 'principal' then
                call_principal_cat := (part->>'category_id')::uuid;
              end if;
            end loop;
          end if;

          if not coalesce(parts_ok, false) or part_sum is distinct from txn.amount_original then
            response := private.mcp_refused('invalid loan parts');
          elsif principal_amt > balance then
            response := private.mcp_refused('loan balance exceeded');
          elsif exists (
            select 1 from jsonb_array_elements(p_parts) e
            where e.value ? 'category_id'
              and not exists (
                select 1 from public.categories c
                where c.company_id = cid and c.id = (e.value->>'category_id')::uuid
              )
          ) then
            response := private.mcp_refused('category not found');
          elsif exists (
            select 1 from jsonb_array_elements(p_parts) e
            where e.value ? 'category_id'
              and not private.loan_part_category_ok(
                cid, (e.value->>'part')::public.loan_split_part, (e.value->>'category_id')::uuid
              )
          ) then
            response := private.mcp_refused('category does not fit the loan part');
          elsif has_fees and call_fees_cat is not null and not exists (
            select 1 from public.categories c where c.company_id = cid and c.id = call_fees_cat
          ) then
            response := private.mcp_refused('category not found');
          elsif has_fees and call_fees_cat is not null
            and not private.loan_part_category_ok(cid, 'fees', call_fees_cat)
          then
            response := private.mcp_refused('category does not fit the loan part');
          elsif has_fees and coalesce(
            call_fees_cat, private.loan_part_category_on(cid, p_loan_id, 'fees', txn.doc_date)
          ) is null then
            -- No default for fees: the call or the loan names the category (owner, 2026-10-08).
            response := private.mcp_refused('fees category required');
          else
            -- The loan's own category for a part wins; null keeps the keyed default (0128).
            cat_interest := coalesce(call_interest_cat,
              private.loan_part_category_on(cid, p_loan_id, 'interest', txn.doc_date));
            cat_escrow := coalesce(call_escrow_cat,
              private.loan_part_category_on(cid, p_loan_id, 'escrow', txn.doc_date));
            cat_principal := coalesce(call_principal_cat,
              private.loan_part_category_on(cid, p_loan_id, 'principal', txn.doc_date));
            if cat_interest is null then
              select c.id into cat_interest
              from public.categories c
              where c.company_id = cid and c.loan_part = 'interest'::public.loan_split_part;
            end if;
            if cat_escrow is null then
              select c.id into cat_escrow
              from public.categories c
              where c.company_id = cid and c.loan_part = 'escrow'::public.loan_split_part;
            end if;
            if cat_principal is null then
              select c.id into cat_principal
              from public.categories c
              where c.company_id = cid and c.loan_part = 'principal'::public.loan_split_part;
            end if;
            -- Fees go to this call's category, else the loan's; there is no default (0130).
            cat_fees := coalesce(call_fees_cat,
              private.loan_part_category_on(cid, p_loan_id, 'fees', txn.doc_date));

            if cat_interest is null or cat_escrow is null or cat_principal is null then
              response := private.mcp_refused('loan categories missing');
            else
              -- The writer checks the loan rules and posts the line.
              perform private.set_loan_parts(cid, p_transaction_id, p_loan_id, (
                select jsonb_agg(jsonb_build_object(
                  'part', e.value->>'part',
                  'amount_minor', (e.value->>'amount_minor')::bigint,
                  'scheduled_minor', (e.value->>'scheduled_minor')::bigint,
                  'category_id', case (e.value->>'part')
                    when 'interest' then cat_interest
                    when 'escrow' then cat_escrow
                    when 'principal' then cat_principal
                    when 'fees' then cat_fees
                  end
                ))
                from jsonb_array_elements(p_parts) e
              ));

              -- The split parts count under the loan's project through the line's
              -- own project. Only a line with no project, no shares and no role
              -- inherits it. Anything the owner already set is left alone.
              select t.project_id, t.pnl_role, t.category_id, t.category_suggested
              into line
              from public.transactions t
              where t.id = p_transaction_id
                and t.company_id = cid;

              if loan.project_id is null then
                inherit_reason := 'loan has no project';
              elsif line.project_id is not null then
                inherit_reason := 'line already has a project';
              elsif line.pnl_role is not distinct from 'shared'::public.pnl_role
                or exists (
                  select 1 from public.allocations a
                  where a.transaction_id = p_transaction_id and a.company_id = cid
                )
              then
                inherit_reason := 'line has shares';
              elsif line.pnl_role is not null then
                inherit_reason := 'line has a role';
              elsif line.category_id is null then
                inherit_reason := 'line has no category';
              elsif line.category_suggested then
                -- Filing the line would confirm a guess and close its review item.
                inherit_reason := 'line category is a guess';
              else
                -- The same rule as assign_expense: a direct cost on the project.
                -- A failure here leaves the line as it was; the parts stay attached.
                begin
                  reassign_id := public.reassign_transaction(
                    p_transaction_id, loan.project_id, line.category_id
                  );
                  inherited := true;
                exception
                  when deadlock_detected or serialization_failure or lock_not_available then
                    raise;
                  when others then
                    inherit_reason := 'project not set';
                end;
              end if;

              if inherited then
                -- The role reassign_transaction gave the line: project for an expense
                -- category, none for an income (reversal) category. Undo checks it.
                select t.pnl_role into cur_role
                from public.transactions t
                where t.id = p_transaction_id
                  and t.company_id = cid;
                write_prior := jsonb_build_object(
                  'project_id', loan.project_id,
                  'category_id', line.category_id,
                  'pnl_role', cur_role
                );
              end if;

              -- Kept so undo can tell whether the app corrected the split afterwards.
              select jsonb_agg(jsonb_build_object(
                'part', s.part,
                'amount_minor', s.amount_minor,
                'category_id', s.category_id
              ) order by s.part)
              into written
              from private.loan_parts s
              where s.transaction_id = p_transaction_id;
              write_prior := coalesce(write_prior, '{}'::jsonb)
                || jsonb_build_object('parts', written);

              -- FLOW-151: the line had no loan split, so an open loan_split write on it is stale
              -- (detach_loan_payment leaves it open). Supersede it, as a review write is, so the
              -- one open write per line is this attach, which undo targets.
              update private.mcp_writes
              set undone_at = clock_timestamp()
              where user_id = auth.uid()
                and kind = 'loan_split'
                and transaction_id = p_transaction_id
                and undone_at is null;

              insert into private.mcp_writes (
                token_id, user_id, kind, loan_id, transaction_id, reassign_id, prior
              )
              values (
                token, auth.uid(), 'loan_split', p_loan_id, p_transaction_id, reassign_id, write_prior
              );

              response := jsonb_build_object(
                'ok', true,
                'data', jsonb_build_object(
                  'loan_id', p_loan_id,
                  'transaction_id', p_transaction_id,
                  'project_inherited', inherited,
                  'project_id', case when inherited then loan.project_id end,
                  'project_inherited_reason', inherit_reason,
                  'undo_kind', 'loan_split'
                )
              );
            end if;
          end if;
        end if;
      end if;
    end if;
  exception
    when check_violation then
      if sqlerrm = 'loan_split_balance' then
        response := private.mcp_refused('loan balance exceeded');
      else
        response := private.mcp_refused(sqlerrm);
      end if;
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$function$;

create or replace function public.mcp_set_loan_category_from(p_idempotency_key text, p_loan_id uuid, p_part text, p_effective_date date, p_category_id uuid, p_apply_to_existing boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  response jsonb;
  part_key public.loan_split_part;
  loan record;
  cur record;
  switch_id uuid;
  next_date date;
  item record;
  target uuid;
  moved jsonb := '[]'::jsonb;
  shown jsonb := '[]'::jsonb;
  write_id uuid;
  refusal text;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_loan_id is null
    or p_part is null
    or p_part not in ('interest', 'escrow', 'principal', 'fees')
    or p_effective_date is null
    or p_apply_to_existing is null
  then
    return private.mcp_error('validation', 'validation');
  end if;
  part_key := p_part::public.loan_split_part;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'loan_category_from|' || p_loan_id::text || '|' || p_part || '|' || p_effective_date::text || '|'
    || coalesce(p_category_id::text, 'null') || '|' || p_apply_to_existing::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  response := private.mcp_error('refused', 'The write was refused.');
  begin
    select l.id, l.start_date into loan
    from public.loans l
    where l.id = p_loan_id and l.company_id = cid
    for no key update;

    if not found then
      refusal := 'loan not found';
    elsif p_effective_date < loan.start_date then
      refusal := 'switch before the loan start';
    elsif p_category_id is not null and not exists (
      select 1 from public.categories c where c.company_id = cid and c.id = p_category_id
    ) then
      refusal := 'category not found';
    elsif p_category_id is not null and not private.loan_part_category_ok(cid, part_key, p_category_id) then
      refusal := 'category does not fit the loan part';
    end if;

    if refusal is null then
      select w.id, w.category_id into cur
      from public.loan_category_switches w
      where w.company_id = cid and w.loan_id = p_loan_id and w.part = part_key
        and w.effective_date = p_effective_date
      for update;
      if not found and p_category_id is null then
        refusal := 'switch not found';
      end if;
    end if;

    if refusal is not null then
      response := private.mcp_refused(refusal);
    else
      if p_category_id is null then
        delete from public.loan_category_switches w where w.id = cur.id;
        switch_id := cur.id;
      elsif cur.id is null then
        insert into public.loan_category_switches (company_id, loan_id, part, effective_date, category_id)
        values (cid, p_loan_id, part_key, p_effective_date, p_category_id)
        returning id into switch_id;
      else
        update public.loan_category_switches w set category_id = p_category_id where w.id = cur.id;
        switch_id := cur.id;
      end if;

      if p_apply_to_existing then
        -- The payments this switch now decides: from its date until the next switch.
        select min(w.effective_date) into next_date
        from public.loan_category_switches w
        where w.company_id = cid and w.loan_id = p_loan_id and w.part = part_key
          and w.effective_date > p_effective_date;
        perform 1 from public.transactions t
        where t.company_id = cid
          and t.id in (select s.transaction_id from private.loan_parts s
                       where s.company_id = cid and s.loan_id = p_loan_id and s.part = part_key)
        order by t.id
        for update;
        for item in
          select s.leg_id as split_id, s.transaction_id, s.category_id, t.doc_date
          from private.loan_parts s
          join public.transactions t on t.id = s.transaction_id and t.company_id = s.company_id
          where s.company_id = cid
            and s.loan_id = p_loan_id
            and s.part = part_key
            and t.removed_at is null
            and t.doc_date >= p_effective_date
            and (next_date is null or t.doc_date < next_date)
          order by t.doc_date, s.transaction_id
        loop
          target := private.loan_part_category_on(cid, p_loan_id, part_key, item.doc_date);
          if target is null then
            raise exception 'fees category required';
          end if;
          if target is distinct from item.category_id then
            perform private.set_loan_part_category(cid, item.transaction_id, part_key, target);
            moved := moved || jsonb_build_object(
              'split_id', item.split_id, 'transaction_id', item.transaction_id,
              'before', item.category_id, 'written', target);
            shown := shown || jsonb_build_object(
              'transaction_id', item.transaction_id, 'doc_date', item.doc_date,
              'previous_category_id', item.category_id, 'category_id', target);
          end if;
        end loop;
      end if;

      insert into private.mcp_writes (token_id, user_id, kind, loan_id, company_id, prior, created_at)
      values (
        token, auth.uid(), 'loan_category_from', p_loan_id, cid,
        jsonb_build_object(
          'part', p_part,
          'effective_date', p_effective_date,
          'switch_id', switch_id,
          'before', cur.category_id,
          'after', p_category_id,
          'moved', moved
        ),
        clock_timestamp()
      )
      returning id into write_id;

      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
          'id', write_id,
          'loan_id', p_loan_id,
          'part', p_part,
          'effective_date', p_effective_date,
          'category_id', p_category_id,
          'previous_category_id', cur.category_id,
          'moved', shown,
          'undo_kind', 'loan_category_from'
        )
      );
    end if;
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$function$;

create or replace function public.mcp_set_loan_part_category(p_idempotency_key text, p_transaction_ids uuid[], p_part text, p_category_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  response jsonb;
  part_key public.loan_split_part;
  ids uuid[];
  item record;
  target uuid;
  written_rows jsonb := '[]'::jsonb;
  shown jsonb := '[]'::jsonb;
  write_id uuid;
  refusal text;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_transaction_ids is null
    or cardinality(p_transaction_ids) < 1
    or cardinality(p_transaction_ids) > 100
    or array_position(p_transaction_ids, null) is not null
    or p_part is null
    or p_part not in ('interest', 'escrow', 'principal', 'fees')
  then
    return private.mcp_error('validation', 'validation');
  end if;
  ids := array(select distinct x from unnest(p_transaction_ids) x order by x);
  if cardinality(ids) <> cardinality(p_transaction_ids) then
    return private.mcp_error('validation', 'validation');
  end if;
  part_key := p_part::public.loan_split_part;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'loan_part_category|' || p_part || '|' || coalesce(p_category_id::text, 'null') || '|'
    || array_to_string(ids, ',');
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  response := private.mcp_error('refused', 'The write was refused.');
  begin
    -- The loans first, in id order, then the lines: the order every loan split write takes.
    perform 1 from public.loans l
    where l.company_id = cid
      and l.id in (
        select s.loan_id from private.loan_parts s
        where s.company_id = cid and s.transaction_id = any (ids)
      )
    order by l.id
    for no key update;
    perform 1 from public.transactions t
    where t.company_id = cid and t.id = any (ids)
    order by t.id
    for update;

    if (
      select count(*) from public.transactions t
      where t.company_id = cid and t.id = any (ids) and t.removed_at is null
    ) <> cardinality(ids) then
      refusal := 'transaction not found';
    elsif exists (
      select 1 from unnest(ids) x
      where not exists (
        select 1 from private.loan_parts s where s.company_id = cid and s.transaction_id = x
      )
    ) then
      refusal := 'line has no loan split';
    elsif exists (
      select 1 from unnest(ids) x
      where not exists (
        select 1 from private.loan_parts s
        where s.company_id = cid and s.transaction_id = x and s.part = part_key
      )
    ) then
      refusal := 'payment has no such part';
    elsif p_category_id is not null and not exists (
      select 1 from public.categories c where c.company_id = cid and c.id = p_category_id
    ) then
      refusal := 'category not found';
    elsif p_category_id is not null and not private.loan_part_category_ok(cid, part_key, p_category_id) then
      refusal := 'category does not fit the loan part';
    end if;

    if refusal is not null then
      response := private.mcp_refused(refusal);
    else
      for item in
        select s.leg_id as split_id, s.transaction_id, s.loan_id, s.category_id, t.doc_date
        from private.loan_parts s
        join public.transactions t on t.id = s.transaction_id and t.company_id = s.company_id
        where s.company_id = cid and s.transaction_id = any (ids) and s.part = part_key
        order by s.transaction_id
      loop
        -- null: back to the category the payment would take today (a switch, the loan's, or
        -- the default), for its own date.
        target := coalesce(p_category_id, private.loan_part_category_on(cid, item.loan_id, part_key, item.doc_date));
        if target is null then
          raise exception 'fees category required';
        end if;
        if target is distinct from item.category_id then
          perform private.set_loan_part_category(cid, item.transaction_id, part_key, target);
        end if;
        written_rows := written_rows || jsonb_build_object(
          'split_id', item.split_id, 'transaction_id', item.transaction_id, 'loan_id', item.loan_id,
          'before', item.category_id, 'written', target);
        shown := shown || jsonb_build_object(
          'transaction_id', item.transaction_id, 'loan_id', item.loan_id,
          'previous_category_id', item.category_id, 'category_id', target);
      end loop;

      insert into private.mcp_writes (token_id, user_id, kind, company_id, prior, created_at)
      values (
        token, auth.uid(), 'loan_part_category', cid,
        jsonb_build_object('part', p_part, 'category_id', p_category_id, 'rows', written_rows),
        clock_timestamp()
      )
      returning id into write_id;

      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
          'id', write_id,
          'part', p_part,
          'category_id', p_category_id,
          'lines', shown,
          'undo_kind', 'loan_part_category'
        )
      );
    end if;
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$function$;

create or replace function private.loan_restore(p_company_id uuid, p_snapshot jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  loan_row public.loans;
  lines uuid[];
  locked integer;
  line uuid;
begin
  loan_row := jsonb_populate_record(null::public.loans, p_snapshot->'loan');
  if loan_row.id is null or loan_row.company_id is distinct from p_company_id then
    raise exception 'loan cannot be restored' using errcode = '23514';
  end if;
  if not exists (select 1 from public.projects p where p.id = loan_row.project_id and p.company_id = p_company_id) then
    loan_row.project_id := null;
  end if;
  if not exists (select 1 from public.categories c where c.id = loan_row.interest_category_id and c.company_id = p_company_id) then
    loan_row.interest_category_id := null;
  end if;
  if not exists (select 1 from public.categories c where c.id = loan_row.escrow_category_id and c.company_id = p_company_id) then
    loan_row.escrow_category_id := null;
  end if;
  if not exists (select 1 from public.categories c where c.id = loan_row.principal_category_id and c.company_id = p_company_id) then
    loan_row.principal_category_id := null;
  end if;
  if not exists (select 1 from public.categories c where c.id = loan_row.fees_category_id and c.company_id = p_company_id) then
    loan_row.fees_category_id := null;
  end if;
  -- FLOW-962: a new loan deleted since leaves no link, as its on delete set null would have.
  if loan_row.refinanced_into_id is not null and not exists (
    select 1 from public.loans l where l.id = loan_row.refinanced_into_id and l.company_id = p_company_id
  ) then
    loan_row.refinanced_into_id := null;
  end if;

  select coalesce(array_agg(distinct (e.value->>'transaction_id')::uuid), '{}')
  into lines
  from jsonb_array_elements(coalesce(p_snapshot->'parts', '[]'::jsonb)) e;

  select count(*) into locked
  from (
    select t.id
    from public.transactions t
    where t.company_id = p_company_id
      and t.id = any (lines)
    order by t.id
    for update
  ) l;
  if locked <> cardinality(lines)
     or exists (select 1 from public.loans l where l.id = loan_row.id)
     or exists (
       select 1 from private.loan_parts s
       where s.company_id = p_company_id and s.transaction_id = any (lines)
     )
  then
    raise exception 'loan cannot be restored' using errcode = '23514';
  end if;

  insert into public.loans select (loan_row).*;
  insert into public.loan_rates (id, company_id, loan_id, effective_date, annual_rate_ppm, created_at, updated_at)
  select r.id, r.company_id, r.loan_id, r.effective_date, r.annual_rate_ppm, r.created_at, r.updated_at
  from jsonb_populate_recordset(null::public.loan_rates, coalesce(p_snapshot->'rates', '[]'::jsonb)) r;
  insert into public.loan_category_switches (id, company_id, loan_id, part, effective_date, category_id, created_at, updated_at)
  select w.id, w.company_id, w.loan_id, w.part, w.effective_date, w.category_id, w.created_at, w.updated_at
  from jsonb_populate_recordset(null::public.loan_category_switches, coalesce(p_snapshot->'switches', '[]'::jsonb)) w
  where private.loan_part_category_ok(w.company_id, w.part, w.category_id);
  -- Each line gets its parts back through the writer, which checks the loan rules and posts it.
  foreach line in array lines loop
    perform private.set_loan_parts(p_company_id, line, loan_row.id, (
      select jsonb_agg(jsonb_build_object(
        'part', e.value->>'part',
        'amount_minor', (e.value->>'amount_minor')::bigint,
        'scheduled_minor', (e.value->>'scheduled_minor')::bigint,
        'category_id', (e.value->>'category_id')::uuid,
        'needs_review', coalesce((e.value->>'needs_review')::boolean, false)
      ))
      from jsonb_array_elements(coalesce(p_snapshot->'parts', '[]'::jsonb)) e
      where (e.value->>'transaction_id')::uuid = line
    ));
  end loop;
  -- FLOW-962: the loans that named this one before the delete, while they are still unlinked.
  update public.loans l
  set refinanced_into_id = loan_row.id
  where l.company_id = p_company_id
    and l.refinanced_into_id is null
    and l.id <> loan_row.id
    and l.id in (
      select e.value::uuid from jsonb_array_elements_text(coalesce(p_snapshot->'referrers', '[]'::jsonb)) e
    );
exception
  when check_violation or foreign_key_violation or unique_violation or not_null_violation then
    raise exception 'loan cannot be restored' using errcode = '23514';
end;
$function$;

create or replace function public.delete_loan(p_loan_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  loan_row public.loans;
  rates jsonb;
  switches jsonb;
  parts jsonb;
  payments integer;
  deletion uuid;
  referrers jsonb;
  line record;
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (select 1 where private.is_read_only()) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_loan_id is null then
    raise exception 'validation';
  end if;

  -- The loan first, then its lines: the order every loan split write takes (no deadlock).
  select * into loan_row
  from public.loans l
  where l.id = p_loan_id and l.company_id = cid
  for update;
  if not found then
    raise exception 'loan not found';
  end if;
  perform 1
  from public.transactions t
  where t.company_id = cid
    and t.id in (select s.transaction_id from private.loan_parts s where s.loan_id = p_loan_id and s.company_id = cid)
  order by t.id
  for update;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.effective_date), '[]'::jsonb)
  into rates
  from public.loan_rates r
  where r.loan_id = p_loan_id and r.company_id = cid;
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'transaction_id', s.transaction_id,
      'part', s.part,
      'amount_minor', s.amount_minor,
      'scheduled_minor', s.scheduled_minor,
      'category_id', s.category_id,
      'needs_review', s.needs_review
    ) order by s.transaction_id, s.part), '[]'::jsonb),
    count(distinct s.transaction_id) filter (where t.removed_at is null)::integer
  into parts, payments
  from private.loan_parts s
  join public.transactions t on t.id = s.transaction_id and t.company_id = s.company_id
  where s.loan_id = p_loan_id and s.company_id = cid;

  -- FLOW-962: the loans that name this one as their refinance, for the restore to relink.
  select coalesce(jsonb_agg(r.id order by r.id), '[]'::jsonb)
  into referrers
  from public.loans r
  where r.company_id = cid and r.refinanced_into_id = p_loan_id;

  select coalesce(jsonb_agg(to_jsonb(w) order by w.part, w.effective_date), '[]'::jsonb)
  into switches
  from public.loan_category_switches w
  where w.loan_id = p_loan_id and w.company_id = cid;

  -- Each payment line loses its loan parts and posts whole again; the rates and switches go
  -- with the loan (on delete cascade).
  for line in
    select distinct s.transaction_id from private.loan_parts s
    where s.loan_id = p_loan_id and s.company_id = cid
    order by s.transaction_id
  loop
    perform private.set_loan_parts(cid, line.transaction_id, p_loan_id, null);
  end loop;
  delete from public.loans l where l.id = p_loan_id and l.company_id = cid;

  insert into private.loan_deletions (company_id, loan_id, user_id, snapshot)
  values (cid, p_loan_id, auth.uid(),
    jsonb_build_object('loan', to_jsonb(loan_row), 'rates', rates, 'parts', parts, 'referrers', referrers,
      'switches', switches))
  returning id into deletion;

  return jsonb_build_object(
    'loan_id', p_loan_id,
    'name', loan_row.name,
    'payments', payments,
    'deletion_id', deletion
  );
end;
$function$;

create or replace function public.get_loan_split(p_transaction_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with parts as (
    select s.part, s.amount_minor, s.needs_review, s.loan_id, s.category_id
    from private.loan_parts s
    join public.transactions t on t.id = s.transaction_id
    where s.transaction_id = p_transaction_id
      and t.removed_at is null
      and s.company_id = (select private.readable_company_id())
  ),
  counted as (
    select l.part, l.in_pnl
    from private.pnl_lines l
    where l.transaction_id = p_transaction_id
      and l.part is not null
  )
  select case when not exists (select 1 from parts) then null else jsonb_build_object(
    'loan_id', (select min(loan_id::text)::uuid from parts),
    'loan_name', (
      select l.name from public.loans l
      where l.id = (select min(loan_id::text)::uuid from parts)
    ),
    'needs_review', (select bool_or(needs_review) from parts),
    'by_parts', exists (select 1 from counted),
    'parts', (
      select jsonb_agg(jsonb_build_object(
        'part', p.part,
        'amount_minor', p.amount_minor,
        'in_pnl', c.in_pnl,
        'category_id', p.category_id,
        'category_name', cat.name
      ) order by case p.part::text when 'interest' then 0 when 'escrow' then 1 when 'principal' then 2 else 3 end)
      from parts p
      left join counted c on c.part = p.part
      left join public.categories cat on cat.id = p.category_id
    )
  ) end;
$function$;

create or replace function public.mcp_list_loans()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'name', l.name,
    'currency', l.currency,
    'principal_minor', l.principal_minor,
    'annual_rate_ppm', l.annual_rate_ppm,
    'term_months', l.term_months,
    'start_date', l.start_date,
    'payment_minor', l.payment_minor,
    'escrow_minor', l.escrow_minor,
    'balance_minor', b.balance_minor,
    'flagged_parts', b.flagged_parts,
    'flagged_transaction_ids', coalesce((
      select jsonb_agg(f.transaction_id order by f.transaction_id)
      from (
        select distinct s.transaction_id
        from private.loan_parts s
        join public.transactions t
          on t.company_id = s.company_id
         and t.id = s.transaction_id
        where s.company_id = l.company_id
          and s.loan_id = l.id
          and s.needs_review
          and t.removed_at is null
          and t.line_status is distinct from 'void'::public.line_status
      ) f
    ), '[]'::jsonb),
    'project_id', l.project_id,
    'project_name', pr.name,
    'status', l.status,
    'closed_on', l.closed_on,
    'interest_category_id', l.interest_category_id,
    'interest_category_name', ci.name,
    'escrow_category_id', l.escrow_category_id,
    'escrow_category_name', ce.name,
    'principal_category_id', l.principal_category_id,
    'principal_category_name', cp.name,
    'fees_category_id', l.fees_category_id,
    'fees_category_name', cf.name,
    'kind', l.kind,
    'interest_only_months', l.interest_only_months,
    'amortization_months', l.amortization_months,
    'rate_index', l.rate_index,
    'rate_margin_ppm', l.rate_margin_ppm,
    'refinanced_into_id', l.refinanced_into_id,
    'category_switches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'part', w.part,
        'effective_date', w.effective_date,
        'category_id', w.category_id,
        'category_name', wc.name
      ) order by w.part, w.effective_date)
      from public.loan_category_switches w
      left join public.categories wc on wc.company_id = w.company_id and wc.id = w.category_id
      where w.company_id = l.company_id
        and w.loan_id = l.id
    ), '[]'::jsonb),
    'rates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'effective_date', r.effective_date,
        'annual_rate_ppm', r.annual_rate_ppm
      ) order by r.effective_date)
      from public.loan_rates r
      where r.company_id = l.company_id
        and r.loan_id = l.id
    ), '[]'::jsonb)
  ) order by l.sort_order nulls last, l.name, l.id), '[]'::jsonb)
  from public.loans l
  join public.loan_balances b
    on b.company_id = l.company_id
   and b.loan_id = l.id
  left join public.projects pr
    on pr.company_id = l.company_id
   and pr.id = l.project_id
  left join public.categories ci
    on ci.company_id = l.company_id
   and ci.id = l.interest_category_id
  left join public.categories ce
    on ce.company_id = l.company_id
   and ce.id = l.escrow_category_id
  left join public.categories cp
    on cp.company_id = l.company_id
   and cp.id = l.principal_category_id
  left join public.categories cf
    on cf.company_id = l.company_id
   and cf.id = l.fees_category_id
  where l.company_id = (select private.current_company_id());
$function$;

create or replace function public.mcp_loan_payments(p_loan_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
    from private.loan_parts s
    join public.transactions t
      on t.company_id = s.company_id
     and t.id = s.transaction_id
    where s.loan_id = p_loan_id
      and s.company_id = (select private.readable_company_id())
      and t.removed_at is null
      and t.line_status <> 'pending'
    group by s.transaction_id, t.doc_date, t.line_status
  ) p;
$function$;

create or replace function private.loans_close_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status <> 'open'::public.loan_status
     and (
       old.status is distinct from new.status
       or old.closed_on is distinct from new.closed_on
     )
  then
    perform 1
    from public.transactions t
    where t.company_id = new.company_id
      and t.id in (
        select s.transaction_id from private.loan_parts s
        where s.company_id = new.company_id and s.loan_id = new.id
      )
    order by t.id
    for share;
    if exists (
      select 1
      from private.loan_parts s
      join public.transactions t
        on t.company_id = s.company_id
       and t.id = s.transaction_id
      where s.company_id = new.company_id
        and s.loan_id = new.id
        and t.removed_at is null
        and t.doc_date > new.closed_on
    ) then
      raise exception 'loan_payments_after_close' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function private.loans_lock_currency()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.currency is distinct from old.currency
     and exists (
       select 1
       from private.loan_parts s
       where s.company_id = old.company_id
         and s.loan_id = old.id
     )
  then
    raise exception 'loan_currency_locked' using errcode = '23514';
  end if;
  return new;
end;
$function$;

