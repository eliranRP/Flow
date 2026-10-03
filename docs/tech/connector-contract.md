# Connector contract

L0 names. Later layers implement them. L0 does not migrate and does not change behaviour.

Decisions: [0085](../decisions/0085-connector-engine.md), [0086](../decisions/0086-mercury.md), [0087](../decisions/0087-multi-currency.md). UI copy: [connector UI states](connector-ui-states.md).

Types: `supabase/functions/_shared/connectors/types.ts`. Mercury GET types: `supabase/functions/_shared/connectors/mercury/api.d.ts`, rebuilt with `node scripts/mercury-openapi.mjs` (`openapi-typescript` 7.13.0).

## Port

A provider module implements `ConnectorPort`. The core calls the registry. It does not branch on the provider name.

| Method | Result |
| --- | --- |
| `validate(secret)` | `{ ok: true, accounts: { id, label }[] }` or `{ ok: false, error: "auth_error" }` |
| `fetchSince({ cursor, importFrom, lookbackDays })` | `{ lines, removedIds, nextCursor, complete }` |
| `normalize(raw)` | `{ ok: true, line: CanonicalLine }` or `{ ok: false, skip }` |
| `classifyError(error)` | `auth` \| `rejected` \| `rate_limited` \| `transient` |
| `redact(value)` | The same shape with secrets, account numbers, routing numbers, emails, and attachment URLs removed |

`accounts` is id and label only. `importFrom` null means מההתחלה (from the start). `complete` is true only when the page is a full listing. `skip` is `own_account_transfer`, `internal_transfer`, `treasury_transfer`, or `not_a_line`.

`normalize` is pure. It does not read the clock, the network, or the database.

## Capabilities

| Provider | listing | removal | currencies | hasPending |
| --- | --- | --- | --- | --- |
| SUMIT | `full` | `sweep` | `ILS` | false |
| Mercury | `window` | `status` | `USD` | true |

`listing: full` means a finished fetch is the whole set the owner asked for. `listing: window` means a page can omit a line that still exists. Mercury uses a lookback because `postedAt` lags `createdAt` (13 of 45 posted lines on 2026-10-03). The adapter owns `MERCURY_POSTED_LOOKBACK_DAYS`. The engine passes `lookbackDays` through and does not pick the integer.

`removal: sweep` deletes only when `complete` is true, and only rows with `doc_date >= import_from` (every row when `import_from` is null). An empty sweep sets `sync_sweep_empty` and deletes nothing. A sweep that would remove more than half the listed rows sets `sync_sweep_suspicious` and deletes nothing. `removal: status` voids only ids in `removedIds`. Absence does not delete.

## Canonical line

`CanonicalLine` in `types.ts`, checked by `canonicalLineSchema`.

| Field | Rule |
| --- | --- |
| `source` | `sumit` or `mercury` |
| `external_id` | Provider id, nonempty text |
| `direction` | `income` or `expense` |
| `status` | `pending`, `posted`, or `void` |
| `currency` | Three uppercase letters |
| `amount_original` | Nonnegative integer, minor units of `currency` |
| `doc_date` | `YYYY-MM-DD` |
| `cash_date` | `YYYY-MM-DD` or null. Pending may be null |
| `counterparty` | `{ name, external_id }`, each text or null |
| `description` | Text, may be empty |
| `vat` | `{ amount, status }`. `amount` is a nonnegative integer. `status` is `source`, `derived`, `assumed`, or `unknown` |
| `project_hint` | Text or null. SUMIT budget section |
| `category_hint` | Text or null |
| `linked_external_id` | Text or null |
| `provider_meta` | Object. Opaque to the core |

The engine writes ILS `amount_gross` and `amount_net` in agorot. The adapter does not.

`provider_meta` must not contain an account number, a routing number, an email, an attachment URL, or `dashboardLink`.

## Status map

SUMIT documents are `posted`. SUMIT has no pending.

Mercury, observed and documented 2026-10-03:

| Provider status | Canonical | Books |
| --- | --- | --- |
| `sent` | `posted` | Counts once posted |
| `pending` | `pending` | In לאישור, tagged ממתין. No P&L and no total |
| `cancelled`, `failed`, `reversed`, `blocked` | `void` | Leave the books (`removed_at` set) |

