-- FLOW-152: the chart of accounts and the balance sheet from the ledger.
-- The 12 system accounts stay fixed; the company adds, renames, archives and merges its own
-- balance-sheet accounts (asset, liability, equity) through the MCP. Owner capital is equity.
-- Patches to functions other packages own use counted anchors (a miss raises, never skips).

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- 1. Columns, type check, backfill. `add column if not exists`, so the order with other packages never matters.
alter table public.accounts add column if not exists is_system boolean not null default false;
alter table public.accounts add column if not exists archived_at timestamptz;
alter table public.accounts add column if not exists description text;

alter table public.accounts drop constraint if exists accounts_description_len;
alter table public.accounts add constraint accounts_description_len
  check (description is null or char_length(description) <= 200);
alter table public.accounts drop constraint if exists accounts_type_check;
alter table public.accounts add constraint accounts_type_check
  check (type in ('income', 'expense', 'asset', 'liability', 'equity'));

update public.accounts a set is_system = true
where a.category_id is null and not a.is_system
  and a.name in ('Bank/Clearing', 'Loan principal', 'Escrow', 'Owner capital', 'Security deposit held',
    'Transfers in transit', 'Property', 'Accumulated depreciation', 'Suspense', 'VAT control',
    'Uncategorized income', 'Uncategorized expense');
update public.accounts a set type = 'equity'
where a.category_id is null and a.name = 'Owner capital' and a.type <> 'equity';

-- Only the company's own balance-sheet accounts are ever archived.
alter table public.accounts drop constraint if exists accounts_archived_user_only;
alter table public.accounts add constraint accounts_archived_user_only
  check (archived_at is null or (category_id is null and not is_system));

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

  -- System accounts (category_id null, is_system), keyed by name. Owner capital is equity (FLOW-152).
  insert into public.accounts (company_id, name, type, is_bank, excluded_from_pnl, is_system)
  values
    (p_company, 'Bank/Clearing', 'asset', true, true, true),
    (p_company, 'Loan principal', 'liability', false, true, true),
    (p_company, 'Escrow', 'asset', false, true, true),
    (p_company, 'Owner capital', 'equity', false, true, true),
    (p_company, 'Security deposit held', 'liability', false, true, true),
    (p_company, 'Transfers in transit', 'asset', false, true, true),
    (p_company, 'Property', 'asset', false, true, true),
    (p_company, 'Accumulated depreciation', 'asset', false, true, true),
    (p_company, 'Suspense', 'asset', false, true, true),
    (p_company, 'VAT control', 'liability', false, true, true),
    (p_company, 'Uncategorized income', 'income', false, false, true),
    (p_company, 'Uncategorized expense', 'expense', false, false, true)
  on conflict (company_id, name) where category_id is null do nothing;
end;
$$;

