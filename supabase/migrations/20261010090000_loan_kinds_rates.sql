-- FLOW-106 part 4: loan kinds and a variable rate. Decision 0131.
-- Also the loan follow-ups FLOW-132 (closed loans), FLOW-134 items 1 and 4 (part categories)
-- and FLOW-135 N3 (the MCP side; N1 and N3 are in tools.ts and packages/shared).
--
-- 1. loans.kind is amortizing (the default; every existing loan stays as it is),
--    interest_only (interest_only_months, 1 to the term), balloon (amortization_months, the
--    term to 600) or demand (no term, no fixed payment, no escrow). term_months and
--    payment_minor become nullable for demand loans only (loans_kind_chk).
-- 2. loan_rates (loan_id, effective_date, annual_rate_ppm), with RLS like loans. The rate in
--    force on a date is the latest row on or before it, else the loan's own rate.
-- 3. The "payment covers interest" guard runs per kind: a demand loan has no payment; an
--    interest-only or balloon loan's payment faces a month of interest on the full principal,
--    like an amortizing one. Rate changes recast the payment in the schedule, so they need no
--    guard.
-- 4. MCP: mcp_add_loan takes the kind fields, mcp_update_loan sets them (undo restores them),
--    mcp_list_loans returns them and the rate rows, mcp_loan_payments lists a loan's attached
--    payments, mcp_set_loan_rate adds, changes or removes a rate row (undo kind loan_rate).
-- 5. FLOW-132: a line attached to a closed loan that comes back from removal, or whose
--    doc_date moves past closed_on, has its parts flagged for review (as 0121 does for the
--    balance), and clearing that review re-runs the closed check. get_project's loans[]
--    gains status, closed_on and kind.
-- 6. FLOW-134: merge_category moves loans' part categories to the target when it fits the
--    part, else refuses the merge. mcp_update_loan checks the part categories in one loop,
--    and the loans part-category trigger runs on an update only when a category changes.
--
-- Functions copied from their newest definition (named at each one).
-- CLI 2.118.0 runs each statement on its own. This file is one transaction. It creates a new
-- enum type (loan_kind) and adds no value to an existing one, so the new values can be used
-- in this transaction; the in-transaction caveat of 20261009200000 does not apply.

begin;

set local lock_timeout = '5s';

create type public.loan_kind as enum ('amortizing', 'interest_only', 'balloon', 'demand');

alter table public.loans
  add column kind public.loan_kind not null default 'amortizing',
  add column interest_only_months integer,
  add column amortization_months integer,
  alter column term_months drop not null,
  alter column payment_minor drop not null;

-- One rule per kind. The term and payment checks of 20261004055306 still hold when set.
alter table public.loans
  add constraint loans_kind_chk check (coalesce(
    case kind
      when 'amortizing' then
        term_months is not null and payment_minor is not null
        and interest_only_months is null and amortization_months is null
      when 'interest_only' then
        term_months is not null and payment_minor is not null
        and interest_only_months between 1 and term_months and amortization_months is null
      when 'balloon' then
        term_months is not null and payment_minor is not null
        and amortization_months between term_months and 600 and interest_only_months is null
      when 'demand' then
        term_months is null and payment_minor is null and escrow_minor = 0
        and interest_only_months is null and amortization_months is null
    end,
    false
  ));

comment on column public.loans.kind is
  'amortizing (default), interest_only, balloon or demand. Decision 0131.';
comment on column public.loans.interest_only_months is
  'interest_only only: the first months pay interest (and escrow) only, 1 to the term.';
comment on column public.loans.amortization_months is
  'balloon only: the payment is the annuity over these months (the term to 600); the rest is due at the term.';
comment on column public.loans.term_months is
  'Months to the last payment. Null for a demand loan only.';
comment on column public.loans.payment_minor is
  'The regular payment, escrow included; for an interest-only loan, the one after the interest-only months. Null for a demand loan only.';

create table public.loan_rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  loan_id uuid not null,
  effective_date date not null,
  annual_rate_ppm integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (loan_id, effective_date),
  foreign key (company_id, loan_id)
    references public.loans (company_id, id)
    on delete cascade,
  constraint loan_rates_rate_chk check (annual_rate_ppm >= 0 and annual_rate_ppm <= 1000000)
);

comment on table public.loan_rates is
  'Rate changes of a loan. From effective_date on, the nominal annual rate is annual_rate_ppm; before the first row, loans.annual_rate_ppm. Entered by hand (MCP set_loan_rate); Flow does not fetch an index. Decision 0131.';

create index loan_rates_company_loan_idx on public.loan_rates (company_id, loan_id);

create trigger loan_rates_touch
  before update on public.loan_rates
  for each row execute function private.touch_updated_at();

alter table public.loan_rates enable row level security;

create policy loan_rates_select on public.loan_rates
  for select to authenticated
  using (company_id = (select private.readable_company_id()));

create policy loan_rates_insert on public.loan_rates
  for insert to authenticated
  with check (company_id = (select private.current_company_id()));

create policy loan_rates_update on public.loan_rates
  for update to authenticated
  using (company_id = (select private.current_company_id()))
  with check (company_id = (select private.current_company_id()));

create policy loan_rates_delete on public.loan_rates
  for delete to authenticated
  using (company_id = (select private.current_company_id()));

revoke all on public.loan_rates from public, anon, authenticated;
grant select, insert, update, delete on public.loan_rates to authenticated, service_role;

-- private.loans_payment_covers_interest: as in 20261007201111_loan_payment_checks.sql, per kind.
-- A demand loan has no payment to check. An interest-only loan's stored payment is the one
-- after the interest-only months, when the balance is still the whole principal, and a
-- balloon loan's faces month one like an amortizing loan: so all three check month one.
create or replace function private.loans_payment_covers_interest()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.principal_minor is not distinct from old.principal_minor
     and new.annual_rate_ppm is not distinct from old.annual_rate_ppm
     and new.payment_minor is not distinct from old.payment_minor
     and new.escrow_minor is not distinct from old.escrow_minor
     and new.kind is not distinct from old.kind
  then
    return new;
  end if;
  if new.kind = 'demand'::public.loan_kind or new.payment_minor is null then
    return new;
  end if;
  -- Out-of-range terms are left to the table's check constraints.
  if new.principal_minor > 0
     and new.annual_rate_ppm between 0 and 1000000
     and new.payment_minor > 0
     and new.escrow_minor >= 0
     and new.escrow_minor < new.payment_minor
     and not private.loan_payment_covers_interest(
       new.principal_minor, new.annual_rate_ppm, new.payment_minor, new.escrow_minor
     )
  then
    raise exception 'loan_payment_below_interest' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.loans_payment_covers_interest() from public, anon, authenticated;

-- private.mcp_writes: as in 20261007210000_line_pnl_override.sql, plus loan_rate. Its prior
-- holds the rate row's id and date, the rate before (null: there was no row) and the rate
-- written (null: the row was removed).
alter table private.mcp_writes drop constraint mcp_writes_kind_check;
alter table private.mcp_writes
  add constraint mcp_writes_kind_check check (
    kind in (
      'review', 'reassign', 'project', 'category', 'category_hidden', 'category_pnl',
      'loan', 'loan_update', 'loan_split', 'overhead_project', 'company', 'line_split',
      'line_pnl', 'loan_rate'
    )
  );

alter table private.mcp_writes drop constraint mcp_writes_target;
alter table private.mcp_writes add constraint mcp_writes_target check (
  (kind = 'review' and review_id is not null)
  or (kind = 'reassign' and transaction_id is not null and reassign_id is not null)
  or (kind = 'project' and project_id is not null)
  or (kind in ('category', 'category_hidden') and category_id is not null)
  or (kind = 'category_pnl' and category_id is not null and prior is not null)
  or (kind = 'loan' and loan_id is not null)
  or (kind = 'loan_update' and loan_id is not null and prior is not null)
  or (kind = 'loan_split' and loan_id is not null and transaction_id is not null)
  or (kind = 'overhead_project' and prior ? 'company_id')
  or (kind = 'company' and company_id is not null and prior is not null)
  or (kind = 'line_split' and transaction_id is not null and prior ? 'written')
  or (kind = 'line_pnl' and transaction_id is not null and prior ? 'written' and prior ? 'before')
  or (kind = 'loan_rate' and loan_id is not null and prior ? 'rate_id' and prior ? 'effective_date')
);

