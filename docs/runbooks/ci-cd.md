# CI and CD

GitHub Actions runs the checks and the production deploy from `.github/workflows/ci.yml`. Secrets stay in GitHub. They are not written in the repo.

## Local CI on pull requests

GitHub runs no CI on pull requests. Each push to a PR branch is checked on the pusher's machine instead. `bash scripts/cloud-agent-install.sh` sets `core.hooksPath` to `.githooks`, and `.githooks/pre-push` runs `scripts/local-ci.sh` before the push leaves. A failure stops the push.

- By default (about 4 minutes) it runs lint, the `check (core)` steps, and `pnpm test:storybook`, in parallel where it can. The migration order check compares against the lock at the merge base with `main`.
- `FLOW_LOCAL_CI=full git push`, or `bash scripts/local-ci.sh --full`, also runs the Storybook build and smoke specs, local Supabase with pgTAP, the db types check, the deploy preflight, and the main Playwright suite (about 12 minutes).
- The tree must be clean. A pass writes the commit sha to `.git/flow-local-ci`, so pushing the same commit again does not rerun it.

## When main runs CI and deploys

A push to `main`, or a manual run (Actions, then `ci`, then Run workflow), starts the `ci` workflow. Its first job, `plan`, runs `scripts/ci-deploy-plan.sh`. A manual run always continues. A push continues only when at least 5 first-parent commits have landed since the newest `production` deployment whose last status is success, or when there is no such deployment. Otherwise every other job is skipped, and the run summary says how many merges are waiting. When the run continues, it runs the full suite and then deploys.

## What CI runs

On a push to `main` that `plan` lets through, and on a manual run:

- `pnpm install --frozen-lockfile`, typecheck, lint (its own job), and unit tests for `@flow/app` and `@flow/shared`
- the hosted build, `pnpm check:bundle`, the reviewers-only build, and `pnpm check:reviewer-bundle`
- Storybook's browser tests, the Storybook build, and the layout tests
- local Supabase (`supabase start`, CLI 2.118.0), then `supabase test db`, then the main Playwright suite pointed at that local API

The required jobs are `lint`, `check`, and `e2e`. `check` and `e2e` are gate jobs: each passes only when every job under it succeeded. Under `check`: `check (core)` runs the migration checks, Deno, typecheck, `pnpm test:unit` (the `@flow/app` suite included), the connector tests, and both dist builds; `check (storybook)` runs `pnpm test:storybook` and every storybook smoke spec except the every-story test; `check (stories 1/2)` and `check (stories 2/2)` each run half of the every-story test, which is split into 8 tests. `scripts/ci-cd.test.mjs` pins the `test:unit` script, so a new part there must also be added to `check (core)`. Under `e2e`, `e2e (1/2)` and `e2e (2/2)` each start local Supabase in the background while dependencies install (without studio, logs, mail, image, pooler, and realtime), then run half of the main Playwright suite. Shard 1 also runs pgTAP, the db types check, the deploy preflight, and the SUMIT cron check. The main Playwright command does not run `sumit-live` or the drain spec. Those stay on `pnpm test:e2e:live` and `playwright.drain.config.ts`. CI caches the pnpm store, the Playwright browsers, and the `.deb` files Playwright's `install-deps` downloads (`scripts/ci-apt-cache.sh`), because the Ubuntu mirror can stall on the font packages past the step's time limit (8 minutes). Its `install` step asks `playwright install-deps --dry-run` which packages are missing and installs them from the cached files with `apt-get install --no-download`, so a warm cache never runs `apt-get update` or touches the mirror. Only when the cache does not cover every package does it run `apt-get update` and download the rest. Every `apt-get` that reaches the mirror (including the `psql` step, which skips apt when the runner already has `psql`) is cut off after 100 seconds and tried once more against `archive.ubuntu.com`, because the Azure mirror can trickle for many minutes. Each run saves a new cache entry and restores the newest one, older keys included. Actions caches are scoped to a branch, so a pull request reads the cache that `main` saved.