-- 2. Helpers (private; definers call them).
-- The balance the account holds, as text, when it is not zero in some project x currency of its
-- legs on the books (not draft); null when it nets to zero everywhere.
create or replace function private.account_balance_text(p_company uuid, p_account uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when b.m < 0 then '-' else '' end || (abs(b.m) / 100)::text || '.' || lpad((abs(b.m) % 100)::text, 2, '0')
  from (
    select sum(l.amount_minor)::bigint as m
    from public.legs l
    join public.transactions t
      on t.id = l.transaction_id and t.company_id = l.company_id
     and t.removed_at is null and t.line_status = 'posted'
    where l.company_id = p_company and l.account_id = p_account and not l.draft
    group by l.project_id, coalesce(t.currency, 'ILS')
    having sum(l.amount_minor) <> 0
    order by abs(sum(l.amount_minor)) desc, coalesce(t.currency, 'ILS')
    limit 1
  ) b;
$$;

-- Why an account can't be archived: a balance, or a category bound to it (a hidden '· ledger' category
-- is bound the same way). Null when it can.
create or replace function private.account_archive_blocker(p_company uuid, p_account uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  bal text;
begin
  bal := private.account_balance_text(p_company, p_account);
  if bal is not null then
    return 'account has a balance of ' || bal;
  end if;
  if exists (
    select 1 from public.categories c where c.company_id = p_company and c.ledger_account_id = p_account
  ) then
    return 'account has linked categories';
  end if;
  return null;
end;
$$;

-- A clean account name, or the reason it is refused. A system name is reserved (the system accounts are
-- found by name in many functions); a name is unique among the company's accounts without a category.
create or replace function private.account_clean_name(p_company uuid, p_name text, p_exclude uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  n text;
begin
  n := btrim(regexp_replace(private.plain_spaces(coalesce(p_name, '')), '\s+', ' ', 'g'));
  if private.name_has_hidden_char(n) then
    raise exception 'validation';
  end if;
  if char_length(n) < 1 then
    raise exception 'account name is too short';
  end if;
  if char_length(n) > 60 then
    raise exception 'account name is too long';
  end if;
  if lower(n) in ('bank/clearing', 'loan principal', 'escrow', 'owner capital', 'security deposit held',
    'transfers in transit', 'property', 'accumulated depreciation', 'suspense', 'vat control',
    'uncategorized income', 'uncategorized expense')
  then
    raise exception 'that name belongs to a system account';
  end if;
  if exists (
    select 1 from public.accounts a
    where a.company_id = p_company and a.category_id is null and lower(a.name) = lower(n)
      and a.id is distinct from p_exclude
  ) or exists (
    -- The hidden category book_line makes for an account is named '<account> · ledger'.
    select 1 from public.categories c
    where c.company_id = p_company and lower(c.name) = lower(n || ' · ledger')
      and c.ledger_account_id is distinct from p_exclude
  ) then
    raise exception 'account already exists';
  end if;
  return n;
end;
$$;

-- A company account the caller may change: not a category's account, not a system account. Locked.
create or replace function private.account_for_change(p_company uuid, p_account uuid)
returns public.accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  acct public.accounts%rowtype;
begin
  select * into acct from public.accounts a where a.id = p_account and a.company_id = p_company for update;
  if not found then
    raise exception 'account not found';
  end if;
  if acct.category_id is not null then
    raise exception 'category account can''t be changed';
  end if;
  if acct.is_system then
    raise exception 'system account can''t be changed';
  end if;
  return acct;
end;
$$;

create or replace function private.account_has_postings(p_company uuid, p_account uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.legs l where l.company_id = p_company and l.account_id = p_account)
    or exists (select 1 from public.journal_counter_legs j where j.company_id = p_company and j.account_id = p_account);
$$;

create or replace function private.account_json(p_company uuid, p_account uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id, 'name', a.name, 'type', a.type, 'description', a.description,
    'is_system', a.is_system, 'archived', a.archived_at is not null, 'archived_at', a.archived_at)
  from public.accounts a where a.id = p_account and a.company_id = p_company;
$$;

-- Undo of the five account writes. The account must read as the write left it; else a conflict.
create or replace function private.undo_account_write(p_company uuid, p_rec private.mcp_writes)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pid uuid := (p_rec.prior->>'account_id')::uuid;
  acct public.accounts%rowtype;
  after_j jsonb := p_rec.prior->'after';
  before_j jsonb := p_rec.prior->'before';
  into_id uuid;
  cat_ids uuid[];
  leg_ids uuid[];
  txns uuid[];
  blocker text;
begin
  select * into acct from public.accounts a where a.id = pid and a.company_id = p_company for update;
  if not found then
    return private.mcp_error('conflict', 'conflict');
  end if;

  if p_rec.kind = 'account_create' then
    if acct.archived_at is not null or acct.is_system
      or acct.name is distinct from after_j->>'name'
      or acct.type is distinct from after_j->>'type'
      or acct.description is distinct from after_j->>'description'
      or private.account_has_postings(p_company, pid)
      or exists (select 1 from public.categories c where c.company_id = p_company and c.ledger_account_id = pid)
    then
      return private.mcp_error('conflict', 'conflict');
    end if;
    delete from public.accounts a where a.id = pid and a.company_id = p_company;

  elsif p_rec.kind = 'account_update' then
    if acct.name is distinct from after_j->>'name'
      or acct.type is distinct from after_j->>'type'
      or acct.description is distinct from after_j->>'description'
      or acct.archived_at is not null
      or (before_j->>'type' is distinct from acct.type and private.account_has_postings(p_company, pid))
      or exists (
        select 1 from public.accounts o
        where o.company_id = p_company and o.category_id is null and o.id <> pid
          and lower(o.name) = lower(before_j->>'name'))
    then
      return private.mcp_error('conflict', 'conflict');
    end if;
    update public.accounts a
    set name = before_j->>'name', type = before_j->>'type', description = before_j->>'description'
    where a.id = pid and a.company_id = p_company;

  elsif p_rec.kind = 'account_archive' then
    if acct.archived_at is distinct from (after_j->>'archived_at')::timestamptz then
      return private.mcp_error('conflict', 'conflict');
    end if;
    update public.accounts a set archived_at = null where a.id = pid and a.company_id = p_company;

  elsif p_rec.kind = 'account_restore' then
    if acct.archived_at is not null or private.account_archive_blocker(p_company, pid) is not null then
      return private.mcp_error('conflict', 'conflict');
    end if;
    update public.accounts a set archived_at = clock_timestamp() where a.id = pid and a.company_id = p_company;

  elsif p_rec.kind = 'account_merge' then
    into_id := (p_rec.prior->>'into_id')::uuid;
    select coalesce(array_agg(x::uuid), '{}') into cat_ids from jsonb_array_elements_text(p_rec.prior->'category_ids') x;
    select coalesce(array_agg(x::uuid), '{}') into leg_ids from jsonb_array_elements_text(p_rec.prior->'counter_leg_ids') x;
    if acct.archived_at is distinct from (after_j->>'archived_at')::timestamptz
      or not exists (select 1 from public.accounts i where i.id = into_id and i.company_id = p_company and i.archived_at is null)
      or (select count(*) from public.categories c
          where c.company_id = p_company and c.id = any (cat_ids) and c.ledger_account_id = into_id) <> cardinality(cat_ids)
      or (select count(*) from public.journal_counter_legs j
          where j.company_id = p_company and j.id = any (leg_ids) and j.account_id = into_id) <> cardinality(leg_ids)
    then
      return private.mcp_error('conflict', 'conflict');
    end if;
    select coalesce(array_agg(distinct j.transaction_id), '{}') into txns
    from public.journal_counter_legs j where j.company_id = p_company and j.id = any (leg_ids);
    update public.journal_counter_legs j set account_id = pid
    where j.company_id = p_company and j.id = any (leg_ids);
    -- The categories trigger re-posts their lines.
    update public.categories c set ledger_account_id = pid
    where c.company_id = p_company and c.id = any (cat_ids);
    perform private.post_lines(p_company, txns);
    update public.accounts a set archived_at = null where a.id = pid and a.company_id = p_company;
  else
    return private.mcp_error('validation', 'validation');
  end if;

  update private.mcp_writes w set undone_at = clock_timestamp()
  where w.id = p_rec.id and w.user_id = auth.uid() and w.undone_at is null;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('kind', p_rec.kind, 'id', pid));
end;
$$;

revoke all on function private.account_balance_text(uuid, uuid) from public, anon, authenticated;
revoke all on function private.account_archive_blocker(uuid, uuid) from public, anon, authenticated;
revoke all on function private.account_clean_name(uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.account_for_change(uuid, uuid) from public, anon, authenticated;
revoke all on function private.account_has_postings(uuid, uuid) from public, anon, authenticated;
revoke all on function private.account_json(uuid, uuid) from public, anon, authenticated;
revoke all on function private.undo_account_write(uuid, private.mcp_writes) from public, anon, authenticated;

-- 3. The write kinds: the check constraints, mcp_refused, mcp_undo.
do $kinds$
declare
  def text;
  kinds constant text := $k$'account_create'::text, 'account_update'::text, 'account_archive'::text, 'account_restore'::text, 'account_merge'::text$k$;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  if pg_temp.anchor_count(def, ']))') <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, ']))', ', ' || kinds || ']))');

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if right(def, 1) <> ')' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 1)
    || ' OR ((kind = ANY (ARRAY[' || kinds || '])) AND (prior ? ''account_id''::text) AND (prior ? ''before''::text) AND (prior ? ''after''::text)))';