-- FLOW-132. A loan that is not open takes only payments dated on or before closed_on.
-- private.loan_splits_closed_check: as in 20261008235000_loan_status.sql, and it also runs
-- when a review flag is cleared, so clear_loan_split_review re-checks a line flagged below.
-- Setting the flag never locks or checks: the bank sync and the restore triggers set it.
create or replace function private.loan_splits_closed_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur_status public.loan_status;
  loan_closed_on date;
begin
  if tg_op = 'UPDATE'
     and new.loan_id is not distinct from old.loan_id
     and new.transaction_id is not distinct from old.transaction_id
     and (new.needs_review or not old.needs_review)
  then
    return new;
  end if;

  select l.status, l.closed_on
  into cur_status, loan_closed_on
  from public.loans l
  where l.company_id = new.company_id
    and l.id = new.loan_id
  for no key update;

  if cur_status is distinct from 'open'::public.loan_status
     and exists (
       select 1
       from public.transactions t
       where t.company_id = new.company_id
         and t.id = new.transaction_id
         and t.doc_date > loan_closed_on
     )
  then
    raise exception 'loan_closed' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.loan_splits_closed_check() from public, anon, authenticated;

drop trigger loan_splits_closed_check on public.loan_splits;
create trigger loan_splits_closed_check
  before insert or update of loan_id, transaction_id, needs_review on public.loan_splits
  for each row execute function private.loan_splits_closed_check();

-- A line attached to a loan that is not open, which comes back from removal or whose
-- doc_date moves after the loan's closed_on, cannot be refused (the bank sync and undo
-- write it). Its parts wait for review instead, as decision 0121 does for the balance, and
-- clearing the review runs the closed check above. Like 0121 it never waits for the loan:
-- if another write holds the loan right now, the parts are flagged anyway.
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

revoke all on function private.loan_line_closed_check() from public, anon, authenticated;

create trigger transactions_loan_line_restored_closed
  after update of removed_at on public.transactions
  for each row
  when (old.removed_at is not null and new.removed_at is null)
  execute function private.loan_line_closed_check();

create trigger transactions_loan_line_date_closed
  after update of doc_date on public.transactions
  for each row
  when (new.removed_at is null and new.doc_date is distinct from old.doc_date)
  execute function private.loan_line_closed_check();

-- FLOW-134 item 4. private.loans_part_categories_check: as in
-- 20261009200000_loan_fees_installments.sql. The trigger now runs on an update only when a
-- part category changes, not on every update_loan and loan_update undo that sets the four
-- columns to what they were.
drop trigger loans_part_categories_check on public.loans;
create trigger loans_part_categories_check
  before insert
  on public.loans
  for each row execute function private.loans_part_categories_check();
create trigger loans_part_categories_check_update
  before update of interest_category_id, escrow_category_id, principal_category_id, fees_category_id
  on public.loans
  for each row
  when (
    new.interest_category_id is distinct from old.interest_category_id
    or new.escrow_category_id is distinct from old.escrow_category_id
    or new.principal_category_id is distinct from old.principal_category_id
    or new.fees_category_id is distinct from old.fees_category_id
  )
  execute function private.loans_part_categories_check();

-- FLOW-134 item 1. public.merge_category: as in 20261007190000_line_splits.sql, and a loan
-- that names the merged category for a part moves to the target when the target fits that
-- part (private.loan_part_category_ok); otherwise the merge is refused and nothing moves.
-- Parts already attached keep their category, as they do when a loan's categories change.
create or replace function public.merge_category(p_from uuid, p_into uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  from_kind public.category_kind;
  into_kind public.category_kind;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  if p_from = p_into then
    raise exception 'pick a different category';
  end if;
  select kind into from_kind from public.categories where company_id = cid and id = p_from;
  select kind into into_kind from public.categories where company_id = cid and id = p_into and hidden = false;
  if from_kind is null or into_kind is null then
    raise exception 'category not found';
  end if;
  if from_kind is distinct from into_kind then
    raise exception 'categories must be the same kind';
  end if;
  if exists (
    select 1
    from public.line_splits f
    join public.line_splits s
      on s.transaction_id = f.transaction_id
      and s.category_id = p_into
      and s.project_id is not distinct from f.project_id
    where f.company_id = cid and f.category_id = p_from
  ) then
    raise exception 'a split line has both categories';
  end if;
  -- Hold the loans that name the source, so a concurrent loan edit waits for the merge.
  perform 1
  from public.loans l
  where l.company_id = cid
    and p_from in (l.interest_category_id, l.escrow_category_id, l.principal_category_id, l.fees_category_id)
  for no key update;
  if exists (
    select 1
    from public.loans l
    cross join lateral (values
      ('interest'::public.loan_split_part, l.interest_category_id),
      ('escrow'::public.loan_split_part, l.escrow_category_id),
      ('principal'::public.loan_split_part, l.principal_category_id),
      ('fees'::public.loan_split_part, l.fees_category_id)
    ) v(part, category_id)
    where l.company_id = cid
      and v.category_id = p_from
      and not private.loan_part_category_ok(cid, v.part, p_into)
  ) then
    raise exception 'a loan uses this category for a part the other category cannot take'
      using errcode = '23514';
  end if;
  update public.transactions
  set category_id = p_into,
      user_assigned = true
  where company_id = cid and category_id = p_from;
  update public.line_splits
  set category_id = p_into
  where company_id = cid and category_id = p_from;
  update public.loans l
  set interest_category_id = case when l.interest_category_id = p_from then p_into else l.interest_category_id end,
      escrow_category_id = case when l.escrow_category_id = p_from then p_into else l.escrow_category_id end,
      principal_category_id = case when l.principal_category_id = p_from then p_into else l.principal_category_id end,
      fees_category_id = case when l.fees_category_id = p_from then p_into else l.fees_category_id end
  where l.company_id = cid
    and p_from in (l.interest_category_id, l.escrow_category_id, l.principal_category_id, l.fees_category_id);
  update public.categories
  set hidden = true
  where id = p_from and company_id = cid;
end;
$$;

-- mcp_add_loan: as in 20261008050000_mcp_lock_retry.sql, plus the kind fields. A demand loan
-- passes no term and no payment. The idempotency hash of an amortizing loan is unchanged.
drop function public.mcp_add_loan(text, text, bigint, integer, integer, date, bigint, bigint, text, uuid);

create function public.mcp_add_loan(
  p_idempotency_key text,
  p_name text,
  p_principal_minor bigint,
  p_annual_rate_ppm integer,
  p_term_months integer,
  p_start_date date,
  p_payment_minor bigint,
  p_escrow_minor bigint,
  p_currency text,
  p_project_id uuid default null,
  p_kind text default 'amortizing',
  p_interest_only_months integer default null,
  p_amortization_months integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  rid uuid;
  response jsonb;
  kind text;
begin
  kind := coalesce(p_kind, 'amortizing');
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_name is null
    or p_principal_minor is null
    or p_annual_rate_ppm is null
    or p_start_date is null
    or p_escrow_minor is null
    or p_currency is null
    or kind not in ('amortizing', 'interest_only', 'balloon', 'demand')
    -- A demand loan has no term and no payment; every other kind has both.
    or (kind = 'demand') <> (p_term_months is null)
    or (kind = 'demand') <> (p_payment_minor is null)
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'loan|' || btrim(p_name) || '|' || p_principal_minor::text || '|' || p_annual_rate_ppm::text
    || '|' || coalesce(p_term_months::text, '') || '|' || p_start_date::text
    || '|' || coalesce(p_payment_minor::text, '')
    || '|' || p_escrow_minor::text || '|' || p_currency
    || case when p_project_id is null then '' else '|' || p_project_id::text end
    || case when kind = 'amortizing' then '' else
      '|' || kind || '|' || coalesce(p_interest_only_months::text, '') || '|' || coalesce(p_amortization_months::text, '')
    end;
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
    if p_project_id is not null and not exists (
      select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
    ) then
      response := private.mcp_refused('project not found');
    else
      insert into public.loans (
        company_id, name, principal_minor, annual_rate_ppm, term_months,
        start_date, payment_minor, escrow_minor, currency, project_id,
        kind, interest_only_months, amortization_months
      )
      values (
        cid, btrim(p_name), p_principal_minor, p_annual_rate_ppm, p_term_months,
        p_start_date, p_payment_minor, p_escrow_minor, p_currency, p_project_id,
        kind::public.loan_kind, p_interest_only_months, p_amortization_months
      )
      returning id into rid;

      insert into private.mcp_writes (token_id, user_id, kind, loan_id)
      values (token, auth.uid(), 'loan', rid);

      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object('id', rid, 'project_id', p_project_id, 'kind', kind, 'undo_kind', 'loan')
      );
    end if;
  exception
    when check_violation then
      response := private.mcp_refused('invalid loan terms');
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_add_loan(text, text, bigint, integer, integer, date, bigint, bigint, text, uuid, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_add_loan(text, text, bigint, integer, integer, date, bigint, bigint, text, uuid, text, integer, integer)
  to authenticated;

-- A loan's attached payments, oldest first: each line still on the books with its parts.
-- Pending lines are listed too (line_status says which); a payment waiting for review is
-- listed with needs_review, and counts nowhere until it is corrected. MCP reads it for a
-- demand loan's interest and statement and for the first unpaid schedule row (0131).
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
      and s.company_id = (select private.current_company_id())
      and t.removed_at is null
    group by s.transaction_id, t.doc_date, t.line_status
  ) p;
$$;

revoke all on function public.mcp_loan_payments(uuid) from public, anon;
grant execute on function public.mcp_loan_payments(uuid) to authenticated, service_role;

-- MCP write: set_loan_rate. From p_effective_date on the loan's rate is p_annual_rate_ppm;
-- a null rate removes that date's row. A date before the loan's start is refused. Payments
-- already attached keep their parts. Undo kind loan_rate takes the rate row's id.
create or replace function public.mcp_set_loan_rate(
  p_idempotency_key text,
  p_loan_id uuid,
  p_effective_date date,
  p_annual_rate_ppm integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  response jsonb;
  loan_start date;
  cur record;
  rate_id uuid;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_loan_id is null
    or p_effective_date is null
    or (p_annual_rate_ppm is not null and (p_annual_rate_ppm < 0 or p_annual_rate_ppm > 1000000))
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'loan_rate|' || p_loan_id::text || '|' || p_effective_date::text || '|'
    || coalesce(p_annual_rate_ppm::text, 'null');
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
    -- The loan first, as every loan write does (0121).
    select l.start_date into loan_start
    from public.loans l
    where l.id = p_loan_id and l.company_id = cid
    for no key update;

    if not found then
      response := private.mcp_refused('loan not found');
    elsif p_effective_date < loan_start then
      response := private.mcp_refused('rate before the loan start');
    else
      select r.id, r.annual_rate_ppm into cur
      from public.loan_rates r
      where r.loan_id = p_loan_id and r.effective_date = p_effective_date
      for update;

      if not found and p_annual_rate_ppm is null then
        response := private.mcp_refused('rate not found');
      else
        if not found then
          insert into public.loan_rates (company_id, loan_id, effective_date, annual_rate_ppm)
          values (cid, p_loan_id, p_effective_date, p_annual_rate_ppm)
          returning id into rate_id;
        elsif p_annual_rate_ppm is null then
          rate_id := cur.id;
          delete from public.loan_rates where id = cur.id;
        else
          rate_id := cur.id;
          update public.loan_rates set annual_rate_ppm = p_annual_rate_ppm where id = cur.id;
        end if;

        insert into private.mcp_writes (token_id, user_id, kind, loan_id, prior, created_at)
        values (
          token, auth.uid(), 'loan_rate', p_loan_id,
          jsonb_build_object(
            'rate_id', rate_id,
            'effective_date', p_effective_date,
            'before', cur.annual_rate_ppm,
            'written', p_annual_rate_ppm
          ),
          clock_timestamp()
        );

        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object(
            'id', rate_id,
            'loan_id', p_loan_id,
            'effective_date', p_effective_date,
            'annual_rate_ppm', p_annual_rate_ppm,
            'previous_rate_ppm', cur.annual_rate_ppm,
            'undo_kind', 'loan_rate'
          )
        );
      end if;
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
$$;

revoke all on function public.mcp_set_loan_rate(text, uuid, date, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_set_loan_rate(text, uuid, date, integer) to authenticated;

-- private.mcp_refused: as in 20261009200000_loan_fees_installments.sql, plus the rate refusals of
-- set_loan_rate (0131).
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
        -- FLOW-106 part 4 (decision 0131).
        'rate before the loan start',
        'rate not found'
      ) then p_message
      when p_message = 'loan_closed' then 'loan closed'
      else 'The write was refused.'
    end
  );
