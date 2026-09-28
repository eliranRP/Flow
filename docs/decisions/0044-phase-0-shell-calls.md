# Phase 0 shell calls

**Date:** 2026-09-27
**Status:** Accepted

## Context

The UI review of the Phase 0 shell compared the app with the mockups and [DESIGN-RULES.md](../design/DESIGN-RULES.md). A few gaps were not a defect in the mockups so much as a choice the product still had to make: what the preview banner says, what the first-run empty state offers now that [0042](0042-sumit-primary-income-and-expenses.md) makes SUMIT primary, and how to treat type sizes and placeholder screens that the guide does not spell out for this phase.

## Decision

1. The preview banner is shown only in `?preview=1` mode (and the other `?preview=` review states). It is a small Hebrew hint, "מצב תצוגה", with no English. It sits in the band's existing bottom padding and does not push the band down.
2. The first-run empty button is a secondary pill, as in guide §8.2.
3. The first-run copy follows 0042. The button is "חיבור SUMIT". The line says the profit appears once SUMIT is connected. Bank upload stays a later, secondary path. It is not on this empty state.
4. Text that the mockups draw at 17px uses the nearest step on the type scale: title-3 size, with body weight when the line is a subtitle rather than a title.
5. Placeholder routes use the plain template A title. No wordmark and no extra explanation.
6. Home's error state follows `ld-08`. Preview can open it with `?preview=error`, loading with `?preview=loading`, and the empty first run with `?preview=empty` or `?preview=1`.

## Alternatives rejected

Keeping the English example-data tag as a line under the band. It pushed the layout and mixed languages on a Hebrew screen.

Leaving "העלאת דוח בנק" on the first-run empty state. That copy matches the older mockup and fights 0042.

Inventing a 17px style beside the type scale.

## Consequences

[DESIGN-RULES.md](../design/DESIGN-RULES.md) points the Home empty success line here. The mockup files stay as they are. A later screen that connects SUMIT replaces the button's destination, not this copy.
