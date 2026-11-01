<a id="flow-452"></a>
# FLOW-452 · Investment page v3: review nits
- **Type:** BACKLOG NIT · **Status:** ready · **Source:** the review of #923 (FLOW-450, FLOW-451), rounds 1 and 2, 2026-11-01.
- [ ] Every הוספה button on a missing figure has the same accessible name: pass the figure's name (`addLabel`) in `app/src/screens/project-returns-parts.tsx`.
- [ ] The statement's section count "5 שורות" is a literal; count the rows (`project-returns-screen.tsx`).
- [ ] The statement's hero count adds each line's count, so a transaction in two lines counts twice; count distinct transactions (needs the count from `get_property_returns`).
- [ ] `.ui-ret-source-label` wraps at 320; add `white-space: nowrap` (`app/src/ui/css/26-returns.css`).
- [ ] The tax bracket field accepts a minus; refuse it in the sheet as the server does.
- [ ] `get_property_returns` / `get_property_return_lines` (MCP): an impossible date passes the format check and comes back `refused`; check it with `isCalendarDate` so it is `validation`.
- [ ] MCP tests: the tax_bracket undo test passes a category id (use a company id); remove a conditional assertion in `tools_property_returns_test.ts`; one entry per line in `WRITE_TOOL_NAMES`.
- [ ] `missing` does not name `rehab` when rehab is null because of costs in another currency.
- [ ] Tests: the tax bracket sheet's save and clear, a viewer on the returns pages, the paging row.
- [ ] (FLOW-453) The ⓘ sheets show an operator and a signed amount, so a subtracted part reads "− −$210,000". Show the amount unsigned next to its operator in every sheet (the sums stay signed).
