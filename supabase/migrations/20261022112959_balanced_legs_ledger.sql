-- FLOW-948. Balanced signed legs ledger — FOUNDATION ONLY. Decision 0208.
--
-- FOUNDATION-FIRST. This migration adds a parallel double-entry ledger (accounts + legs) that
-- MIRRORS the live P&L. It does NOT change private.pnl_lines or any P&L consumer
-- (cash_parts, breakdown_rows, company_pnl, get_project, get_totals, …). The legacy tables stay
-- authoritative; the legs are derived from, and reconciled against, the live pnl_lines output.
-- A later phase-2 PR may flip the source of truth; this PR does not.
--
-- Leg sign convention (debit positive / credit negative), documented once here:
--   * amount_minor is a SIGNED LEDGER value, NOT a P&L-display amount. Debit > 0, credit < 0.
--   * A bank (asset) leg carries the signed statement movement = transactions.amount_gross
--     (income deposits debit the bank +gross; expense payments credit it -gross).
--   * The P&L PROJECTION of an income/expense leg is  amount_net = -amount_minor
--     (an income account credit -X projects to +X income; an expense account debit +Y projects to
--     -Y expense). This single rule reproduces pnl_lines' "income positive, expense negative".
--
-- Balance invariant (deferred constraint trigger): for every transaction that has legs,
-- sum(legs.amount_minor) = 0 and exactly one leg hits an is_bank account (the statement movement).
--
-- Backfill routing (per live pnl_lines row of a posted, non-removed line):
--   * in-P&L income/expense row  -> a per-category BRIDGE account (or the Uncategorized income/
--     expense system account when the line has no category); amount_minor = -amount_net.
--   * kept-out row               -> a system asset/liability account (Loan principal / Escrow by
--     the category's loan_part, else Suspense); amount_minor = -amount_net. These are never
--     income/expense type, so the projection ignores them.
--   * one bank leg               -> amount_minor = amount_gross (signed) on Bank/Clearing.
--   * when vat_amount <> 0        -> one VAT-control leg amount_minor = -vat_amount.
-- Because amount_gross = amount_net + vat_amount (a transactions CHECK) and the signed sum of a
-- line's pnl_lines rows equals the line's amount_net, every backfilled line balances to 0 exactly,
-- and the income/expense legs project back to pnl_lines per line/category/project (proved by
-- reconciliation pgTAP). Routing by the live in_pnl flag (not by the category's excluded flag)
-- reproduces per-line in_pnl_override exactly, so the projection needs no excluded filter: every
-- income/expense-type leg is, by construction, an in-P&L leg.
--
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. public.accounts — the chart of accounts.
-- ---------------------------------------------------------------------------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  type text not null check (type in ('income', 'expense', 'asset', 'liability')),
  -- Bridge to a P&L category (null for system accounts). loan_part bridges a loan-split part.
  category_id uuid references public.categories (id) on delete cascade,
  loan_part public.loan_split_part,
  is_bank boolean not null default false,
  excluded_from_pnl boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);

-- One bridge account per category; system accounts (category_id null) are keyed by name.
create unique index accounts_bridge_idx
  on public.accounts (company_id, category_id) where category_id is not null;
create unique index accounts_system_idx
  on public.accounts (company_id, name) where category_id is null;
create index accounts_company_idx on public.accounts (company_id);
-- Leads with category_id for the FK to categories (FLOW-811 / decision 0195).
create index accounts_category_idx on public.accounts (category_id) where category_id is not null;

comment on table public.accounts is
  'Chart of accounts for the balanced-legs ledger (decision 0208). type is income/expense/asset/'
  'liability. A bridge account mirrors one P&L category (category_id) or a loan-split part '
  '(loan_part); system accounts (category_id null) are keyed by name. Foundation-first: derived '
  'from the live P&L, which stays authoritative.';

alter table public.accounts enable row level security;
revoke all on public.accounts from public, anon, authenticated;
grant select on public.accounts to authenticated;
grant select, insert, update, delete on public.accounts to service_role;

create policy accounts_select on public.accounts
  for select using (company_id = (select private.readable_company_id()));

-- ---------------------------------------------------------------------------
-- 2. public.legs — one signed ledger entry.
-- ---------------------------------------------------------------------------
create table public.legs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  transaction_id uuid not null,
  account_id uuid not null,
  project_id uuid references public.projects (id) on delete set null,
  -- SIGNED ledger amount (debit positive / credit negative); NOT a P&L-display value.
  amount_minor bigint not null,
  ordinal smallint not null,
  created_at timestamptz not null default now(),
  foreign key (company_id, transaction_id)
    references public.transactions (company_id, id) on delete cascade,
  foreign key (company_id, account_id)
    references public.accounts (company_id, id) on delete restrict
);

