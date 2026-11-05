-- FLOW-1032 (decision 0254). Jev splits a loan payment instead of filing it whole.
--
-- Jev answers one category per line. A servicer's monthly payment got the loan interest category
-- for the whole amount, auto mode filled it, and no loan split was written: the balance did not
-- move and principal and escrow counted as interest. Now:
--
-- 1. jev_prefill never writes a loan-part category (categories.loan_part) on a whole line.
-- 2. The tagging job finds the one loan the payment belongs to and computes the split with the
--    same maths as attach_loan_payment; jev_prefill_loan writes it under jev_prefill's gates
--    (service role, review open, not assigned by the owner, the anomaly gate), with the same
--    checks as save_loan_split (now private.loan_split_write, shared by both).
-- 3. jev_loan_candidates gives the job each open scheduled loan's terms, balance and the amount
--    of its last attached payment (a recurring payment after an escrow change still matches).
-- 4. jev_prefills records the loan and the parts written; undo_jev_prefill clears that split
--    while it is still the one Jev wrote.

alter table public.jev_prefills
  add column loan_id uuid,
  add column loan_parts jsonb;

alter table public.jev_prefills drop constraint jev_prefills_wrote_chk;
alter table public.jev_prefills add constraint jev_prefills_wrote_chk
  check (project_id is not null or category_id is not null or loan_id is not null);

comment on column public.jev_prefills.loan_id is
  'FLOW-1032. The loan Jev split this line onto (the parts are in loan_parts); null for a project or category fill.';
comment on column public.jev_prefills.loan_parts is
  'FLOW-1032. The loan parts Jev wrote ([{part, amount_minor}]), so the undo can tell they are still Jev''s.';

-- The checks and the write of save_loan_split, for a company given by the caller. Unchanged body.
create or replace function private.loan_split_write(p_company uuid, p_transaction_id uuid, p_loan_id uuid, p_parts jsonb, p_preview boolean)
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
  cid := p_company;
  if cid is null then
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
$$;

revoke all on function private.loan_split_write(uuid, uuid, uuid, jsonb, boolean) from public, anon, authenticated, service_role;

comment on function private.loan_split_write(uuid, uuid, uuid, jsonb, boolean) is
  'FLOW-1032. The body of save_loan_split for a company the caller names: the checks, the categories, '
  'and (unless p_preview) the write through private.set_loan_parts. Used by save_loan_split and jev_prefill_loan.';

create or replace function public.save_loan_split(p_transaction_id uuid, p_loan_id uuid, p_parts jsonb, p_preview boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $$
declare
  cid uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (select 1 where private.is_read_only()) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  return private.loan_split_write(cid, p_transaction_id, p_loan_id, p_parts, coalesce(p_preview, false));
end;
$$;

-- What the job needs to match a payment to a loan and split it: open loans with a schedule.
create or replace function public.jev_loan_candidates(p_company uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_company is null then
    raise exception 'validation';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id,
      'currency', l.currency,
      'kind', l.kind,
      'status', l.status,
      'closed_on', l.closed_on,
      'principal_minor', l.principal_minor,
      'annual_rate_ppm', l.annual_rate_ppm,
      'term_months', l.term_months,
      'start_date', l.start_date,
      'payment_minor', l.payment_minor,
      'escrow_minor', l.escrow_minor,
      'interest_only_months', l.interest_only_months,
      'amortization_months', l.amortization_months,
      'balance_minor', b.balance_minor,
      'rates', coalesce((
        select jsonb_agg(jsonb_build_object('effective_date', r.effective_date, 'annual_rate_ppm', r.annual_rate_ppm)
          order by r.effective_date)
        from public.loan_rates r
        where r.company_id = l.company_id and r.loan_id = l.id
      ), '[]'::jsonb),
      -- The newest payment attached to this loan: its line's amount, for a recurring payment.
      'last_payment_minor', lp.amount_original,
      -- Every month (YYYY-MM) with a payment attached, so another payment in one of them (a
      -- catch-up, a duplicate, however late it syncs) is left to the owner.
      'attached_months', coalesce((
        select jsonb_agg(distinct to_char(t.doc_date, 'YYYY-MM'))
        from public.transactions t
        where t.company_id = l.company_id
          and t.removed_at is null
          and t.line_status = 'posted'::public.line_status
          and exists (
            select 1 from private.loan_parts s
            where s.company_id = t.company_id and s.transaction_id = t.id
              and s.loan_id = l.id and not s.needs_review
          )
      ), '[]'::jsonb)
    ) order by l.id), '[]'::jsonb)
    from public.loans l
    join public.loan_balances b on b.company_id = l.company_id and b.loan_id = l.id
    left join lateral (
      select t.amount_original
      from public.transactions t
      where t.company_id = l.company_id
        and t.removed_at is null
        and t.line_status = 'posted'::public.line_status
        and exists (
          select 1 from private.loan_parts s
          where s.company_id = t.company_id and s.transaction_id = t.id
            and s.loan_id = l.id and not s.needs_review
        )
      order by t.doc_date desc, t.id desc
      limit 1
    ) lp on true
    where l.company_id = p_company
      and l.status = 'open'::public.loan_status
      and l.kind <> 'demand'::public.loan_kind
      and l.term_months is not null
      and l.payment_minor is not null
      and b.balance_minor > 0
  );
