# CI and CD

GitHub Actions runs the checks and the production deploy from `.github/workflows/ci.yml`. Secrets stay in GitHub. They are not written in the repo.

## What CI runs

On every pull request, and on a push to `main`:

- `pnpm install --frozen-lockfile`, typecheck, lint (its own job), and unit tests for `@flow/app` and `@flow/shared`
- the hosted build, `pnpm check:bundle`, the reviewers-only build, and `pnpm check:reviewer-bundle`
- Storybook's browser tests, the Storybook build, and the layout tests
- local Supabase (`supabase start`, CLI 2.118.0), then `supabase test db`, then the main Playwright suite pointed at that local API

The jobs are `lint`, `check`, and `e2e`. The main Playwright command does not run `sumit-live` or the drain spec. Those stay on `pnpm test:e2e:live` and `playwright.drain.config.ts`. CI caches the pnpm store and the Playwright browsers. A pull request uploads three artifacts: `hosted-dist`, `reviewer-dist`, and `storybook-static`.

`pnpm check:bundle` requires the hosted Supabase URL and anon key in the dist. The key must decode to role `anon` and ref `sxqpnetmtufkzowutduq`. The dist must not contain `service_role` or an `sb_secret_` key. The quoted `sb_secret_` prefix that supabase-js uses to refuse a secret key is allowed. A reviewers-only build fails that check, so it is not what gets deployed.

## What the deploy runs

Deploy is the `deploy` job in the same workflow. It runs only on a push to `main`, and only after `lint`, `check`, and `e2e` have succeeded on that commit. It uses the GitHub environment `production`.

If any secret below is missing, the job fails before the build and before any migration. It does not record a successful production deployment. Add the secret on the `production` environment and push to `main` again.

When the secrets are present, in this order:

1. The hosted dist is built from that commit, stamped with the commit SHA, and checked with `pnpm check:bundle`. A failed build or a failed check stops the job. The database is unchanged and the previous app stays live.
2. A read-only preflight opens the session pooler. It refuses the session unless the last line of the read-only check is `on`. It reads versions `20260929240000`, `20260929250000`, and `20260929260000`. When all three are recorded, it skips `scripts/preflight-r23.sql`. When any is missing, it runs that query and continues only when `rule_transactions_at_risk` and `rule_undo_rows_at_risk` are both 0. It then runs `supabase db push --db-url "$SUPABASE_DB_URL" --dry-run --output-format json` and classifies the output with `--target remote`. CLI 2.118.0 prints a JSON object when `--output-format json` is set, and also when a coding-agent variable is set (`CURSOR_AGENT`, `CURSOR_TRACE_ID`, and the others in `@vercel/detect-agent`). `CI=true` does not select JSON, and a non-TTY stdout does not either, so the GitHub Actions e2e job printed plain text until this flag was passed. The deploy job passes the flag, so it emits the JSON object. The classifier requires that object and the DRY RUN line. Up to date means `upToDate` is true and `migrations`, `seeds`, and `roles` are empty. Production also requires `message` to start with `Remote`. A non-empty `migrations` array is pending. A pending text list next to an up-to-date result fails, and pending JSON next to an up-to-date text line fails. When both lists are present, the names must be equal. A log with no JSON result fails. Nothing is pushed.
3. `supabase db push --db-url "$SUPABASE_DB_URL"` applies pending migrations. Seed data is not included. The database is not reset. Success is the command's exit code.
4. `pnpm exec wrangler pages deploy` publishes that dist to the Cloudflare Pages project `flow-app` on the production branch `main`. Wrangler 4.144.0 comes from the lockfile. Success is the command's exit code.
5. A read-only fetch of `https://flow-app-dx5.pages.dev` checks that the last line of `build.txt` is that commit SHA, and that the homepage contains the stamped `flow-build` meta tag.

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

## Secrets

These three secrets live only on the GitHub environment `production`. The repository copies are deleted. The environment is restricted to `main` and has no required reviewer. The deploy job selects that environment, which is how it can read them. A job that does not select `production` cannot see them.

| Name | What it is |
| --- | --- |
| `SUPABASE_DB_URL` | Session pooler URL for project `sxqpnetmtufkzowutduq`. Shape: `postgresql://postgres.sxqpnetmtufkzowutduq:<password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require`. Percent-encode the password. Port 5432 is the session pooler. |
| `CLOUDFLARE_API_TOKEN` | API token with Pages Edit on Cloudflare Pages project `flow-app`. |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account that owns `flow-app`. |

There is no `SUPABASE_ACCESS_TOKEN` in this workflow. The public anon key is already in `app/.env.production`. Do not add the service-role key.

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

If a push fails halfway, read the deploy log (the database URL is redacted). Fix the migration with a new file, or repair history only from the Supabase dashboard when a migration was recorded without being applied. Then push to `main` again. The hosted bundle is checked before the preflight.
