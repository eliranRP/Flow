<a id="flow-211"></a>
# FLOW-211 · Flow MCP agent requests (2026-10-08)
- **Type:** MCP · **Status:** claimed (dev lane 2, 2026-10-08, claude/project-thread-pz6l1n) · **Depends on:** —
- **What:** from the Flow MCP agent, most important first: (1) `search_expenses` (and `search_transactions`) find a line by its amount, an exact figure or a range, since a bank or HUD figure is the agent's most common lookup; (2) `list_loans` shows each demand loan's accrued unpaid interest as of today, so the agent need not call `get_loan_schedule` per loan; (3) `add_loan` and `update_loan` refuse `company_id` as every tool does (the token decides the company): say so in TOOLS.md.
- **Acceptance:** pgTAP for the amount filter (exact, range, sign, currency); MCP tests for both tools; TOOLS.md.
- [x] `search_transactions` `p_amount_min`/`p_amount_max` and rows with `amount_gross`; MCP `search_expenses` `amount`, `amount_min`, `amount_max` (decision [0155](../../decisions/0155-review-list-speed-search-amount.md)).
- [x] `list_loans` `accrued_interest_minor` and `accrued_as_of` for an open demand loan.
- [x] TOOLS.md: no tool takes `company_id`.
- [x] With it, the Production QA bug: `list_review` hit the statement timeout on a 586-line queue. `private.line_pnl_state` is security definer (the company checked in its where clause), `private.line_pnl_states` reads a set of lines at once, and `list_review` reads the lines filed today once.
