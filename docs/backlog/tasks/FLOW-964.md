<a id="flow-964"></a>
# FLOW-964 · A loan closes by itself when its balance reaches 0
- **Type:** feature (owner call) · **Status:** ready · **Depends on:** FLOW-962 (#824) · **Source:** the owner's card on 2026-10-26, on the Loans v2 board's "נסגרת לבד כשהיתרה מגיעה ל־0": yes, as its own task.
- **Files:** a migration (the close, with the balance checks of [0121](../../decisions/0121-loan-balance-checks.md) and the status rules of [0122](../../decisions/0122-loan-status.md)), its pgTAP test, the loan page's status row and closed head (`app/src/screens/loan-detail-screen.tsx`, `loan-copy.ts`), `docs/mcp/TOOLS.md` (`list_loans`, `attach_loan_payment`), a decision record.

- [ ] When an attached payment brings an open loan's balance to 0 (pending lines included, review-flagged parts left out, as `loan_balances` counts), the loan becomes `paid_off` with `closed_on` the date of that last payment.
- [ ] Detaching or changing that payment so the balance is above 0 again reopens a loan that closed this way (and only this way; a loan the owner closed stays closed). The close must say it was automatic, so the reopen can tell.
- [ ] A demand loan closes the same way once its principal is paid (interest carried does not keep it open), unless the owner says otherwise.
- [ ] The loan page notes it: the closed head reads "נסגרה · נפרעה במלואה · DD/MM/YYYY" with "נסגרה לבד כשהיתרה הגיעה ל־0." under it; an open loan's status row reads "פעילה · נסגרת לבד כשהיתרה מגיעה ל־0".
- [ ] MCP: `attach_loan_payment`'s reply says when the attach closed the loan; `list_loans` shows how a closed loan closed.
- **Acceptance:** pgTAP for the close, the reopen and a loan the owner closed; unit tests for the page's lines; TOOLS.md; a decision record.
