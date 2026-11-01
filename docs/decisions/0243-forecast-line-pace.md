# כל כמה זמן on a forecast item's page; an added line's pace is the line's own

**Date:** 2026-11-01
**Status:** Accepted (owner, 2026-11-01, FLOW-1010: "I want to be able to add it as a recurring income", from the תזרים צפוי item page of a line they added; the כל כמה זמן row on every item page)
**Builds on:** [0186](0186-project-forecast-edits.md) (the project forecast edits), [0240](0240-month-end-forecast-counts-project-edits.md) (the month-end forecast counts them)

## Context

A line the owner adds to a project's forecast is for its month only unless they pick a pace when adding it. From the month-end forecast's item page they could change its amount or day for the month, but not make it repeat, and editing it on the project's page made a change on top of the line rather than changing the line.

## Decision

1. **כל כמה זמן on every forecast item page** (תזרים צפוי), between מתי צפוי and the item's source:
   - **A line the owner added, in the month it starts:** the row opens the project forecast's pace sheet (פעם אחת, כל חודש, כל חודשיים, כל רבעון, כל שנה). The pick changes the line itself, so it repeats from that month on, with a toast and ביטול.
   - **A line added in an earlier month:** the row shows its pace and opens the project's צפי page, where it is set.
   - **A recurring charge:** the row shows its pace and opens the charge's page, where the pace is set (decision 0189).
   - **An open invoice:** no row.
2. **An added line's edit in its first month is the line.** `set_project_forecast_edit` with `row_key` `add:<id>`, in the month that line starts, updates the line's amount and pace; its undo puts the line back. In a later month it stays a change of that month. The project's own edit page uses the same write, so its pace sheet on an added line now makes the line repeat too.
3. **MCP.** `get_forecast` items carry `pace`; `set_project_forecast_edit` documents point 2. No new tool.