Seen that day: `sent` 73, `failed` 10. No `pending` row. A synthetic pending fixture arrives with the adapter, not in this layer.

`amount` on the wire is a JSON float in dollars, at most two decimals. Negative is out, positive is in. Card lines are negative. `merchant.amount` is integer cents. Parse from a decimal string. Do not use float math. `amount_original` stores the absolute cents.

## Mercury shapes

Allowlist, GET only (`MERCURY_GET_ALLOWLIST`):

| Path | Role |
| --- | --- |
| `/accounts` | Checking and savings. Response `{ accounts, page }`. `kind` is checking or savings. `name` is the label |
| `/credit` | Card accounts. Response `{ accounts: [{ id, status, … }] }`. Not in the three generated pages |
| `/transactions` | The listing. Query `limit`, `order`, `start_after`. Response `page.nextPage`. Includes card lines |
| `/transaction/{transactionId}` | One line |

Do not list `/account/{id}/transactions`. That payload is `{ total, transactions }` and it skips the credit account.

`/accounts` and the routing objects in the generated types carry account and routing numbers. Do not store them. Do not store emails or attachment URLs. `details` is routing info or a card email. `attachments[].url` is an attachment URL.

Own-account transfers hide in `kind: "other"`. Card autopay is a minus leg on checking and a plus leg on the card (`IO AUTOPAY` / `IO PAYMENT`). Skip when `counterpartyId` is in the id set from `/accounts` and `/credit`, or when `kind` is `internalTransfer` or `treasuryTransfer`. Any other line is imported, including income. There is no direction switch.

Other kinds seen or documented: `creditCardTransaction`, `outgoingPayment`, `checkDeposit`, `incomingDomesticWire`, `incomingInternationalWire`, `externalTransfer`, `creditCardCredit`, `debitCardTransaction`, fee and reversal kinds, `other`. The generated `TransactionKind` union is the full set.

## Shared engine and the adapter

| Shared | Adapter |
| --- | --- |
| Registry lookup | Auth header and token check |
| Daily job and drain job | HTTP, paging, lookback |
| Upsert, owned fields, cursor | `normalize` |
| Sweep or status removal, from capabilities | Allowlist and `redact` |
| Review routing via `private.is_connector_source()` | Status map and skip rules |
| FX reprice | Nothing about BOI |
| Refresh floors, 60 seconds and 6 hours | `classifyError` |

The cursor write sits in the same transaction as the line upsert. A failed upsert does not advance it.

Owned on update: `user_assigned`, `project_assigned`, `category_assigned`. When `user_assigned` or `project_assigned` is set, keep `project_id` and `pnl_role`. When `user_assigned` or `category_assigned` is set, keep `category_id`. Do not change `idempotency_key` on update. Insert sets it. SUMIT keeps the document's existing key. A line with no document key uses `source || ':' || external_id`.

Conflict target for the engine is `(company_id, source, external_id)`. The existing unique `(company_id, idempotency_key)` stays. Pending becomes posted on that same row.

Allocations on an assigned line are recomputed from `share_bp` when `amount_net` changes, including a reprice. The remainder still lands on the first project, as today's SUMIT update does.

## Registry

Server: `ConnectorRegistry`, a `Record` of `sumit` and `mercury`. Each value is `{ adapter, kekEnv, schedule }`. `kekEnv` is `SUMIT_KEK` or `MERCURY_KEK` (the env name, never the secret). `schedule.daily` is `0 3 * * *`. `schedule.drain` is `*/5 * * * *`.

Client: `ConnectorClientDescriptor` with `provider`, `nameHe`, `icon`, and `copy` for every `CONNECTOR_COPY_KEYS` entry. Hebrew values are in [connector UI states](connector-ui-states.md).

## SQL sketch

L1 applies this. Grants are explicit. New definer functions set `search_path = ''`. `private.current_company_id()` is the company predicate. Adding `mercury` to `txn_source` must not use the new value in that same transaction.

