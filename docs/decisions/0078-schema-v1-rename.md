# The schema_v1 rename is a one-time exception

**Date:** 2026-09-30
**Status:** Accepted

## Context

Hosted history records `schema_v1` as version `20260928080538`. The repo had the same bytes as `supabase/migrations/20260927120000_schema_v1.sql`. `supabase db push` refuses a remote version that is missing from the local directory, so the dry-run could not pass. The hosted history is not repaired.

A later commit also rewrote the comment in `20260928140000_phase1_slice.sql` so it named the new filename. That file was already applied. Its bytes have to stay the bytes production recorded.

`scripts/preflight-r23.sql` counts rows that migrations `20260929240000`, `20260929250000`, and `20260929260000` already backfilled. Production has those versions recorded. Blocking the deploy on that query reports a failure after the repair has already been applied.

## Decision

1. Renaming `20260927120000_schema_v1.sql` to `20260928080538_schema_v1.sql` is a one-time exception. The file bytes are unchanged. Hosted `schema_migrations` is not rewritten. Do not rename or reorder a migration again.
2. `supabase/migrations.lock` stores each filename and the sha256 of that file. CI checks the lock against the directory. Against the lock on `main`, an existing filename and its sha256 stay the same. A new migration may only be appended, and its version sorts after the last locked file. The comment in `20260928140000_phase1_slice.sql` is restored to `Apply after 20260927120000_schema_v1.sql.`, so the applied file stays byte-identical.
3. `.github/CODEOWNERS` requires `@eliranRP` on `supabase/migrations`, `supabase/migrations.lock`, `scripts/cd-*`, and `.github/workflows`.
4. The deploy preflight reads those three versions from `schema_migrations`. When all three are recorded, it skips `scripts/preflight-r23.sql` and does not block. When any is missing, it runs that query and continues only when `rule_transactions_at_risk` and `rule_undo_rows_at_risk` are both 0. A failed read, an unreadable row, or a non-zero risk count stops the deploy with that reason. The dry-run classifier takes `--target remote` on the production path and `--target local` when `FLOW_CD_PREFLIGHT_LOCAL=1`, and it matches whole trimmed lines.

## Alternatives rejected

Repairing hosted migration history so the old filename matches. That rewrites versions that `db push` already recorded.

Leaving the phase1 comment pointed at `20260928080538`. That changes a file production has already applied.

Keeping a filename-only lock. A content edit of an applied migration would still match.

Always failing the deploy when `preflight-r23.sql` is non-zero, including after those versions are recorded. The backfill has already run.

## Consequences

A later rename, reorder, deletion, or content change of a locked migration fails CI. The production preflight skips the backfill counts once `20260929240000`, `20260929250000`, and `20260929260000` are recorded. A pending one of those versions still blocks when either risk count is not 0. Decision [0077](0077-deploy-after-ci.md) still runs this preflight after the hosted build.
