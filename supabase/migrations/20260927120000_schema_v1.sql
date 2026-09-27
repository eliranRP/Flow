-- Flow schema v1.
-- One company, one owner (auth.uid()). Money is bigint agorot.
-- SUMIT keys are envelope ciphertext only. There is no plaintext key column.
-- gen_random_uuid() is built into Postgres 13+ (this project is 17). No pgcrypto.

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

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() unique references auth.users (id) on delete cascade,
  name text not null,
  tax_id text,
  vat_rate_bp integer not null default 1800 check (vat_rate_bp between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger companies_touch
  before update on public.companies
  for each row execute function public.touch_updated_at();

create or replace function public.is_company_owner(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.companies
    where id = target_company_id
      and owner_id = auth.uid()
  );
$$;

revoke all on function public.is_company_owner(uuid) from public;
grant execute on function public.is_company_owner(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- categories (7 expense defaults + 2 income defaults, decision 0008)
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
  unique (company_id, kind, name)
);

create index categories_company_idx on public.categories (company_id, kind, sort_order);

create trigger categories_touch
  before update on public.categories
  for each row execute function public.touch_updated_at();

create or replace function public.seed_default_categories()
returns trigger
language plpgsql
security definer
set search_path = public
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

create trigger companies_seed_categories
  after insert on public.companies
  for each row execute function public.seed_default_categories();

-- ---------------------------------------------------------------------------
-- projects, customers, suppliers
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
  unique (company_id, name)
);

create index projects_company_idx on public.projects (company_id, status);

create trigger projects_touch
  before update on public.projects
  for each row execute function public.touch_updated_at();

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  company_number text,
  sumit_external_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index customers_name_uidx on public.customers (company_id, name);
create unique index customers_sumit_uidx on public.customers (company_id, sumit_external_id);
create index customers_company_idx on public.customers (company_id);

create trigger customers_touch
  before update on public.customers
  for each row execute function public.touch_updated_at();

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  company_number text,
  vat_exempt boolean not null default false,
  remembered_project_id uuid references public.projects (id) on delete set null,
  remembered_category_id uuid references public.categories (id) on delete set null,
  sumit_external_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index suppliers_name_uidx on public.suppliers (company_id, name);
create unique index suppliers_sumit_uidx on public.suppliers (company_id, sumit_external_id);
create index suppliers_company_idx on public.suppliers (company_id);

create trigger suppliers_touch
  before update on public.suppliers
  for each row execute function public.touch_updated_at();

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
  project_id uuid references public.projects (id) on delete set null,
  customer_id uuid references public.customers (id) on delete set null,
  supplier_id uuid references public.suppliers (id) on delete set null,
  category_id uuid references public.categories (id) on delete set null,
  description text not null default '',
  linked_external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_vat_identity check (amount_gross = amount_net + vat_amount),
  unique (company_id, idempotency_key)
);

create unique index transactions_external_uidx
  on public.transactions (company_id, source, external_id);

create index transactions_company_date_idx
  on public.transactions (company_id, doc_date);

create index transactions_company_cash_idx
  on public.transactions (company_id, cash_date);

create trigger transactions_touch
  before update on public.transactions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- allocations and split rules
-- ---------------------------------------------------------------------------

create table public.allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  share_bp integer not null check (share_bp between 1 and 10000),
  amount_net bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transaction_id, project_id)
);

create index allocations_company_idx on public.allocations (company_id, project_id);

create trigger allocations_touch
  before update on public.allocations
  for each row execute function public.touch_updated_at();

create or replace function public.check_allocation_shares()
returns trigger
language plpgsql
as $$
declare
  target uuid;
  total integer;
begin
  target := coalesce(new.transaction_id, old.transaction_id);
  select coalesce(sum(share_bp), 0) into total
  from public.allocations
  where transaction_id = target;
  if total <> 0 and total <> 10000 then
    raise exception 'allocation shares for % must sum to 10000 (got %)', target, total
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger allocations_share_sum
  after insert or update or delete on public.allocations
  deferrable initially deferred
  for each row execute function public.check_allocation_shares();