$$;

-- mcp_update_loan: as in 20261009200000_loan_fees_installments.sql, plus kind,
-- interest_only_months and amortization_months (0131). term_months and payment_minor take
-- null for a demand loan (the table's kind rule refuses it on any other kind). The part
-- categories are checked in one loop (FLOW-134 item 4): the first one that is unknown or
-- does not fit is refused.
create or replace function public.mcp_update_loan(
  p_idempotency_key text,
  p_loan_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  response jsonb;
  before jsonb;
  after jsonb;
  cur record;
  key text;
  allowed constant text[] := array[
    'name', 'principal_minor', 'annual_rate_ppm', 'term_months',
    'start_date', 'payment_minor', 'escrow_minor', 'project_id',
    'status', 'closed_on',
    'interest_category_id', 'escrow_category_id', 'principal_category_id', 'fees_category_id',
    'kind', 'interest_only_months', 'amortization_months'
  ];
  cat_key text;
  cat_problem text;
  loan_found boolean;
  new_project uuid;
  set_project boolean;
  new_status public.loan_status;
  new_closed date;
  set_closed boolean;
  balance bigint;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_loan_id is null
    or p_patch is null
    or jsonb_typeof(p_patch) <> 'object'
  then
    return private.mcp_error('validation', 'validation');
  end if;

  for key in select jsonb_object_keys(p_patch)
  loop
    if key = 'currency' or not (key = any(allowed)) then
      return private.mcp_error('validation', 'validation');
    end if;
    -- An explicit null would keep the old value and still log an edit.
    -- project_id, closed_on and the part categories are the exceptions: null clears them.
    -- So are the kind fields, and the term and payment of a loan made a demand loan.
    if key not in (
      'project_id', 'closed_on', 'interest_category_id', 'escrow_category_id', 'principal_category_id',
      'fees_category_id', 'interest_only_months', 'amortization_months'
    ) and not (key in ('term_months', 'payment_minor') and p_patch->>'kind' is not distinct from 'demand')
      and jsonb_typeof(p_patch->key) = 'null' then
      return private.mcp_error('validation', 'validation');
    end if;
  end loop;

  if p_patch = '{}'::jsonb then
    return private.mcp_error('validation', 'validation');
  end if;

  -- project_id is a uuid string, or JSON null to clear it. An absent key leaves it.
  set_project := p_patch ? 'project_id';
  if set_project then
    if jsonb_typeof(p_patch->'project_id') not in ('null', 'string')
      or (
        jsonb_typeof(p_patch->'project_id') = 'string'
        and p_patch->>'project_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
    then
      return private.mcp_error('validation', 'validation');
    end if;
    new_project := (p_patch->>'project_id')::uuid;
  end if;

  -- status is one of the three words. closed_on is YYYY-MM-DD, or JSON null to clear it.
  if p_patch ? 'status' and (
    jsonb_typeof(p_patch->'status') <> 'string'
    or p_patch->>'status' not in ('open', 'paid_off', 'closed')
  ) then
    return private.mcp_error('validation', 'validation');
  end if;
  set_closed := p_patch ? 'closed_on';
  if set_closed then
    if jsonb_typeof(p_patch->'closed_on') not in ('null', 'string')
      or (
        jsonb_typeof(p_patch->'closed_on') = 'string'
        and (
          p_patch->>'closed_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          or pg_input_is_valid(p_patch->>'closed_on', 'date') is not true
        )
      )
    then
      return private.mcp_error('validation', 'validation');
    end if;
    new_closed := (p_patch->>'closed_on')::date;
  end if;

  if p_patch ? 'kind' and (
    jsonb_typeof(p_patch->'kind') <> 'string'
    or p_patch->>'kind' not in ('amortizing', 'interest_only', 'balloon', 'demand')
  ) then
    return private.mcp_error('validation', 'validation');
  end if;

  -- A part category is a uuid string, or JSON null for the default. An absent key leaves it.
  foreach cat_key in array array['interest_category_id', 'escrow_category_id', 'principal_category_id', 'fees_category_id']
  loop
    if p_patch ? cat_key and (
      jsonb_typeof(p_patch->cat_key) not in ('null', 'string')
      or (
        jsonb_typeof(p_patch->cat_key) = 'string'
        and p_patch->>cat_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
    ) then
      return private.mcp_error('validation', 'validation');
    end if;
  end loop;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'loan_update|' || p_loan_id::text || '|' || p_patch::text;
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
    select l.name, l.principal_minor, l.annual_rate_ppm, l.term_months,
           l.start_date, l.payment_minor, l.escrow_minor, l.project_id,
           l.status, l.closed_on,
           l.interest_category_id, l.escrow_category_id, l.principal_category_id,
           l.fees_category_id, l.kind, l.interest_only_months, l.amortization_months
    into cur
    from public.loans l
    where l.id = p_loan_id
      and l.company_id = cid
    for update;
    loan_found := found;

    if loan_found then
      -- Reopening clears the date unless the patch names one, which is then refused.
      new_status := coalesce((p_patch->>'status')::public.loan_status, cur.status);
      if not set_closed then
        new_closed := case when new_status = 'open'::public.loan_status then null else cur.closed_on end;
      end if;
    end if;

    -- One pass over the part categories: unknown is not found, else it must fit the part.
    foreach cat_key in array array['interest_category_id', 'escrow_category_id', 'principal_category_id', 'fees_category_id']
    loop
      exit when cat_problem is not null or not loan_found;
      if p_patch ? cat_key and jsonb_typeof(p_patch->cat_key) = 'string' then
        if not exists (
          select 1 from public.categories c
          where c.company_id = cid and c.id = (p_patch->>cat_key)::uuid
        ) then
          cat_problem := 'category not found';
        elsif not private.loan_part_category_ok(
          cid, replace(cat_key, '_category_id', '')::public.loan_split_part, (p_patch->>cat_key)::uuid
        ) then
          cat_problem := 'category does not fit the loan part';
        end if;
      end if;
    end loop;

    if not loan_found then
      response := private.mcp_refused('loan not found');
    elsif new_project is not null and not exists (
      select 1 from public.projects p where p.id = new_project and p.company_id = cid
    ) then
      response := private.mcp_refused('project not found');
    elsif cat_problem is not null then
      response := private.mcp_refused(cat_problem);
    elsif new_status <> 'open'::public.loan_status and new_closed is null then
      response := private.mcp_refused('closed_on required');
    elsif new_status = 'open'::public.loan_status and new_closed is not null then
      response := private.mcp_refused('loan is open');
    else
      before := jsonb_build_object(
        'name', cur.name,
        'principal_minor', cur.principal_minor,
        'annual_rate_ppm', cur.annual_rate_ppm,
        'term_months', cur.term_months,
        'start_date', cur.start_date,
        'payment_minor', cur.payment_minor,
        'escrow_minor', cur.escrow_minor,
        'project_id', cur.project_id,
        'status', cur.status,
        'closed_on', cur.closed_on,
        'interest_category_id', cur.interest_category_id,
        'escrow_category_id', cur.escrow_category_id,
        'principal_category_id', cur.principal_category_id,
        'fees_category_id', cur.fees_category_id,
        'kind', cur.kind,
        'interest_only_months', cur.interest_only_months,
        'amortization_months', cur.amortization_months
      );

      update public.loans l
      set
        name = coalesce(btrim(p_patch->>'name'), l.name),
        principal_minor = coalesce((p_patch->>'principal_minor')::bigint, l.principal_minor),
        annual_rate_ppm = coalesce((p_patch->>'annual_rate_ppm')::integer, l.annual_rate_ppm),
        term_months = case when p_patch ? 'term_months'
          then (p_patch->>'term_months')::integer else l.term_months end,
        start_date = coalesce((p_patch->>'start_date')::date, l.start_date),
        payment_minor = case when p_patch ? 'payment_minor'
          then (p_patch->>'payment_minor')::bigint else l.payment_minor end,
        escrow_minor = coalesce((p_patch->>'escrow_minor')::bigint, l.escrow_minor),
        project_id = case when set_project then new_project else l.project_id end,
        status = new_status,
        closed_on = new_closed,
        interest_category_id = case when p_patch ? 'interest_category_id'
          then (p_patch->>'interest_category_id')::uuid else l.interest_category_id end,
        escrow_category_id = case when p_patch ? 'escrow_category_id'
          then (p_patch->>'escrow_category_id')::uuid else l.escrow_category_id end,
        principal_category_id = case when p_patch ? 'principal_category_id'
          then (p_patch->>'principal_category_id')::uuid else l.principal_category_id end,
        fees_category_id = case when p_patch ? 'fees_category_id'
          then (p_patch->>'fees_category_id')::uuid else l.fees_category_id end,
        kind = coalesce((p_patch->>'kind')::public.loan_kind, l.kind),
        interest_only_months = case when p_patch ? 'interest_only_months'
          then (p_patch->>'interest_only_months')::integer else l.interest_only_months end,
        amortization_months = case when p_patch ? 'amortization_months'
          then (p_patch->>'amortization_months')::integer else l.amortization_months end
      where l.id = p_loan_id
        and l.company_id = cid;

      select l.name, l.principal_minor, l.annual_rate_ppm, l.term_months,
             l.start_date, l.payment_minor, l.escrow_minor, l.project_id,
             l.status, l.closed_on,
             l.interest_category_id, l.escrow_category_id, l.principal_category_id,
             l.fees_category_id, l.kind, l.interest_only_months, l.amortization_months
      into cur
      from public.loans l
      where l.id = p_loan_id;

      select b.balance_minor into balance
      from public.loan_balances b
      where b.company_id = cid and b.loan_id = p_loan_id;

      after := jsonb_build_object(
        'name', cur.name,
        'principal_minor', cur.principal_minor,
        'annual_rate_ppm', cur.annual_rate_ppm,
        'term_months', cur.term_months,
        'start_date', cur.start_date,
        'payment_minor', cur.payment_minor,
        'escrow_minor', cur.escrow_minor,
        'project_id', cur.project_id,
        'status', cur.status,
        'closed_on', cur.closed_on,
        'interest_category_id', cur.interest_category_id,
        'escrow_category_id', cur.escrow_category_id,
        'principal_category_id', cur.principal_category_id,
        'fees_category_id', cur.fees_category_id,
        'kind', cur.kind,
        'interest_only_months', cur.interest_only_months,
        'amortization_months', cur.amortization_months
      );

      insert into private.mcp_writes (token_id, user_id, kind, loan_id, prior, created_at)
      values (
        token, auth.uid(), 'loan_update', p_loan_id,
        jsonb_build_object('before', before, 'after', after), clock_timestamp()
      );

      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
          'id', p_loan_id,
          'project_id', cur.project_id,
          'status', cur.status,
          'closed_on', cur.closed_on,
          'interest_category_id', cur.interest_category_id,
          'escrow_category_id', cur.escrow_category_id,
          'principal_category_id', cur.principal_category_id,
          'fees_category_id', cur.fees_category_id,
          'kind', cur.kind,
          'interest_only_months', cur.interest_only_months,
          'amortization_months', cur.amortization_months,
          -- A loan marked paid off can still show principal Flow never saw paid.
          'balance_left', case when cur.status <> 'open'::public.loan_status then balance end,
          'undo_kind', 'loan_update'
        )
      );
    end if;
  exception
    when check_violation then
      if sqlerrm = 'loan_payment_below_interest' then
        response := private.mcp_refused('payment below interest');
      elsif sqlerrm = 'loan_payments_after_close' then
        response := private.mcp_refused('payments after closed_on');
      elsif sqlerrm = 'loan_category_not_allowed' then
        response := private.mcp_refused('category does not fit the loan part');
      else
        response := private.mcp_refused('invalid loan terms');
      end if;
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_update_loan(text, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_update_loan(text, uuid, jsonb) to authenticated;

-- mcp_list_loans: as in 20261009200000_loan_fees_installments.sql, plus the kind fields and the
-- loan's rate rows, oldest first (0131).
create or replace function public.mcp_list_loans()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
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
        from public.loan_splits s
        where s.company_id = l.company_id
          and s.loan_id = l.id
          and s.needs_review
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
  ) order by l.name), '[]'::jsonb)
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
$$;

