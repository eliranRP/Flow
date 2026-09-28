-- Flow schema v1.
-- Edited in place: nothing has been applied to the hosted project yet.
-- One company, one owner (auth.uid()). Money is bigint agorot.
-- SUMIT keys are envelope ciphertext only. The browser cannot read or write them.
-- gen_random_uuid() is built into Postgres 13+ (this project is 17). No pgcrypto.
-- VAT default 1800 bp matches packages/shared STANDARD_VAT_RATE_BP (decisions 0041, 0043).
--
-- GRANT EXECUTE: the revoke below removes the default EXECUTE privilege from
-- PUBLIC for every future function, in every schema. A new function is not
-- callable until it has an explicit grant. Every function added later, in
-- public or private, needs `grant execute on function ... to authenticated`,
-- and to service_role when the server should call it.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.txn_direction as enum ('income', 'expense');
create type public.vat_status as enum ('source', 'derived', 'assumed', 'unknown');
create type public.txn_source as enum ('sumit', 'hapoalim', 'manual', 'photo');
create type public.pnl_role as enum ('project', 'shared', 'overhead');
create type public.doc_kind as enum (
  'invoice',
  'receipt',
  'invoice_receipt',
  'credit',
  'expense',
  'other'
);
create type public.project_status as enum ('active', 'finished');
create type public.category_kind as enum ('expense', 'income');
create type public.review_status as enum ('open', 'approved', 'skipped', 'changed');
create type public.split_method as enum ('equal', 'income_share', 'manual', 'worker_days');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.touch_updated_at() from public, anon;
grant execute on function private.touch_updated_at() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() unique references auth.users (id) on delete cascade,
  name text not null,
  tax_id text,
  vat_rate_bp integer not null default 1800 check (vat_rate_bp between 0 and 10000),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id)
);

create trigger companies_touch
  before update on public.companies
  for each row execute function private.touch_updated_at();

-- One owner, one company. Policies call this instead of a per-row owner lookup.
create or replace function private.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.companies c
  where c.owner_id = (select auth.uid())
$$;

revoke all on function private.current_company_id() from public, anon;
grant execute on function private.current_company_id() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- categories (7 expense defaults + 2 income defaults, decision 0008)
-- Names must match packages/shared/src/categories.ts.
-- ---------------------------------------------------------------------------

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  kind public.category_kind not null,
  sort_order integer not null,
  is_default boolean not null default false,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, kind, name),
  unique (company_id, id)
);

create index categories_company_idx on public.categories (company_id, kind, sort_order);

create trigger categories_touch
  before update on public.categories
  for each row execute function private.touch_updated_at();

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
  return new;
end;
$$;

revoke all on function private.seed_default_categories() from public, anon;
grant execute on function private.seed_default_categories() to authenticated, service_role;

create trigger companies_seed_categories
  after insert on public.companies
  for each row execute function private.seed_default_categories();

-- ---------------------------------------------------------------------------
-- projects, customers, suppliers
-- Composite unique (company_id, id) is the target for same-company foreign keys.
-- ---------------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  status public.project_status not null default 'active',
  state_label text,
  budget_agorot bigint,
  sumit_budget_section_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name),
  unique (company_id, id)
);

create index projects_company_idx on public.projects (company_id, status);

create trigger projects_touch
  before update on public.projects
  for each row execute function private.touch_updated_at();

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  company_number text,
  sumit_external_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id)
);

create unique index customers_name_uidx on public.customers (company_id, name);
create unique index customers_sumit_uidx on public.customers (company_id, sumit_external_id);

create trigger customers_touch
  before update on public.customers
  for each row execute function private.touch_updated_at();

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  company_number text,
  vat_exempt boolean not null default false,
  remembered_project_id uuid,
  remembered_category_id uuid,
  sumit_external_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, remembered_project_id)
    references public.projects (company_id, id)
    on delete set null (remembered_project_id),
  foreign key (company_id, remembered_category_id)
    references public.categories (company_id, id)
    on delete set null (remembered_category_id)
);

create unique index suppliers_name_uidx on public.suppliers (company_id, name);
create unique index suppliers_sumit_uidx on public.suppliers (company_id, sumit_external_id);
create index suppliers_remembered_project_idx on public.suppliers (remembered_project_id);
create index suppliers_remembered_category_idx on public.suppliers (remembered_category_id);

