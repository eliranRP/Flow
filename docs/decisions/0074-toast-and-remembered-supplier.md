# Toast timing, and the supplier's full name

**Date:** 2026-09-29
**Status:** Accepted

## Context

The r23 review left two open questions. O14 asked how long a toast stays. O15 asked what "לזכור לספק הזה" shows of the supplier. A tap on a toast over an open sheet was also closing the sheet, and every toast had grown to a two-line minimum even when the text was one line.

## Decision

1. A toast with an action (ניסיון חוזר, ביטול, לחלוקה) stays 5 seconds. A plain confirmation stays 4 seconds. An error, and an info notice with no action, stay 4 seconds. The timer pauses on hover, on focus, and while the toast is being touched, from pointerdown until pointerup or cancel. This amends [0069](0069-back-and-one-tap-review.md), which left a confirmation at 2.5 seconds.
2. The two-line minimum applies only when the toast text shrinks or wraps. It is not a minimum on the container. A single line stays the mockup height: the padding plus one line of the label.
3. A tap on a toast never reaches the sheet's outside-click or scrim. The tap dismisses the toast or runs its action, and the sheet stays open.
4. "לזכור לספק הזה" shows the supplier's full name. The name is always visible and wraps onto a second line when it needs to. It is never truncated. The project and category that follow take the remaining space and wrap. This replaces the ellipsis in the first writing of this record.
5. "כולל חלק מהוצאות משותפות" shows only when at least one category line includes a shared-cost share (`has_shared_share` on that line). The sentence uses the primary text colour.
6. A toast over an open sheet does not cover the sheet's header or the subtitle, which is the item being saved. It anchors just above the sheet's top edge. When there is no room there, it sits at the screen top, and it still does not cover the sheet header.
7. Toast text uses `text-wrap: balance`, so a single word is not left alone on the last line.

## Alternatives rejected

Keeping a plain confirmation at 2.5 seconds. Giving every toast the two-line height. Showing only the last word of the supplier. Truncating the supplier name with an ellipsis. Leaving the shared-cost sentence on every project, or in the muted colour.

## Consequences

ניסיון חוזר and ביטול stay long enough to tap, and a finger on the toast holds the timer. A one-line "הפריט אושר" matches the mockup. Retrying a save from the toast still has the form underneath, and the toast does not cover the item being saved. The remember line names the whole supplier. The shared-cost sentence appears only on a project whose lines include a share.
