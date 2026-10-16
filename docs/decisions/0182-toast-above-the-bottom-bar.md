# Toasts rise from above the bottom bar

**Date:** 2026-10-16
**Status:** Accepted

## Context

The redesign's board (2026-10-15) draws every toast above the bottom of the screen, not under the page header. The Lines, Recurring and Design guide frames place it 16px above the tab bar or the pinned action bar, with 16px sides. The board also sets the timings: a change toast stays 3 seconds with ביטול, and the toast rises in 200ms and sinks out in 160ms.

The header placement came from [0069](0069-back-and-one-tap-review.md) point 8 and [0075](0075-save-on-tap-and-on-leave.md) points 1 and 7. It put a confirmation under the header, and over an open sheet it needed pads and gap rules to keep the sheet's controls clear. Those rules cost a pad move before every confirmation, and a toast that sat on the page's title.

## Decision

1. **A toast sits above the floor.** The floor is the top of a pinned `[data-toast-floor]` bar when one shows, else the tab bar, else the screen bottom above the home indicator. The toast sits 16px above the floor, with 16px sides. Every confirmation (`place: "page"`) sits there, with or without a sheet open. `place: "bar"` (0137) is unchanged.
2. **Over an open sheet, a non-confirmation keeps its place above the sheet** (0074 point 6). An error or an info notice anchors above the sheet's top edge, with or without an action, and the sheet pads only when a control would be covered (0075 point 7).
3. **Timings.** A confirmation, with or without an undo (ביטול), stays 3 seconds. An error or info notice stays 4 seconds, and 5 seconds with an action (ניסיון חוזר, 0180). Hover, focus and a press still pause the timer. The toast rises 12px as it fades in over 200ms (`--motion-fade`), and sinks 12px as it fades out over 160ms (`--motion-toast-out`). A new toast that arrives while one sinks cancels the sink, and fades in as usual.
4. **Look.** The toast is at least 52px tall (`--control-height`), with a 14px radius and 15/400 text. ביטול is 15/500 with no underline, in a 44px target. A confirmation has no icon. An error and an info notice keep theirs.
5. **Reduced motion** takes the end state at once (§2.1). Every duration is 0, and the toast shows and clears in the same frame.

This amends point 1 of [0074](0074-toast-and-remembered-supplier.md) (the times), and point 6 of [0074](0074-toast-and-remembered-supplier.md) for confirmations, which go to the page floor of point 1 and not above the sheet. It also amends the "under the header" placement of [0069](0069-back-and-one-tap-review.md) point 8 and [0075](0075-save-on-tap-and-on-leave.md) points 1 and 7 for confirmations. [0074](0074-toast-and-remembered-supplier.md) points 2 to 5 and 7, [0137](0137-review-toast-above-bar.md) and the failure toast of [0180](0180-instant-tap-notify-on-failure.md) stay.

## Alternatives rejected

- **Keep the header placement and shorten the timings only.** The board draws the toast above the bottom bar on every screen, so the header anchor would contradict it, and the sheet pads would stay for no gain.
- **Anchor a confirmation above an open sheet, as 0074 does for other toasts.** Over a sheet the bottom of the screen is still clear, and one rule for every confirmation keeps the toast on the same line from screen to screen.

## Consequences

- The toast's position no longer depends on the page header, so a screen with no header or a tall header shows it in the same place.
- Confirmations no longer pad a sheet. A confirmation over a sheet may cover the sheet's bottom controls for 3 seconds; ביטול and the tap-to-dismiss stay reachable.
- The placement code loses its header and control-collision passes, its best-room cap and the sheet straddle check, which were only for the header anchor.