create trigger suppliers_touch
  before update on public.suppliers
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  direction public.txn_direction not null,
  doc_kind public.doc_kind not null default 'other',
  pnl_role public.pnl_role,
  amount_gross bigint not null,
  amount_net bigint not null,
  vat_amount bigint not null,
  vat_status public.vat_status not null,
  doc_date date not null,
  cash_date date,
  source public.txn_source not null,
  external_id text,
  idempotency_key text not null,
  project_id uuid,
  customer_id uuid,
  supplier_id uuid,
  category_id uuid,
  description text not null default '',
  linked_external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_vat_identity check (amount_gross = amount_net + vat_amount),
  unique (company_id, idempotency_key),
  unique (company_id, id),
  foreign key (company_id, project_id)
    references public.projects (company_id, id)
    on delete set null (project_id),
  foreign key (company_id, customer_id)
    references public.customers (company_id, id)
    on delete set null (customer_id),
  foreign key (company_id, supplier_id)
    references public.suppliers (company_id, id)
    on delete set null (supplier_id),
  foreign key (company_id, category_id)
    references public.categories (company_id, id)
    on delete set null (category_id)
);

create unique index transactions_external_uidx
  on public.transactions (company_id, source, external_id);

create index transactions_company_date_idx
  on public.transactions (company_id, doc_date);

create index transactions_company_cash_idx
  on public.transactions (company_id, cash_date);

create index transactions_project_idx on public.transactions (project_id);
create index transactions_customer_idx on public.transactions (customer_id);
create index transactions_supplier_idx on public.transactions (supplier_id);
create index transactions_category_idx on public.transactions (category_id);

create trigger transactions_touch
  before update on public.transactions
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- allocations and split rules
-- ---------------------------------------------------------------------------

create table public.allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  transaction_id uuid not null,
  project_id uuid not null,
  share_bp integer not null check (share_bp between 1 and 10000),
  amount_net bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transaction_id, project_id),
  foreign key (company_id, transaction_id)
    references public.transactions (company_id, id)
    on delete cascade,
  foreign key (company_id, project_id)
    references public.projects (company_id, id)
    on delete cascade
);

create index allocations_company_idx on public.allocations (company_id, project_id);
create index allocations_project_idx on public.allocations (project_id);

create trigger allocations_touch
  before update on public.allocations
  for each row execute function private.touch_updated_at();

-- Shares for one transaction must sum to 10000, or to 0 when none remain.
-- UPDATE that moves a row checks both the old and the new transaction.
-- Lock the parent row so two concurrent splits cannot both pass.
create or replace function private.check_allocation_shares()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  new_target uuid;
  old_target uuid;
  total integer;
begin
  if tg_op = 'DELETE' then
    old_target := old.transaction_id;
  elsif tg_op = 'UPDATE' then
    new_target := new.transaction_id;
    if old.transaction_id is distinct from new.transaction_id then
      old_target := old.transaction_id;
    end if;
  else
    new_target := new.transaction_id;
  end if;

  if old_target is not null and new_target is not null and old_target < new_target then
    perform 1 from public.transactions where id = old_target for update;
    perform 1 from public.transactions where id = new_target for update;
  else
    if new_target is not null then
      perform 1 from public.transactions where id = new_target for update;
    end if;
    if old_target is not null then
      perform 1 from public.transactions where id = old_target for update;
    end if;
  end if;

  if new_target is not null then
    select coalesce(sum(share_bp), 0) into total
    from public.allocations
    where transaction_id = new_target;
    if total <> 0 and total <> 10000 then
      raise exception 'allocation shares for % must sum to 10000 (got %)', new_target, total
        using errcode = '23514';
    end if;
  end if;

  if old_target is not null then
    select coalesce(sum(share_bp), 0) into total
    from public.allocations
    where transaction_id = old_target;
    if total <> 0 and total <> 10000 then
      raise exception 'allocation shares for % must sum to 10000 (got %)', old_target, total
        using errcode = '23514';
    end if;
  end if;

  return null;
end;
$$;

revoke all on function private.check_allocation_shares() from public, anon;
grant execute on function private.check_allocation_shares() to authenticated, service_role;

create constraint trigger allocations_share_sum
  after insert or update or delete on public.allocations
  deferrable initially deferred
  for each row execute function private.check_allocation_shares();

create table public.split_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  supplier_id uuid,
  method public.split_method not null,
  label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, label),
  unique (company_id, id),
  foreign key (company_id, supplier_id)
    references public.suppliers (company_id, id)
    on delete cascade
);

create index split_rules_company_idx on public.split_rules (company_id);
create index split_rules_supplier_idx on public.split_rules (supplier_id);

create trigger split_rules_touch
  before update on public.split_rules
  for each row execute function private.touch_updated_at();

