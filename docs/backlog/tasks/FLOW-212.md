<a id="flow-212"></a>
# FLOW-212 · Flow MCP agent requests (2026-10-09 night)
- **Type:** MCP · **Status:** done (#428) · **Depends on:** —
- **What:** from the Flow MCP agent; its other two requests (the `search_expenses` amount and date filter, `list_loans` accrued interest) were already done in FLOW-211, and the loan money seed skip went to dev lane 3 with FLOW-413. (1) Pin that a refund filed under an expense category lowers that category's cost in `get_breakdown`, `get_project` and `get_profit_months` on both bases and never counts as income ([0103](../../decisions/0103-reversals-across-directions.md)); (2) `get_expense` on a split line moves the percent shares kept from before the split to `allocations_superseded`, so `allocations` no longer reads as a conflict with `line_split.parts`.
- **Acceptance:** pgTAP for the refund on the three reads; an MCP test for `get_expense`; TOOLS.md and the tool description.
