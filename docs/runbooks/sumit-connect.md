# Connect SUMIT on flow-pilot

Store the Vault rows before `supabase db push` when the migration should schedule the drain itself. Otherwise apply the migration, then call `select private.schedule_drain();`. Deploy the two functions, then paste the key in the app. Do not commit the SUMIT key or the service-role key.

## 1. Migration

Apply, in order, on the hosted SQL editor or with `supabase db push`:

1. `supabase/migrations/20260927120000_schema_v1.sql`
2. `supabase/migrations/20260928140000_phase1_slice.sql`
3. `supabase/migrations/20260928180000_reopen_review.sql`
4. `supabase/migrations/20260928190000_review_card.sql`
5. `supabase/migrations/20260928210000_owner_ledger.sql`
6. `supabase/migrations/20260928220000_allocation_share_lock.sql`
7. `supabase/migrations/20260928230000_review_round4.sql`
8. `supabase/migrations/20260929010000_review_round5.sql`
9. `supabase/migrations/20260929120000_review_round7.sql`
10. `supabase/migrations/20260929130000_review_round8.sql`
11. `supabase/migrations/20260929140000_sumit_status_next_attempt_grant.sql`
12. `supabase/migrations/20260929150000_review_0068.sql`
13. `supabase/migrations/20260929160000_review_0068_addendum.sql`
14. `supabase/migrations/20260929170000_review_0068_column.sql`
15. `supabase/migrations/20260929180000_reassign_undo_rls.sql`

Migrations are append-only from `20260929150000` on. Hosted Supabase had only the Phase 0 migration when `20260929120000` was edited in place, so that one edit stays. Do not edit a migration after it has been applied. Add a new file.

`pg_cron` and `pg_net` are created by the round 5 migration when the image allows them. If either is missing, the migration still finishes and the drain job is skipped. The job runs every five minutes (`*/5 * * * *`), not once a day. It is scheduled only when Vault `cron_secret` is a non-empty secret. Store `flow_sync_url` as well; without that URL the job uses `http://kong:8000/functions/v1/sumit-sync`. Create the secret once, store it in both places, then migrate — or migrate first and call `select private.schedule_drain();` after the Vault rows exist. An empty `x-flow-cron` header is rejected everywhere, including the local stack. An empty SUMIT payload sets `last_error` to `sync_sweep_empty`. A payload that would remove more than half of the live SUMIT rows sets `sync_sweep_suspicious` and leaves those rows in place. A successful stamp keeps an error that starts with `sync_sweep`. A billing or limit rejection sets `sumit_rejected` and waits 5 minutes, then 15 minutes, 1 hour, 6 hours, and at most 24 hours. A bad key or company id sets `sumit_auth` and stops until the owner reconnects. Manual refresh respects the same wait.

## 2. Edge Functions

Deploy `sumit-connect` and `sumit-sync` from `supabase/functions/`. Each folder has `index.ts`, `deno.json`, and `import_map.json`. They import `../_shared/`.

Secrets, names only:

| Name | Required | How to create it |
| --- | --- | --- |
| `SUMIT_KEK` | yes | `openssl rand -base64 32` (32 bytes). Same value on both functions. |
| `CRON_SECRET` | yes, for the drain | one random string, stored as this Edge secret and as Vault `cron_secret`. The drain runs every five minutes. |

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase. Do not copy the service-role key into the repo or the browser.

## 3. Two owners, one SUMIT company

Each Google user has their own Flow company. Both can point at SUMIT CompanyID **2389917160**.

- `ops@nromomentum.com` already has company Flow Test (`a94bb8a1-fdbb-423d-bca9-ab63a8e6672a`). Sign in, open הגדרות, paste the CompanyID and the API key, tap חיבור, then רענון עכשיו.
- `eliranazulay@gmail.com` signs in with Google. Onboarding asks for the business name and VAT mode (עוסק מורשה). Then the same SUMIT form.

The key is not returned to the browser. ניתוק deletes the ciphertext, leaves the ledger, and keeps the last SUMIT company id on the Flow company.

Connecting again always clears `reject_attempts`, `next_attempt_at`, and `last_sync_at`. `sumit-connect` calls `listfolders` once before it stores the key. A failed check leaves the ledger and the previous connection alone. When the SUMIT company id differs from the live connection, or from the id remembered by ניתוק, that same transaction retires the previous company's `source = 'sumit'` rows and closes their open review items, so Home does not mix two companies. A manual row stays. Flow Test 2 (`2393153301`) can use a fresh Flow company, or an existing one: Disconnect, then Connect, compares the remembered id and retires the old ledger after that one successful read. Disconnect still keeps the books.

There is no SQL seed for the Flow Test documents. `pnpm seed:demo` refuses to run. The sync writes the rows. Do not insert `demo-data.json` into the hosted database.

## 4. Golden check

In the SQL editor, `company_pnl` allows the service role or the owner. When `auth.uid()` is null, set the role claim first, then call it after a refresh:

```sql
select set_config('request.jwt.claim.role', 'service_role', true);
```

```sql
select public.company_pnl(
  'a94bb8a1-fdbb-423d-bca9-ab63a8e6672a'::uuid,
  null,
  null,
  'invoiced'
);
```

Round `net_profit_agorot` to whole shekels, half to even. Expect:

