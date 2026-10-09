# Connector contract

L0 names. Later layers implement them. L0 does not migrate and does not change behaviour.

Decisions: [0085](../decisions/0085-connector-engine.md), [0086](../decisions/0086-mercury.md), [0087](../decisions/0087-multi-currency.md). UI copy: [connector UI states](connector-ui-states.md).

Types: `supabase/functions/_shared/connectors/types.ts`. Provider lists, KEK env names, capability constants, and Mercury skip reasons are in `connectors/sumit/`, `connectors/mercury/`, and `registry.ts`. They are not in `types.ts`. Mercury GET types: `connectors/mercury/api.d.ts`, rebuilt with `node scripts/mercury-openapi.mjs` (`openapi-typescript` 7.13.0). `GET /credit` is `connectors/mercury/credit.ts` (observed, not generated). Zod is `npm:zod@4.6.5` with `connectors/deno.json` frozen lock, the same pin as `flow-mcp`.

Round 2 names below are the ones later layers build on.

## Port

A provider module implements `ConnectorPort`. The core calls the registry. It does not branch on the provider name. The registry holds a factory, not one stateful adapter. A sync calls `open(secret)` for that company and passes the session into every method. The secret stays inside the session. The core does not read it.

| Method | Result |
| --- | --- |
| `open(secret)` | `ConnectorSession` for that company |
| `validate(session)` | `{ ok: true, accounts: { id, label }[] }` or `{ ok: false, class, retry_after }` |
| `fetchSince(session, { cursor, importFrom, lookbackDays })` | `{ lines, removedIds, nextCursor, complete }` |
| `normalize(raw, ctx)` | `{ ok: true, line: CanonicalLine }` or `{ ok: false, skip }` |
| `classifyError(error)` | `{ class, retry_after }` |
| `redact(value)` | The same shape with secrets and routing data removed |

`class` is `auth`, `rejected`, `rate_limited`, or `transient`. `retry_after` is an ISO-8601 timestamp, or null when the class has no wait. `validate` returns that class. It does not return a separate `auth_error` string.

`accounts` is id and label only. `importFrom` null means מההתחלה (from the start). `complete` is true only when the whole fetch has finished, not when one page has finished. `skip` is a provider reason string. Mercury's reasons live in `MERCURY_SKIP_REASONS`.

`normalize` is pure. It does not read the clock, the network, or the database. `ctx` is the only extra input:

| Field | Who fills it |
| --- | --- |
| `ownAccountIds` | Ids from this company's connected accounts, including `GET /credit` and `GET /treasury`. Mercury uses this set to skip a transfer between connected accounts |
| `ownCounterpartyIds` | Owner-set counterparty ids of the owner's own external accounts. Not account numbers. A transfer whose counterparty is in this set is imported, not skipped |
| `vatRateBp` | The company's VAT rate in basis points. SUMIT's `deriveLine` uses it. Mercury ignores it |
| `exemptSupplierNames` | Supplier names that are VAT-exempt. This is the match the ledger uses today (`suppliers.vat_exempt` by name) |
| `exemptSupplierIds` | Supplier external ids that are VAT-exempt, carried alongside the names. A supplier with no external id is exempt by name only |
| `linkedDocuments` | `{ external_id, gross, net, vat_rate_bp }` for SUMIT documents a linked row needs. Amounts are minor units. Mercury passes an empty list |

## Capabilities

The constants live in `connectors/sumit/capabilities.ts` and `connectors/mercury/capabilities.ts`.

| Provider | listing | removal | currencies | hasPending |
| --- | --- | --- | --- | --- |
| SUMIT | `full` | `sweep` | `ILS` | false |
| Mercury | `window` | `status` | `USD` | true |

`listing: full` means a finished fetch is the whole set the owner asked for. `listing: window` means a page can omit a line that still exists. Mercury uses a lookback because `postedAt` lags `createdAt` (13 of 45 posted lines on 2026-10-03). The adapter owns `MERCURY_POSTED_LOOKBACK_DAYS`. The engine passes `lookbackDays` through and does not pick the integer.

`removal: sweep` runs once, after `complete` is true for the whole multi-page fetch, never page by page. The engine accumulates seen ids across the pages of that fetch and sweeps that set. It deletes only rows with `doc_date >= import_from` (every in-scope row when `import_from` is null). An empty sweep sets `sync_sweep_empty` and deletes nothing. A sweep that would remove more than half the in-scope rows sets `sync_sweep_suspicious` and deletes nothing. `removal: status` voids only ids in `removedIds`. Absence does not delete.

Mercury currency is USD only. SUMIT currency is ILS only. The row check is `source::text <> 'mercury' or currency = 'USD'`, and the same for SUMIT and `ILS`.

## Canonical line

`CanonicalLine` in `types.ts`, checked by `canonicalLineSchema`. The schema is strict: a payload the contract tells the adapter to pass parses, and an extra key fails. `canonicalLineSchema` is not annotated as `ZodType<CanonicalLine>`. `CanonicalLineSchemaMatches` is `Equal<z.infer<typeof canonicalLineSchema>, CanonicalLine>`, and `const schemaMatchesLine: CanonicalLineSchemaMatches = true` fails the build when the inferred schema and the type differ.

| Field | Rule |
| --- | --- |
| `source` | Provider id. The closed list is `PROVIDERS` in `registry.ts`, not in `types.ts` |
| `external_id` | Required, 1–128 characters. Not null |
| `direction` | `income` or `expense` |
| `line_status` | `pending`, `posted`, or `void`. The column and the JSON key use this name |
| `doc_kind` | `invoice`, `receipt`, `invoice_receipt`, `credit`, `expense`, or `other` |
| `pnl_role` | `project`, `shared`, `overhead`, or null |
| `currency` | Three uppercase letters |
| `amount_original` | Nonnegative integer. Gross minor units of `currency`, never a net amount |
| `amount_negated` | Boolean. True when the stored `amount_gross` is `-amount_original`. The engine does not infer the sign from `direction` or `doc_kind` |
| `doc_date` | A real `YYYY-MM-DD`. `2026-13-45` and a non-leap 29 February fail |
| `cash_date` | A real date, or null. Pending may be null |
| `source_account_id` | Provider account id, or null. Never an account number or a routing number |
| `counterparty` | `{ name, external_id, kind }`. When `name` is null, `kind` is null. When `name` is present, `kind` is `supplier` or `customer`. `external_id` may be null. Name is at most 300 characters |
| `description` | Text, at most 2000 characters, may be empty |
| `vat` | `{ amount, status }`. `amount` is a nonnegative integer. `status` is `source`, `derived`, `assumed`, or `unknown` |
| `project_hint` | Null, or `{ external_id, name }`, each text or null. SUMIT matches the section id or the name |
| `category_hint` | Text or null, at most 200 characters |
| `linked_external_id` | Text or null |
| `provider_meta` | `{ kind? }`. See redaction |

The engine writes signed `amount_gross` and `amount_net` in the line's own currency. A SUMIT line is ILS agorot. A Mercury line is USD cents. Import does not convert that line to shekels. The adapter does not either. Import writes `fx_rate` and `fx_rate_date` only when `fx_policy` is `historical` and the line is USD, from the newest `fx_rates` row on or before `doc_date`, as specified under FX and reprice. Under `original` and `today` those columns stay null. An ILS row is never stamped. The sign is `amount_negated`, not a rebuild from `direction` and `doc_kind`. A positive-valued expense document and a negative receipt both occur on SUMIT. Aggregates do not add that signed `amount_net` across currencies. Each total sums `private.to_display_minor`, specified under Display conversion.

```text
amount_gross = amount_negated ? -amount_original : amount_original
vat_amount   = amount_negated ? -vat.amount : vat.amount
amount_net   = amount_gross - vat_amount
```

`amount_gross = amount_net + vat_amount` stays true. An ordinary expense has `amount_negated` true. An ordinary receipt has it false. A SUMIT expense whose gross is already positive has it false. A negative receipt has it true.

`createdAt` and `postedAt` are instants. The adapter maps each to the calendar date in `Asia/Jerusalem` (`jerusalemDate` in `connectors/mercury/dates.ts`). That date is `doc_date` or `cash_date`. A UTC instant after 21:00 in summer is the next Jerusalem date.

