# Review round 8: a split keeps its category, and a bad SUMIT key waits for a reconnect

**Date:** 2026-09-28
**Status:** Accepted

## Context

The review of `2c01671` asked for one blocking fix, three should-fix items, and the UI review's should-fix list and nits. A new SUMIT test company is being seeded, so this round does not call the live SUMIT API.

## Decision

1. On a shared row, or a row with an open `unallocated_shared` review, the Project row reads "מפוצל · N פרויקטים" from `allocations` and opens Split. Category save calls `set_transaction_category`. That function updates `category_id` and `user_assigned` only. The shares, `pnl_role`, and `project_id` stay. Undo uses the existing `reassign_undo` row, so the previous category and the same shares come back. This amends [0066](0066-review-round7.md) point 3: the change sheet no longer sends a shared row to Split without saving.
2. A SUMIT body with `Status` other than 0 is `sumit_auth` when the message is a bad key, company id, or permission failure. The Hebrew is "החיבור ל-SUMIT נכשל. צריך לחבר מחדש." Settings offers "חיבור מחדש". Auth does not increment `reject_attempts` and clears `next_attempt_at`. The drain skips `last_error = 'sumit_auth'` until connect replaces the row. Billing, obligo, quota, and any unrecognised `Status` stay `sumit_rejected` with the existing temporary-block sentence and the same backoff. HTTP other than 200 stays `sync_failed`. This amends [0066](0066-review-round7.md) point 4.
3. `syncCompany` returns `sumit_rejected` and `retry_at` when `next_attempt_at` is still in the future, including a forced refresh, and does not call SUMIT. Settings disables "רענון עכשיו" and shows "אפשר לנסות שוב ב-HH:MM" in Israel time. `note_sumit_rejection` increments and sets the wait in one update. `list_due_refresh_requests` filters the wait and `sumit_auth` before the limit.
4. The Install benefit "שתי התראות בלבד" is removed. Notifications are still not sent.
5. The `txn_source` migration raises if any row is still `hapoalim`. It does not relabel those rows as `sumit`.
6. "Example data" and `new-` ids are not in the production screen modules. The hosted bundle check rejects both.
7. Split's header is three levels: a compact bar (close, then the example tag), then "פיצול בין פרויקטים" as `t-title-1`, then the context line and the amount. This amends [0066](0066-review-round7.md) point 1.
8. While a toast is open over a sheet, the sheet body gains the toast height plus `--space-3` at the end, and the body scrolls so the remember row stays above the toast.
9. The Home loading skeleton stack is 8px shorter, so the band matches loaded Home. The preview label stays at the band's end.
10. The install title draws its focus ring only after Tab. Every hover on chips, ghost buttons, text links, and banners uses `--surface-hover`. The token is in `design-system.md` (light `rgba(20, 16, 32, 0.06)`, dark `rgba(255, 255, 255, 0.08)`). This amends [0066](0066-review-round7.md) point 11. The onboarding meter is 4px. Invoice reading has a larger sheet, a scan line, and an accent "ביטול". Settings puts "התקנה למסך הבית" in a last section titled "אפליקציה", including Settings Empty. Install's close and "הבנתי" go to Settings when there is no history.
11. Cheap nits taken: `PercentField` keeps one label, accepts two decimal places, and has a unit test. Dead split and step CSS is removed. `InstallMode` is declared once. CSS under `design/` diffs as text. The drain query filters before the limit. The runbook's first line matches the Vault order. The add-sheet docs no longer describe a bank row.

## Skipped nits

- FigureLine `tone` and Chip `wrap` props. The balanced check is already the green "✓" the UI review accepted, and a new prop would restyle a screen that just settled.
- `detectInstallMode` does not subscribe to a later `beforeinstallprompt`, and desktop Safari or Firefox still get the Android steps. The history fallback is in. A live prompt listener is a separate behaviour change.
- The one-step onboarding meter stays. [0066](0066-review-round7.md) requires "שלב 1 מתוך 1", and the UI review asked for a 4px bar, not removal.
- The round 7 undo fixture stays `pnl_role = 'project'` with two shares. The new category test covers a real shared row and its `share_bp` values.
- `schedule_drain` "no secret → no job" is not a new pgTAP. A local Vault secret would make that assertion fail.
- `null as unknown as string` on an income reassignment stays. `supabase gen types` still types `p_project_id` as `string`, and the types check must match that file.
- Carried r10 nits left as they were: expense `paid` from `cash_date`, `undo_reassign` staleness beyond the category undo, `create_category` races, `reassign_undo` RLS, "הכנסות החודש", the overhead hint, BandFigures, a `create_category` UI test, and a nested `<main>` that was not confirmed. The danger-tint `:active` rule appears once, so nothing was deleted.

## Alternatives rejected

Relabelling leftover `hapoalim` rows as `sumit`. Putting credential failures on the 24-hour clock. Letting "רענון עכשיו" call SUMIT during a wait. Keeping the notifications benefit on Install. Calling the live SUMIT API while the new test company is still being seeded.

## Consequences

`pnpm db:test` covers the category-only save, the shares, undo, the kind check, the other owner, anon, the stamp reset, the five-minute wait, and auth with no wait. The live SUMIT e2e stays unrun until the new test company credentials arrive.
