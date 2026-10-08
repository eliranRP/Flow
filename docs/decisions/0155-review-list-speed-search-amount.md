# Review list speed, and search by amount

**Date:** 2026-10-08
**Status:** Accepted (FLOW-211, and the Production QA list_review timeout)

## Context

Production QA found that the review list (`list_review`) hit the database statement timeout when two loads of Flow QA's 586-line queue overlapped. Each open line called `private.line_pnl_state` for `kept_out`. Under row security, the planner read `private.pnl_lines` for that line through a scan of the company's lines instead of the line's own index: about 11 ms a line on a 3,600-line company. The list also read the lines filed today twice. On a local copy of that size, one load took 1.7 s with fresh statistics and 7 s without.

The Flow MCP agent asked to find a line by its amount, since a bank or HUD figure is its most common lookup, and to see a demand loan's accrued interest in `list_loans`.

## Decision

**Speed.** `private.line_pnl_state` becomes security definer. Its where clause keeps the caller to their own company (`readable_company_id()`, or the service role), so another company's line still has no state. A new `private.line_pnl_states(ids)` returns the same state for a set of lines in one read. `list_review` uses it for every open line and reads the lines filed today once. The same local load takes about 0.13 s. The rows and their fields do not change.

**Search by amount.** `search_transactions` takes `p_amount_min` and `p_amount_max`: the line's bank amount (gross) without its sign, in minor units of the line's own currency, both ends included. Each row also carries `amount_gross`. MCP `search_expenses` takes `amount` (one figure), or `amount_min` and `amount_max`, in major units.

**Accrued interest.** MCP `list_loans` adds `accrued_interest_minor` and `accrued_as_of` for an open demand loan: the same figure `get_loan_schedule` gives in `accrued`. Other kinds and closed loans have null.

**No company argument.** No MCP tool takes `company_id`; TOOLS.md now says so.

## Alternatives rejected

- An index alone: the indexes were there, and row security kept the planner off them.
- Paging `list_review`: the app and MCP read the whole queue, and the per-line cost was the problem.
- Matching amounts in the free text query: a number in a description would match too, and a figure needs its currency's minor units.

## Consequences

- Other lists that call `line_pnl_state` per row (the project drill-downs, the breakdown and project waiting lists, `get_transaction`) get faster too. In a definer read, `pnl_lines`' split totals now aggregate every company's split rows, not only the caller's. That costs little at today's row counts.
- An amount search on a mixed-currency company matches the figure in each line's own currency, so a range can match lines in more than one currency; each row says its `currency`.