end
$kinds$;

do $refused$
declare
  def text;
  anchor constant text := $a$      when p_message = 'loan_closed' then 'loan closed'$a$;
begin
  def := pg_get_functiondef('private.mcp_refused(text)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_refused is not the expected definition';
  end if;
  def := replace(def, anchor, $n$      -- FLOW-152: the chart of accounts. "account not found" stays out (no existence leak).
      when p_message in (
        'account name is too short',
        'account name is too long',
        'description is too long',
        'that name belongs to a system account',
        'account already exists',
        'category account can''t be changed',
        'system account can''t be changed',
        'account has linked categories',
        'account has postings, so its type can''t change',
        'account is archived',
        'account is not archived',
        'nothing to change',
        'pick a different account',
        'the account must be a balance-sheet account',
        'accounts must be the same type'
      ) or p_message ~ '^account has a balance of -?[0-9]+\.[0-9]{2}$' then p_message
$n$ || anchor);
  execute def;
end
$refused$;

do $undo$
declare
  def text;
  a_kinds constant text := $a$p_kind not in ('supplier_category', $a$;
  a_lookup constant text := $a$(p_kind = 'supplier_category' and w.kind = 'supplier_category' and w.transaction_id = p_id)$a$;
  a_branch constant text := $a$    elsif p_kind = 'supplier_category' then$a$;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, a_kinds) <> 1 or pg_temp.anchor_count(def, a_lookup) <> 1
    or pg_temp.anchor_count(def, a_branch) <> 1 then
    raise exception 'mcp_undo is not the expected definition';
  end if;
  def := replace(def, a_kinds,
    $n$p_kind not in ('account_create', 'account_update', 'account_archive', 'account_restore', 'account_merge', 'supplier_category', $n$);
  def := replace(def, a_lookup, a_lookup || $n$
        or (p_kind in ('account_create', 'account_update', 'account_archive', 'account_restore', 'account_merge')
          and w.kind = p_kind and w.prior->>'account_id' = p_id::text)$n$);
  def := replace(def, a_branch, $n$    elsif p_kind in ('account_create', 'account_update', 'account_archive', 'account_restore', 'account_merge') then
      -- FLOW-152: the account goes back while it reads as the write left it.
      response := private.undo_account_write(cid, rec);
$n$ || a_branch);
  execute def;
end
$undo$;

-- 4. Equity and archived accounts: book_line and journal entries (40_book_line) take any balance-sheet
-- account that is open; set_category_account does here.
do $bookable$
declare
  def text;
begin
  def := pg_get_functiondef('public.mcp_set_category_account(text,uuid,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, $a$select a.id, a.type, a.is_bank, a.name, a.category_id into acct$a$) <> 1
    or pg_temp.anchor_count(def, $a$if acct.category_id is not null or acct.type not in ('asset', 'liability') or acct.is_bank$a$) <> 1
  then
    raise exception 'mcp_set_category_account is not the expected definition';
  end if;
  def := replace(def, $a$select a.id, a.type, a.is_bank, a.name, a.category_id into acct$a$,
    $n$select a.id, a.type, a.is_bank, a.name, a.category_id, a.archived_at into acct$n$);
  def := replace(def, $a$if acct.category_id is not null or acct.type not in ('asset', 'liability') or acct.is_bank$a$,
    $n$if acct.archived_at is not null then
        raise exception 'account is archived';
      end if;
      if acct.category_id is not null or acct.type not in ('asset', 'liability', 'equity') or acct.is_bank$n$);
  execute def;
end
$bookable$;

-- 5. Reads.
-- list_accounts: type, is_system, archived, description, the balance per currency (legs on the books)
-- and the categories bound to the account. An archived account is hidden unless include_archived.
create or replace function public.mcp_accounts(p_include_archived boolean)
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
    with bal as (
      select l.account_id, coalesce(t.currency, 'ILS') as currency, sum(l.amount_minor)::bigint as m
      from public.legs l
      join public.transactions t
        on t.id = l.transaction_id and t.company_id = l.company_id
       and t.removed_at is null and t.line_status = 'posted'
      where l.company_id = cid and not l.draft
      group by l.account_id, coalesce(t.currency, 'ILS')
      having sum(l.amount_minor) <> 0
    )
    select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'name', coalesce(c.name, a.name),
        'type', coalesce(c.kind::text, a.type),
        'category_id', a.category_id,
        'system', a.is_system,
        'is_system', a.is_system,
        'archived', a.archived_at is not null,
        'description', a.description,
        'is_bank', a.is_bank,
        'excluded_from_pnl', case when c.id is null then a.excluded_from_pnl else coalesce(c.excluded_from_pnl, false) end,
        'loan_part', coalesce(c.loan_part, a.loan_part),
        'hidden', coalesce(c.hidden, false),
        'bookable', a.archived_at is null and (a.is_bank or c.id is not null
          or (a.category_id is null and a.type in ('asset', 'liability', 'equity') and a.name not in ('Suspense', 'VAT control'))),
        'posts_to', case when coalesce(c.excluded_from_pnl, false)
                      then private.kept_out_account(cid, c.id, c.loan_part) end,
        'balances', coalesce((
          select jsonb_agg(jsonb_build_object('currency', b.currency, 'balance_minor', b.m) order by b.currency)
          from bal b where b.account_id = a.id), '[]'::jsonb),
        'categories', coalesce((
          select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'hidden', k.hidden) order by k.name, k.id)
          from public.categories k where k.company_id = cid and k.ledger_account_id = a.id), '[]'::jsonb)
      ) order by a.category_id is not null, a.is_bank desc, coalesce(c.kind::text, a.type),
        lower(coalesce(c.name, a.name)), a.id)
    from public.accounts a
    left join public.categories c on c.id = a.category_id and c.company_id = a.company_id
    where a.company_id = cid
      and (a.archived_at is null or coalesce(p_include_archived, false))
  ), '[]'::jsonb));
