<a id="flow-931"></a>
# FLOW-931 · צפי: the forecast by category, and an item opens its own page
- **Type:** UI (design approved) · **Status:** ready · **Depends on:** [FLOW-141](FLOW-141.md) (the month-end forecast this changes), [FLOW-366](FLOW-366.md) (the transaction page whose parts the item page reuses) · **Source:** the owner approved it on 2026-10-18 and 2026-10-19. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "Ready for dev", section "Month-end forecast (צפי)" (boards "Forecast · לפי קטגוריה", "Forecast · item page" and "Forecast · מתי צפוי"), light versions; spec note "Month-end forecast". The canvas page "What changed" lists it.
- **Files:** `app/src/screens/month-forecast-screen.tsx` and its item sheet (replaced by an item page), a pure helper for the per-category totals, their stories and tests. Remove the item sheet, its CSS and stories.

**By category**
- [ ] Chips under the big figure: "לפי פריט" (today's list) / "לפי קטגוריה".
- [ ] By category: two groups, יוצא and נכנס, each with its end-of-month total. One row per category: the name, "עד היום $X · עוד $Y" (or "אין עוד צפוי"), the end-of-month figure, and a 4px two-part bar (accent for what is in, dim purple for what is still expected). A legend under the list.
- [ ] A category with a late item says so in the signal colour ("FPL באיחור · עוד $962"). A row opens in place: "עד היום", then each expected item with its date; a late recurring item without a match links to "עדיין קבוע? לאישור" ([FLOW-930](FLOW-930.md)).

**An item opens a page, not a sheet**
- [ ] Built from the transaction page: the status tag ("צפי · באיחור 34 ימים", signal colour when late), the name, the amount as an input (40/400, pencil, underline), the meta line; a card פרויקט / קטגוריה; a card with "מתי צפוי" (calendar icon, the value in accent, chevron) and the source row (the invoice, the bill or the recurring charge, opening it); שמירה.
- [ ] "מתי צפוי" opens a radio sheet in the same style as "כל כמה זמן": השבוע · עד <date> · לא החודש, each with a caption. "לא החודש" keeps today's fold-away motion after the page closes.

- **Acceptance:** stories of the category view (one row open) and the item page (and its sheet), dark and light; the totals per category add up to the forecast's end figure; design review against the boards.
