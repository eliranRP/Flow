-- FLOW-106 part 2. A loan can name its own category for each part. Decision 0127.
-- loans.interest_category_id, escrow_category_id and principal_category_id: null keeps the
-- keyed default (categories.loan_part). Interest and escrow go to an expense category in
-- the P&L, principal to an expense category kept out of it; a keyed loan category takes
-- only its own part. The same rule replaces the keyed-only check in loan_splits_check, so
-- the owner can also correct a part into another category. A category in use by a loan
-- part or a loan cannot flip in or out of the P&L in a way that breaks the rule.
-- mcp_attach_loan_payment uses the loan's categories. mcp_update_loan sets them, undo
-- restores them, mcp_list_loans returns them. Functions are as in
-- 20261008235000_loan_status.sql, 20261008043000_loan_attach_lock_retry.sql and
-- 20261008070000_loan_balance_checks.sql otherwise.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

alter table public.loans
  add column interest_category_id uuid,
  add column escrow_category_id uuid,
  add column principal_category_id uuid,
  add constraint loans_interest_category_fkey
    foreign key (company_id, interest_category_id)
    references public.categories (company_id, id)
    on delete set null (interest_category_id),
  add constraint loans_escrow_category_fkey
    foreign key (company_id, escrow_category_id)
    references public.categories (company_id, id)
    on delete set null (escrow_category_id),
  add constraint loans_principal_category_fkey
    foreign key (company_id, principal_category_id)
    references public.categories (company_id, id)
    on delete set null (principal_category_id);

comment on column public.loans.interest_category_id is
  'Category for the interest part of this loan''s payments. Null uses the keyed default. Decision 0127.';
comment on column public.loans.escrow_category_id is
  'Category for the escrow part. Null uses the keyed default. Decision 0127.';
comment on column public.loans.principal_category_id is
  'Category for the principal part, kept out of the P&L. Null uses the keyed default. Decision 0127.';

create index loans_interest_category_idx on public.loans (interest_category_id) where interest_category_id is not null;
create index loans_escrow_category_idx on public.loans (escrow_category_id) where escrow_category_id is not null;
create index loans_principal_category_idx on public.loans (principal_category_id) where principal_category_id is not null;

-- Whether a category of the company may hold a loan part.
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
      and (c.loan_part is null or c.loan_part = p_part)
      and c.excluded_from_pnl = (p_part = 'principal'::public.loan_split_part)
  );
$$;

revoke all on function private.loan_part_category_ok(uuid, public.loan_split_part, uuid)
  from public, anon, authenticated, service_role;

-- The app writes loans directly under RLS, so the rule holds there too.
create or replace function private.loans_part_categories_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Hold the named categories so a concurrent set_category_pnl waits (it updates the row).
  perform 1
  from public.categories c
  where c.id in (new.interest_category_id, new.escrow_category_id, new.principal_category_id)
  for share;

  if (new.interest_category_id is not null
      and not private.loan_part_category_ok(new.company_id, 'interest', new.interest_category_id))
     or (new.escrow_category_id is not null
      and not private.loan_part_category_ok(new.company_id, 'escrow', new.escrow_category_id))
     or (new.principal_category_id is not null
      and not private.loan_part_category_ok(new.company_id, 'principal', new.principal_category_id))
  then
    raise exception 'loan_category_not_allowed' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.loans_part_categories_check() from public, anon, authenticated;

create trigger loans_part_categories_check
  before insert or update of interest_category_id, escrow_category_id, principal_category_id
  on public.loans
  for each row execute function private.loans_part_categories_check();

-- A category that holds loan parts, or that a loan names, keeps its side of the P&L:
-- flipping it would count principal as an expense, or drop interest from the totals.
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
           and new.excluded_from_pnl is distinct from (s.part = 'principal'::public.loan_split_part)
       )
       or exists (
         select 1 from public.loans l
         where l.company_id = new.company_id
           and (
             (l.principal_category_id = new.id and not new.excluded_from_pnl)
             or ((l.interest_category_id = new.id or l.escrow_category_id = new.id) and new.excluded_from_pnl)
           )
       )
     )
  then
    raise exception 'loan category is fixed' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.categories_loan_pnl_check() from public, anon, authenticated;

create trigger categories_loan_pnl_check
  before update of excluded_from_pnl on public.categories
  for each row execute function private.categories_loan_pnl_check();