create index legs_txn_idx on public.legs (company_id, transaction_id);
create index legs_account_idx on public.legs (company_id, account_id);
-- Leads with project_id for the FK to projects (FLOW-811 / decision 0195).
create index legs_project_idx on public.legs (project_id) where project_id is not null;

comment on table public.legs is
  'Balanced signed ledger entries (decision 0208). amount_minor is SIGNED (debit positive / credit '
  'negative), not a P&L amount. Each transaction''s legs sum to 0 with exactly one is_bank leg '
  '(the signed statement movement = amount_gross). An income/expense leg projects to P&L as '
  'amount_net = -amount_minor. Foundation-first: pnl_lines is unchanged and authoritative.';

alter table public.legs enable row level security;
revoke all on public.legs from public, anon, authenticated;
grant select on public.legs to authenticated;
grant select, insert, update, delete on public.legs to service_role;

create policy legs_select on public.legs
  for select using (company_id = (select private.readable_company_id()));

-- ---------------------------------------------------------------------------
-- 3. Balance invariant — deferred constraint trigger.
-- ---------------------------------------------------------------------------
create or replace function private.legs_balance_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  tid uuid;
  total bigint;
  banks integer;
  legcount integer;
begin
  if tg_op = 'DELETE' then
    cid := old.company_id; tid := old.transaction_id;
  else
    cid := new.company_id; tid := new.transaction_id;
  end if;

  select count(*), coalesce(sum(l.amount_minor), 0),
    count(*) filter (where a.is_bank)
  into legcount, total, banks
  from public.legs l
  join public.accounts a on a.id = l.account_id
  where l.company_id = cid and l.transaction_id = tid;

  -- No legs left (the transaction was fully unbooked): nothing to enforce.
  if legcount = 0 then
    return null;
  end if;
  if total <> 0 then
    raise exception 'legs do not balance for transaction %: sum=%', tid, total;
  end if;
  if banks <> 1 then
    raise exception 'transaction % must have exactly one bank leg, has %', tid, banks;
  end if;
  return null;
end;
$$;

revoke all on function private.legs_balance_check() from public, anon, authenticated;

create constraint trigger legs_balance
  after insert or update or delete on public.legs
  deferrable initially deferred
  for each row execute function private.legs_balance_check();

-- ---------------------------------------------------------------------------
-- 4. Account provisioning: bridge per category + system accounts per company.
-- ---------------------------------------------------------------------------
-- Ensure the full set of accounts exists for one company. Idempotent.
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

  -- System accounts (category_id null), keyed by name.
  insert into public.accounts (company_id, name, type, is_bank, excluded_from_pnl)
  values
    (p_company, 'Bank/Clearing', 'asset', true, true),
    (p_company, 'Loan principal', 'liability', false, true),
    (p_company, 'Escrow', 'asset', false, true),
    (p_company, 'Owner capital', 'liability', false, true),
    (p_company, 'Security deposit held', 'liability', false, true),
    (p_company, 'Suspense', 'asset', false, true),
    (p_company, 'VAT control', 'liability', false, true),
    (p_company, 'Uncategorized income', 'income', false, false),
    (p_company, 'Uncategorized expense', 'expense', false, false)
  on conflict (company_id, name) where category_id is null do nothing;