create table public.split_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  supplier_id uuid references public.suppliers (id) on delete cascade,
  method text not null check (method in ('equal', 'income_share', 'manual', 'worker_days')),
  label text not null,
  unique (company_id, label),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index split_rules_company_idx on public.split_rules (company_id);

create trigger split_rules_touch
  before update on public.split_rules
  for each row execute function public.touch_updated_at();

create table public.split_rule_targets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  rule_id uuid not null references public.split_rules (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  month date,
  share_bp integer not null check (share_bp between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rule_id, project_id, month)
);

create index split_rule_targets_company_idx on public.split_rule_targets (company_id);

create trigger split_rule_targets_touch
  before update on public.split_rule_targets
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- overhead and review queue
-- ---------------------------------------------------------------------------

create table public.overhead (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  transaction_id uuid not null unique references public.transactions (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index overhead_company_idx on public.overhead (company_id);

create trigger overhead_touch
  before update on public.overhead
  for each row execute function public.touch_updated_at();

create table public.review_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  transaction_id uuid references public.transactions (id) on delete cascade,
  status public.review_status not null default 'open',
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index review_queue_open_idx
  on public.review_queue (company_id)
  where status = 'open';

create trigger review_queue_touch
  before update on public.review_queue
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- sumit_connections: envelope ciphertext, no plaintext key
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
  'Envelope-encrypted SUMIT credentials. key_ciphertext is the API key under a DEK; dek_ciphertext is the DEK under SUMIT_KEK. No plaintext key is stored.';

create trigger sumit_connections_touch
  before update on public.sumit_connections
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- audit log (append-only for the owner)
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

-- ---------------------------------------------------------------------------
-- Home round-trip used by scripts/latency.ts
-- ---------------------------------------------------------------------------

create or replace function public.get_home()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'company_id', c.id,
        'name', c.name,
        'net_profit_agorot', 0
      )
      from public.companies c
      where c.owner_id = auth.uid()
      limit 1
    ),
    jsonb_build_object('company_id', null, 'net_profit_agorot', 0)
  );
$$;

grant execute on function public.get_home() to authenticated;

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
  using (public.is_company_owner(company_id))
  with check (public.is_company_owner(company_id));

create policy projects_owner on public.projects
  for all to authenticated
  using (public.is_company_owner(company_id))
  with check (public.is_company_owner(company_id));

create policy customers_owner on public.customers
  for all to authenticated
  using (public.is_company_owner(company_id))
  with check (public.is_company_owner(company_id));

create policy suppliers_owner on public.suppliers
  for all to authenticated
  using (public.is_company_owner(company_id))
  with check (public.is_company_owner(company_id));

create policy transactions_owner on public.transactions
  for all to authenticated
  using (public.is_company_owner(company_id))
  with check (public.is_company_owner(company_id));

create policy allocations_owner on public.allocations
  for all to authenticated
  using (public.is_company_owner(company_id))
  with check (public.is_company_owner(company_id));

create policy split_rules_owner on public.split_rules
  for all to authenticated
  using (public.is_company_owner(company_id))
  with check (public.is_company_owner(company_id));

create policy split_rule_targets_owner on public.split_rule_targets
  for all to authenticated
  using (public.is_company_owner(company_id))
  with check (public.is_company_owner(company_id));

create policy overhead_owner on public.overhead
  for all to authenticated
  using (public.is_company_owner(company_id))
  with check (public.is_company_owner(company_id));

create policy review_queue_owner on public.review_queue
  for all to authenticated
  using (public.is_company_owner(company_id))
  with check (public.is_company_owner(company_id));

create policy sumit_connections_owner on public.sumit_connections
  for all to authenticated
  using (public.is_company_owner(company_id))
  with check (public.is_company_owner(company_id));

create policy audit_log_select on public.audit_log
  for select to authenticated
  using (public.is_company_owner(company_id));

create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (public.is_company_owner(company_id) and actor_id = (select auth.uid()));

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
  public.review_queue,
  public.sumit_connections
to authenticated;

grant select, insert on public.audit_log to authenticated;
grant usage, select on sequence public.audit_log_id_seq to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on function public.get_home() to service_role;
