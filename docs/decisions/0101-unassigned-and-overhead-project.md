# Unassigned bucket and overhead project

**Date:** 2026-10-07
**Status:** Accepted

## Context

Cleaning real books showed three gaps in the P&L reads. A line with no project, no shared split, and no overhead role counted in the company total but in no bucket, so the projects and overhead did not add up to the company. A company that files its overhead into a project of its own (an office, a general project) saw overhead 0 and that cost as direct. And it was unclear whether an unpaid expense counts on the invoiced basis.

## Decision

- **Unassigned.** `private.pnl_lines` gets an `unassigned` column. An income line is unassigned when it has no project. An expense line is unassigned when it has no `pnl_role`, a `project` role and no project, or a `shared` role and no allocations. An unassigned line is in no other bucket.
- `company_pnl` returns `unassigned_income_minor` and `unassigned_expense_minor` on each `by_currency` row, and `unassigned_income_agorot` and `unassigned_expense_agorot` for ILS. So `direct + shared + overhead + unassigned_expense = expense`, and the projects' profit minus overhead plus unassigned income minus unassigned expense is the net profit. The second sum is exact except for the per-part rounding of shared loan-split lines ([0100](0100-loan-split-pnl.md)), within 1 minor unit per part.
- **Overhead project.** `companies.overhead_project_id` names at most one project of the company. In `private.pnl_lines`, a line with the `project` role filed to that project reads `pnl_role = 'overhead'`. Every P&L read follows the view: `company_pnl` counts it in overhead and not in direct, the project row and `get_project` show no direct cost for it, the project category helpers leave it out, and the after-overhead share (`overhead_share`) includes it. Income and shared allocations on that project stay the project's. Deleting the project clears the setting.
- `company_pnl` returns `overhead_project_id` and `is_overhead` on each project row; `get_project` returns `is_overhead`.
- `public.set_overhead_project(p_project_id)` sets or clears it (owner only; another company's project is `project not found`). MCP `set_overhead_project` wraps it with an idempotency key, the write rate limit, and undo kind `overhead_project` keyed by the company id.
- **Unpaid expense rule.** No change. An expense line counts by its document date on both bases, whatever its document kind, so a posted supplier invoice that is not paid yet counts on the invoiced basis. A `pending` (unsettled bank) line counts on neither basis until it posts ([0086](0086-mercury.md)). The basis changes income only.

## Alternatives rejected

- Computing unassigned as the remainder of the company total: it hides which lines are missing a bucket and can absorb a real bug.
- A flag per transaction for overhead: the owner already files these lines to one project; one setting moves them all and undo is one write.
- Moving the overhead project's income to overhead: overhead is a cost bucket, and income on that project is rare.

## Consequences

The Home and project screens do not show the unassigned bucket or the overhead-project setting yet; both are in the MCP and the API. Cash-basis expenses still count unpaid supplier invoices by document date, which [0007](0007-bank-statement-is-primary-input.md) does not intend; that is a follow-up, not part of this change. [0118](0118-unpaid-invoices-cash-basis.md) closes it: an unpaid supplier invoice now stays out of the cash basis.
