-- FLOW-149 (MCP/data agent request, decision 0228): journal entries that move no money, such as a
-- property's depreciation, and the balance-sheet balances per project.
-- 1. A system asset account Accumulated depreciation in every company (private.ensure_accounts), so a
--    depreciation credit has its own balance per project beside Property.
-- 2. public.journal_entries marks a line as a journal entry (with its reference), and
--    public.journal_counter_legs holds its legs on balance-sheet accounts.
-- 3. The legs. A journal entry's line has no bank leg: posting writes its counter legs in its place
--    (leg_kind 'journal'), and the balance check takes a journal entry with no bank leg. Its legs in
--    the P&L come from the legacy rows as every line's do, so the P&L, which still reads them
--    (0209), counts it. The FLOW-951 diff compares only item legs, so it is unchanged.
-- 4. MCP create_journal_entry writes the P&L legs through private.book_line_core (book_line's rules,
--    messages and self-check), with the counter legs' sum standing in for the bank movement; the line
--    is out of the cash view, has document kind other (so it never pairs with an invoice), and its
--    counter legs replace the bank leg. Undo kind journal_entry removes it, while it reads as written.
-- 5. A journal entry is fixed: a trigger refuses any change of its posting columns, splits, loan
--    splits or shares ('journal entry is fixed'), deletes of them included. Its note, files and
--    description stay editable, and the line can be removed.
-- 6. Reads: get_transaction and get_line_legs name the entry's reference; MCP get_account_balances
--    (public.mcp_account_balances) sums the legs on balance-sheet accounts per project and currency
--    as of a date, with each project's net book value (Property plus Accumulated depreciation).
-- Functions written before this one are patched in place with counted anchors, as in
-- 20261027184624_loan_part_category_override.sql.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- 1. Accumulated depreciation.
do $accounts$
declare
  def text;
  anchor constant text := $a$    (p_company, 'Property', 'asset', false, true),$a$;
begin
  def := pg_get_functiondef('private.ensure_accounts(uuid)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'ensure_accounts is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
    (p_company, 'Accumulated depreciation', 'asset', false, true),$n$);
  execute def;
end
$accounts$;

select private.ensure_accounts(c.id) from public.companies c;

-- 2. The entries and their balance-sheet legs.
create table public.journal_entries (
  transaction_id uuid primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  reference text check (reference is null or char_length(reference) between 1 and 60),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint journal_entries_line_fkey foreign key (company_id, transaction_id)
    references public.transactions (company_id, id) on delete cascade
);

comment on table public.journal_entries is
  'FLOW-149: a line that is a journal entry (it moves no money): out of the cash view, fixed, with its legs on balance-sheet accounts in journal_counter_legs. Decision 0228.';

create table public.journal_counter_legs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  transaction_id uuid not null references public.journal_entries (transaction_id) on delete cascade,
  account_id uuid not null,
  project_id uuid references public.projects (id) on delete set null,
  amount_minor bigint not null check (amount_minor <> 0),
  ordinal smallint not null,
  constraint journal_counter_legs_account_fkey foreign key (company_id, account_id)
    references public.accounts (company_id, id) on delete restrict,
  constraint journal_counter_legs_one_ordinal unique (transaction_id, ordinal)
);

comment on table public.journal_counter_legs is
  'FLOW-149: a journal entry''s legs on balance-sheet accounts, signed (debit +). Posting writes them in place of the bank leg. Decision 0228.';

create index journal_entries_company_line_idx on public.journal_entries (company_id, transaction_id);
create index journal_counter_legs_company_idx on public.journal_counter_legs (company_id, transaction_id);
create index journal_counter_legs_account_idx on public.journal_counter_legs (company_id, account_id);
create index journal_counter_legs_project_idx on public.journal_counter_legs (project_id) where project_id is not null;
create index journal_entries_created_by_idx on public.journal_entries (created_by) where created_by is not null;

