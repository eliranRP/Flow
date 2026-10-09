<a id="flow-118"></a>
# FLOW-118 · Reversals follow-ups (#76 review)
- **Type:** BACKLOG NIT · **Status:** done (#122) · **Depends on:** FLOW-104
- [x] `approve_split_review` still raises 'category kind must match the direction' for a null kind; the branch is unreachable after 'category is required'. Drop it or give it its own message. (#122: 'category not found'; the composite foreign key keeps it unreachable.)
- [x] The `private.mcp_refused` whitelist still carries that message; remove it when the whitelist is next edited. (#122: kept. `mcp_assign_expense_split` and `save_line_split` still raise it.)
- [ ] A reversal on a line with shares counts as company income with no project. Owner call: spread it over the shares, or refuse an income-kind category on a shared line.
- [ ] (#101 review) Overhead lines (`pnl_role` overhead) still offer the picker's reversal section; settle with the shared-line call above. Split and shared lines don't offer it.
- [x] (in #111) A hidden, loan or kept-out other-kind category already on a line (filed through MCP) shows החזר on the review card but sits in the own-kind list with no mark in the change sheet.
- [ ] (#101 review) The picker's search shows above 8 own-kind categories only; consider counting the reversal section too.
- [ ] (#101 review) If a suggestion can ever be of the other kind, the summary shows הצעה, not החזר. Rules never learn reversals today.
