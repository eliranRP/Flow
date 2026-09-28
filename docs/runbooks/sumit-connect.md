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
- `eliranazulay@gmail.com` signs in with Google. Onboarding asks for the business name and VAT mode (עוסק מורשה). Then the same SUMIT form.

The key is not returned to the browser. ניתוק deletes the ciphertext and leaves the ledger.

There is no SQL file for the Flow Test documents. The sync writes them. `pnpm seed:demo` is the offline fallback for a demo company, and it refuses a company that is not `is_demo`.

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

`list_unpaid` uses the signed-in user. In the SQL editor, set the request JWT to the owner's id or compare the figure in the app on כל התקופה. The Vitest `demo/model.test.ts` is the same check against the fixture.

Worker-day splits for this company are created by the sync ([0050](../decisions/0050-demo-splits-and-review.md)). Overhead stays a company total. The after-overhead switch on Home is a view only.