end;
$$;

revoke all on function private.ensure_accounts(uuid) from public, anon, authenticated;
grant execute on function private.ensure_accounts(uuid) to service_role;

select private.ensure_accounts(c.id) from public.companies c;

-- ---------------------------------------------------------------------------
-- 5. Rebuild a transaction's legs from the live pnl_lines (maintenance + backfill).
-- ---------------------------------------------------------------------------
-- Deletes and re-derives the legs for one posted, non-removed transaction, matching the live P&L.
-- A pending/removed transaction (no pnl_lines rows) is left with no legs.
create or replace function private.rebuild_legs(p_company uuid, p_txn uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t_gross bigint;
  t_vat bigint;
begin
  -- One DELETE, then one INSERT. All legs of a transaction are written by a single statement so
  -- the balance invariant (even when a caller forces constraints immediate) only ever sees the
  -- complete, balanced set — never a half-built one.
  delete from public.legs where company_id = p_company and transaction_id = p_txn;

  select t.amount_gross, t.vat_amount into t_gross, t_vat
  from public.transactions t
  where t.company_id = p_company and t.id = p_txn
    and t.removed_at is null and t.line_status = 'posted';
  if not found then
    return;  -- not a posted P&L line: no legs.
  end if;

  insert into public.legs (company_id, transaction_id, account_id, project_id, amount_minor, ordinal)
  with sys as (
    select
      (array_agg(id) filter (where name = 'Bank/Clearing'))[1] as bank,
      (array_agg(id) filter (where name = 'VAT control'))[1] as vat,
      (array_agg(id) filter (where name = 'Suspense'))[1] as susp,
      (array_agg(id) filter (where name = 'Loan principal'))[1] as loanp,
      (array_agg(id) filter (where name = 'Escrow'))[1] as escrow,
      (array_agg(id) filter (where name = 'Uncategorized income'))[1] as uinc,
      (array_agg(id) filter (where name = 'Uncategorized expense'))[1] as uexp
    from public.accounts
    where company_id = p_company and category_id is null
  ),
  entries as (
    -- One leg per live pnl_lines row: in-P&L income/expense -> the per-category bridge (or the
    -- Uncategorized system account when the line has no category); kept-out -> a system asset/
    -- liability account (Loan principal / Escrow by loan_part, else Suspense).
    select
      case
        when l.in_pnl and l.kind in ('income', 'expense') then
          case
            when l.category_id is not null
              then (select a.id from public.accounts a
                    where a.company_id = p_company and a.category_id = l.category_id)
            when l.kind = 'income' then sys.uinc
            else sys.uexp
          end
        else
          case c.loan_part
            when 'principal' then sys.loanp
            when 'escrow' then sys.escrow
            else sys.susp
          end
      end as account_id,
      l.project_id,
      -l.amount_net as amount_minor,
      0 as grp,
      l.category_id as k1, l.project_id as k2, l.amount_net as k3
    from private.pnl_lines l
    left join public.categories c on c.id = l.category_id
    cross join sys
    where l.company_id = p_company and l.transaction_id = p_txn
    union all
    -- The bank leg: the signed statement movement = amount_gross.
    select sys.bank, null, t_gross, 1, null, null, null from sys
    union all
    -- VAT is one more leg so the net + VAT legs balance the gross bank movement.
    select sys.vat, null, -t_vat, 2, null, null, null from sys where coalesce(t_vat, 0) <> 0
  )
  select p_company, p_txn, account_id, project_id, amount_minor,
    (row_number() over (order by grp, k1 nulls first, k2 nulls first, k3))::smallint
  from entries;
end;
$$;

revoke all on function private.rebuild_legs(uuid, uuid) from public, anon, authenticated;
grant execute on function private.rebuild_legs(uuid, uuid) to service_role;

-- One-time backfill of every posted, non-removed line.
select private.rebuild_legs(t.company_id, t.id)
from public.transactions t
where t.removed_at is null and t.line_status = 'posted';

-- ---------------------------------------------------------------------------
-- 6. P&L projection of the legs — the reconciliation primitive.
-- ---------------------------------------------------------------------------
-- Projects the in-P&L income/expense legs to the shape of pnl_lines, per line/category/project:
-- income positive, expense negative, via amount_net = -amount_minor. Every income/expense-type leg
-- is, by construction, an in-P&L leg, so no in_pnl filter is needed here.
create or replace function private.legs_pnl_projection(p_company uuid)
returns table (
  transaction_id uuid,
  category_id uuid,
  project_id uuid,
  kind text,
  amount_net bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    l.transaction_id,
    a.category_id,
    l.project_id,
    a.type as kind,
    sum(-l.amount_minor)::bigint as amount_net
  from public.legs l
  join public.accounts a on a.id = l.account_id
  where l.company_id = p_company
    and a.type in ('income', 'expense')
  group by l.transaction_id, a.category_id, l.project_id, a.type;
$$;

revoke all on function private.legs_pnl_projection(uuid) from public, anon, authenticated;
grant execute on function private.legs_pnl_projection(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Maintenance triggers: keep the legs in sync when the legacy tables are written by the
--    existing RPCs. The write RPCs themselves are UNCHANGED. A statement trigger collects the
--    transactions touched and re-derives their legs from the (now updated) live pnl_lines. The
--    balance invariant is deferred, so the intermediate states of a multi-statement RPC (e.g.
--    save_line_split deletes then re-inserts parts) are fine; only the committed state must balance.
-- ---------------------------------------------------------------------------

-- New company / new category: make sure the chart of accounts exists before any leg references it.
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
  end if;
  return null;
end;
$$;

revoke all on function private.legs_ensure_accounts_tg() from public, anon, authenticated;

create trigger legs_company_accounts
  after insert on public.companies
  for each row execute function private.legs_ensure_accounts_tg();

create trigger legs_category_accounts
  after insert on public.categories
  for each row execute function private.legs_ensure_accounts_tg();

-- Re-derive legs for the transactions named in a NEW transition table.
create or replace function private.legs_sync_txn_new()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  for r in select distinct company_id, id as txn from newtab loop
    perform private.rebuild_legs(r.company_id, r.txn);
  end loop;
  return null;
end;
$$;

create or replace function private.legs_sync_txn_old()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  for r in select distinct company_id, id as txn from oldtab loop
    perform private.rebuild_legs(r.company_id, r.txn);
  end loop;
  return null;
end;
$$;

-- Child tables (line_splits / loan_splits / allocations) carry transaction_id + company_id.
create or replace function private.legs_sync_child_new()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  for r in select distinct company_id, transaction_id as txn from newtab loop
    perform private.rebuild_legs(r.company_id, r.txn);
  end loop;
  return null;
end;
$$;

create or replace function private.legs_sync_child_old()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  for r in select distinct company_id, transaction_id as txn from oldtab loop
    perform private.rebuild_legs(r.company_id, r.txn);
  end loop;
  return null;
end;
$$;

revoke all on function private.legs_sync_txn_new() from public, anon, authenticated;
revoke all on function private.legs_sync_txn_old() from public, anon, authenticated;
revoke all on function private.legs_sync_child_new() from public, anon, authenticated;
revoke all on function private.legs_sync_child_old() from public, anon, authenticated;

create trigger legs_txn_ins after insert on public.transactions
  referencing new table as newtab for each statement execute function private.legs_sync_txn_new();
create trigger legs_txn_upd after update on public.transactions
  referencing new table as newtab for each statement execute function private.legs_sync_txn_new();
create trigger legs_txn_del after delete on public.transactions
  referencing old table as oldtab for each statement execute function private.legs_sync_txn_old();

create trigger legs_lsplit_ins after insert on public.line_splits
  referencing new table as newtab for each statement execute function private.legs_sync_child_new();
create trigger legs_lsplit_upd after update on public.line_splits
  referencing new table as newtab for each statement execute function private.legs_sync_child_new();
create trigger legs_lsplit_del after delete on public.line_splits
  referencing old table as oldtab for each statement execute function private.legs_sync_child_old();

create trigger legs_loansplit_ins after insert on public.loan_splits
  referencing new table as newtab for each statement execute function private.legs_sync_child_new();
create trigger legs_loansplit_upd after update on public.loan_splits
  referencing new table as newtab for each statement execute function private.legs_sync_child_new();
create trigger legs_loansplit_del after delete on public.loan_splits
  referencing old table as oldtab for each statement execute function private.legs_sync_child_old();

create trigger legs_alloc_ins after insert on public.allocations
  referencing new table as newtab for each statement execute function private.legs_sync_child_new();
create trigger legs_alloc_upd after update on public.allocations
  referencing new table as newtab for each statement execute function private.legs_sync_child_new();
create trigger legs_alloc_del after delete on public.allocations
  referencing old table as oldtab for each statement execute function private.legs_sync_child_old();

-- The write ledger accepts a 'book_line' kind (appended to its kind check with a counted anchor).
do $k$
declare d text;
begin
  select pg_get_constraintdef(oid) into d from pg_constraint
  where conname = 'mcp_writes_kind_check' and conrelid = 'private.mcp_writes'::regclass;
  if d is null or position('book_line' in d) > 0
    or (length(d) - length(replace(d, $a$'transfer_match'::text])))$a$, ''))) / length($a$'transfer_match'::text])))$a$) <> 1
  then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  d := replace(d, $a$'transfer_match'::text])))$a$, $a$'transfer_match'::text, 'book_line'::text])))$a$);
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check ' || d;
end
$k$;

