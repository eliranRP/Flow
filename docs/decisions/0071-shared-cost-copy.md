# A shared cost opens the split, and a waiting line keeps the breakdown honest

**Date:** 2026-09-29
**Status:** Accepted

## Context

The r19 review of `a62e4b0` found the review card saying "חסר פרויקט, בחרו בשינוי" on an unallocated shared cost. That cost has no project because it is shared, and אישור already opens Split. Saving one project onto it raises `shared costs are split, not assigned to one project`, and the change sheet showed that as "לא נשמר – אין חיבור".

[0070](0070-split-remainder-and-undo-log.md) left suggested categories out of `get_project`'s named breakdown. The project total still included them, so "הוצאות לפי קטגוריה" added up to less than the expenses. A project whose costs were all still suggestions said "אין עדיין הוצאות מסווגות."

## Decision

1. The review card takes the queue reason. `unallocated_shared` says "הוצאה משותפת · אישור יפתח חלוקה". A category on that card can still show. "חסר פרויקט, בחרו בשינוי" stays for a project expense that has a category and no project. This amends [0070](0070-split-remainder-and-undo-log.md) point 8.
2. אישור on an unallocated shared cost opens Split for that transaction. It does not call `resolve_review`. That is the one tap.
3. A shared cost is not saved as one project. The change sheet skips that call and toasts "עלות משותפת מחולקת במסך החלוקה." with לחלוקה, which opens Split. "לא נשמר – אין חיבור" is only a network or server error, and it offers ניסיון חוזר. Any other refusal says "לא נשמר. בדקו את הפרטים ונסו שוב." and offers no retry. That copy is [0072](0072-design-review-rulings.md) point 14.
4. `get_project` still omits a suggested category's name. Each category line carries `has_shared_share`, true only when that line includes this project's share of a shared cost. The screen shows "כולל חלק מהוצאות משותפות", in the primary text colour, only then. `pending_count` and `pending_agorot` come from `project_waiting`, and `/review?project=` lists those same rows: an open review of a project expense, and a suggested expense that has no open review. The screen lists "1 ממתינה לאישור" or "N ממתינות לאישור" with that amount. A category line is the confirmed expenses in that category, including this project's share of a shared cost, and it leaves out a row that is still in `project_waiting`. `list_project_category` uses those same rows, paged, and they add up to the line. The screen reads that query, not navigation state. Named lines plus the waiting amount equal the project's direct expenses plus those confirmed shares. A project with only waiting costs shows that line, not the empty sentence. This amends [0070](0070-split-remainder-and-undo-log.md) point 6.
5. A row in שויכו היום is a categorised project expense (or another row the banner already counts), not an unallocated shared cost that only looks filed because the queue was never synced.
6. `reopen_review` and `undo_reassign` restore `category_suggested` with the category. `resolve_review`, `reassign_transaction`, and `set_transaction_category` store that prior flag. The fill trigger forces the flag off on a category change only when the statement did not set the flag itself. A guess that was already undone is put back to suggested when a suggested review still matches the category, when the undo row has no suggested review and the prior category was not an owner confirmation, or when a reopened missing-project approval still shows that category. A pending undo stores the flag so a later undo restores the suggestion. A category that matches the supplier's remembered rule is an assignment, not a guess, so the backfill leaves it alone, including an undone rule and a reopened rule. A rule row an earlier backfill already marked as a guess is put back. The backfill does not read audit meta: rows written before this release stored an empty meta. Every flip writes an audit row, with the company owner as the actor, because the migration runs with no session. A transaction update from here still writes the flag and the category into the meta. A rule restore confirms a guess made before the rule existed: the category now matches the supplier's remembered rule, so the row goes back to an assignment. That audit is written once. `restore_rule` records the flag from before the restore (`category_suggested` true). The row itself ends false, so the audit describes that one restore and not a new suggestion. A second run does not write another row. The same exclusion covers a reopened missing-project approval and a pending undo. This amends [0070](0070-split-remainder-and-undo-log.md) point 9.

## Alternatives rejected

Calling the shared card "עלות משותפת, אישור פותח את החלוקה". The sentence is "הוצאה משותפת · אישור יפתח חלוקה". Putting the guessed category name back into the breakdown. Hiding the waiting amount and leaving the total short.

## Consequences

Approving a shared cost from the queue lands on Split. A refused single-project save names the split screen. A project page can be added up from the category list without showing a guess the owner has not confirmed.
