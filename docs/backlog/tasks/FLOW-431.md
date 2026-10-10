<a id="flow-431"></a>
# FLOW-431 · Earlier charges from the same party on the transaction screen
- **Type:** PLAN-FIRST UI · **Status:** planned (layout card with the owner) · **Source:** owner ask 2026-10-10: when a recurring charge goes up or down, opening it should show the earlier charges from the same supplier or customer.
- [ ] Owner picks a layout (A: a "חיובים קודמים" section on the transaction screen after the switch rows, recommended; B: a % chip that opens a sheet).
- [ ] Server: a read that returns one party's earlier charges in the transaction's currency (date, amount, id, newest first) with its usual amount, the caller's company only; an MCP read for the bookkeeping agent.
- [ ] App: a shared component (6 quiet month bars, up to 3 earlier charges, a "לכל החיובים" link; "תקבולים קודמים" for income; red only for an expense up or income down), shown only when the line has a party and at least 2 earlier charges.
- **Acceptance:** shared component and stories (expense up, income down, few charges, 320 and dark); a design log entry; the transaction screen still opens in under 0.7 s; design lead signs off the real-app shots.