Mercury ids are assumed stable from pending to posted. L2b verifies that with a fixture. A posting that changes the amount updates the same row. It does not insert a second line.

A card refund or reversal (`creditCardCredit`, or a reversal kind) stays `direction: expense` and `doc_kind: credit`. `category_hint` is the original spend's category when the adapter knows it. `amount_negated` is false, so `amount_gross` stays positive and the category total falls. It is not income.

### Idempotency

`external_id` is required. The engine sets `idempotency_key` to `source || ':' || external_id` on insert and never changes it. For SUMIT, `external_id` is the document id, so the key is `sumit:` || id, the same string `sumit-sync` writes today (`sumit:${id}`) and the same key `transactions_external_uidx` already enforces as `(company_id, source, external_id)`. The two unique keys are one invariant, not two schemes. The SUMIT wrapper does not pass a different key.

Conflict target is `(company_id, source, external_id)`.

Owned on update: `user_assigned`, `project_assigned`, `category_assigned`. When `user_assigned` or `project_assigned` is set, keep `project_id` and `pnl_role`. When `user_assigned` or `category_assigned` is set, keep `category_id`. A pending line may be assigned and approved. Those flags and ids stay when the same `external_id` posts. The line stays out of totals until `line_status` is `posted`.

Allocations on an assigned line are stored in the line's currency, the same minor units as `amount_net`. They are recomputed from `share_bp` when `amount_net` changes, including a posting that changes the amount. The remainder still lands on the first project, as today's SUMIT update does. A display conversion does not rewrite `amount_net` or `allocations.amount_net`. A read of an allocation amount goes through `private.to_display_minor` with that line's currency, date, and stored pair.

## Status map

SUMIT documents are `posted`. SUMIT has no pending.

Mercury, observed and documented 2026-10-03:

| Provider status | Canonical | Books |
| --- | --- | --- |
| `sent` | `posted` | Counts once posted |
| `pending` | `pending` | In לאישור, tagged ממתין. Assignable. No total until posted |
| `cancelled`, `failed`, `reversed`, `blocked` | `void` | Leave the books (`removed_at` set) |

A first-seen failed, cancelled, reversed, or blocked line is skipped. It is not inserted. A line that was stored and later becomes one of those is voided.

Seen that day: `sent` 73, `failed` 10. No `pending` row. A synthetic pending fixture arrives with the adapter, not in this layer.

`amount` on the wire is a JSON float in dollars, at most two decimals. Negative is out, positive is in. Card lines are negative. `merchant.amount` is integer cents. Parse from a decimal string. Do not use float math. `amount_original` stores the absolute gross cents.

### Removal

Nothing hard-deletes a transaction. A line leaves the books by `removed_at`. `line_status = 'void'` means the provider said the line is dead, and `removed_at` is set in the same update. A later sync must not clear `removed_at` and must not move `void` back to `posted` or `pending`.

A pending line that disappears from the lookback is re-checked with `GET /transaction/{id}`. If that GET still misses after `MERCURY_PENDING_VOID_DAYS`, the adapter voids it. L2b picks the integer. L0 only names the constant.

When `import_from` moves later, older rows stay. They are not swept and they are not synced further. Widening the range (an earlier date, or null) is allowed and does not delete either.

`connector_skips` records a skip the owner can see: `company_id`, `provider`, `external_id`, `reason`, `skipped_at`. `connector_connection_status` includes `skip_count` for that connection. A transfer between connected accounts is a skip, not a silent drop. A transfer whose counterparty is an own account that is not in `ownAccountIds`, including one whose id is in `ownCounterpartyIds`, is imported, not skipped, with `category_hint` `העברות` (transfers). The hint matches a category of the line's direction: an outflow uses the expense `העברות`, an inflow uses the income `העברות`. Both are `excluded_from_pnl`.

## Mercury shapes

Allowlist, GET only (`MERCURY_GET_ALLOWLIST`). `assertMercuryGet(method, path)` runs before any Mercury fetch. A method other than GET throws `mercury_method`. A path outside the allowlist, a full URL, or a query string throws `mercury_path`. `/transaction/{id}` matches one segment.

| Path | Role |
| --- | --- |
| `/accounts` | Checking and savings. Response `{ accounts, page }`. `kind` is checking or savings. `name` is the label |
| `/credit` | Card accounts. Type `MercuryCreditResponse` in `credit.ts`: `{ accounts: [{ id, status? }] }`. Ids only |
| `/treasury` | Treasury accounts. Response `{ accounts, page }`. Ids only. A failed or unreadable GET rejects `validate`, so the sync does not start. An empty `accounts` array means there is no treasury account. A row with no id rejects validation. The engine rebuilds this set before every sync |
| `/treasury/{treasuryId}/transactions` | Treasury ledger. `interestPosted` and `dividendPosted` import as income `הכנסה אחרת`. Other types are skipped |
| `/transactions` | The listing. Query `limit`, `order`, `start_after`. Response `page.nextPage`. Includes card lines |
| `/transaction/{transactionId}` | One line. Also the re-check for a pending line missing from the lookback |

Do not list `/account/{id}/transactions`. That payload is `{ total, transactions }` and it skips the credit account.

`/accounts` and the routing objects in the generated types carry account and routing numbers. Do not store them.

Own-account transfers hide in `kind: "other"`. Card autopay is a minus leg on checking and a plus leg on the card (`IO AUTOPAY` / `IO PAYMENT`). `ownAccountIds` is every id from `GET /accounts`, `GET /credit`, and `GET /treasury`, rebuilt before every sync. It is not a subset of accounts the owner picked. Skip when `counterpartyId` is in `ctx.ownAccountIds`, or when `kind` is `internalTransfer` or `treasuryTransfer` and the counterparty is in that set. Record the skip. A transfer whose counterparty is outside `ownAccountIds` is the `העברות` line above, including when the id is in `ownCounterpartyIds`. Any other line is imported, including income. There is no direction switch. A 401, a 403, a 404, or a 5xx from `GET /treasury` or from `GET /treasury/{id}/transactions` refuses the sync. An empty `accounts` array is a successful validation and means there is no treasury account. A 403 or a 404 is not treated as that empty list. Treasury interest, dividends, Mercury credits, and fee refunds are income in `הכנסה אחרת`. A negative yield stays negative income: `amount_negated` is true when the signed amount is below zero. A treasury fee is an expense. `manualAmendmentPosted` imports as income when the amount is positive and as an expense when it is negative. `revertTxn` stays skipped, because the payload has no original-transaction id and a yield reversal already has a `*Canceled` type. A cancelled interest or dividend voids the original yield. The void matches one stored or fetched row of the same id; a refetched copy of that row is not a second match. A reinvested dividend is skipped when the dividend itself is imported. Sweeps, treasury deposits, and treasury withdrawals are internal, so a positive treasury deposit is not a second copy of the checking leg. A reversal older than the lookback is voided from a status recheck of at most 50 stored lines per sync, oldest `checked_at` first. A rate limit or a transient error on that recheck keeps the line. A page cap stores the lines already fetched, the next page, and the same start date, and continues on the next run.

Mercury `doc_kind` is not left unset. An inflow, including treasury income, is `direction: income` and `doc_kind: invoice_receipt`: a bank deposit is received income (decision [0097](../decisions/0097-mercury-income-invoice-receipt.md)). An outflow is `direction: expense` and `doc_kind: expense`. A refund or reversal is `direction: expense` and `doc_kind: credit`. An `invoice_receipt` counts as income on both the cash and the invoiced basis. There is no check that the deposit matches a SUMIT invoice, so a Mercury deposit and the SUMIT invoice it pays can both count. That missing match is a known limitation. They count as income.

Other kinds seen or documented: `creditCardTransaction`, `outgoingPayment`, `checkDeposit`, `incomingDomesticWire`, `incomingInternationalWire`, `externalTransfer`, `creditCardCredit`, `debitCardTransaction`, fee and reversal kinds, `other`. The generated `TransactionKind` union is the full set.

`api.d.ts` is type-checked in CI by importing it from `mercury/api_check.ts`, which `deno test` checks with the connector config.

## Redaction

