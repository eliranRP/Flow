<a id="flow-208"></a>
# FLOW-208 · Split and undo follow-ups (#88 review)
- **Type:** BACKLOG NIT · **Status:** done (#122) · **Depends on:** —
- [x] `assign_expenses` still hashes `p_items` as sent, so a retried batch with one row's shares in another order is `conflict`; sort split shares before hashing, like `assign_expense_split`. (#122)
- [x] Undo snapshots have no `prior_category_assigned`: a category that was neither a suggestion nor confirmed (supplier rule or provider category) stays confirmed after undo. Add the column to `reassign_undo` and `review_queue` and restore it (see FLOW-205 item 1). (#122; older snapshots keep the old rule. `save_split` still stores no flags.)
- [x] A pgTAP test that undo of a write onto a line with no category lets the trigger fill a fresh guess. (#122, `review_undo_followups.test.sql`.)
