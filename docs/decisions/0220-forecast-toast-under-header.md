# תזרים צפוי toasts hang under the header; an undo stays 5s, a note 4s

**Date:** 2026-10-27
**Status:** Accepted (owner, 2026-10-26, FLOW-970. Extends [0212](0212-review-toast-under-header.md) §1 to §3 to תזרים צפוי, as [0215](0215-recurring-toast-under-header.md) did for קבועים; refines [0182](0182-toast-above-the-bottom-bar.md) for this screen only)

## Context

FLOW-970 reviewed the month-end forecast (/forecast) against the same UX/UI rule set as the other v2 screens. Its toasts (a change, a move to next month, the reset, each with ביטול) sat above the tab bar for 3s, over the last rows. A change also showed a second toast when the write came back ("הצפי עודכן" with no action), which replaced the one with ביטול. The owner approved the Forecast v2 board, whose toasts hang under the header: an undo 5s, a plain note 4s.

## Decision

1. On תזרים צפוי and a row's page every toast takes `place: "top"`: the undos, and the failures of its writes (`useSetForecastItem`, `useResetForecastMonth`, `useRestoreForecast`). `forecastToast()` sets it for the screen's own toasts.
2. An undo (ביטול) stays 5s; a toast with no action stays 4s. A failure with ניסיון חוזר keeps useWrite's time (5s). Hover, focus and a press still pause a timed toast.
3. A change's write has no success toast of its own: the screen's toast with ביטול is the confirmation, and a later one would replace it (0182).
4. The month's writes share a scope (`month-forecast-<yyyy-mm>`), so a change and its ביטול run in the order tapped.
5. Every other screen keeps its own decision's place and times.

## Alternatives rejected

- Keeping 0182's place above the floor: the toast covered the list's last rows, where the moved row folds away.
- Keeping the write's own "הצפי עודכן": it took the ביטול away a moment after the tap.

**Since FLOW-973 (2026-10-27):** these toasts use the one under-the-header helper, `topToast()` / `useTopToast()` in `app/src/ui/top-toast.ts` (decision 0222), with the same times; the screen's own helper is gone.
