-- FLOW-953. Balance-sheet accounts through book_line. Decision 0210 (builds on 0208 and 0209).
--
-- The P&L does not change: private.pnl_lines and every consumer are untouched, and book_line still
-- writes the legacy rows the P&L reads. What changes is where a kept-out row's leg lands, and what
-- book_line takes:
--   1. Two new system accounts, both asset: Transfers in transit and Property.
--   2. public.categories.ledger_account_id: the balance-sheet account a kept-out category posts to.
--      private.kept_out_account reads it first, then the loan part (principal -> Loan principal,
--      escrow -> Escrow), then Suspense. A new category is bound by its name
--      (private.kept_out_default_account): the built-in kept-out names (loan proceeds, owner
--      contributions and distributions, security deposits, internal transfers and העברות, purchase
--      price, purchase deposits, closing and acquisition costs, capex and rehab, furniture and
--      fixtures) and a category named like the account itself. Existing categories are bound the
--      same way once here. A loan-part category is never bound: its part routes it.
--   3. The categories trigger re-posts a category's lines when its binding changes, and the
--      migration re-posts the lines of every category it binds; the FLOW-951 gate then proves
--      the shadow P&L still equals the posting rules for every company.
--   4. list_accounts: every category account and every balance-sheet system account except
--      Suspense and VAT control is bookable; a kept-out category's account says where it posts
--      (posts_to). get_line_legs names each leg's category, kept-out legs included.
--   5. book_line takes asset and liability legs. Each is mirrored to the legacy model as a split
--      part (or the whole line) in a kept-out category, so the unchanged P&L keeps it out of profit
--      exactly as the equivalent split_line booking does:
--        - a leg on a kept-out category's own account: that category;
--        - a leg on a balance-sheet system account: the kept-out category that posts there and whose
--          kind matches the leg's side (a debit an expense category, a credit an income category);
--          none: a hidden kept-out category named like the account, bound to it; more than one:
--          refused (book the leg on the category's own account).
--      The self-check now compares accounts: the posted item legs, grouped by account, project and
--      sign, must equal the requested legs mapped to the account they post to. Refused as before:
--      a VAT leg, more than one bank leg (the legs carry no currency, so a booking is in one
--      currency: the line's). New: Suspense and the Uncategorized accounts take no booking, and an
--      existing line switched into the P&L by set_line_pnl takes no kept-out leg.
--   6. The new reasons join private.mcp_refused's allowlist (counted anchor), replacing the phase-1
--      reason no longer raised. 'account not found' and 'transaction not found' stay as they are.
--
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The balance-sheet system accounts.
-- ---------------------------------------------------------------------------
create or replace function private.ensure_accounts(p_company uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A bridge account for every category (type = category kind; excluded + loan_part copied).
  insert into public.accounts (company_id, name, type, category_id, loan_part, excluded_from_pnl)
  select c.company_id, c.name, c.kind::text, c.id, c.loan_part, coalesce(c.excluded_from_pnl, false)
  from public.categories c
  where c.company_id = p_company
  on conflict (company_id, category_id) where category_id is not null do nothing;

  -- System accounts (category_id null), keyed by name. FLOW-953: Transfers in transit and Property.
  insert into public.accounts (company_id, name, type, is_bank, excluded_from_pnl)
  values
    (p_company, 'Bank/Clearing', 'asset', true, true),
    (p_company, 'Loan principal', 'liability', false, true),
    (p_company, 'Escrow', 'asset', false, true),
    (p_company, 'Owner capital', 'liability', false, true),
    (p_company, 'Security deposit held', 'liability', false, true),
    (p_company, 'Transfers in transit', 'asset', false, true),
    (p_company, 'Property', 'asset', false, true),
    (p_company, 'Suspense', 'asset', false, true),
    (p_company, 'VAT control', 'liability', false, true),
    (p_company, 'Uncategorized income', 'income', false, false),
    (p_company, 'Uncategorized expense', 'expense', false, false)
  on conflict (company_id, name) where category_id is null do nothing;
end;
$$;

select private.ensure_accounts(c.id) from public.companies c;

-- ---------------------------------------------------------------------------
-- 2. The category's balance-sheet account.
-- ---------------------------------------------------------------------------
alter table public.categories add column ledger_account_id uuid;

alter table public.categories
  add constraint categories_company_id_ledger_account_id_fkey
  foreign key (company_id, ledger_account_id) references public.accounts (company_id, id)
  on delete set null (ledger_account_id);

-- The key's index (decision 0195).
create index categories_company_id_ledger_account_id_fk_idx
  on public.categories (company_id, ledger_account_id) where ledger_account_id is not null;

comment on column public.categories.ledger_account_id is
  'FLOW-953 (decision 0210). The balance-sheet system account this category''s kept-out rows post to; '
  'null follows the loan part, else Suspense. Set by name when the category is created, and by '
  'book_line on the hidden category it makes for an account no category posts to.';

-- The system account a category's name binds it to, or null. The built-in kept-out names (the list of
-- private.non_pnl_category, by kind) and a category named like the account itself (any kind).
create or replace function private.kept_out_default_account(p_kind public.category_kind, p_name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select d.account
  from (
    values
      (null, 'loan principal', 'Loan principal'),
      (null, 'escrow', 'Escrow'),
      (null, 'owner capital', 'Owner capital'),
      (null, 'security deposit held', 'Security deposit held'),
      (null, 'transfers in transit', 'Transfers in transit'),
      (null, 'property', 'Property'),
      (null, 'העברות', 'Transfers in transit'),
      ('income', 'loan proceeds', 'Loan principal'),
      ('income', 'כסף שהתקבל מהלוואות', 'Loan principal'),
      ('income', 'owner contributions', 'Owner capital'),
      ('income', 'security deposits received', 'Security deposit held'),
      ('income', 'internal transfers in', 'Transfers in transit'),
      ('expense', 'property purchase price', 'Property'),
      ('expense', 'purchase deposits (earnest money)', 'Property'),
      ('expense', 'purchase deposits', 'Property'),
      ('expense', 'closing & acquisition costs', 'Property'),
      ('expense', 'capex & rehab', 'Property'),
      ('expense', 'furniture & fixtures', 'Property'),
      ('expense', 'owner distributions', 'Owner capital'),
      ('expense', 'security deposits returned', 'Security deposit held'),
      ('expense', 'internal transfers out', 'Transfers in transit')
  ) as d(kind, name, account)
  where (d.kind is null or d.kind = p_kind::text)
    and private.pnl_name_key(d.name) = private.pnl_name_key(p_name)
  limit 1;
$$;

revoke all on function private.kept_out_default_account(public.category_kind, text) from public, anon, authenticated, service_role;

-- Kept-out routing: the category's own account first, then the loan part, then Suspense.
create or replace function private.kept_out_account(p_company uuid, p_category uuid, p_loan_part public.loan_split_part)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select c.ledger_account_id from public.categories c
     where c.id = p_category and c.company_id = p_company),
    (select a.id
     from public.accounts a
     where a.company_id = p_company
       and a.category_id is null
       and a.name = case coalesce(p_loan_part,
                                   (select c.loan_part from public.categories c
                                    where c.id = p_category and c.company_id = p_company))
                      when 'principal' then 'Loan principal'
                      when 'escrow' then 'Escrow'
                      else 'Suspense'
                    end));
$$;

-- A new category: the chart of accounts first (as 0208), then its binding by name.
create or replace function private.legs_ensure_accounts_tg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'companies' then
    perform private.ensure_accounts(new.id);
  else
    perform private.ensure_accounts(new.company_id);
    if new.ledger_account_id is null and new.loan_part is null then
      update public.categories c
      set ledger_account_id = a.id
      from public.accounts a
      where c.id = new.id and c.company_id = new.company_id
        and a.company_id = new.company_id and a.category_id is null
        and a.name = private.kept_out_default_account(new.kind, new.name);
    end if;
  end if;
  return null;
end;
$$;

-- The categories trigger also re-posts a category's lines when its binding changes.
create or replace function private.legs_category_sync_tg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.accounts a
  set name = new.name,
      type = new.kind::text,
      loan_part = new.loan_part,
      excluded_from_pnl = coalesce(new.excluded_from_pnl, false)
  where a.company_id = new.company_id and a.category_id = new.id
    and (a.name, a.type, a.loan_part, a.excluded_from_pnl)
      is distinct from (new.name, new.kind::text, new.loan_part, coalesce(new.excluded_from_pnl, false));

  if new.kind is distinct from old.kind
    or new.excluded_from_pnl is distinct from old.excluded_from_pnl
    or new.loan_part is distinct from old.loan_part
    or new.ledger_account_id is distinct from old.ledger_account_id
  then
    perform private.rebuild_legs_many(new.company_id, array(
      select t.id from public.transactions t
      where t.company_id = new.company_id and t.category_id = new.id
      union
      select s.transaction_id from public.line_splits s
      where s.company_id = new.company_id and s.category_id = new.id
      union
      select s.transaction_id from public.loan_splits s
      where s.company_id = new.company_id and s.category_id = new.id
    ));
  end if;
  return null;
end;
$$;

drop trigger legs_category_sync on public.categories;
create trigger legs_category_sync
  after update of name, kind, excluded_from_pnl, loan_part, ledger_account_id on public.categories
  for each row execute function private.legs_category_sync_tg();

-- ---------------------------------------------------------------------------
-- 3. Bind the existing categories by name. Each update re-posts that category's lines through the
--    trigger above, so their kept-out legs move from Suspense to the bound account.
-- ---------------------------------------------------------------------------
update public.categories c
set ledger_account_id = a.id
from public.accounts a
where a.company_id = c.company_id and a.category_id is null
  and c.ledger_account_id is null and c.loan_part is null
  and a.name = private.kept_out_default_account(c.kind, c.name);

-- ---------------------------------------------------------------------------
-- 4. list_accounts and get_line_legs.
-- ---------------------------------------------------------------------------
-- bookable: the bank, every category account (a kept-out one posts to its balance-sheet account,
-- posts_to), and every balance-sheet system account except Suspense and VAT control.
create or replace function public.mcp_accounts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object('accounts', coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'name', coalesce(c.name, a.name),
        'type', coalesce(c.kind::text, a.type),
        'category_id', a.category_id,
        'system', a.category_id is null,
        'is_bank', a.is_bank,
        'excluded_from_pnl', case when c.id is null then a.excluded_from_pnl else coalesce(c.excluded_from_pnl, false) end,
        'loan_part', coalesce(c.loan_part, a.loan_part),
        'hidden', coalesce(c.hidden, false),
        'bookable', a.is_bank or c.id is not null
          or (a.category_id is null and a.type in ('asset', 'liability') and a.name not in ('Suspense', 'VAT control')),
        'posts_to', case when coalesce(c.excluded_from_pnl, false)
                      then private.kept_out_account(cid, c.id, c.loan_part) end
      ) order by a.category_id is not null, a.is_bank desc, coalesce(c.kind::text, a.type),
        lower(coalesce(c.name, a.name)), a.id)
    from public.accounts a
    left join public.categories c on c.id = a.category_id and c.company_id = a.company_id
    where a.company_id = cid
  ), '[]'::jsonb));