`provider_meta` is stored on `transactions.provider_meta jsonb not null default '{}'`. The keys are `kind` and `providerCategory` (each text or null, at most 64 characters). A kind-only object stays `{kind}`. An empty object stays `{}`. The strict schema rejects `accountNumber`, `routingNumber`, `details`, `dashboardLink`, `note`, `externalMemo`, attachment URLs, and emails.

`redactMercury` drops those keys at any depth and replaces a digit run of 4 or more in free text with `****`. The engine runs it on `description`, `counterparty.name`, and `kind` before insert. A log calls `redact` before printing a provider payload. A log line does not contain a token, ciphertext, a nonce, an account number, or a routing number.

`types_test.ts` parses a line whose `provider_meta` contains an account number and expects a throw, and it redacts a payload that contains account and routing numbers and expects those digits to be absent.

## Shared engine and the adapter

| Shared | Adapter |
| --- | --- |
| Registry lookup and `open(secret)` | Auth header and token check |
| Daily job and drain job | HTTP, paging, lookback, `assertMercuryGet` |
| Upsert, owned fields, cursor, lock | `normalize(raw, ctx)` |
| Sweep or status removal, from capabilities | Allowlist and `redact` |
| Review routing via `private.is_connector_source()` | Status map and skip rules |
| FX reprice | Nothing about BOI |
| Refresh floors, 60 seconds and 6 hours | `classifyError` |

The cursor write sits in the same transaction as the line upsert. A failed upsert does not advance it. A second run cannot roll it back. See the lock below.

## Registry

`CONNECTOR_MODULES` in `registry.ts` is a `Record` of `sumit` and `mercury`. Each value is `{ kek_ref, capabilities, schedule }`. `kek_ref` is the column name and the TypeScript name. The values are `SUMIT_KEK` and `MERCURY_KEK` (the env name, never the secret). `schedule.daily` is `0 3 * * *`. `schedule.drain` is `*/5 * * * *`.

L2 adds `open(secret)` on `ConnectorRegistration`. That function returns a session for one company. The module map is not a live client.

Client: `ConnectorClientDescriptor` with `provider`, `nameHe`, `icon`, and `copy` for every `CONNECTOR_COPY_KEYS` entry. Hebrew values are in [connector UI states](connector-ui-states.md).

## SQL sketch

L1a applies this. Grants are explicit. New definer functions set `search_path = ''` and start with `if coalesce(auth.role(), '') is distinct from '<role>' then raise exception 'forbidden'; end if`. `private.current_company_id()` is the company predicate. Adding `mercury` to `txn_source` must not use the new value in that same transaction. Checks compare `source::text`.

`amount_original` is backfilled with `abs(amount_gross)` because expenses are stored negative. That update runs with `transactions_touch` disabled, so it does not stamp `updated_at`. CLI 2.118.0 runs each statement on its own, so the migration's first statement is `begin` and its last is `commit`. `lock_timeout` is five seconds inside that transaction. The file does not commit in the middle. The checks are ordinary, not `not valid`: a validate in that same transaction would not release the lock any sooner.

```sql
create type public.connector_provider as enum ('sumit', 'mercury');
alter type public.txn_source add value 'mercury';
create type public.line_status as enum ('pending', 'posted', 'void');

begin;
set local lock_timeout = '5s';

alter table public.transactions
  add column line_status public.line_status not null default 'posted',
  add column currency text not null default 'ILS',
  add column amount_original bigint,
  add column fx_rate numeric,
  add column fx_rate_date date,
  add column provider_meta jsonb not null default '{}'::jsonb;

alter table public.transactions disable trigger transactions_touch;
update public.transactions
set amount_original = abs(amount_gross)
where amount_original is null;
alter table public.transactions enable trigger transactions_touch;

alter table public.transactions
  alter column amount_original set not null;

alter table public.transactions
  add constraint transactions_amount_original_nonneg check (amount_original >= 0),
  add constraint transactions_currency_code check (currency ~ '^[A-Z]{3}$'),
  add constraint transactions_fx_pair check (
    (fx_rate is null and fx_rate_date is null)
    or (fx_rate > 0 and fx_rate_date is not null)
  ),
  add constraint transactions_source_currency check (
    (source::text <> 'mercury' or currency = 'USD')
    and (source::text <> 'sumit' or currency = 'ILS')
  );

create table public.connector_connections (
  id uuid not null default gen_random_uuid() unique,
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
  sync_claimed_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  next_attempt_at timestamptz,
  reject_attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, provider),
  constraint connector_connections_kek_ref_name check (kek_ref in ('SUMIT_KEK', 'MERCURY_KEK')),
  constraint connector_connections_ciphertext_present check (
    octet_length(key_ciphertext) > 0
    and octet_length(key_nonce) > 0
    and octet_length(dek_ciphertext) > 0
    and octet_length(dek_nonce) > 0
    and length(kek_version) > 0
    and length(envelope_version) > 0
  )
);
```

The table name is `connector_connections`. There is no table named `connections`.

`sync_claimed_at` is the overlap lock across edge invocations. `claim_connector_refreshes` sets it. `upsert_connector_lines` clears it in the same transaction as the cursor write. A second claim skips a row whose `sync_claimed_at` is less than 15 minutes old. Inside the upsert transaction the engine also takes `pg_advisory_xact_lock(hashtextextended(company_id::text || ':' || provider::text, 0))`. The cursor updates only when `sync_cursor is not distinct from p_expected_prev_cursor`. A mismatch raises `sync_cursor_conflict` and rolls the transaction back, so a forced run and a daily run cannot both commit a cursor.

`account_labels` is a JSON array of `{ id, label }`. The adapter must not put an account number or a routing number in the label. `kek_ref` stores the env name only. `settings` for a copied SUMIT row is `{ "sumit_company_id": <bigint> }`. Authenticated has no grant on `settings` or on ciphertext.

Envelope format `"3"` binds `company_id || '|' || provider` as AES-GCM additional data. Format `"2"` binds the company id only. Format `"1"` has no additional data. `envelope.ts` opens formats 1, 2, and 3. It seals format 3. New Mercury seals use format 3. `sumit-connect` keeps sealing format `"2"` until L2a, and from that deploy it seals `"3"`.

Old SUMIT rows store a null `envelope_version`; some of those stored the format in `kek_version`. The resolved format is `coalesce(envelope_version, case when kek_version = '2' then '2' else '1' end)`. A row that already resolves to `'2'` or `'3'` is copied with its ciphertext bytes unchanged. A row that resolves to `'1'` is resealed before the copy, so the migration stores the resealed bytes, not the format-1 bytes.

`sumit-reseal` ships in L1a. Only `service_role` and the CD job may invoke it. `authenticated` and `anon` have no execute grant. Today `.github/workflows/ci.yml` deploys `flow-mcp` and `jev-tag` after `db push`, and it does not deploy `sumit-sync` or `sumit-connect`. L1a adds a functions-deploy step before `db push` and updates `scripts/ci-cd.test.mjs` to assert that order. The production order is:

1. The read-only preflight (`scripts/cd-preflight.sh`) passes.
2. Deploy `sumit-sync`, `sumit-connect`, and `sumit-reseal` built with that `envelope.ts`. They open format 1 with no additional data, format 2 with the company id, and format 3 with `company_id|provider`. `sumit-connect` still writes format `"2"`. `flow-mcp` and `jev-tag` keep their existing deploy step.
3. Invoke `sumit-reseal`. It selects only SUMIT rows whose resolved format is `'1'`. It does not select `'2'` or `'3'`. Each selected row is one `UPDATE` that matches the ciphertext just read (`key_ciphertext` and `dek_ciphertext` equal to those values) and then writes format 3 with `company_id|sumit` and sets `envelope_version` to `'3'`. A row whose ciphertext changed after the read is not updated. The function is idempotent. A re-run after a partial failure selects only the rows that still resolve to `'1'`.
4. `db push`. The migration raises if any SUMIT row still resolves to `'1'`. A failed reseal stops the push. Format `'2'` and `'3'` ciphertext is copied unchanged.

A rollback stays on a build whose `envelope.ts` opens format 3. A build that opens only format 2 cannot read a resealed row.