-- book_line needs transaction_id and a prior 'after' snapshot (like manual_entry); add its target
-- clause with a counted anchor on the (current last) transfer_match clause.
do $t$
declare
  d text;
  anchor constant text := $a$(prior ? 'in_transaction_id'::text) AND (prior ? 'written'::text) AND (prior ? 'before'::text))$a$;
begin
  select pg_get_constraintdef(oid) into d from pg_constraint
  where conname = 'mcp_writes_target' and conrelid = 'private.mcp_writes'::regclass;
  if d is null or position('book_line' in d) > 0
    or (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1
  then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  d := replace(d, anchor,
    anchor || $a$ OR ((kind = 'book_line'::text) AND (transaction_id IS NOT NULL) AND (prior ? 'after'::text))$a$);
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target ' || d;
end
$t$;

-- ---------------------------------------------------------------------------
-- 8. public.mcp_book_line — the general MCP booking tool (decision 0208).
-- ---------------------------------------------------------------------------
-- Books a NEW P&L line from a balanced set of legs. Validates the legs balance to 0, hit exactly
-- one of the caller's bank accounts, and otherwise land on the caller's own category (bridge)
-- accounts of the line's own kind. Writes the equivalent LEGACY rows (a transactions row, and
-- line_splits when there is more than one category leg) so the unchanged pnl_lines reflects it;
-- the maintenance trigger then derives the ledger legs. A self-check refuses (rather than
-- mis-books) if the derived legs' projection does not reproduce the requested legs exactly.
-- Phase-1 books in-P&L categorized lines/splits; asset/liability (escrow, principal, owner draw)
-- and VAT bookings are a later phase and are refused here, so no behavior is invented.
-- Idempotency + rate limit via private.mcp_writes; undo kind 'book_line'. Company scoping exactly
-- as every other write (private.current_company_id / mcp_require_writer).
create or replace function public.mcp_book_line(
  p_idempotency_key text,
  p_doc_date date,
  p_direction text,
  p_currency text,
  p_description text,
  p_legs jsonb,
  p_project_id uuid default null
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
  bank_legs integer;
  bank_amt bigint;
  content integer;
  line_cat uuid;
  line_proj uuid;
  want jsonb;
  got jsonb;
  leg jsonb;
  acct public.accounts%rowtype;
  n integer;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) < 1 or char_length(p_idempotency_key) > 128
    or p_direction is null or p_direction not in ('income', 'expense')
    or p_doc_date is null
    or p_currency is null or p_currency !~ '^[A-Z]{3}$'
    or p_description is null or char_length(btrim(p_description)) < 1 or char_length(p_description) > 120
    or p_legs is null or jsonb_typeof(p_legs) <> 'array' or jsonb_array_length(p_legs) < 2
    or jsonb_array_length(p_legs) > 50
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  cid := private.current_company_id();

  hash := 'book_line|' || p_direction || '|' || p_doc_date::text || '|' || p_currency
    || '|' || btrim(p_description) || '|' || coalesce(p_project_id::text, '') || '|' || p_legs::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  response := private.mcp_error('refused', 'The write was refused.');
  begin
    -- Validate every leg: shape, company ownership, project ownership.
    n := jsonb_array_length(p_legs);
    bank_legs := 0;
    bank_amt := 0;
    content := 0;
    line_cat := null;
    line_proj := null;
    for leg in select value from jsonb_array_elements(p_legs)
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
      if acct.is_bank then
        bank_legs := bank_legs + 1;
        bank_amt := (leg->>'amount_minor')::bigint;
      else
        -- Phase-1: a content leg must be an in-P&L category (bridge) account of the line's kind.
        if acct.category_id is null or acct.type <> p_direction or acct.excluded_from_pnl then
          raise exception 'book_line: unsupported account for a phase-1 booking';
        end if;
        content := content + 1;
        line_cat := acct.category_id;
        line_proj := nullif(leg->>'project_id', '')::uuid;
      end if;
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

    -- The legacy rows: a posted line whose net is the bank movement (phase-1 is VAT-free).
    insert into public.transactions (
      company_id, direction, doc_kind, pnl_role, line_status, currency,
      amount_gross, amount_net, amount_original, vat_amount, vat_status, doc_date, cash_date,
      source, idempotency_key, project_id, category_id, description, user_assigned
    )
    values (
      cid, p_direction::public.txn_direction, 'receipt', 'project', 'posted', p_currency,
      bank_amt, bank_amt, abs(bank_amt), 0, 'source', p_doc_date, p_doc_date,
      'manual', 'book:' || gen_random_uuid()::text,
      case when content = 1 then line_proj else p_project_id end,
      case when content = 1 then line_cat else null end,
      btrim(p_description), true
    )
    returning id into rid;

    -- More than one category leg: express it as a split (each part is one content leg).
    if content > 1 then
      insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor, is_rest, gross_up)
      select cid, rid, row_number() over (),
        a.category_id, nullif(e.value->>'project_id', '')::uuid, abs((e.value->>'amount_minor')::bigint), false, false
      from jsonb_array_elements(p_legs) e
      join public.accounts a on a.id = (e.value->>'account_id')::uuid and a.company_id = cid
      where not a.is_bank;
    end if;

    -- Self-check: the legs the maintenance trigger derived must project exactly to the requested
    -- income/expense legs (per category/project). Otherwise refuse — never mis-book.
    want := coalesce((
      select jsonb_agg(jsonb_build_object('c', a.category_id, 'p', nullif(e.value->>'project_id',''), 'n', -(e.value->>'amount_minor')::bigint)
        order by a.category_id::text, coalesce(e.value->>'project_id',''))
      from jsonb_array_elements(p_legs) e
      join public.accounts a on a.id = (e.value->>'account_id')::uuid and a.company_id = cid
      where not a.is_bank
    ), '[]'::jsonb);
    got := coalesce((
      select jsonb_agg(jsonb_build_object('c', pr.category_id, 'p', pr.project_id::text, 'n', pr.amount_net)
        order by pr.category_id::text, coalesce(pr.project_id::text,''))
      from private.legs_pnl_projection(cid) pr
      where pr.transaction_id = rid
    ), '[]'::jsonb);
    if want is distinct from got then
      raise exception 'book_line: could not represent the legs in the ledger';
    end if;

    insert into private.mcp_writes (token_id, user_id, company_id, kind, transaction_id, prior)
    values (token, auth.uid(), cid, 'book_line', rid, jsonb_build_object('after', jsonb_build_object(
      'amount_gross', bank_amt, 'doc_date', p_doc_date,
      'legs', (select md5(coalesce(string_agg(l.account_id::text || ':' || coalesce(l.project_id::text,'') || ':' || l.amount_minor::text, '|' order by l.ordinal), ''))
               from public.legs l where l.transaction_id = rid and l.company_id = cid)
    )));

    response := jsonb_build_object('ok', true, 'data', jsonb_build_object(
      'id', rid, 'direction', p_direction, 'undo_kind', 'book_line'));
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

