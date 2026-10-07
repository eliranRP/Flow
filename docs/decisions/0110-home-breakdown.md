# Home income and expense breakdown

**Date:** 2026-10-07
**Status:** Accepted

## Context

Home shows נכנס and יצא for the period, but nothing behind them. To see where money came from or went, the owner had to open each project, and lines with no project or on overhead were not reachable at all. The owner approved a two-level screen (FLOW-301, option A): group totals, then one group's lines. This record covers the data the screen and MCP read, and the screens built on it.

## Decision

- `private.breakdown_rows` reads `private.pnl_lines` with the same rules as `company_pnl`: expenses by document date on both bases; income by the basis's document kinds, and on the cash basis by cash date. So loan-split parts, kept-out categories ([0099](0099-categories-outside-pnl.md)), the overhead project, and the unassigned bucket ([0101](0101-unassigned-and-overhead-project.md)) follow Home by construction.
- Groups: `category` (the line's or the split part's category), `project`, and `payer` (the supplier on the line, used for both suppliers and customers). Under `project`, income goes to its project or `unassigned`. Cost goes to its project, to `overhead` (the overhead role, including lines filed to the overhead project), or to `unassigned`. A shared cost goes to each project by its allocation, rounded half to even like `company_pnl`, and the group carries `shared = true`. A missing category, payer, or project is key `none` (or `unassigned`) with a null name, which the screen names.
- `public.get_breakdown(p_direction, p_from, p_to, p_group_by, p_basis)` returns `totals`, `groups`, `excluded`, and `review_count` (open review rows of posted lines, so only lines already in the totals, on that side, by the line's category kind or else its direction like the totals ([0103](0103-reversals-across-directions.md)), whose document date is in the period, on both bases; it is a pointer to Review, not part of any sum). A period needs both dates or neither; one date alone is `validation`, because `company_pnl` would count nothing for it. Totals count each line or part once, so they equal `company_pnl`'s `income_minor` / `expense_minor`. Under `project`, the shared shares can miss the total by 1 minor unit per shared loan-split part ([0100](0100-loan-split-pnl.md)). Kept-out lines are only in `excluded`.
- `public.get_breakdown_lines(...)` pages one group's lines, newest first, with `has_more`. `p_excluded` lists the kept-out lines of a currency instead.
- Both are owner- and viewer-readable through `private.readable_company_id()`. An unknown direction or grouping raises `validation`.
- MCP read tool `get_breakdown` wraps both: without `group` it returns the groups, with `group` (or `excluded: true`) the lines. Basis defaults to cash like `get_totals`.

## Alternatives rejected

- A breakdown in the app from `get_project` calls: it can't reach unassigned or overhead lines, and its totals would drift from Home.
- Treating open review rows as outside the totals: Home's totals include posted lines whatever their review state, so the breakdown reports the open count beside the groups and does not subtract them.

## Consequences

The screens (Home rows that open the breakdown, the group screen, the lines screen) ship in the same PR. Supplier is the only payer field, so income with no supplier groups under `none`.