alter table public.journal_entries enable row level security;
alter table public.journal_counter_legs enable row level security;

create policy journal_entries_select on public.journal_entries
  for select to authenticated
  using (company_id = (select private.readable_company_id()));
create policy journal_counter_legs_select on public.journal_counter_legs
  for select to authenticated
  using (company_id = (select private.readable_company_id()));

revoke all on table public.journal_entries from anon, authenticated;
revoke all on table public.journal_counter_legs from anon, authenticated;
grant select on table public.journal_entries to authenticated;
grant select on table public.journal_counter_legs to authenticated;

-- 3. The legs: the counter legs stand in for the bank leg, and the balance check takes them.
alter table public.legs drop constraint legs_leg_kind_check;
alter table public.legs add constraint legs_leg_kind_check
  check (leg_kind = any (array['bank'::text, 'vat'::text, 'item'::text, 'journal'::text]));

do $posting$
declare
  def text;
  a_lines constant text := $a$    select t.id, t.amount_gross, t.vat_amount
    from public.transactions t$a$;
  a_bank constant text := $a$    from lines x cross join sys
    union all
    -- VAT is one more leg$a$;
  a_check constant text := $a$  if banks <> 1 then$a$;
begin
  def := pg_get_functiondef('private.rebuild_legs_many(uuid,uuid[])'::regprocedure);
  if pg_temp.anchor_count(def, a_lines) <> 1 or pg_temp.anchor_count(def, a_bank) <> 1 then
    raise exception 'rebuild_legs_many is not the expected definition';
  end if;
  def := replace(def, a_lines, $n$    select t.id, t.amount_gross, t.vat_amount,
      exists (select 1 from public.journal_entries j where j.transaction_id = t.id) as journal
    from public.transactions t$n$);
  def := replace(def, a_bank, $n$    from lines x cross join sys
    where not x.journal
    union all
    -- FLOW-149: a journal entry moves no money; its balance-sheet legs stand in for the bank leg.
    select j.transaction_id, j.account_id, j.project_id, j.amount_minor, 1, null, null, j.ordinal::bigint,
      'journal', null, null, false, false, false
    from public.journal_counter_legs j
    join lines x on x.id = j.transaction_id
    where j.company_id = p_company
    union all
    -- VAT is one more leg$n$);
  execute def;

  def := pg_get_functiondef('private.legs_balance_check()'::regprocedure);
  if pg_temp.anchor_count(def, a_check) <> 1 then
    raise exception 'legs_balance_check is not the expected definition';
  end if;
  def := replace(def, a_check, $n$  -- FLOW-149: a journal entry has no bank leg; its balance-sheet legs balance it.
  if banks <> 1 and not (
    banks = 0 and exists (select 1 from public.journal_entries j where j.transaction_id = tid)
  ) then$n$);
  execute def;
end
$posting$;

-- book_line_core writes a journal entry's line as document kind other, so an income entry never
-- pairs with an invoice (the receipt pairing trigger runs on receipts only).
do $core$
declare
  def text;
  anchor constant text := $a$      cid, p_direction::public.txn_direction, 'receipt', 'project', 'posted', p_currency,$a$;
begin
  def := pg_get_functiondef('private.book_line_core(uuid,text,date,text,text,jsonb,uuid,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'book_line_core is not the expected definition';
  end if;
  def := replace(def, anchor, $n$      cid, p_direction::public.txn_direction,
      case when current_setting('flow.journal_entry', true) = 'on' then 'other' else 'receipt' end::public.doc_kind,
      'project', 'posted', p_currency,$n$);
  execute def;
end
$core$;

-- 5. A journal entry is fixed.
-- A split, loan split or share of an entry's line. A delete is refused too, unless the line itself
-- is going (its delete cascades here after the line is gone): undo, or the company deleted.
create function private.journal_entry_fixed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  txn uuid := case when tg_op = 'DELETE' then old.transaction_id else new.transaction_id end;
begin
  if exists (select 1 from public.journal_entries j where j.transaction_id = txn)
    and (tg_op <> 'DELETE' or exists (select 1 from public.transactions t where t.id = txn))
  then
    raise exception 'journal entry is fixed' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.journal_entry_fixed() from public, anon, authenticated;

create function private.journal_entry_line_fixed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.journal_entries j where j.transaction_id = old.id) then
    raise exception 'journal entry is fixed' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.journal_entry_line_fixed() from public, anon, authenticated;

