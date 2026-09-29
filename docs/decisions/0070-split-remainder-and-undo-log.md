# The split on screen is the split that is saved

**Date:** 2026-09-29
**Status:** Accepted

## Context

The r18 review of `c52dc91` asked for four fixes. The split screen put the leftover agora on the last project, and `save_split` put that same agora on the first JSON element, so ₪10.01 over three projects showed ₪3.33 / ₪3.33 / ₪3.35 and stored ₪3.35 / ₪3.33 / ₪3.33. [0069](0069-back-and-one-tap-review.md) had granted `SELECT` on `reassign_undo` to `authenticated` so a test could read zero rows. The no-op sweep skipped any control whose centre was off-screen or covered. On a transaction, "פיצול בין פרויקטים" closed the change sheet with a history pop and then pushed Split.

## Decision

1. The screen still puts the leftover agora on the last project. `sharesForSave` reverses that list before `save_split`, so the database's first element is the last project on screen and the stored agorot match the rows the owner confirmed. Stored `share_bp` still sum to 10000. This amends [0069](0069-back-and-one-tap-review.md) point 10 and DESIGN-RULES §11.
2. A new migration revokes `SELECT` on `reassign_undo` from `authenticated`. Row level security stays on, with no policies. An authenticated `select` raises `42501`. The round 9 catalogue check stays.
3. The no-op sweep scrolls each control into view before the hit test. A control that stays unclickable fails the run. A control outside an open sheet is covered by the scrim, including the tab bar, so the test logs it and moves on.
4. From the transaction change sheet, "פיצול בין פרויקטים" closes the sheet state and opens Split with `replace: true`, so the sheet's history entry is replaced rather than popped after the push.
5. The review queue is expenses. An income row still takes the suggested category and is filed without waiting. This amends [0069](0069-back-and-one-tap-review.md) point 4.
6. `get_project`'s category breakdown omits the guessed name when `category_suggested` is set. The project totals still include those amounts. [0071](0071-shared-cost-copy.md) lists that amount as waiting for approval, so the lines add up to the project's expenses.
7. A confirmation with ביטול stays about 5 seconds. A confirmation without an action stays about 2.5 seconds, and an error stays about 4. The status live region stays mounted and its text changes, so the first toast can be announced. This amends [0069](0069-back-and-one-tap-review.md) point 8.
8. A project expense with a category and no project says "חסר פרויקט, בחרו בשינוי". An unallocated shared cost does not use that sentence. [0071](0071-shared-cost-copy.md) records its copy, and אישור opens Split.
9. Undo of a different non-null category clears `category_suggested`. The trigger does not recompute the flag unless the category is null.
10. `list_auto_assigned_today` returns the same rows the review banner counts.

## Alternatives rejected

Changing `save_split` itself, which would edit an old migration and rewrite how existing remainder agorot were stored. Scoping the category trigger so income stays uncategorised. Leaving the `SELECT` grant in place because row level security currently returns no rows. Treating a covered control as a pass with no record.

## Consequences

The app that sends the reversed payload and the revoke migration ship together. A project category list no longer shows a guess the owner has not confirmed; the profit figure is unchanged. Income that Flow categorised appears under שויכו היום, not in the queue. An undo toast stays on screen long enough to tap.
