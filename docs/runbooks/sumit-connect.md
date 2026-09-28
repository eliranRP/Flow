# Connect SUMIT on flow-pilot

Apply the migration first, then deploy the two functions, then paste the key in the app. Do not commit the SUMIT key or the service-role key.

## 1. Migration

Apply, in order, on the hosted SQL editor or with `supabase db push`:

1. `supabase/migrations/20260927120000_schema_v1.sql` (already applied)
2. `supabase/migrations/20260928140000_phase1_slice.sql`

`pg_cron` is optional. If it is missing, the migration still finishes and the daily marker is skipped.

## 2. Edge Functions

Deploy `sumit-connect` and `sumit-sync` from `supabase/functions/`. Each folder has `index.ts`, `deno.json`, and `import_map.json`. They import `../_shared/`.

Secrets, names only:

| Name | Required | How to create it |
| --- | --- | --- |
| `SUMIT_KEK` | yes | `openssl rand -base64 32` (32 bytes). Same value on both functions. |
| `CRON_SECRET` | no | any long random string, only if you will POST the daily drain |

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase. Do not copy the service-role key into the repo or the browser.

## 3. Two owners, one SUMIT company

Each Google user has their own Flow company. Both can point at SUMIT CompanyID **2389917160**.

- `ops@nromomentum.com` already has company Flow Test (`a94bb8a1-fdbb-423d-bca9-ab63a8e6672a`). Sign in, open הגדרות, paste the CompanyID and the API key, tap חיבור, then רענון עכשיו.
- `owner@example.com` signs in with Google. Onboarding asks for the business name and VAT mode (עוסק מורשה). Then the same SUMIT form.

The key is not returned to the browser. ניתוק deletes the ciphertext and leaves the ledger.

There is no SQL seed for the Flow Test documents. `pnpm seed:demo` refuses to run. The sync writes the rows. Do not insert `demo-data.json` into the hosted database.

## 4. Golden check

In the SQL editor (the role is postgres, so `auth.uid()` is null and `company_pnl` is allowed), after a refresh:

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

`list_unpaid` uses the signed-in user. In the SQL editor, set the request JWT to the owner's id, or open חשבוניות פתוחות in the app on כל התקופה. The Vitest answer key is `expected-pnl.json`. The app does not read it.

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

Local email login is off, so the test signs a session with `JWT_SECRET` from `supabase status -o env`. It creates an owner, fills פרטי העסק, pastes the CompanyID and key, runs רענון עכשיו, then checks Home (כל התקופה, חשבוניות, 37,700), Projects (שיפוץ הרצל 12), and Unpaid (134,520). It creates one invoice in SUMIT, waits out the one-minute force gap, refreshes, and expects that description on Unpaid. It then creates a credit, links it to that invoice, and checks the totals again. Unset `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` before the hosted `pnpm build`, or the local values stay baked into `app/dist`.

## 6. Hosted deploy

Apply the migrations in section 1 on the hosted SQL editor, or `supabase link` to flow-pilot and `supabase db push`. Deploy the functions:

```bash
supabase secrets set SUMIT_KEK="$(openssl rand -base64 32)"
supabase functions deploy sumit-connect
supabase functions deploy sumit-sync
```

Use the same `SUMIT_KEK` for both. Build the client with `app/.env.production` (`pnpm build`) and upload `app/dist` to Cloudflare Pages. The project name in the Pages dashboard is the existing Flow project. Do not upload `storybook-static`.

Sign in with Google as ops@nromomentum.com, open הגדרות, paste CompanyID 2389917160 and the test key, tap חיבור, then רענון עכשיו. On כל התקופה and חשבוניות, Home shows 37,700 and חשבוניות פתוחות shows 134,520. Repeat the connect for owner@example.com after that account finishes onboarding. Each owner has a separate Flow company. Both may point at the same SUMIT company.

Worker-day splits for this company are created by the sync ([0050](../decisions/0050-demo-splits-and-review.md)). Overhead stays a company total. The after-overhead switch on Home is a view only.
