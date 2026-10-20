<a id="flow-147"></a>
# FLOW-147 · Company profit, month view: a project holding a shared cost shows as כללי
- **Type:** BUG · **Status:** ready · **Depends on:** [FLOW-140](FLOW-140.md) · **Source:** the review of #749 (FLOW-145), 2026-10-20
- **Files:** `app/src/use-company-profit.ts` (`buildProfitModel`), `app/src/screens/company-profit-screen.tsx` (the project rows), `app/src/dev/company-profit-sample.ts`, their tests.

In `get_breakdown` by project, `shared: true` marks a project that holds a share of a shared cost; the general costs come under the keys `overhead` and `unassigned`. The month view reads it the other way:

- [ ] `buildProfitModel` names any group with `shared` "כללי" (`use-company-profit.ts`, `name: group.shared ? "כללי" : …`), so a real project holding a shared cost is renamed כללי, and `overhead` and `unassigned` stay two rows with no name.
- [ ] The project list leaves a `shared` row without its link (`company-profit-screen.tsx`, `row.shared || row.key === ""`), so that project cannot be opened.
- [ ] The fixture's project breakdown marks the no-project lines `shared` under the key `shared`, a shape the server never sends.

Fix as FLOW-145 did for the year's list (`company-year-rows.ts`, `GENERAL_KEYS`): `overhead` and `unassigned` are one כללי row with no link; every other key is a project, `shared` or not.

**Acceptance:** a unit test with a `shared` project group and `overhead` and `unassigned` groups; the screen test's כללי row; the fixture in the server's shape.
