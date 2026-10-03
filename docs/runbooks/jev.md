# Jev connector

Decision [0083](../decisions/0083-jev-connector.md). J-1 stores the setting and the suggestion table, and reads the API key on the server. It does not label a line and it does not call TypeSafe from CI.

## Secret

| Name | Scope |
| --- | --- |
| `jev_api_key` | TypeSafe Jev API bearer key. One project-wide server secret in Vault. Not a per-company key. Not the SUMIT key. Not an Edge Function env var. |

`public.read_jev_api_key()` is the only read. Execute is `service_role` only, because the tagging job runs as an Edge Function. The function also requires `auth.jwt()->>'role'` to be `service_role`. The production Vault already holds `jev_api_key`. Do not select `decrypted_secret` to check that.

Backlog: an owner-only RPC that returns `has_key` and the last `jev-tag` run or error. The Settings card does not show a missing key until that exists. Do not add it while another migration is in the slot.

This permission check is read-only. It does not read the secret.

```sql
select
  has_table_privilege('anon', 'vault.decrypted_secrets', 'select') as anon_vault,
  has_table_privilege('authenticated', 'vault.decrypted_secrets', 'select') as member_vault,
  has_function_privilege('anon', 'public.read_jev_api_key()', 'execute') as anon_key,
  has_function_privilege('authenticated', 'public.read_jev_api_key()', 'execute') as member_key,
  has_function_privilege('service_role', 'public.read_jev_api_key()', 'execute') as service_key,
  has_table_privilege('authenticated', 'public.tag_suggestions', 'select') as member_read,
  has_table_privilege('authenticated', 'public.tag_suggestions', 'insert') as member_insert,
  has_table_privilege('authenticated', 'public.company_integrations', 'update') as member_update;
```

`anon_vault`, `member_vault`, `anon_key`, `member_key`, `member_insert`, and `member_update` are false. `service_key` and `member_read` are true.

## Bundle scan

`node scripts/check-jev-bundle.mjs [dir...]` scans a built PWA directory. The default directory is `app/dist`.

The check job should run it on the hosted dist and on the reviewers-only dist, after each build. `package.json` chains it from `check:bundle` and `check:reviewer-bundle`, which the check job already runs. `scripts/check-prod-bundle.mjs` imports `jevBundleNeedles` from this script, so the hosted and reviewer scans use that one list. A CI change that rewrites those scripts should keep `node scripts/check-jev-bundle.mjs` on each dist.

| Exit | Meaning |
| --- | --- |
| 0 | Clean. The directory has none of the needles. |
| 1 | A file contains `jev_api_key`, `JEV_API_KEY`, `vault.decrypted_secrets`, `read_jev_api_key`, or `api.typesafe.ai`. |
| 2 | Incomplete. A path is missing, is not a directory, or has no files. |
| 3 | Crash. `--crash` is the probe for this code. It is not a scan result. |

Every run prints `secret jev_api_key scope=typesafe-jev-api-bearer server-only`. A hit prints the file and the needle. It does not print the file's contents.

## Client tests

`deno test --no-prompt --no-lock supabase/functions/_shared`

No network permission and no env permission. `--no-lock` keeps Deno from writing a repo-root `deno.lock` for this folder. `package.json` `test` runs that command, and the check job already runs `pnpm test` after Deno is installed. Do not add `--allow-net`.

## Tagging job

`supabase/functions/jev-tag` labels open לאישור expenses that have no suggestion for `jev-1.13.0`. The stored row's `model_version` is that pin. `response_model` is the model string the API returned. Decision [0084](../decisions/0084-jev-auto-prefill.md). Tests call the mock. The function does not call TypeSafe in CI.

`enabled` false disables a company. `mode` `off` disables it as well. Either one is enough, and the job does not call Jev for that company.

The caller is either `x-flow-cron` matching `CRON_SECRET`, or `Authorization: Bearer` matching the `default` field of `SUPABASE_SECRET_KEYS`. `CRON_SECRET` is the existing secret used by `sumit-sync`. Scope: the internal cron caller. It is not `jev_api_key`. A member JWT, a missing header, an empty header, a wrong non-empty header, and a bearer that does not match the service key are 401 and do not label anything. The legacy `SUPABASE_SERVICE_ROLE_KEY` variable is not read. A bearer call when `SUPABASE_SECRET_KEYS` is missing is 401, because there is no key to match. The 500 `missing_key` for that missing value applies only to a cron caller: the cron header already matched, and the function still cannot read the database without the service key. It does not call Jev. A missing `SUPABASE_URL` is 500 `missing_key` for any accepted caller.

An accepted call reserves the isolate for 60 seconds. The next call in that window is 429 `rate_limited` and does not call Jev. That limit is in memory until a cron exists. A database run lock is backlog with the cron.

One run labels at most 50 expenses. A request may set `limit`; values above 100 are clamped to 100, and a missing or unusable limit stays 50. That cap is split across the enabled companies in company-id order. The first companies get one extra line when the cap does not divide evenly. A company with a long backlog cannot take another company's share. The candidate query orders by `doc_date` descending and applies that company's share in SQL. It does not put every open id in the URL. An approved review line is not sent. An overhead line, a shared cost, or a split with more than one allocation is not asked for a project. That call sends the category question only, and the stored suggestion has no project. Each expense is at most 2 attempts of 8 seconds. The run budget is 120 seconds. A new call is not started when fewer than 20 seconds of that budget remain, so the last call still finishes under the 150 second Edge limit. Lines that were not started are `budget_skipped`. TypeSafe accepts `{ model, state, questions }` only. It has no max-output field, so the job does not send one. The response and the function log include `input_tokens` and `output_tokens`. Those are counts. The log does not include the expense text or the answers.

Project names and category names are sent to TypeSafe as the choice labels. That is the owner's own data. Amounts may be included in the request state. The job does not write amounts, VAT, or dates.

The function does not read `jev_api_key` when no enabled company has a line to label.

## Hand trigger

The function is not on a schedule. Adding `pg_cron` would be a migration, and this change does not add one. The first shadow run is a manual POST. `verify_jwt` is false in `supabase/config.toml`. The function checks the caller itself.

Secrets that must exist before that call:

| Name | Where |
| --- | --- |
| `jev_api_key` | Vault. Already in production. Not an Edge Function env var. |
| `SUPABASE_URL` | Injected by Supabase. |
| `SUPABASE_SECRET_KEYS` | Injected by Supabase. The hand trigger's bearer is the `default` field. Do not print it and do not commit it. |
| `CRON_SECRET` | Only for an `x-flow-cron` caller. The curl below uses the service role and does not send that header. |

`SUPABASE_URL` is the project URL. Export it in the shell. Read the service-role key with `read -rs` so it is not echoed and not written to shell history. While `curl` is running, that key is in the process arguments, so `ps` can show it. Unset it when the request returns.

```bash
export SUPABASE_URL="https://sxqpnetmtufkzowutduq.supabase.co"
read -rs SERVICE_ROLE_KEY
echo
curl -sS -X POST "$SUPABASE_URL/functions/v1/jev-tag" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"company_id":"COMPANY_UUID","limit":50}'
unset SERVICE_ROLE_KEY
```

`company_id` is optional. Omit it, and send `{}` or no body, to label every enabled company up to the cap. A `company_id` that is not a UUID is 400 and does not call Jev. A wrong bearer is 401 and does not call Jev.

The deploy step ships `jev-tag` with the same `supabase functions deploy` command as `flow-mcp`.

`supabase/pending/20261004120000_jev_auto_mode.sql` allows `mode` `auto`. It is not in `supabase/migrations.lock`. Do not apply it until the migration slot is free.
