<a id="flow-907"></a>
# FLOW-907 · Data clean-up after PR B
- **Type:** MCP · **Status:** done (data agent, 2026-10-09: 3 deposit and closing returns, $3,412.39, moved to a kept-out category with the owner's ok; all three loan categories are in use, so none was hidden) · **Depends on:** FLOW-101 (done, #70)
- **What:** Data work for the MCP/data agent, no code: re-check company totals after FLOW-101; hide default loan categories a company doesn't use (the interest category is the target for split interest, so check after PR B); move deposit and closing returns filed as refunds into a kept-out category if the owner approves.
- **Acceptance:** the data agent reports before and after totals to the coordinator.
