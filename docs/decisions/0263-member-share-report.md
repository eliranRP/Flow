# 0263 · Member share report

- **Date:** 2026-11-09
- **Status:** Accepted
- **Task:** FLOW-1117 (data and MCP), FLOW-1118 (screens), FLOW-1119 (Treasury yields fetched)

## Context

The owner asked for a report where a member of the LLC sees their share if every property is sold (less the selling costs and the loans), or after a refinance, with the lender quotes of a date compared to the US Treasury 5 and 10 year yields plus 1.5 or 2 points. Concept A of the design was approved on 2026-11-09. The app already holds each property's value and date, selling cost and loans; it did not hold the members' ownership, the quotes or the yields.

## Decision

1. One company setting, `public.member_reports.config` (jsonb, one row per company), holds the members (name, `ownership_bp`, adding up to 10000), the refinance assumptions (`ltv_bp`, `closing_bp`, `term_years`), the rate rule (`tenor_years` 5 or 10, `spread_bp`), the quotes, the yields by date and the quote date. A small, rarely written setting read whole by one screen; one table and one write keep it simple, and `private.member_report_check` validates every part.
2. `get_member_report` (owner and viewers) returns the setting and each active property with a value or an open loan: value, value date, selling cost and the open loans in its currency. `set_member_report` (owner only) replaces the parts it names; a null part clears it. MCP `set_member_report` adds idempotency and undo kind `member_report`, which puts the setting before back unless it changed since.
3. The share is computed in one place, `packages/shared/src/member-share.ts`, by the app and by MCP `get_member_share`. Sell: value − selling costs (the property's, else 8%) − open loans. Refinance: a new loan at the loan to value (default 75%) − the open loans − closing costs (default 2% of the new loan); a property where that is not above zero is not refinanced. The expected rate is the yield on the quote date (or the closest day before with one) plus the spread; a quote at or under it is good, within 0.25% near, above that high. A member's share is their ownership of each total. Figures are before tax.
4. One currency per report: the currency most valued properties use. A property in another currency, or with loans in another currency, is listed as left out, not converted.

## Consequences

- The yields are typed by hand until FLOW-1119 fetches them; a fetched yield never overwrites a typed one.
- Quotes are replaced as a list; a client sends every quote it keeps.
