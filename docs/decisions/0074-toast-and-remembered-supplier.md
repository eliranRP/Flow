# Toast timing, and the supplier's full name

**Date:** 2026-09-29
**Status:** Accepted

## Context

The r23 review left two open questions. O14 asked how long a toast stays. O15 asked what "לזכור לספק הזה" shows of the supplier. A tap on a toast over an open sheet was also closing the sheet, and every toast had grown to a two-line minimum even when the text was one line.

## Decision

1. A toast with an action (ניסיון חוזר, ביטול, לחלוקה) stays 5 seconds. A plain confirmation stays 4 seconds. An error, and an info notice with no action, stay 4 seconds. A pointer hover still pauses the timer. This amends [0069](0069-back-and-one-tap-review.md), which left a confirmation at 2.5 seconds.
2. The two-line minimum applies only when the toast text shrinks or wraps. It is not a minimum on the container. A single line stays the mockup height: the padding plus one line of the label.
3. A tap on a toast never reaches the sheet's outside-click or scrim. The tap dismisses the toast or runs its action, and the sheet stays open.
4. "לזכור לספק הזה" shows the supplier's full name, for example "צבעי הגליל בע״מ". A name that does not fit is truncated with an ellipsis. It is never only the last word.

## Alternatives rejected

Keeping a plain confirmation at 2.5 seconds. Giving every toast the two-line height. Showing only the last word of the supplier.

## Consequences

ניסיון חוזר and ביטול stay long enough to tap. A one-line "הפריט אושר" matches the mockup. Retrying a save from the toast still has the form underneath. The remember line names the supplier the rule will apply to.