end;
$$;

revoke all on function public.jev_loan_candidates(uuid) from public, anon, authenticated;
grant execute on function public.jev_loan_candidates(uuid) to service_role;

comment on function public.jev_loan_candidates(uuid) is
  'FLOW-1032. Service role (the jev-tag job): the company''s open loans with a schedule and a balance left, '
  'with their terms, rates, the amount of the newest payment attached to each and the months that have one.';

-- The job's loan split, under jev_prefill's gates. A refusal of the split checks writes nothing
-- and says why, so the line stays as the bank left it for the owner.
create or replace function public.jev_prefill_loan(
  p_company uuid, p_transaction uuid, p_loan uuid, p_parts jsonb,
  p_model text default null, p_confidence numeric default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $$
declare
  line public.transactions%rowtype;
  review public.review_status;
  score numeric;
  written jsonb;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_company is null or p_transaction is null or p_loan is null
    or p_parts is null or jsonb_typeof(p_parts) <> 'array'
  then
    raise exception 'validation';
  end if;

  -- The loan first, then the line: the order every loan split write takes (no deadlock).
  perform 1 from public.loans l where l.company_id = p_company and l.id = p_loan for update;
  if not found then
    return jsonb_build_object('loan', false, 'skipped', 'loan_not_found');
  end if;
  select * into line
  from public.transactions t
  where t.company_id = p_company and t.id = p_transaction and t.removed_at is null
  for update;
  if line.id is null or line.direction <> 'expense'::public.txn_direction then
    return jsonb_build_object('loan', false, 'skipped', 'not_found');
  end if;

  select q.status into review
  from public.review_queue q
  where q.company_id = p_company and q.transaction_id = p_transaction
  order by q.created_at desc, q.updated_at desc, q.id desc
  limit 1;
  if review is distinct from 'open' or line.user_assigned or line.category_assigned then
    return jsonb_build_object('loan', false, 'skipped', 'closed');
  end if;

  -- A line already split (onto a loan, or by category) is the owner's or an earlier fill's.
  if exists (
    select 1 from public.legs g
    where g.company_id = p_company and g.transaction_id = p_transaction
      and (g.loan_id is not null or g.split_part)
  ) then
    return jsonb_build_object('loan', false, 'skipped', 'split');
  end if;

  -- The anomaly gate, as in jev_prefill.
  if jsonb_array_length(private.line_anomalies(p_company, array[p_transaction])) > 0 then
    select case
        when jsonb_typeof(s.answers->'anomaly'->'noul') = 'number'
          and (s.answers->'anomaly'->>'noul')::numeric between 0 and 1
        then (s.answers->'anomaly'->>'noul')::numeric
      end
    into score
    from public.tag_suggestions s
    where s.company_id = p_company and s.transaction_id = p_transaction
    order by s.created_at desc, s.id desc
    limit 1;
    if score is null or score >= 0.5 then
      return jsonb_build_object('loan', false, 'skipped', 'flagged');
    end if;
  end if;

  begin
    written := private.loan_split_write(p_company, p_transaction, p_loan, p_parts, false);
  exception
    when raise_exception or check_violation or foreign_key_violation or unique_violation then
      return jsonb_build_object('loan', false, 'skipped', 'refused', 'reason', sqlerrm);
  end;

  insert into public.jev_prefills (
    company_id, transaction_id, model_version, confidence, loan_id, loan_parts,
    prior_category_id, prior_category_suggested, prior_allocations
  ) values (
    p_company, p_transaction, p_model, p_confidence, p_loan,
    (select jsonb_agg(jsonb_build_object('part', e->>'part', 'amount_minor', (e->>'amount_minor')::bigint)
       order by e->>'part')
     from jsonb_array_elements(written->'parts') e),
    line.category_id, coalesce(line.category_suggested, false), '[]'::jsonb
  );

  return jsonb_build_object('loan', true, 'loan_id', p_loan, 'parts', written->'parts');
end;
$$;

revoke all on function public.jev_prefill_loan(uuid, uuid, uuid, jsonb, text, numeric) from public, anon, authenticated;
grant execute on function public.jev_prefill_loan(uuid, uuid, uuid, jsonb, text, numeric) to service_role;

comment on function public.jev_prefill_loan(uuid, uuid, uuid, jsonb, text, numeric) is
  'FLOW-1032. Service role (the jev-tag job): split an open, unassigned, unsplit expense line onto a loan with the '
  'parts the job computed, under jev_prefill''s gates and save_loan_split''s checks; records a jev_prefills row.';

-- jev_prefill skips a loan category; undo_jev_prefill takes back a loan split (FLOW-1032).
create or replace function public.jev_prefill(
  p_company uuid,
  p_transaction uuid,
  p_project uuid default null,
  p_category uuid default null,
  p_model text default null,
  p_confidence numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  line public.transactions%rowtype;
  review public.review_status;
  shares integer;
  score numeric;
  prior_shares jsonb;
  wrote_project boolean := false;
  wrote_category boolean := false;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_company is null or p_transaction is null then
    raise exception 'validation';
  end if;

  select * into line
  from public.transactions t
  where t.company_id = p_company and t.id = p_transaction and t.removed_at is null
  for update;
  if line.id is null then
    return jsonb_build_object('project', false, 'category', false, 'skipped', 'not_found');
  end if;

  select q.status into review
  from public.review_queue q
  where q.company_id = p_company and q.transaction_id = p_transaction
  order by q.created_at desc, q.updated_at desc, q.id desc
  limit 1;
  if review is distinct from 'open' or line.user_assigned then
    return jsonb_build_object('project', false, 'category', false, 'skipped', 'closed');
  end if;

  -- The anomaly gate: a flagged line is left for the owner unless Jev scored the flag below 0.5.
  if jsonb_array_length(private.line_anomalies(p_company, array[p_transaction])) > 0 then
    select case
        when jsonb_typeof(s.answers->'anomaly'->'noul') = 'number'
          and (s.answers->'anomaly'->>'noul')::numeric between 0 and 1
        then (s.answers->'anomaly'->>'noul')::numeric
      end
    into score
    from public.tag_suggestions s
    where s.company_id = p_company and s.transaction_id = p_transaction
    order by s.created_at desc, s.id desc
    limit 1;
    if score is null or score >= 0.5 then
      return jsonb_build_object('project', false, 'category', false, 'skipped', 'flagged');
    end if;
  end if;

  select count(*)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'project_id', a.project_id, 'share_bp', a.share_bp, 'amount_net', a.amount_net
    ) order by a.project_id), '[]'::jsonb)
  into shares, prior_shares
  from public.allocations a
  where a.company_id = p_company and a.transaction_id = p_transaction;

  -- One project, never on a shared, overhead or split line; a finished project only on a line
  -- dated on or before its last line. A value an earlier fill (not undone) already put on the
  -- line is not written again, so a re-tag with the same answer adds no layer to undo.
  if p_project is not null
     and not line.project_assigned
     and not (line.project_id is not distinct from p_project and exists (
       select 1 from public.jev_prefills jp
       where jp.company_id = p_company and jp.transaction_id = p_transaction
         and jp.undone_at is null and jp.project_id = p_project))
     and coalesce(line.pnl_role::text, '') not in ('shared', 'overhead')
     and shares <= 1
     and exists (
       select 1 from public.projects p
       where p.company_id = p_company and p.id = p_project
         and (p.status = 'active' or line.doc_date <= (
           select max(t.doc_date) from public.transactions t
           where t.company_id = p_company and t.project_id = p.id and t.removed_at is null
             and t.id <> p_transaction
         ))
     )
  then
    update public.transactions
    set project_id = p_project
    where company_id = p_company and id = p_transaction;
    -- Expenses carry one allocation with the line's amount; income lines have none.
    if line.direction = 'expense' then
      delete from public.allocations
      where company_id = p_company and transaction_id = p_transaction;
      insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
      values (p_company, p_transaction, p_project, 10000, line.amount_net);
    end if;
    wrote_project := true;
  end if;

  if p_category is not null
     and not line.category_assigned
     and not (line.category_id is not distinct from p_category and exists (
       select 1 from public.jev_prefills jp
       where jp.company_id = p_company and jp.transaction_id = p_transaction
         and jp.undone_at is null and jp.category_id = p_category))
     and exists (
       select 1 from public.categories c
       where c.company_id = p_company and c.id = p_category
         and c.kind::text = line.direction::text and not c.hidden
         -- FLOW-1032: a loan category on a whole line is wrong: a loan payment is split instead.
         and c.loan_part is null
     )
  then
    update public.transactions
    set category_id = p_category,
        category_suggested = true
    where company_id = p_company and id = p_transaction;
    wrote_category := true;
  end if;

  if wrote_project or wrote_category then
    insert into public.jev_prefills (
      company_id, transaction_id, model_version, confidence, project_id, category_id,
      prior_project_id, prior_category_id, prior_category_suggested, prior_allocations
    ) values (
      p_company, p_transaction, p_model, p_confidence,
      case when wrote_project then p_project end, case when wrote_category then p_category end,
      case when wrote_project then line.project_id end,
      case when wrote_category then line.category_id end,
      coalesce(line.category_suggested, false),
      case when wrote_project then prior_shares else '[]'::jsonb end
    );
  end if;

  return jsonb_build_object('project', wrote_project, 'category', wrote_category);
