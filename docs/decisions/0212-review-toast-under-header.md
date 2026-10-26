# Review toasts hang under the header; the undo stays 5s, a failed approve stays

**Date:** 2026-10-26
**Status:** Accepted (owner, 2026-10-26, FLOW-960. Supersedes [0137](0137-review-toast-above-bar.md) §2 to §4 for לאישור; refines [0182](0182-toast-above-the-bottom-bar.md) and [0180](0180-instant-tap-notify-on-failure.md) for לאישור only)

## Context

FLOW-960 reviewed לאישור against a UX/UI rule set. On a phone the toast above the action bar covered the bottom of the card, the 3s undo was short for a queue the owner works through quickly, and a failed approve's notice left after 5s, so a missed glance lost the only sign that the card came back. The owner approved the Review v2 board and, on a choice card on 2026-10-26, chose to hang the toasts under the header (over 0137's place above the bar), and to keep the undo 5s and a failed approve until it is acted on, on לאישור only.

## Decision

1. On לאישור every toast takes `place: "top"`: the approve undo, the setup handoff, the reopen results, Jev's booking approvals and the errors. One screen keeps one toast place.
2. A `top` toast sits `--space-2` under the screen's `[data-toast-ceiling]`: the visit meter, or the counter row when no meter is drawn, else the page header. Its inline padding is `--space-card-inset`, so it lines up with the card. It never covers the card's actions or the bar.
3. The approve undo ("הפריט אושר" with ביטול) stays 5s. A failed approve ("לא הצלחנו לשמור" with ניסיון חוזר) has no timer: it stays until its action, a tap or a swipe. Hover, focus and a press still pause a timed toast.
4. Every other screen keeps 0182's place above the floor and its times.

## Alternatives rejected

- Keeping 0137's place above the bar: the toast covered the end of the card on a 375px phone, and the board put the feedback where the eye returns after the card leaves.
- Making the 5s undo and the staying failure app-wide: every screen's toast times would move with no review of those screens; it can follow on its own.
