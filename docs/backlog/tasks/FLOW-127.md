<a id="flow-127"></a>
# FLOW-127 · Kept-out income and overhead undo review follow-ups (#114, #116 reviews)
- **Type:** BACKLOG NIT · **Status:** done (#117) · **Depends on:** FLOW-126 (#114), FLOW-116 (#116)
- [x] `20261007224500_kept_out_income_review.sql`: the `user_assigned` / `category_assigned` checks next to `category_suggested` are redundant. Drop them in the next migration that replaces the function, or add a comment saying why they stay. (Kept with a comment: not every owner write clears `category_suggested`.)
- [x] The same review queue can pick up a guessed loan category. Skip it through `private.line_category_out`, as the other review paths do.
- [x] [TOOLS.md](../../mcp/TOOLS.md): say that `set_expense_category` keeps the line's project.
- [x] #116 review: `private.overhead_share` has one mis-indented `in_pnl` line.
- [x] #116 review: `undo` kind `overhead_project` checks that the prior project still exists without locking it, so a delete at the same moment turns `conflict` into `refused`. Lock it with `for key share`.
- [x] #116 review: `overhead_project_undo_deleted.test.sql` has two no-op `as_mcp()` / `reset role` pairs before the deletes.
