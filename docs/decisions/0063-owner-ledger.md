# The owner owns splits, categories, and VAT exemptions

**Date:** 2026-09-28
**Status:** Accepted

## Context

[0059](0059-live-sumit-only.md) let `sumit-sync` write Flow Test worker-day weights and a supplier map for company 2389917160, and it applied the VAT-exemption and category map to every tenant. A re-sync then overwrote project, category, and role after the owner had approved them. [0061](0061-review-undo.md) put a review item back on the queue and left the approved assignment in the books. The round 3 review rejected all three.

## Decision

1. `supabase/functions/_shared/flow-test.ts` is deleted. Sync never writes fixed allocations, split rules, or targets for any company. A shared cost stays unallocated and queued until the owner enters split weights in the app, through `save_split` or the split screen.
2. VAT stays at `companies.vat_rate_bp` unless the owner marks that supplier VAT-exempt with `set_supplier_settings` ([0043](0043-assumed-vat-on-expenses.md)), or SUMIT's own document sends an explicit zero VAT rate. A missing split is not an exemption. An expense with no category goes to Review. Income is assigned the default income category at sync and is not queued ([0064](0064-review-round4.md)). Approving a supplier's category may set `suppliers.remembered_category_id` for that company when `p_remember` is true. That value is owner-entered. Sync does not overwrite it or `vat_exempt`.
3. `upsert_sumit_documents` is the one service-role write for a sync. It runs in one transaction. On conflict, when `user_assigned` is true, it updates only the columns SUMIT owns and rescales allocation amounts. When `user_assigned` is false, it may replace project, category, role, and allocations. If the page cap is hit, the function throws `sync_page_cap` before any write. Documents missing from a complete SUMIT payload are soft-deleted with `removed_at`.
4. Authenticated insert, update, and delete are revoked on the ledger tables (`categories`, `projects`, `customers`, `suppliers`, `transactions`, `allocations`, `split_rules`, `split_rule_targets`, `overhead`, `review_queue`). Writes go through security-definer RPCs with `search_path = ''` and `current_company_id()`. Companies stay directly writable so an owner can still rename or delete the company. pgTAP proves a direct `update` of `transactions` is refused. The deferred share-sum trigger locks the parent transaction at commit, so `private.check_allocation_shares` is security definer as well. Otherwise an owner `save_split` would fail after the function returned.
5. `resolve_review` stores the prior project, category, role, `user_assigned`, and allocations. `reopen_review` restores them. This amends the undo sentence in [0061](0061-review-undo.md).
6. The golden and live tests enter the insurance exemption and the worker-day split through those RPCs, as the owner would, and then assert the numbers. Company net profit and open receivables do not depend on the split. The insurance exemption does change the net.
7. `expenseRole` reads SUMIT's description prefix. "עלות משותפת" is shared, "תקורה" is overhead, and anything else is a project cost. That is the description convention, not a Flow Test constant and not an owner setting.
8. `pg_cron` inserts rows in `sumit_refresh_requests`. `sumit-sync` drains them when the request carries `x-flow-cron`. [0064](0064-review-round4.md) schedules that drain with `pg_net` when the extension is installed. A failed claim is cleared so the row can be retried, and the claim counts the updated row. The cron secret is compared in constant time. Authenticated and anon cannot read that table.
9. New API keys are sealed as envelope format 2, with the Flow company id as AES-GCM additional data. `kek_version` is the KEK rotation id (default `"1"`) and `envelope_version` is the format. A row with `kek_version` `"2"` and a null `envelope_version` is still format 2. Version 1 seals still open. There is no rewrap tool.
10. `company_pnl` allows `service_role` or the owner. A session that is neither is forbidden.
11. While AI tagging is off, the review copy says "הצעה" and never "AI". The block is hidden when there is no project and no category. The source line uses SUMIT's document type. `vat_status` is Hebrew. The first-run empty state is es-01: "חיבור SUMIT" goes to `/settings`. The change sheet uses the same word on its suggestion chip, with no spark.

## Design review round 3

These calls amend [0061](0061-review-undo.md) where it sent Toggle out of the library, and [0060](0060-library-review-calls.md) where an unpaid hint said the invoice was outside profit.

12. Toggle is a library component again: off, on, disabled, focus, and a long Hebrew label. The overhead switch, "לזכור לספק הזה", and the settings switches use it. A disabled switch shows `not-allowed` and the row is a 44px target. DatePicker stays out.
13. The tab bar stays on Project, Unpaid, Settings, and Categories, because those mockups draw it. The active tab is the section the screen belongs to: Unpaid is בית, a project is פרויקטים, Settings and Categories are הגדרות. Sheets cover the bar. The active slot is `aria-current="page"`, and that selector paints `--color-accent-text`.
14. PeriodPicker Open is a modal sheet with a scrim, the same way RangeSheet is. The closed story stays the band and the on-band pill.
15. Unpaid is titled "חשבוניות שלא שולמו". The amount is unsigned, the total is shown, and each row has "סימון כשולם". The hint is "טרם נגבה", not "לא נכלל ברווח", because an open invoice is already in invoiced profit. There is no write that marks a SUMIT invoice paid. The sheet says the row leaves when a later sync shows the invoice paid. A local hide until that refresh is only a preview of that.
16. Settings Connected shows the connected state. The connect form (מספר חברה, מפתח API, חיבור) opens from "חיבור SUMIT" when SUMIT is not connected. There is no "Google: לא מחובר" line: the email is shown when there is one, and the row is omitted when there is not. Labels are Hebrew. A failure is an error story, not the connected story. There is no Hapoalim account and no promise that a message goes out on Sunday at 08:00 or 18:00. Notification switches say the messages are not sent. The auto-approve switch stays off, labelled "לא פעיל", and does not mention AI. רענון עכשיו and ניתוק stay real.
17. Empty, error, and loading Storybook frames carry "נתוני דוגמה · Example data". The running app does not. [0065](0065-review-round5.md) adds `create_category` and removes the grip, because reorder is not implemented. Hide and merge still call their RPCs. "לזכור לספק הזה" is the Toggle on the change sheet. It defaults on and is passed as `p_remember`. `resolve_review` stores the supplier category only when that argument is true, and undo restores the previous value ([0064](0064-review-round4.md)).

## Alternatives rejected

Keeping the Flow Test map behind a company-id check. The pilot company is the one the app is demonstrated on, so the path would still be live.

Treating "without VAT equals gross" as an exemption. Almost every expense arrives that way when the VAT field is missing.

Leaving undo as "back on the queue, assignment stays". That is not what the undo action means.

## Consequences

[0059](0059-live-sumit-only.md) no longer accepts fixed weights in the Edge Function. `pnpm check:bundle` also scans `supabase/functions`. The live test's 37,700 assertion is valid only after the owner marks ביטוח המגן exempt. A later sync must not clear that flag or a saved split.