`pnpm check:bundle` requires the hosted Supabase URL and anon key in the dist. The key must decode to role `anon` and ref `sxqpnetmtufkzowutduq`. The dist must not contain `service_role` or an `sb_secret_` key. The quoted `sb_secret_` prefix that supabase-js uses to refuse a secret key is allowed. A reviewers-only build fails that check, so it is not what gets deployed.

## What the deploy runs

Deploy is the `deploy` job in the same workflow. It runs only on `main`, only when `plan` lets the run through, and only after `lint`, `check`, and `e2e` have succeeded on that commit. It uses the GitHub environment `production`.

If a required secret is missing, or the pepper has the wrong shape, the job fails before the build. That shape check does not prove the access token works. Before migrations and Pages, `supabase functions list --project-ref sxqpnetmtufkzowutduq` does. A missing, invalid, or expired token fails that probe, and the job stops. There is no skip path. Nothing is migrated and Pages is not published. It does not record a successful production deployment. Add the secret on the `production` environment and push to `main` again. If the function step fails after migrations and Pages, push to `main` again. The probe runs again. `db push` applies only migrations that are still pending. The pepper file is created only in the function step.

When the secrets are present, in this order:

1. The hosted dist is built from that commit, stamped with the commit SHA, and checked with `pnpm check:bundle`. A failed build or a failed check stops the job. The database is unchanged and the previous app stays live.
2. The job runs `supabase functions list --project-ref sxqpnetmtufkzowutduq`. That probe is read-only. It does not write the pepper file. If it fails, migrations and Pages do not run.
3. The job runs `bash scripts/cd-preflight.sh` before any SUMIT deploy. A read-only preflight opens the session pooler. It refuses the session unless the last line of the read-only check is `on`. It reads versions `20260929240000`, `20260929250000`, and `20260929260000`. When all three are recorded, it skips `scripts/preflight-r23.sql`. When any is missing, it runs that query and continues only when `rule_transactions_at_risk` and `rule_undo_rows_at_risk` are both 0. It then runs `supabase db push --db-url "$SUPABASE_DB_URL" --dry-run --output-format json` and classifies the output with `--target remote`. CLI 2.118.0 prints a JSON object when `--output-format json` is set, and also when a coding-agent variable is set (`CURSOR_AGENT`, `CURSOR_TRACE_ID`, and the others in `@vercel/detect-agent`). `CI=true` does not select JSON, and a non-TTY stdout does not either, so the GitHub Actions e2e job printed plain text until this flag was passed. The deploy job passes the flag, so it emits the JSON object. The classifier requires that object and the DRY RUN line. Up to date means `upToDate` is true and `migrations`, `seeds`, and `roles` are empty. Production also requires `message` to start with `Remote`. A non-empty `migrations` array is pending. A pending text list next to an up-to-date result fails, and pending JSON next to an up-to-date text line fails. When both lists are present, the names must be equal. A log with no JSON result fails. Nothing is pushed.
4. The job deploys `sumit-sync`, `sumit-connect`, and `sumit-reseal` with `supabase functions deploy`, then runs `bash scripts/cd-sumit-reseal.sh`. That script reads Vault `cron_secret`, registers it with `::add-mask::` on GitHub Actions, and POSTs `sumit-reseal` with the header on stdin (`-H @-`). It does not print the secret. `sumit-connect` still seals format 2. `flow-mcp` and `jev-tag` stay in the later function step. A failed reseal stops the job before `db push`.
5. `bash scripts/cd-push.sh` runs the preflight again, then `supabase db push --db-url "$SUPABASE_DB_URL"` applies pending migrations. Seed data is not included. The database is not reset. Success is the command's exit code. The next command is `bash scripts/check-sumit-cron.sh`. It opens a read-only session and reads `cron.job`. It does not schedule a job. `flow-connector-daily` must be one row at `0 3 * * *` with the connector refresh insert. `flow-connector-drain` must be one row at `*/5 * * * *` when Vault `cron_secret` is non-empty and `pg_net` is installed, and must be absent otherwise. When that job should exist, Vault `flow_sync_url` must be non-empty and the command must read that URL. The command must not contain `http://kong:8000/functions/v1/sumit-sync` and must not put a literal in the `x-flow-cron` header. `cron_secret` decides whether the drain should exist. `flow_sync_url` is the drain URL. The check does not print either value.
6. `pnpm exec wrangler pages deploy` publishes that dist to the Cloudflare Pages project `flow-app` on the production branch `main`. Wrangler 4.144.0 comes from the lockfile. Success is the command's exit code.
7. The job writes `FLOW_MCP_PEPPER` and `FLOW_MCP_APP_ORIGINS` into a file from `mktemp "$RUNNER_TEMP/..."`, with a trap on EXIT, INT, and TERM, and an `if: always()` step that deletes the file. This is the only step that writes that file. `supabase secrets set --env-file` reads it. The origin list is `https://flow-app-dx5.pages.dev` only. The job then runs `supabase functions deploy flow-mcp --project-ref sxqpnetmtufkzowutduq` and `supabase functions deploy jev-tag --project-ref sxqpnetmtufkzowutduq`. `verify_jwt` stays false, from `supabase/config.toml`. The job does not set `FLOW_MCP_SIGNING_KEY`, `FLOW_JWT_LEGACY`, or `FLOW_SECRET_KEY`. Hosted functions receive `SUPABASE_SECRET_KEYS` from Supabase. The deploy token can read those injected secrets. `SUPABASE_DB_URL` is in the same GitHub environment.
8. A read-only fetch of `https://flow-app-dx5.pages.dev` checks that the last line of `build.txt` is that commit SHA, and that the homepage and `/settings?preview=1` contain the stamped `flow-build` meta tag. `build.txt` and the homepage each retry up to 18 times with a 10 second pause. Each attempt adds its number to `n`, so a cached page from an earlier attempt cannot satisfy a later one. `/settings?preview=1` is fetched once, after the homepage matches, with `n` set to the commit SHA. `/settings?preview=1` must be status 200 with `Content-Type: text/html`. A missing file under `/assets/` must be 404. A curl failure names the URL and the curl error. That check is the Pages hostname. A production smoke of `flow-mcp` is backlog N8. It is not this step.
9. After that hostname check, Playwright signs in as the smoke user, a viewer of the demo company Flow Test, and opens `/`, `/projects`, `/review`, and `/settings`. The smoke config reads `SMOKE_BASE_URL` and otherwise uses `https://flow-app-dx5.pages.dev`. The deploy job sets `SMOKE_COMPANY_NAME` to Flow Test. The company name has to match that value exactly. Unset, outside this job, the check still expects Flow Test. It does not open a project, a transaction, or a category. It waits until the stored session has an access token, and the list reads wait for that token on the client, before those RPCs are sent. A slow `getSession` is awaited, and the list stays loading until it answers. It waits for that screen's list RPCs to return 200 before the next screen. Those RPCs are `get_dashboard`, `list_unpaid`, `list_review`, and `sumit_status`. Settings also selects `company_integrations` and POSTs `flow-mcp/status`, and that status call is on the allowlist. The settings screen waits for that POST. Every `/functions/v1/` response has to allow `authorization`, `apikey`, `content-type`, and `x-client-info`. A console error while Settings is open fails the check. SUMIT is a static row for this viewer, not a button. הוספה, אישור, and פרויקט חדש are absent. Auth calls on the allowlist are GET `/auth/v1/user` and POST `/auth/v1/token`, plus the OPTIONS preflight for those two paths. Any other `/auth/v1/` path is aborted. `list_categories`, `project_waiting`, `list_project_category`, `list_auto_assigned_today`, `private.filed_today_rows`, and `search_transactions` stay on the owner and return empty for a viewer. The smoke does not call them and does not assert their rows. Any other request, including a write or a SUMIT call, is aborted before it is sent. A console error or a 4xx or 5xx response fails the check. When `SMOKE_EMAIL` or `SMOKE_PASSWORD` is unset, the step writes a warning to the job summary and exits 0. That does not fail the deploy. A failed smoke writes a job summary that production is already live and that the Playwright smoke failed. The summary does not include the Playwright log. That log stays in the step log. Then the step exits 1. Pages is not rolled back. The smoke retries once. When the first attempt fails and the retry passes, the job summary gets a warning and the deploy still succeeds. Provisioning and the reads a viewer gets are in [the smoke-user runbook](smoke-user.md).

