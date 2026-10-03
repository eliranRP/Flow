# Jev connector

Decision [0083](../decisions/0083-jev-connector.md). J-1 stores the setting and the suggestion table, and reads the API key on the server. It does not label a line and it does not call TypeSafe from CI.

## Secret

| Name | Scope |
| --- | --- |
| `jev_api_key` | TypeSafe Jev API bearer key. One project-wide server secret in Vault. Not a per-company key. Not the SUMIT key. Not an Edge Function env var. |

`public.read_jev_api_key()` is the only read. Execute is `service_role` only.

## Bundle scan

`node scripts/check-jev-bundle.mjs [dir...]` scans a built PWA directory. The default directory is `app/dist`.

The check job should run it on the hosted dist and on the reviewers-only dist, after each build. `package.json` chains it from `check:bundle` and `check:reviewer-bundle`, which the check job already runs. A CI change that rewrites those scripts should keep `node scripts/check-jev-bundle.mjs` on each dist.

| Exit | Meaning |
| --- | --- |
| 0 | Clean. The directory has none of the needles. |
| 1 | A file contains `jev_api_key`, `JEV_API_KEY`, `vault.decrypted_secrets`, or `read_jev_api_key`. |
| 2 | Incomplete. A path is missing or is not a directory. |
| 3 | Crash. `--crash` is the probe for this code. It is not a scan result. |

Every run prints `secret jev_api_key scope=typesafe-jev-api-bearer server-only`. A hit prints the file and the needle. It does not print the file's contents.

## Client tests

`deno test --no-prompt --no-lock supabase/functions/_shared`

No network permission and no env permission. `--no-lock` keeps Deno from writing a repo-root `deno.lock` for this folder. `package.json` `test` runs that command, and the check job already runs `pnpm test` after Deno is installed. Do not add `--allow-net`.
