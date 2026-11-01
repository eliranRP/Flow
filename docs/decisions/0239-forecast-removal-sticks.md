# A row removed from the forecast stays out until it is brought back

**Date:** 2026-11-01
**Status:** Accepted (owner, 2026-11-01, FLOW-1003: "when I remove once it does not return to the forecast next month", and "it should be affected now as well")
**Amends:** [0186](0186-project-forecast-edits.md) (a removal was always `once`)

## Context

A removal from a project's next-month forecast (הסרה מהצפי) held for its month only. When the month turned, the forecast moved to the next month and every removed row came back, so the owner removed the same rows again each month.

## Decision

1. **A removal holds from its month on.** `remove_project_forecast_row` writes the removal on pace `month` from that month. The row stays out of every later month's forecast (the project's, the company's צפי page and the rest of the year) and is listed under "הוסרו מהצפי" there, until it is brought back.
2. **החזרה brings it back from that month on.** `restore_project_forecast_row` already deletes every removal of the row that applies to the month. Earlier months have ended and are not forecast again.
3. **The removals already made hold too.** The migration sets every existing removal to pace `month`. A row removed for an earlier month is also out of this month's forecast and the months after.
4. **A row already out stays out.** Removing it again, for its month or a later one, writes nothing and has nothing to undo. A line the user added for that month is still deleted outright. One added for an earlier month on a pace is taken out from that month on.
5. **Unchanged.** A reset for a month (`reset_project_forecast` with a month) drops the edits made for that month, as before: a removal made for an earlier month stays, as a paced change made for an earlier month does. Changed amounts and added lines keep their own pace.
6. **MCP.** `remove_project_forecast_row`, `restore_project_forecast_row` and `get_project_forecast_edits` describe the new rule. No signature changes.