```sql
create type public.connector_provider as enum ('sumit', 'mercury');
alter type public.txn_source add value 'mercury';
create type public.line_status as enum ('pending', 'posted', 'void');

alter table public.transactions
  add column line_status public.line_status not null default 'posted',
  add column currency text not null default 'ILS',
  add column amount_original bigint;

-- Backfill amount_original from amount_gross for current ILS rows, then
-- alter column amount_original set not null.
-- check (currency ~ '^[A-Z]{3}$' and amount_original >= 0).

create table public.connections (
  company_id uuid not null references public.companies (id) on delete cascade,
  provider public.connector_provider not null,
  key_ciphertext bytea not null,
  key_nonce bytea not null,
  dek_ciphertext bytea not null,
  dek_nonce bytea not null,
  kek_ref text not null,
  kek_version text not null,
  envelope_version text not null,
  account_labels jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  import_from date,
  sync_cursor text,
  last_sync_at timestamptz,
  last_error text,
  next_attempt_at timestamptz,
  reject_attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, provider),
  constraint connections_kek_ref_name check (kek_ref in ('SUMIT_KEK', 'MERCURY_KEK')),
  constraint connections_ciphertext_present check (
    octet_length(key_ciphertext) > 0
    and octet_length(key_nonce) > 0
    and octet_length(dek_ciphertext) > 0
    and octet_length(dek_nonce) > 0
    and length(kek_version) > 0
    and length(envelope_version) > 0
  )
);

alter table public.connections enable row level security;

create policy connections_owner on public.connections
  for select to authenticated
  using (company_id = (select private.current_company_id()));

revoke all on public.connections from public, anon, authenticated;
grant select (
  company_id, provider, last_sync_at, last_error, next_attempt_at, import_from, account_labels
) on public.connections to authenticated;

create view public.connection_status
with (security_invoker = true) as
select
  company_id,
  provider,
  true as connected,
  last_sync_at,
  last_error,
  next_attempt_at,
  import_from,
  account_labels
from public.connections;

revoke all on public.connection_status from public, anon;
grant select on public.connection_status to authenticated, service_role;

create table public.connector_refresh_requests (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  provider public.connector_provider not null,
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  forced boolean not null default false
);

alter table public.connector_refresh_requests enable row level security;
revoke all on public.connector_refresh_requests from public, anon, authenticated;

create table public.party_external_refs (
  company_id uuid not null references public.companies (id) on delete cascade,
  provider public.connector_provider not null,
  kind text not null,
  external_id text not null,
  party_id uuid not null,
  primary key (company_id, provider, kind, external_id),
  constraint party_external_refs_kind check (kind in ('supplier', 'customer', 'counterparty'))
);

alter table public.party_external_refs enable row level security;

create policy party_external_refs_owner on public.party_external_refs
  for select to authenticated
  using (company_id = (select private.current_company_id()));

revoke all on public.party_external_refs from public, anon, authenticated;
grant select on public.party_external_refs to authenticated;

create function private.is_connector_source(p_source public.txn_source)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select p_source::text in ('sumit', 'mercury');
$$;

revoke all on function private.is_connector_source(public.txn_source) from public, anon;
grant execute on function private.is_connector_source(public.txn_source) to authenticated, service_role;

create function public.upsert_connector_lines(
  p_company uuid,
  p_provider public.connector_provider,
  p_lines jsonb
) returns integer
language plpgsql
security definer
set search_path = '';

revoke all on function public.upsert_connector_lines(uuid, public.connector_provider, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_connector_lines(uuid, public.connector_provider, jsonb) to service_role;
```

`p_lines` is `{ "lines": [ CanonicalLine plus the SUMIT idempotency key when the wrapper has one ], "removed_ids": [ text ], "complete": boolean }`. A line whose `source` is not `p_provider` is rejected. Service role only, and the body checks `auth.role()`.

`account_labels` is a JSON array of `{ id, label }`. The adapter must not put an account number or a routing number in the label. `kek_ref` stores the env name only. `settings` for a copied SUMIT row is `{ "sumit_company_id": <bigint> }`.

Copy `sumit_connections` into `connections` with `provider = 'sumit'`, `kek_ref = 'SUMIT_KEK'`, ciphertext and nonces and `kek_version` and `envelope_version` unchanged, `import_from` null, `sync_cursor` null, and the existing `last_sync_at`, `last_error`, `next_attempt_at`, `reject_attempts`. Copy `sumit_refresh_requests` into `connector_refresh_requests` with `provider = 'sumit'` and `forced = false`. Copy `customers.sumit_external_id` and `suppliers.sumit_external_id` into `party_external_refs` as text, kinds `customer` and `supplier`, provider `sumit`.