-- What posts or counts the line; its note, files, description and removal stay open.
create trigger transactions_journal_entry_fixed
  before update on public.transactions
  for each row
  when ((old.direction, old.doc_kind, old.amount_gross, old.amount_net, old.vat_amount, old.amount_original,
         old.category_id, old.project_id, old.pnl_role, old.in_pnl_override, old.in_cash_override,
         old.line_status, old.doc_date, old.cash_date, old.currency, old.company_id)
    is distinct from
        (new.direction, new.doc_kind, new.amount_gross, new.amount_net, new.vat_amount, new.amount_original,
         new.category_id, new.project_id, new.pnl_role, new.in_pnl_override, new.in_cash_override,
         new.line_status, new.doc_date, new.cash_date, new.currency, new.company_id))
  execute function private.journal_entry_line_fixed();
create trigger line_splits_journal_entry_fixed
  before insert or update or delete on public.line_splits
  for each row execute function private.journal_entry_fixed();
create trigger loan_splits_journal_entry_fixed
  before insert or update or delete on public.loan_splits
  for each row execute function private.journal_entry_fixed();
create trigger allocations_journal_entry_fixed
  before insert or update or delete on public.allocations
  for each row execute function private.journal_entry_fixed();

-- 4. create_journal_entry.
create function public.mcp_create_journal_entry(
  p_idempotency_key text,
  p_doc_date date,
  p_currency text,
  p_description text,
  p_reference text,
  p_legs jsonb
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
  leg jsonb;
  ord integer;
  acct public.accounts%rowtype;
  cat public.categories%rowtype;
  amt bigint;
  pnl_legs jsonb := '[]'::jsonb;
  counter jsonb := '[]'::jsonb;
  pnl_sum bigint := 0;
  total bigint := 0;
  bank_id uuid;
  core jsonb;
  rid uuid;
  direction text;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_doc_date is null
    or p_currency is null or p_currency !~ '^[A-Z]{3}$'
    or p_description is null or char_length(btrim(p_description)) not between 1 and 120
    or (p_reference is not null and char_length(btrim(p_reference)) not between 1 and 60)
    or p_legs is null or jsonb_typeof(p_legs) <> 'array'
    or jsonb_array_length(p_legs) not between 2 and 50
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'journal_entry|' || p_doc_date::text || '|' || p_currency || '|' || btrim(p_description) || '|'
    || coalesce(btrim(p_reference), '') || '|' || p_legs::text;
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
    -- Each leg: its shape, then where it goes. A leg on a category counted in the P&L is a P&L leg,
    -- booked by book_line's rules; one on a kept-out category or a balance-sheet account is a counter
    -- leg, which stands in for the bank leg.
    for leg, ord in select e.value, e.ord from jsonb_array_elements(p_legs) with ordinality as e(value, ord)
    loop
      if jsonb_typeof(leg) <> 'object'
        or jsonb_typeof(leg->'account_id') is distinct from 'string'
        or (leg->>'account_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(leg->'amount_minor') is distinct from 'number'
        or (leg->>'amount_minor') !~ '^-?[0-9]{1,15}$'
        or (leg->>'amount_minor')::bigint = 0
        or ((leg ? 'project_id') and jsonb_typeof(leg->'project_id') not in ('string', 'null'))
        or ((leg ? 'project_id') and jsonb_typeof(leg->'project_id') = 'string'
          and (leg->>'project_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
        or exists (select 1 from jsonb_object_keys(leg) k where k not in ('account_id', 'amount_minor', 'project_id'))
      then
        raise exception 'validation';
      end if;
      select * into acct from public.accounts a
      where a.id = (leg->>'account_id')::uuid and a.company_id = cid;
      if not found then
        raise exception 'account not found';
      end if;
      if jsonb_typeof(leg->'project_id') = 'string'
        and not exists (select 1 from public.projects p where p.id = (leg->>'project_id')::uuid and p.company_id = cid)
      then
        raise exception 'project not found';
      end if;
      amt := (leg->>'amount_minor')::bigint;
      total := total + amt;
      if acct.is_bank then
        raise exception 'a journal entry has no bank leg';
      end if;
      if acct.category_id is not null then
        select * into cat from public.categories c where c.id = acct.category_id and c.company_id = cid;
        if not found then
          raise exception 'account not found';
        end if;
        if not coalesce(cat.excluded_from_pnl, false) then
          pnl_legs := pnl_legs || (leg - 'project_id'
            || case when jsonb_typeof(leg->'project_id') = 'string'
                 then jsonb_build_object('project_id', leg->'project_id') else '{}'::jsonb end);
          pnl_sum := pnl_sum + amt;
          continue;
        end if;
        counter := counter || jsonb_build_object(
          'account_id', private.kept_out_account(cid, cat.id, cat.loan_part),
          'project_id', nullif(leg->>'project_id', ''), 'amount_minor', amt, 'ordinal', ord);
      elsif acct.type in ('asset', 'liability') and acct.name not in ('Suspense', 'VAT control') then
        counter := counter || jsonb_build_object(
          'account_id', acct.id, 'project_id', nullif(leg->>'project_id', ''), 'amount_minor', amt, 'ordinal', ord);
      else
        raise exception 'a journal entry takes category and balance-sheet accounts';
      end if;
    end loop;

    if total <> 0 then
      raise exception 'legs do not balance';
    end if;
    if jsonb_array_length(pnl_legs) = 0 then
      raise exception 'a journal entry needs a leg in the P&L';
    end if;
    if pnl_sum = 0 then
      raise exception 'a journal entry must change the P&L';
    end if;

    -- The P&L side through book_line's rules, its bank leg the counter legs' sum (the P&L legs'
    -- opposite): a debit to an expense makes an expense line.
    select a.id into bank_id from public.accounts a where a.company_id = cid and a.is_bank;
    direction := case when pnl_sum < 0 then 'income' else 'expense' end;
    perform set_config('flow.journal_entry', 'on', true);
    core := private.book_line_core(
      cid, direction, p_doc_date, p_currency, p_description,
      pnl_legs || jsonb_build_array(jsonb_build_object('account_id', bank_id, 'amount_minor', -pnl_sum)),
      null, null
    );
    perform set_config('flow.journal_entry', '', true);
    rid := (core->>'id')::uuid;

    -- Out of the cash view, then marked (after which the line is fixed), and posted again so the
    -- counter legs replace the bank leg.
    update public.transactions t set in_cash_override = false, idempotency_key = 'journal:' || rid::text
    where t.id = rid and t.company_id = cid;
    insert into public.journal_entries (transaction_id, company_id, reference)
    values (rid, cid, nullif(btrim(p_reference), ''));
    insert into public.journal_counter_legs (company_id, transaction_id, account_id, project_id, amount_minor, ordinal)
    select cid, rid, (c->>'account_id')::uuid, (c->>'project_id')::uuid, (c->>'amount_minor')::bigint,
      (row_number() over (order by (c->>'ordinal')::integer))::smallint
    from jsonb_array_elements(counter) c;
    perform private.rebuild_legs_many(cid, array[rid]);

    insert into private.mcp_writes (token_id, user_id, company_id, kind, transaction_id, prior)
    values (token, auth.uid(), cid, 'journal_entry', rid, jsonb_build_object('after', jsonb_build_object(
      'amount_gross', -pnl_sum, 'doc_date', p_doc_date,
      'legs', (select md5(coalesce(string_agg(l.account_id::text || ':' || coalesce(l.project_id::text, '') || ':' || l.amount_minor::text, '|' order by l.ordinal), ''))
               from public.legs l where l.transaction_id = rid and l.company_id = cid)
    )));

    response := jsonb_build_object('ok', true, 'data', jsonb_build_object(
      'id', rid,
      'doc_date', p_doc_date,
      'currency', p_currency,
      'description', btrim(p_description),
      'reference', nullif(btrim(p_reference), ''),
      'pnl_minor', -pnl_sum,
      'legs', (
        select jsonb_agg(jsonb_build_object(
            'account_id', l.account_id, 'project_id', l.project_id, 'amount_minor', l.amount_minor,
            'in_pnl', a.type in ('income', 'expense')
          ) order by l.ordinal)
        from public.legs l
        join public.accounts a on a.id = l.account_id and a.company_id = l.company_id
        where l.company_id = cid and l.transaction_id = rid
      ),
      'undo_kind', 'journal_entry'
    ));
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
revoke all on function public.mcp_create_journal_entry(text, date, text, text, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_create_journal_entry(text, date, text, text, text, jsonb) to authenticated;
comment on function public.mcp_create_journal_entry(text, date, text, text, text, jsonb) is
  'MCP create_journal_entry: a balanced entry with no bank leg (depreciation), in the P&L and out of the cash view; undo kind journal_entry. Decision 0228.';

-- Its undo: the line goes while it reads as written.
create function private.undo_journal_entry_write(p_company uuid, p_write private.mcp_writes)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := p_company;
  rec private.mcp_writes := p_write;
begin
  perform 1 from public.transactions t
  where t.id = rec.transaction_id and t.company_id = cid and t.removed_at is null
    and exists (select 1 from public.journal_entries j where j.transaction_id = t.id)
  for update;
  if not found then
    return private.mcp_error('conflict', 'conflict');
  end if;
  if (
    select jsonb_build_object(
      'amount_gross', t.amount_gross, 'doc_date', t.doc_date,
      'legs', (select md5(coalesce(string_agg(
                 l.account_id::text || ':' || coalesce(l.project_id::text, '') || ':' || l.amount_minor::text,
                 '|' order by l.ordinal), ''))
               from public.legs l where l.transaction_id = rec.transaction_id and l.company_id = cid)
    )
    from public.transactions t where t.id = rec.transaction_id and t.company_id = cid
  ) is distinct from rec.prior->'after' then
    return private.mcp_error('conflict', 'conflict');
  end if;
  -- Its split parts, entry and legs cascade with it.
  delete from public.transactions t where t.id = rec.transaction_id and t.company_id = cid;
  update private.mcp_writes set undone_at = clock_timestamp() where id = rec.id and undone_at is null;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('kind', 'journal_entry', 'id', rec.transaction_id));
end;
$$;
revoke all on function private.undo_journal_entry_write(uuid, private.mcp_writes) from public, anon, authenticated;

do $kinds$
declare
  def text;
  anchor text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'loan_category_from'::text])$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, $n$'loan_category_from'::text, 'journal_entry'::text])$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if right(def, 2) <> '))' or position($a$(kind = 'loan_category_from'::text)$a$ in def) = 0 then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'journal_entry'::text) AND (transaction_id IS NOT NULL) AND (prior ? 'after'::text))))$n$;