revoke all on function public.mcp_list_loans() from public, anon;
grant execute on function public.mcp_list_loans() to authenticated, service_role;

-- mcp_undo: as in 20261009200000_loan_fees_installments.sql; loan_update also compares and
-- restores kind, interest_only_months and amortization_months, and the new kind loan_rate
-- puts a rate row back as it was (0131).
create or replace function public.mcp_undo(
  p_idempotency_key text,
  p_kind text,
  p_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  rec private.mcp_writes%rowtype;
  txn uuid;
  cur_project uuid;
  cur_category uuid;
  cur_role public.pnl_role;
  response jsonb;
  cur_hidden boolean;
  cur_excluded boolean;
  written_excluded boolean;
  cur_loan record;
  written jsonb;
  before jsonb;
  cur_overhead uuid;
  cur_name text;
  restored boolean;
  cur_override boolean;
  attach_reassign uuid;
  cur_rate integer;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_id is null
    or p_kind is null
    or p_kind not in (
      'review', 'reassign', 'project', 'category', 'category_hidden', 'category_pnl',
      'loan', 'loan_update', 'loan_split', 'overhead_project', 'company', 'line_split',
      'line_pnl', 'loan_rate'
    )
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'undo|' || p_kind || '|' || p_id::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  response := private.mcp_error('not_found', 'not found');
  begin
    select * into rec
    from private.mcp_writes w
    where w.user_id = auth.uid()
      and w.undone_at is null
      and (
        (p_kind = 'review' and w.kind = 'review' and w.review_id = p_id)
        or (p_kind = 'reassign' and w.kind = 'reassign' and w.reassign_id = p_id)
        or (p_kind = 'project' and w.kind = 'project' and w.project_id = p_id)
        or (p_kind in ('category', 'category_hidden', 'category_pnl') and w.kind = p_kind and w.category_id = p_id)
        or (p_kind = 'loan' and w.kind = 'loan' and w.loan_id = p_id)
        or (p_kind = 'loan_update' and w.kind = 'loan_update' and w.loan_id = p_id)
        or (p_kind = 'loan_split' and w.kind = 'loan_split' and w.transaction_id = p_id)
        or (p_kind = 'overhead_project' and w.kind = 'overhead_project' and w.prior->>'company_id' = p_id::text)
        or (p_kind = 'company' and w.kind = 'company' and w.company_id = p_id)
        or (p_kind = 'line_split' and w.kind = 'line_split' and w.transaction_id = p_id)
        or (p_kind = 'line_pnl' and w.kind = 'line_pnl' and w.transaction_id = p_id)
        or (p_kind = 'loan_rate' and w.kind = 'loan_rate' and w.prior->>'rate_id' = p_id::text)
      )
    order by w.created_at desc
    limit 1
    for update;

    if not found then
      response := private.mcp_error('not_found', 'not found');
    elsif p_kind = 'company' then
      select c.name into cur_name
      from public.companies c
      where c.id = p_id and c.id = cid
      for update;
      if not found or rec.prior->>'before' is null then
        response := private.mcp_error('not_found', 'not found');
      elsif cur_name is distinct from rec.prior->>'after' then
        response := private.mcp_error('conflict', 'conflict');
      else
        update public.companies c
        set name = rec.prior->>'before'
        where c.id = p_id and c.id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'overhead_project' then
      select c.overhead_project_id into cur_overhead
      from public.companies c
      where c.id = p_id and c.id = cid
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif cur_overhead::text is distinct from rec.prior->>'written' then
        response := private.mcp_error('conflict', 'conflict');
      elsif rec.prior->>'before' is not null and not exists (
        -- Key-share lock: a delete of that project waits until this undo commits, so it
        -- cannot slip in between this check and set_overhead_project.
        select 1 from public.projects p
        where p.id = (rec.prior->>'before')::uuid and p.company_id = cid
        for key share
      ) then
        -- The project it was before has been deleted since: nothing to go back to.
        response := private.mcp_error('conflict', 'conflict');
      else
        perform public.set_overhead_project((rec.prior->>'before')::uuid);
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'line_pnl' then
      select t.in_pnl_override into cur_override
      from public.transactions t
      where t.id = p_id and t.company_id = cid and t.removed_at is null
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif cur_override is distinct from (rec.prior->>'written')::boolean then
        response := private.mcp_error('conflict', 'conflict');
      else
        perform public.set_transaction_pnl(p_id, (rec.prior->>'before')::boolean);
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'line_split' then
      perform 1 from public.transactions t
      where t.id = p_id and t.company_id = cid and t.removed_at is null
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif private.line_split_parts(p_id) is distinct from rec.prior->'written' then
        response := private.mcp_error('conflict', 'conflict');
      else
        delete from public.line_splits where transaction_id = p_id and company_id = cid;
        -- A write stored before FLOW-133 has no percent or rest in before: they stay empty.
        insert into public.line_splits (
          company_id, transaction_id, ordinal, category_id, project_id, amount_minor, percent, is_rest
        )
        select cid, p_id, b.ord::smallint, (b.part->>'category_id')::uuid, (b.part->>'project_id')::uuid,
          (b.part->>'amount_minor')::bigint, (b.part->>'percent')::numeric,
          coalesce((b.part->>'is_rest')::boolean, false)
        from jsonb_array_elements(rec.prior->'before') with ordinality as b(part, ord);
        update public.transactions
        set user_assigned = (rec.prior->>'user_assigned')::boolean,
            category_suggested = (rec.prior->>'category_suggested')::boolean
        where id = p_id and company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'loan' then
      perform 1 from public.loans l
      where l.id = p_id and l.company_id = cid
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif exists (
        select 1 from public.loan_splits s
        where s.company_id = cid and s.loan_id = p_id
      ) then
        response := private.mcp_error('conflict', 'conflict');
      else
        delete from public.loans where id = p_id and company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'loan_update' then
      written := rec.prior->'after';
      before := rec.prior->'before';
      select l.name, l.principal_minor, l.annual_rate_ppm, l.term_months,
             l.start_date, l.payment_minor, l.escrow_minor, l.project_id,
             l.status, l.closed_on,
             l.interest_category_id, l.escrow_category_id, l.principal_category_id,
             l.fees_category_id, l.kind, l.interest_only_months, l.amortization_months
      into cur_loan
      from public.loans l
      where l.id = p_id and l.company_id = cid
      for update;
      if not found or written is null or before is null then
        response := private.mcp_error('not_found', 'not found');
      elsif (
        -- Compare only the fields the edit snapshotted. An edit written before FLOW-105
        -- has no project_id, and one written before FLOW-106 has no status or closed_on.
        select coalesce(jsonb_object_agg(f.key, f.value), '{}'::jsonb)
        from jsonb_each(jsonb_build_object(
          'name', cur_loan.name,
          'principal_minor', cur_loan.principal_minor,
          'annual_rate_ppm', cur_loan.annual_rate_ppm,
          'term_months', cur_loan.term_months,
          'start_date', cur_loan.start_date,
          'payment_minor', cur_loan.payment_minor,
          'escrow_minor', cur_loan.escrow_minor,
          'project_id', cur_loan.project_id,
          'status', cur_loan.status,
          'closed_on', cur_loan.closed_on,
          'interest_category_id', cur_loan.interest_category_id,
          'escrow_category_id', cur_loan.escrow_category_id,
          'principal_category_id', cur_loan.principal_category_id,
          'fees_category_id', cur_loan.fees_category_id,
          'kind', cur_loan.kind,
          'interest_only_months', cur_loan.interest_only_months,
          'amortization_months', cur_loan.amortization_months
        )) f
        where written ? f.key
      ) is distinct from written then
        response := private.mcp_error('conflict', 'conflict');
      elsif before->>'project_id' is not null and not exists (
        select 1 from public.projects p
        where p.id = (before->>'project_id')::uuid and p.company_id = cid
      ) then
        response := private.mcp_refused('project not found');
      elsif exists (
        select 1
        from (values ('interest_category_id'), ('escrow_category_id'), ('principal_category_id'), ('fees_category_id')) v(k)
        where before->>v.k is not null
          and not exists (
            select 1 from public.categories c
            where c.id = (before->>v.k)::uuid and c.company_id = cid
          )
      ) then
        -- A category the edit replaced was deleted since.
        response := private.mcp_refused('category not found');
      else
        update public.loans l
        set
          name = (before->>'name')::text,
          principal_minor = (before->>'principal_minor')::bigint,
          annual_rate_ppm = (before->>'annual_rate_ppm')::integer,
          term_months = (before->>'term_months')::integer,
          start_date = (before->>'start_date')::date,
          payment_minor = (before->>'payment_minor')::bigint,
          escrow_minor = (before->>'escrow_minor')::bigint,
          project_id = case when before ? 'project_id'
            then (before->>'project_id')::uuid else l.project_id end,
          status = case when before ? 'status'
            then (before->>'status')::public.loan_status else l.status end,
          closed_on = case when before ? 'status'
            then (before->>'closed_on')::date else l.closed_on end,
          interest_category_id = case when before ? 'interest_category_id'
            then (before->>'interest_category_id')::uuid else l.interest_category_id end,
          escrow_category_id = case when before ? 'escrow_category_id'
            then (before->>'escrow_category_id')::uuid else l.escrow_category_id end,
          principal_category_id = case when before ? 'principal_category_id'
            then (before->>'principal_category_id')::uuid else l.principal_category_id end,
          fees_category_id = case when before ? 'fees_category_id'
            then (before->>'fees_category_id')::uuid else l.fees_category_id end,
          kind = case when before ? 'kind'
            then (before->>'kind')::public.loan_kind else l.kind end,
          interest_only_months = case when before ? 'kind'
            then (before->>'interest_only_months')::integer else l.interest_only_months end,
          amortization_months = case when before ? 'kind'
            then (before->>'amortization_months')::integer else l.amortization_months end
        where l.id = p_id and l.company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'loan_rate' then
      -- The loan first, as every loan write does (0121); then the rate row by its date.
      perform 1 from public.loans l
      where l.id = rec.loan_id and l.company_id = cid
      for no key update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      else
        select r.annual_rate_ppm into cur_rate
        from public.loan_rates r
        where r.loan_id = rec.loan_id
          and r.effective_date = (rec.prior->>'effective_date')::date
        for update;
        if not found then
          cur_rate := null;
        end if;
        if cur_rate is distinct from (rec.prior->>'written')::integer then
          -- Changed since: leave it.
          response := private.mcp_error('conflict', 'conflict');
        else
          if rec.prior->>'before' is null then
            delete from public.loan_rates r
            where r.loan_id = rec.loan_id
              and r.effective_date = (rec.prior->>'effective_date')::date;
          elsif rec.prior->>'written' is null then
            insert into public.loan_rates (id, company_id, loan_id, effective_date, annual_rate_ppm)
            values (
              (rec.prior->>'rate_id')::uuid, cid, rec.loan_id,
              (rec.prior->>'effective_date')::date, (rec.prior->>'before')::integer
            );
          else
            update public.loan_rates r
            set annual_rate_ppm = (rec.prior->>'before')::integer
            where r.loan_id = rec.loan_id
              and r.effective_date = (rec.prior->>'effective_date')::date;
          end if;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        end if;
      end if;
    elsif p_kind = 'loan_split' then
      perform 1 from public.loan_splits s
      where s.company_id = cid
        and s.transaction_id = p_id
        and s.loan_id = rec.loan_id
      for update;
      if not found then
        response := private.mcp_error('conflict', 'conflict');
      elsif (
        -- Corrected in the app after the MCP wrote it: leave the owner's version.
        rec.prior->'parts' is not null
        and rec.prior->'parts' is distinct from (
          select jsonb_agg(jsonb_build_object(
            'part', s.part,
            'amount_minor', s.amount_minor,
            'category_id', s.category_id
          ) order by s.part)
          from public.loan_splits s
          where s.company_id = cid
            and s.transaction_id = p_id
            and s.loan_id = rec.loan_id
        )
      ) or (
        -- Written before the parts were kept: any later touch counts as a correction.
        rec.prior->'parts' is null
        and exists (
          select 1 from public.loan_splits s
          where s.company_id = cid
            and s.transaction_id = p_id
            and s.loan_id = rec.loan_id
            and s.updated_at > rec.created_at
        )
      ) then
        response := private.mcp_error('conflict', 'conflict');
      else
        delete from public.loan_splits s
        where s.company_id = cid
          and s.transaction_id = p_id
          and s.loan_id = rec.loan_id;
        -- Give the line back the project it had before the attach, but only if
        -- nobody has changed it since. A line that was changed is left as it is.
        restored := false;
        -- Since FLOW-120 the reassign id is in its column; older writes kept it in prior.
        attach_reassign := coalesce(rec.reassign_id, (rec.prior->>'reassign_id')::uuid);
        if attach_reassign is not null then
          select t.project_id, t.category_id, t.pnl_role
          into cur_project, cur_category, cur_role
          from public.transactions t
          where t.id = p_id and t.company_id = cid and t.removed_at is null
          for update;
          if found
            and cur_project::text is not distinct from rec.prior->>'project_id'
            and cur_category::text is not distinct from rec.prior->>'category_id'
            -- The role the attach gave the line. Writes before FLOW-120 did not keep
            -- it; reassign_transaction gave project for an expense category and none
            -- for an income (reversal) one, and the category is unchanged here.
            and (
              (rec.prior ? 'pnl_role'
                and cur_role::text is not distinct from rec.prior->>'pnl_role')
              or (not (rec.prior ? 'pnl_role')
                and cur_role is not distinct from (
                  case when exists (
                    select 1 from public.categories c
                    where c.id = cur_category
                      and c.company_id = cid
                      and c.kind = 'income'::public.category_kind
                  ) then null::public.pnl_role
                  else 'project'::public.pnl_role end
                ))
            )
            and exists (
              select 1 from public.reassign_undo u
              where u.id = attach_reassign
                and u.company_id = cid
                and u.undone_at is null
            )
          then
            perform public.undo_reassign(attach_reassign);
            restored := true;
          end if;
        end if;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', case when attach_reassign is not null
            then jsonb_build_object('kind', p_kind, 'id', p_id, 'project_restored', restored)
            else jsonb_build_object('kind', p_kind, 'id', p_id) end
        );
      end if;
    elsif p_kind = 'project' then
      perform 1 from public.projects p
      where p.id = p_id and p.company_id = cid
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif exists (
        select 1 from public.transactions t
        where t.company_id = cid and t.project_id = p_id and t.removed_at is null
      ) or exists (
        select 1 from public.allocations a
        where a.company_id = cid and a.project_id = p_id
      ) or exists (
        select 1 from public.split_rule_targets s
        where s.company_id = cid and s.project_id = p_id
      ) or exists (
        select 1 from public.line_splits lsp
        where lsp.company_id = cid and lsp.project_id = p_id
      ) or exists (
        select 1 from public.suppliers sup
        where sup.company_id = cid and sup.remembered_project_id = p_id
      ) or exists (
        select 1 from public.loans l
        where l.company_id = cid and l.project_id = p_id
      ) then
        response := private.mcp_error('conflict', 'conflict');
      else
        delete from public.projects
        where id = p_id and company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id
          and user_id = auth.uid()
          and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'category' then
      perform 1 from public.categories c
      where c.id = p_id and c.company_id = cid
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif exists (
        select 1 from public.transactions t
        where t.company_id = cid and t.category_id = p_id and t.removed_at is null
      ) or exists (
        select 1 from public.suppliers sup
        where sup.company_id = cid and sup.remembered_category_id = p_id
      ) or exists (
        select 1 from public.loan_splits ls
        where ls.company_id = cid and ls.category_id = p_id
      ) or exists (
        select 1 from public.line_splits lsp
        where lsp.company_id = cid and lsp.category_id = p_id
      ) or exists (
        select 1 from public.review_queue q
        where q.company_id = cid
          and (q.prior_remembered_category_id = p_id or q.written_remembered_category_id = p_id)
      ) then
        response := private.mcp_error('conflict', 'conflict');
      else
        delete from public.categories
        where id = p_id and company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id
          and user_id = auth.uid()
          and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'category_hidden' then
      select c.hidden into cur_hidden
      from public.categories c
      where c.id = p_id and c.company_id = cid
      for update;
      if not found or cur_hidden is distinct from true then
        response := private.mcp_error('conflict', 'conflict');
      else
        perform public.set_category_hidden(p_id, rec.prior_hidden);
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id
          and user_id = auth.uid()
          and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'category_pnl' then
      select c.excluded_from_pnl into cur_excluded
      from public.categories c
      where c.id = p_id and c.company_id = cid
      for update;
      written_excluded := (rec.prior->>'written')::boolean;
      if not found or cur_excluded is distinct from written_excluded then
        response := private.mcp_error('conflict', 'conflict');
      else
        perform public.set_category_excluded_from_pnl(p_id, (rec.prior->>'excluded_from_pnl')::boolean);
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id
          and user_id = auth.uid()
          and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    else
      txn := rec.transaction_id;
      select t.project_id, t.category_id, t.pnl_role
      into cur_project, cur_category, cur_role
      from public.transactions t
      where t.id = txn
        and t.company_id = cid
        and t.removed_at is null
      for update;

      if not found
        or cur_project is distinct from rec.project_id
        or cur_category is distinct from rec.category_id
        or cur_role is distinct from rec.pnl_role
        or private.mcp_shares(txn) is distinct from rec.shares
      then
        response := private.mcp_error('conflict', 'conflict');
      else
        if p_kind = 'review' then
          perform public.reopen_review(p_id);
        else
          perform public.undo_reassign(p_id);
        end if;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id
          and user_id = auth.uid()
          and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    end if;
  exception
    when check_violation then
      if sqlerrm = 'loan_payment_below_interest' then
        response := private.mcp_refused('payment below interest');
      elsif sqlerrm = 'loan_payments_after_close' then
        response := private.mcp_refused('payments after closed_on');
      elsif sqlerrm = 'loan_category_not_allowed' then
        response := private.mcp_refused('category does not fit the loan part');
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
$$;