No authenticated policy can read ciphertext. The status view does not select it.

### Wrappers that keep today's signature

| Function | Returns | Grant |
| --- | --- | --- |
| `public.upsert_sumit_documents(p_company uuid, p_docs jsonb)` | `integer` | `service_role` |
| `public.sumit_status()` | `jsonb` | `authenticated`, `service_role` |
| `public.disconnect_sumit()` | `void` | `authenticated`, `service_role` |
| `public.replace_sumit_connection(p_company uuid, p_sumit_company_id bigint, p_key_ciphertext text, p_key_nonce text, p_dek_ciphertext text, p_dek_nonce text, p_kek_version text, p_envelope_version text, p_validated boolean)` | `void` | `service_role` |
| `public.list_due_refresh_requests(p_limit integer)` | `table (id bigint, company_id uuid)` | `service_role` |
| `public.note_sumit_rejection(p_company uuid, p_code text)` | `jsonb` | `service_role` |
| `public.note_sync_failure(p_company uuid, p_code text)` | `timestamptz` | `service_role` |
| `public.stamp_sumit_sync(p_company uuid)` | `void` | `service_role` |

Each of those is revoked from `public`, `anon`, and, except `sumit_status` and `disconnect_sumit`, from `authenticated`. The wrapper reads and writes `connections` where `provider = 'sumit'`. `upsert_sumit_documents` maps each document to a canonical line and calls `upsert_connector_lines`. `list_due_refresh_requests` returns only SUMIT rows, so the current edge function keeps working.

New, service role only, same revoke pattern:

| Function | Returns |
| --- | --- |
| `public.list_due_connector_refreshes(p_limit integer)` | `table (id bigint, company_id uuid, provider public.connector_provider)` |
| `public.note_connector_failure(p_company uuid, p_provider public.connector_provider, p_code text)` | `timestamptz` |
| `public.stamp_connector_sync(p_company uuid, p_provider public.connector_provider)` | `void` |
| `private.schedule_connector_jobs()` | `void` |

`private.schedule_connector_jobs` is revoked from `public`, `anon`, and `authenticated`, and granted to `service_role`. It unschedules `flow-sumit-daily` and `flow-sumit-drain`, then schedules one daily insert into `connector_refresh_requests` for every connection (`0 3 * * *`) and one drain (`*/5 * * * *`). The drain reads Vault `flow_sync_url` and does not fall back to Kong. The secret value is not written into the command. The URL keeps targeting `/sumit-sync` until the alias exists.

### Drop list

| Dropped | Replacement |
| --- | --- |
| `public.sumit_connections` | `public.connections` |
| `public.sumit_connection_status` | `public.connection_status` and `sumit_status()` |
| `public.sumit_refresh_requests` | `public.connector_refresh_requests` |
| `private.schedule_sumit_daily()` | `private.schedule_connector_jobs()` |
| `private.schedule_drain()` | `private.schedule_connector_jobs()` |
| cron `flow-sumit-daily`, `flow-sumit-drain` | the two jobs that function schedules |
| `customers.sumit_external_id`, `suppliers.sumit_external_id` and their unique indexes | `public.party_external_refs` |

`sumit_status`, `disconnect_sumit`, `replace_sumit_connection`, `upsert_sumit_documents`, `list_due_refresh_requests`, `note_sumit_rejection`, `note_sync_failure`, and `stamp_sumit_sync` are not dropped.

### Three filter swaps

Replace the literal `source = 'sumit'` with `private.is_connector_source(t.source)` in:

1. `public.sync_review_queue(p_company_id uuid) returns integer`. Grant stays `service_role`.
2. `public.list_review() returns jsonb`, the `auto_approved_today` predicate. Grant stays `authenticated`, `service_role`.
3. `public.list_auto_assigned_today() returns jsonb`. Grant stays `authenticated`, `service_role`.

Sweep and company-id retirement are not these three. They run inside `upsert_connector_lines` and the SUMIT wrapper, scoped by `p_provider`.

`list_review` items gain `line_status` so the client can show ממתין. The function signature stays `() returns jsonb`.

### Pending is excluded from totals

