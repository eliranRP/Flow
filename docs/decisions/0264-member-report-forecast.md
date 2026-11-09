# 0264 · Member report forecast

- **Date:** 2026-11-09
- **Status:** Accepted
- **Task:** FLOW-1125 (plan, option A approved by the owner), FLOW-1126 (data, calculation, MCP), FLOW-1127 (screens)

## Context

The owner asked to see the portfolio in future years, and what a refinance in 10 years would look like. The forecast's assumptions (CapEx, holding costs, tenant turnover) start from defaults the owner can change, and rent and each cost rise every year, with a different change allowed for a given year. The member report already holds each property's value, its loans and the members' ownership. The property's lines hold its rent and costs.

## Decision

1. **The forecast's inputs are their own read.** `get_member_projection_inputs()` (owner and viewers) returns, for each report property:
   - the scheduled rent;
   - the months rented in the last 12;
   - the last 12 full months of `opex` by category;
   - the units;
   - each open loan's terms and rate changes.

   `get_member_report` is not widened, because it already takes about 1.8 s, and the forecast reads its own inputs only when it opens.
2. **The scheduled rent** is the highest of the last three full months' rent. A late payment or a turnover month would make the latest month alone read low, and collected rent already reflects empty months, so vacancy would otherwise be counted twice.
3. **The assumptions are a `projection` part** of `member_reports.config`:
   - set by `set_member_report` and MCP like the other parts, with undo kind `member_report`;
   - validated by `private.member_projection_check` within FLOW-1125's bounds;
   - the defaults live in `packages/shared/src/member-projection.ts`, so the stored part holds only what the owner changed.
4. **One calculation, `computeMemberProjection`,** for the app and MCP `get_member_projection`.
   - Costs: repairs are left out (maintenance replaces them), and a partial year is scaled to 12 months.
   - Debt service: principal and interest from each loan's schedule, never escrow. Balances: today's balance less the principal the schedule pays by then.
   - A loan whose terms the schedule refuses keeps its balance and pays interest only.
   - Members' loans:
     - one on a refinanced property is paid off to its member;
     - the company's own are repaid out of the cash out first, in proportion when it is short;
     - the rest is split by ownership.
5. **The refinance rate** defaults to today's expected rate (Treasury + spread) and is labelled as today's rate, not a forecast. DSCR is shown, not used to cap the new loan.

## Consequences

- The forecast tab reads two RPCs; the report itself stays as fast as it is.
- A category's cost type is a guess from its name until the owner sets it.
- Not covered: taxes, buying more properties, and per-property assumptions.
