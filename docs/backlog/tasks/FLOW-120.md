<a id="flow-120"></a>
# FLOW-120 · Loan project follow-ups (#89 review)
- **Type:** BACKLOG NIT · **Status:** done (#121; the three design-review items go to the design PR, the two #121 review items moved to FLOW-129) · **Depends on:** FLOW-105
- [x] Attaching a payment to an unassigned line with a suggested category confirms that category and closes its review item. Decide whether inheritance should skip suggested categories or keep the suggestion flag. (#121: skipped, reason `line category is a guess`; the owner was asked and can still pick "keep the flag".)
- [x] An error inside `reassign_transaction` refuses the whole attach; fall back to `project_inherited: false` instead. (#121: reason `project not set`.)
- [x] The app's own loan split path does not inherit the loan's project; only MCP `attach_loan_payment` does. Cover it with FLOW-119 or say so in 0104. (#121: said so in 0105.)
- [x] A line under an income (reversal) category is not restored by the attach undo (its role is not `project`). Test the role guard in that undo. (#121: the attach keeps the role it gave the line and undo checks that role, so such a line is restored; tested both ways.)
- [x] (#104 design review, in #111) Show project codes in the loan project picker once the dashboard projects carry `code`, with the "חיפוש פרויקט או קוד" placeholder.
- [x] (#104 design review, in #111) Keep the loan sheet's height when it swaps between the form and the project picker; wrap the loan-project stories in a sheet-like decorator.
- [x] (#104 design review, in #111) CONTROLS.md: note the static loan rows on the project screen.
- [x] The attach keeps `reassign_id` inside `mcp_writes.prior` although the table has a `reassign_id` column. (#121; undo still reads older writes from `prior`.)
- [x] Add a pgTAP test for a viewer updating their own company's loan through the table; the current test is cross-company. (#121, `loan_project_followups.test.sql`.)
- [ ] (#121 review) Two review items moved to [FLOW-129](FLOW-129.md).