These keep their signatures and gain `line_status <> 'pending'` on every sum. Existing `removed_at` filters stay. Default `posted` means current rows still count.

| Function | Grant |
| --- | --- |
| `public.company_pnl(p_company_id uuid, p_from date, p_to date, p_basis text) returns jsonb` | `authenticated`, `service_role` |
| `public.get_dashboard(p_from date, p_to date, p_basis text) returns jsonb` | `authenticated`, `service_role` |
| `public.get_home() returns jsonb` | `authenticated`, `service_role` |
| `public.get_project(p_id uuid) returns jsonb` | `authenticated`, `service_role` |
| `public.list_project_category(p_project uuid, p_category uuid, p_offset integer, p_limit integer) returns jsonb` | `authenticated`, `service_role` |
| `public.project_waiting(p_project uuid) returns jsonb` | `authenticated`, `service_role` |

`list_auto_assigned_today` also excludes pending, so a pending line is not "filed".

`list_review` shows pending. `get_transaction(p_id uuid) returns jsonb` still returns a line opened from review, including pending. `list_unpaid() returns jsonb` stays document-based and does not gain Mercury cash lines.

### Off-P&L loan payments

L1a adds the column. This layer does not migrate.

```sql
alter table public.categories
  add column excluded_from_pnl boolean not null default false;
```

`private.seed_default_categories` also inserts an expense, `תשלומי הלוואה` (loan payments), `is_default` true, `excluded_from_pnl` true, `sort_order` 8. The same migration inserts that row for companies that already exist.

A line in that category stays in the books. It is a cash movement, so לאישור (`list_review`) and `get_transaction` still show it. There is no separate cash-flow total. The P&L sums skip it, including while the review row is still open. The upsert may set the category from `category_hint` and must leave `category_assigned` false, so the owner can change it. Changing it to a normal category puts the line back into P&L.

The Mercury adapter sets `category_hint` to `תשלומי הלוואה` when the counterparty name is NEWREZ, Lakeview, or Servease, compared case-insensitively. Those three are the interim list. The core does not match lender names.

These sums gain `not exists (select 1 from public.categories c where c.id = t.category_id and c.excluded_from_pnl)`:

| Function | What it sums |
| --- | --- |
| `public.company_pnl(uuid, date, date, text)` | Every P&L total. `get_dashboard` returns this payload |
| `public.get_home()` | `net_profit_agorot` |
| `public.get_project(uuid)` | `income_agorot`, `direct_agorot`, `shared_agorot`, and the category sums |
| `public.list_project_category(uuid, uuid, integer, integer)` | `total_agorot`, through `private.project_category_entries` |

`project_waiting` is a list, not a profit figure. It is not one of these sums.

### Mercury cashback

A Mercury credit whose description is `IO Cashback` gets `category_hint` `הכנסה אחרת` (other income). That category is already seeded and is not excluded from P&L. VAT stays 0. The adapter sets the hint. L2b.

## Future decision record (not numbered, not accepted)

**Loans and amortization.** This is the feature after the connector stack. It is not part of L0–L3. A loan is set up once: lender match, balance, rate, start, term, and escrow, through a form or MCP. Flow builds the schedule and splits each matched payment into interest (P&L expense `ריבית משכנתא`), escrow (taxes and insurance), and principal (off-P&L, and the principal reduces the balance), with a correction each month. Until that exists, the whole payment sits in `תשלומי הלוואה`. The canonical line stays one bank line with one `external_id` and one `amount_original`. A later three-way split attaches three category amounts to that same line. It does not create three provider lines, and it does not change the allocations' project shares. This stack does not build the schedule, the form, or the split.

## FX and reprice

L1b. Not this layer.

```sql
create table public.fx_rates (
  rate_date date not null,
  currency text not null,
  ils_per_unit numeric not null,
  source text not null,
  fetched_at timestamptz not null default now(),
  primary key (rate_date, currency),
  constraint fx_rates_currency check (currency = 'USD'),
  constraint fx_rates_positive check (ils_per_unit > 0)
);

alter table public.fx_rates enable row level security;
create policy fx_rates_read on public.fx_rates for select to authenticated using (true);
revoke all on public.fx_rates from public, anon, authenticated;
grant select on public.fx_rates to authenticated;

alter table public.companies
  add column display_currency text not null default 'ILS'
    constraint companies_display_currency check (display_currency in ('ILS', 'USD'));

create function public.set_display_currency(p_currency text)
returns void
language plpgsql
security definer
set search_path = '';

revoke all on function public.set_display_currency(text) from public, anon;
grant execute on function public.set_display_currency(text) to authenticated, service_role;

create function public.reprice_usd_lines(p_company uuid, p_rate numeric)
returns integer
language plpgsql
security definer
set search_path = '';

revoke all on function public.reprice_usd_lines(uuid, numeric) from public, anon, authenticated;
grant execute on function public.reprice_usd_lines(uuid, numeric) to service_role;
```