`scripts/cd-smoke.sh` uses these exits:

| Exit | Outcome |
| --- | --- |
| 0 | `build.txt`, the homepage, `/settings`, and a missing asset match this commit |
| 1 | The SHA was missing, a body did not include the build tag, or a fetch failed |
| 2 | `/settings?preview=1` was not 200 HTML |
| 3 | A missing asset was not 404 |

`scripts/check-sumit-cron.sh` in step 5 uses these exits:

| Exit | Outcome |
| --- | --- |
| 0 | `flow-connector-daily` and `flow-connector-drain` match the schedule rules |
| 1 | Incomplete. `SUPABASE_DB_URL` is missing, `psql` failed, or the status line was not a known token |
| 2 | `flow-connector-daily` is missing, or its schedule or command is wrong |
| 3 | `flow-connector-drain` is missing, extra, or has the wrong schedule or command, or Vault `flow_sync_url` is missing while `cron_secret` and `pg_net` are present |
| 4 | `cron.job` is missing. `pg_cron` is not installed |

If exit 3 is because `flow-connector-drain` is missing while Vault `cron_secret` and `pg_net` are present, set Vault `flow_sync_url` to the functions URL and run `select private.schedule_connector_jobs();` as `service_role`. The check does not schedule the job.

To run only the read-only preflight against production, set `SUPABASE_DB_URL` to the session pooler URL and run `bash scripts/cd-preflight.sh`. That script does not apply migrations. Its commands are:

