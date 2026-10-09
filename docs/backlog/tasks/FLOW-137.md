<a id="flow-137"></a>
# FLOW-137 · Prime-linked loan rates (Flow MCP agent request)
- **Type:** SMALL CYCLE · **Status:** claimed (dev lane 2, 2026-10-08, claude/project-thread-pz6l1n) · **Depends on:** —
- **What:** Some demand loans are Israeli prime plus a margin, and each Bank of Israel change meant a `set_loan_rate` call per loan. A loan can carry an index (`il_prime`) and a margin; one `set_index_rate` call writes the dated rate (index plus margin) on every loan linked to that index, with one undo.
- **Acceptance:** pgTAP for the link, the fan-out, a loan that starts after the date, and the undo (including a conflict when a rate changed since); MCP tests; `list_loans` shows the index and margin.
- [x] `loans.rate_index` and `loans.rate_margin_ppm`; MCP `set_loan_index` (undo `loan_index`).
- [x] MCP `set_index_rate` writes a `loan_rates` row per linked loan (undo `index_rate`, all or nothing).
- [x] `list_loans` adds `rate_index` and `rate_margin_ppm`.
