# The review queue lists every pending item, and the card rows open the picker

**Date:** 2026-10-02
**Status:** Accepted

## Context

לאישור shows one card at a time. The project and category lines on that card are text. The only way into the picker is שינוי. The owner asked to see every pending expense in one list, and to open the picker from the line itself.

[0075](0075-save-on-tap-and-on-leave.md) already saves a change-sheet tap. This record does not add a second save. [0069](0069-back-and-one-tap-review.md) still owns אישור.

## Decision

1. The card notes change because the lines are now the control. "בחרו בשינוי" becomes "הקישו לבחירה". "אין הצעה, בחרו בשינוי" becomes "אין הצעה, הקישו לבחירה".
2. הצג הכול is a text button directly under the progress bar on the company queue, above the card and above the שויכו היום banner when that banner is showing. It is a route, `/review/all`, so Back and refresh work. The page is one scrollable list of every open review item in that company. Each row shows the supplier, the date, and the amount. Tapping a row opens that item as the queue card. Back from that card returns to `/review/all`. A project-filtered queue does not list another project's items.
3. The split title stays "מפוצל · N פרויקטים", with the middle dot.
4. Tapping the פרויקט row or the קטגוריה row opens that picker. שינוי stays. The save is the change sheet's save: a complete assignment writes on the tap, a missing project or category holds, a split's project row opens the split, and a split's category row saves the category. The rows use the same `ListRow` chevron as the change sheet. Tapping "מפוצל · N פרויקטים" opens the split.

## Alternatives rejected

A sheet for the full list. Back and refresh would not be the route's. A bullet in the split title. Leaving "בחרו בשינוי" after the line itself opens the picker. A new save path that approves a half-filled card.

## Consequences

The queue card and `/review/all` are the same company and the same open items. There is no migration.
