# A project as an investment: figures, rehab and equity

**Date:** 2026-10-08
**Status:** Accepted (FLOW-404, server part; the owner chose "all but loan parts", with a switch per category)

## Context

FLOW-404 asks Flow to show each property as an investment: the purchase price, the after-repair value (ARV) and today's value, which the owner types in, and from Flow's own costs:
- forced equity = ARV − purchase − rehab;
- current equity = value − loan balance.

MCP needs to set and read the figures. The open question was what counts as rehab. The owner's answer: every project cost except the loan parts, and a way to add or remove any category.

## Decision

**The figures live on the project.**
- `projects` gets `purchase_agorot`, `arv_agorot`, `value_agorot` (whole agorot, 0 or more, null until set) and `value_date`.
- They sit on the project row rather than a table of their own (the plan's first idea): the row's RLS, audit trigger and viewer reads already cover them, and there is one per project.
- `set_project_investment(project, patch)` is the owner's call. A key left out keeps its figure and a null clears it, so the app can save one field on tap. A bad amount or date, another key, or an empty patch is `validation`; a viewer is `forbidden`; another company's project is `project not found`.

**Rehab is every project cost but the loan parts, and each category can be switched.**
- `categories.rehab`: null follows the default, true adds the category to rehab, false takes it out.
- By default a category counts unless it is kept out of the P&L (`excluded_from_pnl`) or is a loan part (`loan_part`). Kept-out categories stay out by default so the purchase itself, usually filed in one, is not counted twice. A line with no category counts.
- `set_category_rehab(category, rehab)` is the owner's call. `list_categories` shows `rehab` and `in_rehab` (what the category comes to).
- Rehab sums, for all time on the cash basis in shekels, the project's posted, paid expense lines (direct) plus its share of shared lines, by part for split lines, whose category counts. The project screen's period and basis do not change it: rehab is what the property has cost so far.
- A line's own P&L switch (`set_line_pnl`) does not decide rehab; the category does. One switch per category keeps the rule short.

**Equity comes with `get_project`.**
- `get_project` returns `investment`: the four figures, `rehab_agorot`, `loan_balance_agorot` (open shekel loans filed under the project), `loan_balance_other_currencies` (open loans in other currencies, listed apart, never added in), `forced_equity_agorot` and `current_equity_agorot`.
- Each equity is null while a figure it needs is missing, so the screen can say what to fill in rather than show a wrong number.

**MCP.**
- `set_project_investment` (undo kind `project_investment`) and `set_category_rehab` (undo kind `category_rehab`), with the idempotency key and the write rate limit.
- Undo puts back what was there, and is `conflict` when the figures or the switch changed since.

## Alternatives rejected

- **Loan interest and escrow in rehab (the all-in view).** Offered; the owner chose to leave loan parts out by default. A category switch can still add them.
- **Only categories marked as rehab.** Offered; every new category would need a decision. The switch keeps that power without the setup.
- **Rehab for the screen's period and basis.** Equity is about the property as it stands, not a period.
- **A separate `project_investment` table.** One row per project with no history: columns on the project are enough.

## Follow-ups

- The investment card on the project page and the rehab switch in category settings (a UI lane, after a mockup).
