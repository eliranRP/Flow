# A row leaves the forecast for one month, or from that month on

**Date:** 2026-11-13
**Status:** Accepted (owner, 2026-11-13, FLOW-1188: "When I added manually and then remove it, it keeps it in the stream. Also where I added one I can't remove it after that. Also I want to be able to remove from a specific month and not delete for all future terms.")
**Amends:** [0239](0239-forecast-removal-sticks.md) (a removal was always from its month on), [0243](0243-forecast-line-pace.md) (the item page of an added line)

## Context

A line the owner added to a project's forecast showed in the month's תזרים צפוי, but its item page had no removal. The only way out was its source row, which opens the project's צפי page for next month (that page shows next month and later, decision 0260), so a removal made there started next month and the line stayed in this month's stream. And since 0239 every removal held from its month on, so a line on a pace could not skip one month.

## Decision

1. **Two removals.** הסרה מהצפי opens a sheet with two choices: **רק ב<month>** (out of that month; the next month expects it as usual) and **מ<month> והלאה** (out from that month on, until it is brought back, as 0239). A line added for its month only has no month after it, so it is removed at once, with no sheet.
2. **Where.** On the project's צפי edit page, for every row (as before, now with the sheet). On the תזרים צפוי item page of a line the owner added, new. A recurring charge's and an invoice's item page keep מתי צפוי › לא החודש for one month (0182); a charge stops from its own page.
3. **Server.** `remove_project_forecast_row` takes `p_pace`: `month` (default, so a caller that sends none keeps today's answer) or `once`. `once` writes a removal for that month only and never deletes a line on a pace. `month` on a line that starts that month deletes the line, as before. A row out for that month only and removed again with `month` is out from that month on; its undo puts the one-month removal back. The reads already apply a `once` removal to its month alone (`pfe_hits`), on the project page and in the month's forecast.
4. **MCP-first ([0095](0095-mcp-first.md)).** `remove_project_forecast_row` takes `pace` (`once` or `month`, default `month`).

## Consequences

- A removal of one month shows under הוסרו מהצפי on that month's page only; החזרה brings it back for that month.
- The 0239 migration's `once` removals (made before it) apply to their month alone, as they always did.