end;
$$;


create or replace function public.undo_jev_prefill(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  line public.transactions%rowtype;
  fill public.jev_prefills%rowtype;
  review public.review_status;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select * into line
  from public.transactions t
  where t.company_id = cid and t.id = p_transaction_id and t.removed_at is null
  for update;
  if line.id is null then
    raise exception 'transaction not found';
  end if;
  select * into fill
  from public.jev_prefills jp
  where jp.company_id = cid and jp.transaction_id = p_transaction_id and jp.undone_at is null
  order by jp.created_at desc, jp.id desc
  limit 1;
  if fill.id is null then
    raise exception 'nothing to undo';
  end if;
  select q.status into review
  from public.review_queue q
  where q.company_id = cid and q.transaction_id = p_transaction_id
  order by q.created_at desc, q.updated_at desc, q.id desc
  limit 1;
  if review is distinct from 'open' then
    raise exception 'review item not found';
  end if;
  -- The owner's own choice wins: an assigned line or field, or values that are no longer Jev's
  -- (an expense also keeps the one allocation Jev wrote), is not undone.
  if line.user_assigned
     or (fill.project_id is not null and (line.project_assigned
       or line.project_id is distinct from fill.project_id
       or (line.direction = 'expense' and (
         (select count(*) from public.allocations a
          where a.company_id = cid and a.transaction_id = p_transaction_id) <> 1
         or not exists (
           select 1 from public.allocations a
           where a.company_id = cid and a.transaction_id = p_transaction_id
             and a.project_id = fill.project_id and a.share_bp = 10000)))))
     or (fill.category_id is not null and (line.category_assigned
       or line.category_id is distinct from fill.category_id))
     -- FLOW-1032: a loan split comes back only while it is still the one Jev wrote.
     or (fill.loan_id is not null and (line.category_assigned
       or fill.loan_parts is distinct from (
         select jsonb_agg(jsonb_build_object('part', s.part::text, 'amount_minor', s.amount_minor) order by s.part::text)
         from private.loan_parts s
         where s.company_id = cid and s.transaction_id = p_transaction_id and s.loan_id = fill.loan_id
           and not s.needs_review)
       or exists (
         select 1 from private.loan_parts s
         where s.company_id = cid and s.transaction_id = p_transaction_id
           and (s.loan_id <> fill.loan_id or s.needs_review))))
  then
    raise exception 'line changed since';
  end if;

  if fill.loan_id is not null then
    -- The line posts whole again, under the category it had before (the split never changed it).
    perform private.set_loan_parts(cid, p_transaction_id, fill.loan_id, null);
  end if;

  if fill.project_id is not null then
    update public.transactions
    set project_id = fill.prior_project_id
    where company_id = cid and id = p_transaction_id;
    if line.direction = 'expense' then
      delete from public.allocations
      where company_id = cid and transaction_id = p_transaction_id;
      insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
      select cid, p_transaction_id, (a->>'project_id')::uuid, (a->>'share_bp')::integer, (a->>'amount_net')::bigint
      from jsonb_array_elements(fill.prior_allocations) a;
    end if;
  end if;
  if fill.category_id is not null then
    update public.transactions
    set category_id = fill.prior_category_id,
        category_suggested = fill.prior_category_suggested
    where company_id = cid and id = p_transaction_id;
  end if;
  update public.jev_prefills
  set undone_at = now(), undone_by = auth.uid()
  where id = fill.id;

  return jsonb_build_object(
    'transaction_id', p_transaction_id,
    'loan_id', fill.loan_id,
    'project_id', case when fill.project_id is not null then fill.prior_project_id else line.project_id end,
    'category_id', case when fill.category_id is not null then fill.prior_category_id else line.category_id end
  );
end;
$$;