`replace_connector_connection` and `replace_sumit_connection` require `p_validated` true. Until L2a they accept `p_envelope_version` `'2'` or `'3'`. They reject `'1'`. L2a is the deploy where `sumit-connect` seals `'3'`, and from that deploy both RPCs require `'3'`.

```sql
alter table public.connector_connections enable row level security;

create policy connector_connections_owner on public.connector_connections
  for select to authenticated
  using (company_id = (select private.current_company_id()));

revoke all on public.connector_connections from public, anon, authenticated;
grant select (
  company_id, provider, last_sync_at, last_error, next_attempt_at, import_from, account_labels
) on public.connector_connections to authenticated;

create view public.connector_connection_status
with (security_invoker = true) as
select
  company_id,
  provider,
  (last_error is distinct from 'auth') as connected,
  last_sync_at,
  last_error,
  next_attempt_at,
  import_from,
  account_labels,
  (
    select count(*)::integer
    from public.connector_skips s
    where s.company_id = connector_connections.company_id
      and s.provider = connector_connections.provider
  ) as skip_count
from public.connector_connections;

revoke all on public.connector_connection_status from public, anon;
grant select on public.connector_connection_status to authenticated, service_role;
```

`connected` is derived from `last_error`. It is not the constant `true`.

```sql
create table public.connector_refresh_requests (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  provider public.connector_provider not null,
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  forced boolean not null default false
);

create unique index connector_refresh_open_uidx
  on public.connector_refresh_requests (company_id, provider)
  where claimed_at is null;

alter table public.connector_refresh_requests enable row level security;
revoke all on public.connector_refresh_requests from public, anon, authenticated;

create table public.connector_skips (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  provider public.connector_provider not null,
  external_id text,
  reason text not null,
  skipped_at timestamptz not null default now()
);

alter table public.connector_skips enable row level security;
create policy connector_skips_owner on public.connector_skips
  for select to authenticated
  using (company_id = (select private.current_company_id()));
revoke all on public.connector_skips from public, anon, authenticated;
grant select on public.connector_skips to authenticated;

create table public.party_external_refs (
  company_id uuid not null references public.companies (id) on delete cascade,
  provider public.connector_provider not null,
  kind text not null,
  external_id text not null,
  supplier_id uuid,
  customer_id uuid,
  primary key (company_id, provider, kind, external_id),
  foreign key (company_id, supplier_id)
    references public.suppliers (company_id, id) on delete cascade,
  foreign key (company_id, customer_id)
    references public.customers (company_id, id) on delete cascade,
  constraint party_external_refs_kind check (
    (kind = 'supplier' and supplier_id is not null and customer_id is null)
    or (kind = 'customer' and customer_id is not null and supplier_id is null)
  )
);
```

The party foreign keys include `company_id`, so a ref cannot point at another company's supplier or customer. `kind` is part of the key, so one SUMIT external id that is both a supplier and a customer is two rows. There is no `party_id` column. Copy `suppliers.sumit_external_id` into a `kind = 'supplier'` row and `customers.sumit_external_id` into a `kind = 'customer'` row, as text external ids, provider `sumit`. Do not drop those columns until `upsert_sumit_documents` no longer writes them.

No authenticated policy can read ciphertext. The status view does not select it.

### Upsert

```sql
create type public.connector_upsert_result as (
  inserted integer,
  updated integer,
  removed integer,
  skipped integer
);

create function public.upsert_connector_lines(
  p_company uuid,
  p_provider public.connector_provider,
  p_lines jsonb,
  p_next_cursor text,
  p_expected_prev_cursor text
) returns public.connector_upsert_result
language plpgsql
security definer
set search_path = '';
```

Service role only. The body checks `auth.role()`. `p_lines` is `{ "lines": [ CanonicalLine, plus nothing else ], "removed_ids": [ text ], "complete": boolean }`. A line whose `source` is not `p_provider` is rejected and counted in `skipped`. `complete` true is the whole fetch. The sweep runs only then, once.

`p_next_cursor` is written only after the lines, in this transaction, and only when `sync_cursor is not distinct from p_expected_prev_cursor`.

`upsert_sumit_documents` still returns `integer`: `inserted + updated`. That is today's `written` count. Its signature and grant stay.

### Connection RPCs

Each is `security definer`, `search_path = ''`, and checks `auth.role()` against the grant. Revoke from `public` and `anon`. Owner calls also require `company_id = private.current_company_id()`.

| Function | Returns | Grant |
| --- | --- | --- |
| `public.replace_connector_connection(p_company uuid, p_provider public.connector_provider, p_key_ciphertext text, p_key_nonce text, p_dek_ciphertext text, p_dek_nonce text, p_kek_version text, p_envelope_version text, p_validated boolean, p_settings jsonb)` | `void` | `service_role` |
| `public.disconnect_connector(p_provider public.connector_provider)` | `void` | `authenticated`, `service_role` |
| `public.request_connector_refresh(p_provider public.connector_provider)` | `timestamptz` | `authenticated`, `service_role` |
| `public.set_import_from(p_provider public.connector_provider, p_from date)` | `void` | `authenticated`, `service_role` |
| `public.note_connector_rejection(p_company uuid, p_provider public.connector_provider, p_code text)` | `jsonb` | `service_role` |
| `public.claim_connector_refreshes(p_limit integer)` | `table (id bigint, company_id uuid, provider public.connector_provider)` | `service_role` |
| `public.claim_connector_refreshes(p_limit integer, p_provider public.connector_provider)` | the same table, only that provider | `service_role` |

`replace_connector_connection` requires `p_validated` true. Until L2a, `p_envelope_version` is `'2'` or `'3'`. `p_settings` for SUMIT is `{ "sumit_company_id": <bigint> }`. A different SUMIT company id keeps today's retirement behaviour, scoped to `provider = 'sumit'`.

`request_connector_refresh` is the owner button. If `last_sync_at` is within 60 seconds, it inserts nothing and returns that timestamp. Otherwise it inserts one open row with `forced` true. The partial unique index `connector_refresh_open_uidx` makes a second open row a no-op. The unforced floor stays 6 hours and is enforced by the drain, not by this RPC.

`set_import_from` accepts null (מההתחלה) or a date that is not after today in Asia/Jerusalem. A later date is allowed. It does not delete rows. See removal.

`note_connector_rejection` accepts `auth` and `rejected` only. `auth` clears `next_attempt_at`. `rejected` increments `reject_attempts` with the existing backoff of 5 minutes, 15 minutes, 1 hour, 6 hours, and 24 hours. The stored `last_error` is `auth` or `rejected`, never `sumit_auth`.

`claim_connector_refreshes` is one statement. It sets `claimed_at` and `sync_claimed_at` on the rows it returns, `for update skip locked`, skipping `next_attempt_at` in the future, `last_error = 'auth'`, and a `sync_claimed_at` younger than 15 minutes. `sumit-sync` keeps its current claim update against the compatibility view until L2a calls this function. Both paths claim by `claimed_at is null`, so a row is claimed once.

Also service role only, same revoke and `auth.role()` check:

| Function | Returns |
| --- | --- |
| `public.list_due_connector_refreshes(p_limit integer)` | `table (id bigint, company_id uuid, provider public.connector_provider)` |
| `public.note_connector_failure(p_company uuid, p_provider public.connector_provider, p_code text)` | `timestamptz` |
| `public.stamp_connector_sync(p_company uuid, p_provider public.connector_provider)` | `void` |
| `private.schedule_connector_jobs()` | `void` |

`private.schedule_connector_jobs` is revoked from `public`, `anon`, and `authenticated`, and granted to `service_role`. It unschedules `flow-sumit-daily` and `flow-sumit-drain`, then schedules `flow-connector-daily` (`0 3 * * *`) and `flow-connector-drain` (`*/5 * * * *`). The drain reads Vault `flow_sync_url` and does not fall back to Kong. The secret value is not written into the command. A SUMIT row is posted to that URL. A Mercury row is posted to Vault `flow_mercury_sync_url` when it is set (FLOW-509, `20261013050000_mercury_sync_atomic.sql`); until then it goes to the same URL with `/sumit-sync` replaced by `/mercury-sync`. `MERCURY_KEK` is an Edge Function env var, the same pattern as `SUMIT_KEK`. It is not a Vault secret. Vault holds `cron_secret`, `flow_sync_url` and the optional `flow_mercury_sync_url` for the drain only.

