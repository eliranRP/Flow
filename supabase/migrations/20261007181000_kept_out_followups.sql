-- FLOW-112: kept-out categories follow-ups (decision 0099).
-- 1. Default names match near variants ("Owner distribution", "CapEx/Rehab"), and a rename into a default name keeps the line out.
-- 2. An owner who is also listed as a viewer can set the flag on their own company.
-- 3. The three loan categories carry a stable key, categories.loan_part, instead of being matched by their Hebrew names.

begin;

set local lock_timeout = '5s';

-- Lower case, "&" and "and" dropped, punctuation to spaces, apostrophes removed, and a plural "s" dropped from words of 4+ letters.
create or replace function private.pnl_name_key(p_name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(coalesce(p_name, '')), '[''’]', '', 'g'),
          '[^a-z0-9]+', ' ', 'g'
        ),
        '(^| )and( |$)', ' ', 'g'
      ),
      '([a-z]{3,})s( |$)', '\1\2', 'g'
    ),
    ' +', ' ', 'g'
  ));
$$;

revoke all on function private.pnl_name_key(text) from public, anon, authenticated, service_role;

create or replace function private.non_pnl_category(p_kind public.category_kind, p_name text)
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
        ('income', 'loan proceeds'),
        ('income', 'owner contributions'),
        ('income', 'security deposits received'),
        ('income', 'internal transfers in'),
        ('expense', 'loan principal'),
        ('expense', 'property purchase price'),
        ('expense', 'purchase deposits (earnest money)'),
        ('expense', 'purchase deposits'),
        ('expense', 'closing & acquisition costs'),
        ('expense', 'capex & rehab'),
        ('expense', 'furniture & fixtures'),
        ('expense', 'owner distributions'),
        ('expense', 'security deposits returned'),
        ('expense', 'credit card payments'),
        ('expense', 'internal transfers out'),
        ('expense', 'utility deposits')
    ) as d(kind, name)
    where d.kind = p_kind::text
      and private.pnl_name_key(d.name) = private.pnl_name_key(p_name)
  );
$$;

revoke all on function private.non_pnl_category(public.category_kind, text) from public, anon, authenticated, service_role;

-- Stable key for the three loan categories (0088). Only the seed and this migration set it;
-- the owner has no update grant on categories.
alter table public.categories add column loan_part public.loan_split_part;

comment on column public.categories.loan_part is
  'Set on the three seeded loan categories only: interest, escrow, principal. Loan checks use it, not the name. FLOW-112.';

update public.categories c
set loan_part = v.part
from (
  values
    ('ריבית משכנתא', 'interest'::public.loan_split_part),
    ('מסים וביטוח', 'escrow'::public.loan_split_part),
    ('תשלומי הלוואה', 'principal'::public.loan_split_part)
) as v(name, part)
where c.kind = 'expense'::public.category_kind
  and c.name = v.name
  and c.loan_part is null;

create unique index categories_company_loan_part_key
  on public.categories (company_id, loan_part)
  where loan_part is not null;

-- Near-variant names that the exact list missed. A name the old list matched, and a category the owner
-- already set through set_category_pnl, keep their current flag.
update public.categories c
set excluded_from_pnl = true
where not c.excluded_from_pnl
  and c.loan_part is null
  and private.non_pnl_category(c.kind, c.name)
  and lower(btrim(c.name)) not in (
    'loan proceeds', 'owner contributions', 'security deposits received', 'internal transfers in',
    'loan principal', 'property purchase price', 'purchase deposits (earnest money)', 'purchase deposits',
    'closing & acquisition costs', 'capex & rehab', 'furniture & fixtures', 'owner distributions',
    'security deposits returned', 'credit card payments', 'internal transfers out', 'utility deposits'
  )
  and not exists (
    select 1 from private.mcp_writes w
    where w.kind = 'category_pnl' and w.category_id = c.id
  );

