# קבועים toasts hang under the header; an undo stays 5s, a note 4s

**Date:** 2026-10-26
**Status:** Accepted (owner, 2026-10-26, FLOW-963. Extends [0212](0212-review-toast-under-header.md) §1 to §3 from לאישור to קבועים; refines [0182](0182-toast-above-the-bottom-bar.md) for קבועים only)

## Context

FLOW-963 reviewed קבועים against the same UX/UI rule set as לאישור (FLOW-960). Its undo toasts (התעלמות, the late bill's answers, the match answer, the pace and the usual amount) sat above the tab bar for 3s, where they covered the last rows and left before a missed glance came back. The owner approved the Recurring v2 board, whose toasts hang under the header: an undo 5s, a plain note 4s.

## Decision

1. On the קבועים list and its charge page every toast takes `place: "top"`: the undos, the notes ("ההתראה חזרה") and the failures, useWrite's included. `recurringToast()` sets it.
2. A `top` toast sits under the screen's `[data-toast-ceiling]` as 0212 §2 says. The charge page marks its top bar; the list has no bar, so its toast sits under the safe top.
3. An undo (ביטול) stays 5s; a toast with no action stays 4s. A failure with ניסיון חוזר keeps useWrite's time (5s); nothing on קבועים persists. Hover, focus and a press still pause a timed toast.
4. Every other screen keeps 0182's place and its times, as 0212 §4 says.

## Alternatives rejected

- Keeping 0182's place above the floor: the toast covered the last rows of the list, and the board puts feedback where the eye returns after the row moves.
- Making the 5s undo app-wide: the same reason as 0212; each screen moves with its own review.
