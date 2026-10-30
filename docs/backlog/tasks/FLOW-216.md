<a id="flow-216"></a>
# FLOW-216 · MCP get_company_next_month_inputs: the company forecast's inputs
- **Type:** MCP · **Status:** claimed (UI lane 1, 2026-10-30, claude/flow-990-next-month-home) · **Depends on:** [FLOW-143](FLOW-143.md) (the read `company_next_month_inputs`) · **Source:** the review of FLOW-143's PR (#742), decision [0197](../../decisions/0197-company-next-month.md) and [0095](../../decisions/0095-mcp-first.md), 2026-10-20
- **Files:** `supabase/functions/flow-mcp/` (the tool and its Deno test), `docs/mcp/TOOLS.md`.

The company profit page shows next month as the sum of every project's forecast and the general costs, built in the app from four reads. An agent has the per-project reads (`get_expected_months`, `get_project_forecast_edits`, `list_loans`) but nothing for the category months of every project at once.

- [ ] A read tool `get_company_next_month_inputs` (optional `today`, `YYYY-MM-DD`) that calls `company_next_month_inputs` and returns its JSON as is: `today`, `month`, `overhead_project_id`, `projects[]` (`project_id`, `categories[]`), `general[]` and `edits[]` (each with `project_id`).
- [ ] TOOLS.md lists it with the recipe for the company's next month: for each project in `projects`, its charges from `get_expected_months` (`months: 2`, no `project_id`) with that `project_id` (a charge that `pays_loan` left out), its open loans' interest and escrow for the month from `get_loan_schedule`, one average per expense category of its months that no charge or loan fills, then its edits; the same for the general costs, from the charges and loans with no project or under `overhead_project_id`, the `general` months and the overhead project's edits; sum the parts. Profit terms, one currency.
- [ ] A Deno test: the tool's arguments, and another company's caller gets its own answer.
