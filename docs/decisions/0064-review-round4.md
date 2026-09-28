# Review round 4: library screens, a real overhead switch, and a quieter queue

**Date:** 2026-09-28
**Status:** Accepted

## Context

The code review of `e7ce2b7` passed the live-data rule and the security rule. It still rejected screens that built rows and bands by hand, an overhead switch that only changed local state, income flooding Review, a remember switch that did not control the write, project matching by name, and a removal sweep that could wipe the ledger on an empty payload.

## Decision

1. Screens use library components only. `Banner` has an action slot, used by the auto-approved line. `ListRow` adds `static`, `button`, `danger`, and `selectable`. The change sheet picks a project with `RadioRow`. Settings uses `SectionHead` and those rows. Transaction detail uses `FigureLine`. The project band is one `BandHero`. Sign-in and Help keep the frames in `app/src/ui/layout.tsx` (`SignInFrame`, `HelpMail`, `HelpBack`). That is the library layout; there is no second API.
2. "רווח אחרי חלק בכלליות" is saved. `set_after_overhead` writes the company default (`companies.after_overhead`) or one project's override (`projects.after_overhead`, null inherits). Both start off. This amends [0022](0022-after-overhead-starts-off.md), which had one shared preference. When the resolved flag is on, `get_project` returns `profit_after_overhead_agorot` and the project hero shows it. Owner weights do not exist yet, so `overhead_share_agorot` is 0 and the hint says so. This also amends the income-share sentence in [0021](0021-shared-costs-and-overhead.md) for this round: the share is not computed until those weights exist. Home's big number stays company net profit, as [0032](0032-home-shows-company-profit.md) says.
3. Income never enters Review. Sync assigns the default income category (`תקבול מלקוח`), leaves `pnl_role` and the project empty, and writes no allocation. `sync_review_queue` only queues expenses. `resolve_review` checks that the category kind matches the direction. A skipped row is not re-queued until the document fingerprint changes. This amends point 2 of [0063](0063-owner-ledger.md).
4. `resolve_review` takes `p_remember`. The change-sheet switch passes it. Only then is `suppliers.remembered_category_id` saved. Undo restores the previous value, including null. This amends point 17 of [0063](0063-owner-ledger.md).
5. Project matching prefers `projects.sumit_budget_section_id`. An existing mapping is never overwritten. The name is used only when that section is not mapped. `map_budget_section` escapes `\`, `%`, and `_` in its `LIKE` and uses `ESCAPE '\'`.
6. The removal sweep is skipped when the payload's seen list is empty (`sync_sweep_empty`) or when the rows to remove are more than half of the live SUMIT rows (`sync_sweep_suspicious`). The RPC writes `sumit_connections.last_error`. A successful stamp of `last_sync_at` does not clear an error that starts with `sync_sweep`.
7. "טרם נגבה" on Home and Unpaid is the gross open amount. The golden figure 134,520 is `open_receivables_gross` (the net is 114,000), so both surfaces sum `open_gross_agorot`. They are not labelled "לפני מע״מ". A local "סימון כשולם" hides the row and leaves the total on the full list.
8. When `pg_cron` and `pg_net` are both installed, migration schedules `flow-sumit-drain` every five minutes. The job POSTs `sumit-sync` with `x-flow-cron`. The URL and secret come from Vault (`flow_sync_url`, `cron_secret`) and otherwise from local Kong `http://kong:8000/functions/v1/sumit-sync`. A missing extension or a missing vault table does not fail the migration. This amends point 8 of [0063](0063-owner-ledger.md) and the "no pg_net" sentence in [0049](0049-sumit-refresh.md) for the drain only. The daily marker job stays. The claim update reads the row back and skips when no row was updated.
9. New seals store `kek_version` (env `SUMIT_KEK_VERSION`, default `"1"`) and `envelope_version` `"2"`. A row with `kek_version` `"2"` and a null `envelope_version` is still format 2. `sealApiKey(secret, kek, "2", company)` keeps working.
10. `private.check_allocation_shares()` is revoked from `authenticated`. The function is security definer and owned by the migration role, so the owner's split still fires it. If a later database rejects that, the grant has to come back with a note here.
11. [0050](0050-demo-splits-and-review.md) amends [0006](0006-confirm-not-type.md) for SUMIT rows already in the books: they stay in the P&L while they wait. The Flow Test company and the Edge Function worker-day copy are not part of sync.

## Alternatives rejected

Leaving the overhead switch as local state. Queueing every income document. Remembering a supplier category whenever the assignment is saved, regardless of the switch. Matching a project by name and overwriting its section id. Deleting every SUMIT row when the payload is empty.

## Consequences

`pnpm db:test` covers income, remember and undo, the section mapping, the sweep threshold, the zero overhead share, and cross-tenant refusals of the definer writes. The project hero has a unit test that the after-overhead number is the one on screen. Unset `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` before the hosted build.
