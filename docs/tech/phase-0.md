# Phase 0, as built

*28 Sep 2026. What the tree implements after the `phase-0` merge. The [technical plan](tech-plan.md) is still the target. This page is the map of the code.*

Phase 0 is a Hebrew RTL phone shell, a Postgres schema with owner-scoped row-level security, and the Rule A P&L for the Flow Test fixture. Home does not compute profit yet. There are no Edge Functions, no SUMIT client, and no bank import.

## Layout

| Path | Role |
| --- | --- |
| `app/` | Vite PWA (`@flow/app`). Dev server port **43123**. |
| `packages/shared/` | Money, Zod schemas, Rule A P&L, generated database types. Published in the workspace as `@flow/shared`. |
| `supabase/migrations/20260927120000_schema_v1.sql` | Schema v1. One file, edited in place. |
| `supabase/tests/database/` | pgTAP. `helpers.sql` and `bootstrap-local.sql` beside that folder are not tests. |
| `scripts/` | Demo seed, Home latency, local pgTAP, types drift check. |
| `packages/shared/fixtures/` | Flow Test SUMIT company. `demo-data.json` in, `expected-pnl.json` out. |

`pnpm` 10, Node 22. Commands are in the [README](../../README.md#run-locally).

## App

`app/src/App.tsx` is the route table. `app/index.html` sets `lang="he"` and `dir="rtl"`. Colour and type come from the design tokens. TanStack Query is in memory only (`app/src/main.tsx`): one retry, no refetch on focus, no IndexedDB persister. The service worker is registered in production builds (`vite-plugin-pwa`, `navigateFallback: /index.html`). The build also writes `404.html` and `_redirects` so a static host can serve deep links.

### Auth

Supabase Auth, Google, PKCE (`app/src/lib/supabase.ts`). The client exists only when both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are non-empty. Vite reads env from the repo root. `app/.env.production` fills any `VITE_` value the shell did not set ([0046](../decisions/0046-public-anon-key.md)). The service-role key is never a `VITE_` variable.

`signInWithOAuth` sends the browser to `{origin}/auth/callback` with `prompt=select_account`. The callback calls `get_home()`:

| Result | Next screen |
| --- | --- |
| Session and a `company_id` | `/` |
| Session and `company_id` null | `/onboarding` (title only) |
| No client | `/sign-in?error=config` |
| No session | `/sign-in?error=` plus the query error, or `server_error` |
| `get_home` error | `/sign-in?error=server_error` |

On the sign-in screen, `access_denied` and `popup_closed` show the cancelled note. Any other `error` query shows the failed note and a link to `/help`. Help is one line and a mailto to `HELP_EMAIL` in `app/src/config.ts` (`ops@nromomentum.com`).

A signed-in visitor who hits `/sign-in` is sent home. Every other product route sits behind `RequireAuth`.

### Preview

Any `preview` query skips sign-in (`app/src/preview.ts`). Links inside the shell keep the flag.

| Query | Screen |
| --- | --- |
| absent | Real session required |
| `loading` | Home skeleton (`aria-busy`) |
| `error` | Offline copy, no band, no preview banner |
| `error-server` | "לא הצלחנו לטעון את הנתונים", no band |
| anything else, including `1` and `empty` | First-run empty Home, banner "מצב תצוגה" |

`/?preview=1` is that empty Home. It is not the seeded Flow Test company, and it does not show shekel figures. The Playwright smoke test in `app/e2e/smoke.spec.ts` locks this.

Live Home uses the same two failure screens: a paused query or an error while offline uses the offline copy; an error while online uses the server copy. Retry on a preview returns to `/?preview=1`. Retry while signed in refetches `get_home`.

### What a signed-in Home shows

`HomeScreen` calls `rpc("get_home")` and parses it with `homeSummarySchema`. The band still uses `profitBandLabel(false)`, so the label stays "כאן יופיע הרווח הנקי של העסק". The body stays the empty state ("עוד אין נתונים" / connect SUMIT), including when the owner already has rows. Greeting text comes from the Google `name` or `full_name` metadata. A missing name is "שלום".

Add and Change are Vaul sheets over the page that opened them. The project screen is a band with a fixed `₪0` and an empty state. It does not read `get_home` or the ledger. Review, upload, unpaid, notifications, settings, and categories are titles only.

## `get_home()`

`public.get_home()` is `security invoker` and returns one jsonb object. `companies.owner_id` is unique, so there is at most one company.

```json
{ "company_id": "<uuid or null>", "name": "<text or null>", "net_profit_agorot": 0, "is_demo": false }
```

`net_profit_agorot` is the constant `0`. `is_demo` is the company flag, or `false` when the owner has no company. The function does not read transactions.

`pnpm latency` POSTs `/rest/v1/rpc/get_home`. With `SUPABASE_ACCESS_TOKEN` the call is that user. Without it the script still prints status and milliseconds; a 401 is a round trip, not a Home payload. The script prints no body and no key.

## Schema

Money columns are `bigint` agorot. `transactions` requires `amount_gross = amount_net + vat_amount`. Company VAT default is `1800` basis points, the same constant as `STANDARD_VAT_RATE_BP`.

One owner, one company. Child rows carry `company_id`. Foreign keys that point at a project, customer, supplier, category, or transaction use `(company_id, id)`, so a row cannot point at another company's id. Deleting a company cascades.

Inserting a company runs `private.seed_default_categories()`. Names and order match `DEFAULT_EXPENSE_CATEGORIES` and `DEFAULT_INCOME_CATEGORIES` in `packages/shared/src/categories.ts`. A test reads the migration text and fails if they diverge.

| Table | What Phase 0 uses it for |
| --- | --- |
| `companies` | Owner, name, `vat_rate_bp`, `is_demo` |
| `categories` | Nine defaults |
| `projects`, `customers`, `suppliers` | Demo seed. `suppliers.vat_exempt` is the exempt flag |
| `transactions` | Demo documents. Unique on `(company_id, idempotency_key)` and on `(company_id, source, external_id)` |
| `allocations` | One project at 10000 bp, or a worker-day split. Shares for a transaction must sum to 10000, or to 0 when none remain |
| `split_rules`, `split_rule_targets` | The demo worker-day rule, per month |
| `overhead` | One row per overhead transaction |
| `review_queue` | Present. The seed does not fill it |
| `sumit_connections` | Ciphertext columns only. No plaintext API key |
| `audit_log` | Trigger-written. Clients cannot insert |

`sumit_connection_status` is a `security_invoker` view of `company_id`, `sumit_company_id`, and `connected`. It does not select ciphertext.

RLS is enabled on every table above. `companies` is visible when `owner_id = auth.uid()`. Other policies call `private.current_company_id()`, which is `security definer` and returns that owner's company id. `authenticated` can read and write the ledger tables. It can `select` the non-secret columns of `sumit_connections` and can `select` `audit_log`. It cannot write either. `anon` has no table grants.

`private.audit_row()` skips a delete once the company row is already gone, so a company delete does not fail the audit foreign key.

### Execute grants

The migration revokes `EXECUTE` from `PUBLIC` for every future function, in every schema. A new function is not callable until it has its own grant. Each function in `public` or `private` needs `grant execute on function ... to authenticated`, and to `service_role` when the server should call it. `private.audit_row()` is the exception: it stays revoked from `authenticated` and runs only as a trigger.

Hosted apply is manual. This repo's automation does not run `supabase db push`. The migration header still says the file has not been applied to the hosted project.

## Rule A P&L

`pnlFromDemo` in `packages/shared/src/pnl.ts` is the implementation of the Flow Test totals. `pnpm test` checks it against `expected-pnl.json`. The database does not run this math. Home does not call it.

Document kinds in the fixture are `inv`, `rec`, `invrec`, `cred`, `exp`. `demoKindToDocKind` maps them to the `doc_kind` enum.

| Line | Rule |
| --- | --- |
| Expense whose description starts with `עלות משותפת` | `pnl_role = shared`. No project on the line |
| Expense whose description starts with `תקורה` | `pnl_role = overhead` |
| Other expense | `pnl_role = project`. A missing budget section throws |
| Income document | Must have a budget section. `role` stays null |

VAT, decision [0043](../decisions/0043-assumed-vat-on-expenses.md):

- An expense with a stored VAT rate that makes net differ from gross keeps the source amounts (`vat_status = source`).
- `vat` null, or `vat` 0 while gross still equals net, is a missing split. Net is `gross / 1.18` (`assumed`), using `netFromGrossAgorot`.
- A supplier with `vat_able: false` is exempt. Net equals gross (`derived`). Exemption is that flag only.
- A receipt has no VAT of its own. Cash net uses the linked invoice rate (`orig`), including a real 0%. The company rate is the fallback when that invoice is missing or has no amount.
- Invoices, credits, and invoice-receipts that carry `WithoutVAT` keep it (`source`).

Income totals:

- Invoiced: `inv`, `cred`, `invrec`.
- Cash: `rec` and `invrec`. An invoice with no receipt stays out of cash income.
- Open receivable is the invoice gross, plus linked credit gross, minus linked receipt gross. A non-zero remainder is still open.

Expense nets arrive negative. Project and company cost fields are stored as positive costs (the sign is flipped once). Shared cost is split by `shared_alloc_worker_days` with `allocateByWeights`. The parts must sum to the shared pool or `pnlFromDemo` throws. Overhead is not allocated to projects in this function.

`cash_date` in the seed is null for invoices and credits, and the document date otherwise.

### Rounding

`packages/shared/src/money.ts` rounds ties **half-to-even** (`divHalfEven`, `parseDecimalHalfEven`, `wholeShekels`, `netFromGrossAgorot`). `formatIls` then prints whole shekels, a thousands comma, `₪`, and Unicode minus.

[calculations.md](../module-1-project-pnl/calculations.md) still specifies half away from zero for display and for VAT Flow computes. The two disagree on a tie (50 agorot, a percentage of n.x5). The tests follow the code. Changing either side is a product decision, then a changelog entry. Do not "fix" one file to match the other in passing.

## Demo seed

`pnpm seed:demo` loads `demo-data.json` through the service role. It needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SEED_OWNER_USER_ID` (an `auth.users` id). It does not call SUMIT and it does not print the key.

The owner must already exist. Sign in with Google once, copy the user id, then run the script. `supabase/seed.sql` does not insert the company, because there is no auth user at migration time.

The script creates the company with `is_demo = true`, or updates one that is already demo. It throws if that owner's company exists and `is_demo` is false. Upserts use the unique keys `(company_id, name)` for projects, customers, and suppliers, `(company_id, idempotency_key)` for transactions (`sumit:<sumit id>`), `(transaction_id)` for overhead, `(transaction_id, project_id)` for allocations, and `(company_id, label)` / `(rule_id, project_id, month)` for the split rule.

An empty real company, when you want one, is the SQL in the README. The category trigger still runs. Leave `is_demo` false.

## Tests

| Command | What it runs |
| --- | --- |
| `pnpm test` | Vitest in `app/` and `packages/shared`, including Rule A |
| `pnpm test:e2e` | Playwright, mobile viewport, preview shell |
| `pnpm db:test` | `supabase test db supabase/tests/database`. Docker. CI pins CLI 2.118.0 and runs `supabase db start` first |
| `pnpm db:test:local` | Postgres 17, no Docker. Bootstrap, then the migration, then seed, then helpers, then `pg_prove` |
| `pnpm db:types:check` | Diff `database.types.ts` against CLI 2.118.0 |

CI runs typecheck, lint, unit tests, the production build, Playwright, the pgTAP suite, then the types diff. The types check is after the database tests so a types mismatch cannot hide an RLS failure.

`packages/shared/src/database.types.ts` is untouched CLI output. The app imports `Database` from `packages/shared/src/database.ts`, which omits the SUMIT ciphertext columns. CLI 2.118.0 does not pass a PostgREST version, so the generated file has no `__InternalSupabase`. The API version is the comment `flow-postgrest-version` in `supabase/config.toml` (16.3). `scripts/check-db-types.sh` passes it as `--postgrest-version` once the CLI accepts the flag.

Local pgTAP order matches CI. `bootstrap-local.sql` runs first and stands in for the roles and auth schema that `supabase db start` already has. CI does not load that file. The migration runs next and revokes future `EXECUTE`. `helpers.sql` then creates the `pgtap` extension and grants execute on its functions to `anon` and `authenticated`, which is what lets `is()` and `throws_ok()` run. `supabase test db` creates pgTAP only after the migration, so the grant has to live in helpers. Do not load `helpers.sql` on the hosted project: it defines `tests.create_supabase_user`, which inserts into `auth.users`.

## Still in the technical plan

These are specified in [tech-plan.md](tech-plan.md) and are not in this tree: Edge Functions, `pg_cron` / `pgmq` / `pg_net`, a SUMIT sync, envelope encryption of a live API key, bank-statement import, review and auto-approve, the after-overhead view, push, IndexedDB cache, Cloudflare deploy, and a `get_home` that returns a period P&L. Latency from Israel is a manual `pnpm latency` run, not a recorded gate.
