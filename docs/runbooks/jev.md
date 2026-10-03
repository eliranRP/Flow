# Jev connector

Decision [0083](../decisions/0083-jev-connector.md). J-1 stores the setting and the suggestion table, and reads the API key on the server. It does not label a line and it does not call TypeSafe from CI.

## Secret

| Name | Scope |
| --- | --- |
| `jev_api_key` | TypeSafe Jev API bearer key. One project-wide server secret in Vault. Not a per-company key. Not the SUMIT key. Not an Edge Function env var. |

`public.read_jev_api_key()` is the only read. Execute is `service_role` only, because the tagging job runs as an Edge Function. The function also requires `auth.jwt()->>'role'` to be `service_role`. The production Vault already holds `jev_api_key`. Do not select `decrypted_secret` to check that.

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

The caller is either `x-flow-cron` matching `CRON_SECRET`, or `Authorization: Bearer` matching `SUPABASE_SERVICE_ROLE_KEY`. `CRON_SECRET` is the existing secret used by `sumit-sync`. Scope: the internal cron caller. It is not `jev_api_key`. A member JWT, a missing header, and a wrong secret are 401 and do not label anything.

An accepted call reserves the isolate for 60 seconds. The next call in that window is 429 `rate_limited` and does not call Jev.

The function is not on a schedule. Adding `pg_cron` would be a migration. The deploy workflow deploys `flow-mcp` only, and this change does not edit that workflow.

`supabase/pending/20261004120000_jev_auto_mode.sql` allows `mode` `auto`. It is not in `supabase/migrations.lock`. Do not apply it until the migration slot is free.
