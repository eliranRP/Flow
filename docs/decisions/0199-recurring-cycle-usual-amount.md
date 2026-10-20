# A non-monthly charge's usual amount comes from its cycle; the month forecast lists only charges due that month

**Date:** 2026-10-20
**Status:** Accepted (owner's bug report of 2026-10-20; FLOW-930). Amends [0175](0175-recurring-pace-dismissals.md) point 1 (the usual day and amount of a pace other than monthly).

## Context

A supplier billed a small amount every month, then switched to a yearly plan: the switch month carried a last monthly bill and the first yearly one, and a year later the yearly bill came again. Flow found the pace (yearly) and the next due month (a year after the last bill) correctly, but two things went wrong:

- **The usual amount.** 0175 point 1 takes a non-monthly charge's usual day and amount as the median of every month's total over 24 months. The old monthly bills outnumbered the yearly ones, so the yearly charge's usual amount was a monthly bill's.
- **The month forecast (תזרים צפוי).** Its list took every recurring charge not yet seen this month, whatever its pace, so a yearly, quarterly or 2-monthly charge showed every month. The server's expected_months cells (Home's forecast row) and next month's project forecast already counted a charge only in its due months, so the list disagreed with them.

## Decision

1. **Usual amount and day of a non-monthly charge.** For a pace of every 2 months, quarter or year, `private.recurring_parties` takes the median (by size, the direction's sign, as before) of the months on the charge's cycle only: its last complete month, then one pace before it, two paces before it, and so on, within the 24 months it reads. A month off the cycle (the bills before a switch, an extra bill) does not count. The usual day comes from the same months. A monthly charge is unchanged (the last 6 months, else 24), the owner's usual amount still wins ([0189](0189-recurring-split-parts-usual-amount.md)), and so does a charge the owner marked recurring with no complete month yet. `private.project_recurring_arrivals`, which computes a project's share of the usual amount the same way, takes the same months.
2. **The month forecast lists only the charges due that month.** A recurring charge is in the open month's forecast (the app and MCP `get_forecast`, one builder in `packages/shared`) only when it is due that month: from its next due month, every pace months; a late charge (its due month already passed) counts in this month. A payload with no pace or due month counts as monthly, as before.
3. **One due rule.** `dueInMonth` lives in `packages/shared/src/recurring-due.ts`. The month forecast and next month's project and company forecasts import it, and it follows the expected_months cells' rule, so a list never disagrees with the totals beside it.

## Alternatives rejected

- **The last bill alone as a yearly charge's usual amount.** One odd bill would set it; the median of the cycle's months keeps 0175's rule for a charge with several cycles.
- **Months whose total is at least the gap rule's size.** A threshold invents a number; the cycle is what the pace already says.
- **Filter the forecast in the app only.** The MCP reads the same builder; fixing it there fixes both.

## Consequences

- Every reader of the usual amount follows: the arrivals and changes (הגיעו החודש, the 20% alert), missing bills, a line's recurring state and charges, the schedule, expected_months, company_next_month_inputs and the project forecast. A yearly charge arriving now is compared with its yearly amount, so a switch no longer raises a false change.
- The month forecast's total of charges still to go drops the charges not due this month, so it agrees with Home's forecast row.
- **No new flow-mcp tool (0095).** No user action changes; `get_forecast`, `get_expected_months` and `get_recurring_schedule` return the corrected figures.