revoke all on function public.mcp_book_line(text, date, text, text, text, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_book_line(text, date, text, text, text, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. The 'book_line' undo kind, patched into public.mcp_undo with counted anchors (so a future
--    change to mcp_undo makes this fail loudly rather than drift). Undo removes the booked line
--    (and its splits) while it is still the line the booking made (a conflict check on the
--    amount, date and the derived legs' fingerprint); the legs go with it via the cascade.
-- ---------------------------------------------------------------------------
do $undo$
declare
  def text;
  a1 constant text := $x$'manual_entry', 'document_attach'$x$;
  a2 constant text := $x$        or (p_kind = 'document_attach' and w.kind = 'document_attach' and w.transaction_id = p_id)$x$;
  a3 constant text := $x$    elsif p_kind = 'document_attach' then$x$;
  branch constant text := $x$    elsif p_kind = 'book_line' then
      -- FLOW-948 (decision 0208). Remove the booked line while it is still the one booked: same
      -- gross, date, and derived-legs fingerprint. A human edit (new category/split) changes the
      -- fingerprint and so conflicts. Deleting the line cascades its legs.
      perform 1 from public.transactions t
      where t.id = rec.transaction_id and t.company_id = cid and t.removed_at is null
      for update;
      if not found then
        response := private.mcp_error('conflict', 'conflict');
      elsif (
        select jsonb_build_object(
          'amount_gross', t.amount_gross, 'doc_date', t.doc_date,
          'legs', (select md5(coalesce(string_agg(
                     l.account_id::text || ':' || coalesce(l.project_id::text, '') || ':' || l.amount_minor::text,
                     '|' order by l.ordinal), ''))
                   from public.legs l where l.transaction_id = rec.transaction_id and l.company_id = cid)
        )
        from public.transactions t where t.id = rec.transaction_id and t.company_id = cid
      ) is distinct from rec.prior->'after' then
        response := private.mcp_error('conflict', 'conflict');
      else
        begin
          delete from public.line_splits where transaction_id = rec.transaction_id and company_id = cid;
          delete from public.transactions t
          where t.id = rec.transaction_id and t.company_id = cid and t.source = 'manual';
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object('ok', true, 'data', jsonb_build_object('kind', p_kind, 'id', p_id));
        exception
          when sqlstate '23503' then
            response := private.mcp_error('conflict', 'conflict');
        end;
      end if;
$x$;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  if (length(def) - length(replace(def, a1, ''))) / length(a1) <> 1
    or (length(def) - length(replace(def, a2, ''))) / length(a2) <> 1
    or (length(def) - length(replace(def, a3, ''))) / length(a3) <> 1
  then
    raise exception 'mcp_undo is not the expected definition';
  end if;
  def := replace(def, a1, $x$'manual_entry', 'document_attach', 'book_line'$x$);
  def := replace(def, a2, a2 || $x$
        or (p_kind = 'book_line' and w.kind = 'book_line' and w.transaction_id = p_id)$x$);
  def := replace(def, a3, branch || $x$
$x$ || a3);
  execute def;
end
$undo$;

commit;
