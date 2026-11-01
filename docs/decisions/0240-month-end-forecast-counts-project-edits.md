# The month-end forecast counts the projects' forecast edits

**Date:** 2026-11-01
**Status:** Accepted (owner, 2026-11-01, FLOW-1005 and FLOW-1006: "the forecast on the new screen does not add the income forecast like in the project forecast page", then "Yes approve. Also add the button to add a forecast transaction")
**Amends:** FLOW-141's month-end forecast (תזרים צפוי), which read only the recurring charges and the open invoices
**Builds on:** [0186](0186-project-forecast-edits.md) (the project forecast edits), [0239](0239-forecast-removal-sticks.md) (a removal holds from its month on), [0237](0237-company-next-month-page.md) point 4 (the general costs are the overhead project's)

## Context

The owner edits each project's צפי page: they add lines (a utility refund every month), remove recurring charges and change amounts. The month-end forecast was built apart, from the recurring charges and the open invoices only, so none of those edits reached it: the lines they added were missing, and charges they took out were still expected.

## Decision

1. **The month's project edits count.** The month-end forecast reads `company_forecast_edits_for(month)`: every edit of the company's active projects and its overhead project that applies to the month, with the project and the category name, and an added line's match for the month.
2. **An added line is an item** (`added:<edit id>`, kind `added`), in its project and category, with its amount (a later change of it wins), until the bank line that came as it is matched. A line taken out again is not one.
3. **A removed recurring charge leaves the forecast;** a changed amount is the item's own number (its "usual"). A charge with no project takes the overhead project's edits, as the general costs do on the company's צפי page. The screen's own changes of the month (amount, day, "לא החודש") still apply on top and still win.
4. **Not counted here:** the project pages' category averages and the loan's interest and escrow rows. The month-end forecast lists specific expected payments; the loan stays its one payment.
5. **הוספה לצפי on the screen.** Under the items, a button asks which project (the active projects, then כללי, the overhead project) and opens that project's add page for this month (`?month=<this month>&back=forecast`), which saves the line as that project's edit and comes back. The add page takes only this month or the project forecast's own next month.
6. **MCP.** `get_forecast` builds from the same edits (kind `added` items); no new tool.
