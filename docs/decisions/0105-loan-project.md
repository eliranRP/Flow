# A loan can belong to a project

**Date:** 2026-10-07
**Status:** Accepted

## Context

A loan ([0088](0088-loans.md)) belongs to a company. A property loan really belongs to one project, and its interest and escrow ([0100](0100-loan-split-pnl.md)) should count in that project's P&L. Until now a split payment counted under whatever project the bank line had, or under none.

## Decision

- `loans.project_id` is optional. The pair `(company_id, project_id)` references `projects (company_id, id)`, so a project of another company cannot be stored, even around the RPCs. Deleting the project clears `project_id` only (`on delete set null (project_id)`); the loan stays.
- MCP `add_loan` and `update_loan` take `project_id`. On `update_loan`, `null` clears it and an absent key leaves it. A project of another company, or an unknown one, is refused as `project not found` before anything is written. Idempotency key, write limit and the write gate are as before. `add_loan` is one signature again: the new trailing `p_project_id` has a default and the old overload is dropped. The idempotency hash of a call without a project is unchanged, so a key stored before this change still replays.
- Undo of `update_loan` restores the previous project. The undo payload snapshots `project_id` with the other fields. An edit stored before this change has no `project_id` in its snapshot and is compared and restored without it. If the previous project was deleted since, the undo is refused as `project not found`. Undo of `add_loan` is unchanged. Undoing a created project is a conflict while a loan sits under it.
- `mcp_list_loans` returns `project_id` and `project_name`. `get_project` adds a `loans` array (id, name, currency, balance) of the loans filed under the project, which MCP `get_project` passes through. Nothing else in `get_project` changes: its P&L numbers are byte for byte the same.
- `mcp_attach_loan_payment` files the bank line under the loan's project when the loan has one and the line has no project, no shares, no role, and a category. It uses `reassign_transaction`, the same rule as `assign_expense`: the line becomes a direct cost on the project (role `project`, one 100% share), keeping its own category. The split parts then count under that project through `private.pnl_lines`: interest and escrow as direct cost, principal in the excluded totals, on both bases. In any other case the line is left as it was and the result says `project_inherited: false` with a reason (`loan has no project`, `line already has a project`, `line has shares`, `line has a role`, `line has no category`).
- The attach undo record keeps the reassign it made. Undo of the attach restores the line's earlier project and role, and reopens a review item the attach closed, but only when the line still has the project, category and role the attach gave it. A line the owner changed in the meantime is left alone, and the result says `project_restored: false`.
- Changing a loan's project later does not move payments already attached. Their lines keep the project they were filed under; the owner moves a line with `assign_expense`.

## Alternatives rejected

- Counting the parts under the loan's project without touching the line: `private.pnl_lines` reads the line's project, and a second source of project would make the totals disagree with the line.
- Moving every attached line when the loan's project changes: it rewrites lines the owner may have filed by hand, and the undo could not restore them safely.
- Giving a line with a role (overhead, shared) the loan's project: that role was a choice.
- A second read for the loans in the MCP tool: a second call can fail alone, and `get_project` already knows the project.

## Consequences

The app sets and clears the project since FLOW-119: a פרויקט field in the new-loan sheet, and a tap on a loan row in Settings writes `loans.project_id` directly under RLS. The project screen lists its loans from `get_project.loans`. The app's own loan split path does not file the line under the loan's project yet; only MCP `attach_loan_payment` does (FLOW-120). A line that was attached before a loan had a project stays where it is.
