<a id="flow-121"></a>
# FLOW-121 · Kept-out lines: guessed categories and project income
- **Type:** SMALL CYCLE · **Status:** done (#113) · **Depends on:** FLOW-102 (#71), FLOW-104 (#76), both merged; they rewrote `private.pnl_lines` and `get_project`
- **What:** Split out of FLOW-112. (a) A guessed (`category_suggested`) kept-out category already takes the line out of the P&L. Owner decision asked 2026-10-07; the recommended answer is that a guess counts in the P&L until the category is confirmed. (b) `get_project` lists kept-out project expenses in `excluded_categories_by_currency` but not kept-out project income.
- **Acceptance:** the owner's answer to (a) written here; pgTAP for both bases; TOOLS.md for `get_project` and `get_totals`.
- **Answer to (a):** built as recommended, a guess counts until confirmed (decision [0114](../../decisions/0114-kept-out-guesses.md)); the owner was asked again on 2026-10-07 and can still pick the other way.
