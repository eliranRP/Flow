# Jev connector

Decision [0083](../decisions/0083-jev-connector.md). J-1 stores the setting and the suggestion table, and reads the API key on the server. It does not label a line and it does not call TypeSafe from CI.

## Secret

| Name | Scope |
| --- | --- |
| `jev_api_key` | TypeSafe Jev API bearer key. One project-wide server secret in Vault. Not a per-company key. Not the SUMIT key. Not an Edge Function env var. |

`public.read_jev_api_key()` is the only read. Execute is `service_role` only, because the tagging job runs as an Edge Function. The function also requires `auth.jwt()->>'role'` to be `service_role`.

## Bundle scan

`node scripts/check-jev-bundle.mjs [dir...]` scans a built PWA directory. The default directory is `app/dist`.

The check job should run it on the hosted dist and on the reviewers-only dist, after each build. `package.json` chains it from `check:bundle` and `check:reviewer-bundle`, which the check job already runs. A CI change that rewrites those scripts should keep `node scripts/check-jev-bundle.mjs` on each dist.

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

The caller sends `x-flow-cron`. That secret is the existing `CRON_SECRET` used by `sumit-sync`. Scope: the internal cron caller. It is not `jev_api_key`. A missing or wrong cron secret does not label anything.

The function is not on a schedule. Adding `pg_cron` would be a migration. The deploy workflow deploys `flow-mcp` only, and this change does not edit that workflow.