`ils_per_unit` is shekels per one US dollar. `amount_original` is cents. Agorot = half-even(`amount_original * ils_per_unit`). One dollar is 100 cents and one shekel is 100 agorot, so the factors cancel. Mercury VAT is 0, so `amount_net = amount_gross`.

`set_display_currency` accepts `ILS` or `USD` and writes the session company. Anything else is rejected.

`reprice_usd_lines` updates USD rows for that company from `p_rate`, recomputes allocations from `share_bp`, and returns the row count. The USD fingerprint uses `amount_original`, not the new agorot. If today's `fx_rates` row is missing, the job does not call reprice.

`fx.ts` (L2) tries the Bank of Israel JSON, then SDMX, then the cached row.

## Error codes and copy keys

| Class | `last_error` | SUMIT wrapper code, unchanged | Copy key |
| --- | --- | --- | --- |
| `auth` | `auth` | `sumit_auth` | `status.reconnect` |
| `rejected` | `rejected` | `sumit_rejected` | reconnect sheet |
| `rate_limited` | `rate_limited` | the current rate-limit path | `refresh.failed` |
| `transient` | `transient` | `sync_failed` | `refresh.failed` |
| sweep empty | `sync_sweep_empty` | `sync_sweep_empty` | `refresh.failed` |
| sweep suspicious | `sync_sweep_suspicious` | `sync_sweep_suspicious` | `refresh.failed` |
| page cap | `sync_page_cap` | `sync_page_cap` | `refresh.failed` |

`note_sync_failure` still accepts only `sync_failed` and `sync_page_cap`. `note_connector_failure` accepts the classes above. Hebrew strings are in [connector UI states](connector-ui-states.md).

Logs call `redact` before printing a provider payload. A log line does not contain a token, ciphertext, a nonce, an account number, or a routing number.

## Add connector number 3

1. Add the enum value on `connector_provider` and on `txn_source` in the open migration. Do not use a new `txn_source` value in that same transaction.
2. Add the id to `PROVIDERS`, a capabilities constant, and a `KEK_ENVS` entry.
3. Implement `ConnectorPort` under `supabase/functions/_shared/connectors/<provider>/`.
4. Register it in the registry map. Do not add a provider test in the engine.
5. Add a client descriptor and the Hebrew copy.
6. Ship a GET allowlist, fixtures, and `redact`. No token in the fixtures.
7. Extend `private.is_connector_source` for the new `txn_source` value.
8. If the client bundle must not contain the host or the key env name, add that needle beside the existing bundle scan. `MERCURY_KEK`, `api.mercury.com`, and `secret-token:` are the Mercury needles for that later scan. This layer does not change the scanner, and those strings are not in the client.

## Layers

| Layer | What lands |
| --- | --- |
| L0 | This contract, decisions 0085–0087, types, Mercury GET types |
| L1a | Tables, SUMIT move, upsert, three filters, jobs, drop `sumit_*`, pending excluded from totals, `categories.excluded_from_pnl` |
| L1b | `fx_rates`, `display_currency`, `set_display_currency`, `reprice_usd_lines` |
| L2a | Registry, engine, `connector-sync` / `connector-connect`, `fx.ts`, aliases |
| L2b | Mercury adapter and SUMIT `normalize` over the current mapper |
| L3a | ₪/$ toggle |
| L3b | Connection card, range, ממתין |

The SUMIT pgTAP suites (`owner_ledger`, `round4`, `round5`, `review_field_save`, `mcp_cycle3a`, `sumit_*`), `ledger-parity.test.ts`, and the demo-data to expected-pnl golden stay green or move one for one. Each new id-taking RPC gets a cross-tenant negative.