revoke all on function public.mcp_undo(text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_undo(text, text, uuid) to authenticated;

-- get_project: as in 20261009120000_profit_by_month.sql; loans[] gains status, closed_on and
-- kind (FLOW-132, 0131), so a project tells paid-off and closed loans from open ones.
create or replace function public.get_project(p_id uuid, p_basis text, p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  cid uuid;
  basis text;
  result jsonb;
  profit bigint;
  available boolean;
  share bigint;
  waiting jsonb;
begin
  select c.id into cid
    from public.companies c
    where c.owner_id = (select auth.uid());
  if cid is null then
    return null;
  end if;
  if (p_from is null) <> (p_to is null) or p_from > p_to then
    raise exception 'invalid range' using errcode = '22023';
  end if;
  basis := case when p_basis = 'invoiced' then 'invoiced' else 'cash' end;

  waiting := public.project_waiting(p_id);

  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'status', p.status,
    'state_label', p.state_label,
    'budget_agorot', p.budget_agorot,
    'sumit_budget_section_id', p.sumit_budget_section_id,
    'is_overhead', p.id is not distinct from (select c.overhead_project_id from public.companies c where c.id = cid),
    'after_overhead', coalesce(p.after_overhead, (select c.after_overhead from public.companies c where c.id = cid)),
    'income_agorot', coalesce((
      select sum(l.amount_net) from (select * from private.pnl_lines u where (basis = 'invoiced' or not u.unpaid)
        and private.pnl_in_range(u.kind, basis, u.doc_date, u.cash_date, p_from, p_to)) l
      where l.project_id = p.id and l.kind = 'income'
        and l.in_pnl
        and l.currency = 'ILS'
        and (
          l.direction = 'expense'
          or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
          or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
        )
    ), 0),
    'direct_agorot', -coalesce((
      select sum(l.amount_net) from (select * from private.pnl_lines u where (basis = 'invoiced' or not u.unpaid)
        and private.pnl_in_range(u.kind, basis, u.doc_date, u.cash_date, p_from, p_to)) l
      where l.project_id = p.id and l.kind = 'expense' and l.pnl_role = 'project'
        and l.in_pnl
        and l.currency = 'ILS'
    ), 0),
    'shared_agorot', -coalesce((
      select sum(coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0))
      from public.allocations a
      join (select * from private.pnl_lines u where (basis = 'invoiced' or not u.unpaid)
        and private.pnl_in_range(u.kind, basis, u.doc_date, u.cash_date, p_from, p_to)) l on l.transaction_id = a.transaction_id
      where a.project_id = p.id and l.kind = 'expense' and l.pnl_role = 'shared' and l.in_pnl
        and l.currency = 'ILS'
    ), 0),
    'by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', b.currency,
        'income_minor', b.income_minor,
        'direct_minor', b.direct_minor,
        'shared_minor', b.shared_minor,
        'profit_minor', b.income_minor - b.direct_minor - b.shared_minor
      ) order by b.currency)
      from (
        select
          parts.currency,
          coalesce(sum(parts.income_minor), 0)::bigint as income_minor,
          coalesce(sum(parts.direct_minor), 0)::bigint as direct_minor,
          coalesce(sum(parts.shared_minor), 0)::bigint as shared_minor
        from (
          select l.currency as currency,
            case when l.kind = 'income' and (
                l.direction = 'expense'
                or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
                or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
              ) then l.amount_net else 0 end as income_minor,
            case when l.kind = 'expense' and l.pnl_role = 'project' then -l.amount_net else 0 end as direct_minor,
            0::bigint as shared_minor
          from (select * from private.pnl_lines u where (basis = 'invoiced' or not u.unpaid)
        and private.pnl_in_range(u.kind, basis, u.doc_date, u.cash_date, p_from, p_to)) l
          where l.project_id = p.id
            and l.in_pnl
          union all
          select l.currency as currency,
            0::bigint,
            0::bigint,
            -coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0) as shared_minor
          from public.allocations a
          join (select * from private.pnl_lines u where (basis = 'invoiced' or not u.unpaid)
        and private.pnl_in_range(u.kind, basis, u.doc_date, u.cash_date, p_from, p_to)) l on l.transaction_id = a.transaction_id
          where a.project_id = p.id
            and l.kind = 'expense' and l.pnl_role = 'shared'
            and l.in_pnl
        ) parts
        group by parts.currency
      ) b
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'amount_agorot', s.amount,
        'has_shared_share', s.shared
      ) order by s.amount desc, c.name)
      from (
        select e.category_id,
          (-sum(e.amount_net))::bigint as amount,
          bool_or(e.shared) as shared
        from private.project_category_entries(p.id) e
        left join public.categories cat on cat.id = e.category_id
        join public.transactions lt on lt.id = e.transaction_id
        where (basis = 'invoiced' or not private.line_unpaid(lt.direction, lt.doc_kind, lt.cash_date))
          and private.pnl_in_range('expense', basis, e.doc_date, null, p_from, p_to)
          and private.line_in_pnl(
          case when not exists (select 1 from public.loan_splits ls where ls.transaction_id = lt.id)
            then lt.in_pnl_override end,
          cat.excluded_from_pnl, cat.loan_part
        )
        group by e.category_id
      ) s
      left join public.categories c on c.id = s.category_id
    ), '[]'::jsonb),
    'categories_by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', s.currency,
        'id', c.id,
        'name', c.name,
        'amount_minor', s.amount,
        'has_shared_share', s.shared
      ) order by s.currency, s.amount desc, c.name)
      from (
        select e.currency,
          e.category_id,
          (-sum(e.amount_net))::bigint as amount,
          bool_or(e.shared) as shared
        from private.project_category_entries_by_currency(p.id) e
        left join public.categories cat on cat.id = e.category_id
        join public.transactions lt on lt.id = e.transaction_id
        where (basis = 'invoiced' or not private.line_unpaid(lt.direction, lt.doc_kind, lt.cash_date))
          and private.pnl_in_range('expense', basis, e.doc_date, null, p_from, p_to)
          and private.line_in_pnl(
          case when not exists (select 1 from public.loan_splits ls where ls.transaction_id = lt.id)
            then lt.in_pnl_override end,
          cat.excluded_from_pnl, cat.loan_part
        )
        group by e.currency, e.category_id
      ) s
      left join public.categories c on c.id = s.category_id
    ), '[]'::jsonb),
    'excluded_categories_by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', s.currency,
        'id', c.id,
        'name', c.name,
        'amount_minor', s.amount,
        'has_shared_share', s.shared
      ) order by s.currency, s.amount desc, c.name)
      from (
        select e.currency,
          e.category_id,
          (-sum(e.amount_net))::bigint as amount,
          bool_or(e.shared) as shared
        from private.project_category_entries_by_currency(p.id) e
        left join public.categories cat on cat.id = e.category_id
        join public.transactions lt on lt.id = e.transaction_id
        where (basis = 'invoiced' or not private.line_unpaid(lt.direction, lt.doc_kind, lt.cash_date))
          and private.pnl_in_range('expense', basis, e.doc_date, null, p_from, p_to)
          and not private.line_in_pnl(
          case when not exists (select 1 from public.loan_splits ls where ls.transaction_id = lt.id)
            then lt.in_pnl_override end,
          cat.excluded_from_pnl, cat.loan_part
        )
        group by e.currency, e.category_id
      ) s
      left join public.categories c on c.id = s.category_id
    ), '[]'::jsonb),
    -- FLOW-121: income filed to this project that is out of the P&L, by category, on the
    -- same basis as income_agorot. Positive minor units.
    'excluded_income_by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', s.currency,
        'id', c.id,
        'name', c.name,
        'amount_minor', s.amount,
        'count', s.line_count
      ) order by s.currency, s.amount desc, c.name)
      from (
        select l.currency,
          l.category_id,
          sum(l.amount_net)::bigint as amount,
          count(distinct l.transaction_id)::integer as line_count
        from (select * from private.pnl_lines u where (basis = 'invoiced' or not u.unpaid)
        and private.pnl_in_range(u.kind, basis, u.doc_date, u.cash_date, p_from, p_to)) l
        where l.project_id = p.id
          and l.company_id = cid
          and l.kind = 'income'
          and not l.in_pnl
          and (
            l.direction = 'expense'
            or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
            or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
          )
        group by l.currency, l.category_id
      ) s
      left join public.categories c on c.id = s.category_id
    ), '[]'::jsonb),
    'other_currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', bucket.currency,
        'income_minor', bucket.income_minor,
        'expense_minor', bucket.expense_minor,
        'count', bucket.line_count
      ) order by bucket.currency)
      from (
        select
          parts.currency,
          sum(parts.income_minor)::bigint as income_minor,
          sum(parts.expense_minor)::bigint as expense_minor,
          count(distinct parts.transaction_id)::integer as line_count
        from (
          select
            l.currency,
            case when l.kind = 'income' then l.amount_net else 0 end as income_minor,
            case when l.kind = 'expense' then l.amount_net else 0 end as expense_minor,
            l.transaction_id
          from (select * from private.pnl_lines u where (basis = 'invoiced' or not u.unpaid)
        and private.pnl_in_range(u.kind, basis, u.doc_date, u.cash_date, p_from, p_to)) l
          where l.project_id = p.id
            and l.in_pnl
            and l.currency <> 'ILS'
            and (
              (l.kind = 'income' and (
                l.direction = 'expense'
                or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
                or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
              ))
              or (l.kind = 'expense' and l.pnl_role = 'project')
            )
          union all
          select l.currency, 0, coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0), l.transaction_id
          from public.allocations a
          join (select * from private.pnl_lines u where (basis = 'invoiced' or not u.unpaid)
        and private.pnl_in_range(u.kind, basis, u.doc_date, u.cash_date, p_from, p_to)) l on l.transaction_id = a.transaction_id
          where a.project_id = p.id
            and l.kind = 'expense' and l.pnl_role = 'shared'
            and l.in_pnl
            and l.currency <> 'ILS'
        ) parts
        group by parts.currency
      ) bucket
    ), '[]'::jsonb),
    'pending_count', coalesce(jsonb_array_length(waiting), 0),
    'pending_agorot', coalesce((
      select (-sum(t.amount_net))::bigint
      from jsonb_array_elements(waiting) row
      join public.transactions t on t.id = (row->>'transaction_id')::uuid
      where coalesce(t.currency, 'ILS') = 'ILS'
    ), 0),
    'pending_other_currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', bucket.currency,
        'expense_minor', bucket.expense_minor,
        'count', bucket.line_count
      ) order by bucket.currency)
      from (
        select
          t.currency,
          sum(t.amount_net)::bigint as expense_minor,
          count(*)::integer as line_count
        from jsonb_array_elements(waiting) row
        join public.transactions t on t.id = (row->>'transaction_id')::uuid
        where coalesce(t.currency, 'ILS') <> 'ILS'
        group by t.currency
      ) bucket
    ), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'description', t.description,
        'doc_date', t.doc_date,
        'amount_net', t.amount_net,
        'currency', coalesce(t.currency, 'ILS'),
        'direction', t.direction,
        'source', t.source,
        'doc_kind', t.doc_kind,
        'line_status', t.line_status,
        'category', c.name,
        'parts_minor', case when exists (
          select 1 from public.line_splits s0
          where s0.transaction_id = t.id and s0.company_id = cid
        ) then coalesce((
          select sum(s.amount_minor)
          from public.line_splits s
          where s.transaction_id = t.id
            and s.company_id = cid
            and coalesce(s.project_id, t.project_id) = p.id
        ), 0)::bigint end
      ) order by t.doc_date desc, t.created_at desc, t.id desc)
      from (
        select * from public.transactions t
        where t.company_id = cid
          and t.removed_at is null
          and (t.project_id = p.id or exists (
            select 1 from public.allocations a
            where a.transaction_id = t.id and a.project_id = p.id
          ) or exists (
            select 1 from public.line_splits s
            where s.transaction_id = t.id and s.company_id = cid and s.project_id = p.id
          ))
          and private.pnl_in_range(t.direction::text, basis, t.doc_date, t.cash_date, p_from, p_to)
        order by t.doc_date desc, t.created_at desc, t.id desc
        limit 40
      ) t
      left join public.categories c on c.id = t.category_id
    ), '[]'::jsonb)
  )
  into result
  from public.projects p
  where p.id = p_id and p.company_id = cid;
  if result is null then
    return null;
  end if;
  profit :=
    (result->>'income_agorot')::bigint
    - (result->>'direct_agorot')::bigint
    - (result->>'shared_agorot')::bigint;
  select s.available, s.share_agorot into available, share
  from private.overhead_share_for(cid, p_id, basis, p_from, p_to) s;
  return result || jsonb_build_object(
    'from', case when p_from is null or p_to is null then null else p_from end,
    'to', case when p_from is null or p_to is null then null else p_to end,
    'profit_agorot', profit,
    'overhead_share_agorot', case when coalesce(available, false) then coalesce(share, 0) else null end,
    'overhead_weighted', coalesce(available, false),
    'profit_after_overhead_agorot', profit - case when coalesce(available, false) then coalesce(share, 0) else 0 end,
    -- FLOW-105: the loans filed under this project. Nothing above reads them.
    'loans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'name', l.name,
        'currency', l.currency,
        'balance_minor', b.balance_minor,
        'status', l.status,
        'closed_on', l.closed_on,
        'kind', l.kind
      ) order by l.name, l.id)
      from public.loans l
      join public.loan_balances b
        on b.company_id = l.company_id
       and b.loan_id = l.id
      where l.company_id = cid
        and l.project_id = p_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_project(uuid, text, date, date) from public, anon;
grant execute on function public.get_project(uuid, text, date, date) to authenticated, service_role;

commit;
