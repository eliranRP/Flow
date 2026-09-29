# A split can return to one project

**Date:** 2026-09-29
**Status:** Accepted

## Context

A split expense could be divided further, and its category could change, but it could not come back to a single project. `reassign_transaction` refuses a shared row. `save_split` with one share does set `pnl_role` to project, and it returns nothing, so ביטול has no undo row to restore.

The owner asked for that return on the same change-sheet flow: from the split screen, and from the project picker on a split.

## Decision

1. The split screen's question "איך לחלק?" has a fourth choice, **לפרויקט אחד**. The line under it is **הסכום כולו עובר לפרויקט אחד**. Choosing it opens the same project picker the change sheet uses.
2. Above that list, the note is **החלוקה תרד, והסכום כולו יעבור לפרויקט הזה.** The tap is the confirmation. There is no second confirm button. This follows [0075](0075-save-on-tap-and-on-leave.md): the tap writes, and leaving writes anything still pending. Leaving with the choice selected and no project stays open. The summary says **בחרו פרויקט.**
3. The write is `collapse_split`. It puts the full net on the chosen project as one 100% share, deletes the other shares, sets `pnl_role` to project, and keeps the category. It stores a `reassign_undo` row and returns that id. ביטול calls `undo_reassign`. An open `unallocated_shared` review is closed as changed, and undo reopens it.
4. The project picker in the change sheet does the same thing when the row is split, including an unallocated shared cost. The same note is on that list before the tap. A category tap on a split still calls `set_transaction_category` and keeps the shares. This amends [0075](0075-save-on-tap-and-on-leave.md) point 1, which rolled a project tap on an unallocated shared cost back and offered לחלוקה, and [0071](0071-shared-cost-copy.md), which sent that assignment to the split screen instead of writing it.
5. Project totals follow the move. The chosen project's direct total includes the full amount. Each project that lost its share loses that amount from the shared total, and "כולל חלק מהוצאות משותפות" goes with it when that share was the line that made the note true. Undo puts both back.

## Alternatives rejected

Calling `save_split` with one share. It already unsplits, and it does not return an undo id, so ביטול could not restore the shares.

Calling `reassign_transaction` and deleting its refusal. That function also requires a category and is the path for a row that was never split. A split needs a write that keeps the category and refuses a row that is not split.

A second confirm after the note. [0075](0075-save-on-tap-and-on-leave.md) removed the extra save because the tap is the confirm. The note is read before the tap.

## Consequences

לחלוקה stays for a shared cost that `reassign_transaction` still refuses. The change sheet no longer takes that path for a split: it calls `collapse_split`. A review item that is split for a reason other than `unallocated_shared` still uses `resolve_review` on a project tap. That remains in the open questions.