-- private.loan_splits_check: as in 20261008070000_loan_balance_checks.sql, with the category rule above.
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

  -- Interest and escrow go to an expense category in the P&L, principal to one kept out;
  -- a keyed loan category takes only its own part (0127). The categories are held so a
  -- concurrent flip of their P&L side waits for this check (the flip updates the row).
  perform 1
  from public.categories c
  where c.id in (select s.category_id from public.loan_splits s where s.transaction_id = txn)
  for share;

  if exists (
    select 1
    from public.loan_splits s
    where s.transaction_id = txn
      and not private.loan_part_category_ok(s.company_id, s.part, s.category_id)
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

  -- Wait for a bank sync that is posting or restoring this line right now, so the
  -- read below sees its status (its trigger cannot see these parts until we commit).
  perform 1 from public.transactions t where t.id = txn for share;

  -- Wait for any other write on this loan to commit, then read its parts too.
  -- No key update: it queues behind the MCP attach (for update) and other checks, but
  -- not behind the key-share locks every loan_splits insert takes on the loan, so two
  -- app splits at once do not deadlock.
  perform 1 from public.loans l where l.id = loan for no key update;

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

-- private.mcp_refused: as in 20261008140000_line_split_preview.sql, plus a category that does not fit.
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
        -- FLOW-106 parts 1 and 2 (decisions 0122 and 0127).
        'closed_on required',
        'loan is open',
        'payments after closed_on',
        'loan closed',
        'category does not fit the loan part'
      ) then p_message
      when p_message = 'loan_closed' then 'loan closed'
      else 'The write was refused.'
    end
  );
$$;