end
$kinds$;

do $undo$
declare
  def text;
  a_kinds constant text := $a$'loan_part_category', 'loan_category_from'
    )$a$;
  a_lookup constant text := $a$        or (p_kind in ('loan_part_category', 'loan_category_from') and w.kind = p_kind and w.id = p_id)
      )$a$;
  a_branch constant text := $a$    elsif p_kind = 'book_line' then$a$;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, a_kinds) <> 1 or pg_temp.anchor_count(def, a_lookup) <> 1
    or pg_temp.anchor_count(def, a_branch) <> 1 then
    raise exception 'mcp_undo is not the expected definition';
  end if;
  def := replace(def, a_kinds, $n$'loan_part_category', 'loan_category_from', 'journal_entry'
    )$n$);
  def := replace(def, a_lookup, $n$        or (p_kind in ('loan_part_category', 'loan_category_from') and w.kind = p_kind and w.id = p_id)
        or (p_kind = 'journal_entry' and w.kind = 'journal_entry' and w.transaction_id = p_id)
      )$n$);
  def := replace(def, a_branch, $n$    elsif p_kind = 'journal_entry' then
      -- FLOW-149 (decision 0228).
      response := private.undo_journal_entry_write(cid, rec);
$n$ || a_branch);
  execute def;
end
$undo$;