create table public.split_rule_targets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  rule_id uuid not null,
  project_id uuid not null,
  month date,
  share_bp integer not null check (share_bp between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rule_id, project_id, month),
  foreign key (company_id, rule_id)
    references public.split_rules (company_id, id)
    on delete cascade,
  foreign key (company_id, project_id)
    references public.projects (company_id, id)
    on delete cascade
);

create index split_rule_targets_company_idx on public.split_rule_targets (company_id);
create index split_rule_targets_project_idx on public.split_rule_targets (project_id);

create trigger split_rule_targets_touch
  before update on public.split_rule_targets
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- overhead and review queue
-- ---------------------------------------------------------------------------

create table public.overhead (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  transaction_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transaction_id),
  foreign key (company_id, transaction_id)
    references public.transactions (company_id, id)
    on delete cascade
);

create index overhead_company_idx on public.overhead (company_id);

create trigger overhead_touch
  before update on public.overhead
  for each row execute function private.touch_updated_at();

create table public.review_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  transaction_id uuid,
  status public.review_status not null default 'open',
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  foreign key (company_id, transaction_id)
    references public.transactions (company_id, id)
    on delete cascade
);

create index review_queue_company_idx on public.review_queue (company_id, status);
create index review_queue_open_idx
  on public.review_queue (company_id)
  where status = 'open';
create index review_queue_transaction_idx on public.review_queue (transaction_id);

create trigger review_queue_touch
  before update on public.review_queue
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- sumit_connections: envelope ciphertext, no plaintext key.
-- Authenticated users see only the status view.
-- ---------------------------------------------------------------------------

create table public.sumit_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies (id) on delete cascade,
  sumit_company_id bigint,
  key_ciphertext bytea not null,
  key_nonce bytea not null,
  dek_ciphertext bytea not null,
  dek_nonce bytea not null,
  kek_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sumit_connections_ciphertext_present check (
    octet_length(key_ciphertext) > 0
    and octet_length(key_nonce) > 0
    and octet_length(dek_ciphertext) > 0
    and octet_length(dek_nonce) > 0
    and length(kek_version) > 0
  )
);

comment on table public.sumit_connections is
  'Envelope-encrypted SUMIT credentials. key_ciphertext is the API key under a DEK; dek_ciphertext is the DEK under SUMIT_KEK. No plaintext key is stored. Browser roles have no access to the ciphertext columns.';

create trigger sumit_connections_touch
  before update on public.sumit_connections
  for each row execute function private.touch_updated_at();

create view public.sumit_connection_status
with (security_invoker = true) as
select
  company_id,
  sumit_company_id,
  true as connected
from public.sumit_connections;

comment on view public.sumit_connection_status is
  'Owner-visible SUMIT status. Ciphertext is not selected.';

-- ---------------------------------------------------------------------------
-- audit log. Clients cannot insert. Triggers in private write the rows.
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  actor_id uuid not null references auth.users (id),
  action text not null,
  entity text not null,
  entity_id uuid,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_company_idx on public.audit_log (company_id, created_at);
create index audit_log_actor_idx on public.audit_log (actor_id);

create or replace function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  eid uuid;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'companies' then
    cid := coalesce(new.id, old.id);
    eid := cid;
  else
    cid := coalesce(new.company_id, old.company_id);
    eid := coalesce(new.id, old.id);
  end if;
  -- A company DELETE cascades to children and then to audit_log. An AFTER
  -- DELETE row that still points at that company fails the FK (23503) and
  -- rolls the delete back. Skip the audit once the company row is gone,
  -- including the companies DELETE itself.
  if tg_op = 'DELETE' and not exists (select 1 from public.companies where id = cid) then
    return old;
  end if;
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id)
  values (cid, auth.uid(), lower(tg_op), tg_table_name, eid);
  return coalesce(new, old);
end;
$$;

revoke all on function private.audit_row() from public, anon, authenticated;

create trigger companies_audit
  after insert or update or delete on public.companies
  for each row execute function private.audit_row();
create trigger categories_audit
  after insert or update or delete on public.categories
  for each row execute function private.audit_row();
create trigger projects_audit
  after insert or update or delete on public.projects
  for each row execute function private.audit_row();
create trigger customers_audit
  after insert or update or delete on public.customers
  for each row execute function private.audit_row();
create trigger suppliers_audit
  after insert or update or delete on public.suppliers
  for each row execute function private.audit_row();
create trigger transactions_audit
  after insert or update or delete on public.transactions
  for each row execute function private.audit_row();
create trigger allocations_audit
  after insert or update or delete on public.allocations
  for each row execute function private.audit_row();
create trigger split_rules_audit
  after insert or update or delete on public.split_rules
  for each row execute function private.audit_row();