The daily command text, pinned, including the leading spaces:

```sql
        insert into public.connector_refresh_requests (company_id, provider)
        select c.company_id, c.provider
        from public.connector_connections c
        where not exists (
          select 1 from public.connector_refresh_requests r
          where r.company_id = c.company_id
            and r.provider = c.provider
            and r.claimed_at is null
        );
```

The drain command text, pinned:

```sql
      select net.http_post(
        url := (
          select case p.provider
            when 'mercury' then coalesce(
              (
                select nullif(btrim(m.decrypted_secret), '')
                from vault.decrypted_secrets m
                where m.name = 'flow_mercury_sync_url'
                limit 1
              ),
              replace(decrypted_secret, '/sumit-sync', '/mercury-sync')
            )
            else decrypted_secret
          end
          from vault.decrypted_secrets
          where name = 'flow_sync_url'
          limit 1
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-flow-cron', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'cron_secret'
            limit 1
          )
        ),
        body := '{}'::jsonb
      )
      from (
        select distinct r.provider
        from public.connector_refresh_requests r
        left join public.connector_connections c
          on c.company_id = r.company_id
         and c.provider = r.provider
        where r.claimed_at is null
          and (c.next_attempt_at is null or c.next_attempt_at <= now())
          and c.last_error is distinct from 'auth'
          and r.provider in ('sumit', 'mercury')
      ) p;
```

L1a updates `scripts/check-sumit-cron.sql`, `scripts/check-sumit-cron.sh`, and `supabase/tests/database/sumit_daily_schedule.test.sql` in that same migration. `cd-push.sh` line 26 runs the check and still exits 2 when the daily job is wrong. Exit codes stay 2 for the daily job and 3 for the drain. The phase 1 migration and `20261003160000_sumit_drain_url.sql` stay byte-identical. `scripts/check-sumit-cron.test.mjs` stops equating the new command to the phase 1 block. It keeps asserting that historical block is unchanged, and it asserts the new daily command and the new drain command are byte-identical across the L1a migration, the pgTAP, and `check-sumit-cron.sql`.

### SUMIT compatibility

`sumit-sync` selects and updates `sumit_connections` and `sumit_refresh_requests` by those names. Ten pgTAP files and the drain spec do too. L1a drops the tables and replaces them with views of the same names, plus `instead of` insert, update, and delete triggers, so those callers keep working at every commit of this stack. The views are not a second store. They read and write `connector_connections` and `connector_refresh_requests` where `provider = 'sumit'`.

Both compatibility views are created `with (security_invoker = true)`. `sumit_connection_status` is too.

Authenticated `select` on `sumit_connections` is limited to `id`, `company_id`, `sumit_company_id`, `created_at`, `updated_at`, `last_sync_at`, `last_error`, and `next_attempt_at`. There is no authenticated grant on `key_ciphertext`, `key_nonce`, `dek_ciphertext`, `dek_nonce`, `kek_version`, `envelope_version`, or `reject_attempts`. `service_role` is granted `select`, `insert`, `update`, and `delete` on the view. `public` and `anon` have none.

`sumit_refresh_requests` has no grant for `public`, `anon`, or `authenticated`. `service_role` is granted `select`, `insert`, `update`, and `delete`.

`sumit_connection_status` exposes `company_id`, `sumit_company_id`, `connected`, `last_sync_at`, and `last_error`. It does not select ciphertext. `select` is granted to `authenticated` and `service_role`.

The `instead of insert` trigger on `sumit_connections` writes `connector_connections` with these defaults when the insert omits them: `provider = 'sumit'`, `kek_ref = 'SUMIT_KEK'`, `envelope_version = coalesce(new.envelope_version, case when new.kek_version = '2' then '2' else '1' end)`, `settings = '{}'` when `sumit_company_id` is null and otherwise `{ "sumit_company_id": <bigint> }`, `import_from` null, `sync_cursor` null, `account_labels` `'[]'`, `reject_attempts = coalesce(new.reject_attempts, 0)`. `last_error` is translated on write (`sumit_auth` to `auth`, `sumit_rejected` to `rejected`, any other value unchanged). The trigger function returns `NEW`. The e2e insert uses `.select()`, which reads that returned row. The `instead of insert` trigger on `sumit_refresh_requests` returns `NEW` the same way. It sets `provider = 'sumit'` and `forced = false`, and `requested_at` defaults to `now()` when omitted.

`packages/shared/src/database.ts` types the client `Tables.sumit_connections` from `GeneratedDatabase["public"]["Tables"]["sumit_connections"]`. After this layer the name is a view, so `supabase gen types` puts it under `public.Views` and that `Tables` key is gone. L1a regenerates `database.types.ts` and leaves it as CLI output (`pnpm db:types`, checked by `scripts/check-db-types.sh`). `database.ts` then builds the client table entry from `Views["sumit_connections"]`. `Row` is the view row without the secret columns (`key_ciphertext`, `key_nonce`, `dek_ciphertext`, `dek_nonce`, `kek_version`, `envelope_version`). `Insert` and `Update` use those same public columns. `Relationships` is whatever the generator emits for the view. The client type still has `Tables.sumit_connections`, so callers keep typechecking. It does not point `Tables` at a table that no longer exists.

`sumit_connections.last_error` translates on read and write: stored `auth` shows as `sumit_auth`, stored `rejected` shows as `sumit_rejected`. The base column is only `auth` or `rejected`. `sumit_connection_status.connected` is `last_error is distinct from 'sumit_auth'` after that translation, so a healthy row is still true.

`sumit_status()` becomes `security definer` with the company check `company_id = private.current_company_id()`. It does not grant `settings`. Its JSON keeps today's keys. `last_error` in that JSON stays `sumit_auth` or `sumit_rejected`, because Settings compares those strings. The mapping is in the function, not a second stored code. The queue and the new drain filter the base column `auth`.

These tests are not ported. The views and the wrappers keep them green:

- `rls_isolation.test.sql`
- `round4.test.sql`
- `round8.test.sql`
- `round9.test.sql`
- `round9_addendum.test.sql`
- `round13.test.sql`
- `owner_ledger.test.sql`
- `phase1_slice.test.sql`
- `sumit_status_grant.test.sql`
- `app/e2e/sumit-drain.spec.ts`

`rls_isolation.test.sql` expects 9 seeded categories (7 expense and 2 income). L1a adds `תשלומי הלוואה` (expense), `העברות` (expense), and `העברות` (income), so that count becomes 12. That is the only edit in that file.

`sumit-sync` stays on the view names through L1a. L2a points it at `connector_connections`, `claim_connector_refreshes`, and `last_error = 'auth'` in the same deploy that may drop the views. Until that deploy, the views stay.

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

