# Jev learns from corrections, one-call prefill and split approval, no project, finished projects

**Date:** 2026-10-08
**Status:** Accepted (FLOW-703, server side)

## Context

FLOW-703 lists what phase 1 left open. Jev saw how the owner filed a party before ([0127](0127-jev-supplier-history.md)) but not where it had been wrong. The auto-mode prefill was three REST calls (the line, then delete and insert the allocation), so a failure between them could leave a line with a project and no allocation. The app approved a split line whose category Jev filled with two calls (`set_transaction_category`, then `approve_split_review`). The project question had no "no project" answer, so Jev had to pick a project for an overhead line. Only active projects were offered, so an older line could not be filed to a project that has since finished. Jev never approves a line and computes no number ([0084](0084-jev-auto-prefill.md)).

## Decision

**Corrections as signal.** `jev_supplier_history` adds, per filed line, `jev_project_id`, `jev_category_id` (Jev's suggestion on that line, from `jev_outcomes`, [0126](0126-jev-outcomes.md)) and `jev_corrected` (the owner changed a field Jev suggested). The job puts them in `past_filings` as `jev_suggested_project_id`, `jev_suggested_category_id` and `owner_corrected_jev`, only on lines Jev had suggested on.

**One-call prefill.** `jev_prefill(company, line, project, category)` (service role) locks the line and writes in one transaction: the project with one allocation whose amount it reads from the line, and the category marked as suggested. It writes nothing when the line is gone, its newest review row is not open, or the owner assigned it; it keeps a project or category the owner already set; it gives no project to an income, shared, overhead or split line; it takes only the company's own visible expense categories. It returns which fields it wrote. A skipped write keeps the suggestion on the card and is not counted as pre-filled.

**One-call split approval.** `approve_split_review(review, category)` sets the category, when it differs, and approves the split line in one call, with the same checks and undo rows as the two calls it replaces. The app moving to it is UI-lane work.

**No project.** The project question has a `none` option ("overhead, or not tied to one project"), and the company's overhead project ([0101](0101-unassigned-and-overhead-project.md)) is labelled as such. Auto mode never pre-fills `none`. `jev_suggestions` and MCP `get_jev_suggestions` add `no_project`; its reason counts a filing with no project, or filed as shared or overhead, as a match.

**Finished projects.** `jev_projects(company)` (service role) lists every project with its status, the overhead mark, and for a finished one the date of its last line. A line is offered the active projects and the finished ones whose last line is on or after the line's date. A finished project with no lines is not offered.

## Alternatives rejected

- A separate corrections table: `jev_outcomes` already holds the suggestion against the filed result.
- Writing the prefill amount from the job: numbers come from SQL.
- Offering every finished project on every line: new lines would be filed to closed work.
- A Jev "no project" pre-fill that files the line as overhead: overhead is an owner's call, and an expense approval needs a project.

## Consequences

- `jev_outcomes` still records a `none` suggestion with no project match; the accuracy report counts only its category.
- The change sheet seeded with a Jev guess must not turn it into a supplier rule by default, and the split approval should use the new call: both are app changes for the UI lane.
- Deploy the jev-tag function with this migration: the old function's REST prefill still works against the new schema, the new one needs `jev_prefill` and `jev_projects`.
