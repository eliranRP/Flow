# The review queue lists every pending item, and the card rows open the picker

**Date:** 2026-10-02
**Status:** Accepted

## Context

לאישור shows one card at a time. The project and category lines on that card are text. The only way into the picker is שינוי. The owner asked to see every pending expense in one list, and to open the picker from the line itself.

[0075](0075-save-on-tap-and-on-leave.md) already saves a change-sheet tap. This record does not add a second save. [0069](0069-back-and-one-tap-review.md) still owns אישור.

## Decision

1. The card notes change because the lines are now the control. "בחרו בשינוי" becomes "הקישו לבחירה". "אין הצעה, בחרו בשינוי" becomes "אין הצעה, הקישו לבחירה".
2. הצג הכול is a text button on the company queue, at the end of the "N מתוך M" row, above the card and above the שויכו היום banner when that banner is showing. It is a route, `/review/all`, so Back and refresh work. The page is one scrollable list of every open review item in that company. Each row shows the supplier, the date, and the amount. Tapping a row opens that item as the queue card. Back from that card returns to `/review/all`. A project-filtered queue does not list another project's items.
3. The split title stays "מפוצל · N פרויקטים", with the middle dot.
4. Tapping the פרויקט row or the קטגוריה row opens that picker and marks the address `from=line`. A card opened from the list also sets `list=all`, so closing still returns to that card. The line pick saves only that field and does not resolve the review: `resolve_review` is called with `p_resolve` false, and a split's category uses `set_transaction_category` with `p_resolve` false. The card stays and shows the new value. אישור still resolves the item. A category picked on a card with no project saves the category alone and leaves the project line on "חסר פרויקט, הקישו לבחירה". The summary does not open. שינוי stays, and a complete assignment there still resolves the item. A refreshed שינוי picker has no `from=line`, so ✕ returns to the summary and keeps the unsaved-change warning. The queue address advances only when the path is exactly `/review`, never while `/review/change` is open. Focus returns to the line that opened the picker. A split's project row opens the split. The rows use the same `ListRow` chevron as the change sheet. Tapping "מפוצל · N פרויקטים" opens the split.
5. After the last item, Back goes to `/review`, not the empty list.
6. A card opened from the list shows its position, such as "14 מתוך 15", not the progress bar.
7. The list keeps the queue's title, לאישור, and its subtitle, מסמכים שמחכים לשיוך.

## Alternatives rejected

A sheet for the full list. Back and refresh would not be the route's. A bullet in the split title. Leaving "בחרו בשינוי" after the line itself opens the picker. A new save path that approves a half-filled card.

## Consequences

The queue card and `/review/all` are the same company and the same open items. `resolve_review` takes `p_resolve` (default true). A card-line pick passes false and leaves the review open. `set_transaction_category` takes the same flag so a split's category line does not close a missing-category review.
