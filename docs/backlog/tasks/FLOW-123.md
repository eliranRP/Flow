<a id="flow-123"></a>
# FLOW-123 · Loan balance checks follow-ups (#72 review)
- **Type:** BACKLOG NIT · **Status:** done (#127) · **Depends on:** #72
- [x] `private.loan_splits_check` does not lock the loan, so two app splits on the same loan at once can both pass the balance check (the MCP path locks it). (#127: it locks the loan row first.)
- [x] The balance check runs only when splits change. A line that becomes posted, a removed line that comes back, or an edit that lowers the principal below what was paid can still take `loan_balances` below zero. (#127, decision [0121](../../decisions/0121-loan-balance-checks.md): such a line's parts are flagged for review; a principal below what was paid is refused.)
