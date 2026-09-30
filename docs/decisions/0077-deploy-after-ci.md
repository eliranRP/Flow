# Production deploy runs only after CI on that commit

**Date:** 2026-09-30
**Status:** Accepted

## Context

The production deploy was a separate workflow on every push to `main`. It did not wait for lint, check, or e2e on that commit. It also pushed migrations before building the hosted app, so a failed build could leave the database migrated while the previous app stayed live. A missing secret ended the job successfully, which recorded a green production deployment that had not deployed.

The three deploy secrets now live only on the GitHub environment `production`. That environment is restricted to `main` and has no required reviewer. The repository copies are gone. A job that does not select that environment cannot see the secrets.

## Decision

1. The deploy is a job in `.github/workflows/ci.yml`. It `needs: [lint, check, e2e]` and runs only when `github.event_name == 'push' && github.ref == 'refs/heads/main'`. Those three job names stay stable so they can be required checks on `main`. CI runs on `pull_request` and on a push to `main`. The old same-repo skip conditions are gone. The separate `cd.yml` workflow is gone.
2. On that job the order is: build the hosted dist, stamp the commit, `pnpm check:bundle`, then the read-only preflight, `supabase db push`, the Pages deploy, and the smoke check. A build or bundle failure stops the job before any migration.
3. `check:bundle` requires the hosted Supabase URL and anon key in the dist. The key must decode to role `anon` and ref `sxqpnetmtufkzowutduq`. The dist must not contain the text `service_role`, a token whose payload role is `service_role`, or an `sb_secret_` key. supabase-js inlines `startsWith("sb_secret_")` so the client can refuse a secret key. That quoted prefix is the only allowed occurrence, because the real hosted dist contains it and it is not a credential. That check is what refuses a reviewers-only build. The deploy job does not set `VITE_REVIEWER_BUILD`.
4. The job selects `environment: production`. If any of `SUPABASE_DB_URL`, `CLOUDFLARE_API_TOKEN`, or `CLOUDFLARE_ACCOUNT_ID` is empty, the job exits 1 before the build and before the migration. Actions in that job are pinned to a full commit SHA. Checkout does not persist credentials. Wrangler 4.144.0 is a root devDependency, and the job runs `pnpm exec wrangler`.

## Alternatives rejected

`workflow_run` after CI succeeds. That uses the workflow file from the default branch, a second token, and a second lookup of the commit. The same-run `needs` list is the same commit with no extra SHA.

A secret check in a job with no environment, so deploy shows as skipped. That job cannot see environment secrets, so it would treat every deploy as missing them and skip production.

Exiting 0 when a secret is missing. That records a successful production deployment that did not deploy.

## Consequences

A pull request runs lint, check, and e2e, and skips deploy. A push to `main` deploys only after those three succeed on that commit. A missing secret fails the deploy job. Pages rollback still does not roll back the database. Required reviewers are not set on `production`. Decision [0079](0079-automatic-deploy-owner-risk.md) accepts that, and accepts 0 required pull request approvals.
