<a id="flow-320"></a>
# FLOW-320 · Open the picker that was tapped on the transaction detail
- **Type:** SMALL UI · **Status:** done (#125) · **Depends on:** —
- **What:** From the 2026-10-07 tap-count review. On the transaction detail, the project row opens the change sheet straight on the project picker and the category row on the category picker, instead of the summary sheet. The review card's שינוי keeps the summary. A split row keeps opening the split.
- **MCP:** none new; `assign_expense` and `set_expense_category` cover the write.
- **Acceptance:** re-filing a project or category from the detail is 2 taps; Back from the picker returns to the detail with no dead history step; focus returns to the tapped row; tests for both rows; design review.