-- Insert: a default name starts kept out. Rename (there is no owner RPC for it yet; the owner has no
-- update grant on categories): a name that becomes a default name is kept out, and a rename away from
-- one keeps the current flag.
create or replace function private.categories_default_pnl()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.loan_part is not null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if private.non_pnl_category(new.kind, new.name) then
      new.excluded_from_pnl := true;
    end if;
  elsif (new.name is distinct from old.name or new.kind is distinct from old.kind)
    and private.non_pnl_category(new.kind, new.name)
    and not private.non_pnl_category(old.kind, old.name)
  then
    new.excluded_from_pnl := true;
  end if;
  return new;
end;
$$;

revoke all on function private.categories_default_pnl() from public, anon, authenticated, service_role;

drop trigger if exists categories_default_pnl on public.categories;
create trigger categories_default_pnl
  before insert or update of name, kind on public.categories
  for each row execute function private.categories_default_pnl();

create or replace function private.seed_default_categories()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.categories (company_id, name, kind, sort_order, is_default) values
    (new.id, 'חומרים', 'expense', 1, true),
    (new.id, 'קבלני משנה', 'expense', 2, true),
    (new.id, 'עבודה', 'expense', 3, true),
    (new.id, 'ציוד והשכרה', 'expense', 4, true),
    (new.id, 'הובלה', 'expense', 5, true),
    (new.id, 'ביטוח', 'expense', 6, true),
    (new.id, 'אחר', 'expense', 7, true),
    (new.id, 'תקבול מלקוח', 'income', 1, true),
    (new.id, 'הכנסה אחרת', 'income', 2, true);
  insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl, loan_part) values
    (new.id, 'תשלומי הלוואה', 'expense', 8, true, true, 'principal'),
    (new.id, 'העברות', 'expense', 9, true, true, null),
    (new.id, 'העברות', 'income', 3, true, true, null),
    (new.id, 'ריבית משכנתא', 'expense', 10, true, false, 'interest'),
    (new.id, 'מסים וביטוח', 'expense', 11, true, false, 'escrow');
  return new;
end;
$$;

revoke all on function private.seed_default_categories() from public, anon;
grant execute on function private.seed_default_categories() to authenticated, service_role;

create or replace function public.set_category_excluded_from_pnl(p_id uuid, p_excluded boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  cat record;
begin
  -- The owner's own company comes first, so an owner who is also listed as a viewer is not refused.
  cid := private.current_company_id();
  if cid is null then
    if exists (
      select 1 from public.company_viewers v where v.user_id = (select auth.uid())
    ) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  select c.kind, c.loan_part into cat
  from public.categories c
  where c.id = p_id and c.company_id = cid;
  if not found then
    raise exception 'category not found';
  end if;
  if cat.loan_part is not null then
    raise exception 'loan category is fixed';
  end if;
  update public.categories
  set excluded_from_pnl = p_excluded
  where id = p_id and company_id = cid;
end;
$$;

revoke all on function public.set_category_excluded_from_pnl(uuid, boolean) from public, anon;
grant execute on function public.set_category_excluded_from_pnl(uuid, boolean) to authenticated, service_role;

create or replace function public.list_categories()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'kind', c.kind,
    'hidden', c.hidden,
    'is_default', c.is_default,
    'excluded_from_pnl', c.excluded_from_pnl,
    'loan_part', c.loan_part
  ) order by c.kind, c.sort_order, c.name), '[]'::jsonb)
  from public.categories c
  where c.company_id = (select private.current_company_id());
$$;