-- mcp_attach_loan_payment: as in 20261008043000_loan_attach_lock_retry.sql, with the loan's categories.
create or replace function public.mcp_attach_loan_payment(
  p_idempotency_key text,
  p_transaction_id uuid,
  p_loan_id uuid,
  p_parts jsonb
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
    -- Lock the loan before the transaction: the app's loan_splits insert takes
    -- its FK locks in that order (loan, then transaction), so the reverse deadlocks.
    perform 1 from public.loans l
    where l.id = p_loan_id
      and l.company_id = cid
    for update;

    select t.currency, t.amount_original
    into txn
    from public.transactions t
    where t.id = p_transaction_id
      and t.company_id = cid
      and t.removed_at is null
    for update;

    if not found then
      response := private.mcp_refused('transaction not found');
    elsif exists (
      select 1 from public.loan_splits s where s.transaction_id = p_transaction_id
    ) then
      response := private.mcp_refused('loan already attached');
    else
      select l.currency, l.project_id,
             l.interest_category_id, l.escrow_category_id, l.principal_category_id
      into loan
      from public.loans l
      where l.id = p_loan_id
        and l.company_id = cid
      for update;

      if not found then
        response := private.mcp_refused('loan not found');
      elsif loan.currency is distinct from txn.currency then
        response := private.mcp_refused('loan currency mismatch');
      else
        select b.balance_minor into balance
        from public.loan_balances b
        where b.company_id = cid and b.loan_id = p_loan_id;

        if coalesce(balance, 0) <= 0 then
          response := private.mcp_refused('loan balance exceeded');
        else
          -- Exactly interest, escrow and principal, once each, as whole non-negative minor units.
          select count(*) = 3
             and count(distinct e.value->>'part') = 3
             -- coalesce: a missing key is null, and bool_and would skip it.
             and bool_and(coalesce(
               jsonb_typeof(e.value) = 'object'
               and e.value->>'part' in ('interest', 'escrow', 'principal')
               and jsonb_typeof(e.value->'amount_minor') = 'number'
               and jsonb_typeof(e.value->'scheduled_minor') = 'number'
               and (e.value->>'amount_minor') ~ '^[0-9]{1,18}$'
               and (e.value->>'scheduled_minor') ~ '^[0-9]{1,18}$',
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
            end loop;
          end if;

          if not coalesce(parts_ok, false) or part_sum is distinct from txn.amount_original then
            response := private.mcp_refused('invalid loan parts');
          elsif principal_amt > balance then
            response := private.mcp_refused('loan balance exceeded');
          else
            -- The loan's own category for a part wins; null keeps the keyed default (0127).
            cat_interest := loan.interest_category_id;
            cat_escrow := loan.escrow_category_id;
            cat_principal := loan.principal_category_id;
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

            if cat_interest is null or cat_escrow is null or cat_principal is null then
              response := private.mcp_refused('loan categories missing');
            else
              for part in select value from jsonb_array_elements(p_parts)
              loop
                insert into public.loan_splits (
                  company_id, loan_id, transaction_id, part,
                  amount_minor, scheduled_minor, category_id
                )
                values (
                  cid,
                  p_loan_id,
                  p_transaction_id,
                  (part->>'part')::public.loan_split_part,
                  (part->>'amount_minor')::bigint,
                  (part->>'scheduled_minor')::bigint,
                  case (part->>'part')
                    when 'interest' then cat_interest
                    when 'escrow' then cat_escrow
                    when 'principal' then cat_principal
                  end
                );
              end loop;

              perform private.loan_splits_check(p_transaction_id);

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
              from public.loan_splits s
              where s.transaction_id = p_transaction_id;
              write_prior := coalesce(write_prior, '{}'::jsonb)
                || jsonb_build_object('parts', written);

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
$$;

revoke all on function public.mcp_attach_loan_payment(text, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_attach_loan_payment(text, uuid, uuid, jsonb) to authenticated;

-- mcp_update_loan: as in 20261008235000_loan_status.sql, plus the part categories.
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
    'interest_category_id', 'escrow_category_id', 'principal_category_id'
  ];
  cat_key text;
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
    if key not in (
      'project_id', 'closed_on', 'interest_category_id', 'escrow_category_id', 'principal_category_id'
    ) and jsonb_typeof(p_patch->key) = 'null' then
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

  -- A part category is a uuid string, or JSON null for the default. An absent key leaves it.
  foreach cat_key in array array['interest_category_id', 'escrow_category_id', 'principal_category_id']
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
           l.interest_category_id, l.escrow_category_id, l.principal_category_id
    into cur
    from public.loans l
    where l.id = p_loan_id
      and l.company_id = cid
    for update;

    if found then
      -- Reopening clears the date unless the patch names one, which is then refused.
      new_status := coalesce((p_patch->>'status')::public.loan_status, cur.status);
      if not set_closed then
        new_closed := case when new_status = 'open'::public.loan_status then null else cur.closed_on end;
      end if;
    end if;

    if not found then
      response := private.mcp_refused('loan not found');
    elsif new_project is not null and not exists (
      select 1 from public.projects p where p.id = new_project and p.company_id = cid
    ) then
      response := private.mcp_refused('project not found');
    elsif exists (
      select 1
      from (values
        ('interest_category_id', 'interest'::public.loan_split_part),
        ('escrow_category_id', 'escrow'::public.loan_split_part),
        ('principal_category_id', 'principal'::public.loan_split_part)
      ) v(k, part)
      where p_patch ? v.k
        and jsonb_typeof(p_patch->v.k) = 'string'
        and not exists (
          select 1 from public.categories c
          where c.company_id = cid and c.id = (p_patch->>v.k)::uuid
        )
    ) then
      response := private.mcp_refused('category not found');
    elsif exists (
      select 1
      from (values
        ('interest_category_id', 'interest'::public.loan_split_part),
        ('escrow_category_id', 'escrow'::public.loan_split_part),
        ('principal_category_id', 'principal'::public.loan_split_part)
      ) v(k, part)
      where p_patch ? v.k
        and jsonb_typeof(p_patch->v.k) = 'string'
        and not private.loan_part_category_ok(cid, v.part, (p_patch->>v.k)::uuid)
      ) then
      response := private.mcp_refused('category does not fit the loan part');
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
        'principal_category_id', cur.principal_category_id
      );

      update public.loans l
      set
        name = coalesce(btrim(p_patch->>'name'), l.name),
        principal_minor = coalesce((p_patch->>'principal_minor')::bigint, l.principal_minor),
        annual_rate_ppm = coalesce((p_patch->>'annual_rate_ppm')::integer, l.annual_rate_ppm),
        term_months = coalesce((p_patch->>'term_months')::integer, l.term_months),
        start_date = coalesce((p_patch->>'start_date')::date, l.start_date),
        payment_minor = coalesce((p_patch->>'payment_minor')::bigint, l.payment_minor),
        escrow_minor = coalesce((p_patch->>'escrow_minor')::bigint, l.escrow_minor),
        project_id = case when set_project then new_project else l.project_id end,
        status = new_status,
        closed_on = new_closed,
        interest_category_id = case when p_patch ? 'interest_category_id'
          then (p_patch->>'interest_category_id')::uuid else l.interest_category_id end,
        escrow_category_id = case when p_patch ? 'escrow_category_id'
          then (p_patch->>'escrow_category_id')::uuid else l.escrow_category_id end,
        principal_category_id = case when p_patch ? 'principal_category_id'
          then (p_patch->>'principal_category_id')::uuid else l.principal_category_id end
      where l.id = p_loan_id
        and l.company_id = cid;

      select l.name, l.principal_minor, l.annual_rate_ppm, l.term_months,
             l.start_date, l.payment_minor, l.escrow_minor, l.project_id,
             l.status, l.closed_on,
             l.interest_category_id, l.escrow_category_id, l.principal_category_id
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
        'principal_category_id', cur.principal_category_id
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

-- mcp_list_loans: as in 20261008235000_loan_status.sql, plus the part categories.
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
    'principal_category_name', cp.name
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
  where l.company_id = (select private.current_company_id());
$$;

revoke all on function public.mcp_list_loans() from public, anon;
grant execute on function public.mcp_list_loans() to authenticated, service_role;

-- mcp_undo: loan_update also compares and restores the part categories.
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
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_id is null
    or p_kind is null
    or p_kind not in (
      'review', 'reassign', 'project', 'category', 'category_hidden', 'category_pnl',
      'loan', 'loan_update', 'loan_split', 'overhead_project', 'company', 'line_split',
      'line_pnl'
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
        insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor)
        select cid, p_id, b.ord::smallint, (b.part->>'category_id')::uuid, (b.part->>'project_id')::uuid,
          (b.part->>'amount_minor')::bigint
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
             l.interest_category_id, l.escrow_category_id, l.principal_category_id
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
          'principal_category_id', cur_loan.principal_category_id
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
        from (values ('interest_category_id'), ('escrow_category_id'), ('principal_category_id')) v(k)
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
            then (before->>'principal_category_id')::uuid else l.principal_category_id end
        where l.id = p_id and l.company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
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

commit;
