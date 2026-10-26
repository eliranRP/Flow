# A project forecast row's toasts hang under the header; הסרה מהצפי stays 5s with ביטול, a note 4s

**Date:** 2026-10-26
**Status:** Accepted (owner, 2026-10-26, FLOW-969. Extends [0212](0212-review-toast-under-header.md) §1 to §3 to a project's next month and its edit page, as [0215](0215-recurring-toast-under-header.md) and [0217](0217-add-toast-under-header.md) did for קבועים and the + form; refines [0182](0182-toast-above-the-bottom-bar.md) for these pages only)

## Context

FLOW-969 reviewed the profit pages against the UX/UI rule set used for לאישור, the project page, Lines and the + form. A forecast row's toasts ("הוסר מהצפי" with ביטול, "הצפי נשמר") sat above the tab bar for 3s, under the thumb that had just tapped הסרה מהצפי or שמירה. The removal already carried an undo (`undo_project_forecast`); it was the place and the time that failed it. The owner's card on the Profit v2 board answered "At once, 5s undo": the row leaves at once and the toast under the header offers ביטול for 5s.

## Decision

1. Every toast a project forecast row's writes show takes `place: "top"`: the removal and its ביטול, the save, the added row.
2. A `top` toast sits under the screen's `[data-toast-ceiling]`, else its page header, as 0212 §2 says.
3. An undo (ביטול) stays 5s; a note stays 4s. Hover, focus and a press still pause it.
4. The two writes share one `useWrite` scope per project (`project-forecast-<id>`), so a quick ביטול after a save runs after it, never before.
5. Every other screen keeps 0182's place and its times, as 0212 §4 says.

## Alternatives rejected

- Asking before the removal ("להסיר מהצפי?"): the owner chose at once with an undo; the row is a forecast, not money.
- Keeping 0182's place above the floor: the toast sat under the thumb.
