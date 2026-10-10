<a id="flow-416"></a>
# FLOW-416 · Home shows what profit leaves out of the month's cash
- **Type:** PLAN FIRST · **Status:** claimed (Home profit line, 2026-10-10, claude/project-thread-4abcul) · **Depends on:** [FLOW-413](FLOW-413.md), [FLOW-103](FLOW-103.md)
- **What:** On cash Home, נכנס and יצא don't add up to "רווח החודש", and nothing says why. Profit leaves out money that moved in the bank but is not income or an expense (renovation kept out of profit, owner's capital, loan principal).
- **Owner's pick:** option A, approved by the owner on 2026-10-10: under יצא, "רווח החודש", then a quiet "לא נספר ברווח" row with a short hint naming its categories. The two rows add up to the month's cash. A tap on the new row opens the month's lines page for the lines not counted in profit, in the same look as נכנס and יצא.
- **Mockups:** `mockups/plan-first/home-profit-line/` in the project files: a and a2 (picked).
- **Acceptance:** `cash_months` gives each month's not-in-profit total and its top categories; `cash_month_lines` takes a `not_in_profit` side; the MCP `get_cash_months` and `get_cash_lines` follow; Home and the month page show the row; stories and tests cover it.