-- 6. Reads.
do $reads$
declare
  def text;
  a_txn constant text := $a$    'loan_split', public.get_loan_split(t.id),$a$;
  a_legs constant text := $a$    'vat_amount', t.vat_amount,$a$;
begin
  def := pg_get_functiondef('public.get_transaction(uuid)'::regprocedure);
  if pg_temp.anchor_count(def, a_txn) <> 1 then
    raise exception 'get_transaction is not the expected definition';
  end if;
  def := replace(def, a_txn, a_txn || $n$
    -- FLOW-149: a journal entry (it moves no money) and its reference; null for any other line.
    'journal_entry', (select jsonb_build_object('reference', j.reference)
                      from public.journal_entries j
                      where j.transaction_id = t.id and j.company_id = t.company_id),$n$);
  execute def;

  def := pg_get_functiondef('public.mcp_line_legs(uuid)'::regprocedure);
  if pg_temp.anchor_count(def, a_legs) <> 1 then
    raise exception 'mcp_line_legs is not the expected definition';
  end if;
  def := replace(def, a_legs, a_legs || $n$
    'journal_entry', (select jsonb_build_object('reference', j.reference)
                      from public.journal_entries j
                      where j.transaction_id = t.id and j.company_id = cid),$n$);
  execute def;
end
$reads$;

