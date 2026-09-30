# CI and CD

GitHub Actions runs the checks and the production deploy. The workflows are `.github/workflows/ci.yml` and `.github/workflows/cd.yml`. Secrets stay in GitHub. They are not written in the repo.

## What CI runs

On every pull request and every push (a same-repo pull request is not run twice):

- `pnpm install --frozen-lockfile`, typecheck, lint (its own job), and unit tests for `@flow/app` and `@flow/shared`
- the hosted build, `pnpm check:bundle`, the reviewers-only build, and `pnpm check:reviewer-bundle`
- Storybook's browser tests, the Storybook build, and the layout tests
- local Supabase (`supabase start`, CLI 2.118.0), then `supabase test db`, then the main Playwright suite pointed at that local API

The main Playwright command does not run `sumit-live` or the drain spec. Those stay on `pnpm test:e2e:live` and `playwright.drain.config.ts`. CI caches the pnpm store and the Playwright browsers. A pull request uploads three artifacts: `hosted-dist`, `reviewer-dist`, and `storybook-static`.

## What CD runs

CD runs only on a push to `main`, in the GitHub environment `production`.

If any repository secret below is missing, the job stops after a notice and succeeds. It does not push migrations and it does not deploy. Add the secret on the repository and push to `main` again.

When the secrets are present:

1. A read-only preflight opens the session pooler, refuses the session unless it is read-only, and runs `scripts/preflight-r23.sql`. It then runs `supabase db push --db-url "$SUPABASE_DB_URL" --dry-run`. If that check cannot be read, the job fails and nothing is pushed.
2. `supabase db push --db-url "$SUPABASE_DB_URL"` applies pending migrations. Seed data is not included. The database is not reset.
3. The hosted dist is built from that commit, stamped with the commit SHA, and checked with `pnpm check:bundle`.
4. `wrangler pages deploy` publishes that dist to the Cloudflare Pages project `flow-app` on the production branch `main`.
5. A read-only fetch of `https://flow-app-dx5.pages.dev` checks that `build.txt` and the homepage both serve that commit SHA.

The reviewers-only build is not deployed. CD does not run the live SUMIT specs and does not call an API that writes product data.

## Secrets

These are repository Actions secrets. The deploy job uses `environment: production` as an approval gate, and it still reads the repository secrets. Do not put them only on that environment.

| Name | What it is |
| --- | --- |
| `SUPABASE_DB_URL` | Session pooler URL for project `sxqpnetmtufkzowutduq`. Shape: `postgresql://postgres.sxqpnetmtufkzowutduq:<password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require`. Percent-encode the password. Port 5432 is the session pooler. |
| `CLOUDFLARE_API_TOKEN` | API token with Pages Edit on Cloudflare Pages project `flow-app`. |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account that owns `flow-app`. |

There is no `SUPABASE_ACCESS_TOKEN` in this workflow. The public anon key is already in `app/.env.production`. Do not add the service-role key.

Required reviewers, when set on the `production` environment, must approve before a push to `main` migrates or deploys. That environment does not need its own copies of these secrets.

## Roll back a Pages deploy

The previous production deployment stays in the Cloudflare Pages project `flow-app`.

1. Open the project, then Deployments.
2. On the last good production deployment, choose Rollback.

Or list deployments, then roll back in the dashboard:

```bash
npx --yes wrangler@4.144.0 pages deployment list --project-name=flow-app
```

Rolling back Pages does not roll back the database.

## Roll back a migration

Do not run `supabase db reset` against the hosted project. Migrations are forward-only. To undo a change that already landed, add a new migration that reverses it and push that through CD. Do not edit a migration file after it has been applied.

If a push fails halfway, read the CD log (the database URL is redacted). Fix the migration with a new file, or repair history only from the Supabase dashboard when a migration was recorded without being applied. Then push to `main` again. The preflight runs first.