end;
$$;

-- category_id is the leg's own category (the one the person sees, kept-out legs included), else the
-- account's; category_name names it.
create or replace function public.mcp_line_legs(p_transaction_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  t public.transactions%rowtype;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into t from public.transactions x
  where x.id = p_transaction_id and x.company_id = cid and x.removed_at is null;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'transaction_id', t.id,
    'direction', t.direction,
    'line_status', t.line_status,
    'currency', coalesce(t.currency, 'ILS'),
    'amount_gross', t.amount_gross,
    'vat_amount', t.vat_amount,
    'legs', coalesce((
      select jsonb_agg(jsonb_build_object(
          'ordinal', l.ordinal,
          'account_id', l.account_id,
          'account_name', coalesce(c.name, a.name),
          'account_type', coalesce(c.kind::text, a.type),
          'category_id', coalesce(l.category_id, a.category_id),
          'category_name', lc.name,
          'is_bank', a.is_bank,
          'project_id', l.project_id,
          'amount_minor', l.amount_minor
        ) order by l.ordinal)
      from public.legs l
      join public.accounts a on a.id = l.account_id and a.company_id = l.company_id
      left join public.categories c on c.id = a.category_id and c.company_id = a.company_id
      left join public.categories lc on lc.id = coalesce(l.category_id, a.category_id) and lc.company_id = l.company_id
      where l.company_id = cid and l.transaction_id = t.id
    ), '[]'::jsonb),
    'balanced', coalesce((
      select sum(l.amount_minor) = 0 from public.legs l
      where l.company_id = cid and l.transaction_id = t.id
    ), true)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. book_line: asset and liability legs.
-- ---------------------------------------------------------------------------
-- The kept-out category a leg on a balance-sheet system account is mirrored to: the one kept-out
-- category of the leg's side (a debit expense, a credit income) that posts to the account; none: a
-- hidden kept-out category named like the account (bound to it by name when it is created); more than
-- one: refused. Called only by mcp_book_line, inside its write.
create or replace function private.ledger_mirror_category(p_company uuid, p_account uuid, p_debit boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  side public.category_kind := case when p_debit then 'expense' else 'income' end;
  found_count integer;
  pick uuid;
  acct_name text;
begin
  select count(*), (array_agg(c.id))[1] into found_count, pick
  from public.categories c
  where c.company_id = p_company and c.kind = side and c.excluded_from_pnl
    and private.kept_out_account(p_company, c.id, c.loan_part) = p_account;
  if found_count = 1 then
    return pick;
  end if;
  if found_count > 1 then
    raise exception 'book_line: several kept-out categories post to this account — book the leg on one category''s account';
  end if;

  select a.name into acct_name from public.accounts a
  where a.id = p_account and a.company_id = p_company and a.category_id is null;
  if exists (select 1 from public.categories c where c.company_id = p_company and c.kind = side and c.name = acct_name) then
    raise exception 'book_line: no kept-out category posts to this account';
  end if;
  insert into public.categories (company_id, name, kind, sort_order, is_default, hidden, excluded_from_pnl)
  values (p_company, acct_name, side,
    coalesce((select max(c.sort_order) + 1 from public.categories c where c.company_id = p_company and c.kind = side), 1),
    false, true, true)
  returning id into pick;
  if private.kept_out_account(p_company, pick, null) is distinct from p_account then
    raise exception 'book_line: no kept-out category posts to this account';
  end if;
  return pick;
end;
$$;

revoke all on function private.ledger_mirror_category(uuid, uuid, boolean) from public, anon, authenticated, service_role;

-- Same signature as FLOW-950; grants are kept.
create or replace function public.mcp_book_line(
  p_idempotency_key text,
  p_doc_date date,
  p_direction text,
  p_currency text,
  p_description text,
  p_legs jsonb,
  p_project_id uuid default null,
  p_transaction_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate jsonb;
  token uuid;
  cid uuid;
  hash text;
  prior jsonb;
  response jsonb;
  rid uuid;
  line public.transactions%rowtype;
  bank_legs integer;
  bank_amt bigint;
  content integer;
  leg jsonb;
  ord integer;
  acct public.accounts%rowtype;
  cat public.categories%rowtype;
  amt bigint;
  post_to uuid;
  mirror uuid;
  resolved jsonb := '[]'::jsonb;
  parts jsonb;
  part_count integer;
  one_part jsonb;
  default_project uuid;
  want jsonb;
  got jsonb;
  before_parts jsonb;
  written jsonb;
  write_id uuid;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) < 1 or char_length(p_idempotency_key) > 128
    or p_direction is null or p_direction not in ('income', 'expense')
    or p_legs is null or jsonb_typeof(p_legs) <> 'array' or jsonb_array_length(p_legs) < 2
    or jsonb_array_length(p_legs) > 50
    or (p_transaction_id is null and (
      p_doc_date is null
      or p_currency is null or p_currency !~ '^[A-Z]{3}$'
      or p_description is null or char_length(btrim(p_description)) < 1 or char_length(p_description) > 120))
    or (p_transaction_id is not null and (
      p_doc_date is not null or p_currency is not null or p_description is not null))
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  cid := private.current_company_id();

  -- A new line keeps FLOW-948's hash, so a stored key still replays.
  hash := case
    when p_transaction_id is null then
      'book_line|' || p_direction || '|' || p_doc_date::text || '|' || p_currency
        || '|' || btrim(p_description) || '|' || coalesce(p_project_id::text, '') || '|' || p_legs::text
    else
      'book_line|line|' || p_transaction_id::text || '|' || p_direction
        || '|' || coalesce(p_project_id::text, '') || '|' || p_legs::text
  end;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  response := private.mcp_error('refused', 'The write was refused.');
  begin
    -- The existing line first: the caller's, posted, the same direction, VAT-free, no loan split and no
    -- open review (split_line's own messages).
    if p_transaction_id is not null then
      select * into line from public.transactions t
      where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null
      for update;
      if not found then
        raise exception 'transaction not found';
      end if;
      if line.line_status is distinct from 'posted' then
        raise exception 'book_line: the line is not posted';
      end if;
      if line.direction::text is distinct from p_direction then
        raise exception 'book_line: direction does not match the line';
      end if;
      if coalesce(line.vat_amount, 0) <> 0 then
        raise exception 'book_line: a line with VAT is a later phase';
      end if;
      if exists (select 1 from public.loan_splits s where s.transaction_id = line.id) then
        raise exception 'line has a loan split';
      end if;
      if exists (
        select 1 from public.review_queue q
        where q.transaction_id = line.id and q.company_id = cid and q.status = 'open'
          and q.reason is distinct from 'split_mismatch'
      ) then
        raise exception 'line has an open review';
      end if;
      if line.in_pnl_override is false then
        raise exception 'book_line: the line is kept out of the P&L';
      end if;
    end if;
    if p_project_id is not null
      and not exists (select 1 from public.projects p where p.id = p_project_id and p.company_id = cid)
    then
      raise exception 'project not found';
    end if;

    -- Validate every leg (shape, company ownership, project ownership) and resolve it: the account it
    -- posts to and the category it is mirrored to (null for the bank leg).
    bank_legs := 0;
    bank_amt := 0;
    content := 0;
    for leg, ord in select e.value, e.ord from jsonb_array_elements(p_legs) with ordinality as e(value, ord)
    loop
      if jsonb_typeof(leg) <> 'object'
        or not (leg ? 'account_id') or not (leg ? 'amount_minor')
        or jsonb_typeof(leg->'amount_minor') <> 'number'
        or (leg->>'amount_minor') !~ '^-?[0-9]{1,15}$'
        or exists (select 1 from jsonb_object_keys(leg) k where k not in ('account_id', 'amount_minor', 'project_id'))
      then
        raise exception 'validation';
      end if;
      select * into acct from public.accounts a
      where a.id = (leg->>'account_id')::uuid and a.company_id = cid;
      if not found then
        raise exception 'account not found';
      end if;
      if (leg ? 'project_id') and jsonb_typeof(leg->'project_id') = 'string'
        and not exists (select 1 from public.projects p where p.id = (leg->>'project_id')::uuid and p.company_id = cid)
      then
        raise exception 'project not found';
      end if;
      amt := (leg->>'amount_minor')::bigint;
      if acct.is_bank then
        bank_legs := bank_legs + 1;
        bank_amt := amt;
        continue;
      end if;
      if amt = 0 then
        raise exception 'validation';
      end if;
      if acct.category_id is not null then
        -- A category account, read from the live category (the bridge row's copy is never trusted):
        -- in the P&L it posts to itself; kept out, to the category's balance-sheet account.
        select * into cat from public.categories c
        where c.id = acct.category_id and c.company_id = cid;
        if not found then
          raise exception 'account not found';
        end if;
        mirror := cat.id;
        post_to := case when coalesce(cat.excluded_from_pnl, false)
                     then private.kept_out_account(cid, cat.id, cat.loan_part) else acct.id end;
      elsif acct.name = 'VAT control' then
        raise exception 'book_line: a VAT leg is a later phase';
      elsif acct.type in ('asset', 'liability') and acct.name <> 'Suspense' then
        -- A balance-sheet system account: mirrored to the kept-out category of the leg's side there.
        mirror := private.ledger_mirror_category(cid, acct.id, amt > 0);
        post_to := acct.id;
      else
        raise exception 'book_line: unsupported account — use a category account or a balance-sheet account';
      end if;
      content := content + 1;
      resolved := resolved || jsonb_build_object(
        'ord', ord, 'acct', post_to, 'cat', mirror,
        'proj', nullif(leg->>'project_id', '')::uuid, 'amt', amt);
    end loop;

    if bank_legs <> 1 then
      raise exception 'exactly one bank leg is required';
    end if;
    if content < 1 then
      raise exception 'at least one category leg is required';
    end if;
    if (select sum((value->>'amount_minor')::bigint) from jsonb_array_elements(p_legs)) <> 0 then
      raise exception 'legs do not balance';
    end if;
    -- The bank movement's sign is the line's direction (deposit = income, payment = expense).
    if bank_amt = 0 or (bank_amt > 0) <> (p_direction = 'income') then
      raise exception 'the bank leg sign must match the direction';
    end if;
    if p_transaction_id is not null and bank_amt <> line.amount_gross then
      raise exception 'book_line: the bank leg must equal the line amount';
    end if;
    -- A line switched into the P&L counts every part that has no loan part (decision 0112), so a kept-out
    -- part would land in profit.
    if p_transaction_id is not null and line.in_pnl_override is true and exists (
      select 1 from jsonb_to_recordset(resolved) as r(cat uuid)
      join public.categories c on c.id = r.cat and c.company_id = cid
      where c.excluded_from_pnl and c.loan_part is null
    ) then
      raise exception 'book_line: the line is switched into the P&L — clear set_line_pnl first';
    end if;

    -- The parts: one per (category, effective project, side). A leg opposite to the bank leg is a
    -- normal part; one with the bank leg's sign a gross-up part. Same category, project and sign merge.
    default_project := case when p_transaction_id is null then null else line.project_id end;
    select coalesce(jsonb_agg(jsonb_build_object(
          'category_id', g.category_id,
          'project_id', g.project_id,
          'amount_minor', g.amount_minor,
          'gross_up', g.gross_up
        ) order by g.first_at), '[]'::jsonb),
      count(*)
    into parts, part_count
    from (
      select r.cat as category_id,
        -- A normal part with no project stays on the line's project (and role); a gross-up part must
        -- name one, so it falls back to the line's project.
        coalesce(r.proj, p_project_id,
          case when sign(r.amt) = sign(bank_amt) then default_project end) as project_id,
        sign(r.amt) = sign(bank_amt) as gross_up,
        sum(abs(r.amt)) as amount_minor,
        min(r.ord) as first_at
      from jsonb_to_recordset(resolved) as r(ord integer, acct uuid, cat uuid, proj uuid, amt bigint)
      group by 1, 2, 3
    ) g;

    if p_transaction_id is null then
      if part_count = 1 then
        -- One category: a whole line of its own kind, as FLOW-948 booked it.
        one_part := parts->0;
        if (select c.kind::text from public.categories c
            where c.id = (one_part->>'category_id')::uuid and c.company_id = cid) is distinct from p_direction then
          raise exception 'category kind must match the direction';
        end if;
      end if;
      -- The legacy rows: a posted line whose net is the bank movement (VAT-free).
      insert into public.transactions (
        company_id, direction, doc_kind, pnl_role, line_status, currency,
        amount_gross, amount_net, amount_original, vat_amount, vat_status, doc_date, cash_date,
        source, idempotency_key, project_id, category_id, description, user_assigned
      )
      values (
        cid, p_direction::public.txn_direction, 'receipt', 'project', 'posted', p_currency,
        bank_amt, bank_amt, abs(bank_amt), 0, 'source', p_doc_date, p_doc_date,
        'manual', 'book:' || gen_random_uuid()::text,
        case when part_count = 1 then (one_part->>'project_id')::uuid else p_project_id end,
        case when part_count = 1 then (one_part->>'category_id')::uuid else null end,
        btrim(p_description), true
      )
      returning id into rid;
      -- More than one part: the split, through save_line_split and its rules.
      if part_count > 1 then
        perform public.save_line_split(rid, parts);
      end if;
    else
      if part_count = 1 then
        raise exception 'book_line: one category leg on an existing line — use assign_expense';
      end if;
      rid := line.id;
      -- Exactly as mcp_split_line: the parts before (with percent, rest and gross_up), then the save.
      before_parts := private.line_split_parts_full(rid);
      written := public.save_line_split(rid, parts);
    end if;

    -- Self-check: the item legs the posting rules derived must equal the request, per account (the one
    -- each leg posts to), effective project and sign. Otherwise refuse (the whole write rolls back)
    -- rather than mis-book.
    want := coalesce((
      select jsonb_agg(jsonb_build_object('a', g.a, 'p', g.p, 'n', g.n) order by g.a::text, coalesce(g.p::text, ''), g.n)
      from (
        select r.acct as a, coalesce(r.proj, p_project_id, default_project) as p, sum(r.amt)::bigint as n
        from jsonb_to_recordset(resolved) as r(acct uuid, proj uuid, amt bigint)
        group by 1, 2, sign(r.amt)
      ) g
    ), '[]'::jsonb);
    got := coalesce((
      select jsonb_agg(jsonb_build_object('a', g.a, 'p', g.p, 'n', g.n) order by g.a::text, coalesce(g.p::text, ''), g.n)
      from (
        select l.account_id as a, l.project_id as p, sum(l.amount_minor)::bigint as n
        from public.legs l
        where l.company_id = cid and l.transaction_id = rid and l.leg_kind = 'item'
        group by 1, 2, sign(l.amount_minor)
      ) g
    ), '[]'::jsonb);
    if want is distinct from got then
      raise exception 'book_line: could not represent the legs in the ledger';
    end if;

    if p_transaction_id is null then
      insert into private.mcp_writes (token_id, user_id, company_id, kind, transaction_id, prior)
      values (token, auth.uid(), cid, 'book_line', rid, jsonb_build_object('after', jsonb_build_object(
        'amount_gross', bank_amt, 'doc_date', p_doc_date,
        'legs', (select md5(coalesce(string_agg(l.account_id::text || ':' || coalesce(l.project_id::text,'') || ':' || l.amount_minor::text, '|' order by l.ordinal), ''))
                 from public.legs l where l.transaction_id = rid and l.company_id = cid)
      )));
      response := jsonb_build_object('ok', true, 'data', jsonb_build_object(
        'id', rid, 'direction', p_direction, 'undo_kind', 'book_line'));
    else
      -- The split_line write record, so undo kind line_split restores the parts before.
      insert into private.mcp_writes (token_id, user_id, company_id, transaction_id, kind, prior, created_at)
      values (
        token, auth.uid(), cid, rid, 'line_split',
        jsonb_build_object(
          'before', before_parts,
          'written', written,
          'user_assigned', coalesce(line.user_assigned, false),
          'category_suggested', coalesce(line.category_suggested, false)
        ),
        clock_timestamp()
      )
      returning id into write_id;
      response := jsonb_build_object('ok', true, 'data', jsonb_build_object(
        'id', rid, 'transaction_id', rid, 'direction', p_direction, 'parts', written,
        'undo_kind', 'line_split', 'write_id', write_id));
    end if;
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      if sqlerrm = 'validation' then
        response := private.mcp_error('validation', 'validation');
      else
        response := private.mcp_refused(sqlerrm);
      end if;
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The refusal reasons: the phase-1 reason is no longer raised; the new ones take its place.
-- ---------------------------------------------------------------------------
do $r$
declare
  def text;
  anchor constant text := $a$        'book_line: unsupported account for a phase-1 booking',$a$;
begin
  def := pg_get_functiondef('private.mcp_refused(text)'::regprocedure);
  if def is null or position('book_line: a VAT leg is a later phase' in def) > 0
    or (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1
  then
    raise exception 'mcp_refused is not the expected definition';
  end if;
  def := replace(def, anchor, $a$        -- FLOW-953 (decision 0210): balance-sheet legs.
        'book_line: unsupported account — use a category account or a balance-sheet account',
        'book_line: a VAT leg is a later phase',
        'book_line: several kept-out categories post to this account — book the leg on one category''s account',
        'book_line: no kept-out category posts to this account',
        'book_line: the line is switched into the P&L — clear set_line_pnl first',$a$);
  execute def;
end
$r$;

-- ---------------------------------------------------------------------------
-- 7. The gate (FLOW-951): the shadow P&L still equals the posting rules for every company.
-- ---------------------------------------------------------------------------
set constraints all immediate;

do $gate$
declare
  bad integer;
  rows_off bigint;
begin
  select count(distinct c.id), count(d.*) into bad, rows_off
  from public.companies c
  cross join lateral private.ledger_pnl_diff(c.id) d;
  if bad > 0 then
    raise exception 'FLOW-953 gate: pnl_lines_ledger differs from pnl_lines_legacy for % compan(y/ies), % row(s)',
      bad, rows_off;
  end if;
end
$gate$;

commit;
