<a id="flow-431"></a>
# FLOW-431 · Earlier charges from the same party on the transaction screen
- **Type:** PLAN-FIRST UI · **Status:** done (#530; follow-ups #551, #556 layout A) · **Source:** owner ask 2026-10-10: when a recurring charge goes up or down, opening it should show the earlier charges from the same supplier or customer.
- [x] Owner picks a layout: B, a chip "▲ 92% לעומת הרגיל $11.99" under the status pills that opens a sheet (2026-10-10 13:15Z).
- [x] (#530: `party_charges`, MCP `get_line_charges`, decision 0178) Server: a read that returns one party's earlier charges in the transaction's currency (date, amount, id, newest first) with its usual amount, the caller's company only; an MCP read for the bookkeeping agent.
- [x] (#530: ui/related-charges.tsx) App: the chip, and a sheet with 6 quiet month bars and the 12 newest charges ("תקבולים קודמים" for income; red only for an expense up or income down), shown only when the party has a usual amount.
- [x] (follow-up) Compare within the line's context: the same loan, else the same project and category (owner, 2026-10-10 16:01Z).
- [x] (follow-up) Layout A: the charges inline under the switches instead of the chip (owner, 2026-10-10 16:07Z).
- **Acceptance:** shared component and stories (expense up, income down, few charges, 320 and dark); a design log entry; the transaction screen still opens in under 0.7 s; design lead signs off the real-app shots.
