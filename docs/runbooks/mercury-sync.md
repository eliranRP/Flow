# Mercury sync

Operational notes for `mercury-sync` and its drain. The design is in [connector-contract.md](../tech/connector-contract.md); the deploy order is in [ci-cd.md](ci-cd.md).

## Drain URL

The connector drain posts Mercury refresh requests to Vault `flow_mercury_sync_url` when it is set, and otherwise to `flow_sync_url` with `/sumit-sync` swapped for `/mercury-sync` (FLOW-509, migration `20261013050000_mercury_sync_atomic.sql`). Setting it is optional. The SQL is in the Vault block of [sumit-connect.md](sumit-connect.md); after storing it, run `select private.schedule_connector_jobs();` as `service_role`. `scripts/check-sumit-cron.sh` then still reports "SUMIT cron jobs match".

## Rolling back `mercury-sync` alone

Do not roll the function back on its own past decision [0097](../decisions/0097-mercury-income-invoice-receipt.md) (Mercury income is `invoice_receipt`). A `mercury-sync` from before 0097 labels income `receipt` again, and the next sync rewrites every Mercury income line it reads within the lookback:

- Invoiced-basis totals (`company_pnl`, `get_dashboard`, `get_project`, MCP `get_totals`) drop that income again.
- The review fingerprint of each rewritten line changes, so a Mercury income line the owner skipped reopens in review.

Roll back the function together with a migration that undoes the relabel, or roll forward. The migration `20261007010000_mercury_income_doc_kind.sql` also closes review rows that a sync reopened between the function deploy and the migration; that close is part of 0097, not a separate fix.

## A failed migration push

Functions deploy before migrations. If `supabase db push` fails after the function step, the new `mercury-sync` is live against the old schema until the next successful deploy. For 0097 that means new and updated income lines are `invoice_receipt` while older stored lines stay `receipt`, so totals are partial. The gap closes only when a deploy pushes the migration; re-run the deploy rather than editing rows by hand.

## The token's scope

Mercury does not tell a client whether a token is read-only. `mercury-connect` checks only that the token can GET `/accounts`, `/credit` and `/treasury`. The read-only guarantee is ours: every call goes through `assertMercuryGet`, which refuses any method but GET and any path outside `MERCURY_GET_ALLOWLIST` (the two templated paths take one `[A-Za-z0-9_-]{1,128}` id segment). Ask the owner for a read-only token when they connect; a token that could write is still only used for these GETs.