create trigger split_rule_targets_audit
  after insert or update or delete on public.split_rule_targets
  for each row execute function private.audit_row();
create trigger overhead_audit
  after insert or update or delete on public.overhead
  for each row execute function private.audit_row();
create trigger review_queue_audit
  after insert or update or delete on public.review_queue
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- Home round-trip used by scripts/latency.ts
-- owner_id is unique, so there is at most one row. No unordered limit.
-- ---------------------------------------------------------------------------

create or replace function public.get_home()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'company_id', c.id,
        'name', c.name,
        'net_profit_agorot', 0,
        'is_demo', c.is_demo
      )
      from public.companies c
      where c.owner_id = (select auth.uid())
    ),
    jsonb_build_object(
      'company_id', null,
      'name', null,
      'net_profit_agorot', 0,
      'is_demo', false
    )
  );
$$;

revoke all on function public.get_home() from public, anon;
grant execute on function public.get_home() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS: every table is visible only to the company owner (auth.uid())
-- ---------------------------------------------------------------------------

alter table public.companies enable row level security;
alter table public.categories enable row level security;
alter table public.projects enable row level security;
alter table public.customers enable row level security;
alter table public.suppliers enable row level security;
alter table public.transactions enable row level security;
alter table public.allocations enable row level security;
alter table public.split_rules enable row level security;
alter table public.split_rule_targets enable row level security;
alter table public.overhead enable row level security;
alter table public.review_queue enable row level security;
alter table public.sumit_connections enable row level security;
alter table public.audit_log enable row level security;

create policy companies_owner on public.companies
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy categories_owner on public.categories
  for all to authenticated
  using (company_id = (select private.current_company_id()))
  with check (company_id = (select private.current_company_id()));

create policy projects_owner on public.projects
  for all to authenticated
  using (company_id = (select private.current_company_id()))
  with check (company_id = (select private.current_company_id()));

create policy customers_owner on public.customers
  for all to authenticated
  using (company_id = (select private.current_company_id()))
  with check (company_id = (select private.current_company_id()));

create policy suppliers_owner on public.suppliers
  for all to authenticated
  using (company_id = (select private.current_company_id()))
  with check (company_id = (select private.current_company_id()));

create policy transactions_owner on public.transactions
  for all to authenticated
  using (company_id = (select private.current_company_id()))
  with check (company_id = (select private.current_company_id()));

create policy allocations_owner on public.allocations
  for all to authenticated
  using (company_id = (select private.current_company_id()))
  with check (company_id = (select private.current_company_id()));

create policy split_rules_owner on public.split_rules
  for all to authenticated
  using (company_id = (select private.current_company_id()))
  with check (company_id = (select private.current_company_id()));

create policy split_rule_targets_owner on public.split_rule_targets
  for all to authenticated
  using (company_id = (select private.current_company_id()))
  with check (company_id = (select private.current_company_id()));

create policy overhead_owner on public.overhead
  for all to authenticated
  using (company_id = (select private.current_company_id()))
  with check (company_id = (select private.current_company_id()));

create policy review_queue_owner on public.review_queue
  for all to authenticated
  using (company_id = (select private.current_company_id()))
  with check (company_id = (select private.current_company_id()));

create policy sumit_connections_owner on public.sumit_connections
  for select to authenticated
  using (company_id = (select private.current_company_id()));

create policy audit_log_select on public.audit_log
  for select to authenticated
  using (company_id = (select private.current_company_id()));

-- ---------------------------------------------------------------------------
-- Grants. Anon gets nothing. Authenticated cannot touch ciphertext or audit writes.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all routines in schema public from anon, authenticated, public;

-- PUBLIC's built-in default is EXECUTE on every new function, and anon
-- inherits PUBLIC. A per-schema revoke from anon does not remove that grant.
-- After this revoke, every future function needs its own grant execute.
alter default privileges for role postgres revoke execute on functions from public;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on routines from anon;

grant select, insert, update, delete on
  public.companies,
  public.categories,
  public.projects,
  public.customers,
  public.suppliers,
  public.transactions,
  public.allocations,
  public.split_rules,
  public.split_rule_targets,
  public.overhead,
  public.review_queue
to authenticated;

grant select (id, company_id, sumit_company_id, created_at, updated_at)
  on public.sumit_connections to authenticated;
grant select on public.sumit_connection_status to authenticated;
grant select on public.audit_log to authenticated;

grant execute on function public.get_home() to authenticated;
grant execute on function private.current_company_id() to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on function public.get_home() to service_role;
grant execute on function private.current_company_id() to service_role;