end;
$$;

-- The old signature keeps working: archived accounts hidden.
create or replace function public.mcp_accounts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$ select public.mcp_accounts(false); $$;

-- get_account_balances: user accounts and equity too; draft legs are not on the books.
create or replace function public.mcp_account_balances(p_as_of date default null::date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  as_of date := coalesce(p_as_of, current_date);
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'as_of', as_of,
    -- Every balance-sheet account but the bank, per project and currency: debit +, credit −.
    'balances', coalesce((
      select jsonb_agg(jsonb_build_object(
          'account_id', b.account_id, 'account_name', b.account_name, 'type', b.type,
          'project_id', b.project_id, 'project_name', b.project_name,
          'currency', b.currency, 'balance_minor', b.balance_minor
        ) order by b.account_name, b.project_name nulls first, b.currency)
      from (
        select l.account_id, a.name as account_name, a.type, l.project_id, p.name as project_name,
          coalesce(t.currency, 'ILS') as currency, sum(l.amount_minor)::bigint as balance_minor
        from public.legs l
        join public.transactions t
          on t.id = l.transaction_id and t.company_id = l.company_id
         and t.removed_at is null and t.line_status = 'posted' and t.doc_date <= as_of
        join public.accounts a on a.id = l.account_id and a.company_id = l.company_id
        left join public.projects p on p.id = l.project_id and p.company_id = l.company_id
        where l.company_id = cid and not l.draft
          and a.type in ('asset', 'liability', 'equity') and not a.is_bank
        group by l.account_id, a.name, a.type, l.project_id, p.name, coalesce(t.currency, 'ILS')
        having sum(l.amount_minor) <> 0
      ) b
    ), '[]'::jsonb),
    -- Each project's net book value: what it holds on Property less what Accumulated depreciation took.
    'book_value', coalesce((
      select jsonb_agg(jsonb_build_object(
          'project_id', v.project_id, 'project_name', v.project_name, 'currency', v.currency,
          'property_minor', v.property_minor, 'accumulated_depreciation_minor', v.accumulated_minor,
          'net_book_value_minor', v.property_minor + v.accumulated_minor
        ) order by v.project_name nulls first, v.currency)
      from (
        select l.project_id, p.name as project_name, coalesce(t.currency, 'ILS') as currency,
          coalesce(sum(l.amount_minor) filter (where a.name = 'Property'), 0)::bigint as property_minor,
          coalesce(sum(l.amount_minor) filter (where a.name = 'Accumulated depreciation'), 0)::bigint as accumulated_minor
        from public.legs l
        join public.transactions t
          on t.id = l.transaction_id and t.company_id = l.company_id
         and t.removed_at is null and t.line_status = 'posted' and t.doc_date <= as_of
        join public.accounts a on a.id = l.account_id and a.company_id = l.company_id
        left join public.projects p on p.id = l.project_id and p.company_id = l.company_id
        where l.company_id = cid and not l.draft
          and a.category_id is null and a.name in ('Property', 'Accumulated depreciation')
        group by l.project_id, p.name, coalesce(t.currency, 'ILS')
        having sum(l.amount_minor) <> 0
          or sum(l.amount_minor) filter (where a.name = 'Accumulated depreciation') <> 0
      ) v
    ), '[]'::jsonb)
  );