Each of those is revoked from `public`, `anon`, and, except `sumit_status` and `disconnect_sumit`, from `authenticated`. `upsert_sumit_documents` maps each document to a canonical line (`external_id` = the document id, `project_hint` from the section id and name, `counterparty.kind` supplier or customer, `doc_kind` and `pnl_role` from today's `deriveLine`) and calls `upsert_connector_lines`. An empty counterparty name is null, and `kind` is null with it. It returns `inserted + updated`. `list_due_refresh_requests` keeps its body against the `sumit_refresh_requests` view, so the current edge function keeps working. `note_sumit_rejection` still accepts `sumit_auth` and `sumit_rejected` and writes `auth` and `rejected`.

### Drop list

The tables drop. The names stay as views until L2a.

| Dropped table or job | Replacement |
| --- | --- |
| `public.sumit_connections` (table) | view of the same name over `public.connector_connections` |
| `public.sumit_connection_status` | view, derived `connected`, and `sumit_status()` |
| `public.sumit_refresh_requests` (table) | view of the same name over `public.connector_refresh_requests` |
| `private.schedule_sumit_daily()` | `private.schedule_connector_jobs()` |
| `private.schedule_drain()` | `private.schedule_connector_jobs()` |
| cron `flow-sumit-daily`, `flow-sumit-drain` | `flow-connector-daily`, `flow-connector-drain` |
| `customers.sumit_external_id`, `suppliers.sumit_external_id` and their unique indexes | `public.party_external_refs` |

`sumit_status`, `disconnect_sumit`, `replace_sumit_connection`, `upsert_sumit_documents`, `list_due_refresh_requests`, `note_sumit_rejection`, `note_sync_failure`, and `stamp_sumit_sync` are not dropped.

### Three filter swaps

Replace the literal `source = 'sumit'` with `private.is_connector_source(t.source)` in:

1. `public.sync_review_queue(p_company_id uuid) returns integer`. Grant stays `service_role`.
2. `public.list_review() returns jsonb`, the `auto_approved_today` predicate. Grant stays `authenticated`, `service_role`.
3. `public.list_auto_assigned_today() returns jsonb`. Grant stays `authenticated`, `service_role`.

Sweep and company-id retirement are not these three. They run inside `upsert_connector_lines` and the SUMIT wrapper, scoped by `p_provider`.

`list_review` items gain `line_status`, `currency`, and `amount_original`. The function signature stays `() returns jsonb`. `get_transaction` gains `currency` and `amount_original` on the line it already returns. `search_transactions` adds those two fields on each expense object beside `line_status`. `list_auto_assigned_today` adds them on each filed row. The MCP tools `list_review`, `get_transaction`, and `search_expenses` return that JSON, so a USD line carries `currency` and `amount_original` and is not shown as shekels. Signatures and grants stay. The line lists inside totals payloads carry the same two fields, specified under Display conversion.

### Pending is excluded from totals

Totals sum `line_status = 'posted'` only. `pending` and `void` do not count. Existing `removed_at` filters stay. Default `posted` means current rows still count.

| Function | Grant |
| --- | --- |
| `public.company_pnl(p_company_id uuid, p_from date, p_to date, p_basis text) returns jsonb` | `authenticated`, `service_role` |
| `public.get_dashboard(p_from date, p_to date, p_basis text) returns jsonb` | `authenticated`, `service_role` |
| `public.get_home() returns jsonb` | `authenticated`, `service_role` |
| `public.get_project(p_id uuid) returns jsonb` | `authenticated`, `service_role` |
| `public.list_project_category(p_project uuid, p_category uuid, p_offset integer, p_limit integer) returns jsonb` | `authenticated`, `service_role` |
| `private.overhead_share(p_project uuid)` | `authenticated`, `service_role` |
| `private.project_category_entries(...)` | the grants it has today |

`list_project_category`'s `total_agorot` goes through `private.project_category_entries`, so that helper gains the same predicate. `get_dashboard` returns `company_pnl`. `get_home`'s `net_profit_agorot` is its own query and gains the predicate too.

`list_auto_assigned_today` excludes pending, so a pending line is not filed.

`list_review` shows pending. `get_transaction(p_id uuid) returns jsonb` still returns a line opened from review, including pending. `list_unpaid() returns jsonb` stays document-based and does not gain Mercury cash lines.

On the invoiced basis, `company_pnl` income is `invoice`, `credit`, and `invoice_receipt`. The planned `private.cash_receipt_counts_on_invoiced(p_source)` predicate was not added. Mercury income is stored as `invoice_receipt` instead (decision [0097](../decisions/0097-mercury-income-invoice-receipt.md)), so it counts there and `company_pnl` does not contain the literal `mercury`. Nothing checks it against a SUMIT invoice, so both can count. That is a known limitation. On the cash basis a receipt and an invoice-receipt both count.

`search_transactions(p_query text, p_scope text, p_limit integer, p_offset integer)` adds `line_status`, `currency`, and `amount_original` on each expense object. The `filed` scope also requires `line_status = 'posted'`. The `all` scope may include pending and still returns those fields. `search_expenses` returns that JSON. Signature and grants stay.

`project_waiting` is a list, not a profit figure. It is not one of these posted sums. Each item carries `currency` and `amount_original`. `get_project`'s `pending_agorot` converts those lines, under Display conversion.

### Display conversion

A stored row stays in its own currency. A Mercury `amount_net` stays signed USD cents, and import leaves the pair null under `original` and `today`. No aggregate adds that integer to an ILS `amount_net`. Until display conversion is built, `company_pnl`, `get_home`, `get_project`, `overhead_share`, and `project_category_entries` sum only `coalesce(currency, 'ILS') = 'ILS'`. `company_pnl`, `get_home`, and `get_project` also return `other_currencies`, an array of `{currency, income_minor, expense_minor, count}` for the posted non-ILS lines those shekel figures left out. `income_minor` and `expense_minor` are signed `amount_net`. A pending line is not in either figure. `get_project`'s `pending_agorot` sums only ILS waiting lines. Non-ILS waiting amounts are `pending_other_currencies`, an array of `{currency, expense_minor, count}`. Review rows and transaction detail carry `currency` and format each amount in that currency.

Every total calls one helper:

```sql
create function private.to_display_minor(
  p_company uuid,
  p_currency text,
  p_amount_minor bigint,
  p_line_date date,
  p_fx_rate numeric,
  p_fx_rate_date date
) returns bigint
language sql
stable
set search_path = '';
```

`revoke all` from `public` and `anon`. `grant execute` to `authenticated` and `service_role`. The function returns minor units of the company's `display_currency`. The default is `ILS`, so the number is agorot and the converted `*_agorot` fields stay shekels. When `display_currency` is `USD`, those same keys hold US cents. The key names stay. `budget_agorot` is the exception, stated with `get_project`.

`p_line_date` is the line's Jerusalem date. It is not the rate date.

The rate, and this is the only rule:

- `p_currency` equal to `display_currency`: return `p_amount_minor`. No rate is read. `p_fx_rate` is ignored. An ILS line shown in shekels is this case, including under `historical`.
- `fx_policy` `original` or `today`: the newest `fx_rates` row whose `rate_date` is on or before today in `Asia/Jerusalem`. The line's stored pair is not read. `p_line_date` is not that date.
- `fx_policy` `historical`, `p_currency` `ILS`, and `display_currency` `USD`: the newest `fx_rates` row whose `rate_date` is on or before `p_line_date`. An ILS row has no stored pair. `p_fx_rate` is not read.
- `fx_policy` `historical`, `p_currency` `USD`, and `display_currency` `ILS`: the stored pair. `p_fx_rate` and `p_fx_rate_date` must both be set. `p_line_date` is not a second lookup.

Under `historical`, import stamps that stored pair on each USD row, as specified under FX and reprice. An ILS row is never stamped.

`display_currency` `ILS` and `p_currency` `USD`: the sign of `p_amount_minor` times `private.round_half_even(abs(p_amount_minor) * ils_per_unit)`, in agorot. One dollar is 100 cents and one shekel is 100 agorot, so the factors cancel.

`display_currency` `USD` and `p_currency` `ILS`: the sign of `p_amount_minor` times `private.round_half_even(abs(p_amount_minor) / ils_per_unit)`, in cents. The same `ils_per_unit` row, the other direction.

Postgres `round` is not used. The absolute value is rounded, then the sign is restored.

A conversion that needs a rate and does not have one returns null. It does not return `p_amount_minor`.

These functions sum `private.to_display_minor` for each posted line that already belongs in the total, and they skip a null. A skipped null is not added as raw cents or raw agorot.

| Function | What it converts |
| --- | --- |
| `public.company_pnl(uuid, date, date, text)` | Every P&L total. `get_dashboard` returns this payload |
| `public.get_home()` | `net_profit_agorot` |
| `public.get_project(uuid)` | `income_agorot`, `direct_agorot`, `shared_agorot`, the category sums, and `pending_agorot` |
| `public.list_project_category(uuid, uuid, integer, integer)` | `total_agorot`, through `private.project_category_entries` |
| `private.overhead_share(uuid)` | The overhead it shares |
| allocation amounts on those reads | `allocations.amount_net`, in the line's currency, through the same helper |

`get_project`'s `pending_agorot` is the negation of the sum of `private.to_display_minor` over the waiting lines from `project_waiting`. Each call uses that line's currency, `doc_date`, and stored pair. It does not sum raw `amount_net`. A null is left out of the sum and still counts in `fx_missing_count`. Those lines may be pending. This figure is not a posted P&L total. The sign matches today's `-sum(amount_net)`, in display minor units.

`budget_agorot` stays the stored project budget in ILS agorot. It is not a line. It has no `doc_date` and no stored pair, so `private.to_display_minor` is not applied and a `$` display does not turn the number into cents. `get_project` and each object in `company_pnl`'s `projects` array return `budget_currency` with the value `ILS` beside `budget_agorot`.

`get_project`'s `transactions` items, `list_project_category`'s `rows`, and `project_waiting` items each include `currency` and `amount_original`. `amount_net` on those items stays in the line's currency. The converted amounts stay on the totals.

Each of these payloads includes `display_currency` and `fx_missing_count`. `fx_missing_count` is the number of lines in that total for which the helper returned null, including a waiting line omitted from `pending_agorot`. When the count is above zero the payload also includes `sync_fx_missing`. That status is display-time only. Import does not write it on `last_error`, does not fail the batch, and does not zero the stored line.

MCP `get_totals` and `list_projects` read `get_dashboard`. `totalsOf` and `projectRow` in `supabase/functions/flow-mcp/tools_reports.ts` pass `fx_missing_count` and `display_currency` through from that payload. They do not drop those keys. `list_projects` copies the company `display_currency` and `fx_missing_count` onto each project row, because `projectRow` returns only the fields it copies. `projectRow` also returns `budget_currency` with the value `ILS` beside `budget_agorot`. `fx_missing_count` is 0 when the payload omits it.

pgTAP in this same layer: one company, one posted ILS line and one posted USD line, read through `company_pnl`, `get_dashboard`, `get_home`, `get_project`, `list_project_category`, and `private.overhead_share`. One case with no `fx_rates` row: `fx_missing_count` is 1, the ILS amount is unchanged, and the USD cents are absent from the sum. One allocation stored in USD cents reads back in the display minor unit.

The helper and these rewrites are L1b. They land before L2b inserts a Mercury row.

### Off-P&L loan payments and transfers

L1a adds the column. This layer does not migrate.

```sql
alter table public.categories
  add column excluded_from_pnl boolean not null default false;
```

`private.seed_default_categories` also inserts three rows, each `is_default` true and `excluded_from_pnl` true: expense `תשלומי הלוואה` (loan payments), `sort_order` 8; expense `העברות` (transfers), `sort_order` 9; income `העברות` (transfers), `sort_order` 3. Categories already have unique constraint `categories_company_id_kind_name_key` on `(company_id, kind, name)`. L1a reuses that constraint. It does not add `categories_company_kind_name_uidx`. The same migration inserts those rows for companies that already exist, `on conflict on constraint categories_company_id_kind_name_key do nothing`. A category hint matches `name` and `kind` together, and `kind` must match the line direction, so an inbound transfer does not land on the expense row. There is no balance-sheet model. This flag is how a category stays in cash and review and out of P&L.

A line in either category stays in the books. It is a cash movement, so לאישור (`list_review`) and `get_transaction` still show it. There is no separate cash-flow total. The P&L sums skip it, including while the review row is still open. The upsert may set the category from `category_hint` and must leave `category_assigned` false, so the owner can change it. Changing it to a normal category puts the line back into P&L.

The Mercury adapter sets `category_hint` to `loan_part:principal` when the counterparty name is NEWREZ, Lakeview, or Servease, compared case-insensitively. Those three are the interim list. The core does not match lender names. It sets `העברות` for an unconnected own-account transfer, as above. The engine resolves a hint by `kind` and `name`, except a `loan_part:<part>` hint (`interest`, `escrow`, `principal`), which it resolves by `kind` and `categories.loan_part`, so a renamed loan category still gets the line (FLOW-122). A hint that finds no category leaves the usual guess.

These sums gain `not exists (select 1 from public.categories c where c.id = t.category_id and c.excluded_from_pnl)`. Each amount they add is `private.to_display_minor`, not the raw `amount_net`:

| Function | What it sums |
| --- | --- |
| `public.company_pnl(uuid, date, date, text)` | Every P&L total. `get_dashboard` returns this payload |
| `public.get_home()` | `net_profit_agorot` |
| `public.get_project(uuid)` | `income_agorot`, `direct_agorot`, `shared_agorot`, and the category sums |
| `public.list_project_category(uuid, uuid, integer, integer)` | `total_agorot`, through `private.project_category_entries` |
| `private.overhead_share(uuid)` | The overhead it shares |

### Mercury cashback

A Mercury credit whose description is `IO Cashback` gets `category_hint` `הכנסה אחרת` (other income). That category is already seeded and is not excluded from P&L. VAT stays 0. The adapter sets the hint. L2b. This is income. A card refund is not this rule.

## Loans

Accepted in [0088](../decisions/0088-loans.md). The connector stack does not build the schedule, the form, or the split. A loan is set up once: lender match, balance, rate, start, term, and escrow, through a form or MCP. Flow builds the schedule and splits each matched payment into interest (P&L expense `ריבית משכנתא`), escrow (taxes and insurance, P&L expense `מסים וביטוח`), and principal (off-P&L `תשלומי הלוואה`, and the principal reduces the balance), with a correction each month. Until a payment is split, the whole line sits in `תשלומי הלוואה`. The canonical line stays one bank line with one `external_id` and one `amount_original`. The three-way split attaches three category amounts to that same line. It does not create three provider lines, and it does not change the allocations' project shares.

## FX and reprice

L1b. Not this layer. The columns `currency`, `amount_original`, `fx_rate`, and `fx_rate_date` are added in L1a, before any Mercury row exists.

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
grant select, insert on public.fx_rates to service_role;
revoke update, delete on public.fx_rates from service_role;

alter table public.companies
  add column display_currency text not null default 'ILS'
    constraint companies_display_currency check (display_currency in ('ILS', 'USD')),
  add column fx_policy text not null default 'original'
    constraint companies_fx_policy check (fx_policy in ('original', 'today', 'historical'));

create function public.set_display_currency(p_currency text)
returns void
language plpgsql
security definer
set search_path = '';

revoke all on function public.set_display_currency(text) from public, anon;
grant execute on function public.set_display_currency(text) to authenticated, service_role;

create function public.reprice_usd_lines(p_company uuid, p_rate_date date)
returns integer
language plpgsql
security definer
set search_path = '';

revoke all on function public.reprice_usd_lines(uuid, date) from public, anon, authenticated;
grant execute on function public.reprice_usd_lines(uuid, date) to service_role;

create function private.round_half_even(p_value numeric)
returns bigint
language sql
immutable
set search_path = '';
```

`fx_rates` is insert-only. `authenticated` can select and cannot insert, update, or delete. `service_role` can select and insert and cannot update or delete. A rate for a date is written once. A later fetch does not overwrite it.

`ils_per_unit` is shekels per one US dollar. `private.round_half_even` sends an exact `.5` to the even integer and sends every other value to the nearest integer. Postgres `round` is not used. Mercury VAT is 0, so `amount_net = amount_gross` in cents while the row stays in dollars. Display conversion of a total is only `private.to_display_minor`, under Display conversion. That helper is the rate rule. `original` and `today` use the newest `fx_rates` row on or before today. `historical` shows an ILS line in shekels unchanged, converts an ILS line into dollars at the newest `fx_rates` row on or before the line date, and converts a USD line into shekels with the pair import stored on that row. [0087](../decisions/0087-multi-currency.md).

The Bank of Israel does not publish a rate on a weekend or a holiday. The rate for a date is the newest `fx_rates` row on or before that date. It is not copied onto the transaction by default.

The default `fx_policy` is `original`. A Mercury row keeps `currency = 'USD'` and `amount_original` in cents. `amount_gross` and `amount_net` are the signed cents from `amount_negated`. Under `original` and `today`, `fx_rate` and `fx_rate_date` stay null. Under `historical`, import writes both on each USD row from the newest `fx_rates` row on or before that line's `doc_date`. An ILS row is not stamped. If that rate row does not exist, the pair stays null. The pair check still requires both null, or `fx_rate > 0` together with `fx_rate_date`. Import does not call `reprice_usd_lines` and does not raise `sync_fx_missing`. A missing Bank of Israel rate does not block the upsert and does not zero a line. A later read leaves that row out of the converted total and counts it in `fx_missing_count`.

A line is shown in its own currency. A Mercury line is dollars, amount and currency as stored. The ₪/$ toggle (`display_currency`) does not update the row. Totals convert at read through `private.to_display_minor`.

`reprice_usd_lines` runs only when `fx_policy` is switched off `original`. Under `original` it changes nothing. Under `today` it writes `fx_rate` and `fx_rate_date` from the stored rate for `p_rate_date` (the newest row on or before that date) onto every USD row of the company. Under `historical`, import has already stamped each USD row from the newest rate on or before that line's own `doc_date`. `reprice_usd_lines` writes the `p_rate_date` pair only onto USD rows whose `fx_rate_date` is still null. It does not change `currency`, `amount_original`, `amount_gross`, or `amount_net`, and it does not replace a pair import already wrote. Switching back to `original` leaves any stored pair in place. Display under `original` and `today` ignores that pair and reads the newest `fx_rates` row on or before today.

`reprice_usd_lines` takes no free-rate argument. It reads `fx_rates`. It is service role. `private.audit_row` skips a write when `auth.uid()` is null. Reprice sets `flow.system_actor` to `reprice` for the transaction. `audit_log.actor_id` becomes nullable. `audit_log.system_actor` is null or `reprice`. The check, added `not valid` then validated, requires exactly one of `actor_id` and `system_actor`. When the setting is `reprice`, the trigger writes `system_actor` and a null `actor_id`. When both the user and the setting are absent, it still skips, as it does today.

`set_display_currency` accepts `ILS` or `USD` and writes the session company. It does not reprice and it does not write `fx_rate`. Anything else is rejected. The body checks `auth.role()`.

The USD fingerprint uses `amount_original`. A missing rate does not change the stored cents.

`fx.ts` (L2) tries the Bank of Israel JSON, then SDMX, then the cached row. It fills `fx_rates`. It does not write `fx_rate` onto a transaction.

## Error codes and copy keys

Stored `last_error` on `connector_connections` uses one vocabulary.

| Class | `last_error` | SUMIT wrapper code, unchanged at the boundary | Copy key |
| --- | --- | --- | --- |
| `auth` | `auth` | `sumit_auth` | `status.reconnect` |
| `rejected` | `rejected` | `sumit_rejected` | reconnect sheet |
| `rate_limited` | `rate_limited` | the current rate-limit path | `refresh.failed` |
| `transient` | `transient` | `sync_failed` | `refresh.failed` |
| sweep empty | `sync_sweep_empty` | `sync_sweep_empty` | `refresh.failed` |
| sweep suspicious | `sync_sweep_suspicious` | `sync_sweep_suspicious` | `refresh.failed` |
| page cap | `sync_page_cap` | `sync_page_cap` | `refresh.failed` |
| missing FX, display time | not stored on import | `sync_fx_missing` with `fx_missing_count` on the aggregate JSON | the total omits those rows |
| cursor conflict | `sync_cursor_conflict` | not a SUMIT code | `refresh.failed` |

`note_sync_failure` still accepts only `sync_failed` and `sync_page_cap`. `note_connector_failure` accepts the stored classes above and does not accept `sync_fx_missing`. That code is display-time only. `retry_after` from `classifyError` is what a rate limit stores in `next_attempt_at` when the provider sent one. Hebrew strings are in [connector UI states](connector-ui-states.md).

## Add connector number 3

1. Add the enum value on `connector_provider` and on `txn_source` in the open migration. Do not use a new `txn_source` value in that same transaction.
2. Add the id to `PROVIDERS` in `registry.ts`, a capabilities file under `connectors/<provider>/`, and a `KEK_REF` constant whose value is the env name. Add that name to `connector_connections_kek_ref_name`. A connector whose `kek_ref` is not in that check cannot be inserted.
3. Implement `ConnectorPort` under `supabase/functions/_shared/connectors/<provider>/`.
4. Register it in `CONNECTOR_MODULES`, including `open(secret)`. Do not add a provider test in the engine.
5. Add a client descriptor and the Hebrew copy.
6. Ship a GET allowlist, a fetch guard that refuses any other method, fixtures, and `redact`. No token in the fixtures.
7. Extend `private.is_connector_source` for the new `txn_source` value.
8. If the client bundle must not contain the host or the key env name, add that needle beside the existing bundle scan. `MERCURY_KEK`, `api.mercury.com`, and `secret-token:` are the Mercury needles for that later scan. This layer does not change the scanner, and those strings are not in the client.

## Later

Not in this stack:

- KEK rotation. Format 3 names the binding. The procedure for a new KEK version is not specified.
- A check that the pasted Mercury token is read-only beyond a successful GET. The fetch guard refuses a non-GET method. It does not ask Mercury whether the token could POST.
- Review nits that this round did not list. The listed nits are in the sections above: calendar dates, `auth.role()` on every service RPC, the schema-equals-type check, `api.d.ts` in `deno test`, text bounds, `source_account_id`, and a derived `connected`.
- Backlog from the round-2 review, not specified in this contract: S4, S5, the unfinished part of S12, and items B3 through B13 of that report. B2, the insert trigger returning `NEW`, is specified above. B1's `security_invoker` column-access question is backlog. The format-3 deploy order, the compatibility-view grants, the insert-trigger defaults, a null `counterparty.kind`, insert-only `fx_rates`, and the sign, party, P&L, transfer, exemption, and view-type rules above are not that backlog.

## Layers

| Layer | What lands |
| --- | --- |
| L0 | This contract, decisions 0085–0087, types, Mercury GET types, the credit type, the GET guard, redact |
| L1a | `connector_connections` and the other tables, SUMIT copy, compatibility views, upsert, three filters, jobs and the cron check in the same migration, drop of the `sumit_*` tables behind those views, `line_status = 'posted'` on totals, `categories.excluded_from_pnl` with `on conflict on constraint categories_company_id_kind_name_key do nothing`, FX columns, `ci.yml` deploy of `sumit-sync`, `sumit-connect`, and `sumit-reseal`, then the `sumit-reseal` invoke, then `db push` (`scripts/ci-cd.test.mjs` asserts it; today the workflow deploys only `flow-mcp` and `jev-tag`) |
| L1b | `fx_rates` (insert-only), `display_currency`, `fx_policy`, `set_display_currency`, `reprice_usd_lines`, `private.to_display_minor`, the aggregate rewrite, `pending_agorot` through that helper, `budget_currency` `ILS` on `get_project`, on each `company_pnl` `projects` object, and on MCP `projectRow`, `fx_missing_count` and `display_currency` passed through MCP `get_totals` and `list_projects`, `currency` and `amount_original` on review, transaction, search, the MCP line tools, `get_project` transactions, `list_project_category` rows, and `project_waiting` items, and the mixed-currency pgTAP. This lands before L2b imports a Mercury row. The system actor |
| L2a | Registry `open`, engine, `connector-sync` / `connector-connect`, `fx.ts`, aliases, `sumit-sync` moved off the views, `sumit-connect` seals format 3 and the connection RPCs require `'3'` |
| L2b | Mercury adapter and SUMIT `normalize` over the current mapper. Verifies pending and posted share an id |
| L3a | ₪/$ toggle |
| L3b | Connection card, range, ממתין |

L1b backlog, named here and not specified in this contract: pgTAP expected values for a negative amount, an exact `.5`, a USD display, and `historical`; whether `today` stays the same rule as `original`; the allocation rounding rule; the overhead rounding rule; the duplicate unique index; `sumit-reseal` rejecting a caller that is not `service_role`; the unpaid-list currency note. Reviewer 2 r1, also not in L1a: mixed-sign VAT (B2), B3, the pre-existing lock order (B4), B6, B7, and B8.

The SUMIT pgTAP suites (`owner_ledger`, `round4`, `round5`, `review_field_save`, `mcp_cycle3a`, `sumit_*`) stay on the compatibility views, except `sumit_daily_schedule.test.sql`, which is ported 1:1 onto the pinned job text in L1a. `ledger-parity.test.ts` and the demo-data to expected-pnl golden stay green or move one for one. Each new id-taking RPC gets a cross-tenant negative.
