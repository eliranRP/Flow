# The owner owns splits, categories, and VAT exemptions

**Date:** 2026-09-28
**Status:** Accepted

## Context

[0059](0059-live-sumit-only.md) let `sumit-sync` write Flow Test worker-day weights and a supplier map for company 2389917160, and it applied the VAT-exemption and category map to every tenant. A re-sync then overwrote project, category, and role after the owner had approved them. [0061](0061-review-undo.md) put a review item back on the queue and left the approved assignment in the books. The round 3 review rejected all three.

## Decision

1. `supabase/functions/_shared/flow-test.ts` is deleted. Sync never writes fixed allocations, split rules, or targets for any company. A shared cost stays unallocated and queued until the owner enters split weights in the app, through `save_split` or the split screen.
2. VAT stays at `companies.vat_rate_bp` unless the owner marks that supplier VAT-exempt with `set_supplier_settings` ([0043](0043-assumed-vat-on-expenses.md)), or SUMIT's own document sends an explicit zero VAT rate. A missing split is not an exemption. A row with no category goes to Review, including income. Approving a supplier's category may set `suppliers.remembered_category_id` for that company. That value is owner-entered. Sync does not overwrite it or `vat_exempt`.
3. `upsert_sumit_documents` is the one service-role write for a sync. It runs in one transaction. On conflict, when `user_assigned` is true, it updates only the columns SUMIT owns and rescales allocation amounts. When `user_assigned` is false, it may replace project, category, role, and allocations. If the page cap is hit, the function throws `sync_page_cap` before any write. Documents missing from a complete SUMIT payload are soft-deleted with `removed_at`.
4. Authenticated insert, update, and delete are revoked on the ledger tables (`categories`, `projects`, `customers`, `suppliers`, `transactions`, `allocations`, `split_rules`, `split_rule_targets`, `overhead`, `review_queue`). Writes go through security-definer RPCs with `search_path = ''` and `current_company_id()`. Companies stay directly writable so an owner can still rename or delete the company. pgTAP proves a direct `update` of `transactions` is refused. The deferred share-sum trigger locks the parent transaction at commit, so `private.check_allocation_shares` is security definer as well. Otherwise an owner `save_split` would fail after the function returned.
5. `resolve_review` stores the prior project, category, role, `user_assigned`, and allocations. `reopen_review` restores them. This amends the undo sentence in [0061](0061-review-undo.md).
6. The golden and live tests enter the insurance exemption and the worker-day split through those RPCs, as the owner would, and then assert the numbers. Company net profit and open receivables do not depend on the split. The insurance exemption does change the net.
7. `expenseRole` reads SUMIT's description prefix. "עלות משותפת" is shared, "תקורה" is overhead, and anything else is a project cost. That is the description convention, not a Flow Test constant and not an owner setting.
8. `pg_cron` only inserts rows in `sumit_refresh_requests`. `sumit-sync` drains them when the request carries `x-flow-cron`. There is no `pg_net` call, and [0049](0049-sumit-refresh.md) is not an HTTP cron. A failed claim is cleared so the row can be retried. The cron secret is compared in constant time. Authenticated and anon cannot read that table.
9. New API keys are sealed as envelope version 2, with the Flow company id as AES-GCM additional data. Version 1 seals still open. There is no rewrap tool.
10. `company_pnl` allows `service_role` or the owner. A session that is neither is forbidden.
11. While AI tagging is off, the review copy says "הצעה" and never "AI". The block is hidden when there is no project and no category. The source line uses SUMIT's document type. `vat_status` is Hebrew. The first-run empty state is es-01: "חיבור SUMIT" goes to `/settings`.

## Alternatives rejected

Keeping the Flow Test map behind a company-id check. The pilot company is the one the app is demonstrated on, so the path would still be live.

Treating "without VAT equals gross" as an exemption. Almost every expense arrives that way when the VAT field is missing.

Leaving undo as "back on the queue, assignment stays". That is not what the undo action means.

## Consequences

[0059](0059-live-sumit-only.md) no longer accepts fixed weights in the Edge Function. `pnpm check:bundle` also scans `supabase/functions`. The live test's 37,700 assertion is valid only after the owner marks ביטוח המגן exempt. A later sync must not clear that flag or a saved split.