end;
$$;

-- get_balance_sheet: per currency, assets / liabilities / equity as of a date, retained earnings (the
-- running P&L) and the check. Rule: a line's legs count from the line's doc_date (every leg of a line,
-- the bank leg too), on posted, non-removed lines; draft legs are not on the books. Debit is positive;
-- liabilities and equity are shown positive (credit). retained = -(income + expense account legs), so
-- assets = liabilities + equity + retained whenever the legs balance.
create or replace function public.mcp_balance_sheet(p_as_of date default null, p_project_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  as_of date := coalesce(p_as_of, current_date);
  proj_name text;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_project_id is not null then
    select p.name into proj_name from public.projects p where p.id = p_project_id and p.company_id = cid;
    if not found then
      raise exception 'project not found' using errcode = 'P0002';
    end if;
  end if;
  return jsonb_build_object(
    'as_of', as_of,
    'project_id', p_project_id,
    'project_name', proj_name,
    'rule', 'a line''s legs count from its doc_date; posted, non-removed lines; draft legs excluded',
    'currencies', coalesce((
      with bal as (
        select coalesce(t.currency, 'ILS') as currency, a.id as account_id, a.name as account_name, a.type,
          a.is_system, a.category_id, sum(l.amount_minor)::bigint as m
        from public.legs l
        join public.transactions t
          on t.id = l.transaction_id and t.company_id = l.company_id
         and t.removed_at is null and t.line_status = 'posted' and t.doc_date <= as_of
        join public.accounts a on a.id = l.account_id and a.company_id = l.company_id
        where l.company_id = cid and not l.draft
          and (p_project_id is null or l.project_id = p_project_id)
        group by coalesce(t.currency, 'ILS'), a.id, a.name, a.type, a.is_system, a.category_id
      ),
      cur as (
        select b.currency,
          coalesce(sum(b.m) filter (where b.type = 'asset'), 0)::bigint as assets,
          coalesce(-sum(b.m) filter (where b.type = 'liability'), 0)::bigint as liabilities,
          coalesce(-sum(b.m) filter (where b.type = 'equity'), 0)::bigint as equity,
          coalesce(-sum(b.m) filter (where b.type in ('income', 'expense')), 0)::bigint as retained
        from bal b group by b.currency
      )
      select jsonb_agg(jsonb_build_object(
          'currency', c.currency,
          'assets', jsonb_build_object('total_minor', c.assets, 'accounts', coalesce((
            select jsonb_agg(jsonb_build_object('account_id', b.account_id, 'name', b.account_name,
              'is_system', b.is_system, 'balance_minor', b.m) order by b.account_name, b.account_id)
            from bal b where b.currency = c.currency and b.type = 'asset' and b.m <> 0), '[]'::jsonb)),
          'liabilities', jsonb_build_object('total_minor', c.liabilities, 'accounts', coalesce((
            select jsonb_agg(jsonb_build_object('account_id', b.account_id, 'name', b.account_name,
              'is_system', b.is_system, 'balance_minor', -b.m) order by b.account_name, b.account_id)
            from bal b where b.currency = c.currency and b.type = 'liability' and b.m <> 0), '[]'::jsonb)),
          'equity', jsonb_build_object('total_minor', c.equity, 'accounts', coalesce((
            select jsonb_agg(jsonb_build_object('account_id', b.account_id, 'name', b.account_name,
              'is_system', b.is_system, 'balance_minor', -b.m) order by b.account_name, b.account_id)
            from bal b where b.currency = c.currency and b.type = 'equity' and b.m <> 0), '[]'::jsonb)),
          'retained_earnings_minor', c.retained,
          'total_assets_minor', c.assets,
          'total_liabilities_and_equity_minor', c.liabilities + c.equity + c.retained,
          'difference_minor', c.assets - (c.liabilities + c.equity + c.retained),
          'balanced', c.assets = c.liabilities + c.equity + c.retained,
          'warnings', coalesce((
            select jsonb_agg(jsonb_build_object(
              'code', case when b.account_name = 'Suspense' then 'suspense' else 'uncategorized' end,
              'account_id', b.account_id, 'account_name', b.account_name, 'balance_minor', b.m,
              'message', b.account_name || ' is not zero')
              order by b.account_name)
            from bal b
            where b.currency = c.currency and b.category_id is null and b.m <> 0
              and b.account_name in ('Suspense', 'Uncategorized income', 'Uncategorized expense')), '[]'::jsonb)
        ) order by c.currency)
      from cur c
    ), '[]'::jsonb)
  );
end;
$$;

-- 6. The write RPCs (the shape of public.mcp_set_category_account).
create or replace function public.mcp_create_account(
  p_idempotency_key text,
  p_name text,
  p_type text,
  p_description text default null
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
  clean text;
  descr text;
  new_id uuid;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_name is null
    or p_type is null or p_type not in ('asset', 'liability', 'equity')
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'account_create|' || p_name || '|' || p_type || '|' || coalesce(p_description, '');
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
    clean := private.account_clean_name(cid, p_name, null);
    descr := nullif(btrim(coalesce(p_description, '')), '');
    if char_length(coalesce(descr, '')) > 200 then
      raise exception 'description is too long';
    end if;

    insert into public.accounts (company_id, name, type, excluded_from_pnl, description)
    values (cid, clean, p_type, true, descr)
    returning id into new_id;

    insert into private.mcp_writes (token_id, user_id, company_id, kind, prior)
    values (token, auth.uid(), cid, 'account_create', jsonb_build_object(
      'account_id', new_id, 'before', null,
      'after', jsonb_build_object('name', clean, 'type', p_type, 'description', descr)));

    response := jsonb_build_object('ok', true, 'data',
      private.account_json(cid, new_id) || jsonb_build_object('undo_kind', 'account_create'));
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when unique_violation then
      response := private.mcp_refused('account already exists');
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

create or replace function public.mcp_update_account(
  p_idempotency_key text,
  p_account_id uuid,
  p_name text default null,
  p_description text default null,
  p_type text default null
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
  acct public.accounts%rowtype;
  new_name text;
  new_descr text;
  new_type text;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_account_id is null
    or (p_name is null and p_description is null and p_type is null)
    or (p_type is not null and p_type not in ('asset', 'liability', 'equity'))
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'account_update|' || p_account_id::text || '|' || coalesce(p_name, '') || '|'
    || coalesce(p_description, '') || '|' || coalesce(p_type, '')
    || '|' || (p_name is null)::text || (p_description is null)::text;
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
    acct := private.account_for_change(cid, p_account_id);
    if acct.archived_at is not null then
      raise exception 'account is archived';
    end if;
    new_name := acct.name;
    new_descr := acct.description;
    new_type := acct.type;
    if p_name is not null then
      new_name := private.account_clean_name(cid, p_name, p_account_id);
    end if;
    if p_description is not null then
      -- An empty description clears it.
      new_descr := nullif(btrim(p_description), '');
      if char_length(coalesce(new_descr, '')) > 200 then
        raise exception 'description is too long';
      end if;
    end if;
    if p_type is not null and p_type <> acct.type then
      if private.account_has_postings(cid, p_account_id) then
        raise exception 'account has postings, so its type can''t change';
      end if;
      new_type := p_type;
    end if;
    if (new_name, new_descr, new_type) is not distinct from (acct.name, acct.description, acct.type) then
      raise exception 'nothing to change';
    end if;

    update public.accounts a set name = new_name, description = new_descr, type = new_type
    where a.id = p_account_id and a.company_id = cid;

    insert into private.mcp_writes (token_id, user_id, company_id, kind, prior)
    values (token, auth.uid(), cid, 'account_update', jsonb_build_object(
      'account_id', p_account_id,
      'before', jsonb_build_object('name', acct.name, 'type', acct.type, 'description', acct.description),
      'after', jsonb_build_object('name', new_name, 'type', new_type, 'description', new_descr)));

    response := jsonb_build_object('ok', true, 'data',
      private.account_json(cid, p_account_id) || jsonb_build_object('undo_kind', 'account_update'));
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when unique_violation then
      response := private.mcp_refused('account already exists');
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

create or replace function public.mcp_archive_account(
  p_idempotency_key text,
  p_account_id uuid
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
  acct public.accounts%rowtype;
  blocker text;
  stamp timestamptz;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_account_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'account_archive|' || p_account_id::text;
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
    acct := private.account_for_change(cid, p_account_id);
    if acct.archived_at is not null then
      raise exception 'account is archived';
    end if;
    blocker := private.account_archive_blocker(cid, p_account_id);
    if blocker is not null then
      raise exception '%', blocker;
    end if;
    stamp := clock_timestamp();
    update public.accounts a set archived_at = stamp where a.id = p_account_id and a.company_id = cid;

    insert into private.mcp_writes (token_id, user_id, company_id, kind, prior)
    values (token, auth.uid(), cid, 'account_archive', jsonb_build_object(
      'account_id', p_account_id,
      'before', jsonb_build_object('archived_at', null),
      'after', jsonb_build_object('archived_at', stamp)));

    response := jsonb_build_object('ok', true, 'data',
      private.account_json(cid, p_account_id) || jsonb_build_object('undo_kind', 'account_archive'));
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

create or replace function public.mcp_restore_account(
  p_idempotency_key text,
  p_account_id uuid
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
  acct public.accounts%rowtype;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_account_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'account_restore|' || p_account_id::text;
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
    acct := private.account_for_change(cid, p_account_id);
    if acct.archived_at is null then
      raise exception 'account is not archived';
    end if;
    update public.accounts a set archived_at = null where a.id = p_account_id and a.company_id = cid;

    insert into private.mcp_writes (token_id, user_id, company_id, kind, prior)
    values (token, auth.uid(), cid, 'account_restore', jsonb_build_object(
      'account_id', p_account_id,
      'before', jsonb_build_object('archived_at', acct.archived_at),
      'after', jsonb_build_object('archived_at', null)));

    response := jsonb_build_object('ok', true, 'data',
      private.account_json(cid, p_account_id) || jsonb_build_object('undo_kind', 'account_restore'));
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

-- Merge: the categories bound to `from` (hidden '· ledger' ones too) and its journal counter legs move
-- to `into`, the affected lines are posted again, `from` is archived. The legs move between two
-- balance-sheet accounts, so no P&L figure moves.
create or replace function public.mcp_merge_account(
  p_idempotency_key text,
  p_from_account_id uuid,
  p_into_account_id uuid
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
  src public.accounts%rowtype;
  dst public.accounts%rowtype;
  cat_ids uuid[];
  leg_ids uuid[];
  txns uuid[];
  stamp timestamptz;
  left_over integer;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_from_account_id is null or p_into_account_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'account_merge|' || p_from_account_id::text || '|' || p_into_account_id::text;
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
    if p_from_account_id = p_into_account_id then
      raise exception 'pick a different account';
    end if;
    -- Both locked in id order, so two merges the other way round cannot deadlock.
    perform 1 from public.accounts a
    where a.company_id = cid and a.id in (p_from_account_id, p_into_account_id)
    order by a.id for update;
    src := private.account_for_change(cid, p_from_account_id);
    select * into dst from public.accounts a where a.id = p_into_account_id and a.company_id = cid;
    if not found then
      raise exception 'account not found';
    end if;
    if src.archived_at is not null or dst.archived_at is not null then
      raise exception 'account is archived';
    end if;
    -- The target may be a system account, but a balance-sheet one the books take.
    if dst.category_id is not null or dst.is_bank or dst.type not in ('asset', 'liability', 'equity')
      or dst.name in ('Suspense', 'VAT control')
    then
      raise exception 'the account must be a balance-sheet account';
    end if;
    if src.type <> dst.type then
      raise exception 'accounts must be the same type';
    end if;

    select coalesce(array_agg(c.id order by c.id), '{}') into cat_ids
    from public.categories c where c.company_id = cid and c.ledger_account_id = p_from_account_id;
    select coalesce(array_agg(j.id order by j.id), '{}'),
      coalesce(array_agg(distinct j.transaction_id), '{}')
    into leg_ids, txns
    from public.journal_counter_legs j where j.company_id = cid and j.account_id = p_from_account_id;

    update public.journal_counter_legs j set account_id = p_into_account_id
    where j.company_id = cid and j.id = any (leg_ids);
    -- The categories trigger posts their lines again.
    update public.categories c set ledger_account_id = p_into_account_id
    where c.company_id = cid and c.id = any (cat_ids);
    perform private.post_lines(cid, txns);

    select count(*) into left_over from public.legs l
    where l.company_id = cid and l.account_id = p_from_account_id;
    if left_over > 0 then
      raise exception 'account could not be merged';
    end if;

    stamp := clock_timestamp();
    update public.accounts a set archived_at = stamp where a.id = p_from_account_id and a.company_id = cid;

    insert into private.mcp_writes (token_id, user_id, company_id, kind, prior)
    values (token, auth.uid(), cid, 'account_merge', jsonb_build_object(
      'account_id', p_from_account_id, 'into_id', p_into_account_id,
      'category_ids', to_jsonb(cat_ids), 'counter_leg_ids', to_jsonb(leg_ids),
      'before', jsonb_build_object('archived_at', null),
      'after', jsonb_build_object('archived_at', stamp)));

    response := jsonb_build_object('ok', true, 'data', jsonb_build_object(
      'from', private.account_json(cid, p_from_account_id),
      'into', private.account_json(cid, p_into_account_id),
      'categories_moved', cardinality(cat_ids),
      'journal_legs_moved', cardinality(leg_ids),
      'undo_kind', 'account_merge'));
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

-- 7. Grants.
revoke all on function public.mcp_create_account(text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.mcp_update_account(text, uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.mcp_archive_account(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.mcp_restore_account(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.mcp_merge_account(text, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.mcp_accounts(boolean) from public, anon, authenticated, service_role;
revoke all on function public.mcp_balance_sheet(date, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_create_account(text, text, text, text) to authenticated;
grant execute on function public.mcp_update_account(text, uuid, text, text, text) to authenticated;
grant execute on function public.mcp_archive_account(text, uuid) to authenticated;
grant execute on function public.mcp_restore_account(text, uuid) to authenticated;
grant execute on function public.mcp_merge_account(text, uuid, uuid) to authenticated;
grant execute on function public.mcp_accounts(boolean) to authenticated;
grant execute on function public.mcp_balance_sheet(date, uuid) to authenticated;

comment on function public.mcp_create_account(text, text, text, text) is
  'MCP create_account: a company balance-sheet account (asset, liability or equity); undo kind account_create. FLOW-152.';
comment on function public.mcp_update_account(text, uuid, text, text, text) is
  'MCP update_account: name, description, type (no postings yet) of a company account; a system account is refused; undo kind account_update. FLOW-152.';
comment on function public.mcp_archive_account(text, uuid) is
  'MCP archive_account: refused with a balance, linked categories or a system account; undo kind account_archive. FLOW-152.';
comment on function public.mcp_restore_account(text, uuid) is
  'MCP restore_account: an archived account is open again; undo kind account_restore. FLOW-152.';
comment on function public.mcp_merge_account(text, uuid, uuid) is
  'MCP merge_account: categories and journal legs move from one account to another of the same type, which is archived; no P&L figure moves; undo kind account_merge. FLOW-152.';
comment on function public.mcp_accounts(boolean) is
  'MCP list_accounts: the chart of accounts with type, system flag, archived, description, balance per currency and linked categories; include_archived shows archived accounts. FLOW-152.';
comment on function public.mcp_balance_sheet(date, uuid) is
  'MCP get_balance_sheet: per currency, assets, liabilities, equity and retained earnings as of a date (a line''s legs count from its doc_date), the check and warnings; optionally one project. FLOW-152.';
