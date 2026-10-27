# On לאישור the change sheet saves on the pick, with ביטול for 5s; a missing field is named under its row

**Date:** 2026-10-27
**Status:** Accepted (owner, 2026-10-26, FLOW-971: the OWNER CALL on the Review lists v2 board, "saves on pick, 5s ביטול". Amends [0180](0180-instant-tap-notify-on-failure.md) point 6 for the change sheet on לאישור only; extends [0212](0212-review-toast-under-header.md)'s toast place and time to it)

## Context

FLOW-971 reviewed the review lists and the review change sheet (`/review/change`, שינוי on a card) against the UX/UI rule set used for לאישור and the other v2 screens. Since 0180 point 6 (FLOW-831), a tap in the sheet's project or category picker only moved the check, and a pinned שמירה saved it. On לאישור that was a second tap on every change, in a queue the owner works through quickly, and an incomplete edit said only "בחרו פרויקט וקטגוריה." in grey under both rows, so the owner had to read which one was missing. The board's owner call chose to save on the pick and offer ביטול instead, and to name each missing field.

## Decision

1. In the change sheet on לאישור (`/review/change`), a tap on a project or category row is the pick: it draws at once and saves in the background with the write the sheet already used (`resolve_review` with `changed`, `reassign_transaction` on a closed review, the split writes). There is no pinned שמירה. The transaction page's change sheet and the reviewer preview keep 0180 point 6.
2. The save's toast hangs under the header (`place: "top"`) and names what was saved: "השיוך נשמר · <project> · <category>", with ביטול for 5s. ביטול calls `reopen_review`: the item goes back to the queue with its previous assignment, as the approve undo does (0212). A failure rolls the pick back and offers ניסיון חוזר, as before.
3. A pick that leaves a field missing returns to the summary and names it: the missing row gets a red edge (the error colour) and its own line under it, "בחרו פרויקט" or "בחרו קטגוריה", which the row names with `aria-describedby`. ✕ or Back with a field missing stays open once and shows the same lines; ביטול השינוי, or a second ✕, discards the edit.
4. The line under לזכור לספק הזה says what the rule does: "השורה הבאה מ־<supplier> תיכנס לבד ל<category>. כדי שלא, כבו את המתג." The rule keeps the category only ([0064](0064-review-round4.md); [0216](0216-lines-toasts-and-supplier-rule.md) point 5: nothing gives a new line a remembered project).

## Alternatives rejected

- Keeping שמירה on לאישור: the owner chose one tap with an undo.
- The board's remember line, "תיכנס לבד ל־<project> · <category>. אפשר לבטל בהגדרות.": a sync does not apply a remembered project, and no settings page lists supplier rules, so both halves would promise what nothing does. Open for the owner (FLOW-971 PR).
