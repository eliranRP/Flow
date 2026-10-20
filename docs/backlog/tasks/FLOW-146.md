<a id="flow-146"></a>
# FLOW-146 · The company's rest-of-year forecast: the owner's edits of every month left
- **Type:** BACKLOG NIT · **Status:** done (folded into FLOW-145, #749) · **Depends on:** [FLOW-145](FLOW-145.md) · **Source:** decision [0200](../../decisions/0200-company-profit-year-and-since-start.md) point 4, 2026-10-20
- **Files:** a migration changing `company_next_month_inputs` (its edits), its pgTAP file, `packages/shared/src/database.types.ts`, `app/src/company-next-month-query.ts`, `app/src/company-year-forecast.ts` and its test.

The year view's "סוף 2026" card builds each month left from `company_next_month_inputs`, whose edits are those that apply to next month. An edit whose pace skips next month but lands later in the year (a quarterly line started in September lands in December, not November; an edit the MCP starts in December) is missed in that month. This is common: a 2-month edit started in October lands in October and December, not November (review of #749).

- [x] The read returns the edits that apply to any month from next month to December (and each added edit's matched line by month), or takes the months it should cover.
- [x] `companyRestOfYear` applies each month's own edits and matches.

**Acceptance:** pgTAP for the read's edits over the months left; a unit test where a quarterly edit lands only in December.
