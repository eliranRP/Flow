# Review round 9: shared labels, a real category approval, and a clean SUMIT switch

**Date:** 2026-09-28
**Status:** Accepted

## Context

The review of `104d307` asked for three blocking fixes and four should-fix items, plus the nits in that review. The focus-ring fix from the previous pass stays. `sumit_status` already grants `next_attempt_at` to the owner. This round keeps that grant and proves the owner can read the clock. Hosted Supabase has only Phase 0 migrations, so the in-place edit of `20260929120000` stays this once. Migrations are append-only from `20260929150000` on.

## Decision

1. A shared row with no allocations reads "עלות משותפת · טרם פוצלה" and opens Split. One allocation reads that project's name. Two or more read "מפוצל · N פרויקטים". This amends [0067](0067-review-round8.md) point 1.
2. `set_transaction_category` closes an open `missing_category` item as `changed` and stores its id on the undo row. `undo_reassign` reopens it. An open `unallocated_shared` item stays open. The save button reads "שמירה" when the save closes no review item, and "שמירה ואישור" when it does.
3. `sumit_status` stays security invoker. `authenticated` may select `next_attempt_at`. The ciphertext columns stay unreadable. pgTAP calls `sumit_status` as the owner and checks the clock.
4. Every connect resets `reject_attempts`, `next_attempt_at`, and `last_sync_at`. When the SUMIT company id changes, `replace_sumit_connection` retires `source = 'sumit'` rows and skips their open review items in the same transaction. A manual row stays. Disconnect still keeps the books. The runbook says Flow Test 2 can use a fresh Flow company or rely on that wipe.
5. `classifySumitStatus` is the only classifier the sync calls. The unused backoff helpers are deleted. A billing message, an English or Hebrew key error, and a neutral Hebrew message that only contains "מזהה" are table-tested. Bare "מזהה" and "permission" stay `sumit_rejected`. The wait is still computed in SQL, and the hold path stays covered by pgTAP.
6. `ScreenHeader` has `layout="stacked"`: the bar, then a `t-title-1` title, then the subtitle. Split uses it. `title` is required unless `barOnly`. The focus-title rule from [0067](0067-review-round8.md) point 12 still applies.
7. The production bundle guard rejects `2393153301`, `2379562633`, `114000`, and the Flow Test 2 fixture sentence, in `dist` and in Edge Function sources. The story-only `draft:` branch is removed from the screen modules, and the guard rejects `draft:` as well as `new-`.
8. A split income row says "הכנסות", the income of the selected period. This amends [0065](0065-review-round5.md) point 31. The overhead hint no longer says "בתקופה": the share uses all project income, not the selected period.
9. A toast over a sheet scrolls the remember row into view. It does not jump the sheet to the bottom. Install's close uses `location.key === "default"` instead of `window.history.state.idx`. The retry hint says "מחר" when the Israel date differs, and the disabled refresh enables itself when that time passes.
10. `design/system/design-system.md` diffs as text. Images under `design/` stay binary.

## Alternatives rejected

Making `sumit_status` security definer after the column grant already lets the owner read the clock. Refusing a SUMIT company change instead of retiring the previous ledger. Keeping the dead backoff helpers so the old unit tests would still pass. Leaving "הכנסות החודש" and "בתקופה" until a later round. Editing `20260929120000` again.

## Consequences

`pnpm db:test` covers the owner status clock, the missing-category close and undo, the unallocated item that stays open, the connect reset, and the ledger wipe. The live SUMIT check against Flow Test 2 creates no documents.

## Addendum

The design review of r12 asked for a readable retry time and a project loading band that matches the loaded band. This addendum is UI only. No migration, no Edge Function, and no SUMIT call.

The Settings hint "אפשר לנסות שוב ב-HH:MM" sits in the hint colour at full opacity. The row's title and icon stay at 45%. A disabled row still has no chevron, which is [0066](0066-review-round7.md) point 6. The clock is in `<bdi dir="ltr">`. A direct visit to `/install` replaces itself with Settings, so Back does not return to Install. A visit that already has history still goes back one step.

The Project Detail loading band uses its own boxes for the name, the period line, the profit line, the figure, and the income and expense row. Those boxes follow the loaded band, including the wrap of the figure row at 320. Home still uses `.ui-skel-stack`. The Home trim in [0067](0067-review-round8.md) point 9 is unchanged.

Skipped, because the copy and the placement are still open: the auth row does not repeat "חיבור מחדש" on the refresh row, and the backoff screen keeps both the red status line and the grey clock. `design/system/design-system.md` already diffs as text. The shared-cost labels from point 1 already cover zero and one allocations.

## Further addendum

The code review of r13 had no blocking items. This addendum amends points 2 and 4.

Disconnect copies `sumit_company_id` onto `companies.last_sumit_company_id` and then deletes the connection row. The key is gone and the books stay. The next `replace_sumit_connection` compares the live connection id, or that remembered id when the row is gone. A different id retires `source = 'sumit'` rows and skips their open reviews. A manual row stays. Another company's rows stay. `p_validated` must be true or the function raises before any write. `sumit-connect` sets that flag only after one `listfolders` call returns Status 0, so a typo does not empty Home.

When `set_transaction_category` closes an open `missing_category` item on a shared row with no allocations, it inserts an open `unallocated_shared` item in the same function. `undo_reassign` removes that follow-up when it reopens the missing-category item.

The live check writes to SUMIT only when `SUMIT_CREATE_DOCUMENTS=1`. The default run is connect, two syncs, and the saved split. The helper allowlists read paths, counts every call, and expects zero writes. Flow Test 2 stays at 75 Operations. A screen-reader title draws no focus ring. The 2px ring stays on real controls.
