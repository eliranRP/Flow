<a id="flow-201"></a>
# FLOW-201 · Split rows inside the assign_expenses batch
- **Type:** MCP · **Status:** done (#73) · **Depends on:** #68 (merged)
- **What:** `assign_expense_split` files one line at a time. Allow split rows (`category_id`, `shares[]`) inside `assign_expenses`, counted as one write hit, with per-row results and `undo_batch` restoring the pre-split state (including lines that were in review).
- **Acceptance:** pgTAP and Deno tests for a mixed batch, partial success, replay, and batch undo of a split that closed a review.
