# A change is saved on the tap, and again when the sheet is left

**Date:** 2026-09-29
**Status:** Accepted

## Context

On production (`da3a9c1`) a split expense kept its old category after Change assignment. The expense was 3,200 ₪ on 01/07/2026, split across six projects. The category picker showed the new row checked. After leaving the sheet, the transaction still had the old category, on the server and after a reload.

The round 8 function did not regress. `set_transaction_category` still updates only `category_id` and `user_assigned`. Shares, `pnl_role`, and `project_id` stay. Round 17 repeats that for six shares. The check was local React state. The write ran only from שמירה / שמירה ואישור. Closing the sheet copied the server row back over the check, so the tap was thrown away.

## Decision

1. A tap on a project or a category in the change sheet writes immediately. That is `reassign_transaction` for an ordinary row, and `set_transaction_category` for a split (`pnl_role` shared, an `unallocated_shared` review, or more than one share). The chosen row is busy: `aria-busy`, cursor progress. The other rows are not-allowed until that write finishes. Then the summary shows the name. A failure rolls the check back to the previous id, stays on the picker, and toasts. The picker is a tall sheet, and focusing a row can scroll the header out of that sheet. A toast that followed the scrolled header sat above the screen, so ניסיון חוזר could not be tapped. The toast now stays inside the viewport: in the visible gap above the sheet, or just under the sheet header when that gap is too small. This amends the off-screen placement in [0074](0074-toast-and-remembered-supplier.md). A dropped connection or a server error offers ניסיון חוזר, and that retry writes the choice that failed, not the rolled-back one. Any other refusal has no retry. A project tap on an unallocated shared cost toasts "עלות משותפת מחולקת במסך החלוקה." with לחלוקה, rolls the check back, and does not call `resolve_review`. This amends [0065](0065-review-round5.md) point 38, which returned to the summary and waited for a save button, and [0068](0068-review-round9.md) point 2, which put שמירה / שמירה ואישור on that summary.
2. Leaving the sheet saves whatever is still pending. That includes the backdrop, the X, a swipe down, the back chevron, and browser back. An incomplete assignment (a missing project or category) does not write and does not close. The summary shows "בחרו קטגוריה." or "בחרו פרויקט וקטגוריה." Split works the same way: a valid dirty choice calls `save_split` on the way out, and an invalid one stays open. The summary already says why ("נשארו N% לחלק", "הסך X%. צריך 100%.", or "בחרו לפחות 2 פרויקטים"). An unchanged split closes without a write.
3. The summary save button is removed, on the change sheet and on Split. The tap and the leave are the save. The new-project name still has שמירה. The name is typed, and that button is what creates the project. Once the project exists, assigning it is the same write as a tap.
4. A remember change that cannot be written again does not close silently. `resolve_review` is the only write that stores "לזכור לספק הזה", and it runs once, with the assignment. After that, or on a split (which does not call `resolve_review`), flipping the switch and leaving keeps the sheet open and shows "הזכירה נשמרת עם השיוך. החזירו את המתג כדי לסגור." Turning the switch back lets the sheet close.
5. The saving row shows a small spinner in place of the check, plus the progress cursor. The other options in that picker or on the split screen stay disabled until the save settles. The not-allowed cursor on those rows stays within the cursor rule. This is the r29 ruling for the busy state on touch.
6. A dismiss during an in-flight save waits for the save to finish, then closes. The dismiss is never dropped.
7. A toast that is too tall for the gap above an open sheet stays in the safe area above the sheet. The text stays balanced. It does not move under the header, where it would cover a control. This amends the "just under the sheet header" placement in point 1.
8. An incomplete change still stays open the first time it is dismissed, and the summary says why. ביטול השינוי sits next to that sentence and discards the change, then closes. A second dismiss does the same. This amends the rejected alternative below: the first leave still does not throw the change away.

## Alternatives rejected

Keeping שמירה ואישור as a second confirm after the tap. The tap is the confirm. A second button is what dropped the category on the phone.

Closing an invalid split on the first dismiss and discarding the percents. The owner asked that a change happen when they leave, and that an invalid one not disappear the first time. A later ruling (point 8) adds ביטול השינוי and a second dismiss, which do discard.

Calling `resolve_review` a second time to store a later remember toggle. The review item is already closed, and the call fails.

## Consequences

The transaction sheet stays open after a successful tap, with "השיוך נשמר" and ביטול when the write returned an undo id. Closing it does not undo the write. A review tap that resolves the item also stays on the sheet until the owner leaves; leaving returns to the queue.

`list_review` reports `pnl_role` and `share_count`. A category tap on any split in the queue calls `set_transaction_category` and keeps the shares. A project tap calls `collapse_split`, with the note and ביטול. The sheet does not ask for a project on a split. After the review item closes, the loaded row stays so a second pick can call `reassign_transaction`. There is still no separate write for a remember toggle after the assignment. That remains an open question.
