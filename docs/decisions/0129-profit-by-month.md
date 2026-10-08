# Profit by month, and project reads for a period

**Date:** 2026-10-08
**Status:** Accepted (owner approved option A of the profit-by-month plan, 2026-10-08)

## Context

The owner wants to see, at a glance, which months of each project and of the company made a profit, then drill down. The plan (option A) puts one period on Home and one on each project, and a "לפי חודש" list. Today `get_project` and `list_project_category` are all time only (FLOW-411), and nothing returns profit per month. FLOW-409: the overhead split weighted by invoiced income even on the cash basis.

## Decision

- **One date rule.** `private.pnl_in_range` is company_pnl's rule: income on the cash basis counts by its cash date (else its document date); everything else by its document date. Every new range filter uses it.
- **`get_project(p_id, p_basis, p_from, p_to)`** and **`list_project_category(..., p_from, p_to)`**: the range is two new last arguments, null by default, both or neither (one alone is `invalid range`); a call without them is all time as before. On `get_project` the range scopes every P&L field, the categories, the kept-out lists, `transactions[]` (by the same date rule, picked by the line's direction rather than its category's kind) and the overhead share; `pending_*` and `loans` stay as they are. The output echoes `from` and `to`. With the same range and basis, a project's `profit_agorot` equals its `company_pnl` / `list_projects` row.
- **`get_profit_months(p_from, p_to, p_basis, p_project_id)`**: every calendar month of the range, newest first, cut to the range at both ends, per currency (ILS first and always present): `income_minor`, `expense_minor`, `profit_minor`. Without a project the months add up to `company_pnl`'s `by_currency` for the range; with one, to `get_project`'s `by_currency` (income less direct and shared cost, shared rounded half to even per line). Without dates it runs from the first month with a line to the current month. A range of 240 months or more is refused. Viewers can read it (`readable_company_id`).
- **Overhead (FLOW-409).** `private.overhead_share_for(company, project, basis, from, to)` spreads the range's overhead by the projects' share of the range's income on the same basis: receipts on cash, invoices on invoiced; on cash an unpaid line is left out of the weights as it is of the income (0118). Rounding is unchanged (0101, 0117). Per month, a project's share follows that month's income; it is 0 in a month the project has no income and null when no project has any.
- **MCP first (0095).** `get_project` takes `from` and `to`; new read tool `get_profit_months`.

## Alternatives rejected

- Calling `company_pnl` once per month: one heavy read per month; the single grouped read follows the same rules and the pgTAP checks the sums.
- Overloads that keep the old signatures as wrappers: PostgREST and positional SQL calls became ambiguous.
- Keeping invoiced weights on cash: a cash month would spread its overhead by invoices issued, not money received, so a month's profit after overhead would not follow its own cash.

## Consequences

`list_project_category` has no basis, so on cash its total still includes unpaid supplier invoices that the `get_project` category row leaves out (0118); FLOW-412 tracks it.


Per-month overhead shares are rounded per month, so they need not add up to the range's share. The all-time cash overhead share of a project now follows paid income (FLOW-409); no existing pgTAP changed. The screens (PeriodBar, the project period, the "לפי חודש" page) come from the Mercury UI thread.
