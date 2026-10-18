# The user edits a project's next-month forecast

**Date:** 2026-10-18
**Status:** Accepted

## Context

The project profit page's next-month forecast (ProfitNext) is computed: the project's recurring charges due that month and a six-month average for every other expense category, with a loan payment's principal never counted. The owner asked that the user can edit it: change a row's amount, take a row out, add a line of a category, for that month or on a pace. The board frames are ProfitNextEdit, ProfitNextAdd, ProfitNextEdited, ProfitNextSearch, ProfitNextNoMatch and ProfitNextPace.

## Decision

- One table, `public.project_forecast_edits`. Each row is one edit of one project's forecast:
  - `change`: a computed row's amount (`row_key`, `amount_minor`). Row keys are `rec:<direction>:<party_id>` (a recurring charge), `avg:<category_id>` or `avg:none` (an average) and `add:<edit id>` (a line the user added).
  - `remove`: the row is out of that month (always `once`). Removing a line the user added for that month deletes the `add` outright (on every month of its pace); one added for an earlier month is taken out of that month only.
  - `add`: a line of `category_id` with `direction` and `amount_minor`. The category must be one the app offers: not hidden, not kept out of the profit, never the loan principal.
  - `pace` (`once`, `month`, `2months`, `quarter`, `year`) and `start_month`: the edit applies to its month only, or every pace months from it. For one row, the latest start that applies wins.
- An edit never changes a recurring charge, a line or a category. The forecast stays computed on the client, and `applyForecastEdits` (app/src/project-next-month.ts) puts the edits on top. A removed row leaves the totals and is listed under the rows with החזרה.
- RLS is on with no policy for the app's roles. Reads and writes go through security-definer functions scoped to the caller's company: `project_forecast_edits_for` (viewers read), and `set_project_forecast_edit`, `remove_project_forecast_row`, `restore_project_forecast_row`, `reset_project_forecast` (owner or editor; another company's project is `project not found`; a month that has ended is refused).
- Every write returns its `undo` (`{drop, put}`), which `undo_project_forecast` takes back. The toast's ביטול sends it. An undo checks the project is the caller company's, and puts back only what a write could make (the forecast's row keys, an allowed category, a month to come, or a paced edit as it was).
- "חזרה לצפי של Flow" drops the edits made for the forecast month (their `start_month`); the RPC without a month drops every edit of the project.
- An MCP write row stores its company, and `mcp_undo` finds a `project_forecast` write only in the token's current company.
- MCP: `get_project_forecast_edits` and the four writes, through `mcp_*` functions with the idempotency key; `undo` takes the kind `project_forecast`.
- On a row's edit page the category is shown but fixed: the forecast has nothing by category, so changing it would change nothing on save. A new line picks its category in the sheet, and "+ יצירת קטגוריה" uses the app's `create_category`.

## Alternatives rejected

- Reusing `forecast_overrides` (the month forecast's table): it is per company, has no project, and has no pace or added lines.
- Storing the computed forecast and editing its rows: the rows would go stale as transactions arrive, and Flow could no longer keep learning from them.
- One edit per row for every month: a pace would need a row per month, and an edit made today would not reach the forecast of the months after.

## Consequences

- A user's edit wins over Flow's average until its month passes (once) or the user resets it; a paced edit keeps applying until reset.
- An edit of a row that later disappears (a charge stops, a category gets a recurring charge) is inert and costs nothing.
- The month forecast (FLOW-141) does not read these edits; the two forecasts are separate.