```bash
node scripts/cd-db-url.mjs
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -X -q -At -F '|' --single-transaction \
  -c "SET TRANSACTION READ ONLY" \
  -c "SELECT current_setting('transaction_read_only');"
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -X -q -At -F '|' --single-transaction \
  -c "SET TRANSACTION READ ONLY" \
  -c "SELECT version FROM supabase_migrations.schema_migrations WHERE version IN ('20260929240000', '20260929250000', '20260929260000') ORDER BY version;"
# When any of those three versions is missing:
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -X -q -At -F '|' --single-transaction \
  -c "SET TRANSACTION READ ONLY" \
  -f scripts/preflight-r23.sql
supabase --yes db push --db-url "$SUPABASE_DB_URL" --dry-run --output-format json
```

The script then classifies that dry-run with `node scripts/cd-output.mjs dry-run --target remote`.

The e2e job runs the same script against local Supabase, including a dry-run that lists one fixture migration and checks it was not applied.

The reviewers-only build is not deployed. The deploy does not run the live SUMIT specs and does not call an API that writes product data.

Deploy order and the flow-mcp jobs: migrations (step 5) land before the function deploy (step 7), so for a short window the new database runs with the old `flow-mcp`. When a migration changes the `sync_bank` job functions, a pull that finishes in that window can be lost (its job reads `retry` after 5 minutes) or `sync_bank` can be refused until `flow-mcp` is deployed. Nothing is written twice; the client starts the sync again ([FLOW-207](../backlog/TASKS.md#flow-207)).

## Secrets

These secrets live only on the GitHub environment `production`. The repository copies are deleted. The environment is restricted to `main` and has no required reviewer. The deploy job selects that environment, which is how it can read them. A job that does not select `production` cannot see them.

Required approving reviews on `main` stay at 0. `.github/CODEOWNERS` notifies `@eliranRP` and does not block. Both reviewer bots are expected to approve the pull request, and its head is expected to have passed the pre-push check, before merge. GitHub does not require those approvals. The batch then deploys on its own after `lint`, `check`, and `e2e` pass on `main`. Decision [0079](../decisions/0079-automatic-deploy-owner-risk.md) records that as an accepted owner risk.

| Name | What it is |
| --- | --- |
| `SUPABASE_DB_URL` | Session pooler URL for project `sxqpnetmtufkzowutduq`. Shape: `postgresql://postgres.sxqpnetmtufkzowutduq:<password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require`. Percent-encode the password. Port 5432 is the session pooler. |
| `CLOUDFLARE_API_TOKEN` | API token with Pages Edit on Cloudflare Pages project `flow-app`. |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account that owns `flow-app`. |
| `SUPABASE_ACCESS_TOKEN` | A scoped personal access token for project `sxqpnetmtufkzowutduq` only. Permissions: Edge Functions Read-write, and Edge Function Secrets Read-write. Expiry: 30 days. An empty token fails the deploy. A shape mismatch is a warning and does not fail the deploy. The functions list probe is the check. The expiry date is recorded under [Access token expiry](#access-token-expiry). Renew about 5 days before that date: create another token with the same project and the same two permissions, replace this secret, revoke the old token, and write the new date in that section. |
| `FLOW_MCP_PEPPER` | HMAC pepper for the MCP secret. JSON object with `kid` and `secret`. Both use only `A-Za-z0-9_-`. `secret` is at least 32 bytes. Optional `previous` is an array of the same objects. When the pepper changes, move the old object into `previous` so existing tokens keep working. |
| `SMOKE_EMAIL` | Email of the read-only smoke user. Optional. A missing value writes a job-summary warning, skips the live Playwright check, and does not fail the deploy. |
| `SMOKE_PASSWORD` | Password of that user. Optional, same skip. Do not write it here. |

Generate the pepper on your machine and paste the JSON into the GitHub secret. Do not commit it and do not print it into a pull request:

```bash
node --input-type=module -e 'const bytes = new Uint8Array(32); crypto.getRandomValues(bytes); const secret = Buffer.from(bytes).toString("base64url"); if (Buffer.byteLength(secret) < 32) throw new Error("short"); process.stdout.write(JSON.stringify({ kid: "mcp-pepper-1", secret }));'
```

Create the access token at <https://supabase.com/dashboard/account/tokens>:

1. Generate a new token and choose a scoped token, not a classic token.
2. Set the expiry to 30 days.
3. Limit the resource to the selected project `sxqpnetmtufkzowutduq`. Do not select every organization or any other project.
4. Grant only Edge Functions with Read-write, and Edge Function Secrets with Read-write.
5. Copy the value into the GitHub environment `production` as `SUPABASE_ACCESS_TOKEN`. Do not write the token, or any prefix of it, into this runbook.
6. Write the expiry date in [Access token expiry](#access-token-expiry). A renewal reminder is scheduled by the owner's assistant about 5 days before that date.

## Access token expiry

The scoped token lasts 30 days. This runbook is where the date is kept. When you create or renew the token, fill in the row. A renewal reminder is scheduled by the owner's assistant about 5 days before the expiry date.

| Expires | Renew by |
| --- | --- |
| 2026-10-30 | 2026-10-26 |

The reminder for 2026-10-26 is already scheduled by the owner's assistant.

## Signing key

On 2026-09-30, about 18:10 IDT, the standby path passed. Do not click "Rotate keys". Rotating the standby key makes it Auth's session key. Do not create another key.

| Key | Status |
| --- | --- |
| ES256 `46a0230c-733c-401d-a3fb-4a2d9ee7de72` | standby. Imported through the dashboard. This is the function's signer |
| ES256 `985184ff-0c58-4ffd-a4a5-d7322027aee6` | current. Auth's session key. Unchanged |
| HS256 `df08281f` | previous |

The standby kid appears in the hosted JWKS. Standby status was confirmed in the dashboard's JWT Keys list. The Management API was not used for that check, because there was no local management token.

`FLOW_MCP_SIGNING_KEY` is set as a Supabase function secret. `FLOW_JWT_LEGACY` is not set, and it is not needed. A 60-second ES256 pass for the owner of Flow Test got `get_dashboard` 200 with that company's id. A pass for the Erie owner got 200 with the Erie company, not Flow Test's. GET `flow-mcp` returns 405, and the response includes `x-flow-cf-connecting-ip`. The local copy of the private key is deleted. The only copy is in Supabase: the standby key and the function secret. After merge, production read tools use this signer.

Reads need this key. Without it, `tools/list` is empty and `tools/call` returns a tool error with `isError`, not HTTP 503. Prove the key with the spike before the production secret is set.

Write tools shipped after the first connections. The migration sets every existing MCP token to `read` only. Those connections do not gain write. The owner opens Settings, disconnects עוזר, and connects again. A new token still defaults to read and write. A deadlock or a serialization failure on a write returns the tool error `unavailable` with message `retry`. That response is not stored, so the same idempotency key can be sent again.

The procedure, in this order:

1. Open the project's JWT signing keys in the Supabase dashboard. Create one ES256 key and leave it in standby. Do not rotate it.
2. On your machine, set `FLOW_SPIKE_PROJECT_REF` (the spike does not embed a project ref), `SUPABASE_ACCESS_TOKEN`, and the private key as `FLOW_MCP_SIGNING_KEY` in the environment only. Also set `FLOW_MCP_SPIKE_USER`, `FLOW_MCP_SPIKE_OTHER`, `FLOW_MCP_SPIKE_COMPANY`, and `FLOW_SPIKE_PUBLISHABLE_KEY`. Run `node scripts/mcp-signing-spike.mjs`. The script prints no key material.
3. Only after that exit is 0, put the private key in the Edge Function secret `FLOW_MCP_SIGNING_KEY`. Do not put it in GitHub. Delete the local copy after the secret is set.
4. If the spike reports that PostgREST rejected the standby key, set the function secret `FLOW_JWT_LEGACY` in the dashboard instead, and retire it before the end of 2026. Do not put that name in GitHub. The 18:10 IDT run did not take that path.

| Exit | Outcome |
| --- | --- |
| 0 | Pass. Standby status, PostgREST, and the connecting-ip header all passed |
| 1 | Criterion 1 failed, including a kid that is not the standby key |
| 2 | Incomplete. A token, project ref, key, or spike env is missing, or the Management API was not ok |
| 3 | Criterion 3 failed. PostgREST rejected the standby key, or the other user saw this company |
| 4 | Criterion 4 failed. `cf-connecting-ip` did not reach the function |

The 18:10 IDT pass was read from the dashboard JWT Keys list, before this script parsed the Management API object. Do not rotate the key to repeat it.

The public anon key is already in `app/.env.production`. Do not add a `service_role` JWT, an `sb_secret_` key, `FLOW_SECRET_KEY`, `FLOW_JWT_LEGACY`, or `FLOW_MCP_SIGNING_KEY`. The access token is still powerful: Edge Function Secrets Read-write can read the keys Supabase injects into the function, and `SUPABASE_DB_URL` in this same environment is the database connection string.

## Roll back a Pages deploy

The previous production deployment stays in the Cloudflare Pages project `flow-app`.

1. Open the project, then Deployments.
2. On the last good production deployment, choose Rollback.

Or, from a checkout with the lockfile installed, list deployments and then roll back in the dashboard:

```bash
pnpm exec wrangler pages deployment list --project-name=flow-app
```

That command needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment. Rolling back Pages does not roll back the database.

## Roll back a migration

Do not run `supabase db reset` against the hosted project. Migrations are forward-only. To undo a change that already landed, add a new migration that reverses it and push that through the deploy job. Do not edit a migration file after it has been applied.

If a push fails halfway, read the deploy log (the database URL is redacted). Fix the migration with a new file. Then push to `main` again. The hosted bundle is checked before the preflight.

List the recorded versions before changing one. `<version>` is the filename timestamp, such as `20261003210000`.

```bash
supabase migration list --db-url "$SUPABASE_DB_URL"
```

When the statements were applied and the version was not recorded, mark that version applied before the next push. Do this only after checking that the objects from that file are already in the database:

```bash
supabase migration repair --status applied <version> --db-url "$SUPABASE_DB_URL"
```

When a version was recorded and the migration was not applied, mark it reverted so the next push can run the file. `reverted` only changes the recorded history. It does not undo any SQL. That mark can also be done from the Supabase dashboard:

```bash
supabase migration repair --status reverted <version> --db-url "$SUPABASE_DB_URL"
```
