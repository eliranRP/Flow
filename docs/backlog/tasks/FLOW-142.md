<a id="flow-142"></a>
# FLOW-142 · Loans summary page, and the loan page's paid card first
- **Type:** UI (design approved) · **Status:** in-progress (claimed 2026-10-18, feat/flow-142-loans-summary) · **Depends on:** [FLOW-139](FLOW-139.md) (the Loans tab and the loan page this builds on) · **Source:** the owner approved it on 2026-10-18. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "Ready for dev", section "Loans tab" (boards: "Loans · סיכום הלוואות (from the start)", "Loans · סיכום הלוואות · 2026", and the loan pages "Loan · regular" and "Loan · interest only" in their new order), light versions on "Light theme · ready for dev"; the spec note next to "Loans tab".
- **Files:** a new `app/src/screens/loans-summary-screen.tsx` (and its route next to `/loans`), the loans summary card in FLOW-139's list (one entry row), `app/src/screens/loan-detail-screen.tsx` (card order and the paid card), a pure `app/src/loans-paid.ts` (totals per loan and period), their stories and tests. Remove the loan page's "שולם השנה" block and the large next-payment card that this replaces.

**Entry**
- [ ] The Loans tab's summary card gets a last row: "מה שולם עד היום, וכמה נשאר מהחוב" (15/400, accent, chevron, 48px, a line above). It pushes the summary page in from the left (300ms; back 260ms, Back = "הלוואות"). After 60px of scroll the top bar shows "סיכום · $left".

**Summary page (סיכום הלוואות)**
- [ ] Title 32/600 and one grey line: active count and since when ("מאז <first loan's start>"; in 2026: "מ־01/01/2026 עד היום").
- [ ] Period switch: מתחילת ההלוואות (default) / <this year>. Everything below follows it.
- [ ] Debt card: "החוב בהתחלה" = sum of the active loans' original amounts (in the year: the debt on 01/01 = today's balance + principal paid this year); "נשאר לשלם היום" 34/400; an 8px bar of principal paid on the track (fills from the right); "נפרע מהקרן · N%" with the amount.
- [ ] Paid card: total paid in the period 34/400, the tab's three-part bar and rows (קרן / ריבית / נאמנות), and one line: "הריבית היא מה שההלוואות עלו: $X עד היום" (or "השנה").
- [ ] לפי הלוואה: per loan, initial, lender, paid in the period (all parts), "נשאר $X · נפרע N%" (interest-only: "ריבית בלבד"), and a 4px bar of its principal paid. A row pushes that loan's page over the summary.
- [ ] Closed loans: one quiet line naming them; they stay out of the sums.

**Loan page order**
- [ ] 1. יתרה היום (unchanged). 2. שולם, the same card as the summary: a מההתחלה / <year> switch (chips 14/500 in a tinted track), total 34/400, three-part bar, rows קרן / ריבית / נאמנות each with one grey line ("מקטינה את החוב · לא נספרת ברווח", "נספרת ברווח", "מסים וביטוח · נספרת ברווח"), and "הריבית היא מה שההלוואה עלתה עד היום" (or "השנה"). 3. התשלום הבא as a short card: "התשלום הבא · dd/mm", the amount, one grey line with the parts. 4. Details. 5. 3 התשלומים האחרונים with כל התשלומים.

**Numbers**
- [ ] Principal paid = original − balance (for the year: principal parts of this year's payments). Interest and escrow are the sums of the saved payment splits ([FLOW-139](FLOW-139.md)'s attach_loan_payment parts), never estimated. A loan with no saved splits shows its principal only and says so in the grey line.
- **MCP:** read only. If `list_loans` or `get_loan_schedule` can't return paid-to-date per part and per year in one read, add `get_loans_paid` (company, period) returning per loan [principal, interest, escrow] and list it in TOOLS.md; no new write.
- **Acceptance:** stories of the summary (from the start, this year, one interest-only loan, one closed loan) and the loan page in the new order, at 320 and 393, dark and light, with invented figures that add up; unit tests of `loans-paid.ts` (principal = original − balance, the year's opening debt, closed loans left out, a loan with no splits); the period switch keeps its choice while the page is open; a row opens the right loan; design review against the boards.
