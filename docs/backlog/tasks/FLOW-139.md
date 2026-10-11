<a id="flow-139"></a>
# FLOW-139 · Redesign: the Loans tab, the loan page, all payments, and the new-loan sheet
- **Type:** UI (design approved) · **Status:** ready · **Depends on:** [FLOW-363](FLOW-363.md) · **Related:** [FLOW-364](FLOW-364.md) (the הלוואות tab), [FLOW-446](FLOW-446.md) (a property's loans card), [FLOW-138](FLOW-138.md) (a paid-off loan's leftover balance) · **Source:** the owner's approved redesign, handed off 2026-10-11. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "Ready for dev", section "Loans tab" (boards: prototype, a regular loan, an interest-only loan, sheet סוג ההלוואה, sheet הלוואה חדשה, closed shown, all payments of a loan); rules on "Design guide", motion on "Flow & motion".
- **Files:** `app/src/screens/settings-screen.tsx` (`LoansScreen` moves out to its own file, `app/src/screens/loans-screen.tsx`), `app/src/screens/loan-list.tsx`, `app/src/screens/loan-detail-screen.tsx`, `app/src/screens/loan-detail-data.ts`, `app/src/screens/loan-detail-sheets.tsx`, `app/src/screens/loan-setup.tsx`, `app/src/screens/loan-form.ts`, `app/src/screens/loan-copy.ts`, `app/src/screens/loan-outlook.ts`, `app/src/ui/loan-parts-sheet.tsx`, `app/src/App.tsx` (a `/loans` route; `/settings/loans` redirects), `app/src/ui/css/26-loan-row.css`, `app/src/ui/css/29-loan-detail.css`, their stories and tests.

**List**
- [ ] "+ הלוואה חדשה", title הלוואות 32/600, "N פעילות". Compact bar after 90px: + · "הלוואות · $total".
- [ ] Summary card: סך החוב היום (34/400); תשלומים בחודש with the loan page's bar and rows (קרן / ריבית / נאמנות summed over all loans, accent / dim accent / grey), so the interest share of the monthly payment is plain; "הבא: $X ל־<lender> ב־<date> · 12 החודשים הבאים $Y".
- [ ] פעילות: flat rows (lender initial, lender, "<project> · <rate> · <kind>", balance), alphabetical ([0162](../../decisions/0162-loan-page.md): no reorder).
- [ ] "נסגרו · N" collapsed by default; paid-off loans dimmed with "נפרעה <date>".

**Loan page (cards, pushed in from the left)**
- [ ] Fixed top bar shows "<lender> · <balance>" after 60px. Title = lender 24/600, "<project> · <kind> · מאז <date>".
- [ ] Balance card: יתרה היום 40/400, a bar of paid vs remaining, "נפרע $X מתוך $Y · לתשלום עד <year>". Interest-only: "ריבית בלבד: הקרן תיפרע בסוף, <date>".
- [ ] התשלום הבא card: date and total, a bar and rows for קרן / ריבית / נאמנות, with a line on what counts in profit (principal doesn't).
- [ ] Terms card: סוג (the kind sheet), ריבית (rate changes, "מ־date"), פרויקט, סטטוס; each saves alone from its own sheet with an undo toast (0162).
- [ ] שולם השנה: the total, one row per part with its category and whether it counts in profit.
- [ ] 3 התשלומים האחרונים: each opens the payment's transaction; כל התשלומים pushes the all-payments page.

**כל התשלומים (pushed over the loan page; Back = the lender's name)**
- [ ] Header like the transaction page: a chip "כל התשלומים" (tint, accent text), lender 24/600, total paid so far 40/400, "N תשלומים מאז <start> · <project>" 14. After 60px the top bar shows "כל התשלומים · $total".
- [ ] Split card for everything paid so far (קרן / ריבית / נאמנות).
- [ ] Years newest first; the year head ("2026 · N תשלומים" 20/500 and the year's total) sticks under the top bar and is pushed up by the next year.
- [ ] Flat rows: dd/mm, "קרן $X · ריבית $Y" (whole dollars; escrow is in the card), amount, chevron → the transaction. Interest-only shows ריבית only. Interest = balance × rate / 12; the rest of P&I is principal.

**Sheets**
- [ ] סוג ההלוואה (radio): פריסה רגילה / ריבית בלבד / בלון / לפי דרישה, each with one line.
- [ ] הלוואה חדשה (header and שמירה fixed, the middle scrolls): מלווה (required) and פרויקט (default ללא פרויקט); סוג (default פריסה רגילה); סכום מקורי with a $ / ₪ switch inside the field; ריבית שנתית and תקופה בחודשים side by side (the term also shows years, "30 שנה"); תאריך תשלום ראשון; מסים וביטוח לחודש ("0 when not collected with the payment"). ריבית בלבד adds חודשי ריבית בלבד; בלון adds the amortization months; לפי דרישה hides term, date, escrow and payment.
- [ ] A live payment card (accent tint): תשלום חודשי = P&I (standard amortization; interest-only = balance × rate / 12) + escrow, the split line, "תשלום אחרון MM/YYYY", and שינוי to override the computed payment. Saving opens the new loan's page.
- [ ] Loading and empty: use the shared skeleton, empty state, inline spinner and sync strip of [FLOW-371](FLOW-371.md) (pending approval; until it is approved, keep today's parts and invent none).
- **MCP:** `add_loan`, `update_loan`, `set_loan_rate`, `list_loans`, `get_loan_schedule` and `loan_*` undo kinds exist. The list summary (monthly parts over all loans, next payment, next 12 months) and the all-payments page's per-year totals come from `list_loans` / `get_loan_schedule`; add what is missing there and in TOOLS.md.
- **Acceptance:** stories of the list (closed shown), a regular and an interest-only loan page, all payments across two years, both sheets for each kind, at 320 and 393 with invented lenders and round amounts; unit tests of the amortization payment, the interest-only payment and the interest/principal split per row; a test that the year head sticks and is pushed by the next; an e2e that `/settings/loans` lands on the tab; design review against the boards.
