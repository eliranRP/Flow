<a id="flow-129"></a>
# FLOW-129 · Loan attach follow-ups (#121 review)
- **Type:** BACKLOG NIT · **Status:** done (#123) · **Depends on:** FLOW-120
- [x] `mcp_attach_loan_payment` and `mcp_undo` send `lock_not_available` to `others`, so the refusal is stored under the idempotency key and a retry replays it. Map it to `unavailable` / `retry` like a deadlock. (Migration `20261008043000`, tested in `loan_project_followups_reraise.test.sql`.)
- [x] `loan_project_followups.test.sql` queues g1's review item only if the trigger did not; assert what the trigger does instead. (No trigger queues it; the test asserts that and inserts the item.)
