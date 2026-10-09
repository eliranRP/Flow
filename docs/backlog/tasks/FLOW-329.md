<a id="flow-329"></a>
# FLOW-329 · Out of the P&L as a visible row on the transaction
- **Type:** SMALL UI · **Status:** done (#248) · **Depends on:** — · **Overlaps:** FLOW-124 · **Source:** cycle 1 (U5, D15)
- **What:** On the transaction detail, the only way to take a line out of the P&L is an unlabelled ⋯ at the top-left corner, the hardest spot to reach one-handed. Show a "ברווח והפסד" switch row under the category row; keep ⋯ only for delete. Move "פיצול בין פרויקטים" to the bottom of the screen, in the thumb zone. (cycle 3) The new "פיצול" section from #150 also sits mid-screen; it moves with it.
- **Acceptance:** out-of-P&L is one tap on the detail and reversible; ⋯ shows only when delete applies; tests; design review.
- **Done (#248):** a "ברווח והפסד" switch row under the category row (a loan line shows it locked); ⋯ only on a manual line, holding מחיקה. The פיצול section was already at the bottom of the card.
- [x] (Backlog bug fixes, 2026-10-09: the hint is "תשלום הלוואה · לפי הקטגוריה") Follow-up from #252: a line in a loan category with no loan split (`pnl_fixed`, unmatched) still shows the locked row as "תשלום הלוואה · נספר לפי הפיצול", though nothing is split. Give it its own hint (#252 changed only the matched case, to "לפי חלקי ההלוואה").