create function public.mcp_account_balances(p_as_of date default null)
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
        where l.company_id = cid and a.type in ('asset', 'liability') and not a.is_bank
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
        where l.company_id = cid and a.category_id is null and a.name in ('Property', 'Accumulated depreciation')
        group by l.project_id, p.name, coalesce(t.currency, 'ILS')
        having sum(l.amount_minor) <> 0
          or sum(l.amount_minor) filter (where a.name = 'Accumulated depreciation') <> 0
      ) v
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.mcp_account_balances(date) from public, anon, authenticated, service_role;
grant execute on function public.mcp_account_balances(date) to authenticated;
comment on function public.mcp_account_balances(date) is
  'MCP get_account_balances: the legs on balance-sheet accounts summed per project and currency as of a date, and each project''s net book value (Property plus Accumulated depreciation). Decision 0228.';

-- mcp_refused: the new reasons. account not found stays generic, as in book_line, so a refusal never
-- says whether another company's account exists.
do $refused$
declare
  def text;
  a_list constant text := $a$        'a loan payment is an expense line'
      ) then p_message$a$;
begin
  def := pg_get_functiondef('private.mcp_refused(text)'::regprocedure);
  if pg_temp.anchor_count(def, a_list) <> 1 then
    raise exception 'mcp_refused is not the expected definition';
  end if;
  def := replace(def, a_list, $n$        'a loan payment is an expense line',
        -- FLOW-149 (decision 0228).
        'journal entry is fixed',
        'a journal entry has no bank leg',
        'a journal entry takes category and balance-sheet accounts',
        'a journal entry needs a leg in the P&L',
        'a journal entry must change the P&L'
      ) then p_message$n$);
  execute def;
end
$refused$;

drop function pg_temp.anchor_count(text, text);

commit;
