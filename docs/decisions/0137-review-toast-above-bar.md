# Review toasts sit above the action bar

**Date:** 2026-10-08
**Status:** Accepted (owner, 2026-10-08: the skip-undo toast above the bar)

## Context

On לאישור the actions אישור, שינוי and דלג sat at the end of the scrolling card, so at 375x667 they moved with the card and the tab bar could cover them. [0069](0069-back-and-one-tap-review.md) §8 puts every toast under the page header. On this screen the header is far from the thumb that just tapped דלג or אישור, and the toast's ביטול is the one action the owner needs next. FLOW-327 pins the actions in a shared `ActionBar` above the tab bar.

## Decision

1. A screen's repeated action sits in a pinned `ActionBar` (`app/src/ui/action-bar.tsx`). `place="tabbar"` sits on top of the tab bar; `edge` sits on the screen edge with the safe area. With no tab bar on the page, or with the keyboard open, a `tabbar` bar falls back to the edge. The content scrolls above it.
2. On לאישור every toast takes `place: "bar"`: the approve undo "הפריט אושר" and the skip undo "דילגנו על הפריט" (both with ביטול), the reopen results, the setup handoff, and the errors. One screen keeps one toast place.
3. A `bar` toast sits `--space-2` above the top of the topmost `[data-toast-floor]` (the bar), else above the tab bar. It skips the control-collision pass, the same as `tab`. A confirmation is not moved to the header. The host's inline padding is `--space-card-inset`, so the toast lines up with the card.
4. The toast may cover the bottom of the scrolling card, never the bar. A tap or a swipe dismisses it. The host stays `pointer-events: none`; timings stay as in 0069 §8.

This supersedes [0069](0069-back-and-one-tap-review.md) §8 for לאישור only. Every other screen keeps its toast under the header.

## Alternatives rejected

- Keeping the toast under the header on לאישור: ביטול is far from the tap that needs undoing.
- Moving only the skip toast: the approve undo would land in a different place on the same screen.
- Putting the toast over the bar: it would cover דלג and the next card's אישור.