| Check | Whole shekels |
| --- | --- |
| Company net profit, invoiced | 37,700 |
| Company net profit, cash (`'cash'`) | −76,300 |
| Invoiced income | 472,000 |
| Expenses (direct + shared + overhead) | 434,300 |
| טק-ליין profit after the worker split, invoiced | −29,400 |
| Open receivables, gross | 134,520 |

Open receivables:

```sql
select sum((row->>'open_gross_agorot')::bigint) as open_gross_agorot
from jsonb_array_elements(
  public.list_unpaid()
) as row;
```

`list_unpaid` uses the signed-in user. In the SQL editor, set the request JWT to the owner's id, or open חשבוניות שלא שולמו in the app on כל התקופה. The Vitest answer key is `expected-pnl.json`. The app does not read it.

## 5. Proof on a local stack

This hits the live SUMIT test company. It uses two billed document creates (an invoice and a credit that cancels it). Do not put the API key in the shell history of a shared machine if you can avoid it. Do not commit it.

1. `supabase start`
2. `openssl rand -base64 32` and write `SUMIT_KEK=` into `supabase/.env` (gitignored). `supabase/config.toml` maps that name into the functions. Export it, then restart:

```bash
set -a && source supabase/.env && set +a
supabase stop --no-backup && supabase start
```
3. Build the client against the local API. `supabase status -o env` prints `API_URL`, `ANON_KEY`, and `SERVICE_ROLE_KEY`.

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54321 \
VITE_SUPABASE_ANON_KEY="$ANON_KEY" \
pnpm --filter @flow/app build
SUMIT_LIVE=1 \
VITE_SUPABASE_URL=http://127.0.0.1:54321 \
VITE_SUPABASE_ANON_KEY="$ANON_KEY" \
SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
JWT_SECRET="$JWT_SECRET" \
SUMIT_COMPANY_ID=2389917160 \
SUMIT_API_KEY="$SUMIT_API_KEY" \
pnpm test:e2e:live
```

Flow Test 2 is company `2393153301`. The live check is read-only unless `SUMIT_CREATE_DOCUMENTS=1`. The default run connects, syncs twice, and confirms the saved split without creating a document. Document creates spend the monthly action budget. Do not set that flag for Flow Test 2.

Local email login is off, so the test signs a session with `JWT_SECRET` from `supabase status -o env`. The default run creates an owner, fills פרטי העסק, pastes the CompanyID and key, runs רענון עכשיו, marks ביטוח המגן VAT-exempt with `set_supplier_settings`, then checks Home (כל התקופה, חשבוניות, 37,700), Projects (שיפוץ הרצל 12), and Unpaid (134,520). It enters one shared split with `save_split`. It does not create an invoice or a credit. Those document creates run only when `SUMIT_CREATE_DOCUMENTS=1`, and they spend the monthly action budget. `pg_cron` inserts refresh markers. When `pg_net` is installed and Vault `cron_secret` is set, `flow-sumit-drain` POSTs `sumit-sync` with `x-flow-cron` every five minutes. The local check is `pnpm --filter @flow/app exec playwright test -c playwright.drain.config.ts` with `CRON_SECRET` in `supabase/.env`. Unset `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` before the hosted `pnpm build`, or the local values stay baked into `app/dist`.

## 6. Hosted deploy

Apply the migrations in section 1 on the hosted SQL editor, or `supabase link` to flow-pilot and `supabase db push`. Deploy the functions:

```bash
CRON_SECRET="$(openssl rand -base64 32)"
supabase secrets set SUMIT_KEK="$(openssl rand -base64 32)"
supabase secrets set CRON_SECRET="$CRON_SECRET"
supabase functions deploy sumit-connect
supabase functions deploy sumit-sync --no-verify-jwt
```

Use that same `CRON_SECRET` shell value in the SQL editor. Do not print it. If a secret with that name already exists, update it instead of inserting a second row.

```sql
select vault.create_secret('<the CRON_SECRET value>', 'cron_secret', 'flow drain');
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/sumit-sync', 'flow_sync_url', 'flow drain url');
select private.schedule_drain();
```

Store the Vault rows before `supabase db push` when you want the migration's own `schedule_drain()` call to create the job. If they are stored afterwards, run `select private.schedule_drain();` once. The Flow Test SUMIT account is currently restricted by ActionsBilling obligo, so do not run the live refresh in section 5 until that restriction is lifted.

Use the same `SUMIT_KEK` for both. Build the client with `app/.env.production` (`pnpm build`) and upload `app/dist` to Cloudflare Pages. The project name in the Pages dashboard is the existing Flow project. Do not upload `storybook-static`.

Sign in with Google as ops@nromomentum.com, open הגדרות, tap חיבור SUMIT, paste מספר חברה 2389917160 and the test key, tap חיבור, then רענון עכשיו. On כל התקופה, Home shows 37,700 and חשבוניות שלא שולמו shows 134,520. Repeat the connect for eliranazulay@gmail.com after that account finishes onboarding. Each owner has a separate Flow company. Both may point at the same SUMIT company.

Worker-day splits for this company are created by the sync ([0050](../decisions/0050-demo-splits-and-review.md)). Overhead stays a company total. The after-overhead switch on Home is a view only.
