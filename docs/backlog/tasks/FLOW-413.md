<a id="flow-413"></a>
# FLOW-413 · Monthly cash-flow view (תזרים חודשי)
- **Type:** PLAN FIRST · **Status:** owner picked "Cash first" (2026-10-09); data plan written (dev lane 2, the project's plans/flow-413-cash-flow-plan.md); server done (dev lane 3, decision [0168](../../decisions/0168-cash-flow-view.md): #370 the cash flags, the basis, `cash_months`, `cash_month_lines`, the setters; #404 the MCP tools `get_cash_months`, `get_cash_lines`, `set_category_cash`, `set_line_cash`, `set_lines_cash`, `set_cash_basis`); UI in progress (dev lane 3, PR 1 of 2: Home frame b, the month page and the month's lines, /profit; PR 2: the "מה בתזרים" sheet and the line's "בתזרים" switch); real-app shots go to the design lead, then the owner, before the UI merges · **Depends on:** [FLOW-103](FLOW-103.md), planned together with it
- **What:** The owner asked on 2026-10-09 for a monthly view of all money in and out, and made it the main monthly view on Home. Today the profit view leaves the loan out, so rent alone looks positive.
  - Money out: the full monthly loan payment (principal, interest and escrow), holding costs and utilities, purchase and renovation money.
  - Money in: loan money received is left out by default, with a switch to count it.
  - The user can take chosen categories (a "מה בתזרים" sheet) or single transactions (a "בתזרים" switch on the transaction page) out of the view.
  - Profit stays a correct second view.
- **Owner's pick:** "Cash first" (frames b and b-2). Home shows the month's cash with no switch: the figure, then נכנס and יצא rows that drill down, then a quiet "רווח החודש" row that opens today's profit view, then the earlier months.
- **Mockups:** `mockups/plan-first/flow-413/` in the project files: b, b-2 (picked), exclude, tx; a and a-2 were the switch option.
- **Acceptance:** a data plan with FLOW-103 (a cash read per month, an exclusion list per company, a per-line flag), then the UI; the owner sees real-app shots before the UI merges.
