# The + form's toasts hang under the header; an undo stays 5s, a note 4s

**Date:** 2026-10-26
**Status:** Accepted (owner, 2026-10-26, FLOW-966. Extends [0212](0212-review-toast-under-header.md) §1 to §3 to the + form, as [0215](0215-recurring-toast-under-header.md) did for קבועים; refines [0182](0182-toast-above-the-bottom-bar.md) for the + form only)

## Context

FLOW-966 reviewed the + sheet against the UX/UI rule set used for לאישור, the project page, הלוואות and קבועים. Its save toast ("ההוצאה נשמרה · <project>", with ביטול) sat above the tab bar for 3s, under the thumb that had just tapped שמירה and gone before a glance came back. The owner approved the Add v2 board, whose toasts hang under the header: an undo 5s, a note 4s.

## Decision

1. Every toast the + form shows takes `place: "top"`: the save and its ביטול, the matched receipt's "הקבלה צורפה לתנועה של <supplier>", and the notes "נוצר פרויקט <name>" and "נוצרה קטגוריה <name>".
2. A `top` toast sits under the screen's `[data-toast-ceiling]`, else its page header, as 0212 §2 says. The form has closed by then, so it is the header of the screen the + sheet was opened over.
3. An undo (ביטול) stays 5s; a note stays 4s. Hover, focus and a press still pause it.
4. Every other screen keeps 0182's place and its times, as 0212 §4 says.

## Alternatives rejected

- Keeping 0182's place above the floor: the toast sat under the thumb on the tab bar, where the + was just tapped.
- An app-wide change: each screen moves with its own review, as 0212 and 0215 say.
