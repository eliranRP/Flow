# A shared cost opens the split, and a waiting line keeps the breakdown honest

**Date:** 2026-09-29
**Status:** Accepted

## Context

The r19 review of `a62e4b0` found the review card saying "חסר פרויקט, בחרו בשינוי" on an unallocated shared cost. That cost has no project because it is shared, and אישור already opens Split. Saving one project onto it raises `shared costs are split, not assigned to one project`, and the change sheet showed that as "לא נשמר – אין חיבור".

[0070](0070-split-remainder-and-undo-log.md) left suggested categories out of `get_project`'s named breakdown. The project total still included them, so "הוצאות לפי קטגוריה" added up to less than the expenses. A project whose costs were all still suggestions said "אין עדיין הוצאות מסווגות."

## Decision

1. The review card takes the queue reason. `unallocated_shared` says "הוצאה משותפת · אישור יפתח חלוקה". A category on that card can still show. "חסר פרויקט, בחרו בשינוי" stays for a project expense that has a category and no project. This amends [0070](0070-split-remainder-and-undo-log.md) point 8.
2. אישור on an unallocated shared cost opens Split for that transaction. It does not call `resolve_review`. That is the one tap.
3. A shared cost is not saved as one project. The change sheet skips that call and toasts "עלות משותפת מחולקת במסך החלוקה." with לחלוקה, which opens Split. Other save failures stay "לא נשמר – אין חיבור". ניסיון חוזר is offered only for a network or server error, not for a refusal the database will repeat.
4. `get_project` still omits a suggested category's name. It also returns `pending_count` and `pending_agorot` for those project expenses. The screen lists "1 ממתינה לאישור" or "N ממתינות לאישור" with that amount. Named lines plus the waiting amount equal the project's direct expenses. A project with only waiting costs shows that line, not the empty sentence. This amends [0070](0070-split-remainder-and-undo-log.md) point 6.
5. A row in שויכו היום is a categorised project expense (or another row the banner already counts), not an unallocated shared cost that only looks filed because the queue was never synced.
6. `reopen_review` and `undo_reassign` restore `category_suggested` with the category. `resolve_review`, `reassign_transaction`, and `set_transaction_category` store that prior flag. The fill trigger forces the flag off on a category change only when the statement did not set the flag itself. A guess that was already undone is put back to suggested when a suggested review still matches the category, or when the audit meta records that this category was a suggestion. Historical audit rows stored an empty meta, so the review and the undo row are that record; a transaction update from here writes the flag and the category into the meta. This amends [0070](0070-split-remainder-and-undo-log.md) point 9.

## Alternatives rejected

Calling the shared card "עלות משותפת, אישור פותח את החלוקה". The sentence is "הוצאה משותפת · אישור יפתח חלוקה". Putting the guessed category name back into the breakdown. Hiding the waiting amount and leaving the total short.

## Consequences

Approving a shared cost from the queue lands on Split. A refused single-project save names the split screen. A project page can be added up from the category list without showing a guess the owner has not confirmed.