create or replace function private.fill_suggested_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  picked uuid;
begin
  -- The owner's category is not a guess, and a sync must not replace it.
  if new.user_assigned or new.category_assigned then
    new.category_suggested := false;
    return new;
  end if;

  if new.category_id is not null then
    if tg_op = 'INSERT' then
      new.category_suggested := false;
    elsif new.category_id is distinct from old.category_id
      and new.category_suggested is not distinct from old.category_suggested then
      new.category_suggested := false;
    end if;
    return new;
  end if;

  picked := null;
  if new.supplier_id is not null then
    select s.remembered_category_id into picked
    from public.suppliers s
    join public.categories c
      on c.id = s.remembered_category_id
     and c.company_id = s.company_id
    where s.id = new.supplier_id
      and s.company_id = new.company_id
      and not c.hidden
      and c.kind::text = new.direction::text;
  end if;

  if picked is null and new.supplier_id is not null then
    select chosen.category_id into picked
    from (
      select t.category_id
      from public.transactions t
      join public.categories c
        on c.id = t.category_id
       and c.company_id = t.company_id
      where t.company_id = new.company_id
        and t.supplier_id = new.supplier_id
        and t.direction = new.direction
        and t.id is distinct from new.id
        and t.removed_at is null
        and t.user_assigned
        and not c.hidden
        and c.kind::text = new.direction::text
      group by t.category_id
      order by count(*) desc, max(t.doc_date) desc
      limit 1
    ) chosen;
  end if;

  if picked is null then
    select c.id into picked
    from public.categories c
    where c.company_id = new.company_id
      and c.kind::text = new.direction::text
      and c.is_default
      and not c.hidden
      and not c.excluded_from_pnl
      -- Loan-payment parts (0088) are never a guess for a new line.
      and c.loan_part is null
    order by c.sort_order, c.name
    limit 1;
  end if;

  if picked is null then
    new.category_suggested := false;
    return new;
  end if;

  new.category_id := picked;
  -- A remembered supplier rule is the assignment. History and the default stay a suggestion.
  new.category_suggested := not exists (
    select 1
    from public.suppliers s
    where s.id = new.supplier_id
      and s.company_id = new.company_id
      and s.remembered_category_id = picked
  );
  return new;
end;
$$;

-- Based on the FLOW-111 versions (20261007161110_loan_payment_checks.sql); only the category match changes.
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

  -- Same rule as public.loan_balances: posted principal still on the books,
  -- not waiting for review, may not pass the loan's principal.
  if exists (
    select 1
    from public.loans l
    where l.id = (select s.loan_id from public.loan_splits s where s.transaction_id = txn limit 1)
      and l.principal_minor < (
        select coalesce(sum(s.amount_minor), 0)
        from public.loan_splits s
        join public.transactions t
          on t.company_id = s.company_id
         and t.id = s.transaction_id
        where s.company_id = l.company_id
          and s.loan_id = l.id
          and s.part = 'principal'::public.loan_split_part
          and t.line_status = 'posted'::public.line_status
          and t.removed_at is null
          and s.needs_review is not true
      )
  ) then
    raise exception 'loan_split_balance' using errcode = '23514';
  end if;
end;
$$;

revoke all on function private.loan_splits_check(uuid) from public, anon, authenticated;

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
      select l.currency
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
            select c.id into cat_interest
            from public.categories c
            where c.company_id = cid and c.loan_part = 'interest'::public.loan_split_part;
            select c.id into cat_escrow
            from public.categories c
            where c.company_id = cid and c.loan_part = 'escrow'::public.loan_split_part;
            select c.id into cat_principal
            from public.categories c
            where c.company_id = cid and c.loan_part = 'principal'::public.loan_split_part;

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

              -- Kept so undo can tell whether the app corrected the split afterwards.
              select jsonb_agg(jsonb_build_object(
                'part', s.part,
                'amount_minor', s.amount_minor,
                'category_id', s.category_id
              ) order by s.part)
              into written
              from public.loan_splits s
              where s.transaction_id = p_transaction_id;

              insert into private.mcp_writes (token_id, user_id, kind, loan_id, transaction_id, prior)
              values (token, auth.uid(), 'loan_split', p_loan_id, p_transaction_id, written);

              response := jsonb_build_object(
                'ok', true,
                'data', jsonb_build_object(
                  'loan_id', p_loan_id,
                  'transaction_id', p_transaction_id,
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
    when deadlock_detected or serialization_failure then
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

commit;
