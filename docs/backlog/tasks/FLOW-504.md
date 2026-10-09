<a id="flow-504"></a>
# FLOW-504 · Display currency toggle and USD-base companies
- **Type:** PLAN FIRST · **Status:** server and MCP done ([0147](../../decisions/0147-company-currency.md)); the screen part is ready for a UI lane: the currency choice in Settings → company, `useCompanyCurrency` reads `base_currency`, Home shows `net_profit_minor` and its change from the `prev_*_minor` fields, the overhead share uses `overhead_share_minor`, and the loan form default · **Depends on:** —
- **What:** A per-company `₪`/`$` display choice with mixed totals converted at display time ([0087](../../decisions/0087-multi-currency.md)), and a decision on companies whose base currency is USD (there is no company currency column today).
- **Acceptance:** owner decision; plan approved.
